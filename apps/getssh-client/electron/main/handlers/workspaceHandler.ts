import { ipcMain } from 'electron';
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
          isMain: ws.is_main === 1
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
      
      let visualMeta = { themeColor: '#1e293b', hasPassword: false, name: targetWorkspaceId };
      if (wsRow) {
        visualMeta = {
          name: wsRow.name,
          themeColor: wsRow.themeColor,
          hasPassword: wsRow.hasPassword === 1
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

    // Determine if we need to auto-bootstrap a default workspace
    if (!config.active_workspace) {
      console.log('[Workspace] No active workspace found. Auto-bootstrapping default sandbox...');
      
      // Call Rust NAPI to generate the securely locked down directory tree
      await nexusBridge.bootstrapWorkspace('default');
      
      config.active_workspace = 'default';
      
      // Rust has created the file with 0o600, so we can overwrite it safely
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
