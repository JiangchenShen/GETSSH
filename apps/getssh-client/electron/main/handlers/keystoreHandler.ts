import type { IpcMain } from 'electron';
import { DatabaseManager } from '../services/DatabaseManager';
import { appLock, type UnlockRequest } from '../security/appLock';
import { APP_SCOPE, isKeystoreError, keystore, toKeystoreError, workspaceScope } from '../security/keystore';
import { scopeOwnerDeps } from '../security/ownerChecks';
import { verifyOwner } from '../security/userPresence';
import { isValidWorkspaceId } from '../utils/workspaceId';
import { isKnownTopLevelSender, isMainWebContents } from '../windowRegistry';

/**
 * App lock, master password, recovery code, Touch ID / Windows Hello and workspace passwords.
 * Only the main window may change anything; passwords arrive here because the user just typed
 * them and are never stored outside the keystore.
 */

type Failure = { ok: false; error: string; retryAfterMs?: number };
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Result<T extends object = {}> = ({ ok: true } & T) | Failure;

const UNAUTHORIZED: Failure = { ok: false, error: 'unauthorized' };

function failure(error: unknown): Failure {
  const keystoreError = toKeystoreError(error);
  if (keystoreError.code === 'internal') console.error('[Keystore IPC]', error);
  return { ok: false, error: keystoreError.code, retryAfterMs: keystoreError.retryAfterMs };
}

function optionalPassword(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 ? value : undefined;
}

function requiredPassword(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 ? value : null;
}

/** Confirms the owner before changing a protected scope: its password or an OS check. */
async function confirmOwner(scope: string, currentPassword: unknown, reason: string): Promise<Failure | null> {
  const outcome = await verifyOwner({ password: optionalPassword(currentPassword), reason }, scopeOwnerDeps(scope));
  if (outcome === 'verified') return null;
  return { ok: false, error: outcome === 'password_required' ? 'current_password_required' : 'verification_failed' };
}

/** Moves every database the keystore just staged a new key for. */
async function applyStaged(scopes: string[]): Promise<void> {
  for (const scope of scopes) await DatabaseManager.completeRotation(scope);
}

function setWorkspacePasswordFlag(workspaceId: string, hasPassword: boolean): void {
  const workspace = DatabaseManager.getWorkspaces().find(entry => entry.id === workspaceId);
  if (!workspace) return;
  DatabaseManager.createWorkspace({ ...workspace, hasPassword: hasPassword ? 1 : 0, updated_at: Date.now() });
}

function isMainWorkspace(workspaceId: string): boolean {
  return !!DatabaseManager.getWorkspaces().find(entry => entry.id === workspaceId)?.is_main;
}

function publicStatus() {
  const status = keystore.status();
  return {
    appProtected: status.appProtected,
    recoveryConfigured: status.recoveryConfigured,
    presenceSupported: status.presenceSupported,
    deviceBackend: status.quietBackend ?? null,
    scopes: status.scopes.map(scope => ({
      id: scope.id,
      workspaceId: scope.id === APP_SCOPE ? null : scope.id.slice('ws:'.length),
      protected: scope.protected,
      ownPassword: scope.ownPassword,
      presence: scope.presence,
      unlocked: scope.unlocked,
      recovery: scope.recovery,
      revealRemainingMs: scope.revealRemainingMs ?? null,
    })),
  };
}

