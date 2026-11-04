// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The main process side of renderer.js pages: one WebContents and one in-memory session per
 * plugin, what they may do, and the calls they make, told apart by WebContents. Electron is faked
 * here; scripts/security/plugin-renderer-smoke.mjs runs the same module in a real Electron.
 */

type Listener = (...args: any[]) => any;

const fake = vi.hoisted(() => {
  let nextId = 100;
  class FakeContents {
    id = nextId++;
    url = '';
    sent: unknown[][] = [];
    listeners = new Map<string, Listener[]>();
    windowOpenHandler: Listener | null = null;
    audioMuted = false;
    destroyed = false;
    mainFrame = { parent: null };
    loadURL = (url: string) => { this.url = url; return new Promise<void>(() => {}); };
    send = (...args: unknown[]) => { this.sent.push(args); };
    close = () => { this.destroyed = true; };
    isDestroyed = () => this.destroyed;
    on = (event: string, listener: Listener) => { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); return this; };
    setWindowOpenHandler = (handler: Listener) => { this.windowOpenHandler = handler; };
    setAudioMuted = (muted: boolean) => { this.audioMuted = muted; };
    emit = (event: string, ...args: unknown[]) => (this.listeners.get(event) ?? []).forEach(listener => listener(...args));
  }
  class FakeSession {
    proxy: unknown = null;
    beforeRequest: Listener | null = null;
    permissionRequest: Listener | null = null;
    permissionCheck: Listener | null = null;
    devicePermission: Listener | null = null;
    listeners = new Map<string, Listener[]>();
    protocolHandlers = new Map<string, Listener>();
    clears = 0;
    constructor(public partition: string) {}
    setProxy = async (config: unknown) => { this.proxy = config; };
    webRequest = { onBeforeRequest: (listener: Listener) => { this.beforeRequest = listener; } };
    setPermissionRequestHandler = (handler: Listener) => { this.permissionRequest = handler; };
    setPermissionCheckHandler = (handler: Listener) => { this.permissionCheck = handler; };
    setDevicePermissionHandler = (handler: Listener) => { this.devicePermission = handler; };
    on = (event: string, listener: Listener) => { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); return this; };
    protocol = { handle: (scheme: string, handler: Listener) => {
      if (this.protocolHandlers.has(scheme)) throw new Error(`${scheme} is already handled`);
      this.protocolHandlers.set(scheme, handler);
    } };
    clearStorageData = async () => { this.clears++; };
    clearCache = async () => {};
  }
  const sessions = new Map<string, FakeSession>();
  const views: Array<{ options: any; webContents: FakeContents }> = [];
  const main = new FakeContents();
  const toMain: unknown[][] = [];
  const ipc = { on: new Map<string, Listener[]>(), handle: new Map<string, Listener>() };
  return { FakeContents, FakeSession, sessions, views, main, toMain, ipc };
});

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: Listener) => { fake.ipc.on.set(channel, [...(fake.ipc.on.get(channel) ?? []), listener]); },
    removeListener: (channel: string, listener: Listener) => { fake.ipc.on.set(channel, (fake.ipc.on.get(channel) ?? []).filter(l => l !== listener)); },
    handle: (channel: string, listener: Listener) => {
      if (fake.ipc.handle.has(channel)) throw new Error(`a handler for ${channel} is already registered`);
      fake.ipc.handle.set(channel, listener);
    },
    removeHandler: (channel: string) => { fake.ipc.handle.delete(channel); },
  },
  session: {
    fromPartition: (partition: string) => {
      if (!fake.sessions.has(partition)) fake.sessions.set(partition, new fake.FakeSession(partition));
      return fake.sessions.get(partition);
    },
  },
  WebContentsView: class {
    webContents: InstanceType<typeof fake.FakeContents>;
    constructor(options: unknown) {
      this.webContents = new fake.FakeContents();
      fake.views.push({ options, webContents: this.webContents });
    }
  },
}));
vi.mock('../../windowRegistry', () => ({
  isMainWebContents: (contents: unknown) => contents === fake.main,
  sendToMainWindow: (...args: unknown[]) => { fake.toMain.push(args); },
}));

