// getssh-store: the native data layer of GETSSH 3.0 (Rust, N-API). FROZEN INTERFACE — see
// docs/GETSSH_STORE_DESIGN_CN.md §4. Change this file only after the design document changes.
//
// Rules every caller relies on:
// - Only the Electron main process loads this module. Nothing returned by a function marked
//   "main process only" may be sent to a renderer over IPC.
// - No function returns a database key. No read function returns a password, passphrase or
//   private key; the only exceptions are connectSecrets(), revealSecret() and getAppSecret().
// - Errors are thrown as Error objects whose message starts with "[store:<code>] ".
// - Synchronous functions are fast database reads and writes. Anything that runs Argon2,
//   rekeys a database, talks to Touch ID / Windows Hello or touches many files returns a Promise.
// - Row field names match the current SQLite columns (snake_case where the column is), so the
//   TypeScript DatabaseManager can delegate one to one.

export type StoreErrorCode =
  | 'not_configured' | 'locked' | 'needs_password' | 'wrong_password' | 'rate_limited'
  | 'not_found' | 'invalid_argument' | 'corrupt' | 'unavailable' | 'cancelled' | 'io'
  | 'busy' | 'rotation_pending' | 'must_change_master_password' | 'internal';

// ─────────────────────────────── lifecycle and app lock ───────────────────────────────

/**
 * What start() did with the workspaces. The first three lists are filled only by the start that
 * migrates the data of GETSSH 3.0 development builds (see LegacySecrets). An id appears in one
 * list at most (presenceToReenable aside): the first classification wins.
 */
export interface StartReport {
  /** Workspaces moved from the layout of GETSSH 3.0 development builds to the keystore during this start. */
  migratedWorkspaces: string[];
  /** Password workspaces of those builds whose password was not available (no vault.key, or it did not open the database): migrated when the password is typed. */
  deferredWorkspaces: string[];
  /** Migrated workspaces that had Touch ID / Windows Hello in those builds: it must be enabled again. */
  presenceToReenable: string[];
  /** Workspaces whose database could not be moved or opened; they are skipped, not deleted. */
  failedWorkspaces: string[];
}

/**
 * What only Electron can decrypt (safeStorage) in the ~/.getssh layout of GETSSH 3.0 development
 * builds. Added after the freeze (10-03), with needsLegacyMigration() and start(legacy).
 */
export interface LegacySecrets {
  /** app_key.enc, decrypted: 64 hex characters. Required when app_key.enc exists, ignored otherwise. */
  appKey?: string;
  /** workspaces/<id>/vault.key, decrypted, by workspace id. Used while that vault.key exists; leave out the files that could not be decrypted (those workspaces are deferred). */
  workspacePasswords?: Record<string, string>;
}

export interface AppState {
  phase: 'locked' | 'ready';
  masterPassword: boolean;
  /**
   * The app was unlocked with a master password shorter than 12 characters (set before 3.0).
   * The renderer must show a blocking "change your master password" dialog; until it is
   * changed, exportBundle() and setMasterPassword(…) without `current` refuse with
   * must_change_master_password.
   */
  masterPasswordMustChange: boolean;
  presenceSupported: boolean;
  presenceEnabled: boolean;
  recoveryConfigured: boolean;
  /** The device key for unprotected data is gone (new computer, wiped TPM / Keychain). */
  deviceKeyLost: boolean;
  /** 'secure-enclave' | 'keychain' | 'tpm' | 'dpapi' | 'unsupported' */
  deviceBackend: string;
}

export type UnlockRoute =
  | { password: string }
  | { presence: string }          // the reason shown in the Touch ID / Windows Hello prompt
  | { recoveryCode: string };

/**
 * Points the store at the data directory (normally ~/.getssh). Call once, before anything else.
 * `appVersion` (app.getVersion()) is written into export bundles; added after the freeze,
 * optional, so older callers keep working.
 */
export function configure(baseDir: string, appVersion?: string): void;
/**
 * Whether the data directory still holds data of GETSSH 3.0 development builds, or a migration
 * of it was interrupted. Call after configure(); when true, decrypt LegacySecrets and pass them
 * to start(). Only checks which files exist.
 */
