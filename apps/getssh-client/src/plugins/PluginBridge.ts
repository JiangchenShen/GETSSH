import { usePluginStore } from '../store/pluginStore';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { sanitizeSVG } from './svgSanitizer';

/**
 * PluginBridge - Secure message router between sandboxed plugin iframes and the host app.
 * Only whitelisted API calls are forwarded. Dangerous operations (sshWrite, saveProfiles, etc.) are blocked.
 */

const ALLOWED_ACTIONS = new Set([
  'registerSidebarAction',
  'registerPanel',
  'openPanel',
  'showNotification',
  'getActiveSessionId',
]);

const BLOCKED_ACTIONS = new Set([
  'sshWrite',
  'sshConnect',
  'sshDisconnect',
  'saveProfiles',
  'unlockProfiles',
  'sftpWriteFile',
  'sftpDelete',
]);

/**
 * Panels one plugin page may register, and how often it may open one. Each opened panel is a tab
 * with its own iframe; a page that registered and opened new panels on a timer added them without
 * limit.
 */
const MAX_PANELS_PER_PLUGIN = 16;
const OPEN_PANEL_INTERVAL_MS = 1000;
// A panel shows one of its plugin's own pages; its id and title are capped like a sidebar label.
const MAX_PANEL_ID_LENGTH = 128;
const MAX_PANEL_TITLE_LENGTH = 128;
const MAX_PANEL_URL_LENGTH = 2048;
const panelsByPlugin = new Map<string, Set<string>>();
// Sidebar actions need no capability: a page registering fresh ids in a loop, with large icons,
// must not fill the main window's memory.
const MAX_SIDEBAR_ACTIONS_PER_PLUGIN = 8;
const MAX_SIDEBAR_ICON_LENGTH = 32 * 1024;
const sidebarActionsByPlugin = new Map<string, Set<string>>();
const lastPanelOpen = new Map<string, number>();

/** Marks the hidden frame a plugin's renderer.js runs in (bootSandboxedPlugins). */
const RENDERER_FRAME_ATTR = 'data-plugin-renderer';

function pluginFrames(): HTMLIFrameElement[] {
  return [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-plugin-id]')];
}

function rendererFrames(): HTMLIFrameElement[] {
  return pluginFrames().filter(frame => frame.hasAttribute(RENDERER_FRAME_ATTR));
}

/** getssh-plugin://<plugin>/…: the host is the plugin folder, compared like a URL host. */
function isOwnPluginPage(url: string, pluginId: string): boolean {
  if (url.length > MAX_PANEL_URL_LENGTH) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'getssh-plugin:' && parsed.hostname.toLowerCase() === pluginId.toLowerCase();
  } catch {
    return false;
  }
}

