import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWindowsSandboxSpawnPlan } from '../../security/WindowsProcessSandbox';

const SAFE_INHERITED_ENVIRONMENT = new Set([
  'PATH',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
  'NODE_ENV'
]);

const MAC_BLOCKED_MACH_SERVICES = [
  'com.apple.pasteboard.1',
  'com.apple.coreservices.launchservicesd',
  'com.apple.coreservices.appleevents',
  'com.apple.lsd.mapdb',
  'com.apple.lsd.modifydb',
  'com.apple.scopedbookmarksagent.xpc',
  'com.apple.securityd',
  'com.apple.securityd.xpc',
  'com.apple.securityd.general',
  'com.apple.securityd.systemkeychain'
];

export interface PluginSandboxRuntime {
  pluginDir: string;
  workerPath: string;
  runtimeHomeDir: string;
  userDataDir: string;
  executablePath?: string;
  homeDir?: string;
  tempDir?: string;
  platform?: NodeJS.Platform;
  processEnv?: NodeJS.ProcessEnv;
  sandboxLauncherPath?: string;
  executableExists?: (candidate: string) => boolean;
}

export interface PluginSpawnPlan {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  isolation: 'macos-seatbelt' | 'windows-appcontainer';
  detached: boolean;
  targetPidIsDirectChild: boolean;
}

function canonicalPath(candidate: string): string {
  const absolute = path.resolve(candidate);
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

/**
 * Electron can address files inside app.asar through its patched fs layer, but
 * an OS sandbox launcher can only mount the physical archive. Collapse virtual
 * paths to that archive before constructing Seatbelt read grants.
 */
export function pluginFilesystemBackingPath(candidate: string): string {
  const absolute = path.resolve(candidate);
  const marker = `${path.sep}app.asar${path.sep}`;
  const markerIndex = absolute.indexOf(marker);
  // An unpacked Vite worker imports sibling chunks, so its whole output
  // directory is the smallest viable read root.
  if (markerIndex === -1) return canonicalPath(path.dirname(absolute));
  return canonicalPath(absolute.slice(0, markerIndex + `${path.sep}app.asar`.length));
}

function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function uniquePaths(candidates: string[]): string[] {
  return [...new Set(candidates.map(canonicalPath))];
}

function buildEnvironment(inherited: NodeJS.ProcessEnv, runtimeHomeDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_INHERITED_ENVIRONMENT) {
    const value = inherited[key];
    if (typeof value === 'string' && !value.includes('\0')) env[key] = value;
  }
  env.HOME = runtimeHomeDir;
  env.TMPDIR = runtimeHomeDir;
  env.TMP = runtimeHomeDir;
  env.TEMP = runtimeHomeDir;
  env.XDG_CACHE_HOME = path.join(runtimeHomeDir, 'cache');
  env.XDG_CONFIG_HOME = path.join(runtimeHomeDir, 'config');
  env.XDG_DATA_HOME = path.join(runtimeHomeDir, 'data');
  env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}

function macBundleRoot(executablePath: string): string {
  let current = path.dirname(executablePath);
  while (current !== path.dirname(current)) {
    if (current.toLowerCase().endsWith('.app')) return current;
    current = path.dirname(current);
  }
  return path.dirname(executablePath);
}

function sbplString(value: string): string {
  if (/[\0-\x1f\x7f]/.test(value)) {
    throw new Error('Plugin sandbox path contains control characters.');
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function pathFilters(candidate: string): string {
  const escaped = sbplString(candidate);
  return `(literal ${escaped}) (subpath ${escaped})`;
}

function buildMacProfile(
  executablePath: string,
  allowedReadPaths: string[],
  runtimeHomeDir: string,
  deniedReadRoots: string[]
): string {
  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)'
  ];

  for (const deniedRoot of deniedReadRoots) {
    lines.push(`(deny file-read* file-write* ${pathFilters(deniedRoot)})`);
    // Electron/Node resolves executable and module ancestors before opening a
    // specifically allowed file. Metadata alone exposes no file contents.
    lines.push(`(allow file-read-metadata ${pathFilters(deniedRoot)})`);
  }
  for (const allowedPath of allowedReadPaths) {
    lines.push(`(allow file-read* ${pathFilters(allowedPath)})`);
  }
  lines.push(`(allow file-write* ${pathFilters(runtimeHomeDir)})`);
  lines.push('(allow file-write-data (literal "/dev/null") (literal "/dev/zero") (subpath "/dev/fd"))');
  lines.push('(deny network*)');
  lines.push('(deny appleevent-send)');
  lines.push('(deny lsopen)');
  for (const service of MAC_BLOCKED_MACH_SERVICES) {
    lines.push(`(deny mach-lookup (global-name ${sbplString(service)}))`);
  }
  lines.push('(deny signal)');
  lines.push('(allow signal (target self))');
  lines.push('(allow signal (target children))');
  lines.push('(deny process-info*)');
  lines.push('(allow process-info* (target self))');
  lines.push('(allow process-info* (target children))');
  lines.push('(deny process-exec)');
  lines.push(`(allow process-exec (literal ${sbplString(executablePath)}))`);
  return lines.join('');
}

