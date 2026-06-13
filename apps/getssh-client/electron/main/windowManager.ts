import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { getBrowserWindowOptions, setupSecurityPolicies } from './handlers/windowHandler';
import { nexusBridge } from './nexus/nexusBridge';

export class HollowWindowPool {
  private static instance: HollowWindowPool;
  private pool: BrowserWindow[] = [];
  private readonly POOL_SIZE = 2;

  private preload: string;
  private devServerUrl?: string;
  private indexHtml: string;

  private constructor() {
    this.preload = join(__dirname, '../preload/index.js');
    this.devServerUrl = process.env.VITE_DEV_SERVER_URL;
    this.indexHtml = join(process.env.DIST!, 'index.html');
  }

  public static getInstance(): HollowWindowPool {
    if (!HollowWindowPool.instance) {
      HollowWindowPool.instance = new HollowWindowPool();
    }
    return HollowWindowPool.instance;
  }

  /**
   * Initializes the pool and registers IPC channels.
   */
  public init() {
    this.setupIpc();
    // Pre-warm the pool asynchronously to avoid blocking the main app boot
    setTimeout(() => this.fillPool(), 2000);
  }

  /**
   * Asynchronously tops up the pool to POOL_SIZE without blocking the main thread.
   */
  private fillPool() {
    const createNext = () => {
      if (this.pool.length < this.POOL_SIZE) {
        this.createHollowWindow();
        setTimeout(createNext, 300); // 300ms gap to avoid CPU spikes
      }
    };
    createNext();
  }

  /**
   * Spawns a new invisible, zero-opacity BrowserWindow.
   */
  private createHollowWindow() {
    const options = getBrowserWindowOptions(this.preload);
    
    // Core Hollow Properties
    options.show = false;
    options.opacity = 0;
    
    const win = new BrowserWindow(options);
    setupSecurityPolicies(win.webContents, this.devServerUrl, this.indexHtml);

    // Load the app URL
    if (app.isPackaged) {
      win.loadFile(join(__dirname, '../../dist/index.html'));
    } else if (this.devServerUrl) {
      win.loadURL(this.devServerUrl);
    } else {
      win.loadFile(this.indexHtml);
    }

    this.pool.push(win);
    console.log(`[HollowWindowPool] Pre-warmed window created. Pool size: ${this.pool.length}`);
  }

  /**
   * Registers the Tear-off IPC state machine.
   */
  private setupIpc() {
    // Phase 1: Pre-arm. Triggered when the drag starts on the frontend.
    ipcMain.on('window:tear-arm', (event) => {
      console.log('[HollowWindowPool] Tear-off ARMED. Preparing window...');
      if (this.pool.length === 0) {
        this.createHollowWindow();
      }
      // Respond to frontend that we are ready
      event.returnValue = true;
    });

    // Phase 2: Execute "Hijack". Triggered when the user drops the pane outside the bounds.
    ipcMain.on('window:tear-execute', (event, payload: { screenX: number, screenY: number, width: number, height: number, paneId: string }) => {
      console.log(`[HollowWindowPool] Tear-off EXECUTED for pane ${payload.paneId} at (${payload.screenX}, ${payload.screenY})`);
      
      let win = this.pool.pop();
      if (!win || win.isDestroyed()) {
        console.warn('[HollowWindowPool] Pool empty! Falling back to synchronous creation.');
        this.createHollowWindow();
        win = this.pool.pop()!;
      }

      // 1. Move to the physical drop coordinates
      win.setBounds({
        x: Math.round(payload.screenX),
        y: Math.round(payload.screenY),
        width: Math.round(payload.width),
        height: Math.round(payload.height)
      });

      // 2. Transmit the hijacking metadata to the window's React app
      win.webContents.send('window:hijack-identity', { paneId: payload.paneId });

      // 3. Inform Rust state engine to detach pane
      nexusBridge.requestTearOff(payload.paneId).catch(err => {
        console.error('[HollowWindowPool] Failed to request tear-off in rust:', err);
      });

      // 4. Make visible instantly
      win.setOpacity(1);
      win.show();
      win.focus();

      // 4. Dispatch refill asynchronously
      setTimeout(() => this.fillPool(), 500);
    });
  }
}
