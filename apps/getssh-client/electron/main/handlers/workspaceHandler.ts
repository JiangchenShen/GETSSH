import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { tidalBridge } from '../tidal/tidalBridge';
import { vaultManager } from '../services/vaultManager';
import { ChatStorageManager } from '../services/chatStorageManager';
import { DatabaseManager, type Workspace } from '../services/DatabaseManager';
import { getStore, toStoreError } from '../services/getsshStore';
import { isMainWebContents } from '../windowRegistry';
import { isValidWorkspaceId, resolveWorkspaceDir } from '../utils/workspaceId';
import { appLock } from '../security/appLock';

/** Workspace state is only changed by the main window; torn windows never need these handlers. */
const UNAUTHORIZED = { success: false, error: 'Unauthorized sender' };
/** Workspace ids become directory names; see utils/workspaceId.ts. */
const INVALID_WORKSPACE_ID = { success: false, error: 'Invalid workspace id' };
const LOCKED = { success: false, error: 'locked' };

/** A workspace's lock: its own password, the Touch ID route, and whether anything protects it. */
function workspaceLockInfo(workspace: Workspace | undefined) {
  const masterPassword = getStore().appState().masterPassword;
  // Without a master password only a workspace with a password can be locked; one that is locked
  // without one is a pre-3.0 workspace whose password moves it to the store when typed.
  const hasPassword = !!workspace?.hasPassword || (!masterPassword && workspace?.state === 'locked');
  return {
    hasPassword,
    biometricEnabled: !!workspace?.presenceEnabled,
    protected: masterPassword || hasPassword,
  };
}

/**
 * Creates a workspace's folder (~/.getssh/workspaces/<id>) when it is missing. The store creates
 * a workspace's database but not this folder, so the MAIN workspace of a fresh install has none.
 */
async function ensureWorkspaceDir(workspaceId: string): Promise<void> {
  const dir = resolveWorkspaceDir(workspaceId);
  if (fs.existsSync(dir)) return;
  await tidalBridge.bootstrapWorkspace(workspaceId);
  // Without tidal-engine the folder is still needed: switching checks for it.
  if (!fs.existsSync(dir)) await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
}

