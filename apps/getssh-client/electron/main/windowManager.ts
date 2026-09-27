import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'path';
import { bindWindowEvents, getTornWindowOptions, setupSecurityPolicies } from './handlers/windowHandler';
import { nexusBridge, NexusTabSync } from './nexus/nexusBridge';
import { getMainWindow, isMainWebContents, sendToMainWindow } from './windowRegistry';

const TORN_MIN_WIDTH = 480;
const TORN_MIN_HEIGHT = 320;

interface TornIdentity {
  tabId: string;
  snapshot: NexusTabSync | null;
}

interface TearOffRequest {
  paneId: string;
  screenX: number;
  screenY: number;
  width: number;
  height: number;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Owns torn-off windows. Each torn window belongs to exactly one Rust tab:
 * - the window is created only after Rust has moved the pane into that tab;
 * - it is closed (without touching the tab) when the tab disappears or is torn back in;
 * - closing it as a user closes the tab, which disconnects its sessions.
 */
export class TornWindowManager {
  private static instance: TornWindowManager;
  private initialized = false;
  private appQuitting = false;
  /** Panes with a tear-off request in flight; released when that request finishes. */
  private tearingPanes = new Set<string>();
  /** webContents id -> identity. Kept until the window closes so a renderer reload can pull it again. */
  private tornIdentities = new Map<number, TornIdentity>();
  /** tabId -> torn window */
  private tabWindows = new Map<string, BrowserWindow>();
  /** Windows we close ourselves (tab torn in / gone / renderer failed): their 'closed' must not close the tab. */
  private releasedWindows = new WeakSet<BrowserWindow>();

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
   * Must run before the main window is created; it does not depend on the database.
   */
  public init() {
    if (this.initialized) return;
    this.initialized = true;
    this.setupIpc();
    nexusBridge.on('tab-sync', (payload: NexusTabSync) => this.handleTabSync(payload));
  }

  /** The app is really quitting: torn windows now close with it and must not close their tabs. */
  public prepareForQuit() {
    this.appQuitting = true;
  }

  private setupIpc() {
    // Tear-off: only the main window may request it. Rust moves the pane first; the window follows.
    ipcMain.handle('window:tear-off', async (event, payload: TearOffRequest) => {
      if (!isMainWebContents(event.sender)) return { success: false, error: 'unauthorized' };
      if (!payload || typeof payload.paneId !== 'string' || !payload.paneId
        || !isFiniteNumber(payload.screenX) || !isFiniteNumber(payload.screenY)
        || !isFiniteNumber(payload.width) || !isFiniteNumber(payload.height)) {
        return { success: false, error: 'invalid_arguments' };
      }
      if (this.appQuitting) return { success: false, error: 'app_quitting' };
      if (this.tearingPanes.has(payload.paneId)) return { success: false, error: 'tear_off_in_progress' };

      this.tearingPanes.add(payload.paneId);
      try {
        const res = await nexusBridge.requestTearOff(payload.paneId);
        if (!res.success || typeof res.tabId !== 'string') {
          return { success: false, error: res.error || 'tear_off_failed' };
        }
        const tabId = res.tabId;
        try {
          this.createTornWindow(tabId, (res.snapshot as NexusTabSync | null) ?? null, payload);
        } catch (err: any) {
          console.error('[TornWindowManager] Failed to create torn window:', err);
          await this.restoreOrphanTab(tabId);
          return { success: false, error: err?.message || 'window_create_failed' };
        }
        return { success: true };
      } finally {
        this.tearingPanes.delete(payload.paneId);
      }
    });

    // Identity of the calling torn window. Not consumed on read: a reloaded renderer pulls it again.
    ipcMain.handle('window:get-torn-identity', async (event) => {
      const identity = this.tornIdentities.get(event.sender.id);
      if (!identity) return null;
      const fresh = await nexusBridge.getTabSnapshot(identity.tabId);
      if (fresh.success) {
        const snapshot = fresh.snapshot;
        if (!snapshot || !snapshot.isTornOff || snapshot.tree === null) {
          // The tab is gone or no longer torn: this window has nothing left to show.
          const win = BrowserWindow.fromWebContents(event.sender);
          if (win) this.releaseWindow(win, identity.tabId);
          return null;
        }
        if (!identity.snapshot || snapshot.rev >= identity.snapshot.rev) identity.snapshot = snapshot;
      }
      return { tabId: identity.tabId, snapshot: identity.snapshot };
    });

    // Tear-in: the tab id comes from the sender's identity, never from the renderer.
    ipcMain.handle('window:tear-in', async (event) => {
      const identity = this.tornIdentities.get(event.sender.id);
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!identity || !win) return { success: false, error: 'not_a_torn_window' };
      if (this.releasedWindows.has(win)) return { success: true };

      const res = await nexusBridge.requestTearIn(identity.tabId);
      if (!res.success) return { success: false, error: res.error || 'tear_in_failed' };

      this.releaseWindow(win, identity.tabId);
      // Only for a user tear-in (not orphan restores). Rust emits the new layout under its lock before it
      // replies, so the sync reaches the main window ahead of this message.
      if (typeof res.targetTabId === 'string' && res.targetTabId && typeof res.paneId === 'string' && res.paneId) {
        sendToMainWindow('nexus:focus-pane', { tabId: res.targetTabId, paneId: res.paneId });
      }
      const main = getMainWindow();
      if (main) {
        if (main.isMinimized()) main.restore();
        main.show();
        main.focus();
      }
      return { success: true };
    });
  }

