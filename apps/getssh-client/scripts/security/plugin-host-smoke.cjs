'use strict';

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app } = require('electron');

const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const MAIN_MEMORY_SECRET = `main-only-${Date.now()}`;
globalThis.__GETSSH_MAIN_MEMORY_SECRET__ = MAIN_MEMORY_SECRET;
process.env.GETSSH_SMOKE_SECRET = 'must-not-cross-process-env';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-plugin-isolation-'));
const hostSecretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-plugin-host-secret-'));
const testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-plugin-user-data-'));
app.setPath('userData', testUserDataDir);
const hostSecretPath = path.join(hostSecretDir, 'secret.txt');
const hostWritePath = path.join(hostSecretDir, 'plugin-write.txt');
const pluginEntry = path.join(tempDir, 'main.js');
const failingPluginEntry = path.join(tempDir, 'failing.js');
const pluginSymlinkDir = path.join(tempDir, 'host-secret-link');
const pluginSymlinkPath = path.join(pluginSymlinkDir, 'secret.txt');
fs.writeFileSync(hostSecretPath, 'must-not-be-readable');
fs.symlinkSync(hostSecretDir, pluginSymlinkDir, process.platform === 'win32' ? 'junction' : 'dir');
fs.writeFileSync(failingPluginEntry, `
module.exports = {
  activate() { throw new Error('intentional activation failure'); },
  deactivate() {}
};
`, 'utf8');

const workerPath = path.resolve(__dirname, '../../dist-electron/main/plugin-host.js');
const sandboxLauncherPath = path.resolve(__dirname, '../../../../target/release/getssh-sandbox.exe');
const { createPluginSpawnPlan } = require('../../dist-electron/main/plugin-sandbox.js');
const runtimeDirs = [];
let child;
let phase = 'activation';
let timer;
let finished = false;
let failureProbeStartedAt = 0;
let activationErrorSeen = false;
let loopbackServer;
let loopbackConnections = 0;

function writeProbePlugin(loopbackPort) {
  fs.writeFileSync(pluginEntry, `
module.exports = {
  activate(ctx) {
    ctx.ui.registerSettings([{ id: 'enabled', type: 'boolean', label: 'Enabled', default: true }]);
    ctx.rpc.registerMethod('probe', async () => {
      const fs = require('node:fs');
      let electronExposure = null;
      try {
        const electron = require('electron');
        electronExposure = {
          type: typeof electron,
          keys: electron && typeof electron === 'object' ? Object.keys(electron).sort() : [],
          hasSafeStorage: !!electron?.safeStorage,
          hasIpcMain: !!electron?.ipcMain,
          hasApp: !!electron?.app
        };
      } catch (error) {
        electronExposure = { error: error.message };
      }
      let directNetwork = 'unknown';
      try {
        directNetwork = await new Promise(resolve => {
          const socket = require('node:net').connect({ host: '127.0.0.1', port: ${loopbackPort} });
          const timer = setTimeout(() => { socket.destroy(); resolve('timeout'); }, 750);
          socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve('connected'); });
          socket.once('error', error => { clearTimeout(timer); resolve(error.code || error.message); });
        });
      } catch (error) { directNetwork = error.code || error.message; }
      let childProcess = false;
      try {
        const attempt = require('node:child_process').spawnSync(process.execPath, ['--version']);
        childProcess = !attempt.error;
      } catch {}
      let workerThread = false;
      try {
        const { Worker } = require('node:worker_threads');
        const worker = new Worker('', { eval: true });
        workerThread = true;
        await worker.terminate();
      } catch {}
      let hostWrite = false;
      try {
        fs.writeFileSync(${JSON.stringify(hostWritePath)}, 'bad');
        hostWrite = true;
      } catch {}
      let runtimeWrite = false;
      try {
        fs.writeFileSync(require('node:path').join(process.env.HOME, 'runtime.txt'), 'ok');
        runtimeWrite = true;
      } catch {}
      let parentSignal = false;
      try {
        process.kill(${process.pid}, 0);
        parentSignal = true;
      } catch {}
      return {
        pid: process.pid,
        mainMemorySecret: globalThis.__GETSSH_MAIN_MEMORY_SECRET__ || null,
        inheritedEnvSecret: process.env.GETSSH_SMOKE_SECRET || null,
        hostFileSecret: (() => {
          try { return fs.readFileSync(${JSON.stringify(hostSecretPath)}, 'utf8'); }
          catch { return null; }
        })(),
        symlinkHostFileSecret: (() => {
          try { return fs.readFileSync(${JSON.stringify(pluginSymlinkPath)}, 'utf8'); }
          catch { return null; }
        })(),
        pluginFileRead: fs.readFileSync(__filename, 'utf8').length > 0,
        directNetwork,
        childProcess,
        workerThread,
        hostWrite,
        runtimeWrite,
        parentSignal,
        electronExposure
      };
    });
    ctx.rpc.registerMethod('crash', async () => {
      setTimeout(() => process.exit(23), 25);
      return 'crashing';
    });
  },
  deactivate() {}
};
`, 'utf8');
}