function parsePreferences(text: string | null | undefined): Record<string, unknown> {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

export function setupWorkspaceHandlers() {
  ipcMain.handle('workspace:list', async () => {
    try {
      const workspaces = DatabaseManager.getWorkspaces();
      return workspaces.map(ws => ({
        id: ws.id,
        visualMeta: {
          name: ws.name,
          themeColor: ws.themeColor,
          ...workspaceLockInfo(ws),
          isMain: ws.is_main,
          preferences: parsePreferences(ws.preferences)
        }
      }));
    } catch (e) {
      console.error('[Workspace IPC] Failed to get workspaces', e);
      return [];
    }
  });

  ipcMain.handle('workspace:create', async (event, workspaceId: string, visualMeta?: any) => {
    if (!isMainWebContents(event.sender)) return UNAUTHORIZED;
    if (!isValidWorkspaceId(workspaceId)) return INVALID_WORKSPACE_ID;
    console.log(`[Workspace IPC] Creating new workspace: ${workspaceId}`);
    try {
      if (!appLock.isReady()) return LOCKED;
      const res = await tidalBridge.bootstrapWorkspace(workspaceId);
      if (res && res !== 'skip') {
        // A password, if any, is set afterwards through workspace:set-password.
        const name = typeof visualMeta?.name === 'string' && visualMeta.name.trim() ? visualMeta.name : workspaceId;
        const themeColor = typeof visualMeta?.themeColor === 'string' ? visualMeta.themeColor : '#1e293b';
        if (DatabaseManager.getWorkspace(workspaceId)) {
          getStore().updateWorkspace(workspaceId, { name, themeColor });
        } else {
          await DatabaseManager.createWorkspace({ id: workspaceId, name, themeColor });
        }
        return { success: true, res };
      }
      return { success: false, error: 'bootstrap skipped or failed' };
    } catch(e) {
      console.error('[Workspace IPC] create error', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('workspace:setMain', async (event, workspaceId: string) => {
    if (!isMainWebContents(event.sender)) return UNAUTHORIZED;
    if (!isValidWorkspaceId(workspaceId)) return INVALID_WORKSPACE_ID;
    try {
      DatabaseManager.setMainWorkspace(workspaceId);
      return { success: true };
    } catch (e) {
      console.error(`[Workspace IPC] Failed to set main workspace ${workspaceId}`, e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('workspace:toggleBiometric', async (event, workspaceId: string, enabled: boolean) => {
    if (!isMainWebContents(event.sender)) return UNAUTHORIZED;
    if (!isValidWorkspaceId(workspaceId)) return INVALID_WORKSPACE_ID;
    // Touch ID / Windows Hello becomes a second way into a workspace that has its own password
    // (a key of its own in the Secure Enclave or Windows Hello; the workspace must be unlocked).
    // One switch covers the app and every workspace that has its own password (store.d.ts).
    try {
      await getStore().setPresence(enabled === true, 'turn on Touch ID for GETSSH');
      appLock.notifyChanged();
      return { success: true };
    } catch (e) {
      console.error('Failed to toggle biometric:', e);
      return { success: false, error: toStoreError(e).code };
    }
  });

  ipcMain.handle('workspace:updatePreferences', async (event, workspaceId: string, preferencesStr: string) => {
    if (!isMainWebContents(event.sender)) return UNAUTHORIZED;
    if (!isValidWorkspaceId(workspaceId)) return INVALID_WORKSPACE_ID;
    if (typeof preferencesStr !== 'string') return { success: false, error: 'invalid_argument' };
    try {
      DatabaseManager.updateWorkspacePreferences(workspaceId, preferencesStr);
      return { success: true };
    } catch (e) {
      console.error('Failed to update workspace preferences:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('workspace:getStats', async (event, workspaceId: string) => {
    if (!isValidWorkspaceId(workspaceId)) return INVALID_WORKSPACE_ID;
    try {
      return { success: true, stats: DatabaseManager.getWorkspaceStats(workspaceId) };
    } catch (e) {
      console.error('Failed to get workspace stats:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('workspace:getAuditLogs', async (event, workspaceId: string) => {
    if (!isValidWorkspaceId(workspaceId)) return INVALID_WORKSPACE_ID;
    try {
      return { success: true, logs: DatabaseManager.getAuditLogs(workspaceId) };
    } catch (e) {
      console.error('Failed to get audit logs:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('workspace:bridge:fetchProfiles', async (event, sourceWorkspaceId: string) => {
    // Profiles without credentials (the copy happens in the store) and runbooks: main window only.
    if (!isMainWebContents(event.sender)) return UNAUTHORIZED;
    if (!isValidWorkspaceId(sourceWorkspaceId)) return INVALID_WORKSPACE_ID;
    try {
      // A workspace that is locked stays locked: the owner has to unlock it first.
      if (!appLock.isReady() || (await DatabaseManager.openWorkspace(sourceWorkspaceId)) !== 'open') return LOCKED;
      const profiles = getStore().listProfiles(sourceWorkspaceId);
      const runbooks = DatabaseManager.getRunbooks(sourceWorkspaceId);
      return { success: true, profiles, runbooks };
    } catch (e) {
      console.error('Bridge fetch failed', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('workspace:bridge:importProfiles', async (event, targetWorkspaceId: string, profilesToImport: any[], runbooksToImport: any[]) => {
    if (!isMainWebContents(event.sender)) return UNAUTHORIZED;
    if (!isValidWorkspaceId(targetWorkspaceId)) return INVALID_WORKSPACE_ID;
    if (!Array.isArray(profilesToImport) || !Array.isArray(runbooksToImport)) return { success: false, error: 'invalid_argument' };
    try {
      if (!appLock.isReady() || (await DatabaseManager.openWorkspace(targetWorkspaceId)) !== 'open') return LOCKED;
      // The rows come from workspace:bridge:fetchProfiles; only their ids and source workspace are
      // used. The store copies the stored rows itself and seals the credentials for the target.
      const ids = (rows: any[]) => rows.map(row => row?.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
      const sources = new Set([...profilesToImport, ...runbooksToImport].map(row => row?.workspace_id));
      if (sources.size === 0) return { success: true };
      const [sourceWorkspaceId] = sources;
      if (sources.size !== 1 || !isValidWorkspaceId(sourceWorkspaceId) || sourceWorkspaceId === targetWorkspaceId) {
        return { success: false, error: 'invalid_argument' };
      }
      if ((await DatabaseManager.openWorkspace(sourceWorkspaceId)) !== 'open') return LOCKED;

      const profileIds = ids(profilesToImport);
      if (profileIds.length) getStore().copyProfiles(sourceWorkspaceId, targetWorkspaceId, profileIds);
      // Only the runbooks the user ticked; a runbook with the same id in the target is replaced.
      const runbookIds = new Set(ids(runbooksToImport));
      if (runbookIds.size) {
        const picked = DatabaseManager.getRunbooks(sourceWorkspaceId).filter(runbook => runbookIds.has(runbook.id));
        const pickedIds = new Set(picked.map(runbook => runbook.id));
        const kept = DatabaseManager.getRunbooks(targetWorkspaceId).filter(runbook => !pickedIds.has(runbook.id));
        DatabaseManager.saveRunbooks(targetWorkspaceId, [...kept, ...picked]);
      }

      DatabaseManager.logAudit(targetWorkspaceId, 'Data Import', 'Cross-Workspace Bridge', `Imported ${profileIds.length} profiles and ${runbookIds.size} runbooks`);

      return { success: true };
    } catch (e) {
      console.error('Bridge import failed', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('workspace:delete', async (event, workspaceId: string) => {
    if (!isMainWebContents(event.sender)) return UNAUTHORIZED;
    if (workspaceId === 'default') {
      return { success: false, error: 'Cannot delete default workspace' };
    }
    // The directory below is removed recursively: an unchecked id like "../.." would resolve to the home directory.
    if (!isValidWorkspaceId(workspaceId)) return INVALID_WORKSPACE_ID;
    try {
      const wsPath = resolveWorkspaceDir(workspaceId);
      // The store removes the database, its key scope and ~/.getssh/workspaces/<id>.
      await DatabaseManager.deleteWorkspace(workspaceId);
      try {
        await fs.promises.rm(wsPath, { recursive: true, force: true });
      } catch (e) {
        console.warn(`[Workspace IPC] Failed to delete workspace folder ${wsPath}`, e);
      }
      return { success: true };
    } catch (e) {
      console.error(`[Workspace IPC] Failed to delete workspace ${workspaceId}`, e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('workspace:switch', async (event, targetWorkspaceId: string) => {
    if (!isMainWebContents(event.sender)) throw new Error('Workspace Transition Failed: Unauthorized sender');
    if (!isValidWorkspaceId(targetWorkspaceId)) throw new Error('Workspace Transition Failed: Invalid workspace id');
    console.log(`[Workspace IPC] Initiating quantum leap to workspace: ${targetWorkspaceId}`);
    const previousWorkspaceId = getActiveWorkspaceId();
    
    // We must ensure atomic safety during the transition to prevent partial tearing.
    try {
      const getsshRoot = path.join(os.homedir(), '.getssh');
      const wsPath = resolveWorkspaceDir(targetWorkspaceId);

      // A workspace the store lists gets its folder back; any other id is refused.
      if (!fs.existsSync(wsPath)) {
        if (!DatabaseManager.getWorkspace(targetWorkspaceId)) {
          throw new Error(`Target workspace sandbox does not exist: ${targetWorkspaceId}`);
        }
        await ensureWorkspaceDir(targetWorkspaceId);
      }

      // ==========================================
      // Phase 1: 记忆脑叶切除与重连 (RAG Memory Swap)
      // ==========================================
      // Semantic memory is keyed by workspace in the encrypted main database;
      // switching this pointer prevents cross-workspace retrieval.
      ChatStorageManager.init(targetWorkspaceId);

      // ==========================================
      // Phase 1.5: 内存金库物理切除 (Vault Zero-out)
      // ==========================================
      await vaultManager.unloadVault();

      // ==========================================
      // Phase 2: 底层网络拓扑重写 (Network Routing Reset)
      // ==========================================
      await tidalBridge.clearNetworkTopology(); // Flush first for absolute safety
      await tidalBridge.applyWorkspaceNetwork(targetWorkspaceId);

      // ==========================================
      // Phase 3: 剧本与资产盘装载 (Load Storage Assets from DB)
      // ==========================================
      if (!appLock.isReady()) throw new Error('GETSSH is locked');
      const wsRow = DatabaseManager.getWorkspace(targetWorkspaceId);
      
      let visualMeta = { themeColor: '#1e293b', hasPassword: false, biometricEnabled: false, name: targetWorkspaceId };
      if (wsRow) {
        const lockInfo = workspaceLockInfo(wsRow);
        visualMeta = {
          name: wsRow.name,
          themeColor: wsRow.themeColor || '#1e293b',
          hasPassword: lockInfo.hasPassword,
          biometricEnabled: lockInfo.biometricEnabled
        };
      } else {
        // The folder exists but the workspace is not listed: give it a database and a key.
        await DatabaseManager.createWorkspace({ id: targetWorkspaceId, name: targetWorkspaceId, themeColor: '#1e293b' });
      }
      
      // Leaving a workspace that has its own password locks it again.
      if (previousWorkspaceId !== targetWorkspaceId && DatabaseManager.getWorkspace(previousWorkspaceId)?.hasPassword) {
        try {
          DatabaseManager.lockWorkspace(previousWorkspaceId);
        } catch (e) {
          console.warn(`[Workspace IPC] Could not lock ${previousWorkspaceId} again:`, e);
        }
      }

      let profilesToReturn: any[] = [];
      // Opens without a prompt unless the workspace needs its password (or Touch ID).
      const isLocked = (await DatabaseManager.openWorkspace(targetWorkspaceId)) !== 'open';
      if (!isLocked) profilesToReturn = DatabaseManager.getProfiles(targetWorkspaceId);
      const runbooks = isLocked ? [] : DatabaseManager.getRunbooks(targetWorkspaceId);

      const payload = {
        success: true,
        workspaceId: targetWorkspaceId,
        visualMeta,
        isLocked,
        runbooks: runbooks,
        profiles: profilesToReturn
      };

      // ==========================================
      // Phase 4: 全局状态持久化 (Persist Global State)
      // ==========================================
      const configPath = path.join(getsshRoot, 'app-config.json');
      let config: any = {};
      try {
        const configData = await fs.promises.readFile(configPath, 'utf-8');
        config = JSON.parse(configData);
      } catch { }

      config.active_workspace = targetWorkspaceId;
      await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
      appLock.notifyChanged();
      console.log(`[Workspace IPC] Successfully committed leap to ${targetWorkspaceId}. Global config updated.`);

      return payload;

    } catch (error: any) {
      console.error(`[Workspace IPC] CRITICAL FAILURE during leap to ${targetWorkspaceId}:`, error);
      // In a catastrophic failure, we should ideally rollback, but for now we throw hard.
      throw new Error(`Workspace Transition Failed: ${error.message}`);
    }
  });
}

export async function bootstrapAppWorkspace() {
  try {
    const getsshRoot = path.join(os.homedir(), '.getssh');
    const configPath = path.join(getsshRoot, 'app-config.json');
    let config: any = {};
    
    try {
      const configData = await fs.promises.readFile(configPath, 'utf-8');
      config = JSON.parse(configData);
    } catch {
      // Configuration file does not exist or is invalid JSON
    }

    // The designated Main Workspace opens first.
    const main = DatabaseManager.getWorkspaces().find(workspace => workspace.is_main);
    if (main) {
      config.active_workspace = main.id;
      await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
      console.log(`[Workspace] Bootstrapped Main Workspace: ${config.active_workspace}`);
    }

    if (!config.active_workspace) {
      console.log('[Workspace] No active workspace found. Using the default workspace.');
      config.active_workspace = 'default';
      await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    } else {
      console.log(`[Workspace] Active workspace confirmed: ${config.active_workspace}`);
    }
    await ensureWorkspaceDir(config.active_workspace).catch(error => {
      console.warn(`[Workspace] Could not create the folder of ${config.active_workspace}:`, error);
    });

    // Note: In GETSSH 3.0, LanceDB is removed.
    // We rely on Micro Context Assembler to dynamically inject state context.
    ChatStorageManager.init(config.active_workspace);

  } catch (e) {
    console.error('[Workspace] Critical error during app bootstrap:', e);
  }
}

export function getActiveWorkspaceId(): string {
  try {
    const configPath = path.join(os.homedir(), '.getssh', 'app-config.json');
    const data = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(data);
    return config.active_workspace || 'default';
  } catch {
    return 'default';
  }
}
