'use strict';

/*
 * Plugins' renderer.js runs as the SDK guide says, and stays offline. plugin-renderer-smoke.mjs
 * bundles the code under test and starts this in Electron with a temporary HOME.
 *
 * A hidden window with the main window's real CSP (index.html) runs the real PluginBridge, plugin
 * store and session store; the real getssh-plugin:// handler serves the pages, and the real
 * pluginRendererPages lists them from the plugins' package.json files:
 * - hang: never returns. broken: a syntax error. throws: registers a sidebar action, then
 *   throws. These three start first.
 * - alpha: the guide's example (a panel, and a sidebar action whose handler opens it), plus
 *   getLocale(), onThemeChange(), invokeBackend() and a panel of another plugin's page.
 * - beta: its script in a subfolder, with a space in the name.
 * - leaky: tries the ways out it can from renderer.js against a loopback server, which counts
 *   what arrives.
 * - missing, escape, plain: a missing script, a script outside the folder, no renderer.
 * Clicking alpha's and beta's sidebar actions must open their panels in the session store.
 *
 * A second run serves the same pages without the plugin page CSP: leaky's probes must reach the
 * server there, or the first run proved nothing.
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, protocol } = require('electron');

const workDir = process.env.GETSSH_RENDERER_SMOKE_DIR;
if (!workDir) throw new Error('run plugin-renderer-smoke.mjs, which bundles the code under test');
const {
  PLUGIN_PAGE_SCHEME,
  PLUGIN_PAGE_SCHEME_PRIVILEGES,
  createPluginPageHandler,
  pluginRendererPages,
} = require(path.join(workDir, 'protocol.cjs'));

app.commandLine.appendSwitch('use-mock-keychain');
protocol.registerSchemesAsPrivileged([{ scheme: PLUGIN_PAGE_SCHEME, privileges: PLUGIN_PAGE_SCHEME_PRIVILEGES }]);
// Closing the first window must not quit the app (and turn a failure into exit code 0).
app.on('window-all-closed', () => {});

app.setPath('userData', path.join(workDir, 'user-data'));
const pluginsDir = path.join(workDir, 'user-data', 'plugins');
const mainCsp = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8')
  .match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];

// The order renderer.js frames start in: the failing plugins first.
const PLUGINS = ['hang', 'broken', 'throws', 'alpha', 'beta', 'leaky', 'missing', 'escape', 'plain'];
const STARTED = ['hang', 'broken', 'throws', 'alpha', 'beta', 'leaky'];
// Requests leaky's renderer.js makes that the control run (no plugin page CSP) must see arrive.
const CONTROL_MUST_REACH = [
  '/leak/fetch', '/leak/xhr', 'upgrade /leak/ws', '/leak/es', '/leak/beacon', '/leak/image', '/leak/script.js',
  '/leak/link.css', '/leak/dynamic-import.js', '/leak/worker', '/leak/nested-frame', '/leak/srcdoc-fetch', '/leak/blob-frame',
];
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg>';

// GETSSH_RENDERER_SMOKE_TRACE=1 prints each step.
const startedAt = Date.now();
const trace = step => { if (process.env.GETSSH_RENDERER_SMOKE_TRACE) console.error(`[${Date.now() - startedAt} ms] ${step}`); };

let server;
let requests = [];
let connections = 0;
let stripPolicy = false;
let finished = false;

function finish(error) {
  if (finished) return;
  finished = true;
  server?.close();
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

function writePlugins(origin, port) {
  const page = { 'index.html': '<!doctype html><html><head></head><body>panel</body></html>' };
  writePlugin('hang', { renderer: 'renderer.js' }, { 'renderer.js': 'for (;;) {}' });
  writePlugin('broken', { renderer: 'renderer.js' }, { 'renderer.js': "window.GETSSH.registerSidebarAction('never', '', 'never';" });
  writePlugin('throws', { renderer: 'renderer.js' }, {
    'renderer.js': "window.GETSSH.registerSidebarAction('before', '', 'before the error');\nthrow new Error('this renderer.js throws');",
  });
  writePlugin('alpha', { renderer: 'renderer.js' }, { ...page, 'renderer.js': `
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
  writePlugin('leaky', { renderer: 'renderer.js' }, { 'own.json': '{"own":true}', 'renderer.js': `
const result = {};
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
attempt('parentDocument', () => String(parent.document.title));
window.GETSSH.registerSidebarAction('probe', '', 'leaky');
setTimeout(() => {
  result.opaqueOrigin = window.origin === 'null';
  parent.postMessage({ rendererProbe: result }, '*');
}, 2500);
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

function writeHostPage(run, pages) {
  const hostPage = path.join(workDir, `host-${run}.html`);
  fs.writeFileSync(hostPage, `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${mainCsp}"></head><body>
<script>
window.__probe = null;
window.__tidalTabs = [];
addEventListener('message', event => { if (event.data && event.data.rendererProbe) window.__probe = event.data.rendererProbe; });
window.electronAPI = {
  getPluginRenderers: () => Promise.resolve(${JSON.stringify(pages)}),
  tidalRegisterTab: (...args) => { window.__tidalTabs.push(args); return Promise.resolve({ success: true }); },
};
</script>
<script src="bridge.js"></script>
<script>
window.__smoke.initPluginBridge();
window.__start = () => {
  window.__booted = window.__smoke.bootSandboxedPlugins().then(() => 'ok', error => 'error:' + error.message);
};
</script></body></html>`, 'utf8');
  return hostPage;
}

const READ_STATE = `(async () => {
  const { sidebarActions } = window.__smoke.usePluginStore.getState();
  const { registeredPanels, tabs } = window.__smoke.useSessionStore.getState();
  return {
    booted: await window.__booted,
    frames: [...document.querySelectorAll('iframe[data-plugin-renderer]')].map(frame => ({
      id: frame.getAttribute('data-plugin-id'), src: frame.getAttribute('src'), sandbox: frame.getAttribute('sandbox'), hidden: frame.style.display === 'none',
    })),
    actions: Object.fromEntries(sidebarActions.map(action => [action.id, { pluginId: action.pluginId, label: action.label, icon: action.icon.length > 0 }])),
    panels: JSON.parse(JSON.stringify(registeredPanels)),
    tabs: tabs.map(tab => ({ id: tab.id, title: tab.title, pluginUrl: tab.config && tab.config.pluginUrl })),
    tidalTabs: window.__tidalTabs.map(args => args[0]),
    probe: window.__probe,
  };
})()`;

const CLICK = `(() => {
  const actions = window.__smoke.usePluginStore.getState().sidebarActions;
  for (const id of ['plugin-alpha-open', 'plugin-beta-open']) actions.find(action => action.id === id)?.onClick();
})()`;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function poll(window, done) {
  let state;
  for (let i = 0; i < 100; i++) {
    await delay(100);
    state = await window.webContents.executeJavaScript(READ_STATE);
    if (done(state)) return state;
  }
  return state;
}

async function runPlugins(run, pages) {
  requests = [];
  connections = 0;
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  try {
    trace(`${run}: loading the host page`);
    await window.loadFile(writeHostPage(run, pages));
    // Like the app, which starts plugins once its page has loaded (after the unlock): the page's
    // load would wait for frames added before it, and hang's frame never finishes loading.
    await window.webContents.executeJavaScript('window.__start()');
    trace(`${run}: loaded, plugins starting`);
    const registered = await poll(window, state => state.probe && ['plugin-alpha-theme', 'plugin-alpha-backend', 'plugin-beta-open'].every(id => state.actions[id]));
    trace(`${run}: registered ${JSON.stringify(Object.keys(registered.actions))}, probe ${!!registered.probe}`);
    await window.webContents.executeJavaScript(CLICK);
    const opened = await poll(window, state => state.tabs.length >= 2);
    trace(`${run}: opened ${opened.tabs.length} panels`);
    // Late requests (the worker, nested frames) still count.
    await delay(1000);
    return { registered, opened, requests: [...new Set(requests)].sort(), connections };
  } finally {
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

/** What renderer.js registered and opened, the same with or without the plugin page CSP. */
function checkRegistrations(run, { registered, opened }) {
  if (registered.booted !== 'ok') throw new Error(`${run}: bootSandboxedPlugins failed: ${registered.booted}`);
  expectEqual(registered.frames.map(frame => frame.id), STARTED, `${run}: renderer.js frames`);
  for (const frame of registered.frames) {
    const src = new URL(frame.src);
    if (frame.sandbox !== 'allow-scripts' || !frame.hidden || src.protocol !== 'getssh-plugin:' || src.hostname !== frame.id
      || src.pathname !== '/' || src.searchParams.get('locale') !== 'zh-CN') {
      throw new Error(`${run}: renderer.js frame of ${frame.id} is not a hidden sandboxed frame on its own page: ${JSON.stringify(frame)}`);
    }
  }
  expectEqual(registered.actions, {
    'plugin-throws-before': { pluginId: 'throws', label: 'before the error', icon: false },
    'plugin-alpha-open': { pluginId: 'alpha', label: 'Alpha zh-CN', icon: true },
    'plugin-alpha-theme': { pluginId: 'alpha', label: 'theme dark', icon: false },
    'plugin-alpha-backend': { pluginId: 'alpha', label: 'backend: invokeBackend() is not available in renderer.js; call it from a plugin page.', icon: false },
    'plugin-beta-open': { pluginId: 'beta', label: 'Beta', icon: false },
    'plugin-leaky-probe': { pluginId: 'leaky', label: 'leaky', icon: false },
  }, `${run}: sidebar actions`);
  expectEqual(registered.panels, {
    'alpha.main': { pluginId: 'alpha', title: 'Alpha', renderUrl: 'getssh-plugin://alpha/index.html' },
    'beta.main': { pluginId: 'beta', title: 'Beta', renderUrl: 'getssh-plugin://beta/index.html' },
  }, `${run}: panels`);
  // The frames run side by side, so the panels open in no fixed order.
  expectEqual([...opened.tabs].sort((a, b) => a.id.localeCompare(b.id)), [
    { id: 'panel-smoke-alpha-alpha.main', title: 'Alpha', pluginUrl: 'getssh-plugin://alpha/index.html' },
    { id: 'panel-smoke-beta-beta.main', title: 'Beta', pluginUrl: 'getssh-plugin://beta/index.html' },
  ], `${run}: panels opened by the sidebar actions`);
  expectEqual([...opened.tidalTabs].sort(), ['panel-smoke-alpha-alpha.main', 'panel-smoke-beta-beta.main'], `${run}: panel tabs registered with tidal-engine`);
}

