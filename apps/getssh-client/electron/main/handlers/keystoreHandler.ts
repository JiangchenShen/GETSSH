import type { IpcMain } from 'electron';
import { DatabaseManager } from '../services/DatabaseManager';
import { getStore, toStoreError } from '../services/getsshStore';
import { appLock, type UnlockRequest } from '../security/appLock';
import { workspaceOwnerDeps } from '../security/ownerChecks';
import { verifyOwner } from '../security/userPresence';
import { isValidWorkspaceId } from '../utils/workspaceId';
import { isKnownTopLevelSender, isMainWebContents } from '../windowRegistry';

/**
 * App lock, master password, recovery code, Touch ID / Windows Hello and workspace passwords, on
 * getssh-store. Only the main window may change anything; passwords arrive here because the user
 * just typed them and are never stored outside the store.
 */

type Failure = { ok: false; error: string; retryAfterMs?: number };
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Result<T extends object = {}> = ({ ok: true } & T) | Failure;

const UNAUTHORIZED: Failure = { ok: false, error: 'unauthorized' };

/**
 * The renderer's names: a missing current password is `current_password_required` (the settings
 * screen then shows that field); the rest are store codes.
 */
function failure(error: unknown): Failure {
  const storeError = toStoreError(error);
  if (storeError.code === 'internal') console.error('[Keystore IPC]', error);
  const code = storeError.code === 'needs_password' || storeError.code === 'must_change_master_password'
    ? 'current_password_required'
    : storeError.code;
  return { ok: false, error: code, retryAfterMs: storeError.retryAfterMs };
}

function optionalPassword(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 ? value : undefined;
}

function requiredPassword(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 ? value : null;
}

/** The store's names for the device key, as the settings screen knows them. */
const DEVICE_BACKENDS: Record<string, string | null> = {
  'secure-enclave': 'macos-se',
  keychain: 'macos-keychain',
  tpm: 'windows-tpm',
  dpapi: 'windows-dpapi',
  unsupported: null,
};

