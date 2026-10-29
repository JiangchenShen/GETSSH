import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

/**
 * getssh-plugin://<plugin folder>/<file> serves plugin pages and their files from
 * userData/plugins. The main window's CSP lists the scheme in frame-src, so it needs no bypassCSP;
 * with bypassCSP, a page's own policy did not apply to files of this scheme, and one plugin's page
 * could load another plugin's scripts.
 */
export const PLUGIN_PAGE_SCHEME = 'getssh-plugin';
export const PLUGIN_PAGE_SCHEME_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true };

/** Plugin pages are read whole to add the bridge script; larger pages are refused. */
export const MAX_PLUGIN_PAGE_BYTES = 4 * 1024 * 1024;

// A plugin folder name as the URL carries it. Nothing outside these characters reaches the CSP.
const PLUGIN_HOST = /^(?!\.{1,2}$)[a-z0-9._-]{1,128}$/i;

const DENY_ALL_CSP = "default-src 'none'; form-action 'none'; base-uri 'none'";

/**
 * Every response of the scheme carries this policy, so plugin pages stay offline: they load only
 * their own plugin's files (and data: or blob: URLs), and cannot fetch, open sockets, send beacons,
 * submit forms or frame anything else. A page that needs the network asks its backend
 * (invokeBackend), whose net:fetch goes through the plugin network gateway.
 *
 * Inline scripts and eval stay allowed: the page is the plugin's own code, and the policy limits
 * where it can reach, not which of its code runs. Non-HTML files get the policy too, so an SVG
 * opened as a document or a worker script from this scheme is held to it.
 *
 * Not covered: WebRTC. Chromium enforces no CSP directive for it, and a page can still reach a
 * STUN or TURN server.
 */