function handlePluginMessage(event: MessageEvent) {
  // Only accept messages from sandboxed iframes (origin will be 'null' for sandbox)
  const data = event.data;
  if (!data || !data.__getssh_plugin) return;

  const { action, payload } = data;

  // The plugin is the one whose frame sent the message, never the id the message names: a
  // page naming other ids (or a CSS selector) would get a fresh limit for each.
  const source = event.source;
  const pluginId = pluginFrames().find(frame => frame.contentWindow === source)?.getAttribute('data-plugin-id');
  if (!pluginId) return;

  if (BLOCKED_ACTIONS.has(action)) {
    console.warn(`[PluginBridge] BLOCKED dangerous action "${action}" from plugin "${pluginId}"`);
    return;
  }

  if (!ALLOWED_ACTIONS.has(action)) {
    console.warn(`[PluginBridge] Unknown action "${action}" from plugin "${pluginId}"`);
    return;
  }

  switch (action) {
    case 'registerSidebarAction': {
      const actionId = typeof payload?.id === 'string' ? payload.id.slice(0, 64) : '';
      const icon = typeof payload?.icon === 'string' ? payload.icon : '';
      if (!actionId || icon.length > MAX_SIDEBAR_ICON_LENGTH) {
        console.warn(`[PluginBridge] Plugin "${pluginId}" sent an invalid sidebar action`);
        break;
      }
      const actions = sidebarActionsByPlugin.get(pluginId) ?? new Set<string>();
      if (!actions.has(actionId) && actions.size >= MAX_SIDEBAR_ACTIONS_PER_PLUGIN) {
        console.warn(`[PluginBridge] Plugin "${pluginId}" already has ${MAX_SIDEBAR_ACTIONS_PER_PLUGIN} sidebar actions; "${actionId}" was not registered`);
        break;
      }
      actions.add(actionId);
      sidebarActionsByPlugin.set(pluginId, actions);
      usePluginStore.getState().registerSidebarAction({
        id: `plugin-${pluginId}-${actionId}`,
        pluginId,
        icon: sanitizeSVG(icon),
        label: String(payload.label ?? '').slice(0, 128),
        onClick: () => {
          // The handler (window.__sidebarHandlers) is in the page that registered the action:
          // renderer.js, or an open panel. Panels come before the hidden renderer.js frames in
          // the document, so the plugin's first frame is not necessarily that page.
          const frames = pluginFrames();
          const iframe = frames.find(frame => frame.contentWindow === source)
            ?? frames.find(frame => frame.getAttribute('data-plugin-id') === pluginId && frame.hasAttribute(RENDERER_FRAME_ATTR))
            ?? frames.find(frame => frame.getAttribute('data-plugin-id') === pluginId);
          iframe?.contentWindow?.postMessage({ __getssh_host: true, event: 'sidebarClick', actionId }, '*');
        }
      });
      break;
    }

    case 'registerPanel': {
      const panelId = typeof payload?.panelId === 'string' ? payload.panelId : '';
      const renderUrl = typeof payload?.renderUrl === 'string' ? payload.renderUrl : '';
      // Another plugin's page in this plugin's panel would run under that plugin's id (PluginPane
      // takes the id from the URL), with this plugin's title on the tab.
      if (!panelId || panelId.length > MAX_PANEL_ID_LENGTH || !isOwnPluginPage(renderUrl, pluginId)) {
        console.warn(`[PluginBridge] Plugin "${pluginId}" sent an invalid panel; a panel shows a getssh-plugin://${pluginId}/ page`);
        break;
      }
      const panels = panelsByPlugin.get(pluginId) ?? new Set<string>();
      if (!panels.has(panelId) && panels.size >= MAX_PANELS_PER_PLUGIN) {
        console.warn(`[PluginBridge] Plugin "${pluginId}" already has ${MAX_PANELS_PER_PLUGIN} panels; "${panelId}" was not registered`);
        break;
      }
      const title = String(payload.title ?? '').slice(0, MAX_PANEL_TITLE_LENGTH);
      if (useSessionStore.getState().registerPluginPanel(pluginId, panelId, title, renderUrl)) {
        panels.add(panelId);
        panelsByPlugin.set(pluginId, panels);
      }
      break;
    }

    case 'openPanel': {
      const now = Date.now();
      if (now - (lastPanelOpen.get(pluginId) ?? -Infinity) < OPEN_PANEL_INTERVAL_MS) break;
      lastPanelOpen.set(pluginId, now);
      useSessionStore.getState().openPluginPanel(pluginId, payload.panelId);
      break;
    }

    case 'showNotification':
      if (Notification.permission === 'granted') {
        new Notification(payload.title || 'GETSSH Plugin', { body: payload.body || '' });
      }
      break;

    case 'getActiveSessionId':
      // Reply back with session ID (read-only, non-sensitive)
      if (event.source) {
        (event.source as WindowProxy).postMessage({
          __getssh_host: true,
          event: 'sessionId',
          requestId: payload.requestId,
          sessionId: null, // Plugins get null - they cannot access raw session IDs
        }, '*');
      }
      break;
  }
}

