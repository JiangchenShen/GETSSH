import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_WINDOWS_POLICY_PATHS = 128;
const WINDOWS_LAUNCHER_ENVIRONMENT = new Set([
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT'
]);

export interface WindowsSandboxTarget {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  readonlyPaths: string[];
  readwritePaths: string[];
  deniedPaths: string[];
  network: boolean;
  allowChildProcesses: boolean;
  maxProcesses: number;
}

export interface WindowsSandboxRuntime {
  runtimeHomeDir: string;
  journalRootDir: string;
  sandboxLauncherPath: string;
  parentPid?: number;
  processEnv?: NodeJS.ProcessEnv;
  executableExists?: (candidate: string) => boolean;
}

export interface WindowsSandboxSpawnPlan {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  isolation: 'windows-appcontainer';
  detached: false;
  targetPidIsDirectChild: false;
}

export interface WindowsSandboxLauncherLocation {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}

interface WindowsSandboxConfig {
  version: 1;
  parentPid: number;
  profileName: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  readonlyPaths: string[];
  readwritePaths: string[];
  deniedPaths: string[];
  network: boolean;
  allowChildProcesses: boolean;
  maxProcesses: number;
  journalDir: string;
}

export function resolveWindowsSandboxLauncherPath(
  location: WindowsSandboxLauncherLocation
): string {
  return location.isPackaged
    ? path.join(location.resourcesPath, 'getssh-sandbox.exe')
    : path.resolve(location.appPath, '../../target/release/getssh-sandbox.exe');
}

function canonicalExistingPath(
  candidate: string,
  label: string,
  executableExists: (candidate: string) => boolean
): string {
  if (typeof candidate !== 'string' || candidate.includes('\0') || !path.isAbsolute(candidate)) {
    throw new Error(`${label} must be an absolute path without NUL characters.`);
  }
  const absolute = path.resolve(candidate);
  if (!executableExists(absolute)) {
    throw new Error(`${label} does not exist: ${absolute}`);
  }
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function uniqueExistingPaths(
  candidates: string[],
  label: string,
  executableExists: (candidate: string) => boolean
): string[] {
  if (candidates.length > MAX_WINDOWS_POLICY_PATHS) {
    throw new Error(`${label} contains too many paths.`);
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const canonical = canonicalExistingPath(candidate, label, executableExists);
    const key = process.platform === 'win32' ? canonical.toLocaleLowerCase('en-US') : canonical;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(canonical);
  }
  return result;
}

function normalizedEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  const caseInsensitiveKeys = new Set<string>();
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value !== 'string') continue;
    if (
      !key || key.length > 256 || key.includes('=') || key.includes('\0') ||
      value.length > 65_536 || value.includes('\0')
    ) {
      throw new Error('Windows sandbox target environment contains an invalid entry.');
    }
    const folded = key.toLocaleUpperCase('en-US');
    if (caseInsensitiveKeys.has(folded)) {
      throw new Error(`Windows sandbox target environment contains duplicate key '${key}'.`);
    }
    caseInsensitiveKeys.add(folded);
    result[key] = value;
  }
  return result;
}

function launcherEnvironment(
  inherited: NodeJS.ProcessEnv,
  runtimeHomeDir: string
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    TEMP: runtimeHomeDir,
    TMP: runtimeHomeDir
  };
  for (const key of WINDOWS_LAUNCHER_ENVIRONMENT) {
    const value = inherited[key];
    if (typeof value === 'string' && !value.includes('\0')) environment[key] = value;
  }
  return environment;
}

/**
 * Writes a host-only, one-shot launch configuration and returns a process plan
 * for the native Windows AppContainer launcher. The launcher removes this file
 * before it grants the target access to its runtime directory.
 */