export function needsLegacyMigration(): boolean;
/**
 * Opens everything that needs no password. While needsLegacyMigration() is true, `legacy` is
 * required (without it: unavailable) and the old data is migrated first: backed up to
 * ~/.getssh/.keystore-migration-backup, moved, and the backup deleted. If the migration fails,
 * the old files are restored and start() fails; the next start tries again. A getssh.db that was
 * never split is kept, with the app key that opens it, in ~/.getssh/.pre-keystore-kept. Under a
 * master password nothing is migrated (it was set after a finished start): what is left is moved
 * to .pre-keystore-kept and start() goes on to the locked state. `legacy` is checked on every
 * call: an appKey that is not 64 hex characters fails with invalid_argument; a workspacePasswords
 * entry with an invalid id or an empty password is left out.
 */
export function start(legacy?: LegacySecrets): Promise<StartReport>;
export function appState(): AppState;
export function unlockApp(route: UnlockRoute): Promise<AppState>;
/** Drops every key that a password protects and closes those databases. */
export function lockApp(reason: 'manual' | 'idle' | 'screen-locked' | 'sleep'): void;

// ───────────────────────── master password, presence, recovery ─────────────────────────

/** `current` is required when a master password already exists. At least 12 characters. */
export function setMasterPassword(password: string, current?: string): Promise<{ recoveryReset: boolean }>;
export function removeMasterPassword(current: string): Promise<void>;
/** Enables or disables Touch ID / Windows Hello for the app, and for workspaces that have a password. */
export function setPresence(enabled: boolean, reason: string): Promise<void>;
/** Returns the new recovery code; it is shown once and never stored. */
export function createRecoveryCode(current?: string): Promise<string>;
export function removeRecoveryCode(): Promise<void>;
export function isRecoveryCodeWellFormed(code: string): boolean;
/** Owner checks before risky actions (high-risk runbooks, backend plugins, lockdown overrides). */
export function verifyPresence(reason: string): Promise<boolean>;
export function verifyPassword(password: string, workspaceId?: string): Promise<boolean>;

// ──────────────────────────────────── workspaces ────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  themeColor: string | null;
  is_main: boolean;
  /** Has its own password (only possible without a master password, never for MAIN). */
  hasPassword: boolean;
  presenceEnabled: boolean;
  state: 'open' | 'locked';
  preferences: string;            // JSON text
  created_at: number;
  updated_at: number;
}

export interface WorkspaceStats { size: number; profileCount: number; runbookCount: number }

export function listWorkspaces(): Workspace[];
/** `password` is refused while a master password exists (it already protects every workspace). */
export function createWorkspace(input: { id?: string; name: string; themeColor?: string; password?: string }): Promise<Workspace>;
export function updateWorkspace(id: string, changes: { name?: string; themeColor?: string | null; preferences?: string }): Workspace;
export function setMainWorkspace(id: string): void;
/** Deletes the database file and the key scope. The MAIN workspace cannot be deleted. */
export function deleteWorkspace(id: string): Promise<void>;
export function openWorkspace(id: string): Promise<'open' | 'locked'>;
export function unlockWorkspace(id: string, route: { password: string } | { presence: string }): Promise<void>;
/**
 * Unlocks several workspaces with one Touch ID / Windows Hello prompt (used before an export).
 * Workspaces without presence, or whose key could not be used, are reported in `failed` and
 * must be unlocked one by one with their password.
 */
export function unlockWorkspaces(ids: string[], reason: string): Promise<{ unlocked: string[]; failed: { id: string; code: StoreErrorCode }[] }>;
export function lockWorkspace(id: string): void;
export function setWorkspacePassword(id: string, password: string, current?: string): Promise<void>;
export function removeWorkspacePassword(id: string, current: string): Promise<void>;
export function workspaceStats(id: string): WorkspaceStats;

// ───────────────────────────── server profiles (no secrets) ─────────────────────────────

export interface Profile {
  id: string;
  workspace_id: string;
  host: string;
  username: string;
  port: number;
  protocol: 'ssh' | 'local' | 'telnet' | 'auto';
  authType: 'password' | 'key' | 'agent';
  alias: string | null;
  osType: string | null;
  groupName: string | null;
  /** Same value as groupName; kept because the renderer reads `group`. */
  group: string | null;
  autoStart: boolean;
  useKeepAlive: boolean;
  strictHostKeyChecking: boolean;
  proxyJump: string | null;
  initialDirectory: string | null;
  postConnectScript: string | null;
  themeOverride: string | null;
  /** A private key stored in GETSSH (see SSH keys below). */
  keyId: string | null;
  /** Transitional: a key file on disk; the UI offers to import it and delete the file. */
  privateKeyPath: string | null;
  hasPassword: boolean;
  hasPassphrase: boolean;
}

