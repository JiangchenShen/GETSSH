'use strict';

/*
 * Plugins' renderer.js runs as the SDK guide says, each in a WebContents of its own that the main
 * process makes (pluginRendererHost.ts), and stays offline. plugin-renderer-smoke.mjs bundles the
 * code under test and starts this in Electron with a temporary HOME.
 *
 * A hidden window with the main window's real CSP (index.html) and real preload runs the real
 * PluginBridge, plugin store and session store; the host passes renderer.js calls to it. The real
 * pluginRendererPages lists the plugins from their package.json files:
 * - hang: never returns. broken: a syntax error. throws: registers a sidebar action, then
 *   throws. These three start first.
 * - alpha: the guide's example (a panel, and a sidebar action whose handler opens it), plus
 *   getLocale(), onThemeChange(), invokeBackend() and a panel of another plugin's page.
 * - beta: its script in a subfolder, with a space in the name.
 * - leaky: tries the ways out it can against a loopback server, which counts what arrives, and
 *   WebRTC against loopback STUN, TURN and candidate ports (webrtc-probe.cjs), with the
 *   RTCPeerConnection of an about:blank frame once its own is gone. It also registers an action
 *   under another plugin's id, loads another plugin's file as a script, navigates to its own
 *   file, opens a window and starts a download.
 * - wanderer: navigates to its own file, then to the loopback server. Outside its
 *   Connection-Allowlist Chromium turns that into an error page, and the host ends the plugin's
 *   renderer.js; without the list, will-frame-navigate keeps the page.
 * - missing, escape, plain: a missing script, a script outside the folder, no renderer.
 * Clicking alpha's and beta's sidebar actions must open their panels in the session store. Then
 * alpha is updated (a new renderer.js, a new install count in its page URL): its new script must
 * run in a new WebContents, without its old sidebar actions, and the other plugins' must stay.
 *
 * Three runs:
 * - policy: everything on.
 * - session: the pages' own protections off (the CSP and its sandbox, the Connection-Allowlist,
 *   the WebRTC guard in the HTML). The session and the WebContents must still keep everything in.
 * - control: the session's protections off too (no proxy, no request filter, WebRTC over UDP, a
 *   handler that serves every plugin's files): leaky's probes must arrive there, and the other
 *   plugin's script must load, or the other runs proved nothing.
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, protocol } = require('electron');

const workDir = process.env.GETSSH_RENDERER_SMOKE_DIR;
if (!workDir) throw new Error('run plugin-renderer-smoke.mjs, which bundles the code under test');
const {
  PLUGIN_PAGE_SCHEME,
  PLUGIN_PAGE_SCHEME_PRIVILEGES,
  PluginRendererHost,
  WEBRTC_IP_HANDLING_POLICY,
  configureRendererSession,
  createPluginPageHandler,
  disableWebRtcUdp,
  pluginRendererPages,
  rendererPageHandler,
  setMainWindow,
  withWebRtcGuard,
} = require(path.join(workDir, 'main.cjs'));
const { HOST_RESOLVER_RULES, openWebRtcSinks, webrtcLabels, webrtcProbeScript } = require('./webrtc-probe.cjs');

app.commandLine.appendSwitch('use-mock-keychain');
app.commandLine.appendSwitch('host-resolver-rules', HOST_RESOLVER_RULES);
protocol.registerSchemesAsPrivileged([{ scheme: PLUGIN_PAGE_SCHEME, privileges: PLUGIN_PAGE_SCHEME_PRIVILEGES }]);
// As the app does: every WebContents gets WebRTC without UDP. The control run turns it back on.
disableWebRtcUdp(app);
let udpAgain = false;
let created = [];
app.on('web-contents-created', (_event, contents) => {
  created.push(contents);
  if (udpAgain) contents.setWebRTCIPHandlingPolicy('default');
});
// Closing the first window must not quit the app (and turn a failure into exit code 0).
app.on('window-all-closed', () => {});

app.setPath('userData', path.join(workDir, 'user-data'));
app.setPath('downloads', path.join(workDir, 'downloads'));
const pluginsDir = path.join(workDir, 'user-data', 'plugins');
const pluginPreload = path.join(workDir, 'plugin-preload.js');
const windowPreload = path.join(workDir, 'window-preload.js');
const mainCsp = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8')
  .match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
const WEBRTC_GUARD = withWebRtcGuard('');

// The order renderer.js pages start in: the failing plugins first.
const PLUGINS = ['hang', 'broken', 'throws', 'alpha', 'beta', 'leaky', 'wanderer', 'missing', 'escape', 'plain'];
// The plugins whose renderer.js keeps running; wanderer's may end (see above).
const STARTED = ['hang', 'broken', 'throws', 'alpha', 'beta', 'leaky'];
// Requests leaky's renderer.js makes that the control run must see arrive.
const CONTROL_MUST_REACH = [
  '/leak/fetch', '/leak/xhr', 'upgrade /leak/ws', '/leak/es', '/leak/beacon', '/leak/image', '/leak/script.js',
  '/leak/link.css', '/leak/dynamic-import.js', '/leak/worker', '/leak/nested-frame', '/leak/srcdoc-fetch', '/leak/blob-frame',
];
const WEBRTC_MUST_REACH = webrtcLabels('renderer');
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg>';

// GETSSH_RENDERER_SMOKE_TRACE=1 prints each step.
const startedAt = Date.now();
const trace = step => { if (process.env.GETSSH_RENDERER_SMOKE_TRACE) console.error(`[${Date.now() - startedAt} ms] ${step}`); };

let server;
let webrtc;
let requests = [];
let connections = 0;
let downloads = [];
let tidalTabs = [];
let finished = false;

function finish(error) {
  if (finished) return;
  finished = true;
  server?.close();
  webrtc?.close();
  if (error) {
    console.error(`plugin renderer smoke failed: ${error.message || error}`);
    app.exit(1);
  } else {
    console.log('plugin renderer smoke passed');
    app.exit(0);
  }
}

function writePlugin(name, manifest, files) {
  const dir = path.join(pluginsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.html', getssh: { type: 'sandbox' }, ...manifest }));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
}

// The constructor leaky's WebRTC probe uses: its own, or else an about:blank frame's.
const PEER_CONNECTION = "(typeof RTCPeerConnection === 'function' ? RTCPeerConnection : (() => { const frame = document.createElement('iframe'); document.body.appendChild(frame); return frame.contentWindow.RTCPeerConnection; })())";

function writePlugins(origin, port) {
  const page = { 'index.html': '<!doctype html><html><head></head><body>panel</body></html>' };
  writePlugin('hang', { renderer: 'renderer.js' }, { 'renderer.js': 'for (;;) {}' });
  writePlugin('broken', { renderer: 'renderer.js' }, { 'renderer.js': "window.GETSSH.registerSidebarAction('never', '', 'never';" });
  writePlugin('throws', { renderer: 'renderer.js' }, {
    'renderer.js': "window.GETSSH.registerSidebarAction('before', '', 'before the error');\nthrow new Error('this renderer.js throws');",
  });
  writePlugin('alpha', { renderer: 'renderer.js' }, { ...page, 'shared.js': 'window.__alphaShared = true;', 'renderer.js': `
const panelId = 'alpha.main';
window.GETSSH.registerPanel(panelId, 'Alpha', 'getssh-plugin://alpha/index.html');
window.__sidebarHandlers.open = () => window.GETSSH.openPanel(panelId);
window.GETSSH.registerSidebarAction('open', ${JSON.stringify(ICON)}, 'Alpha ' + window.GETSSH.getLocale());
window.GETSSH.onThemeChange(theme => window.GETSSH.registerSidebarAction('theme', '', 'theme ' + theme));
window.GETSSH.invokeBackend('ping').then(
  () => window.GETSSH.registerSidebarAction('backend', '', 'backend answered'),
  error => window.GETSSH.registerSidebarAction('backend', '', 'backend: ' + error.message.slice(0, 100)));
window.GETSSH.registerPanel('alpha.foreign', 'Foreign', 'getssh-plugin://beta/index.html');
` });
  writePlugin('beta', { renderer: './dist/my renderer.js' }, { ...page, 'dist/my renderer.js': `
window.GETSSH.registerPanel('beta.main', 'Beta', 'getssh-plugin://beta/index.html');
window.__sidebarHandlers.open = () => window.GETSSH.openPanel('beta.main');
window.GETSSH.registerSidebarAction('open', '', 'Beta');
` });
  writePlugin('leaky', { renderer: 'renderer.js' }, { 'own.json': '{"own":true}', 'own.bin': 'download me', 'renderer.js': `
// Before anything else: the page's own constructor (the preload removed it, so did the page's guard).
const result = { ownRtc: typeof RTCPeerConnection };
const attempt = (name, run) => {
  try {
    const value = run();
    if (value && typeof value.then === 'function') value.then(v => { result[name] = 'ok:' + v; }, e => { result[name] = 'error:' + e.message; });
    else result[name] = 'ok:' + value;
  } catch (e) { result[name] = 'error:' + e.message; }
};
const add = (tag, props) => { const el = Object.assign(document.createElement(tag), props); document.body.appendChild(el); return 'added'; };
attempt('fetch', () => fetch('${origin}/leak/fetch').then(r => r.status));
attempt('ownFetch', () => fetch('/own.json').then(r => r.json()).then(j => j.own));
attempt('xhr', () => { const x = new XMLHttpRequest(); x.open('GET', '${origin}/leak/xhr'); x.send(); return 'sent'; });
attempt('websocket', () => { new WebSocket('ws://127.0.0.1:${port}/leak/ws'); return 'opened'; });
attempt('eventSource', () => { new EventSource('${origin}/leak/es'); return 'opened'; });
attempt('beacon', () => navigator.sendBeacon('${origin}/leak/beacon', 'data'));
attempt('image', () => { new Image().src = '${origin}/leak/image'; return 'set'; });
attempt('script', () => add('script', { src: '${origin}/leak/script.js' }));
attempt('stylesheet', () => add('link', { rel: 'stylesheet', href: '${origin}/leak/link.css' }));
attempt('dynamicImport', () => import('${origin}/leak/dynamic-import.js').then(() => 'loaded'));
attempt('worker', () => {
  const source = "fetch('${origin}/leak/worker').then(() => postMessage('ok'), e => postMessage('error:' + e.message))";
  new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))).onmessage = e => { result.workerFetch = e.data; };
  return 'started';
});
attempt('frame', () => add('iframe', { src: '${origin}/leak/nested-frame' }));
attempt('srcdocFrame', () => add('iframe', { srcdoc: "<script>fetch('${origin}/leak/srcdoc-fetch')<\\/script>" }));
attempt('blobFrame', () => add('iframe', { src: URL.createObjectURL(new Blob(["<img src='${origin}/leak/blob-frame'>"], { type: 'text/html' })) }));
// Another plugin's id in the message: the main process takes the plugin from the WebContents.
window.__getsshPluginHost.send('registerSidebarAction', { id: 'forged', icon: '', label: 'forged', pluginId: 'alpha' });
// As a script, which needs no CORS: a fetch() of it would fail even if the handler served it.
attempt('otherPluginFile', () => new Promise(resolve => add('script', { src: 'getssh-plugin://alpha/shared.js', onload: () => resolve('loaded'), onerror: () => resolve('blocked') })));
attempt('windowOpen', () => String(window.open('getssh-plugin://leaky/own.json')));
attempt('download', () => add('a', { href: '/own.bin', download: 'own.bin' }) && document.querySelector('a[download]').click());
// The page must still be here afterwards to report.
setTimeout(() => { try { location.href = 'getssh-plugin://leaky/own.json'; } catch (e) {} }, 200);
window.GETSSH.registerSidebarAction('probe', '', 'leaky');
const webrtcProbe = ${webrtcProbeScript('renderer', webrtc.ports.renderer, PEER_CONNECTION)};
Promise.all([new Promise(resolve => setTimeout(resolve, 2500)), webrtcProbe]).then(([, webrtcResult]) => {
  result.opaqueOrigin = window.origin === 'null';
  result.topIsSelf = window.parent === window && window.top === window;
  result.noWindowApi = typeof window.electronAPI === 'undefined';
  result.webrtc = webrtcResult.result;
  window.__probeResult = result;
});
` });
  writePlugin('wanderer', { renderer: 'renderer.js' }, { 'own.json': '{}', 'renderer.js': `
window.GETSSH.registerSidebarAction('here', '', 'here');
setTimeout(() => { location.href = 'getssh-plugin://wanderer/own.json'; }, 50);
setTimeout(() => { window.GETSSH.registerSidebarAction('stayed', '', 'stayed'); }, 400);
setTimeout(() => { location.href = '${origin}/leak/navigate'; }, 800);
` });
  writePlugin('missing', { renderer: 'renderer.js' }, page);
  writePlugin('escape', { renderer: '../alpha/renderer.js' }, page);
  writePlugin('plain', {}, page);
}

/** The installed plugins as PluginManager.loadPlugins lists them: each folder's package.json. */
function installedPlugins() {
  return PLUGINS.map(name => {
    const localPath = path.join(pluginsDir, name);
    return { ...JSON.parse(fs.readFileSync(path.join(localPath, 'package.json'), 'utf8')), localPath };
  });
}