import {
  PLUGIN_RENDERER_ACTION_CHANNEL,
  PLUGIN_RENDERER_ENV_CHANNEL,
  PLUGIN_RENDERER_EVENT_CHANNEL,
  PLUGIN_RENDERER_GONE_CHANNEL,
  PLUGIN_RENDERER_SIDEBAR_CLICK_CHANNEL,
  PLUGIN_RENDERER_STATE_CHANNEL,
  PLUGIN_RENDERER_UI_CHANNEL,
  PluginRendererHost,
  configureRendererSession,
  isPluginRendererSender,
} from './pluginRendererHost';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-plugin-renderer-host-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
for (const [file, text] of [['alpha/renderer.js', 'alpha'], ['alpha/own.json', '{}'], ['beta/secret.js', 'beta secret']]) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}

const page = (pluginId: string, extra = '') => ({ pluginId, url: `getssh-plugin://${pluginId}/?renderer=renderer.js${extra}` });
const newHost = () => new PluginRendererHost({ pluginsDir: root, preload: '/app/plugin-preload/pluginRenderer.js' });
const viewOf = (host: PluginRendererHost, pluginId: string) => host.contentsFor(pluginId) as unknown as InstanceType<typeof fake.FakeContents>;
const ui = () => fake.toMain.filter(([channel]) => channel === PLUGIN_RENDERER_UI_CHANNEL).map(([, call]) => call);
const gone = () => fake.toMain.filter(([channel]) => channel === PLUGIN_RENDERER_GONE_CHANNEL).map(([, pluginId]) => pluginId);
const act = (host: PluginRendererHost, contents: unknown, action: unknown, payload: unknown, frame: unknown = { parent: null }) =>
  host.handleAction(contents as never, frame as never, action, payload);

beforeEach(() => {
  fake.toMain.length = 0;
  fake.sessions.clear();
  fake.views.length = 0;
  fake.ipc.on.clear();
  fake.ipc.handle.clear();
});

