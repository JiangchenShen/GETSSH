import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWindowsSandboxSpawnPlan } from '../../security/WindowsProcessSandbox';
import type { McpServerConfig, McpTransportType } from './mcpTypes';

const MAX_NAME_LENGTH = 160;
const MAX_COMMAND_LENGTH = 4_096;
const MAX_ARGUMENTS = 512;
const MAX_ARGUMENT_LENGTH = 65_536;
const MAX_ENVIRONMENT_ENTRIES = 256;
const MAX_ENVIRONMENT_VALUE_LENGTH = 65_536;
const MAX_HEADERS = 128;
const MAX_HEADER_VALUE_LENGTH = 16_384;
const MAX_READ_PATHS = 64;
const MAX_WRITE_PATHS = 64;

const SAFE_INHERITED_ENVIRONMENT = new Set([
  'PATH',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT'
]);

const MANAGED_RUNTIME_ENVIRONMENT = new Set([
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'HOMEDRIVE',
  'HOMEPATH',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME'
]);

const BLOCKED_LAUNCH_ENVIRONMENT = new Set([
  'NODE_OPTIONS',
  'NODE_PATH',
  'LD_PRELOAD',
  'LD_AUDIT',
  'LD_LIBRARY_PATH',
  'GCONV_PATH',
  'LOCPATH',
  'NLSPATH'
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

export interface McpSandboxRuntime {
  userDataDir: string;
  runtimeHomeDir: string;
  platform?: NodeJS.Platform;
  homeDir?: string;
  tempDir?: string;
  defaultCwd?: string;
  processEnv?: NodeJS.ProcessEnv;
  sandboxLauncherPath?: string;
  executableExists?: (candidate: string) => boolean;
}

export interface McpSpawnPlan {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  isolation: 'macos-seatbelt' | 'windows-appcontainer';
  detached: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function checkedString(
  value: unknown,
  label: string,
  maxLength: number,
  allowEmpty = false,
  allowLineBreaks = false
): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  if (
    (!allowEmpty && value.trim().length === 0) ||
    value.length > maxLength ||
    value.includes('\0') ||
    (!allowLineBreaks && /[\r\n]/.test(value))
  ) {
    throw new Error(`${label} is empty, too long, or contains control characters.`);
  }
  return value;
}

function checkedOptionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return checkedString(value, label, maxLength);
}

function normalizeStringRecord(
  value: unknown,
  label: string,
  maxEntries: number,
  maxValueLength: number,
  validateKey: (key: string) => boolean,
  allowValueLineBreaks = false
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  const entries = Object.entries(value);
  if (entries.length > maxEntries) throw new Error(`${label} contains too many entries.`);

  const normalized = Object.create(null) as Record<string, string>;
  for (const [key, rawValue] of entries) {
    if (!validateKey(key)) throw new Error(`${label} contains invalid key '${key}'.`);
    const stringValue = checkedString(rawValue, `${label}.${key}`, maxValueLength, true, allowValueLineBreaks);
    normalized[key] = stringValue;
  }
  return normalized;
}

function isBlockedLaunchEnvironmentKey(key: string): boolean {
  const normalized = key.toLocaleUpperCase('en-US');
  return BLOCKED_LAUNCH_ENVIRONMENT.has(normalized) || normalized.startsWith('DYLD_');
}

function normalizePermissionPaths(
  value: unknown,
  field: 'readPaths' | 'writePaths',
  maxPaths: number
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxPaths) {
    throw new Error(`MCP permissions.${field} must contain at most ${maxPaths} paths.`);
  }
  return value.map((entry, index) => {
    const candidate = checkedString(entry, `MCP permissions.${field}[${index}]`, MAX_ARGUMENT_LENGTH);
    if (!path.isAbsolute(candidate)) {
      throw new Error(`MCP permissions.${field}[${index}] must be absolute.`);
    }
    return path.resolve(candidate);
  });
}

/**
 * Rebuild an MCP config from known fields. Besides validation, this prevents
 * renderer-controlled objects from smuggling prototype or identifier changes
 * into the persisted main-process configuration.
 */
