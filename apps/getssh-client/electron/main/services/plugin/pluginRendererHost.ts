import { ipcMain, session as electronSession, WebContentsView } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, Session, WebContents, WebFrameMain } from 'electron';
import { isMainWebContents, sendToMainWindow } from '../../windowRegistry';
import { PLUGIN_PAGE_SCHEME, createPluginPageHandler, withRendererLocale, type PluginRendererPage } from './pluginPageProtocol';

/**
 * Each plugin's renderer.js runs in a WebContents of its own, made here in the main process and
 * shown in no window, on a session of its own:
 * - the session lives in memory only, serves only that plugin's files, cancels every request that
 *   is not getssh-plugin://, sends whatever else gets out (WebRTC over TCP) to a proxy nobody
 *   answers, loopback included, and refuses permissions and downloads;
 * - the page cannot navigate away, open windows or show dialogs, and its preload
 *   (electron/preload/pluginRenderer.ts) gives it window.GETSSH and no RTCPeerConnection;
 * - the main process tells plugins apart by WebContents, never by what a message says, checks what
 *   they register and passes it to the main window only.
 *
 * In the main window renderer.js ran in a sandboxed iframe; the page keeps that iframe's opaque
 * origin through the sandbox in its CSP (RENDERER_PAGE_SANDBOX in pluginPageProtocol.ts).
 */

/** The one channel a renderer.js page may send on (index.ts refuses all others from it). */
export const PLUGIN_RENDERER_ACTION_CHANNEL = 'plugin-renderer:action';
/** Main process to a renderer.js page: { event: 'envChange', theme, locale } or { event: 'sidebarClick', actionId }. */
export const PLUGIN_RENDERER_EVENT_CHANNEL = 'plugin-renderer:event';
/** Main process to the main window: a checked call, { pluginId, action, payload }. */
export const PLUGIN_RENDERER_UI_CHANNEL = 'plugin-renderer:ui';
/** Main process to the main window: the plugin's renderer.js stopped; its sidebar actions go. */
export const PLUGIN_RENDERER_GONE_CHANNEL = 'plugin-renderer:gone';
/** Main window: what renderer.js pages registered so far, for a window that (re)loaded later. */
export const PLUGIN_RENDERER_STATE_CHANNEL = 'plugin-renderer:get-state';
/** Main window: a click on a sidebar action renderer.js registered. */
export const PLUGIN_RENDERER_SIDEBAR_CLICK_CHANNEL = 'plugin-renderer:sidebar-click';
/** Main window: the app's theme and language, for onThemeChange() and getLocale(). */
export const PLUGIN_RENDERER_ENV_CHANNEL = 'plugin-renderer:env';

// A loopback port nothing listens on: with '<-loopback>' even 127.0.0.1 goes through it.
const UNREACHABLE_PROXY = 'http://127.0.0.1:1';

// What a page may register; the main window checks the same again (src/plugins/PluginBridge.ts).
const MAX_SIDEBAR_ACTIONS = 8;
const MAX_ACTION_ID_LENGTH = 64;
const MAX_ICON_LENGTH = 32 * 1024;
const MAX_LABEL_LENGTH = 128;
const MAX_PANELS = 16;
const MAX_PANEL_ID_LENGTH = 128;
const MAX_PANEL_TITLE_LENGTH = 128;
const MAX_PANEL_URL_LENGTH = 2048;
const OPEN_PANEL_INTERVAL_MS = 1000;
// The main window counts a plugin's notifications from its pages and renderer.js together: 3 in
// any 30 seconds. This count only keeps a page from flooding the window.
const NOTIFICATION_WINDOW_MS = 30_000;
const MAX_NOTIFICATIONS = 3;
const MAX_NOTIFICATION_TITLE_LENGTH = 256;
const MAX_NOTIFICATION_BODY_LENGTH = 4096;
const MAX_MESSAGES_PER_SECOND = 100;
const MAX_MESSAGE_LENGTH = 64 * 1024;
const MAX_THEME_LENGTH = 32;
// Errors of a page that go to the main process log, for the plugin's author.
const MAX_LOGGED_ERRORS = 20;
const MAX_LOGGED_ERROR_LENGTH = 500;
const LOCALE_TAG = /^[a-z]{2,8}(?:-[a-z0-9]{1,8}){0,4}$/i;

