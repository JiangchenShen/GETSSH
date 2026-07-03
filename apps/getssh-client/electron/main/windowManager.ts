import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { getBrowserWindowOptions, setupSecurityPolicies } from './handlers/windowHandler';
import { nexusBridge } from './nexus/nexusBridge';

export class TornWindowManager {
  private static instance: TornWindowManager;
  private tearingPanes = new Set<string>();
  private tearingIdentities = new Map<number, any>();

  private preload: string;
  private devServerUrl?: string;
  private indexHtml: string;

  private constructor() {
    this.preload = join(__dirname, '../preload/index.js');
    this.devServerUrl = process.env.VITE_DEV_SERVER_URL;
    this.indexHtml = join(process.env.DIST!, 'index.html');
  }

  public static getInstance(): TornWindowManager {
    if (!TornWindowManager.instance) {
      TornWindowManager.instance = new TornWindowManager();
    }
    return TornWindowManager.instance;
  }

  /**
   * Initializes the manager and registers IPC channels.
   */
  public init() {
    this.setupIpc();
  }

  /**
   * Registers the Tear-off IPC state machine.
   */
  private setupIpc() {
    // 0. Provide hijack identity to mounting React instances safely
    ipcMain.handle('window:get-hijack-identity', (event) => {
      const identity = this.tearingIdentities.get(event.sender.id);
      if (identity) {
        // Now that the renderer is ready and pulled its identity, we can show it
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
          win.show();
          win.focus();
        }
        
        // Inform Rust state engine to detach pane
        nexusBridge.requestTearOff(identity.paneId).catch((err: any) => {
          console.error('[TornWindowManager] Failed to request tear-off in rust:', err);
        });
        
        // Remove from map to prevent memory leaks
        this.tearingIdentities.delete(event.sender.id);
        return identity;
      }
      return null;
    });

    // Phase 1: Pre-arm. Triggered when the drag starts on the frontend.
    ipcMain.on('window:tear-arm', (event) => {
      // Hollow window pool removed: simply ack the arming instantly.
      event.returnValue = true;
    });

    // Phase 2: Execute "Hijack". Triggered when the user drops the pane outside the bounds.
    ipcMain.on('window:tear-execute', (event, payload: { screenX: number, screenY: number, width: number, height: number, paneId: string, terminalBuffers?: Record<string, string>, tornTitle?: string }) => {
      if (this.tearingPanes.has(payload.paneId)) {
        console.warn(`[TornWindowManager] Tear-off ignored: ${payload.paneId} is already tearing.`);
        return;
      }
      this.tearingPanes.add(payload.paneId);
      setTimeout(() => this.tearingPanes.delete(payload.paneId), 1500);

      console.log(`[TornWindowManager] Tear-off EXECUTED for pane ${payload.paneId} at (${payload.screenX}, ${payload.screenY})`);

      // On-the-fly Window Creation
      const options = getBrowserWindowOptions(this.preload);
      options.x = Math.round(payload.screenX);
      options.y = Math.round(payload.screenY);
      options.width = Math.round(payload.width);
      options.height = Math.round(payload.height);
      options.show = false; // Keep hidden until loaded to prevent visual flash
      
      const win = new BrowserWindow(options);
      setupSecurityPolicies(win.webContents, this.devServerUrl, this.indexHtml);

      // Save the identity payload to be pulled by the renderer when it mounts
      this.tearingIdentities.set(win.webContents.id, {
        paneId: payload.paneId,
        terminalBuffers: payload.terminalBuffers,
        tornTitle: payload.tornTitle
      });

      if (app.isPackaged) {
        win.loadFile(join(__dirname, '../../dist/index.html'), { query: { isHollow: 'true' } });
      } else if (this.devServerUrl) {
        win.loadURL(`${this.devServerUrl}?isHollow=true`);
      } else {
        win.loadFile(this.indexHtml, { query: { isHollow: 'true' } });
      }

      // Cleanup pane when window is closed by the OS
      win.on('closed', () => {
        if (!(win as any).isTearingIn) {
           nexusBridge.requestClosePane(payload.paneId).catch((err: any) => {
             console.error('[TornWindowManager] Failed to request close pane in rust:', err);
           });
        }
      });
    });

    ipcMain.on('window:self-close', (event) => {
      const senderWin = BrowserWindow.fromWebContents(event.sender);
      if (senderWin) {
        senderWin.close();
      }
    });

    // Phase 3: Tear-in. Triggered when the user clicks Attach in the hollow window.
    ipcMain.on('window:tear-in', (event, payload: { paneId: string, terminalBuffers?: Record<string, string> }) => {
      console.log(`[TornWindowManager] Tear-in EXECUTED for pane ${payload.paneId}`);
      
      // 1. Broadcast the torn buffers back to the main window
      if (payload.terminalBuffers) {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.webContents.isDestroyed()) {
             win.webContents.send('window:receive-torn-buffers', payload.terminalBuffers);
          }
        }
      }

      // 2. Inform Rust state engine to attach pane
      nexusBridge.requestTearIn(payload.paneId).catch(err => {
        console.error('[TornWindowManager] Failed to request tear-in in rust:', err);
      });

      // 3. Close the hollow window that initiated the tear-in
      const senderWin = BrowserWindow.fromWebContents(event.sender);
      if (senderWin) {
        (senderWin as any).isTearingIn = true;
        senderWin.close();
      }
    });
  }
}