export function normalizeMcpServerConfig(input: unknown, forcedId?: string): McpServerConfig {
  if (!isRecord(input)) throw new Error('MCP server configuration must be an object.');

  const id = checkedString(forcedId ?? input.id, 'MCP server id', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error('MCP server id contains unsupported characters.');
  }

  const name = checkedString(input.name, 'MCP server name', MAX_NAME_LENGTH).trim();
  const transport = input.transport as McpTransportType;
  if (transport !== 'stdio' && transport !== 'http' && transport !== 'sse') {
    throw new Error(`Unsupported MCP transport: ${String(input.transport)}`);
  }

  const config: McpServerConfig = {
    id,
    name,
    transport,
    enabled: input.enabled === true
  };

  const rawPermissions = input.permissions;
  if (rawPermissions !== undefined && !isRecord(rawPermissions)) {
    throw new Error('MCP permissions must be an object.');
  }
  config.permissions = {
    network: isRecord(rawPermissions) && rawPermissions.network === true,
    sampling: isRecord(rawPermissions) && rawPermissions.sampling === true,
    readPaths: normalizePermissionPaths(
      isRecord(rawPermissions) ? rawPermissions.readPaths : undefined,
      'readPaths',
      MAX_READ_PATHS
    ),
    writePaths: normalizePermissionPaths(
      isRecord(rawPermissions) ? rawPermissions.writePaths : undefined,
      'writePaths',
      MAX_WRITE_PATHS
    )
  };

  if (transport === 'stdio') {
    config.command = checkedString(input.command, 'MCP stdio command', MAX_COMMAND_LENGTH);
    if (input.args !== undefined) {
      if (!Array.isArray(input.args) || input.args.length > MAX_ARGUMENTS) {
        throw new Error(`MCP stdio args must contain at most ${MAX_ARGUMENTS} strings.`);
      }
      config.args = input.args.map((arg, index) =>
        checkedString(arg, `MCP stdio args[${index}]`, MAX_ARGUMENT_LENGTH, true, true)
      );
    }
    config.env = normalizeStringRecord(
      input.env,
      'MCP stdio environment',
      MAX_ENVIRONMENT_ENTRIES,
      MAX_ENVIRONMENT_VALUE_LENGTH,
      key => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key),
      true
    );
    for (const key of Object.keys(config.env || {})) {
      if (isBlockedLaunchEnvironmentKey(key)) {
        throw new Error(`MCP stdio environment variable '${key}' is blocked at the sandbox launcher boundary.`);
      }
    }
    config.cwd = checkedOptionalString(input.cwd, 'MCP stdio cwd', MAX_ARGUMENT_LENGTH);

  } else {
    const rawUrl = checkedString(input.url, 'MCP endpoint URL', MAX_ARGUMENT_LENGTH);
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new Error('MCP endpoint URL is invalid.');
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('MCP endpoint URL must use HTTP or HTTPS.');
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error('MCP endpoint URL must not contain embedded credentials.');
    }
    config.url = parsedUrl.toString();
    config.headers = normalizeStringRecord(
      input.headers,
      'MCP HTTP headers',
      MAX_HEADERS,
      MAX_HEADER_VALUE_LENGTH,
      key => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)
    );
  }

  return config;
}

function canonicalPolicyPath(candidate: string): string[] {
  const absolute = path.resolve(candidate);
  let existing = absolute;
  const missingSegments: string[] = [];

  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missingSegments.unshift(path.basename(existing));
    existing = parent;
  }

  let canonical = absolute;
  try {
    canonical = path.join(fs.realpathSync.native(existing), ...missingSegments);
  } catch {
    // The lexical absolute path is still useful when no ancestor can be resolved.
  }
  return canonical === absolute ? [absolute] : [absolute, canonical];
}

function uniqueCanonicalPaths(candidates: string[]): string[] {
  return [...new Set(candidates.flatMap(canonicalPolicyPath))];
}

