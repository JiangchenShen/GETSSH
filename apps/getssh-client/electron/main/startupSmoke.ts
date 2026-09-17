import { generateKeyPairSync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { getRustCorePath } from './utils/rustCorePath';

const TOKEN_PATTERN = /^[a-f0-9]{32}$/;

const RUST_MODULE_EXPORTS: Record<string, readonly string[]> = {
  'getssh-kv': ['initDb', 'getVal', 'setVal'],
  'getssh-sysprobe': ['getSystemStats'],
  'getssh-unarchive': ['extractPlugin'],
  'getssh-vault': ['encryptVault', 'decryptVault'],
  'sftp-stream': ['SftpDownloader', 'SftpUploader'],
  'nexus-core': ['initNexusCore', 'bootstrapWorkspace'],
  'audit-stream': ['AuditStream'],
  'getssh-sentinel': ['sanitize', 'rehydrate'],
};

export interface PackagedStartupSmokeResult {
  status: 'ok' | 'error';
  platform: NodeJS.Platform;
  arch: string;
  electron: string;
  modules?: string[];
  error?: string;
}

function getSmokeToken(): string | null {
  if (process.env.CI !== 'true') return null;
  const token = process.env.GETSSH_CI_STARTUP_SMOKE_TOKEN;
  return token && TOKEN_PATTERN.test(token) ? token : null;
}

function getResultPath(): string {
  const token = getSmokeToken();
  if (!token) throw new Error('Invalid packaged-startup smoke token');
  return path.join(os.tmpdir(), `getssh-startup-smoke-${token}.json`);
}

function assertExports(moduleName: string, loaded: unknown, expected: readonly string[]): void {
  if (!loaded || (typeof loaded !== 'object' && typeof loaded !== 'function')) {
    throw new Error(`${moduleName} did not return a module object`);
  }
  for (const exportName of expected) {
    if (typeof (loaded as Record<string, unknown>)[exportName] !== 'function') {
      throw new Error(`${moduleName} is missing native export ${exportName}`);
    }
  }
}

function assertNativeTool(fileName: string): void {
  const toolPath = path.join(process.resourcesPath, fileName);
  const accessMode = process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK;
  fs.accessSync(toolPath, accessMode);
  if (fs.statSync(toolPath).size === 0) {
    throw new Error(`${fileName} is empty`);
  }
}

function testLocalPty(nodePty: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const marker = 'GETSSH_PTY_SMOKE_OK';
    const windowsPowerShell = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe';
    const command = process.platform === 'win32' ? windowsPowerShell : '/bin/sh';
    const args = process.platform === 'win32'
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `Write-Output ${marker}`]
      : ['-c', `printf ${marker}`];
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
    );

    let output = '';
    let settled = false;
    let terminal: any;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      try { terminal?.kill(); } catch {}
      finish(new Error(`node-pty command timed out on ${process.platform}/${process.arch}`));
    }, 10_000);

    try {
      terminal = nodePty.spawn(command, args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: os.tmpdir(),
        env,
      });
      terminal.onData((data: string) => {
        if (output.length < 4096) output += data;
      });
      terminal.onExit(({ exitCode }: { exitCode: number }) => {
        if (exitCode !== 0) {
          finish(new Error(`node-pty command exited with ${exitCode}`));
        } else if (!output.includes(marker)) {
          finish(new Error(`node-pty command did not emit its marker: ${JSON.stringify(output)}`));
        } else {
          finish();
        }
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function testLocalSshTransport(ssh2: any): Promise<void> {
  return new Promise((resolve, reject) => {
    let client: any;
    let server: any;
    let serverConnection: any;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      try { client?.end(); } catch {}
      try { serverConnection?.end(); } catch {}
      try { server?.close(); } catch {}
      if (error) reject(error);
      else resolve();
    };

    timeout = setTimeout(() => {
      finish(new Error(`ssh2 loopback handshake timed out on ${process.platform}/${process.arch}`));
    }, 10_000);

    try {
      const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const hostKey = privateKey.export({ type: 'pkcs1', format: 'pem' });
      server = new ssh2.Server({ hostKeys: [hostKey] }, (connection: any) => {
        serverConnection = connection;
        connection.on('authentication', (context: any) => {
          if (context.method === 'none' && context.username === 'getssh-startup-smoke') {
            context.accept();
          } else {
            context.reject();
          }
        });
        connection.on('error', (error: Error) => finish(error));
      });
      server.on('error', (error: Error) => finish(error));
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          finish(new Error('ssh2 loopback server did not expose a TCP port'));
          return;
        }

        client = new ssh2.Client();
        client.on('ready', () => finish());
        client.on('error', (error: Error) => finish(error));
        client.connect({
          host: '127.0.0.1',
          port: address.port,
          username: 'getssh-startup-smoke',
          readyTimeout: 8_000,
          hostVerifier: () => true,
        });
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function shouldRunPackagedStartupSmoke(isPackaged: boolean): boolean {
  return isPackaged && getSmokeToken() !== null;
}

export async function runPackagedStartupSmoke(): Promise<PackagedStartupSmokeResult> {
  const loadedModules: string[] = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-startup-db-'));
  const key = Buffer.from(randomBytes(32).toString('hex'), 'utf8');
  let db: Database.Database | null = null;
  try {
    db = new Database(path.join(tempDir, 'startup.db'));
    db.pragma("cipher = 'sqlcipher'");
    db.key(key);
    db.exec('CREATE TABLE startup_smoke (value INTEGER NOT NULL)');
    db.prepare('INSERT INTO startup_smoke (value) VALUES (?)').run(3);
    const row = db.prepare('SELECT value FROM startup_smoke').get() as { value?: number } | undefined;
    if (row?.value !== 3) throw new Error('SQLCipher runtime query returned an unexpected value');
    loadedModules.push('better-sqlite3-multiple-ciphers');
  } finally {
    key.fill(0);
    db?.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const nodePty = require('node-pty');
  assertExports('node-pty', nodePty, ['spawn']);
  await testLocalPty(nodePty);
  loadedModules.push('node-pty');

  const ssh2 = require('ssh2');
  assertExports('ssh2', ssh2, ['Client', 'Server']);
  await testLocalSshTransport(ssh2);
  loadedModules.push('ssh2');

  for (const [moduleName, expectedExports] of Object.entries(RUST_MODULE_EXPORTS)) {
    const loaded = require(getRustCorePath(moduleName));
    assertExports(moduleName, loaded, expectedExports);
    loadedModules.push(moduleName);
  }

  assertNativeTool(process.platform === 'win32' ? 'watchdog.exe' : 'watchdog');
  if (process.platform === 'win32') assertNativeTool('getssh-sandbox.exe');

  return {
    status: 'ok',
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron || 'unknown',
    modules: loadedModules,
  };
}

export function writePackagedStartupSmokeResult(result: PackagedStartupSmokeResult): void {
  fs.writeFileSync(getResultPath(), `${JSON.stringify(result)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}
