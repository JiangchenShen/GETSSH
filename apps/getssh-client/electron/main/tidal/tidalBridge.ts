import { ipcMain } from 'electron';
import { EventEmitter } from 'events';
import { getRustCorePath } from '../utils/rustCorePath';
import { broadcastToAllWindows, isKnownTopLevelSender } from '../windowRegistry';

// N-API bindings for Rust tidal-engine
let tidalEngine: any = null;

try {
  // Safely attempt to load the N-API module
  tidalEngine = require(getRustCorePath('tidal-engine'));
  console.log('[Tidal Bridge] Successfully linked Rust tidal-engine binary');
} catch (e: any) {
  console.warn('[Tidal Bridge] Tidal Engine native module not found. Pane layout operations will report tidal_engine_unavailable.');
}

export const TIDAL_ENGINE_UNAVAILABLE = 'tidal_engine_unavailable';

/** One tab's layout as broadcast on 'tidal:sync-tree' (see the IPC contract). */
export interface TidalTabSync {
  tabId: string;
  rev: number;
  tree: any | null;
  title: string;
  isTornOff: boolean;
  workspaceId: string | null;
}

/** Renderer-facing result shape of every tidal:* request. */
export interface TidalResult {
  success: boolean;
  error?: string;
  [field: string]: unknown;
}

export type SessionTerminator = (sessionIds: string[]) => void | Promise<void>;