describe('starting renderer.js pages', () => {
  it('gives each plugin a WebContents in no window, on an in-memory session of its own', async () => {
    const host = newHost();
    host.setEnv(fake.main as never, { theme: 'dark', locale: 'zh-CN' });
    await host.sync([page('alpha'), page('beta', '&install=2')]);
    expect(fake.views.map(view => view.options.webPreferences)).toEqual([0, 1].map(i => ({
      session: fake.sessions.get(['getssh-plugin-renderer:alpha', 'getssh-plugin-renderer:beta'][i]),
      preload: '/app/plugin-preload/pluginRenderer.js',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      disableDialogs: true,
      backgroundThrottling: false,
      spellcheck: false,
      navigateOnDragDrop: false,
    })));
    // In memory: no persist: in the partition names.
    expect([...fake.sessions.keys()]).toEqual(['getssh-plugin-renderer:alpha', 'getssh-plugin-renderer:beta']);
    expect(viewOf(host, 'alpha').url).toBe('getssh-plugin://alpha/?renderer=renderer.js&locale=zh-CN');
    expect(viewOf(host, 'beta').url).toBe('getssh-plugin://beta/?renderer=renderer.js&install=2&locale=zh-CN');
    // A page nobody sees plays no sound.
    expect([viewOf(host, 'alpha').audioMuted, viewOf(host, 'beta').audioMuted]).toEqual([true, true]);
    expect(isPluginRendererSender({ sender: viewOf(host, 'alpha') })).toBe(true);
    expect(isPluginRendererSender({ sender: fake.main })).toBe(false);
    host.destroyAll();
  });

  it('keeps the page in place: no navigation, no new windows, no waiting on beforeunload', async () => {
    const host = newHost();
    await host.sync([page('alpha')]);
    const contents = viewOf(host, 'alpha');
    expect(contents.windowOpenHandler?.({ url: 'https://example.com/' })).toEqual({ action: 'deny' });
    for (const event of ['will-navigate', 'will-redirect', 'will-prevent-unload']) {
      const preventDefault = vi.fn();
      contents.emit(event, { preventDefault });
      expect(preventDefault, event).toHaveBeenCalledOnce();
    }
    // Electron 44 reports the page's own navigations here; its frames may still load its pages.
    const mainFrame = vi.fn();
    const subframe = vi.fn();
    contents.emit('will-frame-navigate', { isMainFrame: true, preventDefault: mainFrame });
    contents.emit('will-frame-navigate', { isMainFrame: false, preventDefault: subframe });
    expect(mainFrame).toHaveBeenCalledOnce();
    expect(subframe).not.toHaveBeenCalled();
    host.destroyAll();
  });

  it('sets a session up to reach nothing but the plugin\'s own files', async () => {
    const ses = new fake.FakeSession('test');
    await configureRendererSession(ses as never, 'alpha', root);
    expect(ses.proxy).toEqual({ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:1', proxyBypassRules: '<-loopback>' });
    const verdict = (url: string) => new Promise(resolve => ses.beforeRequest!({ url }, resolve));
    expect(await verdict('getssh-plugin://alpha/own.json')).toEqual({ cancel: false });
    for (const url of ['http://127.0.0.1:8080/', 'https://example.com/', 'ws://127.0.0.1:1/', 'file:///etc/passwd', 'data:text/plain,x']) {
      expect(await verdict(url), url).toEqual({ cancel: true });
    }
    const granted = vi.fn();
    ses.permissionRequest!(null, 'media', granted);
    expect(granted).toHaveBeenCalledExactlyOnceWith(false);
    expect(ses.permissionCheck!(null, 'notifications')).toBe(false);
    expect(ses.devicePermission!({ deviceType: 'usb' })).toBe(false);
    const preventDefault = vi.fn();
    ses.listeners.get('will-download')!.forEach(listener => listener({ preventDefault }, {}));
    expect(preventDefault).toHaveBeenCalledOnce();
    const handler = ses.protocolHandlers.get('getssh-plugin')!;
    expect((await handler(new Request('getssh-plugin://alpha/own.json'))).status).toBe(200);
    const foreign = await handler(new Request('getssh-plugin://beta/secret.js'));
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).not.toContain('beta secret');
  });
});

describe('the life of a renderer.js page', () => {
  it('keeps an unchanged page, replaces an updated one with a cleared session, and stops a removed one', async () => {
    const host = newHost();
    await host.sync([page('alpha'), page('beta')]);
    const alpha = viewOf(host, 'alpha');
    const beta = viewOf(host, 'beta');
    await host.sync([page('alpha'), page('beta', '&install=1')]);
    expect(viewOf(host, 'alpha')).toBe(alpha);
    expect(beta.isDestroyed()).toBe(true);
    expect(viewOf(host, 'beta')).not.toBe(beta);
    expect(viewOf(host, 'beta').url).toBe('getssh-plugin://beta/?renderer=renderer.js&install=1');
    // Set up once (protocol.handle would throw a second time), cleared for the new version.
    expect(fake.sessions.get('getssh-plugin-renderer:beta')!.clears).toBe(1);
    expect(isPluginRendererSender({ sender: beta })).toBe(false);
    await host.sync([page('beta', '&install=1')]);
    expect(alpha.isDestroyed()).toBe(true);
    expect(host.contentsFor('alpha')).toBeUndefined();
    expect(gone()).toEqual(['beta', 'alpha']);
    host.destroyAll();
    expect(gone()).toEqual(['beta', 'alpha', 'beta']);
  });

  it('does not restart a page whose process ended, until the plugin is updated', async () => {
    const host = newHost();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await host.sync([page('alpha')]);
    const first = viewOf(host, 'alpha');
    first.emit('render-process-gone', {}, { reason: 'killed' });
    expect(gone()).toEqual(['alpha']);
    expect(first.isDestroyed()).toBe(true);
    await host.sync([page('alpha')]);
    expect(host.contentsFor('alpha')).toBeUndefined();
    await host.sync([page('alpha', '&install=1')]);
    expect(viewOf(host, 'alpha')).not.toBe(first);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    host.destroyAll();
  });

  it('ends a page that left its start page or failed, not one whose own navigation was stopped', async () => {
    const host = newHost();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await host.sync([page('alpha'), page('beta'), page('gamma')]);
    const [alpha, beta, gamma] = ['alpha', 'beta', 'gamma'].map(id => viewOf(host, id));
    for (const contents of [alpha, beta, gamma]) contents.emit('did-navigate', {}, contents.url);
    // Stopped navigations (ERR_ABORTED) and frames other than the page's own keep it.
    alpha.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'getssh-plugin://alpha/own.bin', true);
    alpha.emit('did-fail-load', {}, -33, 'ERR_NETWORK_ACCESS_REVOKED', 'http://127.0.0.1/', false);
    expect(host.contentsFor('alpha')).toBe(alpha);
    // An error page in its place (a navigation its Connection-Allowlist refused), or any other document.
    alpha.emit('did-fail-load', {}, -33, 'ERR_NETWORK_ACCESS_REVOKED', 'http://127.0.0.1/leak', true);
    beta.emit('did-navigate', {}, 'getssh-plugin://beta/other.html');
    expect(host.contentsFor('alpha')).toBeUndefined();
    expect(host.contentsFor('beta')).toBeUndefined();
    expect(host.contentsFor('gamma')).toBe(gamma);
    expect(gone()).toEqual(['alpha', 'beta']);
    // Not again until it changes.
    await host.sync([page('alpha'), page('beta'), page('gamma')]);
    expect(host.contentsFor('alpha')).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    host.destroyAll();
  });

  it('logs the first 20 errors of a page for the plugin\'s author, and nothing else it prints', async () => {
    const host = newHost();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await host.sync([page('alpha')]);
    const alpha = viewOf(host, 'alpha');
    alpha.emit('console-message', { level: 'info', message: 'hello', sourceId: 'renderer.js', lineNumber: 1 });
    for (let i = 0; i < 30; i++) alpha.emit('console-message', { level: 'error', message: `boom ${i} ${'x'.repeat(600)}`, sourceId: 'getssh-plugin://alpha/renderer.js', lineNumber: 7 });
    expect(warn).toHaveBeenCalledTimes(20);
    expect(warn.mock.calls[0][0]).toBe(`[PluginRenderer] alpha: ${`boom 0 ${'x'.repeat(600)}`.slice(0, 500)} (getssh-plugin://alpha/renderer.js:7)`);
    warn.mockRestore();
    host.destroyAll();
  });

  it('writes what a page logs on one line, with no control characters to fake entries of its own', async () => {
    const host = newHost();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await host.sync([page('alpha')]);
    viewOf(host, 'alpha').emit('console-message', {
      level: 'error',
      message: 'boom\n[PluginRenderer] renderer.js of plugin \'beta\' stopped\r\n\u001b[31mred\u2028x\u2029y\u202etxt\u0085z\u0000',
      sourceId: 'blob:x\nforged\u001b',
      lineNumber: '3\nforged',
    });
    expect(warn.mock.calls).toEqual([[
      `[PluginRenderer] alpha: boom [PluginRenderer] renderer.js of plugin 'beta' stopped   [31mred x y txt z  (blob:x forged :NaN)`,
    ]]);
    warn.mockRestore();
    host.destroyAll();
  });

  it('sends the theme and language to a page once it has loaded, and to running pages when they change', async () => {
    const host = newHost();
    await host.sync([page('alpha')]);
    const contents = viewOf(host, 'alpha');
    contents.emit('did-finish-load');
    expect(contents.sent).toEqual([]);
    // Only the main window sets them; values that are not a theme or a language tag are dropped.
    host.setEnv(fake.views[0].webContents as never, { theme: 'light', locale: 'en-US' });
    host.setEnv(fake.main as never, { theme: 'x'.repeat(40), locale: '"><script>' });
    expect(contents.sent).toEqual([]);
    host.setEnv(fake.main as never, { theme: 'dark', locale: 'zh-CN' });
    contents.emit('did-finish-load');
    expect(contents.sent).toEqual([
      [PLUGIN_RENDERER_EVENT_CHANNEL, { event: 'envChange', theme: 'dark', locale: 'zh-CN' }],
      [PLUGIN_RENDERER_EVENT_CHANNEL, { event: 'envChange', theme: 'dark', locale: 'zh-CN' }],
    ]);
    host.destroyAll();
  });
});

