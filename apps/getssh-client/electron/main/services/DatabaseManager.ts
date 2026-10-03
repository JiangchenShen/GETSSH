import type {
  AiMemoryMessage,
  AiMemoryVector,
  AiMessage,
  AiSession,
  AssetFolderSnapshot,
  AuditLog,
  Profile,
  ProfileInput,
  Runbook,
  StoreErrorCode,
  Workspace,
  WorkspaceStats,
} from '../../../../../rust-core/getssh-store/store';
import { getStore, storeBaseDir, toStoreError } from './getsshStore';

/**
 * The main process's data access, on getssh-store (docs/GETSSH_STORE_DESIGN_CN.md). Every
 * database, key and SQL statement lives in Rust now; this class keeps the method names the
 * handlers and services already use, and their old answers for a locked workspace (empty lists,
 * writes that do nothing) where callers rely on them.
 */

export type { AssetFolderSnapshot, Workspace, WorkspaceStats };
export type AiMemoryVectorRow = AiMemoryVector;
export type AiMemoryMessageRow = AiMemoryMessage;

/**
 * A profile as the renderer receives it: no password, passphrase or key, only hasPassword /
 * hasPassphrase. Connecting by profile id takes the credentials from the store in the main
 * process (services/savedConnection.ts).
 */
export interface ProfileRow extends Omit<Profile, 'group'> {
  group?: string;
}

/** What callers save: the renderer's profile objects, checked field by field in saveProfiles(). */
export type ProfileRowInput = { id: string } & Record<string, unknown>;

const PROTOCOLS = new Set(['ssh', 'local', 'telnet', 'auto']);
const AUTH_TYPES = new Set(['password', 'key', 'agent']);

/** Errors that mean "this workspace is not open now" for callers that read it anyway. */
const NOT_OPEN: StoreErrorCode[] = ['locked', 'not_found', 'needs_password', 'not_configured'];

function notOpen(error: unknown): boolean {
  return NOT_OPEN.includes(toStoreError(error).code);
}

/** A read that answers `fallback` while the workspace (or the app) is locked. */
function readOr<T>(fallback: T, read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (notOpen(error)) return fallback;
    throw error;
  }
}

/** A write that does nothing while the workspace (or the app) is locked, as before. */
function writeIfOpen(write: () => void): void {
  try {
    write();
  } catch (error) {
    if (!notOpen(error)) throw error;
  }
}

