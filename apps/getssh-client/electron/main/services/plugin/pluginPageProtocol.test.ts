// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_PLUGIN_PAGE_BYTES,
  PLUGIN_PAGE_SCHEME_PRIVILEGES,
  createPluginPageHandler,
  pluginPageCsp,
} from './pluginPageProtocol';

/*
 * The getssh-plugin:// handler: every response carries a CSP that keeps the page offline.
 * scripts/security/plugin-page-smoke.cjs checks the same policy in a real Electron window.
 */

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
    fs.writeFileSync(path.join(demo, 'style.css'), 'body{}');
    fs.writeFileSync(path.join(demo, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(path.join(demo, 'data.bin'), Buffer.from([1, 2, 3]));
    fs.writeFileSync(path.join(pluginsDir, 'other', 'secret.js'), 'other plugin');
    fs.writeFileSync(path.join(root, 'outside.txt'), 'outside');
    handle = createPluginPageHandler(pluginsDir);
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('serves a page with the bridge and the plugin\'s policy', async () => {
    const response = await get('getssh-plugin://demo/index.html');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(pluginPageCsp('demo'));
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const text = await response.text();
    expect(text.startsWith('<!doctype html><html><head>\n    <script>')).toBe(true);
    expect(text).toContain('var PLUGIN_ID = "demo";');
    expect(text).toContain('window.GETSSH = {');
    expect(text).toContain('<title>t</title></head><body>hi</body>');
  });

  it('puts the bridge first on a page without <head>', async () => {
    const text = await (await get('getssh-plugin://demo/bare.html')).text();
    expect(text.trimStart().startsWith('<script>')).toBe(true);
    expect(text.endsWith('<p>no head</p>')).toBe(true);
  });

  it('gives every other file the same policy', async () => {
    for (const [file, type] of [
      ['app.js', 'application/javascript; charset=utf-8'],
      ['style.css', 'text/css; charset=utf-8'],
      ['icon.svg', 'image/svg+xml'],
      ['data.bin', 'application/octet-stream'],
    ]) {
      const response = await get(`getssh-plugin://demo/${file}`);
      expect(response.status, file).toBe(200);
      expect(response.headers.get('content-type'), file).toBe(type);
      expect(response.headers.get('content-security-policy'), file).toBe(pluginPageCsp('demo'));
      await response.arrayBuffer();
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
});