export function registerKeystoreHandlers(ipcMain: IpcMain) {
  ipcMain.handle('app-lock:state', event => {
    if (!isKnownTopLevelSender(event)) return null;
    return appLock.state();
  });

  ipcMain.handle('app-lock:unlock', async (event, request: unknown): Promise<Result> => {
    if (!isMainWebContents(event.sender)) return UNAUTHORIZED;
    const body = (request ?? {}) as Record<string, unknown>;
    let parsed: UnlockRequest;
    if (body.method === 'password' && requiredPassword(body.password)) {
      parsed = { method: 'password', password: body.password as string };
    } else if (body.method === 'presence') {
      parsed = { method: 'presence' };
    } else if (body.method === 'recovery' && typeof body.code === 'string' && body.code.length <= 128) {
      parsed = { method: 'recovery', code: body.code };
    } else {
      return { ok: false, error: 'invalid_argument' };
    }
    return appLock.unlock(parsed);
  });

  ipcMain.handle('app-lock:lock', event => {
    if (!isKnownTopLevelSender(event)) return false;
    appLock.lock('requested');
    return true;
  });

  // Confirms the person at the keyboard before a sensitive action in the active workspace
  // (high-risk runbooks): Touch ID / Windows Hello first, its password where the OS has no check.
  ipcMain.handle('security:verify-owner', async (event, request: unknown): Promise<Result> => {
    if (!isMainWebContents(event.sender) || !appLock.isReady()) return UNAUTHORIZED;
    const { reason, password } = (request ?? {}) as Record<string, unknown>;
    const text = typeof reason === 'string' && reason.length > 0 && reason.length <= 200 ? reason : 'confirm this action';
    const { getActiveWorkspaceId } = require('./workspaceHandler');
    const denied = await confirmOwner(workspaceScope(getActiveWorkspaceId()), password, text);
    return denied ?? { ok: true };
  });

  ipcMain.handle('security:status', event => {
    if (!isMainWebContents(event.sender) || !appLock.isReady()) return null;
    return publicStatus();
  });

  ipcMain.handle('security:set-master-password', async (event, request: unknown): Promise<Result<{ recoveryReset: boolean }>> => {
    if (!isMainWebContents(event.sender) || !appLock.isReady()) return UNAUTHORIZED;
    const { password, currentPassword } = (request ?? {}) as Record<string, unknown>;
    const next = requiredPassword(password);
    if (!next) return { ok: false, error: 'invalid_argument' };
    try {
      const hadMaster = keystore.status().appProtected;
      if (hadMaster) {
        const denied = await confirmOwner(APP_SCOPE, currentPassword, 'change the GETSSH master password');
        if (denied) return denied;
      }
      await applyStaged(await keystore.setPassword(APP_SCOPE, next));
      appLock.notifyChanged();
      return { ok: true, recoveryReset: !hadMaster };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('security:remove-master-password', async (event, request: unknown): Promise<Result> => {
    if (!isMainWebContents(event.sender) || !appLock.isReady()) return UNAUTHORIZED;
    const { currentPassword } = (request ?? {}) as Record<string, unknown>;
    try {
      const denied = await confirmOwner(APP_SCOPE, currentPassword, 'remove the GETSSH master password');
      if (denied) return denied;
      await applyStaged(await keystore.removePassword(APP_SCOPE));
      appLock.notifyChanged();
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });

  /**
   * Creates or replaces the recovery code. Without a master password anyone at the computer may
   * use GETSSH, but replacing the code would silently invalidate the owner's copy, so the OS check
   * is asked for wherever the OS offers one.
   */
  ipcMain.handle('security:setup-recovery', async (event, request: unknown): Promise<Result<{ code: string }>> => {
    if (!isMainWebContents(event.sender) || !appLock.isReady()) return UNAUTHORIZED;
    const { currentPassword } = (request ?? {}) as Record<string, unknown>;
    try {
      const status = keystore.status();
      if (status.appProtected) {
        const denied = await confirmOwner(APP_SCOPE, currentPassword, 'create a new GETSSH recovery code');
        if (denied) return denied;
      } else if (status.presenceSupported) {
        await keystore.verifyPresence('create a new GETSSH recovery code');
      }
      const code = await keystore.setupRecovery();
      appLock.notifyChanged();
      return { ok: true, code };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('security:set-presence', async (event, request: unknown): Promise<Result> => {
    if (!isMainWebContents(event.sender) || !appLock.isReady()) return UNAUTHORIZED;
    const { workspaceId, enabled } = (request ?? {}) as Record<string, unknown>;
    if (workspaceId !== null && workspaceId !== undefined && !isValidWorkspaceId(workspaceId)) {
      return { ok: false, error: 'invalid_argument' };
    }
    const scope = typeof workspaceId === 'string' ? workspaceScope(workspaceId) : APP_SCOPE;
    try {
      if (enabled === true) {
        await keystore.enablePresence(scope, scope === APP_SCOPE ? 'turn on Touch ID for GETSSH' : 'turn on Touch ID for this workspace');
      } else {
        await keystore.disablePresence(scope);
      }
      appLock.notifyChanged();
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('workspace:set-password', async (event, request: unknown): Promise<Result> => {
    if (!isMainWebContents(event.sender) || !appLock.isReady()) return UNAUTHORIZED;
    const { workspaceId, password, currentPassword } = (request ?? {}) as Record<string, unknown>;
    const next = requiredPassword(password);
    if (!isValidWorkspaceId(workspaceId) || !next) return { ok: false, error: 'invalid_argument' };
    const scope = workspaceScope(workspaceId);
    try {
      const status = keystore.status();
      // Without a master password the main workspace stays open to whoever uses this computer.
      if (!status.appProtected && isMainWorkspace(workspaceId)) return { ok: false, error: 'main_workspace_needs_master_password' };
      const entry = status.scopes.find(s => s.id === scope);
      if (entry?.ownPassword) {
        const denied = await confirmOwner(scope, currentPassword, 'change the workspace password');
        if (denied) return denied;
      }
      if ((await DatabaseManager.openWorkspace(workspaceId)) !== 'open') return { ok: false, error: 'locked' };
      await applyStaged(await keystore.setPassword(scope, next));
      setWorkspacePasswordFlag(workspaceId, true);
      appLock.notifyChanged();
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('workspace:remove-password', async (event, request: unknown): Promise<Result> => {
    if (!isMainWebContents(event.sender) || !appLock.isReady()) return UNAUTHORIZED;
    const { workspaceId, currentPassword } = (request ?? {}) as Record<string, unknown>;
    if (!isValidWorkspaceId(workspaceId)) return { ok: false, error: 'invalid_argument' };
    const scope = workspaceScope(workspaceId);
    try {
      const denied = await confirmOwner(scope, currentPassword, 'remove the workspace password');
      if (denied) return denied;
      if (!keystore.status().scopes.find(s => s.id === scope)?.unlocked) return { ok: false, error: 'locked' };
      if ((await DatabaseManager.openWorkspace(workspaceId)) !== 'open') return { ok: false, error: 'locked' };
      await applyStaged(await keystore.removePassword(scope));
      setWorkspacePasswordFlag(workspaceId, false);
      appLock.notifyChanged();
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('workspace:unlock', async (event, request: unknown): Promise<Result> => {
    if (!isMainWebContents(event.sender) || !appLock.isReady()) return UNAUTHORIZED;
    const { workspaceId, method, password } = (request ?? {}) as Record<string, unknown>;
    if (!isValidWorkspaceId(workspaceId)) return { ok: false, error: 'invalid_argument' };
    try {
      if ((await DatabaseManager.openWorkspace(workspaceId)) === 'open') return { ok: true };
      let unlocked: boolean;
      if (method === 'presence') {
        unlocked = await DatabaseManager.unlockWorkspaceWithPresence(workspaceId, 'unlock this GETSSH workspace');
      } else {
        const typed = requiredPassword(password);
        if (!typed) return { ok: false, error: 'invalid_argument' };
        unlocked = await DatabaseManager.unlockWorkspaceWithPassword(workspaceId, typed);
        if (!unlocked) return { ok: false, error: 'wrong_password' };
      }
      appLock.notifyChanged();
      return unlocked ? { ok: true } : { ok: false, error: 'locked' };
    } catch (error) {
      if (isKeystoreError(error, 'wrong_password')) return { ok: false, error: 'wrong_password' };
      return failure(error);
    }
  });

  ipcMain.handle('workspace:lock', (event, workspaceId: unknown) => {
    if (!isMainWebContents(event.sender) || !isValidWorkspaceId(workspaceId)) return false;
    try {
      keystore.lockScope(workspaceScope(workspaceId));
      DatabaseManager.closeLockedDatabases();
      appLock.notifyChanged();
      return true;
    } catch {
      return false;
    }
  });
}