/** Folder errors are shown to the user as they are: a sentence, not a store code. */
function folderError(error: unknown): Error {
  const failure = toStoreError(error);
  if (failure.code === 'locked' || failure.code === 'needs_password') return new Error('Workspace is locked. Unlock it first.');
  const detail = failure.detail || failure.code;
  return new Error(detail.charAt(0).toUpperCase() + detail.slice(1));
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function flag(value: unknown): boolean {
  return value === true || value === 1;
}

/** undefined keeps the stored secret, '' and null clear it, any other string replaces it. */
function secret(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function port(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 65535 ? n : undefined;
}

/** Display order of the folder tree: the user's language, as DatabaseManager sorted before 3.0. */
function sortFolders(folders: string[]): string[] {
  return [...folders].sort((a, b) => a.localeCompare(b));
}

function sortSnapshot(snapshot: AssetFolderSnapshot): AssetFolderSnapshot {
  return { folders: sortFolders(snapshot.folders), memberships: snapshot.memberships };
}

export class DatabaseManager {
  public static getBaseDir(): string {
    return storeBaseDir();
  }

  // --- Workspaces ---

  /** Every workspace, oldest first; empty while the app is locked. */
  public static getWorkspaces(): Workspace[] {
    return readOr([], () => getStore().listWorkspaces());
  }

  public static getWorkspace(workspaceId: string): Workspace | undefined {
    return this.getWorkspaces().find(workspace => workspace.id === workspaceId);
  }

  /** Creates a workspace (its key and its encrypted database). A password is set afterwards. */
  public static createWorkspace(input: { id: string; name: string; themeColor?: string }): Promise<Workspace> {
    return getStore().createWorkspace(input);
  }

  /** Creates the workspace unless it is already listed. */
  public static async ensureWorkspace(input: { id: string; name: string; themeColor?: string }): Promise<void> {
    if (!this.getWorkspace(input.id)) await this.createWorkspace(input);
  }

  /** Deletes the database, the key scope and the workspace's folder. The MAIN workspace cannot be deleted. */
  public static deleteWorkspace(workspaceId: string): Promise<void> {
    return getStore().deleteWorkspace(workspaceId);
  }

  public static setMainWorkspace(workspaceId: string): void {
    getStore().setMainWorkspace(workspaceId);
  }

  public static updateWorkspacePreferences(workspaceId: string, preferences: string): void {
    getStore().updateWorkspace(workspaceId, { preferences });
  }

  /**
   * Opens a workspace that needs no password (none of its own, or the master password already
   * opened it). 'legacy' is a pre-3.0 workspace whose password has to be typed once to move it.
   */
  public static async openWorkspace(workspaceId: string): Promise<'open' | 'locked' | 'legacy'> {
    try {
      return await getStore().openWorkspace(workspaceId);
    } catch (error) {
      if (toStoreError(error).code === 'needs_password') return 'legacy';
      throw error;
    }
  }

  public static isWorkspaceOpen(workspaceId: string): boolean {
    return this.getWorkspace(workspaceId)?.state === 'open';
  }

  /** Unlocks with the workspace's own password (a pre-3.0 workspace moves here). False for a wrong password. */
  public static async unlockWorkspaceWithPassword(workspaceId: string, password: string): Promise<boolean> {
    try {
      await getStore().unlockWorkspace(workspaceId, { password });
      return true;
    } catch (error) {
      if (toStoreError(error).code === 'wrong_password') return false;
      throw error;
    }
  }

  /** Touch ID / Windows Hello; throws StoreError (cancelled, needs_password, unavailable) when it does not verify. */
  public static async unlockWorkspaceWithPresence(workspaceId: string, reason: string): Promise<boolean> {
    await getStore().unlockWorkspace(workspaceId, { presence: reason });
    return true;
  }

  public static lockWorkspace(workspaceId: string): void {
    getStore().lockWorkspace(workspaceId);
  }

  public static getWorkspaceStats(workspaceId: string): WorkspaceStats {
    return getStore().workspaceStats(workspaceId);
  }

  // --- Global settings ---

  public static getGlobalSetting(key: string): string | null {
    return readOr(null, () => getStore().getGlobalSetting(key));
  }

  public static setGlobalSetting(key: string, value: string): void {
    writeIfOpen(() => getStore().setGlobalSetting(key, value));
  }

  // --- Profiles ---

  /** The workspace's profiles, without credentials. Empty while the workspace is locked. */
  public static getProfiles(workspaceId: string): ProfileRow[] {
    const profiles = readOr<Profile[]>([], () => getStore().listProfiles(workspaceId));
    return profiles.map(({ group, ...profile }) => ({ ...profile, group: group ?? undefined }));
  }

  /**
   * Replaces the workspace's profiles with `rows`. A password or passphrase that is undefined is
   * kept, '' or null clears it. Silently does nothing while the workspace is locked, as before.
   */
  public static saveProfiles(workspaceId: string, rows: ProfileRowInput[]): void {
    const store = getStore();
    writeIfOpen(() => {
      // The renderer does not know about stored SSH keys yet: a row without keyId keeps its key.
      const keyIds = new Map(store.listProfiles(workspaceId).map(profile => [profile.id, profile.keyId]));
      const inputs: ProfileInput[] = rows.map(row => ({
        id: String(row.id),
        host: typeof row.host === 'string' ? row.host : '',
        username: typeof row.username === 'string' ? row.username : '',
        port: port(row.port) ?? 22,
        protocol: (PROTOCOLS.has(row.protocol as string) ? row.protocol : 'ssh') as ProfileInput['protocol'],
        authType: (AUTH_TYPES.has(row.authType as string) ? row.authType : 'password') as ProfileInput['authType'],
        alias: text(row.alias),
        osType: text(row.osType),
        groupName: text(row.groupName) ?? text(row.group) ?? text(row.groupId),
        autoStart: flag(row.autoStart),
        useKeepAlive: !(row.useKeepAlive === false || row.useKeepAlive === 0),
        strictHostKeyChecking: flag(row.strictHostKeyChecking),
        proxyJump: text(row.proxyJump),
        initialDirectory: text(row.initialDirectory),
        postConnectScript: text(row.postConnectScript),
        themeOverride: text(row.themeOverride),
        keyId: row.keyId === undefined ? keyIds.get(String(row.id)) ?? null : text(row.keyId),
        privateKeyPath: text(row.privateKeyPath),
        password: secret(row.password),
        passphrase: secret(row.passphrase),
      }));
      store.saveProfiles(workspaceId, inputs);
    });
  }

  // --- Asset folders (never on a locked workspace) ---

  private static folders<T>(run: () => T): T {
    try {
      return run();
    } catch (error) {
      throw folderError(error);
    }
  }

  public static getAssetFolders(workspaceId: string): string[] {
    return this.folders(() => sortFolders(getStore().getAssetFolders(workspaceId)));
  }

  public static createAssetFolder(workspaceId: string, folderPath: string): AssetFolderSnapshot {
    return this.folders(() => sortSnapshot(getStore().createAssetFolder(workspaceId, folderPath)));
  }

  public static renameAssetFolder(workspaceId: string, folderPath: string, newName: string): AssetFolderSnapshot {
    return this.folders(() => sortSnapshot(getStore().renameAssetFolder(workspaceId, folderPath, newName)));
  }

  public static removeAssetFolder(workspaceId: string, folderPath: string): AssetFolderSnapshot {
    return this.folders(() => sortSnapshot(getStore().removeAssetFolder(workspaceId, folderPath)));
  }

  public static moveProfileToAssetFolder(workspaceId: string, profileId: string, folderPath: string | null): AssetFolderSnapshot {
    return this.moveProfilesToAssetFolder(workspaceId, [profileId], folderPath);
  }

  public static moveProfilesToAssetFolder(workspaceId: string, profileIds: string[], folderPath: string | null): AssetFolderSnapshot {
    return this.folders(() => sortSnapshot(getStore().moveProfilesToAssetFolder(workspaceId, profileIds, folderPath)));
  }

  // --- Runbooks ---

  public static getRunbooks(workspaceId: string): Runbook[] {
    return readOr([], () => getStore().getRunbooks(workspaceId));
  }

  public static saveRunbooks(workspaceId: string, runbooks: Array<Partial<Runbook> & { id: string; title: string; script: string }>): void {
    writeIfOpen(() => getStore().saveRunbooks(workspaceId, runbooks.map(runbook => ({
      id: runbook.id,
      title: runbook.title,
      script: runbook.script,
      riskLevel: runbook.riskLevel || 'LOW',
      created_at: runbook.created_at || Date.now(),
    }))));
  }

  // --- AI chats ---

  public static getAiSessions(workspaceId: string): AiSession[] {
    return readOr([], () => getStore().getAiSessions(workspaceId));
  }

  public static createAiSession(workspaceId: string, id: string, title: string, timestamp: number): void {
    writeIfOpen(() => getStore().createAiSession(workspaceId, id, title, timestamp));
  }

  public static saveAiMessage(workspaceId: string, message: Omit<AiMessage, 'raw_content'> & { raw_content?: string | null }): void {
    writeIfOpen(() => getStore().saveAiMessage(workspaceId, { ...message, raw_content: message.raw_content || null }));
  }

  public static updateAiSessionTitle(workspaceId: string, id: string, title: string): void {
    writeIfOpen(() => getStore().updateAiSessionTitle(workspaceId, id, title));
  }

  public static deleteAiSession(workspaceId: string, id: string): void {
    writeIfOpen(() => getStore().deleteAiSession(workspaceId, id));
  }

  // --- Encrypted local semantic memory (main.db) ---

  public static isEncryptedAiMemoryAvailable(): boolean {
    try {
      return getStore().isEncryptedAiMemoryAvailable();
    } catch {
      return false;
    }
  }

  public static upsertAiMemoryVector(row: AiMemoryVectorRow): void {
    writeIfOpen(() => getStore().upsertAiMemoryVector(row));
  }

  public static deleteAiMemoryMessage(workspaceId: string, messageId: string): void {
    writeIfOpen(() => getStore().deleteAiMemoryMessage(workspaceId, messageId));
  }

  public static deleteAiMemorySession(workspaceId: string, sessionId: string): void {
    writeIfOpen(() => getStore().deleteAiMemorySession(workspaceId, sessionId));
  }

  public static getAiMemoryVectors(workspaceId: string, limit: number, excludeSessionId?: string): AiMemoryVectorRow[] {
    return readOr([], () => getStore().getAiMemoryVectors(workspaceId, limit, excludeSessionId));
  }

  public static getRecentAiMessagesForMemory(workspaceId: string, limit: number): AiMemoryMessageRow[] {
    return readOr([], () => getStore().getRecentAiMessagesForMemory(workspaceId, limit));
  }

  public static getAiMessagesByIds(workspaceId: string, messageIds: string[]): AiMemoryMessageRow[] {
    if (messageIds.length === 0) return [];
    return readOr([], () => getStore().getAiMessagesByIds(workspaceId, messageIds));
  }

  // --- Audit log ---

  /** Never fails: a missing audit entry must not stop the action it records. */
  public static logAudit(workspaceId: string, action: string, target?: string, details?: string): void {
    try {
      getStore().logAudit(workspaceId, action, target, details);
    } catch {}
  }

  public static getAuditLogs(workspaceId: string, limit = 50): AuditLog[] {
    try {
      return getStore().getAuditLogs(workspaceId, limit);
    } catch {
      return [];
    }
  }
}