function minimalRootPaths(candidates: string[]): string[] {
  return uniqueCanonicalPaths(candidates)
    .sort((left, right) => left.length - right.length)
    .filter((candidate, index, all) =>
      !all.slice(0, index).some(parent => pathContains(parent, candidate))
    );
}

function protectedHostPaths(homeDir: string, userDataDir: string): string[] {
  return uniqueCanonicalPaths([
    path.join(homeDir, '.getssh'),
    userDataDir,
    path.join(homeDir, '.ssh'),
    path.join(homeDir, '.aws'),
    path.join(homeDir, '.azure'),
    path.join(homeDir, '.gnupg'),
    path.join(homeDir, '.kube'),
    path.join(homeDir, '.docker'),
    path.join(homeDir, '.config', 'gcloud'),
    path.join(homeDir, '.config', 'gh'),
    path.join(homeDir, '.local', 'share', 'keyrings'),
    path.join(homeDir, '.password-store'),
    path.join(homeDir, '.npmrc'),
    path.join(homeDir, '.netrc'),
    path.join(homeDir, '.git-credentials'),
    path.join(homeDir, 'Library', 'Keychains')
  ]);
}

function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function rejectPathInsideProtected(label: string, candidate: string, protectedPaths: string[]): void {
  const candidatePaths = canonicalPolicyPath(candidate);
  if (candidatePaths.some(value => protectedPaths.some(protectedPath => pathContains(protectedPath, value)))) {
    throw new Error(`${label} points inside a protected credential directory.`);
  }
}

function rejectProtectedGrantPath(label: string, candidate: string, protectedPaths: string[]): void {
  const candidatePaths = canonicalPolicyPath(candidate);
  if (candidatePaths.some(value => protectedPaths.some(protectedPath =>
    pathContains(protectedPath, value) || pathContains(value, protectedPath)
  ))) {
    throw new Error(`${label} overlaps a protected credential directory.`);
  }
}

function resolveCommandPath(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  executableExists: (candidate: string) => boolean,
  platform: NodeJS.Platform
): string {
  const candidatesFor = (base: string): string[] => {
    const candidates = [base];
    if (platform !== 'win32' || path.extname(base)) return candidates;
    const extensions = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
      .split(';')
      .filter(extension => /^\.[A-Za-z0-9]{1,8}$/.test(extension));
    for (const extension of extensions) candidates.push(`${base}${extension}`);
    return candidates;
  };
  const hasPathSeparator = command.includes('/') || command.includes('\\');
  const directCandidate = path.isAbsolute(command)
    ? path.resolve(command)
    : hasPathSeparator
      ? path.resolve(cwd, command)
      : undefined;

  if (directCandidate) {
    const resolved = candidatesFor(directCandidate).find(executableExists);
    if (!resolved) {
      throw new Error(`MCP stdio command does not exist: ${directCandidate}`);
    }
    return canonicalPolicyPath(resolved).at(-1)!;
  }

  for (const pathEntry of (env.PATH || '').split(path.delimiter)) {
    if (!pathEntry) continue;
    const base = path.resolve(pathEntry, command);
    const candidate = candidatesFor(base).find(executableExists);
    if (candidate) return canonicalPolicyPath(candidate).at(-1)!;
  }
  throw new Error(`MCP stdio command '${command}' could not be resolved from PATH.`);
}

function commandSupportRoot(commandPath: string, homeDir: string): string {
  const commandDir = path.dirname(commandPath);
  if (commandDir === path.parse(commandDir).root) return commandPath;
  const packageRoot = path.basename(commandDir) === 'bin' ? path.dirname(commandDir) : commandDir;
  // A system executable such as /bin/sh must never turn the filesystem root
  // into an allowlisted read path. Likewise ~/bin/tool must not implicitly
  // expose the user's entire home just because its parent directory is named
  // "bin"; in that case grant only the command directory.
  return packageRoot === path.parse(packageRoot).root || pathContains(packageRoot, homeDir)
    ? commandDir
    : packageRoot;
}

