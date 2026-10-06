import type { AppConfig } from '../store/appStore';
import type { SessionProfile, SSHConnectConfig } from '../store/sessionStore';

const quoteShellArg = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

export const buildStartupCommand = (session: Partial<SessionProfile>) => [
  session.initialDirectory?.trim() ? `cd -- ${quoteShellArg(session.initialDirectory.trim())}` : '',
  session.postConnectScript?.trim() || '',
].filter(Boolean).join('\n');

export const buildConnectionConfig = (session: Partial<SessionProfile>, appConfig: AppConfig): SSHConnectConfig => {
  const protocol = session.protocol === 'auto' ? 'ssh' : (session.protocol || 'ssh');
  return {
    host: session.host || '',
    username: session.username || '',
    password: session.password,
    privateKeyPath: session.privateKeyPath,
    passphrase: session.passphrase,
    port: session.port || (protocol === 'telnet' ? 23 : appConfig.defaultPort || 22),
    keepaliveInterval: session.useKeepAlive !== false ? appConfig.keepalive * 1000 : 0,
    protocol,
    proxyType: appConfig.proxyType,
    proxyHost: appConfig.proxyHost,
    proxyPort: appConfig.proxyPort,
    initScript: appConfig.initScript,
    alias: session.alias,
    strictHostKeyChecking: session.strictHostKeyChecking,
    initialDirectory: session.initialDirectory,
    postConnectScript: session.postConnectScript,
    themeOverride: session.themeOverride,
  };
};

/**
 * Pane configs go to tidal-engine, which keeps them in global state and broadcasts them to every window.
 * They must never carry credentials: use this for every tidalRegisterTab / tidalReplacePane configJson
 * and for local paneTree leaf configs. Credentials stay in the vault and in the main process.
 */
export const stripConnectionSecrets = <T extends object | null>(config: T): T => {
  if (!config || typeof config !== 'object') return config;
  if (!('password' in config) && !('passphrase' in config)) return config;
  const { password: _password, passphrase: _passphrase, ...rest } = config as T & { password?: unknown; passphrase?: unknown };
  return rest as T;
};