function publicStatus() {
  const store = getStore();
  const state = store.appState();
  const workspaces = store.listWorkspaces();
  return {
    appProtected: state.masterPassword,
    recoveryConfigured: state.recoveryConfigured,
    presenceSupported: state.presenceSupported,
    deviceBackend: DEVICE_BACKENDS[state.deviceBackend] ?? null,
    scopes: [
      {
        id: 'app',
        workspaceId: null,
        protected: state.masterPassword,
        ownPassword: state.masterPassword,
        presence: state.presenceEnabled,
        unlocked: state.phase === 'ready',
        recovery: state.recoveryConfigured,
        revealRemainingMs: null,
      },
      ...workspaces.map(workspace => ({
        id: `ws:${workspace.id}`,
        workspaceId: workspace.id,
        protected: state.masterPassword || workspace.hasPassword,
        ownPassword: workspace.hasPassword,
        presence: workspace.presenceEnabled,
        unlocked: workspace.state === 'open',
        // Without a master password the recovery code does not cover a workspace's own password.
        recovery: state.recoveryConfigured && !workspace.hasPassword,
        revealRemainingMs: null,
      })),
    ],
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
    const outcome = await verifyOwner({ password: optionalPassword(password), reason: text }, workspaceOwnerDeps(getActiveWorkspaceId()));
    if (outcome === 'verified') return { ok: true };
    return { ok: false, error: outcome === 'password_required' ? 'current_password_required' : 'verification_failed' };
  });

  ipcMain.handle('security:status', event => {
    if (!isMainWebContents(event.sender) || !appLock.isReady()) return null;
    return publicStatus();
  });

  // Setting the first master password needs nothing more (whoever is at the computer can open the
  // data anyway); changing it needs the current one, except right after a recovery-code unlock.
  ipcMain.handle('security:set-master-password', async (event, request: unknown): Promise<Result<{ recoveryReset: boolean }>> => {
    if (!isMainWebContents(event.sender) || !appLock.isReady()) return UNAUTHORIZED;
    const { password, currentPassword } = (request ?? {}) as Record<string, unknown>;
    const next = requiredPassword(password);
    if (!next) return { ok: false, error: 'invalid_argument' };
    try {
      const store = getStore();
      const hadMaster = store.appState().masterPassword;
      const { recoveryReset } = await store.setMasterPassword(next, optionalPassword(currentPassword));
      appLock.notifyChanged();
      // The first master password asks for a recovery code right away, as before.
      return { ok: true, recoveryReset: recoveryReset || !hadMaster };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('security:remove-master-password', async (event, request: unknown): Promise<Result> => {
    if (!isMainWebContents(event.sender) || !appLock.isReady()) return UNAUTHORIZED;
    const current = optionalPassword(((request ?? {}) as Record<string, unknown>).currentPassword);
    if (!current) return { ok: false, error: 'current_password_required' };
    try {
      await getStore().removeMasterPassword(current);
      appLock.notifyChanged();
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });

  /**
   * Creates or replaces the recovery code. With a master password the current one is required;
   * without one the store asks the OS to confirm the person where the OS can, because replacing
   * the code silently invalidates the owner's copy.
   */
  ipcMain.handle('security:setup-recovery', async (event, request: unknown): Promise<Result<{ code: string }>> => {
    if (!isMainWebContents(event.sender) || !appLock.isReady()) return UNAUTHORIZED;
    const current = optionalPassword(((request ?? {}) as Record<string, unknown>).currentPassword);
    try {
      const code = await getStore().createRecoveryCode(current);
      appLock.notifyChanged();
      return { ok: true, code };
    } catch (error) {
      return failure(error);
    }
  });

  // One switch for the app (with a master password) and every workspace that has its own password.
  ipcMain.handle('security:set-presence', async (event, request: unknown): Promise<Result> => {
    if (!isMainWebContents(event.sender) || !appLock.isReady()) return UNAUTHORIZED;
    const { workspaceId, enabled } = (request ?? {}) as Record<string, unknown>;
    if (workspaceId !== null && workspaceId !== undefined && !isValidWorkspaceId(workspaceId)) {
      return { ok: false, error: 'invalid_argument' };
    }
    try {
      await getStore().setPresence(enabled === true, 'turn on Touch ID for GETSSH');
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
    try {
      const store = getStore();
      // A master password protects every workspace; without one the main workspace stays open
      // to whoever uses this computer.
      if (store.appState().masterPassword) return { ok: false, error: 'master_password_protects_workspaces' };
      if (DatabaseManager.getWorkspace(workspaceId)?.is_main) return { ok: false, error: 'main_workspace_needs_master_password' };
      await store.setWorkspacePassword(workspaceId, next, optionalPassword(currentPassword));
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
    const current = optionalPassword(currentPassword);
    if (!current) return { ok: false, error: 'current_password_required' };
    try {
      await getStore().removeWorkspacePassword(workspaceId, current);
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
      if (method === 'presence') {
        await DatabaseManager.unlockWorkspaceWithPresence(workspaceId, 'unlock this GETSSH workspace');
      } else {
        const typed = requiredPassword(password);
        if (!typed) return { ok: false, error: 'invalid_argument' };
        if (!(await DatabaseManager.unlockWorkspaceWithPassword(workspaceId, typed))) return { ok: false, error: 'wrong_password' };
      }
      appLock.notifyChanged();
      return { ok: true };
    } catch (error) {
      // Touch ID / Windows Hello is not turned on for this workspace.
      if (method === 'presence' && toStoreError(error).code === 'needs_password') return { ok: false, error: 'unavailable' };
      return failure(error);
    }
  });

  ipcMain.handle('workspace:lock', (event, workspaceId: unknown) => {
    if (!isMainWebContents(event.sender) || !isValidWorkspaceId(workspaceId)) return false;
    try {
      DatabaseManager.lockWorkspace(workspaceId);
      appLock.notifyChanged();
      return true;
    } catch {
      return false;
    }
  });
}