function writeHostPage(run) {
  const hostPage = path.join(workDir, `host-${run}.html`);
  fs.writeFileSync(hostPage, `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${mainCsp}"></head><body>
<script src="bridge.js"></script>
<script>
window.__start = () => { window.__smoke.initPluginBridge(); };
</script></body></html>`, 'utf8');
  return hostPage;
}

const READ_STATE = `(() => {
  const { sidebarActions } = window.__smoke.usePluginStore.getState();
  const { registeredPanels, tabs } = window.__smoke.useSessionStore.getState();
  return {
    actions: Object.fromEntries(sidebarActions.map(action => [action.id, { pluginId: action.pluginId, label: action.label, icon: action.icon.length > 0 }])),
    panels: JSON.parse(JSON.stringify(registeredPanels)),
    tabs: tabs.map(tab => ({ id: tab.id, title: tab.title, pluginUrl: tab.config && tab.config.pluginUrl })),
  };
})()`;

const CLICK = `(() => {
  const actions = window.__smoke.usePluginStore.getState().sidebarActions;
  for (const id of ['plugin-alpha-open', 'plugin-beta-open']) actions.find(action => action.id === id)?.onClick();
})()`;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function poll(read, done) {
  let state;
  for (let i = 0; i < 100; i++) {
    await delay(100);
    state = await read();
    if (done(state)) return state;
  }
  return state;
}