/**
 * Secret fields: `undefined` keeps the stored value, `null` clears it, a string replaces it.
 * Profiles missing from `inputs` are deleted (the same whole-list semantics as today).
 */
export interface ProfileInput extends Omit<Profile, 'workspace_id' | 'group' | 'hasPassword' | 'hasPassphrase'> {
  password?: string | null;
  passphrase?: string | null;
}

export function listProfiles(workspaceId: string): Profile[];
export function saveProfiles(workspaceId: string, inputs: ProfileInput[]): Profile[];
export function deleteProfiles(workspaceId: string, ids: string[]): void;
/** Copies profiles (and their runbooks when asked) into another workspace; secrets are re-sealed inside Rust. */
export function copyProfiles(fromWorkspaceId: string, toWorkspaceId: string, ids: string[], options?: { includeRunbooks?: boolean }): void;

// ─────────────────────────── secrets (main process only) ───────────────────────────

export interface ConnectSecrets {
  password?: Buffer;
  passphrase?: Buffer;
  /** From keyId, or read from privateKeyPath for profiles that still point at a file. */
  privateKey?: Buffer;
}
/** MAIN PROCESS ONLY. Hand the Buffers to ssh2, then fill(0) them once the handshake ends. */
export function connectSecrets(workspaceId: string, profileId: string): ConnectSecrets;

/** Opens a 5-minute sliding reveal window for one workspace (Touch ID / Hello first). */
export function openReveal(workspaceId: string, route: { presence: string } | { password: string }): Promise<void>;
/** MAIN PROCESS ONLY, and only while a reveal window is open; each call extends the window. */
export function revealSecret(workspaceId: string, profileId: string, field: 'password' | 'passphrase'): string;
export function closeReveal(workspaceId: string): void;

/** App-wide secrets: AI provider keys, plugin secrets, MCP server tokens (replaces safeStorage files). */
export function setAppSecret(name: string, value: string | null): void;
/** MAIN PROCESS ONLY. */
export function getAppSecret(name: string): Buffer | null;
export function listAppSecretNames(prefix?: string): string[];

// ───────────────────────────────── SSH keys (phase B) ─────────────────────────────────

export interface SshKey {
  id: string;
  name: string;
  algorithm: string;              // 'ed25519' | 'rsa-4096' | 'ecdsa-p256' …
  fingerprint: string;            // SHA256:…
  publicKey: string;              // OpenSSH one-line format
  hasPassphrase: boolean;
  created_at: number;
}
/** Accepts OpenSSH, PEM (PKCS#1 / PKCS#8) and PuTTY PPK. The original file is not touched. */
export function importSshKey(workspaceId: string, input: { name: string; data: Buffer; passphrase?: string }): SshKey;
export function generateSshKey(workspaceId: string, input: { name: string; algorithm: 'ed25519' }): SshKey;
export function listSshKeys(workspaceId: string): SshKey[];
export function deleteSshKey(workspaceId: string, id: string): void;

// ───────────────── other tables: one function per current DatabaseManager method ─────────────────

export function getGlobalSetting(key: string): string | null;
export function setGlobalSetting(key: string, value: string): void;

export interface AssetFolderSnapshot { folders: string[]; memberships: { id: string; group: string | null }[] }
export function getAssetFolders(workspaceId: string): string[];
export function createAssetFolder(workspaceId: string, folderPath: string): AssetFolderSnapshot;
export function renameAssetFolder(workspaceId: string, folderPath: string, newName: string): AssetFolderSnapshot;
export function removeAssetFolder(workspaceId: string, folderPath: string): AssetFolderSnapshot;
export function moveProfilesToAssetFolder(workspaceId: string, profileIds: string[], folderPath: string | null): AssetFolderSnapshot;

export interface Runbook { id: string; workspace_id: string; title: string; script: string; riskLevel: string; created_at: number }
export function getRunbooks(workspaceId: string): Runbook[];
export function saveRunbooks(workspaceId: string, runbooks: Omit<Runbook, 'workspace_id'>[]): void;

