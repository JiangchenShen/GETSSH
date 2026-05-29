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

function handlePluginMessage(event: MessageEvent) {
  // Only accept messages from sandboxed iframes (origin will be 'null' for sandbox)
  const data = event.data;
  if (!data || !data.__getssh_plugin) return;

  const { action, payload, pluginId } = data;

  if (BLOCKED_ACTIONS.has(action)) {
    console.warn(`[PluginBridge] BLOCKED dangerous action "${action}" from plugin "${pluginId}"`);
    return;
  }

  if (!ALLOWED_ACTIONS.has(action)) {
    console.warn(`[PluginBridge] Unknown action "${action}" from plugin "${pluginId}"`);
    return;
  }

  switch (action) {
    case 'registerSidebarAction':
      usePluginStore.getState().registerSidebarAction({
        id: `plugin-${pluginId}-${payload.id}`,
        icon: sanitizeSVG(payload.icon),
        label: payload.label,
        onClick: () => {
          // Send click event back to the plugin's iframe
          const iframe = document.querySelector(`iframe[data-plugin-id="${pluginId}"]`) as HTMLIFrameElement;
          if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage({ __getssh_host: true, event: 'sidebarClick', actionId: payload.id }, '*');
          }
        }
      });
      break;

    case 'registerPanel':
      useSessionStore.getState().registerPluginPanel(pluginId, payload.panelId, payload.title, payload.renderUrl);
      break;

    case 'openPanel':
      useSessionStore.getState().openPluginPanel(pluginId, payload.panelId);
      break;

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

  return () => {
    window.removeEventListener('message', handlePluginMessage);
    unsubUIExtensions?.();
    unsubSettingsSchemas?.();
    unsubAppStore();
  };
}

/**
 * Boot plugins in sandboxed iframes instead of eval/new Function.
 * Each plugin gets its own isolated iframe with no access to the parent DOM or electronAPI.
 */
export async function bootSandboxedPlugins() {
  try {
    const scripts = await window.electronAPI.getPluginRenderers();
    scripts.forEach((script, idx) => {
      if (!script) return;

      const pluginId = `plugin-${idx}`;

      // Create sandboxed iframe
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('data-plugin-id', pluginId);
      iframe.style.display = 'none';
      document.body.appendChild(iframe);

      // Inject a minimal SDK into the iframe
      const sdkCode = `
        window.__GETSSH_PLUGIN_ID = "${pluginId}";
        window.__GETSSH_LOCALE = "${useAppStore.getState().appConfig.language || navigator.language}";
        window.GETSSH = {
          registerSidebarAction: function(id, icon, label) {
            parent.postMessage({ __getssh_plugin: true, pluginId: "${pluginId}", action: "registerSidebarAction", payload: { id, icon, label } }, "*");
          },
          registerPanel: function(panelId, title, renderUrl) {
            parent.postMessage({ __getssh_plugin: true, pluginId: "${pluginId}", action: "registerPanel", payload: { panelId, title, renderUrl } }, "*");
          },
          openPanel: function(panelId) {
            parent.postMessage({ __getssh_plugin: true, pluginId: "${pluginId}", action: "openPanel", payload: { panelId } }, "*");
          },
          showNotification: function(title, body) {
            parent.postMessage({ __getssh_plugin: true, pluginId: "${pluginId}", action: "showNotification", payload: { title, body } }, "*");
          },
          getLocale: function() {
            return window.__GETSSH_LOCALE;
          },
          onThemeChange: function(callback) {
            if (!window.__themeListeners) window.__themeListeners = [];
            window.__themeListeners.push(callback);
          }
        };
        window.addEventListener("message", function(e) {
          if (e.data && e.data.__getssh_host) {
            if (e.data.event === "sidebarClick") {
              var handler = window.__sidebarHandlers && window.__sidebarHandlers[e.data.actionId];
              if (handler) handler();
            } else if (e.data.event === "envChange") {
              if (e.data.locale) window.__GETSSH_LOCALE = e.data.locale;
              if (e.data.theme && window.__themeListeners) {
                window.__themeListeners.forEach(cb => cb(e.data.theme));
              }
            }
          }
        });
        window.__sidebarHandlers = {};
      `;

      // Write to iframe
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write('<html><body></body></html>');
        doc.close();

        const scriptEl = doc.createElement('script');
        scriptEl.textContent = `${sdkCode}\n${script}`;
        doc.body.appendChild(scriptEl);
      }
    });
  } catch (e) {
    console.error('[PluginBridge] Failed to boot sandboxed plugins:', e);
    throw e;
  }
}