  private createTornWindow(tabId: string, snapshot: NexusTabSync | null, request: TearOffRequest) {
    // Clamp to the work area of the display the pane was dropped on.
    const { workArea } = screen.getDisplayNearestPoint({ x: Math.round(request.screenX), y: Math.round(request.screenY) });
    const width = clamp(Math.round(request.width), Math.min(TORN_MIN_WIDTH, workArea.width), workArea.width);
    const height = clamp(Math.round(request.height), Math.min(TORN_MIN_HEIGHT, workArea.height), workArea.height);
    const x = clamp(Math.round(request.screenX), workArea.x, workArea.x + workArea.width - width);
    const y = clamp(Math.round(request.screenY), workArea.y, workArea.y + workArea.height - height);

    const options = getTornWindowOptions(this.preload); // resizable; opaque on Windows (F23)
    options.x = x;
    options.y = y;
    options.width = width;
    options.height = height;
    options.minWidth = TORN_MIN_WIDTH;
    options.minHeight = TORN_MIN_HEIGHT;
    options.show = false; // Keep hidden until loaded to prevent visual flash

    const win = new BrowserWindow(options);
    const webContentsId = win.webContents.id;
    let closing = false;

    this.tornIdentities.set(webContentsId, { tabId, snapshot });
    this.tabWindows.set(tabId, win);

    setupSecurityPolicies(win.webContents, this.devServerUrl, this.indexHtml);
    bindWindowEvents(win);

    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        win.show();
        win.focus();
      }
    });

    // A torn window that cannot render must not hold its tab hostage: put the tab back into the main window.
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 /* ERR_ABORTED: superseded navigation */) return;
      console.error(`[TornWindowManager] Torn window failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
      void this.tearBackIn(win, tabId);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      if (closing) return;
      console.error(`[TornWindowManager] Torn window renderer gone (${details.reason}); tearing tab ${tabId} back in.`);
      void this.tearBackIn(win, tabId);
    });

    win.on('close', () => {
      closing = true;
    });

    win.on('closed', () => {
      this.tornIdentities.delete(webContentsId);
      if (this.tabWindows.get(tabId) === win) this.tabWindows.delete(tabId);
      if (this.releasedWindows.has(win) || this.appQuitting) return;
      // The user closed the window: the tab goes with it (the bridge disconnects its sessions).
      nexusBridge.closeTab(tabId).then((res) => {
        if (!res.success) console.error(`[TornWindowManager] Failed to close torn tab ${tabId}:`, res.error);
      });
    });

    if (app.isPackaged) {
      win.loadFile(join(__dirname, '../../dist/index.html'), { query: { isHollow: 'true' } });
    } else if (this.devServerUrl) {
      win.loadURL(`${this.devServerUrl}?isHollow=true`);
    } else {
      win.loadFile(this.indexHtml, { query: { isHollow: 'true' } });
    }
  }

  /** Rust sync for any tab: close a torn window whose tab disappeared or was torn back in. */
  private handleTabSync(payload: NexusTabSync) {
    const win = this.tabWindows.get(payload.tabId);
    if (!win) return;
    if (win.isDestroyed()) {
      this.tabWindows.delete(payload.tabId);
      return;
    }
    const identity = this.tornIdentities.get(win.webContents.id);
    // Ignore payloads emitted before this window's snapshot (delivery can interleave with the tear-off reply).
    if (identity?.snapshot && payload.rev > 0 && payload.rev <= identity.snapshot.rev) return;

    if (payload.tree === null || !payload.isTornOff) {
      this.releaseWindow(win, payload.tabId);
      return;
    }
    if (identity) identity.snapshot = payload;
  }

  /** Closes a torn window without closing its tab. */
  private releaseWindow(win: BrowserWindow, tabId: string) {
    this.releasedWindows.add(win);
    if (this.tabWindows.get(tabId) === win) this.tabWindows.delete(tabId);
    if (!win.isDestroyed()) win.close();
  }

  /** The torn renderer failed: move the tab back to the main window, then drop the window. */
  private async tearBackIn(win: BrowserWindow, tabId: string) {
    if (this.releasedWindows.has(win) || this.appQuitting) return;
    this.releasedWindows.add(win);
    if (this.tabWindows.get(tabId) === win) this.tabWindows.delete(tabId);
    await this.restoreOrphanTab(tabId);
    if (!win.isDestroyed()) win.destroy();
  }

  /** A torn tab without a window: tear it back in, or close it (disconnecting its sessions) if that fails. */
  private async restoreOrphanTab(tabId: string) {
    const res = await nexusBridge.requestTearIn(tabId);
    if (res.success) return;
    console.error(`[TornWindowManager] Tear-in of orphaned tab ${tabId} failed (${res.error}); closing it.`);
    const closed = await nexusBridge.closeTab(tabId);
    if (!closed.success) console.error(`[TornWindowManager] Failed to close orphaned tab ${tabId}:`, closed.error);
  }
}
