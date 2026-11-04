import { usePluginStore } from '../store/pluginStore';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { sanitizeSVG } from './svgSanitizer';

/**
 * PluginBridge - Secure message router between plugins and the host app. Calls come from the
 * sandboxed iframes of plugin pages (panels), and from each plugin's renderer.js, which runs in a
 * WebContents of the main process that checks its calls and passes them on (pluginRendererHost.ts).
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
 * Panels one plugin may register from its pages and renderer.js together, and how often it may
 * open one. Each opened panel is a tab with its own iframe; a page that registered and opened new
 * panels on a timer added them without limit.
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
// Notifications go out in GETSSH's name, and renderer.js runs from startup without the user
// opening anything: a plugin's pages and its renderer.js together may show 3 in any 30 seconds,
// with the plugin's name first in the title. The main process applies the same rule to backends
// (PluginManager.ts).
const NOTIFICATION_WINDOW_MS = 30_000;
const MAX_NOTIFICATIONS_PER_WINDOW = 3;
const MAX_NOTIFICATION_TITLE_LENGTH = 256;
const MAX_NOTIFICATION_BODY_LENGTH = 4096;
const notificationTimes = new Map<string, number[]>();

/** Where a call came from: an iframe of this window, or the plugin's renderer.js. */
type CallSource = { frame: MessageEventSource | null } | { renderer: true };
const RENDERER: CallSource = { renderer: true };

function pluginFrames(): HTMLIFrameElement[] {
  return [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-plugin-id]')];
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

  // The plugin is the one whose frame sent the message, never the id the message names: a
  // page naming other ids (or a CSS selector) would get a fresh limit for each.
  const source = event.source;
  const pluginId = pluginFrames().find(frame => frame.contentWindow === source)?.getAttribute('data-plugin-id');
  if (!pluginId) return;
  handlePluginCall(pluginId, data.action, data.payload, { frame: source });
}

// The calls of renderer.js the main process passes on (pluginRendererHost.ts). Nothing else: an
// action added for plugin pages does not reach renderer.js by being added there.
const RENDERER_ACTIONS = new Set(['registerSidebarAction', 'registerPanel', 'openPanel', 'showNotification']);

/** A call of renderer.js, which the main process tied to its plugin and checked already. */
function handleRendererCall(call: { pluginId?: unknown; action?: unknown; payload?: unknown } | null | undefined) {
  if (!call || typeof call.pluginId !== 'string' || typeof call.action !== 'string') return;
  if (!RENDERER_ACTIONS.has(call.action)) {
    console.warn(`[PluginBridge] Ignored "${call.action.slice(0, 64)}" for plugin "${call.pluginId.slice(0, 128)}": not a call the main process passes on from renderer.js`);
    return;
  }
  handlePluginCall(call.pluginId, call.action, call.payload, RENDERER);
}

function handlePluginCall(pluginId: string, action: string, payload: any, source: CallSource) {
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
          // renderer.js, through the main process, or an open panel.
          if ('renderer' in source) {
            window.electronAPI.pluginRendererSidebarClick(pluginId, actionId);
            return;
          }
          const frames = pluginFrames();
          const iframe = frames.find(frame => frame.contentWindow === source.frame)
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

    case 'showNotification': {
      if (Notification.permission !== 'granted') break;
      const now = Date.now();
      const recent = (notificationTimes.get(pluginId) ?? []).filter(time => now - time < NOTIFICATION_WINDOW_MS);
      if (recent.length >= MAX_NOTIFICATIONS_PER_WINDOW) {
        console.warn(`[PluginBridge] Plugin "${pluginId}" already showed ${MAX_NOTIFICATIONS_PER_WINDOW} notifications in ${NOTIFICATION_WINDOW_MS / 1000} seconds; this one was dropped`);
        break;
      }
      recent.push(now);
      notificationTimes.set(pluginId, recent);
      const title = typeof payload?.title === 'string' ? payload.title.slice(0, MAX_NOTIFICATION_TITLE_LENGTH) : '';
      const body = typeof payload?.body === 'string' ? payload.body.slice(0, MAX_NOTIFICATION_BODY_LENGTH) : '';
      new Notification(title ? `[${pluginId}] ${title}` : `[${pluginId}]`, { body });
      break;
    }

    case 'getActiveSessionId':
      // Reply back with session ID (read-only, non-sensitive)
      if ('frame' in source && source.frame) {
        (source.frame as WindowProxy).postMessage({
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

  // renderer.js: its calls and its end (uninstalled, updated, or its process gone) come from the
  // main process, which also keeps what it registered for a window that loads later.
  const unsubRendererUi = window.electronAPI.onPluginRendererUi?.(handleRendererCall);
  const unsubRendererGone = window.electronAPI.onPluginRendererGone?.(forgetPlugin);
  window.electronAPI.getPluginRendererState?.()
    .then(calls => calls.forEach(handleRendererCall))
    .catch(e => console.error('[PluginBridge] Failed to load what renderer.js registered:', e));
  const sendRendererEnv = () => {
    const { theme, language } = useAppStore.getState().appConfig;
    window.electronAPI.setPluginRendererEnv?.({ theme, locale: language });
  };
  sendRendererEnv();

  const unsubUIExtensions = window.electronAPI.onSyncPluginUIExtensions?.((payload) => {
    usePluginStore.getState().setUIExtensions(payload);
  });

  const unsubSettingsSchemas = window.electronAPI.onSyncPluginSettingsSchemas?.((payload) => {
    usePluginStore.getState().setSettingsSchemas(payload);
  });

  const unsubAppStore = useAppStore.subscribe((state, prevState) => {
    if (state.appConfig.theme !== prevState.appConfig.theme || state.appConfig.language !== prevState.appConfig.language) {
      sendRendererEnv();
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

  return () => {
    window.removeEventListener('message', handlePluginMessage);
    unsubRendererUi?.();
    unsubRendererGone?.();
    unsubUIExtensions?.();
    unsubSettingsSchemas?.();
    unsubAppStore();
  };
}

/** Drops what a plugin registered here once its renderer.js stops: its sidebar actions and its limits. */
function forgetPlugin(pluginId: string) {
  usePluginStore.getState().removePluginSidebarActions(pluginId);
  sidebarActionsByPlugin.delete(pluginId);
  panelsByPlugin.delete(pluginId);
  lastPanelOpen.delete(pluginId);
  notificationTimes.delete(pluginId);
}
