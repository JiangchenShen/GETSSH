import { type IpcMain, type App } from 'electron';
import crypto from 'node:crypto';
import { isMainWebContents } from '../windowRegistry';
import { appLock } from '../security/appLock';
import { isKeystoreError, keystore, toKeystoreError, workspaceScope } from '../security/keystore';

/**
 * Profiles of the active workspace. Unlocking goes through the keystore; the renderer never
 * receives or keeps a workspace password.
 */

function activeWorkspaceId(): string {
  const { getActiveWorkspaceId } = require('./workspaceHandler');
  return getActiveWorkspaceId();
}

function databaseManager() {
  return require('../services/DatabaseManager').DatabaseManager;
}

function scopeStatus(workspaceId: string) {
  try {
    return keystore.status().scopes.find(scope => scope.id === workspaceScope(workspaceId));
  } catch {
    return undefined;
  }
}

export function registerCryptoHandlers(ipcMain: IpcMain, _app: App) {
  // Touch ID / Windows Hello for the active workspace. Nothing secret is returned: on success
  // the workspace is unlocked in the main process and the renderer loads its profiles.
  ipcMain.handle('prompt-biometric-unlock', async (event) => {
    if (!isMainWebContents(event.sender)) return { success: false, reason: 'unauthorized' };
    if (!appLock.isReady()) return { success: false, reason: 'locked' };
    const workspaceId = activeWorkspaceId();
    if (!scopeStatus(workspaceId)?.presence) return { success: false, reason: 'not_enabled' };
    try {
      const unlocked = await databaseManager().unlockWorkspaceWithPresence(workspaceId, 'unlock this GETSSH workspace');
      if (activeWorkspaceId() !== workspaceId) return { success: false, reason: 'workspace_changed' };
      return unlocked ? { success: true } : { success: false, reason: 'read_failed' };
    } catch (error) {
      const code = toKeystoreError(error).code;
      return { success: false, reason: code === 'cancelled' ? 'cancelled' : code === 'unavailable' ? 'unsupported' : 'read_failed' };
    }
  });

  // 'encrypted': the active workspace must be unlocked first; 'plain': it opens without a prompt.
  ipcMain.handle('check-profiles', async () => {
    if (!appLock.isReady()) return { status: 'none', biometricEnabled: false, hasPassword: false };
    const workspaceId = activeWorkspaceId();
    try {
      const state = await databaseManager().openWorkspace(workspaceId);
      const scope = scopeStatus(workspaceId);
      return {
        status: state === 'open' ? 'plain' : 'encrypted',
        biometricEnabled: !!scope?.presence,
        // Pre-3.0 workspaces waiting for their password have no scope yet.
        hasPassword: scope ? scope.ownPassword : state === 'legacy',
      };
    } catch (error) {
      console.warn('Failed to check the workspace lock state:', error);
      return { status: 'encrypted', biometricEnabled: false, hasPassword: true };
    }
  });

  // Unlocks the active workspace (with its password when it has one) and returns its profiles.
  ipcMain.handle('unlock-profiles', async (event, password: unknown) => {
    // Only the main window mounts workspaces and holds the profile list (torn windows never need it).
    if (!isMainWebContents(event.sender)) throw new Error('Unauthorized sender');
    if (!appLock.isReady()) throw new Error('locked');
    const DatabaseManager = databaseManager();
    const workspaceId = activeWorkspaceId();
    let state = await DatabaseManager.openWorkspace(workspaceId);
    if (state !== 'open') {
      if (typeof password !== 'string' || password.length === 0 || password.length > 4096) throw new Error('locked');
      let unlocked = false;
      try {
        unlocked = await DatabaseManager.unlockWorkspaceWithPassword(workspaceId, password);
      } catch (error) {
        if (isKeystoreError(error, 'rate_limited')) throw new Error(`rate_limited:${toKeystoreError(error).retryAfterMs ?? 0}`);
        throw error;
      }
      if (!unlocked) throw new Error('Invalid master password or corrupted file');
      state = 'open';
      appLock.notifyChanged();
    }
    return DatabaseManager.getProfiles(workspaceId);
  });

  // Saves the profile list of the active workspace. Passwords of workspaces are set through
  // workspace:set-password / workspace:remove-password, never through a save.
  ipcMain.handle('save-profiles', async (event, { payload, workspaceId: requestedWorkspaceId }) => {
    if (!isMainWebContents(event.sender)) throw new Error('Unauthorized sender');
    if (!appLock.isReady()) throw new Error('locked');
    const DatabaseManager = databaseManager();
    const workspaceId = activeWorkspaceId();
    // The list was built for another workspace (the active one changed meanwhile): never write it here.
    if (typeof requestedWorkspaceId === 'string' && requestedWorkspaceId && requestedWorkspaceId !== workspaceId) {
      throw new Error('workspace_changed');
    }
    if (!Array.isArray(payload)) throw new Error('invalid_argument');

    const profilesToSave = (payload as any[]).map((p: any) => ({
      id: p.id || crypto.randomUUID(),
      workspace_id: workspaceId,
      host: p.host,
      username: p.username,
      password: p.password,
      privateKeyPath: p.privateKeyPath,
      passphrase: p.passphrase,
      port: p.port || (p.protocol === 'telnet' ? 23 : 22),
      autoStart: p.autoStart ? 1 : 0,
      alias: p.alias,
      osType: p.osType,
      protocol: p.protocol || 'ssh',
      groupName: p.group,
      useKeepAlive: p.useKeepAlive !== false,
      authType: p.authType || 'password',
      proxyJump: p.proxyJump,
      strictHostKeyChecking: p.strictHostKeyChecking === true,
      initialDirectory: p.initialDirectory,
      postConnectScript: p.postConnectScript,
      themeOverride: p.themeOverride,
    }));

    if ((await DatabaseManager.openWorkspace(workspaceId)) !== 'open') throw new Error('workspace_locked');
    DatabaseManager.saveProfiles(workspaceId, profilesToSave);
    try {
      DatabaseManager.logAudit(workspaceId, 'Profile Saved', 'Batch Save', `${profilesToSave.length} profiles saved/updated`);
    } catch {}
    return true;
  });
}