export function createWindowsSandboxSpawnPlan(
  target: WindowsSandboxTarget,
  runtime: WindowsSandboxRuntime
): WindowsSandboxSpawnPlan {
  const executableExists = runtime.executableExists || fs.existsSync;
  const launcherPath = canonicalExistingPath(
    runtime.sandboxLauncherPath,
    'GETSSH Windows sandbox launcher',
    executableExists
  );
  const runtimeHomeDir = canonicalExistingPath(
    runtime.runtimeHomeDir,
    'Windows sandbox runtime directory',
    executableExists
  );
  const journalRootDir = canonicalExistingPath(
    runtime.journalRootDir,
    'Windows sandbox journal root',
    executableExists
  );
  const command = canonicalExistingPath(target.command, 'Windows sandbox target', executableExists);
  const cwd = canonicalExistingPath(target.cwd, 'Windows sandbox cwd', executableExists);
  if (!fs.statSync(runtimeHomeDir).isDirectory() || !fs.statSync(cwd).isDirectory()) {
    throw new Error('Windows sandbox runtime HOME and cwd must be directories.');
  }
  if (!fs.statSync(command).isFile() || !fs.statSync(launcherPath).isFile()) {
    throw new Error('Windows sandbox launcher and target must be regular files.');
  }
  if (target.args.length > 512 || target.args.some(value =>
    typeof value !== 'string' || value.length > 65_536 || value.includes('\0')
  )) {
    throw new Error('Windows sandbox arguments exceed their bounds or contain NUL.');
  }
  if (!Number.isInteger(target.maxProcesses) || target.maxProcesses < 1 || target.maxProcesses > 256) {
    throw new Error('Windows sandbox maxProcesses must be between 1 and 256.');
  }
  if (!target.allowChildProcesses && target.maxProcesses !== 1) {
    throw new Error('A child-process-disabled Windows sandbox must use maxProcesses=1.');
  }

  const journalDir = path.join(journalRootDir, 'process-sandbox-journals');
  fs.mkdirSync(journalDir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(journalDir, 0o700); } catch {}
  const roamingAppData = path.join(runtimeHomeDir, 'AppData', 'Roaming');
  const localAppData = path.join(runtimeHomeDir, 'AppData', 'Local');
  fs.mkdirSync(roamingAppData, { recursive: true, mode: 0o700 });
  fs.mkdirSync(localAppData, { recursive: true, mode: 0o700 });
  const runtimeRoot = path.parse(runtimeHomeDir).root;
  const targetEnvironment: NodeJS.ProcessEnv = {
    ...target.env,
    HOME: runtimeHomeDir,
    USERPROFILE: runtimeHomeDir,
    APPDATA: roamingAppData,
    LOCALAPPDATA: localAppData,
    HOMEDRIVE: runtimeRoot.replace(/[\\/]$/, ''),
    HOMEPATH: runtimeHomeDir.slice(runtimeRoot.length - 1)
  };

  const profileName = `getssh.${crypto.randomUUID().replaceAll('-', '')}`;
  const parentPid = runtime.parentPid ?? process.pid;
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0 || parentPid > 0xffff_ffff) {
    throw new Error('Windows sandbox parentPid is invalid.');
  }
  const config: WindowsSandboxConfig = {
    version: 1,
    parentPid,
    profileName,
    command,
    args: [...target.args],
    cwd,
    env: normalizedEnvironment(targetEnvironment),
    readonlyPaths: uniqueExistingPaths(target.readonlyPaths, 'Windows read-only policy', executableExists),
    readwritePaths: uniqueExistingPaths(target.readwritePaths, 'Windows writable policy', executableExists),
    deniedPaths: uniqueExistingPaths(target.deniedPaths, 'Windows denied policy', executableExists),
    network: target.network === true,
    allowChildProcesses: target.allowChildProcesses === true,
    maxProcesses: target.maxProcesses,
    journalDir
  };
  const configPath = path.join(runtimeHomeDir, `.getssh-sandbox-${crypto.randomUUID()}.json`);
  const encoded = JSON.stringify(config);
  if (Buffer.byteLength(encoded, 'utf8') > 4 * 1024 * 1024) {
    throw new Error('Windows sandbox launch configuration exceeds 4 MiB.');
  }
  fs.writeFileSync(configPath, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });

  return {
    command: launcherPath,
    args: [configPath],
    cwd: runtimeHomeDir,
    env: launcherEnvironment(runtime.processEnv || process.env, runtimeHomeDir),
    isolation: 'windows-appcontainer',
    detached: false,
    targetPidIsDirectChild: false
  };
}