type RendererCall =
  | { action: 'registerSidebarAction'; payload: { id: string; icon: string; label: string } }
  | { action: 'registerPanel'; payload: { panelId: string; title: string; renderUrl: string } }
  | { action: 'openPanel'; payload: { panelId: string } }
  | { action: 'showNotification'; payload: { title: string; body: string } };

export type PluginRendererUiCall = RendererCall & { pluginId: string };

interface RendererEntry {
  pluginId: string;
  url: string;
  view: WebContentsView;
  contents: WebContents;
  stopped: boolean;
  /** The start page has committed: any later document means the page left it. */
  committed: boolean;
  loggedErrors: number;
  actions: Map<string, { icon: string; label: string }>;
  panels: Map<string, { title: string; renderUrl: string }>;
  lastPanelOpen: number;
  notifications: number[];
  messages: { windowStart: number; count: number };
}

// The WebContents of renderer.js pages, for the IPC guard in index.ts.
const rendererContents = new Set<number>();

/** True when an IPC message comes from a renderer.js page. */
export function isPluginRendererSender(event: { sender?: { id: number } | null } | null | undefined): boolean {
  return !!event?.sender && rendererContents.has(event.sender.id);
}

/** What a plugin's session serves on getssh-plugin://: that plugin's own files, nothing else. */
export function rendererPageHandler(pluginsDir: string, pluginId: string): (request: Request) => Promise<Response> {
  return createPluginPageHandler(pluginsDir, { plugin: pluginId });
}

/**
 * The session setup a renderer.js page gets: requests other than the plugin's own files are
 * cancelled, the rest of the network meets a proxy nobody answers, and nothing is granted.
 */
export async function configureRendererSession(ses: Session, pluginId: string, pluginsDir: string): Promise<void> {
  await ses.setProxy({ mode: 'fixed_servers', proxyRules: UNREACHABLE_PROXY, proxyBypassRules: '<-loopback>' });
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(`${PLUGIN_PAGE_SCHEME}:`) }));
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', event => event.preventDefault());
  ses.protocol.handle(PLUGIN_PAGE_SCHEME, rendererPageHandler(pluginsDir, pluginId));
}