function nodePermissionArgs(workerPath: string, runtimeHomeDir: string): string[] {
  return [
    '--permission',
    // The OS sandbox is the malicious-code boundary for reads. Node's
    // permission model is defense in depth for writes, networking, subprocesses,
    // workers, native addons, FFI, WASI, and the inspector. Node module
    // resolution probes ancestor package.json files, so a narrow Node read list
    // breaks valid plugins before the OS policy can make the authoritative check.
    '--allow-fs-read=*',
    `--allow-fs-write=${runtimeHomeDir}`,
    workerPath
  ];
}

export function createPluginSpawnPlan(runtime: PluginSandboxRuntime): PluginSpawnPlan {
  const platform = runtime.platform || process.platform;
  const executablePath = canonicalPath(runtime.executablePath || process.execPath);
  const pluginDir = canonicalPath(runtime.pluginDir);
  const workerPath = canonicalPath(runtime.workerPath);
  const runtimeHomeDir = canonicalPath(runtime.runtimeHomeDir);
  const homeDir = canonicalPath(runtime.homeDir || os.homedir());
  const tempDir = canonicalPath(runtime.tempDir || os.tmpdir());
  const userDataDir = canonicalPath(runtime.userDataDir);
  const executableExists = runtime.executableExists || fs.existsSync;

  if (!path.isAbsolute(pluginDir) || !path.isAbsolute(workerPath) || !path.isAbsolute(runtimeHomeDir)) {
    throw new Error('Secure plugin paths must be absolute.');
  }
  if (!fs.existsSync(pluginDir) || !fs.statSync(pluginDir).isDirectory()) {
    throw new Error(`Plugin directory does not exist: ${pluginDir}`);
  }
  if (!fs.existsSync(workerPath) || !fs.statSync(workerPath).isFile()) {
    throw new Error(`Plugin worker does not exist: ${workerPath}`);
  }
  if (!executableExists(executablePath)) {
    throw new Error(`Electron Node runtime does not exist: ${executablePath}`);
  }
  if (
    pathContains(pluginDir, workerPath) ||
    pathContains(pluginDir, executablePath) ||
    pathContains(pluginDir, runtimeHomeDir) ||
    pathContains(runtimeHomeDir, pluginDir)
  ) {
    throw new Error('Plugin code, trusted worker, runtime, and Electron executable paths must be separate.');
  }

  const allowedReadPaths = uniquePaths([
    pluginDir,
    pluginFilesystemBackingPath(workerPath),
    platform === 'darwin' ? macBundleRoot(executablePath) : path.dirname(executablePath),
    runtimeHomeDir
  ]);
  const env = buildEnvironment(runtime.processEnv || process.env, runtimeHomeDir);

  if (platform === 'darwin') {
    const sandboxExec = '/usr/bin/sandbox-exec';
    if (!executableExists(sandboxExec)) {
      throw new Error('Secure backend plugin isolation is unavailable: macOS sandbox-exec was not found.');
    }
    const deniedReadRoots = uniquePaths([
      homeDir,
      userDataDir,
      tempDir,
      '/private/tmp',
      '/tmp',
      '/var/tmp',
      '/Users/Shared',
      '/Volumes',
      '/Network'
    ]);
    return {
      command: sandboxExec,
      args: [
        '-p',
        buildMacProfile(executablePath, allowedReadPaths, runtimeHomeDir, deniedReadRoots),
        executablePath,
        ...nodePermissionArgs(workerPath, runtimeHomeDir)
      ],
      cwd: pluginDir,
      env,
      isolation: 'macos-seatbelt',
      detached: true,
      targetPidIsDirectChild: true
    };
  }

  if (platform === 'win32') {
    if (!runtime.sandboxLauncherPath) {
      throw new Error('Secure backend plugin isolation is unavailable: getssh-sandbox.exe was not found.');
    }
    return {
      ...createWindowsSandboxSpawnPlan({
        command: executablePath,
        args: nodePermissionArgs(workerPath, runtimeHomeDir),
        cwd: pluginDir,
        env,
        readonlyPaths: allowedReadPaths.filter(candidate => !pathContains(runtimeHomeDir, candidate)),
        readwritePaths: [runtimeHomeDir],
        deniedPaths: [],
        network: false,
        allowChildProcesses: false,
        maxProcesses: 1
      }, {
        runtimeHomeDir,
        journalRootDir: userDataDir,
        sandboxLauncherPath: runtime.sandboxLauncherPath,
        processEnv: runtime.processEnv,
        executableExists
      })
    };
  }

  throw new Error(`Secure backend plugin isolation is unavailable on ${platform}; use safe mode.`);
}