type CoreCall = { ok: true; value: any } | { ok: false; error: string };

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function normalizeTabSync(raw: any): TidalTabSync | null {
  if (!raw || typeof raw !== 'object' || !isNonEmptyString(raw.tabId)) return null;
  return {
    tabId: raw.tabId,
    rev: typeof raw.rev === 'number' ? raw.rev : 0,
    tree: raw.tree ?? null,
    title: typeof raw.title === 'string' ? raw.title : '',
    isTornOff: raw.isTornOff === true,
    workspaceId: typeof raw.workspaceId === 'string' ? raw.workspaceId : null,
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

/**
 * Bridge to the Rust layout engine. Rust owns the tab/pane trees; this class turns its JSON results into
 * `{ success, error?, ... }` for the renderer, re-broadcasts its sync payloads to every window (and as a
 * 'tab-sync' event for the window manager), and hands the session ids Rust removed to the session terminator.
 */
class TidalBridge extends EventEmitter {
  private broadcasterRegistered = false;
  private ipcRegistered = false;
  private unavailableLogged = false;
  private sessionTerminator: SessionTerminator | null = null;

  constructor() {
    super();
  }

  /** Registered by the SSH handlers: disconnects sessions whose panes Rust removed (must be idempotent). */
  public setSessionTerminator(fn: SessionTerminator) {
    this.sessionTerminator = fn;
  }

  public isAvailable(): boolean {
    return !!tidalEngine;
  }

  /**
   * Setup state broadcaster from Rust to Electron Renderer.
   * Independent of any window: payloads go to whatever windows exist when they arrive.
   */
  public setupStateBroadcaster() {
    if (this.broadcasterRegistered) return;
    if (!tidalEngine || typeof tidalEngine.registerSyncTreeCallback !== 'function') {
      this.logUnavailable('registerSyncTreeCallback');
      return;
    }
    try {
      tidalEngine.registerSyncTreeCallback((...args: any[]) => {
        // CalleeHandled TSFN: (err, json). Accept a bare (json) as well.
        const json = typeof args[0] === 'string' ? args[0] : args[1];
        if (args[0] instanceof Error) {
          console.error('[Tidal Bridge] SyncTree callback error:', args[0]);
          return;
        }
        if (typeof json !== 'string') return;
        let payload: TidalTabSync | null = null;
        try {
          payload = normalizeTabSync(JSON.parse(json));
        } catch (e) {
          console.error('[Tidal Bridge] Failed to parse sync-tree JSON:', e);
          return;
        }
        if (!payload) return;

        try {
          this.emit('tab-sync', payload);
        } catch (e) {
          console.error('[Tidal Bridge] tab-sync listener failed:', e);
        }
        broadcastToAllWindows('tidal:sync-tree', payload);
      });
      this.broadcasterRegistered = true;
    } catch (e) {
      console.warn('[Tidal Bridge] Failed to register state broadcaster callback:', e);
    }
  }

  private logUnavailable(fnName: string) {
    if (this.unavailableLogged) return;
    this.unavailableLogged = true;
    console.warn(`[Tidal Bridge] tidal-engine is unavailable (missing '${fnName}'); pane layout requests will fail.`);
  }

  /** Calls one Rust request function and parses its JSON result. Never throws. */
  private async callCore(fnName: string, ...args: unknown[]): Promise<CoreCall> {
    if (!tidalEngine || typeof tidalEngine[fnName] !== 'function') {
      this.logUnavailable(fnName);
      return { ok: false, error: TIDAL_ENGINE_UNAVAILABLE };
    }
    try {
      const raw = await tidalEngine[fnName](...args);
      return { ok: true, value: typeof raw === 'string' ? JSON.parse(raw) : raw ?? null };
    } catch (e: any) {
      console.error(`[Tidal Bridge] ${fnName} failed:`, e);
      return { ok: false, error: e?.message || String(e) };
    }
  }

  /** Maps Rust `{ok, reason, ...}` to `{success, error}`; `pick` copies the fields the caller needs. */
  private async request(fnName: string, args: unknown[], pick?: (value: any) => Record<string, unknown>): Promise<TidalResult> {
    const call = await this.callCore(fnName, ...args);
    if (!call.ok) return { success: false, error: call.error };
    const value = call.value;
    if (!value || typeof value !== 'object') return { success: false, error: 'invalid_tidal_response' };
    if (value.ok !== true) {
      return { success: false, error: isNonEmptyString(value.reason) ? value.reason : 'tidal_request_failed' };
    }
    return { success: true, ...(pick ? pick(value) : {}) };
  }

  private terminateSessions(sessionIds: string[]) {
    if (sessionIds.length === 0) return;
    if (!this.sessionTerminator) {
      console.warn('[Tidal Bridge] No session terminator registered; sessions left running:', sessionIds);
      return;
    }
    try {
      Promise.resolve(this.sessionTerminator(sessionIds)).catch((err) => {
        console.error('[Tidal Bridge] Session terminator failed:', err);
      });
    } catch (err) {
      console.error('[Tidal Bridge] Session terminator failed:', err);
    }
  }

  public split(targetPaneId: string, direction: 'horizontal' | 'vertical'): Promise<TidalResult> {
    return this.request('requestSplit', [targetPaneId, direction], v => ({ newPaneId: v.newPaneId, tabId: v.tabId }));
  }

  public async closePane(paneId: string): Promise<TidalResult> {
    const res = await this.request('requestClosePane', [paneId], v => ({
      tabId: v.tabId,
      tabClosed: v.tabClosed === true,
      removedSessionIds: stringList(v.removedSessionIds),
    }));
    if (res.success) this.terminateSessions(res.removedSessionIds as string[]);
    return res;
  }

  /** Closes a whole tab and disconnects every session that lived in it. */
  public async closeTab(tabId: string): Promise<TidalResult> {
    const res = await this.request('requestCloseTab', [tabId], v => ({ removedSessionIds: stringList(v.removedSessionIds) }));
    if (res.success) this.terminateSessions(res.removedSessionIds as string[]);
    return res;
  }

  public async replacePane(paneId: string, paneType: string, sessionId: string | null, configJson: string): Promise<TidalResult> {
    const res = await this.request('requestReplacePane', [paneId, paneType, sessionId, configJson], v => ({
      tabId: v.tabId,
      previousSessionId: isNonEmptyString(v.previousSessionId) ? v.previousSessionId : null,
    }));
    const previous = res.previousSessionId as string | null | undefined;
    if (res.success && previous && previous !== sessionId) this.terminateSessions([previous]);
    return res;
  }

  public toggleZoom(paneId: string): Promise<TidalResult> {
    return this.request('requestToggleZoom', [paneId]);
  }

  public updateSizes(splitPaneId: string, sizes: number[]): Promise<TidalResult> {
    return this.request('requestUpdateSizes', [splitPaneId, sizes]);
  }

  public setDisconnected(paneId: string, disconnected: boolean): Promise<TidalResult> {
    return this.request('requestPatchLeaf', [paneId, disconnected]);
  }

  public registerTab(tabId: string, rootPaneId: string, sessionId: string, paneType: string, configJson: string, title: string, workspaceId: string | null): Promise<TidalResult> {
    return this.request('registerTab', [tabId, rootPaneId, sessionId, paneType, configJson, title, workspaceId]);
  }

  /** Moves a pane (or a whole tab) into its own torn tab. Only the window manager calls this. */
  public requestTearOff(paneId: string): Promise<TidalResult> {
    return this.request('requestTearOff', [paneId], v => ({
      tabId: v.tabId,
      sourceTabId: v.sourceTabId,
      sessionIds: stringList(v.sessionIds),
      snapshot: normalizeTabSync(v.snapshot),
    }));
  }

  /**
   * Puts a torn tab back into the main window. `redocked` is true when Rust re-inserted the subtree into the
   * split it came from (then `targetTabId` is that origin tab); `paneId` is the first leaf of the returned subtree.
   */
  public requestTearIn(tabId: string): Promise<TidalResult> {
    return this.request('requestTearIn', [tabId], v => ({
      tabId: v.tabId,
      redocked: v.redocked === true,
      targetTabId: isNonEmptyString(v.targetTabId) ? v.targetTabId : v.tabId,
      paneId: isNonEmptyString(v.paneId) ? v.paneId : null,
    }));
  }

  /** Marks every leaf showing `sessionId` as disconnected (any tab, torn or not). `count` = leaves changed. */
  public markSessionDisconnected(sessionId: string): Promise<TidalResult> {
    if (!isNonEmptyString(sessionId)) return Promise.resolve({ success: false, error: 'invalid_arguments' });
    return this.request('requestMarkSessionDisconnected', [sessionId], v => ({
      count: typeof v.count === 'number' ? v.count : 0,
    }));
  }

  /** Current layout of one tab without bumping rev. `snapshot: null` means the tab no longer exists. */
  public async getTabSnapshot(tabId: string): Promise<{ success: true; snapshot: TidalTabSync | null } | { success: false; error: string }> {
    const call = await this.callCore('getTabSnapshot', tabId);
    if (!call.ok) return { success: false, error: call.error };
    return { success: true, snapshot: normalizeTabSync(call.value) };
  }

  public async bootstrapWorkspace(workspaceId: string): Promise<string> {
    if (!tidalEngine || typeof tidalEngine.bootstrapWorkspace !== 'function') return 'skip';
    try {
      return await tidalEngine.bootstrapWorkspace(workspaceId);
    } catch (e) {
      return 'skip';
    }
  }

  public async applyWorkspaceNetwork(workspaceId: string): Promise<string> {
    if (!tidalEngine || typeof tidalEngine.applyWorkspaceNetwork !== 'function') return 'skip';
    try {
      return await tidalEngine.applyWorkspaceNetwork(workspaceId);
    } catch (e) {
      return 'skip';
    }
  }

  public async clearNetworkTopology(): Promise<string> {
    if (!tidalEngine || typeof tidalEngine.clearNetworkTopology !== 'function') return 'skip';
    try {
      return await tidalEngine.clearNetworkTopology();
    } catch (e) {
      return 'skip';
    }
  }

  /**
   * Setup standard low-frequency IPC handlers (User Actions).
   * Tear-off / tear-in are not here: they only go through TornWindowManager.
   */
  public setupIpcHandlers() {
    if (this.ipcRegistered) return;
    this.ipcRegistered = true;

    const invalid: TidalResult = { success: false, error: 'invalid_arguments' };
    const unauthorized: TidalResult = { success: false, error: 'unauthorized' };

    // 1. SPLIT PANE
    ipcMain.handle('tidal:split', async (event, payload: { targetPaneId: string, direction: 'horizontal' | 'vertical' }) => {
      if (!isKnownTopLevelSender(event)) return unauthorized;
      if (!isNonEmptyString(payload?.targetPaneId) || (payload.direction !== 'horizontal' && payload.direction !== 'vertical')) return invalid;
      return this.split(payload.targetPaneId, payload.direction);
    });

    // 2. CLOSE PANE (sessions of removed leaves are disconnected here)
    ipcMain.handle('tidal:close', async (event, payload: { paneId: string }) => {
      if (!isKnownTopLevelSender(event)) return unauthorized;
      if (!isNonEmptyString(payload?.paneId)) return invalid;
      const res = await this.closePane(payload.paneId);
      return res.success ? { success: true, tabClosed: res.tabClosed } : res;
    });

    // 3. TOGGLE ZOOM
    ipcMain.handle('tidal:toggle-zoom', async (event, payload: { paneId: string }) => {
      if (!isKnownTopLevelSender(event)) return unauthorized;
      if (!isNonEmptyString(payload?.paneId)) return invalid;
      return this.toggleZoom(payload.paneId);
    });

    // 4. REPLACE PANE
    ipcMain.handle('tidal:replace-pane', async (event, payload: { paneId: string, paneType: string, sessionId: string | null, configJson: string }) => {
      if (!isKnownTopLevelSender(event)) return unauthorized;
      if (!isNonEmptyString(payload?.paneId) || !isNonEmptyString(payload.paneType)
        || (payload.sessionId !== null && payload.sessionId !== undefined && typeof payload.sessionId !== 'string')
        || typeof payload.configJson !== 'string') return invalid;
      const res = await this.replacePane(payload.paneId, payload.paneType, payload.sessionId || null, payload.configJson);
      return res.success ? { success: true } : res;
    });

    // 5. REGISTER INITIAL TAB
    ipcMain.handle('tidal:register-tab', async (event, payload: { tabId: string, rootPaneId: string, sessionId: string, paneType: string, configJson: string, title: string, workspaceId?: string | null }) => {
      if (!isKnownTopLevelSender(event)) return unauthorized;
      if (!isNonEmptyString(payload?.tabId) || !isNonEmptyString(payload.rootPaneId) || typeof payload.sessionId !== 'string'
        || !isNonEmptyString(payload.paneType) || typeof payload.configJson !== 'string' || typeof payload.title !== 'string') return invalid;
      const workspaceId = isNonEmptyString(payload.workspaceId) ? payload.workspaceId : null;
      return this.registerTab(payload.tabId, payload.rootPaneId, payload.sessionId, payload.paneType, payload.configJson, payload.title, workspaceId);
    });

    // 6. UPDATE SIZES
    ipcMain.handle('tidal:update-sizes', async (event, payload: { paneId: string, sizes: number[] }) => {
      if (!isKnownTopLevelSender(event)) return unauthorized;
      if (!isNonEmptyString(payload?.paneId) || !Array.isArray(payload.sizes) || !payload.sizes.every(n => typeof n === 'number')) return invalid;
      return this.updateSizes(payload.paneId, payload.sizes);
    });

    // 7. SET DISCONNECTED
    ipcMain.handle('tidal:set-disconnected', async (event, payload: { paneId: string, disconnected: boolean }) => {
      if (!isKnownTopLevelSender(event)) return unauthorized;
      if (!isNonEmptyString(payload?.paneId) || typeof payload.disconnected !== 'boolean') return invalid;
      return this.setDisconnected(payload.paneId, payload.disconnected);
    });

    // 8. CLOSE TAB (every session in the tab is disconnected here)
    ipcMain.handle('tidal:close-tab', async (event, payload: { tabId: string }) => {
      if (!isKnownTopLevelSender(event)) return unauthorized;
      if (!isNonEmptyString(payload?.tabId)) return invalid;
      const res = await this.closeTab(payload.tabId);
      return res.success ? { success: true } : res;
    });

    // 9. GET TAB SNAPSHOT (payload | null)
    ipcMain.handle('tidal:get-tab', async (event, payload: { tabId: string }) => {
      if (!isKnownTopLevelSender(event)) return null;
      if (!isNonEmptyString(payload?.tabId)) return null;
      const res = await this.getTabSnapshot(payload.tabId);
      return res.success ? res.snapshot : null;
    });
  }
}

export const tidalBridge = new TidalBridge();