app.whenReady().then(async () => {
  if (!mainCsp || !/frame-src [^;]*getssh-plugin:/.test(mainCsp)) {
    throw new Error('index.html has no CSP that frames getssh-plugin:');
  }
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
  writePlugins(`http://127.0.0.1:${port}`, port);

  const pages = await pluginRendererPages(installedPlugins());
  expectEqual(pages.map(page => page.pluginId), STARTED, 'plugins with a renderer.js page');

  const handler = createPluginPageHandler(pluginsDir);
  protocol.handle(PLUGIN_PAGE_SCHEME, async request => {
    const response = await handler(request);
    if (!stripPolicy) return response;
    const headers = new Headers(response.headers);
    headers.delete('content-security-policy');
    return new Response(response.body, { status: response.status, headers });
  });

  const guarded = await runPlugins('policy', pages);
  checkRegistrations('policy', guarded);
  if (guarded.requests.length || guarded.connections) {
    throw new Error(`renderer.js reached the network: ${JSON.stringify(guarded.requests)} (${guarded.connections} connections)`);
  }
  const { probe } = guarded.registered;
  if (probe.ownFetch !== 'ok:true') throw new Error(`renderer.js could not read its own plugin's files: ${JSON.stringify(probe)}`);
  if (!probe.opaqueOrigin || !String(probe.parentDocument).startsWith('error:')) {
    throw new Error(`renderer.js is not in an opaque origin cut off from the window: ${JSON.stringify(probe)}`);
  }

  stripPolicy = true;
  const control = await runPlugins('control', pages);
  checkRegistrations('control', control);
  const missed = CONTROL_MUST_REACH.filter(request => !control.requests.includes(request));
  if (missed.length) {
    throw new Error(`without the plugin page CSP these probes still did not arrive, so they test nothing: ${missed.join(', ')}`);
  }

  console.log(JSON.stringify({
    started: guarded.registered.frames.length,
    sidebarActions: Object.keys(guarded.registered.actions).length,
    panelsOpened: guarded.opened.tabs.length,
    blocked: CONTROL_MUST_REACH.length,
    controlReached: control.requests.length,
  }));
  finish();
}).catch(finish);

setTimeout(() => finish(new Error('timed out after 90 seconds')), 90_000).unref();