export function pluginPageCsp(host: string): string {
  if (!PLUGIN_HOST.test(host)) throw new Error('Invalid plugin host');
  const own = `${PLUGIN_PAGE_SCHEME}://${host}`;
  return [
    "default-src 'none'",
    `script-src ${own} 'unsafe-inline' 'unsafe-eval' blob:`,
    `style-src ${own} 'unsafe-inline' blob:`,
    `img-src ${own} data: blob:`,
    `font-src ${own} data: blob:`,
    `media-src ${own} data: blob:`,
    `connect-src ${own}`,
    `worker-src ${own} blob:`,
    `frame-src ${own}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

function contentTypeFor(file: string): string {
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

/** The window.GETSSH bridge added to the <head> of every plugin page. */
function pluginBridgeScript(pluginId: string): string {
  return `
    <script>
      (function() {
        // #1 FIX: pluginId is JSON-encoded server-side — no XSS via plugin directory names
        var PLUGIN_ID = ${JSON.stringify(pluginId).replace(/</g, '\\u003c')};
        // #2 FIX: Capture and verify parent origin once at load time
        var PARENT_ORIGIN = (typeof location !== 'undefined' && location.ancestorOrigins && location.ancestorOrigins.length > 0) ? location.ancestorOrigins[0] : (document.referrer ? new URL(document.referrer).origin : '*');
        // The packaged window is a file:// page, and its messages arrive with the origin "null".
        var PARENT_MESSAGE_ORIGIN = PARENT_ORIGIN === 'file://' ? 'null' : PARENT_ORIGIN;

        window.__GETSSH_LOCALE = navigator.language;
        window.__themeListeners = [];
        window.__sidebarHandlers = {};

        window.GETSSH = {
          _callbacks: {},
          _reqId: 0,
          _backendListeners: [],
          invokeBackend: function(method, payload) {
            return new Promise((resolve, reject) => {
              const reqId = ++this._reqId;
              this._callbacks[reqId] = { resolve, reject };
              window.parent.postMessage({
                type: 'rpc-invoke',
                pluginId: PLUGIN_ID,
                method: method,
                payload: payload,
                reqId: reqId
              }, PARENT_ORIGIN);
            });
          },
          onBackendMessage: function(callback) {
            this._backendListeners.push(callback);
          },
          registerPanel: function(panelId, title, renderUrl) {
            window.parent.postMessage({ __getssh_plugin: true, pluginId: PLUGIN_ID, action: "registerPanel", payload: { panelId, title, renderUrl } }, PARENT_ORIGIN);
          },
          openPanel: function(panelId) {
            window.parent.postMessage({ __getssh_plugin: true, pluginId: PLUGIN_ID, action: "openPanel", payload: { panelId } }, PARENT_ORIGIN);
          },
          registerSidebarAction: function(id, icon, label) {
            window.parent.postMessage({ __getssh_plugin: true, pluginId: PLUGIN_ID, action: "registerSidebarAction", payload: { id, icon, label } }, PARENT_ORIGIN);
          },
          showNotification: function(title, body) {
            window.parent.postMessage({ __getssh_plugin: true, pluginId: PLUGIN_ID, action: "showNotification", payload: { title, body } }, PARENT_ORIGIN);
          },
          getLocale: function() {
            return window.__GETSSH_LOCALE;
          },
          onThemeChange: function(callback) {
            window.__themeListeners.push(callback);
          }
        };

        window.addEventListener('message', (e) => {
          if (e.source !== window.parent || (PARENT_ORIGIN !== '*' && e.origin !== PARENT_MESSAGE_ORIGIN)) return;
          const data = e.data;
          // RPC and Backend Messages
          if (data && data.type === 'rpc-response') {
            const cb = window.GETSSH._callbacks[data.reqId];
            if (cb) {
              if (data.error) cb.reject(new Error(data.error));
              else cb.resolve(data.result);
              delete window.GETSSH._callbacks[data.reqId];
            }
          } else if (data && data.type === 'backend-message') {
            window.GETSSH._backendListeners.forEach(fn => fn(data.payload));
          }

          // Host UI/Env Messages
          if (data && data.__getssh_host) {
            if (data.event === "sidebarClick") {
              var handler = window.__sidebarHandlers[data.actionId];
              if (handler) handler();
            } else if (data.event === "envChange") {
              if (data.locale) window.__GETSSH_LOCALE = data.locale;
              if (data.theme) {
                window.__themeListeners.forEach(cb => cb(data.theme));
              }
            }
          }

          // Also handle direct host:theme-change from PluginPane
          if (data && data.type === 'host:theme-change' && data.payload) {
             window.__themeListeners.forEach(cb => cb(data.payload));
          }
        });
      })();
    </script>
  `;
}

/** The protocol.handle handler for getssh-plugin://, serving files under pluginsDir. */
export function createPluginPageHandler(pluginsDir: string): (request: Request) => Promise<Response> {
  return async (request) => {
    let csp = DENY_ALL_CSP;
    const respond = (body: BodyInit | null, status: number, headers: Record<string, string> = {}) =>
      new Response(body, { status, headers: { ...headers, 'content-security-policy': csp } });

    let pluginId: string;
    let pluginPath: string;
    try {
      const parsedUrl = new URL(request.url);
      pluginId = parsedUrl.hostname;
      // Throws for a host it cannot put in a policy; the answer then keeps the deny-all policy.
      csp = pluginPageCsp(pluginId);
      const pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      const pluginDir = path.join(pluginsDir, pluginId);
      pluginPath = path.join(pluginDir, pathname);
      // Prevent Path Traversal (C-01), into another plugin's folder too ('%2e%2e%2f' decodes to '../').
      if (!pluginPath.startsWith(pluginDir + path.sep)) return respond('Forbidden', 403);
    } catch (e: any) {
      return respond('Bad Request: ' + e.message, 400);
    }

    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(pluginPath);
    } catch {
      return respond('Not Found', 404);
    }
    if (!stats.isFile()) return respond('Not Found', 404);

    if (pluginPath.toLowerCase().endsWith('.html') || pluginPath.toLowerCase().endsWith('.htm')) {
      // A page is read whole (the bridge script goes into its <head>): only up to 4 MiB.
      if (stats.size > MAX_PLUGIN_PAGE_BYTES) return respond('Plugin page is larger than 4 MiB', 404);
      let text: string;
      try {
        text = await fs.promises.readFile(pluginPath, 'utf-8');
      } catch {
        return respond('Not Found', 404);
      }
      const injection = pluginBridgeScript(pluginId);
      const modifiedText = text.includes('<head>')
        ? text.replace('<head>', '<head>' + injection)
        : injection + text;
      return respond(modifiedText, 200, { 'content-type': 'text/html; charset=utf-8' });
    }

    // For non-HTML files, fetch manually to ensure correct MIME types on macOS. Streamed: a
    // plugin's 400 MB asset requested many times at once must not be read whole each time.
    const body = Readable.toWeb(fs.createReadStream(pluginPath)) as unknown as ReadableStream;
    return respond(body, 200, { 'content-type': contentTypeFor(pluginPath), 'content-length': String(stats.size) });
  };
}