function buildEnvironment(
  inherited: NodeJS.ProcessEnv,
  configured: Record<string, string> | undefined,
  runtimeHomeDir: string
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_INHERITED_ENVIRONMENT) {
    const value = inherited[key];
    if (typeof value === 'string' && !value.includes('\0')) env[key] = value;
  }
  for (const [key, value] of Object.entries(configured || {})) {
    if (!MANAGED_RUNTIME_ENVIRONMENT.has(key.toLocaleUpperCase('en-US'))) env[key] = value;
  }

  env.HOME = runtimeHomeDir;
  env.TMPDIR = runtimeHomeDir;
  env.TMP = runtimeHomeDir;
  env.TEMP = runtimeHomeDir;
  env.XDG_CACHE_HOME = path.join(runtimeHomeDir, 'cache');
  env.XDG_CONFIG_HOME = path.join(runtimeHomeDir, 'config');
  env.XDG_DATA_HOME = path.join(runtimeHomeDir, 'data');
  return env;
}

function sbplString(value: string): string {
  if (/[\0-\x1f\x7f]/.test(value)) throw new Error('MCP sandbox path contains control characters.');
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function pathFilters(candidate: string): string {
  const escaped = sbplString(candidate);
  return `(literal ${escaped}) (subpath ${escaped})`;
}

function buildMacProfile(
  protectedPaths: string[],
  deniedReadRoots: string[],
  allowedReadPaths: string[],
  runtimeHomeDir: string,
  writePaths: string[],
  networkAllowed: boolean
): string {
  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)'
  ];

  for (const deniedRoot of deniedReadRoots) {
    lines.push(`(deny file-read* file-write* ${pathFilters(deniedRoot)})`);
    // Runtime loaders may need to walk ancestors to reach a specifically
    // granted executable or module. Metadata does not expose file contents.
    lines.push(`(allow file-read-metadata ${pathFilters(deniedRoot)})`);
  }
  for (const readablePath of allowedReadPaths) {
    lines.push(`(allow file-read* ${pathFilters(readablePath)})`);
  }
  lines.push(`(allow file-write* ${pathFilters(runtimeHomeDir)})`);
  for (const writablePath of writePaths) {
    lines.push(`(allow file-read* file-write* ${pathFilters(writablePath)})`);
  }
  // Protected credential locations remain denied even if a broader cwd or
  // executable support root was explicitly granted above.
  for (const protectedPath of protectedPaths) {
    lines.push(`(deny file-read* file-write* ${pathFilters(protectedPath)})`);
  }
  lines.push('(allow file-write-data (literal "/dev/null") (literal "/dev/zero") (subpath "/dev/fd"))');
  lines.push('(deny signal)');
  lines.push('(allow signal (target self))');
  lines.push('(allow signal (target children))');
  lines.push('(deny process-info*)');
  lines.push('(allow process-info* (target self))');
  lines.push('(allow process-info* (target children))');
  lines.push('(deny appleevent-send)');
  lines.push('(deny lsopen)');
  for (const service of MAC_BLOCKED_MACH_SERVICES) {
    lines.push(`(deny mach-lookup (global-name ${sbplString(service)}))`);
  }
  if (!networkAllowed) lines.push('(deny network*)');
  return lines.join('');
}

