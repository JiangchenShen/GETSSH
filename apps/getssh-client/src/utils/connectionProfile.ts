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