function isOwnPluginPage(url: string, pluginId: string): boolean {
  if (url.length > MAX_PANEL_URL_LENGTH) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${PLUGIN_PAGE_SCHEME}:` && parsed.hostname.toLowerCase() === pluginId.toLowerCase();
  } catch {
    return false;
  }
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

export interface PluginRendererHostOptions {
  pluginsDir: string;
  /** The preload of renderer.js pages (dist-electron/plugin-preload/pluginRenderer.js). */
  preload: string;
  /** Session names are `<prefix>:<plugin>`, never persisted. */
  partitionPrefix?: string;
  /** Sets up a plugin's session once, before its first page; configureRendererSession by default. */
  configureSession?: (ses: Session, pluginId: string) => Promise<void>;
}

export class PluginRendererHost {
  private entries = new Map<string, RendererEntry>();
  private byContents = new Map<number, RendererEntry>();
  /** The page each plugin had when Chromium ended its process: not started again until it changes. */
  private endedPages = new Map<string, string>();
  private configured = new Set<string>();
  private env: { theme?: string; locale?: string } = {};
  private ipcListeners: Array<[string, (...args: any[]) => void]> = [];

  constructor(private options: PluginRendererHostOptions) {}

  private sessionFor(pluginId: string): Session {
    return electronSession.fromPartition(`${this.options.partitionPrefix ?? 'getssh-plugin-renderer'}:${pluginId}`);
  }

  /** The WebContents a plugin's renderer.js runs in, while it runs. */
  public contentsFor(pluginId: string): WebContents | undefined {
    return this.entries.get(pluginId)?.contents;
  }

  /**
   * Starts, replaces or stops renderer.js pages to match `pages`: a page whose URL is unchanged
   * keeps running, a changed URL (an update) replaces it, a plugin no longer listed stops.
   */
  public async sync(pages: ReadonlyArray<PluginRendererPage>): Promise<void> {
    const wanted = new Map(pages.map(page => [page.pluginId, page.url]));
    for (const [pluginId, entry] of [...this.entries]) {
      if (wanted.get(pluginId) !== entry.url) this.stop(pluginId);
    }
    for (const [pluginId, url] of [...this.endedPages]) {
      if (wanted.get(pluginId) !== url) this.endedPages.delete(pluginId);
    }
    for (const [pluginId, url] of wanted) {
      if (this.entries.has(pluginId) || this.endedPages.has(pluginId)) continue;
      try {
        await this.start(pluginId, url);
      } catch (error) {
        console.error(`[PluginRenderer] renderer.js of plugin '${pluginId}' did not start:`, error instanceof Error ? error.message : error);
      }
    }
  }

  /** Stops every renderer.js page (quit). */
  public destroyAll(): void {
    for (const pluginId of [...this.entries.keys()]) this.stop(pluginId);
  }

  private async start(pluginId: string, url: string): Promise<void> {
    const ses = this.sessionFor(pluginId);
    if (!this.configured.has(pluginId)) {
      const configure = this.options.configureSession ?? ((s: Session, id: string) => configureRendererSession(s, id, this.options.pluginsDir));
      await configure(ses, pluginId);
      this.configured.add(pluginId);
    } else {
      // An updated plugin starts with nothing its old version kept.
      await ses.clearStorageData();
      await ses.clearCache();
    }
    if (this.entries.has(pluginId)) return;

    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        preload: this.options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        disableDialogs: true,
        backgroundThrottling: false,
        spellcheck: false,
        navigateOnDragDrop: false,
      },
    });
    const contents = view.webContents;
    const entry: RendererEntry = {
      pluginId, url, view, contents, stopped: false, committed: false, loggedErrors: 0,
      actions: new Map(), panels: new Map(), lastPanelOpen: -Infinity, notifications: [],
      messages: { windowStart: 0, count: 0 },
    };
    this.entries.set(pluginId, entry);
    this.byContents.set(contents.id, entry);
    rendererContents.add(contents.id);

    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // The page stays where it was started. Electron 44 emits no will-navigate for a page in a
    // WebContentsView, only will-frame-navigate; a sandboxed <a download> navigates the page too.
    contents.on('will-frame-navigate', event => { if (event.isMainFrame) event.preventDefault(); });
    contents.on('will-navigate', event => event.preventDefault());
    contents.on('will-redirect', event => event.preventDefault());
    // A navigation outside its Connection-Allowlist Chromium turns into an error page before
    // Electron sees it: a page that ends up anywhere but its start page is over.
    contents.on('did-navigate', () => {
      if (entry.committed) this.end(entry, 'it left its page');
      entry.committed = true;
    });
    contents.on('did-fail-load', (_event, errorCode, description, _url, isMainFrame) => {
      // ERR_ABORTED (-3): a navigation of the page that was stopped above; the page is still there.
      if (isMainFrame && errorCode !== -3) this.end(entry, `its page failed: ${description}`);
    });
    // A beforeunload handler must not keep the page (and quitting) waiting.
    contents.on('will-prevent-unload', event => event.preventDefault());
    contents.on('did-finish-load', () => this.sendEnv(entry));
    // No DevTools of the main window reach this page: its first errors go to the main process log.
    contents.on('console-message', details => {
      if (details.level !== 'error' || entry.loggedErrors >= MAX_LOGGED_ERRORS) return;
      entry.loggedErrors++;
      console.warn(`[PluginRenderer] ${pluginId}: ${String(details.message).slice(0, MAX_LOGGED_ERROR_LENGTH)} (${details.sourceId}:${details.lineNumber})`);
    });
    contents.on('render-process-gone', (_event, details) => this.end(entry, `its process ended (${details.reason})`));
    contents.loadURL(withRendererLocale(url, this.env.locale)).catch((error: { errno?: number; message?: string }) => {
      // ERR_ABORTED: the page stopped one of its own navigations before it finished loading.
      if (!entry.stopped && error?.errno !== -3) console.warn(`[PluginRenderer] renderer.js page of plugin '${pluginId}' did not load:`, error?.message ?? error);
    });
  }

  private forget(entry: RendererEntry): void {
    entry.stopped = true;
    if (this.entries.get(entry.pluginId) === entry) this.entries.delete(entry.pluginId);
    this.byContents.delete(entry.contents.id);
    rendererContents.delete(entry.contents.id);
    if (!entry.contents.isDestroyed()) entry.contents.close();
    sendToMainWindow(PLUGIN_RENDERER_GONE_CHANNEL, entry.pluginId);
  }

  private stop(pluginId: string): void {
    const entry = this.entries.get(pluginId);
    if (entry) this.forget(entry);
  }

  /**
   * The page is over (its process ended, or it left its start page): its actions go, and it
   * waits for an update or a restart.
   */
  private end(entry: RendererEntry, reason: string): void {
    if (entry.stopped) return;
    console.warn(`[PluginRenderer] renderer.js of plugin '${entry.pluginId}' stopped: ${reason}. It runs again after an update or a restart.`);
    this.endedPages.set(entry.pluginId, entry.url);
    this.forget(entry);
  }

  private sendEnv(entry: RendererEntry): void {
    if (entry.stopped || entry.contents.isDestroyed() || (!this.env.theme && !this.env.locale)) return;
    entry.contents.send(PLUGIN_RENDERER_EVENT_CHANNEL, { event: 'envChange', ...this.env });
  }

  /** What renderer.js pages registered so far, as calls the main window replays. */
  public state(): PluginRendererUiCall[] {
    const calls: PluginRendererUiCall[] = [];
    for (const entry of this.entries.values()) {
      for (const [id, action] of entry.actions) calls.push({ pluginId: entry.pluginId, action: 'registerSidebarAction', payload: { id, ...action } });
      for (const [panelId, panel] of entry.panels) calls.push({ pluginId: entry.pluginId, action: 'registerPanel', payload: { panelId, ...panel } });
    }
    return calls;
  }

  /** A call from a renderer.js page, checked and passed to the main window; anything else is dropped. */
  public handleAction(sender: WebContents, senderFrame: WebFrameMain | null | undefined, action: unknown, payload: unknown): void {
    const entry = this.byContents.get(sender.id);
    if (!entry || entry.stopped || (senderFrame && senderFrame.parent)) return;
    const now = Date.now();
    if (now - entry.messages.windowStart >= 1000) entry.messages = { windowStart: now, count: 0 };
    if (++entry.messages.count > MAX_MESSAGES_PER_SECOND) return;
    let length: number;
    try {
      length = JSON.stringify(payload ?? null).length;
    } catch {
      return;
    }
    if (length > MAX_MESSAGE_LENGTH || !payload || typeof payload !== 'object') return;
    const call = this.check(entry, action, payload as Record<string, unknown>, now);
    if (call) sendToMainWindow(PLUGIN_RENDERER_UI_CHANNEL, { pluginId: entry.pluginId, ...call });
  }

  private check(entry: RendererEntry, action: unknown, payload: Record<string, unknown>, now: number): RendererCall | null {
    const { pluginId } = entry;
    switch (action) {
      case 'registerSidebarAction': {
        const id = text(payload.id, MAX_ACTION_ID_LENGTH);
        const icon = typeof payload.icon === 'string' ? payload.icon : '';
        if (!id || icon.length > MAX_ICON_LENGTH) return null;
        if (!entry.actions.has(id) && entry.actions.size >= MAX_SIDEBAR_ACTIONS) {
          console.warn(`[PluginRenderer] Plugin '${pluginId}' already has ${MAX_SIDEBAR_ACTIONS} sidebar actions; '${id}' was not registered`);
          return null;
        }
        const label = String(payload.label ?? '').slice(0, MAX_LABEL_LENGTH);
        entry.actions.set(id, { icon, label });
        return { action, payload: { id, icon, label } };
      }
      case 'registerPanel': {
        const panelId = typeof payload.panelId === 'string' ? payload.panelId : '';
        const renderUrl = typeof payload.renderUrl === 'string' ? payload.renderUrl : '';
        // Another plugin's page in this plugin's panel would run under that plugin's id.
        if (!panelId || panelId.length > MAX_PANEL_ID_LENGTH || !isOwnPluginPage(renderUrl, pluginId)) {
          console.warn(`[PluginRenderer] Plugin '${pluginId}' sent an invalid panel; a panel shows a ${PLUGIN_PAGE_SCHEME}://${pluginId}/ page`);
          return null;
        }
        if (!entry.panels.has(panelId) && entry.panels.size >= MAX_PANELS) return null;
        const title = String(payload.title ?? '').slice(0, MAX_PANEL_TITLE_LENGTH);
        entry.panels.set(panelId, { title, renderUrl });
        return { action, payload: { panelId, title, renderUrl } };
      }
      case 'openPanel': {
        const panelId = typeof payload.panelId === 'string' ? payload.panelId : '';
        if (!panelId || panelId.length > MAX_PANEL_ID_LENGTH || now - entry.lastPanelOpen < OPEN_PANEL_INTERVAL_MS) return null;
        entry.lastPanelOpen = now;
        return { action, payload: { panelId } };
      }
      case 'showNotification': {
        entry.notifications = entry.notifications.filter(time => now - time < NOTIFICATION_WINDOW_MS);
        if (entry.notifications.length >= MAX_NOTIFICATIONS) return null;
        entry.notifications.push(now);
        return { action, payload: { title: text(payload.title, MAX_NOTIFICATION_TITLE_LENGTH), body: text(payload.body, MAX_NOTIFICATION_BODY_LENGTH) } };
      }
      default:
        return null;
    }
  }

  /** A click on a sidebar action, from the main window: to the renderer.js page that registered it. */
  public sidebarClick(sender: WebContents, pluginId: unknown, actionId: unknown): void {
    if (!isMainWebContents(sender) || typeof pluginId !== 'string' || typeof actionId !== 'string') return;
    const entry = this.entries.get(pluginId);
    if (!entry || !entry.actions.has(actionId) || entry.contents.isDestroyed()) return;
    entry.contents.send(PLUGIN_RENDERER_EVENT_CHANNEL, { event: 'sidebarClick', actionId });
  }

  /** The app's theme and language, from the main window: kept for new pages, sent to running ones. */
  public setEnv(sender: WebContents, env: unknown): void {
    if (!isMainWebContents(sender) || !env || typeof env !== 'object') return;
    const { theme, locale } = env as { theme?: unknown; locale?: unknown };
    this.env = {
      theme: typeof theme === 'string' && theme.length <= MAX_THEME_LENGTH ? theme : undefined,
      locale: typeof locale === 'string' && LOCALE_TAG.test(locale) ? locale : undefined,
    };
    for (const entry of this.entries.values()) this.sendEnv(entry);
  }

  public registerIpc(): void {
    const on = (channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void) => {
      ipcMain.on(channel, listener);
      this.ipcListeners.push([channel, listener]);
    };
    on(PLUGIN_RENDERER_ACTION_CHANNEL, (event, action, payload) => this.handleAction(event.sender, event.senderFrame, action, payload));
    on(PLUGIN_RENDERER_SIDEBAR_CLICK_CHANNEL, (event, pluginId, actionId) => this.sidebarClick(event.sender, pluginId, actionId));
    on(PLUGIN_RENDERER_ENV_CHANNEL, (event, env) => this.setEnv(event.sender, env));
    ipcMain.handle(PLUGIN_RENDERER_STATE_CHANNEL, (event: IpcMainInvokeEvent) => (isMainWebContents(event.sender) ? this.state() : []));
  }

  /** Undoes registerIpc and stops every page (tests). */
  public dispose(): void {
    for (const [channel, listener] of this.ipcListeners) ipcMain.removeListener(channel, listener);
    this.ipcListeners = [];
    ipcMain.removeHandler(PLUGIN_RENDERER_STATE_CHANNEL);
    this.destroyAll();
  }
}