export interface AiMessage { id: string; session_id: string; role: string; content: string; raw_content: string | null; timestamp: number }
export interface AiSession { id: string; workspace_id: string; title: string; created_at: number; updated_at: number; messages: AiMessage[] }
export function getAiSessions(workspaceId: string): AiSession[];
export function createAiSession(workspaceId: string, id: string, title: string, timestamp: number): void;
export function saveAiMessage(workspaceId: string, message: AiMessage): void;
export function updateAiSessionTitle(workspaceId: string, id: string, title: string): void;
export function deleteAiSession(workspaceId: string, id: string): void;

export interface AiMemoryVector {
  workspace_id: string; message_id: string; session_id: string; role: 'user' | 'assistant';
  embedding: Buffer; dimensions: number; content_hash: string; timestamp: number;
}
export interface AiMemoryMessage { id: string; session_id: string; role: 'user' | 'assistant'; content: string; timestamp: number }
export function isEncryptedAiMemoryAvailable(): boolean;
export function upsertAiMemoryVector(row: AiMemoryVector): void;
/** At most 2000 rows, newest first. */
export function getAiMemoryVectors(workspaceId: string, limit: number, excludeSessionId?: string): AiMemoryVector[];
export function deleteAiMemoryMessage(workspaceId: string, messageId: string): void;
export function deleteAiMemorySession(workspaceId: string, sessionId: string): void;
/** At most 2000 rows, newest first; user and assistant messages only. */
export function getRecentAiMessagesForMemory(workspaceId: string, limit: number): AiMemoryMessage[];
/** At most 32 distinct ids. */
export function getAiMessagesByIds(workspaceId: string, messageIds: string[]): AiMemoryMessage[];

export interface AuditLog { id: string; workspace_id: string; action: string; target: string; details: string; created_at: number }
export function logAudit(workspaceId: string, action: string, target?: string, details?: string): void;
export function getAuditLogs(workspaceId: string, limit?: number): AuditLog[];

// ─────────────────────────────── export and import ───────────────────────────────

export interface ExportCandidate {
  id: string;
  name: string;
  is_main: boolean;
  state: 'open' | 'locked';
  /** How a locked workspace can be unlocked for the export. */
  unlockWith: Array<'presence' | 'password'>;
  profileCount: number;
}
/** The list the user picks from. Locked workspaces are listed too; unlock the chosen ones first. */
export function exportCandidates(): ExportCandidate[];

export interface ExportReport { path: string; workspaceIds: string[]; bytes: number }
/**
 * Writes an encrypted .getssh-backup with the chosen workspaces (and the app-wide data:
 * settings, AI memory of those workspaces, app secrets). Every chosen workspace must be open.
 * The password needs at least 12 characters; it opens everything in the bundle, including
 * workspaces that have their own password.
 */
export function exportBundle(path: string, password: string, workspaceIds: string[]): Promise<ExportReport>;

export interface BundleInfo {
  formatVersion: number;
  createdAt: number;
  appVersion: string;
  workspaces: { id: string; name: string; hasPassword: boolean }[];
}
/**
 * Reads the encrypted header after checking the password; changes nothing.
 * A wrong password and an edited header both give wrong_password; damage elsewhere gives corrupt.
 */
export function inspectBundle(path: string, password: string): Promise<BundleInfo>;
export interface ImportReport { workspaceIds: string[]; backupPath: string | null }
/**
 * 3.0 supports 'replace' only. The app must be unlocked (else locked). The whole bundle is
 * decrypted into a staging directory and every database is opened and integrity-checked before
 * anything moves; a wrong password or a damaged bundle (wrong_password / corrupt) leaves the
 * current data untouched. Then ~/.getssh is renamed to ~/.getssh-backup-<YYYYMMDD-HHMMSS>
 * (backupPath) and the staged data takes its place; plugins and other files the bundle does not
 * carry are copied over from the old directory.
 *
 * After it resolves, every store call fails with `unavailable`: relaunch the app
 * (app.relaunch(); app.exit()). The imported data keeps its own master password and workspace
 * passwords. Touch ID / Windows Hello and the recovery code are device-bound and are not carried:
 * offer to set them up again after the restart.
 * 'merge' is reserved for a later release.
 */
export function importBundle(path: string, password: string, mode: 'replace'): Promise<ImportReport>;
