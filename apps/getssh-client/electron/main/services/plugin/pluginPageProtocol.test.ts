// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  MAX_PLUGIN_PAGE_BYTES,
  PLUGIN_PAGE_CONNECTION_ALLOWLIST,
  PLUGIN_PAGE_SCHEME_PRIVILEGES,
  WEBRTC_IP_HANDLING_POLICY,
  createPluginPageHandler,
  disableWebRtcUdp,
  pluginPageCsp,
  pluginRendererPages,
  rendererScriptPath,
  withWebRtcGuard,
} from './pluginPageProtocol';

/*
 * The getssh-plugin:// handler: every response carries a CSP that keeps the page offline, and
 * pages keep WebRTC off as well. scripts/security/plugin-page-smoke.cjs checks the same in a real
 * Electron window, and scripts/security/plugin-renderer-smoke.mjs the renderer.js pages.
 */

const GUARD = '<script>delete window.RTCPeerConnection; delete window.webkitRTCPeerConnection;</script>';

function directives(csp: string): Map<string, string[]> {
  return new Map(csp.split(';').map(part => part.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]));
}

describe('pluginPageCsp', () => {
  it('allows the plugin\'s own files, data: and blob: only, and no network', () => {
    const policy = directives(pluginPageCsp('demo'));
    const allowed = new Set(['getssh-plugin://demo', "'unsafe-inline'", "'unsafe-eval'", "'none'", 'data:', 'blob:']);
    for (const [name, sources] of policy) {
      for (const source of sources) expect(allowed, `${name} ${source}`).toContain(source);
    }
    expect(policy.get('default-src')).toEqual(["'none'"]);
    expect(policy.get('connect-src')).toEqual(['getssh-plugin://demo']);
    expect(policy.get('frame-src')).toEqual(['getssh-plugin://demo']);
    expect(policy.get('form-action')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'none'"]);
  });

  it('refuses a host that could add directives or sources', () => {
    for (const host of ['', '.', '..', 'a;connect-src *', 'a b', 'a,b', "a'", 'a\nb', 'x'.repeat(129)]) {
      expect(() => pluginPageCsp(host), JSON.stringify(host)).toThrow('Invalid plugin host');
    }
  });

  it('is not paired with bypassCSP on the scheme', () => {
    expect(PLUGIN_PAGE_SCHEME_PRIVILEGES).not.toHaveProperty('bypassCSP');
  });
});

describe('withWebRtcGuard', () => {
  it('puts the guard after the doctype, ahead of every script of the page', () => {
    expect(withWebRtcGuard('<!doctype html><script>page()</script>')).toBe(`<!doctype html>${GUARD}<script>page()</script>`);
    expect(withWebRtcGuard('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN"><html>'))
      .toBe(`<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">${GUARD}<html>`);
  });

  it('skips a byte order mark, white space and comments before the doctype', () => {
    expect(withWebRtcGuard('\uFEFF \n<!-- a --><!--b-->\n<!doctype html><html>')).toBe(`\uFEFF \n<!-- a --><!--b-->\n<!doctype html>${GUARD}<html>`);
  });

  it('puts the guard first on a page without a doctype', () => {
    expect(withWebRtcGuard('<script>page()</script>')).toBe(`${GUARD}<script>page()</script>`);
    expect(withWebRtcGuard('  <!-- note --><p>x</p>')).toBe(`  <!-- note -->${GUARD}<p>x</p>`);
    // An unclosed comment would hide the rest of the page anyway; the guard goes before it.
    expect(withWebRtcGuard('<!-- open <script>page()</script>')).toBe(`${GUARD}<!-- open <script>page()</script>`);
    expect(withWebRtcGuard('')).toBe(GUARD);
  });
});

describe('disableWebRtcUdp', () => {
  it('gives every WebContents created afterwards the UDP-free WebRTC policy', () => {
    const listeners: Array<(event: unknown, contents: { setWebRTCIPHandlingPolicy(policy: string): void }) => void> = [];
    const app = { on: (event: string, listener: (typeof listeners)[number]) => { expect(event).toBe('web-contents-created'); listeners.push(listener); } };
    disableWebRtcUdp(app as unknown as Electron.App);
    expect(listeners).toHaveLength(1);
    const contents = { setWebRTCIPHandlingPolicy: vi.fn() };
    listeners[0]({}, contents);
    expect(contents.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('disable_non_proxied_udp');
    expect(WEBRTC_IP_HANDLING_POLICY).toBe('disable_non_proxied_udp');
  });
});

describe('createPluginPageHandler', () => {
  let root: string;
  let pluginsDir: string;
  let handle: (request: Request) => Promise<Response>;
  const get = (url: string) => handle(new Request(url));

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-plugin-page-'));
    pluginsDir = path.join(root, 'plugins');
    const demo = path.join(pluginsDir, 'demo');
    fs.mkdirSync(path.join(demo, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(pluginsDir, 'other'), { recursive: true });
    fs.writeFileSync(path.join(demo, 'index.html'), '<!doctype html><html><head><title>t</title></head><body>hi</body></html>');
    fs.writeFileSync(path.join(demo, 'bare.html'), '<p>no head</p>');
    fs.writeFileSync(path.join(demo, 'big.html'), Buffer.alloc(MAX_PLUGIN_PAGE_BYTES + 1, 0x20));
    fs.writeFileSync(path.join(demo, 'app.js'), 'window.x = 1;');
    fs.mkdirSync(path.join(demo, 'dist'));
    fs.writeFileSync(path.join(demo, 'dist', 'my renderer.js'), 'window.GETSSH.registerPanel("demo.main", "Demo", "getssh-plugin://demo/index.html");');
    fs.writeFileSync(path.join(demo, 'style.css'), 'body{}');
    fs.writeFileSync(path.join(demo, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(path.join(demo, 'data.bin'), Buffer.from([1, 2, 3]));
    fs.writeFileSync(path.join(pluginsDir, 'other', 'secret.js'), 'other plugin');
    fs.writeFileSync(path.join(root, 'outside.txt'), 'outside');
    handle = createPluginPageHandler(pluginsDir);
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('serves a page with the WebRTC guard, the bridge and the plugin\'s policy', async () => {
    const response = await get('getssh-plugin://demo/index.html');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(pluginPageCsp('demo'));
    expect(response.headers.get('connection-allowlist')).toBe('(response-origin);webrtc=block');
    expect(PLUGIN_PAGE_CONNECTION_ALLOWLIST).toBe('(response-origin);webrtc=block');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const text = await response.text();
    expect(text.startsWith(`<!doctype html>${GUARD}<html><head>\n    <script>`)).toBe(true);
    expect(text).toContain('var PLUGIN_ID = "demo";');
    expect(text).toContain('window.GETSSH = {');
    expect(text).toContain('<title>t</title></head><body>hi</body>');
  });

  it('puts the guard, then the bridge first on a page without <head>', async () => {
    const response = await get('getssh-plugin://demo/bare.html');
    expect(response.headers.get('connection-allowlist')).toBe(PLUGIN_PAGE_CONNECTION_ALLOWLIST);
    const text = await response.text();
    expect(text.trimStart().startsWith(`${GUARD}<script>\n      (function() {`)).toBe(true);
    expect(text.endsWith('<p>no head</p>')).toBe(true);
  });

  it('gives every other file the same policy, SVG without scripts, and no Connection-Allowlist', async () => {
    for (const [file, type, csp] of [
      ['app.js', 'application/javascript; charset=utf-8', pluginPageCsp('demo')],
      ['style.css', 'text/css; charset=utf-8', pluginPageCsp('demo')],
      ['icon.svg', 'image/svg+xml', `${pluginPageCsp('demo')}; sandbox`],
      ['data.bin', 'application/octet-stream', pluginPageCsp('demo')],
    ]) {
      const response = await get(`getssh-plugin://demo/${file}`);
      expect(response.status, file).toBe(200);
      expect(response.headers.get('content-type'), file).toBe(type);
      expect(response.headers.get('content-security-policy'), file).toBe(csp);
      // A download with this header crashed Electron 44's main process (data.bin in an iframe).
      expect(response.headers.has('connection-allowlist'), file).toBe(false);
      expect(Buffer.from(await response.arrayBuffer()).includes('RTCPeerConnection'), file).toBe(false);
    }
  });

  it('keeps the policy on errors, and does not name local paths', async () => {
    for (const [url, status] of [
      ['getssh-plugin://demo/missing.html', 404],
      ['getssh-plugin://demo/missing.js', 404],
      ['getssh-plugin://demo/assets', 404],
      ['getssh-plugin://demo/big.html', 404],
    ] as const) {
      const response = await get(url);
      expect(response.status, url).toBe(status);
      expect(response.headers.get('content-security-policy'), url).toBe(pluginPageCsp('demo'));
      expect(response.headers.has('connection-allowlist'), url).toBe(false);
      expect(await response.text(), url).not.toContain(root);
    }
  });

  it('does not serve another plugin\'s files or anything outside the plugins folder', async () => {
    for (const url of [
      'getssh-plugin://demo/%2e%2e%2fother%2fsecret.js',
      'getssh-plugin://demo/%2e%2e%2f%2e%2e%2foutside.txt',
      'getssh-plugin://demo/..%5c..%5coutside.txt',
    ]) {
      const response = await get(url);
      expect([403, 404], url).toContain(response.status);
      expect(await response.text(), url).not.toMatch(/other plugin|outside/);
      expect(response.headers.get('content-security-policy'), url).toBe(pluginPageCsp('demo'));
    }
  });

  it('answers a host it cannot put in a policy with a deny-all policy', async () => {
    const response = await get('getssh-plugin://a;b/index.html');
    expect(response.status).toBe(400);
    expect(directives(response.headers.get('content-security-policy')!).get('default-src')).toEqual(["'none'"]);
  });

  it('serves the renderer.js page: the WebRTC guard, the bridge, then the script from the plugin\'s folder', async () => {
    const response = await get('getssh-plugin://demo/?renderer=dist%2Fmy%20renderer.js&locale=zh-CN');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(pluginPageCsp('demo'));
    expect(response.headers.get('connection-allowlist')).toBe(PLUGIN_PAGE_CONNECTION_ALLOWLIST);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const text = await response.text();
    expect(text.startsWith(`<!doctype html>${GUARD}<html>`)).toBe(true);
    expect(text).toContain('var PLUGIN_ID = "demo";');
    expect(text).toContain('window.__GETSSH_LOCALE = "zh-CN";');
    expect(text).toContain("invokeBackend() is not available in renderer.js");
    expect(text.indexOf('window.GETSSH = {')).toBeLessThan(text.indexOf('<script src='));
    expect(text.endsWith('<body><script src="/dist/my%20renderer.js"></script></body></html>')).toBe(true);
    // The install count only tells the window the plugin changed; the page is the same.
    const reinstalled = await (await get('getssh-plugin://demo/?renderer=dist%2Fmy%20renderer.js&install=3&locale=zh-CN')).text();
    expect(reinstalled).toBe(text);
    // The script itself comes from the same handler, with the same policy.
    const script = await get('getssh-plugin://demo/dist/my%20renderer.js');
    expect(script.headers.get('content-security-policy')).toBe(pluginPageCsp('demo'));
    expect(await script.text()).toContain('registerPanel');
  });

  it('puts only a language tag into the renderer.js page', async () => {
    for (const locale of ['"};alert(1);//', 'zh CN', '</script><script>alert(1)', 'x'.repeat(60)]) {
      const response = await get(`getssh-plugin://demo/?renderer=app.js&locale=${encodeURIComponent(locale)}`);
      expect(response.status, locale).toBe(200);
      const text = await response.text();
      expect(text, locale).not.toContain('window.__GETSSH_LOCALE = "');
      expect(text, locale).not.toContain('alert(1)');
    }
  });

  it('does not make a renderer.js page of a path outside the plugin\'s folder or of a missing file', async () => {
    for (const [url, status] of [
      ['getssh-plugin://demo/?renderer=..%2Fother%2Fsecret.js', 400],
      ['getssh-plugin://demo/?renderer=..%5Cother%5Csecret.js', 400],
      ['getssh-plugin://demo/?renderer=%2Fetc%2Fpasswd', 400],
      ['getssh-plugin://demo/?renderer=', 400],
      ['getssh-plugin://demo/?renderer=missing.js', 404],
      ['getssh-plugin://demo/?renderer=assets', 404],
      ['getssh-plugin://demo/', 403],
    ] as const) {
      const response = await get(url);
      expect(response.status, url).toBe(status);
      expect(response.headers.get('content-security-policy'), url).toBe(pluginPageCsp('demo'));
      expect(response.headers.has('connection-allowlist'), url).toBe(false);
      expect(await response.text(), url).not.toMatch(/other plugin|<script/);
    }
  });
});

describe('rendererScriptPath', () => {
  it('keeps a plain relative path', () => {
    expect(rendererScriptPath('renderer.js')).toBe('renderer.js');
    expect(rendererScriptPath('./dist//renderer.js')).toBe('dist/renderer.js');
    expect(rendererScriptPath('dist/my renderer.js')).toBe('dist/my renderer.js');
  });

  it('refuses anything that could leave the plugin folder', () => {
    for (const value of ['', '.', './', '../other/renderer.js', 'dist/../../x.js', '/etc/passwd', 'C:/x.js', 'C:\\x.js', 'dist\\..\\x.js', 'a\0b.js', 'x'.repeat(1025), 42, null, undefined, ['renderer.js']]) {
      expect(rendererScriptPath(value), String(value)).toBeNull();
    }
  });
});

describe('pluginRendererPages', () => {
  let root: string;
  const folder = (name: string) => path.join(root, 'plugins', name);
  const write = (file: string, text = 'window.ran = true;') => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-plugin-renderers-'));
    write('plugins/alpha/renderer.js');
    write('plugins/beta/dist/my renderer.js');
    write('plugins/bad name/renderer.js');
    write('plugins/folder/dist/index.js');
    write('plugins/no-renderer/index.html');
    fs.mkdirSync(folder('missing'), { recursive: true });
    write('outside.js');
    fs.mkdirSync(folder('linked'), { recursive: true });
    // Windows needs a privilege for symbolic links; the realpath check is the same there.
    if (process.platform !== 'win32') fs.symlinkSync(path.join(root, 'outside.js'), path.join(folder('linked'), 'renderer.js'));
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('lists the page of each plugin whose renderer is a file in its own folder, and only those', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pages = await pluginRendererPages([
        { localPath: folder('alpha'), renderer: 'renderer.js' },
        { localPath: folder('missing'), renderer: 'renderer.js' },
        { localPath: folder('beta'), renderer: './dist/my renderer.js' },
        { localPath: folder('escape'), renderer: '../alpha/renderer.js' },
        { localPath: folder('folder'), renderer: 'dist' },
        { localPath: folder('bad name'), renderer: 'renderer.js' },
        { localPath: folder('linked'), renderer: 'renderer.js' },
        { localPath: folder('no-renderer') },
        { renderer: 'renderer.js' },
      ]);
      expect(pages).toEqual([
        { pluginId: 'alpha', url: 'getssh-plugin://alpha/?renderer=renderer.js' },
        { pluginId: 'beta', url: 'getssh-plugin://beta/?renderer=dist%2Fmy%20renderer.js' },
      ]);
      const warned = warn.mock.calls.map(call => String(call[0]).match(/plugin '([^']+)'/)?.[1]).sort();
      expect(warned).toEqual(['bad name', 'escape', 'folder', 'linked', 'missing']);
    } finally {
      warn.mockRestore();
    }
  });

  it('puts the install count into the page URL of a plugin installed since GETSSH started', async () => {
    const pages = await pluginRendererPages([
      { localPath: folder('alpha'), renderer: 'renderer.js' },
      { localPath: folder('beta'), renderer: 'dist/my renderer.js' },
    ], new Map([['alpha', 2]]));
    expect(pages.map(page => page.url)).toEqual([
      'getssh-plugin://alpha/?renderer=renderer.js&install=2',
      'getssh-plugin://beta/?renderer=dist%2Fmy%20renderer.js',
    ]);
  });
});
