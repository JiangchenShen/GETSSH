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
  console.warn('[Nexus Bridge] Nexus Core native module not found. Building is required via Cargo.', e.message);
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
    }
  }

  public async requestTearOff(paneId: string): Promise<any> {
    if (!nexusCore) throw new Error("Nexus Core engine is currently offline");
    return await nexusCore.requestTearOff(paneId);
  }

  public async requestTearIn(paneId: string): Promise<any> {
    if (!nexusCore) throw new Error("Nexus Core engine is currently offline");
    return await nexusCore.requestTearIn(paneId);
  }

  public async bootstrapWorkspace(workspaceId: string): Promise<string> {
    if (!nexusCore) throw new Error("Nexus Core engine is currently offline");
    if (typeof nexusCore.bootstrapWorkspace !== 'function') {
      console.warn('[Nexus Bridge] bootstrapWorkspace is not available in current nexusCore build');
      return 'skip';
    }
    return await nexusCore.bootstrapWorkspace(workspaceId);
  }

  public async applyWorkspaceNetwork(workspaceId: string): Promise<string> {
    if (!nexusCore) throw new Error("Nexus Core engine is currently offline");
    if (typeof nexusCore.applyWorkspaceNetwork !== 'function') {
      console.warn('[Nexus Bridge] applyWorkspaceNetwork is not available in current nexusCore build');
      return 'skip';
    }
    return await nexusCore.applyWorkspaceNetwork(workspaceId);
  }

  public async clearNetworkTopology(): Promise<string> {
    if (!nexusCore) throw new Error("Nexus Core engine is currently offline");
    if (typeof nexusCore.clearNetworkTopology !== 'function') {
      console.warn('[Nexus Bridge] clearNetworkTopology is not available in current nexusCore build');
      return 'skip';
    }
    return await nexusCore.clearNetworkTopology();
  }

  /**
   * Setup standard low-frequency IPC handlers (User Actions)
   */
  public setupIpcHandlers() {
    // 1. SPLIT PANE
    ipcMain.handle('nexus:split', async (event, payload: { targetPaneId: string, direction: 'horizontal' | 'vertical' }) => {
      if (!nexusCore) throw new Error("Nexus Core engine is currently offline");
      
      console.log(`[Nexus Bridge] Forwarding split action for pane ${payload.targetPaneId} to Rust Core...`);
      // Fast cross-boundary FFI call into Rust
      return await nexusCore.requestSplit(payload.targetPaneId, payload.direction);
    });

    // 2. TEAR OFF PANE (Multi-Window routing)
    ipcMain.handle('nexus:tear-off', async (event, payload: { paneId: string }) => {
      if (!nexusCore) throw new Error("Nexus Core engine is currently offline");
      
      console.log(`[Nexus Bridge] Requesting Rust Tear-off for ${payload.paneId}...`);
      return await nexusCore.requestTearOff(payload.paneId);
    });

    // 3. CLOSE PANE
    ipcMain.handle('nexus:close', async (event, payload: { paneId: string }) => {
      if (!nexusCore) throw new Error("Nexus Core engine is currently offline");
      return await nexusCore.requestClosePane(payload.paneId);
    });

    // 4. TOGGLE ZOOM
    ipcMain.handle('nexus:toggle-zoom', async (event, payload: { paneId: string }) => {
      if (!nexusCore) throw new Error("Nexus Core engine is currently offline");
      return await nexusCore.requestToggleZoom(payload.paneId);
    });

    // 5. REPLACE PANE
    ipcMain.handle('nexus:replace-pane', async (event, payload: { paneId: string, paneType: string, sessionId: string | null, configJson: string }) => {
      if (!nexusCore) throw new Error("Nexus Core engine is currently offline");
      return await nexusCore.requestReplacePane(payload.paneId, payload.paneType, payload.sessionId, payload.configJson);
    });

    // 5. REGISTER INITIAL TAB
    ipcMain.handle('nexus:register-tab', async (event, payload: { tabId: string, rootPaneId: string, sessionId: string, paneType: string, configJson: string, title: string }) => {
      if (nexusCore && typeof nexusCore.registerTab === 'function') {
        return await nexusCore.registerTab(payload.tabId, payload.rootPaneId, payload.sessionId, payload.paneType, payload.configJson, payload.title);
      }
      return null;
    });

    ipcMain.handle('nexus:update-sizes', async (event, payload: { paneId: string, sizes: number[] }) => {
      if (!nexusCore) throw new Error("Nexus Core engine is currently offline");
      return await nexusCore.requestUpdateSizes(payload.paneId, payload.sizes);
    });

    ipcMain.handle('nexus:set-disconnected', async (event, payload: { paneId: string, disconnected: boolean }) => {
      if (!nexusCore) throw new Error("Nexus Core engine is currently offline");
      return await nexusCore.requestPatchLeaf(payload.paneId, payload.disconnected);
    });

    ipcMain.handle('nexus:close-tab', async (event, payload: { tabId: string }) => {
      if (!nexusCore) throw new Error("Nexus Core engine is currently offline");
      return await nexusCore.requestCloseTab(payload.tabId);
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
    
    // Rust will call this JS callback via napi::threadsafe_function with raw binary Buffers
    if (typeof nexusCore.subscribePtyStream === 'function') {
      nexusCore.subscribePtyStream(sessionId, paneId, (chunk: Buffer) => {
         // Push to Chromium V8 renderer directly
         if (!webContents.isDestroyed()) {
           webContents.send(`pty:data:${paneId}`, chunk);
         }
      });
    }
  }
}

export const nexusBridge = new NexusBridge();