const readWindow = window => () => window.webContents.executeJavaScript(READ_STATE);

const ALPHA_UPDATE = "window.GETSSH.registerSidebarAction('open', '', 'Alpha updated');";

/** Installs a new alpha: its renderer.js changes on disk and its page URL gets an install count. */
async function updateAlpha(window, host) {
  const file = path.join(pluginsDir, 'alpha', 'renderer.js');
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, ALPHA_UPDATE);
  try {
    const before = Object.fromEntries(STARTED.map(id => [id, host.contentsFor(id)]));
    await host.sync(await pluginRendererPages(installedPlugins(), new Map([['alpha', 1]])));
    const state = await poll(readWindow(window), state => state.actions['plugin-alpha-open']?.label === 'Alpha updated');
    return { state, kept: Object.fromEntries(STARTED.map(id => [id, host.contentsFor(id) === before[id]])), alphaUrl: host.contentsFor('alpha')?.getURL() };
  } finally {
    fs.writeFileSync(file, original);
  }
}

/** The plugin page handler with the pages' own protections taken off. */
function withoutPagePolicy(handler) {
  return async request => {
    const response = await handler(request);
    const headers = new Headers(response.headers);
    headers.delete('content-security-policy');
    headers.delete('connection-allowlist');
    const page = (headers.get('content-type') || '').startsWith('text/html');
    const body = page ? (await response.text()).replace(WEBRTC_GUARD, '') : response.body;
    return new Response(body, { status: response.status, headers });
  };
}