export function createMcpSpawnPlan(rawConfig: McpServerConfig, runtime: McpSandboxRuntime): McpSpawnPlan {
  const config = normalizeMcpServerConfig(rawConfig, rawConfig.id);
  if (config.transport !== 'stdio') throw new Error('Only stdio MCP servers use a process sandbox.');

  const platform = runtime.platform || process.platform;
  const homeDir = path.resolve(runtime.homeDir || os.homedir());
  const tempDir = path.resolve(runtime.tempDir || os.tmpdir());
  const userDataDir = path.resolve(runtime.userDataDir);
  const runtimeHomeDir = path.resolve(runtime.runtimeHomeDir);
  const cwd = path.resolve(config.cwd || runtime.defaultCwd || runtimeHomeDir);
  const protectedPaths = protectedHostPaths(homeDir, userDataDir);
  const explicitReadPaths = uniqueCanonicalPaths(config.permissions?.readPaths || []);
  const writePaths = uniqueCanonicalPaths(config.permissions?.writePaths || []);
  const env = buildEnvironment(runtime.processEnv || process.env, config.env, runtimeHomeDir);
  const executableExists = runtime.executableExists || fs.existsSync;
  const commandPath = resolveCommandPath(config.command!, cwd, env, executableExists, platform);

  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`MCP cwd does not exist or is not a directory: ${cwd}`);
  }
  if (cwd === path.parse(cwd).root) {
    throw new Error('Secure MCP cwd cannot be the filesystem root.');
  }

  rejectPathInsideProtected('MCP cwd', cwd, protectedPaths);
  rejectPathInsideProtected('MCP runtime HOME', runtimeHomeDir, protectedPaths);
  rejectPathInsideProtected('MCP command', commandPath, protectedPaths);
  for (const readablePath of explicitReadPaths) {
    rejectProtectedGrantPath('MCP readable path', readablePath, protectedPaths);
    if (!fs.existsSync(readablePath)) {
      throw new Error(`MCP readable path does not exist: ${readablePath}`);
    }
  }
  for (const writablePath of writePaths) {
    rejectProtectedGrantPath('MCP writable path', writablePath, protectedPaths);
    if (!fs.existsSync(writablePath)) {
      throw new Error(`MCP writable path does not exist: ${writablePath}`);
    }
  }

  const allowedReadPaths = uniqueCanonicalPaths([
    cwd,
    commandSupportRoot(commandPath, homeDir),
    runtimeHomeDir,
    ...explicitReadPaths,
    ...writePaths
  ]);

  if (platform === 'darwin') {
    const sandboxExec = '/usr/bin/sandbox-exec';
    if (!executableExists(sandboxExec)) {
      throw new Error('Secure stdio MCP isolation is unavailable: macOS sandbox-exec was not found.');
    }
    const deniedReadRoots = minimalRootPaths([
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
    const profile = buildMacProfile(
      protectedPaths,
      deniedReadRoots,
      allowedReadPaths,
      canonicalPolicyPath(runtimeHomeDir).at(-1)!,
      writePaths,
      config.permissions?.network === true
    );
    return {
      command: sandboxExec,
      args: ['-p', profile, commandPath, ...(config.args || [])],
      cwd,
      env,
      isolation: 'macos-seatbelt',
      detached: true
    };
  }

  if (platform === 'win32') {
    if (!runtime.sandboxLauncherPath) {
      throw new Error('Secure stdio MCP isolation is unavailable: getssh-sandbox.exe was not found.');
    }
    if (/\.(?:bat|cmd)$/i.test(commandPath)) {
      throw new Error(
        'Secure Windows stdio MCP requires a native executable; configure node.exe with the JavaScript entry path instead of a .cmd or .bat shim.'
      );
    }
    const windowsWritePaths = uniqueCanonicalPaths([runtimeHomeDir, ...writePaths]);
    const windowsReadPaths = allowedReadPaths.filter(candidate =>
      !windowsWritePaths.some(writablePath => pathContains(writablePath, candidate))
    );
    const windowsDeniedPaths = protectedPaths.filter(candidate =>
      fs.existsSync(candidate) &&
      [...windowsReadPaths, ...windowsWritePaths].some(allowedPath => pathContains(allowedPath, candidate))
    );
    return createWindowsSandboxSpawnPlan({
      command: commandPath,
      args: config.args || [],
      cwd,
      env,
      readonlyPaths: windowsReadPaths,
      readwritePaths: windowsWritePaths,
      deniedPaths: windowsDeniedPaths,
      network: config.permissions?.network === true,
      allowChildProcesses: true,
      maxProcesses: 64
    }, {
      runtimeHomeDir,
      journalRootDir: userDataDir,
      sandboxLauncherPath: runtime.sandboxLauncherPath,
      processEnv: runtime.processEnv,
      executableExists
    });
  }

  throw new Error(`Secure stdio MCP isolation is unavailable on ${platform}; use an HTTP MCP server.`);
}
