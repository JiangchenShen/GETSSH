import { app, ipcMain, WebContents, BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import { join } from 'path';
import { getRustCorePath } from '../utils/rustCorePath';

// N-API bindings for Rust nexus-core
let nexusCore: any = null;

try {
  // Safely attempt to load the N-API module
  nexusCore = require(getRustCorePath('nexus-core'));
  console.log('[Nexus Bridge] Successfully linked Rust nexus-core binary');
} catch (e: any) {
  console.warn('[Nexus Bridge] Nexus Core native module not found. Falling back to pure TypeScript runtime mode.');
}

class NexusBridge extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Setup state broadcaster from Rust to Electron Renderer
   */
  public setupStateBroadcaster() {
    if (nexusCore && typeof nexusCore.registerSyncTreeCallback === 'function') {
      try {
        nexusCore.registerSyncTreeCallback((...args: any[]) => {
          try {
            // If first arg is null (err), the second arg is the treeJson
            const treeJson = args.length > 1 ? args[1] : args[0];
            const payload = JSON.parse(treeJson);
            console.log(`[Nexus Bridge] SyncTree Broadcast: tabId=${payload.tabId}, isTornOff=${payload.is_torn_off}`);
            
            // Broadcast to all active windows
            for (const win of BrowserWindow.getAllWindows()) {
              if (!win.webContents.isDestroyed()) {
                win.webContents.send('nexus:sync-tree', payload.tabId, payload.title || '', payload.tree, payload.is_torn_off);
              }
            }
          } catch(e) {
            console.error('[Nexus Bridge] Failed to parse sync-tree JSON:', e);
          }
        });
      } catch (e) {
        console.warn('[Nexus Bridge] Failed to register state broadcaster callback:', e);
      }
    }
  }

  public async requestTearOff(paneId: string): Promise<any> {
    if (!nexusCore || typeof nexusCore.requestTearOff !== 'function') return { success: true, fallback: true };
    try {
      return await nexusCore.requestTearOff(paneId);
    } catch (e) {
      console.warn('[Nexus Bridge] requestTearOff fallback:', e);
      return { success: true, fallback: true };
    }
  }

  public async requestTearIn(paneId: string): Promise<any> {
    if (!nexusCore || typeof nexusCore.requestTearIn !== 'function') return { success: true, fallback: true };
    try {
      return await nexusCore.requestTearIn(paneId);
    } catch (e) {
      console.warn('[Nexus Bridge] requestTearIn fallback:', e);
      return { success: true, fallback: true };
    }
  }

  public async bootstrapWorkspace(workspaceId: string): Promise<string> {
    if (!nexusCore || typeof nexusCore.bootstrapWorkspace !== 'function') return 'skip';
    try {
      return await nexusCore.bootstrapWorkspace(workspaceId);
    } catch (e) {
      return 'skip';
    }
  }

  public async applyWorkspaceNetwork(workspaceId: string): Promise<string> {
    if (!nexusCore || typeof nexusCore.applyWorkspaceNetwork !== 'function') return 'skip';
    try {
      return await nexusCore.applyWorkspaceNetwork(workspaceId);
    } catch (e) {
      return 'skip';
    }
  }

  public async clearNetworkTopology(): Promise<string> {
    if (!nexusCore || typeof nexusCore.clearNetworkTopology !== 'function') return 'skip';
    try {
      return await nexusCore.clearNetworkTopology();
    } catch (e) {
      return 'skip';
    }
  }

  public async requestClosePane(paneId: string): Promise<any> {
    if (!nexusCore || typeof nexusCore.requestClosePane !== 'function') return { success: true, fallback: true };
    try {
      return await nexusCore.requestClosePane(paneId);
    } catch (e) {
      return { success: true, fallback: true };
    }
  }

  /**
   * Setup standard low-frequency IPC handlers (User Actions)
   */
  public setupIpcHandlers() {
    // 1. SPLIT PANE
    ipcMain.handle('nexus:split', async (event, payload: { targetPaneId: string, direction: 'horizontal' | 'vertical' }) => {
      if (!nexusCore || typeof nexusCore.requestSplit !== 'function') return { success: true, fallback: true };
      try {
        return await nexusCore.requestSplit(payload.targetPaneId, payload.direction);
      } catch (e) {
        return { success: true, fallback: true };
      }
    });

    // 2. TEAR OFF PANE (Multi-Window routing)
    ipcMain.handle('nexus:tear-off', async (event, payload: { paneId: string }) => {
      if (!nexusCore || typeof nexusCore.requestTearOff !== 'function') return { success: true, fallback: true };
      try {
        return await nexusCore.requestTearOff(payload.paneId);
      } catch (e) {
        return { success: true, fallback: true };
      }
    });

    // 3. CLOSE PANE
    ipcMain.handle('nexus:close', async (event, payload: { paneId: string }) => {
      if (!nexusCore || typeof nexusCore.requestClosePane !== 'function') return { success: true, fallback: true };
      try {
        return await nexusCore.requestClosePane(payload.paneId);
      } catch (e) {
        return { success: true, fallback: true };
      }
    });

    // 4. TOGGLE ZOOM
    ipcMain.handle('nexus:toggle-zoom', async (event, payload: { paneId: string }) => {
      if (!nexusCore || typeof nexusCore.requestToggleZoom !== 'function') return { success: true, fallback: true };
      try {
        return await nexusCore.requestToggleZoom(payload.paneId);
      } catch (e) {
        return { success: true, fallback: true };
      }
    });

    // 5. REPLACE PANE
    ipcMain.handle('nexus:replace-pane', async (event, payload: { paneId: string, paneType: string, sessionId: string | null, configJson: string }) => {
      if (!nexusCore || typeof nexusCore.requestReplacePane !== 'function') return { success: true, fallback: true };
      try {
        return await nexusCore.requestReplacePane(payload.paneId, payload.paneType, payload.sessionId, payload.configJson);
      } catch (e) {
        return { success: true, fallback: true };
      }
    });

    // 6. REGISTER INITIAL TAB
    ipcMain.handle('nexus:register-tab', async (event, payload: { tabId: string, rootPaneId: string, sessionId: string, paneType: string, configJson: string, title: string }) => {
      if (!nexusCore || typeof nexusCore.registerTab !== 'function') return { success: true, fallback: true };
      try {
        return await nexusCore.registerTab(payload.tabId, payload.rootPaneId, payload.sessionId, payload.paneType, payload.configJson, payload.title);
      } catch (e) {
        return { success: true, fallback: true };
      }
    });

    // 7. UPDATE SIZES
    ipcMain.handle('nexus:update-sizes', async (event, payload: { paneId: string, sizes: number[] }) => {
      if (!nexusCore || typeof nexusCore.requestUpdateSizes !== 'function') return { success: true, fallback: true };
      try {
        return await nexusCore.requestUpdateSizes(payload.paneId, payload.sizes);
      } catch (e) {
        return { success: true, fallback: true };
      }
    });

    // 8. SET DISCONNECTED
    ipcMain.handle('nexus:set-disconnected', async (event, payload: { paneId: string, disconnected: boolean }) => {
      if (!nexusCore || typeof nexusCore.requestPatchLeaf !== 'function') return { success: true, fallback: true };
      try {
        return await nexusCore.requestPatchLeaf(payload.paneId, payload.disconnected);
      } catch (e) {
        return { success: true, fallback: true };
      }
    });

    // 9. CLOSE TAB
    ipcMain.handle('nexus:close-tab', async (event, payload: { tabId: string }) => {
      if (!nexusCore || typeof nexusCore.requestCloseTab !== 'function') return { success: true, fallback: true };
      try {
        return await nexusCore.requestCloseTab(payload.tabId);
      } catch (e) {
        return { success: true, fallback: true };
      }
    });
  }

  /**
   * ⚡ High-Throughput PTY Pipeline ⚡
   * Bind high-frequency PTY stdout streams from Rust directly to a specific Electron Renderer.
   * This avoids all JSON serialization overhead common in traditional Electron socket designs.
   */
  public bindPtyStream(sessionId: string, paneId: string, webContents: WebContents) {
    if (!nexusCore) return;

    console.log(`[Nexus Bridge] Binding PTY high-throughput stream for pane ${paneId}`);
    
    if (typeof nexusCore.subscribePtyStream === 'function') {
      try {
        nexusCore.subscribePtyStream(sessionId, paneId, (chunk: Buffer) => {
           if (!webContents.isDestroyed()) {
             webContents.send(`pty:data:${paneId}`, chunk);
           }
        });
      } catch (e) {
        console.warn('[Nexus Bridge] bindPtyStream failed:', e);
      }
    }
  }
}

export const nexusBridge = new NexusBridge();