function send(target, message) {
  const frame = Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');
  if (frame.byteLength > MAX_FRAME_BYTES) throw new Error('smoke protocol frame is too large');
  target.stdin.write(frame);
}

function receive(target, onMessage) {
  let pending = Buffer.alloc(0);
  target.stdout.on('data', chunk => {
    pending = Buffer.concat([pending, Buffer.from(chunk)]);
    while (true) {
      const newline = pending.indexOf(0x0a);
      if (newline === -1) break;
      const line = pending.subarray(0, newline);
      pending = pending.subarray(newline + 1);
      if (line.byteLength === 0 || line.byteLength > MAX_FRAME_BYTES) {
        finish(new Error('isolated plugin returned an invalid protocol frame'));
        return;
      }
      try {
        onMessage(JSON.parse(line.toString('utf8')));
      } catch (error) {
        finish(new Error(`isolated plugin returned malformed JSON: ${error.message}`));
        return;
      }
    }
    if (pending.byteLength > MAX_FRAME_BYTES) {
      finish(new Error('isolated plugin protocol buffer exceeded its limit'));
    }
  });
}

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  if (child?.pid !== undefined) child.kill();
  loopbackServer?.close();
  for (const cleanupPath of [tempDir, hostSecretDir, testUserDataDir, ...runtimeDirs]) {
    try { fs.rmSync(cleanupPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch {}
  }
  if (error) {
    console.error(`plugin isolation smoke failed: ${error.message || error}`);
    app.exit(1);
  } else {
    console.log('plugin isolation smoke passed');
    app.exit(0);
  }
}

function launchSandboxedPlugin() {
  const runtimeHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-plugin-runtime-'));
  runtimeDirs.push(runtimeHomeDir);
  const plan = createPluginSpawnPlan({
    pluginDir: tempDir,
    workerPath,
    runtimeHomeDir,
    userDataDir: app.getPath('userData'),
    homeDir: app.getPath('home'),
    tempDir: app.getPath('temp'),
    executablePath: process.execPath,
    sandboxLauncherPath
  });
  return spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    env: plan.env,
    detached: plan.detached,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function startActivationFailureProbe() {
  phase = 'activation-error';
  failureProbeStartedAt = Date.now();
  activationErrorSeen = false;
  child = launchSandboxedPlugin();
  child.stderr?.on('data', chunk => process.stderr.write(chunk));
  child.once('spawn', () => send(child, {
    type: 'getssh:init',
    pluginId: 'activation-failure-smoke',
    displayName: 'Activation Failure Smoke',
    pluginDir: tempDir,
    entryPath: failingPluginEntry,
    capabilities: ['lifecycle']
  }));
  receive(child, message => {
    if (message.type !== 'getssh:activation-error') return;
    if (!message.error.includes('intentional activation failure')) {
      finish(new Error(`unexpected activation error: ${message.error}`));
      return;
    }
    if (Date.now() - failureProbeStartedAt > 3_000) {
      finish(new Error('activation error was not reported promptly'));
      return;
    }
    activationErrorSeen = true;
  });
  child.on('error', error => finish(new Error(`activation failure probe fatal error: ${error.message}`)));
  child.on('exit', code => {
    if (finished) return;
    if (!activationErrorSeen) {
      finish(new Error(`activation failure probe exited before reporting its error: ${code}`));
      return;
    }
    if (code !== 1) {
      finish(new Error(`activation failure probe returned unexpected exit code ${code}`));
      return;
    }
    if (process.platform === 'win32') {
      const journalDir = path.join(testUserDataDir, 'process-sandbox-journals');
      const journals = fs.existsSync(journalDir)
        ? fs.readdirSync(journalDir).filter(name => name.endsWith('.json'))
        : [];
      if (journals.length !== 0) {
        finish(new Error(`Windows sandbox left cleanup journals behind: ${journals.join(', ')}`));
        return;
      }
    }
    finish();
  });
}

function handlePrimaryMessage(message) {
  if (message.type === 'getssh:ready') return;
  if (message.type === 'getssh:host-call') {
    send(child, {
      type: 'getssh:host-response',
      requestId: message.requestId,
      ok: false,
      error: `Unexpected host call: ${message.method}`
    });
    return;
  }
  if (message.type === 'getssh:activation-error') {
    finish(new Error(message.error));
    return;
  }
  if (message.type === 'getssh:activated') {
    if (message.pid === process.pid) {
      finish(new Error('plugin shares the main-process PID'));
      return;
    }
    if (!message.registrations.rpcMethods.includes('probe')) {
      finish(new Error('probe RPC was not registered'));
      return;
    }
    phase = 'probe';
    send(child, {
      type: 'getssh:invoke',
      requestId: 'smoke:probe',
      kind: 'rpc',
      handlerId: 'probe',
      payload: null
    });
    return;
  }
  if (message.type === 'getssh:invoke-response' && phase === 'probe') {
    if (!message.ok) {
      finish(new Error(message.error || 'probe failed'));
      return;
    }
    const result = message.result;
    if (result.mainMemorySecret !== null) {
      finish(new Error('plugin read a main-memory-only secret'));
      return;
    }
    if (result.inheritedEnvSecret !== null) {
      finish(new Error('plugin inherited a stripped environment secret'));
      return;
    }
    if (result.hostFileSecret !== null || result.symlinkHostFileSecret !== null) {
      finish(new Error('plugin read an undeclared host file'));
      return;
    }
    if (!result.pluginFileRead || !result.runtimeWrite) {
      finish(new Error('plugin lost access to its own code or ephemeral runtime HOME'));
      return;
    }
    if (
      result.directNetwork === 'connected' || result.childProcess || result.workerThread ||
      result.hostWrite || result.parentSignal || loopbackConnections !== 0
    ) {
      finish(new Error(`plugin retained a forbidden OS capability: ${JSON.stringify(result)}`));
      return;
    }
    if (
      result.electronExposure?.hasSafeStorage || result.electronExposure?.hasIpcMain ||
      result.electronExposure?.hasApp
    ) {
      finish(new Error(`plugin reached privileged Electron APIs: ${JSON.stringify(result.electronExposure)}`));
      return;
    }
    phase = 'crash';
    send(child, {
      type: 'getssh:invoke',
      requestId: 'smoke:crash',
      kind: 'rpc',
      handlerId: 'crash',
      payload: null
    });
  }
}

app.whenReady().then(async () => {
  loopbackServer = net.createServer(socket => {
    loopbackConnections += 1;
    socket.destroy();
  });
  await new Promise((resolve, reject) => {
    loopbackServer.once('error', reject);
    loopbackServer.listen(0, '127.0.0.1', resolve);
  });
  const address = loopbackServer.address();
  if (!address || typeof address === 'string') throw new Error('failed to allocate loopback probe port');
  writeProbePlugin(address.port);

  child = launchSandboxedPlugin();
  child.stderr?.on('data', chunk => process.stderr.write(chunk));
  child.on('error', error => finish(new Error(`isolated plugin process error: ${error.message}`)));
  child.once('spawn', () => send(child, {
    type: 'getssh:init',
    pluginId: 'isolation-smoke',
    displayName: 'Isolation Smoke',
    pluginDir: tempDir,
    entryPath: pluginEntry,
    capabilities: ['lifecycle']
  }));
  receive(child, handlePrimaryMessage);
  child.on('exit', code => {
    if (phase !== 'crash') {
      finish(new Error(`plugin exited early with code ${code}`));
      return;
    }
    if (code !== 23) {
      finish(new Error(`expected isolated crash code 23, got ${code}`));
      return;
    }
    startActivationFailureProbe();
  });
  timer = setTimeout(() => finish(new Error('timed out after 20 seconds')), 20_000);
}).catch(finish);