export function initPluginBridge() {
  window.addEventListener('message', handlePluginMessage);

  const unsubUIExtensions = window.electronAPI.onSyncPluginUIExtensions?.((payload) => {
    usePluginStore.getState().setUIExtensions(payload);
  });

  const unsubSettingsSchemas = window.electronAPI.onSyncPluginSettingsSchemas?.((payload) => {
    usePluginStore.getState().setSettingsSchemas(payload);
  });

  const unsubAppStore = useAppStore.subscribe((state, prevState) => {
    if (state.appConfig.theme !== prevState.appConfig.theme || state.appConfig.language !== prevState.appConfig.language) {
      const iframes = document.querySelectorAll('iframe[data-plugin-id]');
      iframes.forEach((iframe) => {
        (iframe as HTMLIFrameElement).contentWindow?.postMessage({
          __getssh_host: true,
          event: 'envChange',
          theme: state.appConfig.theme,
          locale: state.appConfig.language
        }, '*');
      });
    }
  });

  // An install or uninstall changes the plugin list: start or remove renderer.js frames to match.
  const unsubPlugins = usePluginStore.subscribe((state, prevState) => {
    if (state.installedPlugins !== prevState.installedPlugins) {
      bootSandboxedPlugins().catch(e => console.error('[PluginBridge] Failed to update plugin renderers:', e));
    }
  });

  return () => {
    window.removeEventListener('message', handlePluginMessage);
    unsubUIExtensions?.();
    unsubSettingsSchemas?.();
    unsubAppStore();
    unsubPlugins();
  };
}

/** Drops what a plugin no longer installed registered here: its sidebar actions and its limits. */
function forgetPlugin(pluginId: string) {
  usePluginStore.getState().removePluginSidebarActions(pluginId);
  sidebarActionsByPlugin.delete(pluginId);
  panelsByPlugin.delete(pluginId);
  lastPanelOpen.delete(pluginId);
}

function startRenderer(pluginId: string, url: string) {
  // getLocale() in renderer.js returns the app's language from the start, not the system's.
  const src = new URL(url);
  src.searchParams.set('locale', useAppStore.getState().appConfig.language || navigator.language);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('data-plugin-id', pluginId);
  iframe.setAttribute(RENDERER_FRAME_ATTR, '');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.display = 'none';
  // The current theme once the page is up, for the callbacks of onThemeChange().
  iframe.addEventListener('load', () => {
    const { theme, language } = useAppStore.getState().appConfig;
    iframe.contentWindow?.postMessage({ __getssh_host: true, event: 'envChange', theme, locale: language }, '*');
  });
  iframe.src = src.href;
  document.body.appendChild(iframe);
}

async function syncRendererFrames() {
  const pages = await window.electronAPI.getPluginRenderers();
  const wanted = new Map(pages.map(page => [page.pluginId, page.url]));
  for (const iframe of rendererFrames()) {
    const pluginId = iframe.getAttribute('data-plugin-id') ?? '';
    if (wanted.has(pluginId)) continue;
    iframe.remove();
    forgetPlugin(pluginId);
  }
  const running = new Set(rendererFrames().map(iframe => iframe.getAttribute('data-plugin-id')));
  for (const [pluginId, url] of wanted) {
    if (running.has(pluginId)) continue;
    try {
      startRenderer(pluginId, url);
    } catch (e) {
      console.error(`[PluginBridge] renderer.js of plugin "${pluginId}" did not start:`, e);
    }
  }
}

let rendererSync: Promise<void> = Promise.resolve();

/**
 * Runs each plugin's renderer.js in a hidden frame of its own. The frame is sandboxed like a panel
 * (opaque origin, no access to this window) and loads the plugin's own getssh-plugin:// page, so
 * the plugin page CSP applies to it too. A script that is missing, does not parse or throws stops
 * only its own frame. Frames already running are kept; the frame of a plugin no longer installed
 * is removed, with its sidebar actions.
 *
 * Calls run one after another, each on a list fetched after the one before it finished: an older
 * list answered late cannot bring back the frame of a plugin uninstalled since.
 */
export function bootSandboxedPlugins(): Promise<void> {
  const run = rendererSync.then(syncRendererFrames);
  rendererSync = run.catch(() => {});
  return run;
}
