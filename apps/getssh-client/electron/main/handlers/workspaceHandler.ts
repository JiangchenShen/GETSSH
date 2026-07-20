import { ipcMain, safeStorage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { nexusBridge } from '../nexus/nexusBridge';
import { vaultManager } from '../services/vaultManager';
import { ChatStorageManager } from '../services/chatStorageManager';
import { DatabaseManager } from '../services/DatabaseManager';

export function setupWorkspaceHandlers() {
  ipcMain.handle('workspace:list', async () => {
    try {
      const workspaces = DatabaseManager.getWorkspaces();
      return workspaces.map(ws => ({
        id: ws.id,
        visualMeta: {
          name: ws.name,
          themeColor: ws.themeColor,
          hasPassword: ws.hasPassword === 1,
          biometricEnabled: ws.biometric_enabled === 1,
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
    console.log(`[Workspace IPC] Creating new workspace: ${workspaceId}`);
    try {
      const res = await nexusBridge.bootstrapWorkspace(workspaceId);
      if (res && res !== 'skip') {
        const now = Date.now();
        DatabaseManager.createWorkspace({
          id: workspaceId,
          name: visualMeta?.name || workspaceId,
          themeColor: visualMeta?.themeColor || '#1e293b',
          hasPassword: visualMeta?.hasPassword ? 1 : 0,
          created_at: now,
          updated_at: now
        });
        return { success: true, res };
      }
      return { success: false, error: 'bootstrap skipped or failed' };
    } catch(e) {
      console.error('[Workspace IPC] create error', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('workspace:setMain', async (event, workspaceId: string) => {
    try {
      DatabaseManager.setMainWorkspace(workspaceId);
      return { success: true };
    } catch (e) {
      console.error(`[Workspace IPC] Failed to set main workspace ${workspaceId}`, e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('workspace:toggleBiometric', async (event, workspaceId: string, enabled: boolean) => {
    try {
      const db = DatabaseManager.getDb();
      if (db) {
        db.prepare('UPDATE workspaces SET biometric_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, workspaceId);
      }
      return { success: true };
    } catch (e) {
      console.error('Failed to toggle biometric:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('workspace:updatePreferences', async (event, workspaceId: string, preferencesStr: string) => {
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
    try {
      return { success: true, stats: DatabaseManager.getWorkspaceStats(workspaceId) };
    } catch (e) {
      console.error('Failed to get workspace stats:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('workspace:getAuditLogs', async (event, workspaceId: string) => {
    try {
      return { success: true, logs: DatabaseManager.getAuditLogs(workspaceId) };
    } catch (e) {
      console.error('Failed to get audit logs:', e);
      return { success: false, error: String(e) };
    }
  });

  async function getWorkspacePassword(wsId: string): Promise<string | undefined> {
    const vaultPath = path.join(os.homedir(), '.getssh', 'workspaces', wsId, 'vault.key');
    if (fs.existsSync(vaultPath) && safeStorage.isEncryptionAvailable()) {
      try {
        const encryptedKey = await fs.promises.readFile(vaultPath);
        return safeStorage.decryptString(encryptedKey);
      } catch (e) {
        console.error(`Failed to decrypt vault for ${wsId}`, e);
      }
    }
    return undefined;
  }

  ipcMain.handle('workspace:bridge:fetchProfiles', async (event, sourceWorkspaceId: string) => {
    try {
      const pwd = await getWorkspacePassword(sourceWorkspaceId);
      let db = DatabaseManager.getWorkspaceDb(sourceWorkspaceId);
      if (!db) {
        const isMounted = DatabaseManager.mountWorkspace(sourceWorkspaceId, pwd);
        if (!isMounted) throw new Error(`Failed to mount source workspace: ${sourceWorkspaceId}`);
        db = DatabaseManager.getWorkspaceDb(sourceWorkspaceId);
      }
      
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
    try {
      const pwd = await getWorkspacePassword(targetWorkspaceId);
      let db = DatabaseManager.getWorkspaceDb(targetWorkspaceId);
      if (!db) {
        const isMounted = DatabaseManager.mountWorkspace(targetWorkspaceId, pwd);
        if (!isMounted) throw new Error('Failed to mount target workspace');
        db = DatabaseManager.getWorkspaceDb(targetWorkspaceId);
      }

      if (!db) throw new Error('Target workspace DB not found');

      const importProfile = db.prepare(`
        INSERT OR REPLACE INTO profiles (id, workspace_id, host, username, password, privateKeyPath, passphrase, port, autoStart, alias, osType)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const importRunbook = db.prepare(`
        INSERT OR REPLACE INTO runbooks (id, workspace_id, title, script, riskLevel, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      db.transaction(() => {
        for (const p of profilesToImport) {
          importProfile.run(p.id, targetWorkspaceId, p.host, p.username, p.password, p.privateKeyPath, p.passphrase, p.port, p.autoStart, p.alias, p.osType);
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
    if (workspaceId === 'default') {
      return { success: false, error: 'Cannot delete default workspace' };
    }
    try {
      DatabaseManager.deleteWorkspace(workspaceId);
      // We could also delete the vault file in ~/.getssh/workspaces/<workspaceId> if it still exists
      const getsshRoot = path.join(os.homedir(), '.getssh');
      const wsPath = path.join(getsshRoot, 'workspaces', workspaceId);
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
    console.log(`[Workspace IPC] Initiating quantum leap to workspace: ${targetWorkspaceId}`);
    
    // We must ensure atomic safety during the transition to prevent partial tearing.
    try {
      const getsshRoot = path.join(os.homedir(), '.getssh');
      const wsPath = path.join(getsshRoot, 'workspaces', targetWorkspaceId);

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
      // Note: In GETSSH 3.0, we no longer use LanceDB. Micro Context Assembler is used on-the-fly.
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
      const workspaces = DatabaseManager.getWorkspaces();
      const wsRow = workspaces.find(w => w.id === targetWorkspaceId);
      
      let visualMeta = { themeColor: '#1e293b', hasPassword: false, biometricEnabled: false, name: targetWorkspaceId };
      if (wsRow) {
        visualMeta = {
          name: wsRow.name,
          themeColor: wsRow.themeColor || '#1e293b',
          hasPassword: wsRow.hasPassword === 1,
          biometricEnabled: wsRow.biometric_enabled === 1
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
      
      let profilesToReturn: any[] = [];
      let isLocked = false;
      
      if (visualMeta.hasPassword) {
         isLocked = true;
         // Frontend must suspend rendering and prompt for password via unlock-profiles
      } else {
         profilesToReturn = DatabaseManager.getProfiles(targetWorkspaceId);
      }

      const runbooks = DatabaseManager.getRunbooks(targetWorkspaceId);

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
