'use strict';

/*
 * Plugin pages (getssh-plugin://) stay offline. A hidden Electron window with the main window's
 * real CSP (index.html) embeds a probe page, served by the real handler, in the same sandboxed
 * iframe PluginPane uses. The page tries every way out we know of against a loopback server, which
 * counts what arrives. The page must still load its own files and talk to the host.
 *
 * A second run serves the same page without the plugin page CSP: the probes must reach the server
 * there, or the first run proved nothing.
 *
 * Not probed: WebRTC. CSP cannot block it (see pluginPageProtocol.ts).
 */

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, protocol } = require('electron');
const {
  PLUGIN_PAGE_SCHEME,
  PLUGIN_PAGE_SCHEME_PRIVILEGES,
  createPluginPageHandler,
} = require('../../dist-electron/main/plugin-page-protocol.js');

app.commandLine.appendSwitch('use-mock-keychain');
protocol.registerSchemesAsPrivileged([{ scheme: PLUGIN_PAGE_SCHEME, privileges: PLUGIN_PAGE_SCHEME_PRIVILEGES }]);
// Closing the first probe window must not quit the app (and turn a failure into exit code 0).
app.on('window-all-closed', () => {});

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-plugin-page-'));
app.setPath('userData', path.join(tempDir, 'user-data'));
const pluginsDir = path.join(tempDir, 'user-data', 'plugins');
const mainCsp = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8')
  .match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];

// Requests the probe page makes that the control run (no plugin page CSP) must see arrive.
const CONTROL_MUST_REACH = [
  '/leak/fetch', '/leak/xhr', 'upgrade /leak/ws', '/leak/es', '/leak/beacon', '/leak/image', '/leak/img-tag',
  '/leak/script.js', '/leak/link.css', '/leak/css-import.css', '/leak/css-background.png', '/leak/font.woff',
  '/leak/inline-background.png', '/leak/nested-frame', '/leak/nested-navigation', '/leak/meta-refresh',
  '/leak/svg-document', '/leak/worker', '/leak/srcdoc-fetch', '/leak/blob-frame', '/leak/dynamic-import.js',
];

let server;
let requests = [];
let connections = 0;
let stripPolicy = false;
let finished = false;