// Listens after the session's own handler: a cancelled download arrives with defaultPrevented set.
// One that is not still gets a path, so it never opens a save dialog.
const watchDownloads = ses => ses.on('will-download', (event, item) => {
  downloads.push({ url: item.getURL(), cancelled: event.defaultPrevented });
  if (!event.defaultPrevented) item.setSavePath(path.join(app.getPath('downloads'), 'not-cancelled.bin'));
});

// What each run sets on a plugin's session.
const SESSIONS = {
  policy: async (ses, pluginId) => {
    await configureRendererSession(ses, pluginId, pluginsDir);
    watchDownloads(ses);
  },
  session: async (ses, pluginId) => {
    await configureRendererSession(ses, pluginId, pluginsDir);
    // The handler the session got, the pages' own protections taken off.
    ses.protocol.unhandle(PLUGIN_PAGE_SCHEME);
    ses.protocol.handle(PLUGIN_PAGE_SCHEME, withoutPagePolicy(rendererPageHandler(pluginsDir, pluginId)));
    watchDownloads(ses);
  },
  control: async ses => {
    // Every plugin's files, as the main window's handler serves them.
    ses.protocol.handle(PLUGIN_PAGE_SCHEME, withoutPagePolicy(createPluginPageHandler(pluginsDir)));
    // No save dialog for leaky's download, which this run does not test.
    ses.on('will-download', event => event.preventDefault());
    watchDownloads(ses);
  },
};

