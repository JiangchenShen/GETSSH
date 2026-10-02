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

export interface BackendConfigUpdateResult {
  success: boolean;
  effectiveConfig: BackendConfig;
  error?: string;
  /** Why a plugin-mode change was refused: no Touch ID, so the master password is needed; or the check failed. */
  verification?: 'password_required' | 'denied';
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
  protocol?: 'ssh' | 'local' | 'telnet' | 'auto';
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  alias?: string;
  sessionId?: string;
  keepaliveInterval?: number;
  proxyType?: 'none' | 'socks5' | 'http';
  proxyHost?: string;
  proxyPort?: number;
  strictHostKeyChecking?: boolean;
  initialDirectory?: string;
  postConnectScript?: string;
  themeOverride?: string;
  enableAuditLogging?: boolean;
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

/** Keystore IPC results. `error` is a keystore code such as wrong_password, cancelled, locked. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type KeystoreResult<T extends object = {}> = ({ ok: true } & T) | { ok: false; error: string; retryAfterMs?: number };

export interface KeystoreMigrationReport {
  migratedWorkspaces: string[];
  deferredWorkspaces: string[];
  presenceToReenable: string[];
  failedWorkspaces: string[];
}

export interface AppLockState {
  phase: 'starting' | 'locked' | 'ready' | 'error';
  appProtected: boolean;
  presenceSupported: boolean;
  presenceEnabled: boolean;
  recoveryConfigured: boolean;
  deviceKeyLost: boolean;
  /** Show a blocking "change your master password" dialog (a pre-3.0 master password under 12 characters). */
  masterPasswordMustChange: boolean;
  error?: string;
  migration?: KeystoreMigrationReport;
}

export interface SecurityScopeStatus {
  id: string;
  workspaceId: string | null;
  protected: boolean;
  ownPassword: boolean;
  presence: boolean;
  unlocked: boolean;
  recovery: boolean;
  revealRemainingMs: number | null;
}

export interface SecurityStatus {
  appProtected: boolean;
  recoveryConfigured: boolean;
  presenceSupported: boolean;
  deviceBackend: string | null;
  scopes: SecurityScopeStatus[];
}