function finish(error) {
  if (finished) return;
  finished = true;
  server?.close();
  try { fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch {}
  if (error) {
    console.error(`plugin page smoke failed: ${error.message || error}`);
    app.exit(1);
  } else {
    console.log('plugin page smoke passed');
    app.exit(0);
  }
}

function writeProbePlugin(origin, port) {
  const probe = path.join(pluginsDir, 'probe');
  const other = path.join(pluginsDir, 'other');
  fs.mkdirSync(probe, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'foreign.js'), 'window.__foreignScript = true;');
  fs.writeFileSync(path.join(probe, 'own.js'), 'window.__ownScript = true;');
  fs.writeFileSync(path.join(probe, 'own.json'), '{"own":true}');
  fs.writeFileSync(path.join(probe, 'own.css'),
    `@import url("${origin}/leak/css-import.css"); body { background: url("${origin}/leak/css-background.png"); } .own { color: rgb(1, 2, 3); }`);
  fs.writeFileSync(path.join(probe, 'own.png'), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  fs.writeFileSync(path.join(probe, 'navigate.html'),
    `<!doctype html><html><head></head><body><script>setTimeout(() => { location.href = '${origin}/leak/nested-navigation'; }, 50);</script></body></html>`);
  fs.writeFileSync(path.join(probe, 'navigate-self.html'),
    `<!doctype html><html><head></head><body><script>setTimeout(() => { location.href = '${origin}/leak/top-navigation'; }, 50);</script></body></html>`);
  fs.writeFileSync(path.join(probe, 'refresh.html'),
    `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${origin}/leak/meta-refresh"></head><body></body></html>`);
  fs.writeFileSync(path.join(probe, 'document.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg"><script>fetch('${origin}/leak/svg-document')</script></svg>`);
  fs.writeFileSync(path.join(probe, 'index.html'), `<!doctype html><html><head>
<link rel="stylesheet" href="own.css"><link rel="stylesheet" href="${origin}/leak/link.css">
<link rel="prefetch" href="${origin}/leak/prefetch"><link rel="preload" as="script" href="${origin}/leak/preload.js">
<style>@font-face { font-family: probe; src: url("${origin}/leak/font.woff"); } .font { font-family: probe; } .background { background: url("${origin}/leak/inline-background.png"); }</style>
<script src="own.js"></script><script src="getssh-plugin://other/foreign.js"></script><script src="${origin}/leak/script.js"></script>
</head><body>
<div class="own font background">probe</div><img id="own-image" src="own.png"><img src="${origin}/leak/img-tag"><video src="${origin}/leak/video.mp4"></video>
<iframe src="${origin}/leak/nested-frame"></iframe><iframe src="navigate.html"></iframe><iframe src="refresh.html"></iframe><iframe src="document.svg"></iframe>
<object data="${origin}/leak/object"></object><embed src="${origin}/leak/embed">
<form id="form" action="${origin}/leak/form"><input name="a" value="1"></form>
<script>
const result = {};
const attempt = (name, run) => {
  try {
    const value = run();
    if (value && typeof value.then === 'function') value.then(v => { result[name] = 'ok:' + v; }, e => { result[name] = 'error:' + e.message; });
    else result[name] = 'ok:' + value;
  } catch (e) { result[name] = 'error:' + e.message; }
};
attempt('fetch', () => fetch('${origin}/leak/fetch').then(r => r.status));
attempt('ownFetch', () => fetch('own.json').then(r => r.json()).then(j => j.own));
attempt('xhr', () => { const x = new XMLHttpRequest(); x.open('GET', '${origin}/leak/xhr'); x.send(); return 'sent'; });
attempt('websocket', () => { new WebSocket('ws://127.0.0.1:${port}/leak/ws'); return 'opened'; });
attempt('eventSource', () => { new EventSource('${origin}/leak/es'); return 'opened'; });
attempt('beacon', () => navigator.sendBeacon('${origin}/leak/beacon', 'data'));
attempt('image', () => { new Image().src = '${origin}/leak/image'; return 'set'; });
attempt('dynamicImport', () => import('${origin}/leak/dynamic-import.js').then(() => 'loaded'));
attempt('worker', () => {
  const source = "fetch('${origin}/leak/worker').then(() => postMessage('ok'), e => postMessage('error:' + e.message))";
  new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))).onmessage = e => { result.workerFetch = e.data; };
  return 'started';
});
attempt('srcdocFrame', () => {
  const frame = document.createElement('iframe');
  frame.srcdoc = "<script>fetch('${origin}/leak/srcdoc-fetch')<\\/script>";
  document.body.appendChild(frame);
  return 'added';
});
attempt('blobFrame', () => {
  const frame = document.createElement('iframe');
  frame.src = URL.createObjectURL(new Blob(["<img src='${origin}/leak/blob-frame'>"], { type: 'text/html' }));
  document.body.appendChild(frame);
  return 'added';
});
attempt('dataFrame', () => {
  const frame = document.createElement('iframe');
  frame.src = "data:text/html,<img src='${origin}/leak/data-frame'>";
  document.body.appendChild(frame);
  return 'added';
});
attempt('popup', () => String(window.open('${origin}/leak/popup')));
attempt('form', () => { document.getElementById('form').submit(); return 'submitted'; });
attempt('bridge', () => window.GETSSH.invokeBackend('ping', { n: 1 }));
window.GETSSH.showNotification('probe', 'bridge');
setTimeout(() => {
  result.ownScript = window.__ownScript === true;
  result.foreignScript = window.__foreignScript === true;
  result.ownImage = document.getElementById('own-image').naturalWidth === 1;
  result.ownStyle = getComputedStyle(document.querySelector('.own')).color === 'rgb(1, 2, 3)';
  result.opaqueOrigin = window.origin === 'null';
  parent.postMessage({ probeResult: result }, '*');
}, 2500);
</script></body></html>`);
}

function writeHostPage(run) {
  const hostPage = path.join(tempDir, `host-${run}.html`);
  // The bridge must still reach the host: answer its RPC and record what it posts.
  fs.writeFileSync(hostPage, `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${mainCsp}"></head><body>
<iframe id="probe" sandbox="allow-scripts" src="getssh-plugin://probe/index.html?run=${run}"></iframe>
<iframe sandbox="allow-scripts" src="getssh-plugin://probe/navigate-self.html?run=${run}"></iframe>
<script>
window.__probe = null;
window.__bridge = [];
addEventListener('message', event => {
  const data = event.data || {};
  if (data.probeResult) { window.__probe = data.probeResult; return; }
  if (event.source !== document.getElementById('probe').contentWindow) return;
  if (data.type === 'rpc-invoke') {
    window.__bridge.push('rpc:' + data.pluginId + ':' + data.method);
    event.source.postMessage({ type: 'rpc-response', reqId: data.reqId, result: 'pong' }, '*');
  } else if (data.__getssh_plugin) {
    window.__bridge.push(data.action + ':' + data.pluginId);
  }
});
</script></body></html>`, 'utf8');
  return hostPage;
}

async function runProbe(run) {
  requests = [];
  connections = 0;
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await window.loadFile(writeHostPage(run));
    let probe = null;
    for (let i = 0; i < 100 && !probe; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      probe = await window.webContents.executeJavaScript('window.__probe');
    }
    if (!probe) throw new Error(`${run}: the probe page never reported`);
    // Late requests (navigations, the worker) still count.
    await new Promise(resolve => setTimeout(resolve, 1000));
    const bridge = await window.webContents.executeJavaScript('window.__bridge');
    return { probe, bridge, requests: [...new Set(requests)].sort(), connections };
  } finally {
    window.destroy();
  }
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
  writeProbePlugin(`http://127.0.0.1:${port}`, port);

  const handler = createPluginPageHandler(pluginsDir);
  protocol.handle(PLUGIN_PAGE_SCHEME, async request => {
    const response = await handler(request);
    if (!stripPolicy) return response;
    const headers = new Headers(response.headers);
    headers.delete('content-security-policy');
    return new Response(response.body, { status: response.status, headers });
  });

  const guarded = await runProbe('policy');
  const { probe } = guarded;
  if (guarded.requests.length || guarded.connections) {
    throw new Error(`a plugin page reached the network: ${JSON.stringify(guarded.requests)} (${guarded.connections} connections)`);
  }
  if (!probe.ownScript || !probe.ownImage || !probe.ownStyle || probe.ownFetch !== 'ok:true') {
    throw new Error(`a plugin page lost its own files: ${JSON.stringify(probe)}`);
  }
  if (probe.bridge !== 'ok:pong' || !guarded.bridge.includes('rpc:probe:ping') || !guarded.bridge.includes('showNotification:probe')) {
    throw new Error(`the plugin bridge stopped working: ${JSON.stringify({ probe, bridge: guarded.bridge })}`);
  }
  if (probe.foreignScript) throw new Error('a plugin page ran another plugin\'s script');
  if (!probe.opaqueOrigin) throw new Error('the plugin page is not in an opaque origin');

  stripPolicy = true;
  const control = await runProbe('control');
  const missed = CONTROL_MUST_REACH.filter(request => !control.requests.includes(request));
  if (missed.length) {
    throw new Error(`without the plugin page CSP these probes still did not arrive, so they test nothing: ${missed.join(', ')}`);
  }
  // The main window's frame-src holds the plugin frame itself, with or without the page's policy.
  if (control.requests.includes('/leak/top-navigation')) throw new Error('a plugin frame navigated itself off getssh-plugin:');
  if (!control.probe.foreignScript) throw new Error('control: another plugin\'s script no longer loads without the policy');

  console.log(JSON.stringify({ blocked: CONTROL_MUST_REACH.length, controlReached: control.requests.length }));
  finish();
}).catch(finish);

setTimeout(() => finish(new Error('timed out after 60 seconds')), 60_000).unref();