describe('calls from renderer.js', () => {
  it('takes the plugin from the WebContents, never from the message, and only from its main frame', async () => {
    const host = newHost();
    await host.sync([page('alpha'), page('beta')]);
    act(host, viewOf(host, 'alpha'), 'registerSidebarAction', { id: 'open', icon: '', label: 'Open', pluginId: 'beta' });
    act(host, new fake.FakeContents(), 'registerSidebarAction', { id: 'stranger', icon: '', label: 'x' });
    act(host, fake.main, 'registerSidebarAction', { id: 'main', icon: '', label: 'x' });
    act(host, viewOf(host, 'alpha'), 'registerSidebarAction', { id: 'subframe', icon: '', label: 'x' }, { parent: {} });
    expect(ui()).toEqual([{ pluginId: 'alpha', action: 'registerSidebarAction', payload: { id: 'open', icon: '', label: 'Open' } }]);
    host.destroyAll();
  });

  it('applies the main window\'s limits to sidebar actions and panels', async () => {
    const host = newHost();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await host.sync([page('alpha')]);
    const alpha = viewOf(host, 'alpha');
    for (let i = 0; i < 12; i++) act(host, alpha, 'registerSidebarAction', { id: `a${i}`, icon: '', label: 'A' });
    act(host, alpha, 'registerSidebarAction', { id: 'a1', icon: '', label: { toString: () => 'B' } });
    act(host, alpha, 'registerSidebarAction', { id: 'x'.repeat(100), icon: '', label: 'long id' });
    act(host, alpha, 'registerSidebarAction', { id: '', icon: '', label: 'no id' });
    act(host, alpha, 'registerSidebarAction', { id: 'a2', icon: 'x'.repeat(32 * 1024 + 1), label: 'big icon' });
    const actions = ui().map(call => (call as { payload: { id: string; label: string } }).payload);
    expect(actions.map(action => action.id)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a1']);
    expect(actions.at(-1)!.label).toBe('B');

    fake.toMain.length = 0;
    for (const renderUrl of ['getssh-plugin://beta/index.html', 'https://example.com/', `getssh-plugin://alpha/${'x'.repeat(2048)}`, 42]) {
      act(host, alpha, 'registerPanel', { panelId: 'alpha.main', title: 'T', renderUrl });
    }
    for (const panelId of ['', 42, 'x'.repeat(129)]) act(host, alpha, 'registerPanel', { panelId, title: 'T', renderUrl: 'getssh-plugin://alpha/index.html' });
    expect(ui()).toEqual([]);
    for (let i = 0; i < 20; i++) act(host, alpha, 'registerPanel', { panelId: `p${i}`, title: 'y'.repeat(200), renderUrl: 'getssh-plugin://ALPHA/index.html' });
    expect(ui()).toHaveLength(16);
    expect(ui()[0]).toEqual({ pluginId: 'alpha', action: 'registerPanel', payload: { panelId: 'p0', title: 'y'.repeat(128), renderUrl: 'getssh-plugin://ALPHA/index.html' } });
    warn.mockRestore();
    host.destroyAll();
  });

  it('opens a panel at most once a second, and lets 3 notifications through in 30 seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000_000);
    const host = newHost();
    await host.sync([page('alpha')]);
    const alpha = viewOf(host, 'alpha');
    for (let i = 0; i < 5; i++) act(host, alpha, 'openPanel', { panelId: `p${i}` });
    act(host, alpha, 'openPanel', { panelId: 42 });
    expect(ui()).toEqual([{ pluginId: 'alpha', action: 'openPanel', payload: { panelId: 'p0' } }]);
    fake.toMain.length = 0;
    for (let i = 0; i < 5; i++) act(host, alpha, 'showNotification', { title: `${i}`.repeat(300), body: i === 0 ? 'b'.repeat(5000) : 42 });
    expect(ui().map(call => (call as { payload: { title: string; body: string } }).payload)).toEqual([
      { title: '0'.repeat(256), body: 'b'.repeat(4096) },
      { title: '1'.repeat(256), body: '' },
      { title: '2'.repeat(256), body: '' },
    ]);
    vi.setSystemTime(10_030_001);
    act(host, alpha, 'showNotification', { title: 'later', body: '' });
    expect(ui()).toHaveLength(4);
    vi.useRealTimers();
    host.destroyAll();
  });

  it('drops calls it does not know, payloads that are not objects, oversized ones and floods', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000_000);
    const host = newHost();
    await host.sync([page('alpha')]);
    const alpha = viewOf(host, 'alpha');
    act(host, alpha, 'sshWrite', { data: 'rm -rf /' });
    act(host, alpha, 'getActiveSessionId', { requestId: 1 });
    act(host, alpha, 'registerSidebarAction', 'open');
    act(host, alpha, 'registerSidebarAction', null);
    act(host, alpha, 'registerSidebarAction', { id: 'huge', icon: '', label: 'x'.repeat(70 * 1024) });
    const circular: Record<string, unknown> = { id: 'loop' };
    circular.self = circular;
    act(host, alpha, 'registerSidebarAction', circular);
    expect(ui()).toEqual([]);
    for (let i = 0; i < 150; i++) act(host, alpha, 'openPanel', { panelId: 'p' });
    vi.setSystemTime(20_000_999);
    act(host, alpha, 'registerSidebarAction', { id: 'late', icon: '', label: 'x' });
    expect(ui()).toHaveLength(1);
    vi.setSystemTime(20_001_000);
    act(host, alpha, 'registerSidebarAction', { id: 'next second', icon: '', label: 'x' });
    expect(ui()).toHaveLength(2);
    vi.useRealTimers();
    host.destroyAll();
  });

  it('keeps what each page registered for a main window that loads later', async () => {
    const host = newHost();
    await host.sync([page('alpha')]);
    const alpha = viewOf(host, 'alpha');
    act(host, alpha, 'registerSidebarAction', { id: 'open', icon: '<svg/>', label: 'Open' });
    act(host, alpha, 'registerPanel', { panelId: 'alpha.main', title: 'Alpha', renderUrl: 'getssh-plugin://alpha/index.html' });
    expect(host.state()).toEqual([
      { pluginId: 'alpha', action: 'registerSidebarAction', payload: { id: 'open', icon: '<svg/>', label: 'Open' } },
      { pluginId: 'alpha', action: 'registerPanel', payload: { panelId: 'alpha.main', title: 'Alpha', renderUrl: 'getssh-plugin://alpha/index.html' } },
    ]);
    host.destroyAll();
    expect(host.state()).toEqual([]);
  });
});

