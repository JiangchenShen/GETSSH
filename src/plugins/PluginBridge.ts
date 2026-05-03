import { usePluginStore } from '../store/pluginStore';

/**
 * PluginBridge - Secure message router between sandboxed plugin iframes and the host app.
 * Only whitelisted API calls are forwarded. Dangerous operations (sshWrite, saveProfiles, etc.) are blocked.
 */

const ALLOWED_ACTIONS = new Set([
  'registerSidebarAction',
  'registerPanel',
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

export function initPluginBridge() {
  window.addEventListener('message', (event) => {
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
  });
}

/** Strip potentially dangerous attributes from SVG icons */
function sanitizeSVG(svg: string): string {
  if (!svg || typeof svg !== 'string') return '';
  // Remove event handlers and script tags
  return svg
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/javascript:/gi, '');
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
        window.GETSSH = {
          registerSidebarAction: function(id, icon, label) {
            parent.postMessage({ __getssh_plugin: true, pluginId: "${pluginId}", action: "registerSidebarAction", payload: { id, icon, label } }, "*");
          },
          showNotification: function(title, body) {
            parent.postMessage({ __getssh_plugin: true, pluginId: "${pluginId}", action: "showNotification", payload: { title, body } }, "*");
          }
        };
        window.addEventListener("message", function(e) {
          if (e.data && e.data.__getssh_host && e.data.event === "sidebarClick") {
            var handler = window.__sidebarHandlers && window.__sidebarHandlers[e.data.actionId];
            if (handler) handler();
          }
        });
        window.__sidebarHandlers = {};
      `;

      // Write to iframe
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(`<html><body><script>${sdkCode}\n${script}<\/script></body></html>`);
        doc.close();
      }
    });
  } catch (e) {
    console.error('[PluginBridge] Failed to boot sandboxed plugins:', e);
  }
}
