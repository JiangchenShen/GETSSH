import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { nexusBridge } from '../nexus/nexusBridge';
import { RagManager } from '../services/ragManager';
import { vaultManager } from '../services/vaultManager';

export function setupWorkspaceHandlers() {
  ipcMain.handle('workspace:list', async () => {
    try {
      const getsshRoot = path.join(os.homedir(), '.getssh', 'workspaces');
      
      // Read directories in ~/.getssh/workspaces
      const entries = await fs.promises.readdir(getsshRoot, { withFileTypes: true }).catch(() => []);
      const workspaceIds = entries.filter(e => e.isDirectory()).map(e => e.name);
      
      const workspaces = await Promise.all(workspaceIds.map(async (id) => {
        const metaPath = path.join(getsshRoot, id, 'workspace_meta.json');
        let visualMeta = { themeColor: '#0ea5e9', hasPassword: false };
        try {
           const raw = await fs.promises.readFile(metaPath, 'utf-8');
           visualMeta = { ...visualMeta, ...JSON.parse(raw) };
        } catch { }
        return { id, visualMeta };
      }));
      
      return workspaces;
    } catch (e) {
      console.error('[Workspace IPC] Failed to get workspaces', e);
      return [];
    }
  });

  ipcMain.handle('workspace:create', async (event, workspaceId: string, visualMeta?: any) => {
    console.log(`[Workspace IPC] Creating new workspace: ${workspaceId}`);
    const res = await nexusBridge.bootstrapWorkspace(workspaceId);
    if (res && res.success && visualMeta) {
      try {
        const metaPath = path.join(os.homedir(), '.getssh', 'workspaces', workspaceId, 'workspace_meta.json');
        await fs.promises.writeFile(metaPath, JSON.stringify(visualMeta));
      } catch (e) {
        console.error('Failed to write visual meta', e);
      }
    }
    return res;
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
      await RagManager.disconnectCurrentDB();
      await RagManager.connectWorkspaceDB(targetWorkspaceId);

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
      // Phase 3: 剧本与资产盘装载 (Load Storage Assets)
      // ==========================================
      const runbooksPath = path.join(wsPath, 'runbooks.json');
      const profilesPath = path.join(wsPath, 'profiles.json');
      const metaPath = path.join(wsPath, 'workspace_meta.json');
      
      const runbooksRaw = await fs.promises.readFile(runbooksPath, 'utf-8').catch(() => '[]');
      const profilesRaw = await fs.promises.readFile(profilesPath, 'utf-8').catch(() => '[]');
      
      let visualMeta = { themeColor: '#1e293b', hasPassword: false };
      try {
        const raw = await fs.promises.readFile(metaPath, 'utf-8');
        visualMeta = { ...visualMeta, ...JSON.parse(raw) };
      } catch {
        // Initialize default meta
        await fs.promises.writeFile(metaPath, JSON.stringify(visualMeta));
      }
      
      let profilesToReturn = [];
      let isLocked = false;
      
      if (visualMeta.hasPassword) {
         isLocked = true;
         // Frontend must suspend rendering and prompt for password via unlock-profiles
      } else {
         profilesToReturn = JSON.parse(profilesRaw);
      }

      const payload = {
        success: true,
        workspaceId: targetWorkspaceId,
        visualMeta,
        isLocked,
        runbooks: JSON.parse(runbooksRaw),
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

    // Connect the RAG memory engine to the active workspace sandbox
    await RagManager.connectWorkspaceDB(config.active_workspace);

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