describe('the main window', () => {
  it('sends a sidebar click to the page that registered the action, and only from the main window', async () => {
    const host = newHost();
    await host.sync([page('alpha'), page('beta')]);
    act(host, viewOf(host, 'alpha'), 'registerSidebarAction', { id: 'open', icon: '', label: 'Open' });
    host.sidebarClick(viewOf(host, 'beta') as never, 'alpha', 'open');
    host.sidebarClick(fake.main as never, 'alpha', 'never registered');
    host.sidebarClick(fake.main as never, 'beta', 'open');
    host.sidebarClick(fake.main as never, { toString: () => 'alpha' }, 'open');
    expect(viewOf(host, 'alpha').sent).toEqual([]);
    expect(viewOf(host, 'beta').sent).toEqual([]);
    host.sidebarClick(fake.main as never, 'alpha', 'open');
    expect(viewOf(host, 'alpha').sent).toEqual([[PLUGIN_RENDERER_EVENT_CHANNEL, { event: 'sidebarClick', actionId: 'open' }]]);
    host.destroyAll();
  });

  it('wires the channels, answers the state to the main window only, and undoes it all', async () => {
    const host = newHost();
    host.registerIpc();
    expect([...fake.ipc.on.keys()].sort()).toEqual([PLUGIN_RENDERER_ACTION_CHANNEL, PLUGIN_RENDERER_ENV_CHANNEL, PLUGIN_RENDERER_SIDEBAR_CLICK_CHANNEL].sort());
    await host.sync([page('alpha')]);
    const alpha = viewOf(host, 'alpha');
    fake.ipc.on.get(PLUGIN_RENDERER_ACTION_CHANNEL)![0]({ sender: alpha, senderFrame: { parent: null } }, 'registerSidebarAction', { id: 'open', icon: '', label: 'Open' });
    const state = fake.ipc.handle.get(PLUGIN_RENDERER_STATE_CHANNEL)!;
    expect(state({ sender: fake.main })).toHaveLength(1);
    expect(state({ sender: alpha })).toEqual([]);
    fake.ipc.on.get(PLUGIN_RENDERER_ENV_CHANNEL)![0]({ sender: fake.main }, { theme: 'dark', locale: 'zh-CN' });
    fake.ipc.on.get(PLUGIN_RENDERER_SIDEBAR_CLICK_CHANNEL)![0]({ sender: fake.main }, 'alpha', 'open');
    expect(alpha.sent.map(([, event]) => (event as { event: string }).event)).toEqual(['envChange', 'sidebarClick']);
    host.dispose();
    expect([...fake.ipc.on.values()].flat()).toEqual([]);
    expect(fake.ipc.handle.size).toBe(0);
    expect(alpha.isDestroyed()).toBe(true);
  });
});
