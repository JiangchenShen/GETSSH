export interface SysmonData {
  cpus: any[]; // Using array of OS CPU objects
  mem: { total: number; free: number };
}

export interface OsFingerprintData {
  host: string;
  username: string;
  osType: string;
  sessionId?: string;
}

export interface HostVerificationData {
  requestId: string;
  hostname: string;
  fingerprint: string;
  isChanged?: boolean;
  oldFingerprint?: string;
}

export interface BackendConfig {
  confirmQuit?: boolean;
  globalHotkey?: string;
  pluginSecurityMode?: 'safe' | 'strict' | 'normal' | 'developer';
}

export interface ExportPayload {
  sessions: any[];
  masterPassword?: string;
}

export interface ImportPayload {
  masterPassword?: string;
}

export interface WatchdogStatus {
  status: 'secure' | 'warning';
  lastPing: number;
  watchdogDisabled?: boolean;
}

export interface SshConnectConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  sessionId?: string;
  useKeepAlive?: boolean;
  proxyType?: 'none' | 'socks5' | 'http';
  proxyHost?: string;
  proxyPort?: number;
}

export interface UIExtensionAction {
  pluginId: string;
  actionId: string;
  label: string;
  target: 'terminal' | 'sftp';
}

export interface UIExtensionSyncPayload {
  terminal: UIExtensionAction[];
  sftp: UIExtensionAction[];
}

export interface ContextMenuTriggerPayload {
  target: 'terminal' | 'sftp';
  extensions: UIExtensionAction[];
  contextData: any;
}
