import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { nexusBridge } from '../nexus/nexusBridge';
import { vaultManager } from '../services/vaultManager';
import { ChatStorageManager } from '../services/chatStorageManager';
import { DatabaseManager } from '../services/DatabaseManager';
import { isMainWebContents } from '../windowRegistry';
import { isValidWorkspaceId, resolveWorkspaceDir } from '../utils/workspaceId';
import { appLock } from '../security/appLock';
import { isKeystoreError, keystore, workspaceScope } from '../security/keystore';

/** Workspace state is only changed by the main window; torn windows never need these handlers. */
const UNAUTHORIZED = { success: false, error: 'Unauthorized sender' };
/** Workspace ids become directory names; see utils/workspaceId.ts. */
const INVALID_WORKSPACE_ID = { success: false, error: 'Invalid workspace id' };
const LOCKED = { success: false, error: 'locked' };

/** Keystore view of a workspace: its own password, Touch ID route, and whether it is open now. */
function workspaceLockInfo(workspaceId: string, legacyHasPassword: boolean) {
  let scope: ReturnType<typeof keystore.status>['scopes'][number] | undefined;
  try {
    scope = keystore.status().scopes.find(entry => entry.id === workspaceScope(workspaceId));
  } catch {
    scope = undefined;
  }
  return {
    hasPassword: scope ? scope.ownPassword : legacyHasPassword,
    biometricEnabled: !!scope?.presence,
    protected: scope ? scope.protected : legacyHasPassword,
  };
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
          ...workspaceLockInfo(ws.id, ws.hasPassword === 1),
          isMain: ws.is_main === 1,
          preferences: ws.preferences ? JSON.parse(ws.preferences) : {}
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
      const res = await nexusBridge.bootstrapWorkspace(workspaceId);
      if (res && res !== 'skip') {
        const now = Date.now();
        // A password, if any, is set afterwards through workspace:set-password.
        DatabaseManager.createWorkspace({
          id: workspaceId,
          name: visualMeta?.name || workspaceId,
          themeColor: visualMeta?.themeColor || '#1e293b',
          hasPassword: 0,
          created_at: now,
          updated_at: now
        });
        await DatabaseManager.openWorkspace(workspaceId);
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
    try {
      const scope = workspaceScope(workspaceId);
      if (enabled === true) await keystore.enablePresence(scope, 'turn on Touch ID for this workspace');
      else await keystore.disablePresence(scope);
      appLock.notifyChanged();
      return { success: true };
    } catch (e) {
      console.error('Failed to toggle biometric:', e);
      return { success: false, error: isKeystoreError(e) ? e.code : String(e) };
    }
  });

  ipcMain.handle('workspace:updatePreferences', async (event, workspaceId: string, preferencesStr: string) => {
    if (!isMainWebContents(event.sender)) return UNAUTHORIZED;
    if (!isValidWorkspaceId(workspaceId)) return INVALID_WORKSPACE_ID;
    try {
      const db = DatabaseManager.getDb();
      if (db) {
        db.prepare('UPDATE workspaces SET preferences = ? WHERE id = ?').run(preferencesStr, workspaceId);
      }
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
    // Returns decrypted profile rows (credentials included): main window only.
    if (!isMainWebContents(event.sender)) return UNAUTHORIZED;
    if (!isValidWorkspaceId(sourceWorkspaceId)) return INVALID_WORKSPACE_ID;
    try {
      // A workspace that is locked stays locked: the owner has to unlock it first.
      if (!appLock.isReady() || (await DatabaseManager.openWorkspace(sourceWorkspaceId)) !== 'open') return LOCKED;
      const db = DatabaseManager.getWorkspaceDb(sourceWorkspaceId);
      if (!db) throw new Error('Source workspace DB not found');
      
      const profiles = db.prepare('SELECT * FROM profiles WHERE workspace_id = ?').all(sourceWorkspaceId);
      const runbooks = db.prepare('SELECT * FROM runbooks WHERE workspace_id = ?').all(sourceWorkspaceId);
      
      return { success: true, profiles, runbooks };
    } catch (e) {
      console.error('Bridge fetch failed', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('workspace:bridge:importProfiles', async (event, targetWorkspaceId: string, profilesToImport: any[], runbooksToImport: any[]) => {
    if (!isMainWebContents(event.sender)) return UNAUTHORIZED;
    if (!isValidWorkspaceId(targetWorkspaceId)) return INVALID_WORKSPACE_ID;
    try {
      if (!appLock.isReady() || (await DatabaseManager.openWorkspace(targetWorkspaceId)) !== 'open') return LOCKED;
      const db = DatabaseManager.getWorkspaceDb(targetWorkspaceId);
      if (!db) throw new Error('Target workspace DB not found');

      const importProfile = db.prepare(`
        INSERT OR REPLACE INTO profiles (id, workspace_id, host, username, password, privateKeyPath, passphrase, port, autoStart, alias, osType, protocol, groupName, useKeepAlive, authType, proxyJump, strictHostKeyChecking, initialDirectory, postConnectScript, themeOverride)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const importRunbook = db.prepare(`
        INSERT OR REPLACE INTO runbooks (id, workspace_id, title, script, riskLevel, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      db.transaction(() => {
        for (const p of profilesToImport) {
          importProfile.run(
            p.id, targetWorkspaceId, p.host, p.username, p.password, p.privateKeyPath, p.passphrase,
            p.port, p.autoStart, p.alias, p.osType, p.protocol || 'ssh', p.groupName || p.group || null,
            p.useKeepAlive === false || p.useKeepAlive === 0 ? 0 : 1, p.authType || 'password',
            p.proxyJump || null, p.strictHostKeyChecking ? 1 : 0, p.initialDirectory || null,
            p.postConnectScript || null, p.themeOverride || null
          );
        }
        for (const r of runbooksToImport) {
          importRunbook.run(r.id, targetWorkspaceId, r.title, r.script, r.riskLevel, r.created_at);
        }
      })();

      try {
        DatabaseManager.logAudit(targetWorkspaceId, 'Data Import', 'Cross-Workspace Bridge', `Imported ${profilesToImport.length} profiles and ${runbooksToImport.length} runbooks`);
      } catch(e) {}

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
      DatabaseManager.deleteWorkspace(workspaceId);
      try {
        await keystore.deleteScope(workspaceScope(workspaceId));
      } catch (e) {
        if (!isKeystoreError(e, 'unknown_scope')) throw e;
      }
      try {
        fs.rmSync(path.join(DatabaseManager.getBaseDir(), `workspace_${workspaceId}.db`), { force: true });
        fs.rmSync(path.join(DatabaseManager.getBaseDir(), `workspace_${workspaceId}.db-wal`), { force: true });
        fs.rmSync(path.join(DatabaseManager.getBaseDir(), `workspace_${workspaceId}.db-shm`), { force: true });
      } catch (e) {
        console.warn(`[Workspace IPC] Failed to delete the database of ${workspaceId}`, e);
      }
      // We could also delete the vault file in ~/.getssh/workspaces/<workspaceId> if it still exists
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

      // Check if target exists
      try {
        await fs.promises.access(wsPath);
      } catch {
        // If not, we can either reject or bootstrap. Let's just reject.
        throw new Error(`Target workspace sandbox does not exist: ${targetWorkspaceId}`);
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
      await nexusBridge.clearNetworkTopology(); // Flush first for absolute safety
      await nexusBridge.applyWorkspaceNetwork(targetWorkspaceId);

      // ==========================================
      // Phase 3: 剧本与资产盘装载 (Load Storage Assets from DB)
      // ==========================================
      if (!appLock.isReady()) throw new Error('GETSSH is locked');
      const workspaces = DatabaseManager.getWorkspaces();
      const wsRow = workspaces.find(w => w.id === targetWorkspaceId);
      
      let visualMeta = { themeColor: '#1e293b', hasPassword: false, biometricEnabled: false, name: targetWorkspaceId };
      if (wsRow) {
        const lockInfo = workspaceLockInfo(targetWorkspaceId, wsRow.hasPassword === 1);
        visualMeta = {
          name: wsRow.name,
          themeColor: wsRow.themeColor || '#1e293b',
          hasPassword: lockInfo.hasPassword,
          biometricEnabled: lockInfo.biometricEnabled
        };
      } else {
        // If workspace doesn't exist in DB but folder exists, insert it
        const now = Date.now();
        DatabaseManager.createWorkspace({
          id: targetWorkspaceId,
          name: targetWorkspaceId,
          themeColor: '#1e293b',
          hasPassword: 0,
          created_at: now,
          updated_at: now
        });
      }
      
      // Leaving a workspace that has its own password locks it again.
      if (previousWorkspaceId !== targetWorkspaceId && workspaceLockInfo(previousWorkspaceId, false).hasPassword) {
        try {
          keystore.lockScope(workspaceScope(previousWorkspaceId));
        } catch {}
        DatabaseManager.closeLockedDatabases();
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

    // Check main.db for the designated Main Workspace
    const { DatabaseManager } = require('../services/DatabaseManager');
    const mainDb = DatabaseManager.getDb();
    if (mainDb) {
      try {
        const row = mainDb.prepare('SELECT id FROM workspaces WHERE is_main = 1').get() as { id: string } | undefined;
        if (row && row.id) {
          config.active_workspace = row.id;
          await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
          console.log(`[Workspace] Bootstrapped Main Workspace: ${config.active_workspace}`);
        }
      } catch (err) {
        console.error('[Workspace] Failed to read main workspace from DB:', err);
      }
    }

    if (!config.active_workspace) {
      console.log('[Workspace] No active workspace found. Auto-bootstrapping default sandbox...');
      await nexusBridge.bootstrapWorkspace('default');
      config.active_workspace = 'default';
      await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
      console.log('[Workspace] Global configuration updated to use default');
    } else {
      console.log(`[Workspace] Active workspace confirmed: ${config.active_workspace}`);
    }

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
