import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

/**
 * getssh-plugin://<plugin folder>/<file> serves plugin pages and their files from
 * userData/plugins, and getssh-plugin://<plugin folder>/?renderer=<path> the page its renderer.js
 * runs in. The main window's CSP lists the scheme in frame-src, so it needs no bypassCSP;
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
 * renderer.js runs in a page of the plugin's own host, getssh-plugin://<plugin>/?renderer=<path>,
 * so it gets the same policy as the plugin's other pages, in a WebContents of its own
 * (pluginRendererHost.ts).
 */
const RENDERER_PARAM = 'renderer';
// The app's language for getLocale(), which the page's preload reads from the URL.
const LOCALE_PARAM = 'locale';
// How many times the plugin was installed since GETSSH started: an update changes the page URL,
// and the plugin's WebContents is replaced. The handler itself ignores it.
const INSTALL_PARAM = 'install';
const MAX_RENDERER_PATH = 1024;
// A language tag such as zh-CN; nothing else goes into the URL.
const LOCALE_TAG = /^[a-z]{2,8}(?:-[a-z0-9]{1,8}){0,4}$/i;

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
 * Not covered: WebRTC, for which Chromium enforces no CSP directive. Pages get a
 * Connection-Allowlist and the WebRTC guard for it instead, and WebRTC never uses UDP
 * (PLUGIN_PAGE_CONNECTION_ALLOWLIST, withWebRtcGuard, disableWebRtcUdp).
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

/**
 * Sent with every plugin page and renderer.js page. Chromium then drops the page's ICE servers
 * (STUN and TURN over UDP, TCP or TLS) and ignores addIceCandidate(); srcdoc frames inside the
 * page inherit the list. The page's own getssh-plugin://<plugin> stays allowed: an empty list
 * also blocks the plugin's own frames.
 *
 * Pages only. In Electron 44 (Chromium 152) a response that turns into a download with this header
 * crashed the main process: an iframe on a .bin file of the plugin was enough. Files and error
 * answers go without it.
 */
export const PLUGIN_PAGE_CONNECTION_ALLOWLIST = '(response-origin);webrtc=block';

/**
 * Chromium 152 still lets a page with the list above start WebRTC: remote candidates written into
 * the SDP get connectivity checks (over TCP when UDP is off), and their host names DNS lookups.
 * This script comes first on every page, so the page has no RTCPeerConnection to start it with.
 * A srcdoc frame gets a fresh one, but it inherits the list, and Chromium 152 ends the plugin's
 * renderer process when the frame creates one. SVG documents, the other pages of the scheme that
 * run scripts, run none (svgCsp). From Chromium 157 the browser gives such frames no sockets and
 * no DNS at all, and the list alone would do.
 */
const WEBRTC_GUARD = '<script>delete window.RTCPeerConnection; delete window.webkitRTCPeerConnection;</script>';

// What may come before the guard, read the way the HTML parser reads it: a byte order mark, then
// white space (its five characters), comments, bogus comments (<?xml ...?>, <!x>, </ x>) and the
// doctype, none of which runs anything. '<!-->' and '<!--->' are whole comments, and '--!>' also
// ends one: a search for the next '-->' would take the plugin's own <script> for part of a comment
// and put the guard after it. A script ahead of the doctype would put the page in quirks mode.
const PAGE_PROLOGUE = /^\uFEFF?(?:[\t\n\f\r ]|<!--(?:-?>|[\s\S]*?--!?>)|<!(?!--)[^>]*>|<\?[^>]*>|<\/(?![A-Za-z])[^>]*>)*/;

/** The page with the WebRTC guard ahead of everything the page runs. */
export function withWebRtcGuard(html: string): string {
  const prologue = PAGE_PROLOGUE.exec(html)?.[0] ?? '';
  return prologue + WEBRTC_GUARD + html.slice(prologue.length);
}

/** SVG opened as a document runs no scripts; as an image (<img>, CSS) it never runs any. */
function svgCsp(csp: string): string {
  return `${csp}; sandbox`;
}

/**
 * WebRTC may use UDP only through a proxy, and Chromium proxies no UDP: with this policy no
 * WebContents sends STUN, TURN over UDP or UDP connectivity checks. GETSSH itself uses no WebRTC.
 */
export const WEBRTC_IP_HANDLING_POLICY = 'disable_non_proxied_udp';

/** Gives every WebContents created from now on (windows, and later plugin views) that policy. */
export function disableWebRtcUdp(app: Pick<Electron.App, 'on'>): void {
  app.on('web-contents-created', (_event, contents) => contents.setWebRTCIPHandlingPolicy(WEBRTC_IP_HANDLING_POLICY));
}

/**
 * A manifest's `renderer` as a '/'-separated path inside the plugin folder, or null for anything
 * but a plain relative path: '..', an absolute path, a backslash or a drive letter.
 */
export function rendererScriptPath(renderer: unknown): string | null {
  if (typeof renderer !== 'string' || renderer.length > MAX_RENDERER_PATH) return null;
  if (renderer.startsWith('/') || /[\\:\0]/.test(renderer)) return null;
  const segments = renderer.split('/').filter(segment => segment !== '' && segment !== '.');
  return segments.length && !segments.includes('..') ? segments.join('/') : null;
}

export interface PluginRendererPage {
  /** The plugin folder: the page's host, and the plugin its WebContents speaks for. */
  pluginId: string;
  url: string;
}

/**
 * The renderer.js page of every plugin that declares one, for pluginRendererHost to open. A plugin
 * is left out when its folder cannot be a host of the scheme or its renderer is not a file inside
 * its folder (symbolic links resolved); the other plugins are not affected. `installs` counts each
 * plugin's installs since GETSSH started.
 */
