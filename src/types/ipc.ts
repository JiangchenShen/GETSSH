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
}

export interface BackendConfig {
  confirmQuit?: boolean;
  globalHotkey?: string;
}

export interface ExportPayload {
  sessions: any[];
  masterPassword?: string;
}

export interface ImportPayload {
  masterPassword?: string;
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