async function runPlugins(run) {
  requests = [];
  connections = 0;
  downloads = [];
  tidalTabs = [];
  created = [];
  webrtc.reset();
  udpAgain = run === 'control';
  const window = new BrowserWindow({ show: false, webPreferences: { preload: windowPreload, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  setMainWindow(window);
  const host = new PluginRendererHost({ pluginsDir, preload: pluginPreload, partitionPrefix: `smoke-${run}`, configureSession: SESSIONS[run] });
  host.registerIpc();
  try {
    trace(`${run}: loading the main window`);
    await window.loadFile(writeHostPage(run));
    await window.webContents.executeJavaScript('window.__start()');
    // The window sent the theme and language before this call, on the same IPC pipe.
    await window.webContents.executeJavaScript('window.electronAPI.getPluginRendererState()');
    await host.sync(await pluginRendererPages(installedPlugins()));
    trace(`${run}: plugins starting`);
    const registered = await poll(readWindow(window), state => ['plugin-alpha-theme', 'plugin-alpha-backend', 'plugin-beta-open', 'plugin-leaky-probe'].every(id => state.actions[id]));
    const probe = await poll(() => {
      const contents = host.contentsFor('leaky');
      if (!contents) throw new Error(`${run}: leaky's renderer.js stopped before it reported (the [PluginRenderer] line above says why)`);
      return contents.mainFrame.executeJavaScript('window.__probeResult || null');
    }, result => result !== null);
    if (!probe) throw new Error(`${run}: leaky's renderer.js did not report within 10 seconds`);
    const leaky = host.contentsFor('leaky');
    trace(`${run}: registered ${JSON.stringify(Object.keys(registered.actions))}, probe ${!!probe}`);
    // wanderer's last navigation went out 800 ms after it started, long before leaky reported.
    const views = Object.fromEntries(PLUGINS.map(id => [id, host.contentsFor(id) ? { url: host.contentsFor(id).getURL(), pid: host.contentsFor(id).getOSProcessId(), udp: host.contentsFor(id).getWebRTCIPHandlingPolicy() } : null]));
    const wanderer = views.wanderer;
    delete views.wanderer;
    const wandererActions = Object.keys((await readWindow(window)()).actions).filter(id => id.startsWith('plugin-wanderer-'));
    await window.webContents.executeJavaScript(CLICK);
    const opened = await poll(readWindow(window), state => state.tabs.length >= 2);
    trace(`${run}: opened ${opened.tabs.length} panels`);
    const updated = run === 'policy' ? await updateAlpha(window, host) : null;
    // Late requests (the worker, nested frames) still count.
    await delay(1000);
    return {
      registered, opened, updated, probe, views, wanderer, wandererActions,
      leakyUrl: leaky.getURL(),
      windowPid: window.webContents.getOSProcessId(),
      windows: BrowserWindow.getAllWindows().length,
      created: created.length,
      tidalTabs: [...tidalTabs],
      requests: [...new Set(requests)].sort(),
      connections,
      webrtcArrived: webrtc.arrived(),
      downloads: [...downloads],
      saved: fs.existsSync(app.getPath('downloads')) ? fs.readdirSync(app.getPath('downloads')) : [],
    };
  } finally {
    host.dispose();
    window.destroy();
  }
}

// Objects compare by content, whatever order their keys come in.
const canonical = value => JSON.stringify(value, (key, inner) => inner && typeof inner === 'object' && !Array.isArray(inner)
  ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  : inner);

function expectEqual(actual, expected, what) {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`${what}: expected ${canonical(expected)}, got ${canonical(actual)}`);
  }
}

/** What renderer.js registered and opened, and where it ran, the same in every run. */
function checkRegistrations(run, { registered, opened, views, windowPid, windows, tidalTabs, leakyUrl }) {
  expectEqual(Object.keys(views).filter(id => views[id]), STARTED, `${run}: plugins with a renderer.js WebContents (besides wanderer)`);
  for (const id of STARTED) {
    const view = views[id];
    const url = new URL(view.url);
    if (url.protocol !== 'getssh-plugin:' || url.hostname !== id || url.pathname !== '/' || url.searchParams.get('locale') !== 'zh-CN') {
      throw new Error(`${run}: renderer.js of ${id} is not on its own page: ${view.url}`);
    }
    if (!(view.pid > 0) || view.pid === windowPid || view.pid === process.pid) {
      throw new Error(`${run}: renderer.js of ${id} runs in process ${view.pid}; the main window is ${windowPid}, the main process ${process.pid}`);
    }
    if (view.udp !== (run === 'control' ? 'default' : WEBRTC_IP_HANDLING_POLICY)) throw new Error(`${run}: renderer.js of ${id} may use WebRTC over UDP (${view.udp})`);
  }
  // In no window: the main window is the only one.
  if (windows !== 1) throw new Error(`${run}: ${windows} windows`);
  // The page stayed where it was started, through two navigations.
  if (leakyUrl !== views.leaky.url) throw new Error(`${run}: leaky's page navigated to ${leakyUrl}`);
  const actions = Object.fromEntries(Object.entries(registered.actions).filter(([id]) => !id.startsWith('plugin-wanderer-')));
  expectEqual(actions, {
    'plugin-throws-before': { pluginId: 'throws', label: 'before the error', icon: false },
    'plugin-alpha-open': { pluginId: 'alpha', label: 'Alpha zh-CN', icon: true },
    'plugin-alpha-theme': { pluginId: 'alpha', label: 'theme dark', icon: false },
    'plugin-alpha-backend': { pluginId: 'alpha', label: 'backend: invokeBackend() is not available in renderer.js; call it from a plugin page.', icon: false },
    'plugin-beta-open': { pluginId: 'beta', label: 'Beta', icon: false },
    // Registered with alpha's id in the message: it counts as leaky's.
    'plugin-leaky-forged': { pluginId: 'leaky', label: 'forged', icon: false },
    'plugin-leaky-probe': { pluginId: 'leaky', label: 'leaky', icon: false },
  }, `${run}: sidebar actions`);
  expectEqual(registered.panels, {
    'alpha.main': { pluginId: 'alpha', title: 'Alpha', renderUrl: 'getssh-plugin://alpha/index.html' },
    'beta.main': { pluginId: 'beta', title: 'Beta', renderUrl: 'getssh-plugin://beta/index.html' },
  }, `${run}: panels`);
  // The pages run side by side, so the panels open in no fixed order.
  expectEqual([...opened.tabs].sort((a, b) => a.id.localeCompare(b.id)), [
    { id: 'panel-smoke-alpha-alpha.main', title: 'Alpha', pluginUrl: 'getssh-plugin://alpha/index.html' },
    { id: 'panel-smoke-beta-beta.main', title: 'Beta', pluginUrl: 'getssh-plugin://beta/index.html' },
  ], `${run}: panels opened by the sidebar actions`);
  expectEqual([...tidalTabs].sort(), ['panel-smoke-alpha-alpha.main', 'panel-smoke-beta-beta.main'], `${run}: panel tabs registered with tidal-engine`);
}

/** What leaky could not do in the policy and session runs, whatever got past the page. */
function checkContained(run, result) {
  const { probe } = result;
  if (result.requests.length || result.connections) {
    throw new Error(`${run}: renderer.js reached the network: ${JSON.stringify(result.requests)} (${result.connections} connections)`);
  }
  if (result.webrtcArrived.length) throw new Error(`${run}: renderer.js reached the WebRTC test servers: ${result.webrtcArrived.join(', ')}`);
  if (probe.ownFetch !== 'ok:true') throw new Error(`${run}: renderer.js could not read its own plugin's files: ${JSON.stringify(probe)}`);
  if (probe.otherPluginFile !== 'ok:blocked') throw new Error(`${run}: renderer.js loaded another plugin's file: ${probe.otherPluginFile}`);
  if (probe.windowOpen !== 'ok:null') throw new Error(`${run}: window.open gave ${probe.windowOpen}`);
  if (!probe.topIsSelf || !probe.noWindowApi) throw new Error(`${run}: renderer.js is not on a page of its own: ${JSON.stringify(probe)}`);
  // In the session run only the preload took it away: the page's guard was cut out.
  if (probe.ownRtc !== 'undefined') throw new Error(`${run}: renderer.js had its own RTCPeerConnection`);
  // The main window, and one WebContents per plugin with a renderer.js (two for the updated alpha).
  const expected = 1 + STARTED.length + 1 + (result.updated ? 1 : 0);
  if (result.created !== expected) throw new Error(`${run}: ${result.created} WebContents were made, ${expected} expected (window.open?)`);
  if (result.downloads.some(item => !item.cancelled) || result.saved.length) {
    throw new Error(`${run}: a download was not cancelled: ${JSON.stringify(result.downloads)} ${JSON.stringify(result.saved)}`);
  }
}

/** wanderer's navigations: never out, and its page either still on its start page or over. */
function checkWanderer(run, result, expectEnded) {
  if (result.requests.includes('/leak/navigate')) throw new Error(`${run}: wanderer's navigation reached the server`);
  if (expectEnded) {
    if (result.wanderer || result.wandererActions.length) {
      throw new Error(`${run}: wanderer's page ended up elsewhere and kept running: ${JSON.stringify({ view: result.wanderer, actions: result.wandererActions })}`);
    }
  } else {
    if (!result.wanderer || new URL(result.wanderer.url).pathname !== '/') throw new Error(`${run}: wanderer's page left its start page: ${JSON.stringify(result.wanderer)}`);
    expectEqual([...result.wandererActions].sort(), ['plugin-wanderer-here', 'plugin-wanderer-stayed'], `${run}: wanderer's actions (it stayed through its navigations)`);
  }
}

app.whenReady().then(async () => {
  if (!mainCsp || !/frame-src [^;]*getssh-plugin:/.test(mainCsp)) {
    throw new Error('index.html has no CSP that frames getssh-plugin:');
  }
  ipcMain.handle('tidal:register-tab', (_event, tab) => { tidalTabs.push(tab.tabId); return { success: true }; });
  server = http.createServer((request, response) => {
    requests.push(request.url);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.end(request.url.endsWith('.js') ? 'window.__remoteScript = true;' : 'x');
  });
  server.on('connection', () => { connections += 1; });
  server.on('upgrade', (request, socket) => { requests.push(`upgrade ${request.url}`); socket.destroy(); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  webrtc = await openWebRtcSinks(['renderer']);
  writePlugins(`http://127.0.0.1:${port}`, port);

  const pages = await pluginRendererPages(installedPlugins());
  expectEqual(pages.map(page => page.pluginId), [...STARTED, 'wanderer'], 'plugins with a renderer.js page');

  const guarded = await runPlugins('policy');
  checkRegistrations('policy', guarded);
  checkContained('policy', guarded);
  checkWanderer('policy', guarded, true);
  const { updated, probe } = guarded;
  expectEqual(Object.keys(updated.state.actions).sort(), ['plugin-alpha-open', 'plugin-beta-open', 'plugin-leaky-forged', 'plugin-leaky-probe', 'plugin-throws-before'],
    'update: sidebar actions (alpha\'s old page registered theme and backend)');
  expectEqual(updated.state.actions['plugin-alpha-open'], { pluginId: 'alpha', label: 'Alpha updated', icon: false }, 'update: the new renderer.js ran');
  expectEqual(updated.kept, Object.fromEntries(STARTED.map(id => [id, id !== 'alpha'])), 'update: only alpha\'s WebContents was replaced');
  if (new URL(updated.alphaUrl).searchParams.get('install') !== '1') throw new Error(`update: alpha's new page is not its new URL: ${updated.alphaUrl}`);
  if (!probe.opaqueOrigin) throw new Error(`policy: renderer.js is not in an opaque origin: ${JSON.stringify(probe)}`);
  // Its own RTCPeerConnection is gone, and an about:blank frame's is out of reach.
  if (probe.webrtc !== 'error: SecurityError') throw new Error(`policy: renderer.js reached an RTCPeerConnection: ${probe.webrtc}`);

  const sessionOnly = await runPlugins('session');
  checkRegistrations('session', sessionOnly);
  checkContained('session', sessionOnly);
  checkWanderer('session', sessionOnly, false);
  // Without the page's sandbox the about:blank frame's RTCPeerConnection ran: only the session and
  // the WebContents held it. The download was tried, and cancelled.
  if (sessionOnly.probe.webrtc !== 'done') throw new Error(`session: the WebRTC probe did not run, so it tests nothing: ${sessionOnly.probe.webrtc}`);
  if (!sessionOnly.downloads.length) throw new Error('session: the download never reached the session, so it tests nothing');

  const control = await runPlugins('control');
  checkRegistrations('control', control);
  checkWanderer('control', control, false);
  const missed = CONTROL_MUST_REACH.filter(request => !control.requests.includes(request));
  if (missed.length) throw new Error(`control: these probes still did not arrive, so they test nothing: ${missed.join(', ')}`);
  if (control.probe.otherPluginFile !== 'ok:loaded') {
    throw new Error(`control: leaky could not load another plugin's file from a handler that serves it, so that check tests nothing: ${control.probe.otherPluginFile}`);
  }
  const webrtcMissed = WEBRTC_MUST_REACH.filter(label => !control.webrtcArrived.includes(label));
  if (webrtcMissed.length || control.probe.webrtc !== 'done') {
    throw new Error(`control: these WebRTC probes still did not arrive, so they test nothing: ${webrtcMissed.join(', ')} (${control.probe.webrtc})`);
  }

  console.log(JSON.stringify({
    started: STARTED.length,
    sidebarActions: Object.keys(guarded.registered.actions).filter(id => !id.startsWith('plugin-wanderer-')).length,
    panelsOpened: guarded.opened.tabs.length,
    blocked: CONTROL_MUST_REACH.length,
    controlReached: control.requests.length,
    webrtcBlocked: WEBRTC_MUST_REACH.length,
    webrtcControlReached: control.webrtcArrived.length,
    sessionOnly: { requests: sessionOnly.requests.length, webrtc: sessionOnly.webrtcArrived.length, downloadsCancelled: sessionOnly.downloads.length },
  }));
  finish();
}).catch(finish);

setTimeout(() => finish(new Error('timed out after 200 seconds')), 200_000).unref();