export async function pluginRendererPages(
  plugins: ReadonlyArray<{ renderer?: unknown; localPath?: string }>,
  installs: ReadonlyMap<string, number> = new Map(),
): Promise<PluginRendererPage[]> {
  const pages = await Promise.all(plugins.map(async ({ renderer, localPath }) => {
    if (renderer === undefined || typeof localPath !== 'string') return null;
    const pluginId = path.basename(localPath);
    const script = rendererScriptPath(renderer);
    try {
      if (!PLUGIN_HOST.test(pluginId) || !script) throw new Error('the folder name or the renderer path is not allowed');
      const folder = await fs.promises.realpath(localPath);
      const file = await fs.promises.realpath(path.join(folder, ...script.split('/')));
      if (!file.startsWith(folder + path.sep) || !(await fs.promises.stat(file)).isFile()) {
        throw new Error('the renderer is not a file inside the plugin folder');
      }
    } catch (error) {
      console.warn(`[PluginManager] renderer.js of plugin '${pluginId}' is not loaded: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    const install = installs.get(pluginId);
    return {
      pluginId,
      url: `${PLUGIN_PAGE_SCHEME}://${pluginId}/?${RENDERER_PARAM}=${encodeURIComponent(script)}${install ? `&${INSTALL_PARAM}=${install}` : ''}`,
    };
  }));
  return pages.filter((page): page is PluginRendererPage => page !== null);
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

/**
 * The page renderer.js runs in, top-level in a WebContents of its own: the WebRTC guard, then the
 * script. window.GETSSH comes from the WebContents' preload (electron/preload/pluginRenderer.ts).
 */
function rendererPage(script: string): string {
  const src = '/' + script.split('/').map(encodeURIComponent).join('/');
  return withWebRtcGuard(`<!doctype html><html><head><meta charset="utf-8"></head><body><script src="${src}"></script></body></html>`);
}

/**
 * Added to the CSP of the renderer.js page. As a top-level page it would get
 * getssh-plugin://<plugin> for its origin, and an about:blank frame it made would be same-origin,
 * that frame's RTCPeerConnection within reach. Sandboxed, the page keeps the opaque origin the
 * sandboxed iframe in the main window gave it, and gets no dialogs, popups or downloads.
 */
export const RENDERER_PAGE_SANDBOX = 'sandbox allow-scripts';

/** A renderer.js page URL with the app's language for getLocale(), if it is a language tag. */
export function withRendererLocale(url: string, locale: string | null | undefined): string {
  return locale && LOCALE_TAG.test(locale) ? `${url}&${LOCALE_PARAM}=${encodeURIComponent(locale)}` : url;
}

export interface PluginPageHandlerOptions {
  /**
   * The one plugin this handler serves (the session of its renderer.js), by its folder name; other
   * hosts get 404. Chromium lowers the host of a standard scheme, so the host matches it in any
   * case, and the files come from this folder name, which keeps the plugin's capitals.
   */
  plugin?: string;
}

/** The protocol.handle handler for getssh-plugin://, serving files under pluginsDir. */
export function createPluginPageHandler(pluginsDir: string, options: PluginPageHandlerOptions = {}): (request: Request) => Promise<Response> {
  const plugin = options.plugin;
  if (plugin !== undefined && !PLUGIN_HOST.test(plugin)) throw new Error('Invalid plugin folder name');
  return async (request) => {
    let csp = DENY_ALL_CSP;
    const respond = (body: BodyInit | null, status: number, headers: Record<string, string> = {}) =>
      new Response(body, { status, headers: { ...headers, 'content-security-policy': csp } });

    let pluginId: string;
    let pluginPath: string;
    let renderer: { script: string } | null = null;
    try {
      const parsedUrl = new URL(request.url);
      const host = parsedUrl.hostname;
      // Both are ASCII (PLUGIN_HOST), so lowering them compares letters only.
      if (plugin !== undefined && host.toLowerCase() !== plugin.toLowerCase()) return respond('Not Found', 404);
      pluginId = plugin ?? host;
      // Throws for a host it cannot put in a policy; the answer then keeps the deny-all policy.
      csp = pluginPageCsp(host);
      let pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      if (!pathname && parsedUrl.searchParams.has(RENDERER_PARAM)) {
        // The renderer.js page: the checks below then apply to the script it loads.
        const script = rendererScriptPath(parsedUrl.searchParams.get(RENDERER_PARAM));
        if (!script) return respond('Bad Request: invalid renderer path', 400);
        renderer = { script };
        pathname = script;
      }
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

    if (renderer) {
      csp = `${csp}; ${RENDERER_PAGE_SANDBOX}`;
      return respond(rendererPage(renderer.script), 200, {
        'content-type': 'text/html; charset=utf-8',
        'connection-allowlist': PLUGIN_PAGE_CONNECTION_ALLOWLIST,
      });
    }

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
      return respond(withWebRtcGuard(modifiedText), 200, {
        'content-type': 'text/html; charset=utf-8',
        'connection-allowlist': PLUGIN_PAGE_CONNECTION_ALLOWLIST,
      });
    }

    // For non-HTML files, fetch manually to ensure correct MIME types on macOS. Streamed: a
    // plugin's 400 MB asset requested many times at once must not be read whole each time.
    const contentType = contentTypeFor(pluginPath);
    if (contentType === 'image/svg+xml') csp = svgCsp(csp);
    const body = Readable.toWeb(fs.createReadStream(pluginPath)) as unknown as ReadableStream;
    return respond(body, 200, { 'content-type': contentType, 'content-length': String(stats.size) });
  };
}
