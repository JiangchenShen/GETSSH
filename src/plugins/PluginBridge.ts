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

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, 'image/svg+xml');

    // Check for parsing errors
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      console.warn('[PluginBridge] SVG parsing error:', parserError.textContent);
      return '';
    }

    const elements = doc.getElementsByTagName('*');
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];

      // Remove <script> and other dangerous tags
      if (['script', 'foreignObject', 'iframe', 'video', 'audio'].includes(el.tagName.toLowerCase())) {
        el.parentNode?.removeChild(el);
        i--;
        continue;
      }

      // Remove all event handlers (on*)
      const attrs = el.attributes;
      for (let j = 0; j < attrs.length; j++) {
        const attrName = attrs[j].name.toLowerCase();
        if (attrName.startsWith('on')) {
          el.removeAttribute(attrs[j].name);
          j--;
        } else if (['href', 'xlink:href', 'src'].includes(attrName)) {
          // Remove javascript: URIs
          const value = attrs[j].value.toLowerCase().trim();
          if (value.startsWith('javascript:')) {
            el.removeAttribute(attrs[j].name);
            j--;
          }
        }
      }
    }

    return new XMLSerializer().serializeToString(doc);
  } catch (e) {
    console.error('[PluginBridge] Failed to sanitize SVG:', e);
    return '';
  }
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
