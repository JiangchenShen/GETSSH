// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// A plugin can register at most 16 panels and 8 sidebar actions, open a panel at most once a
// second, and show at most 3 notifications in 30 seconds, from its pages and its renderer.js
// together. renderer.js runs in a WebContents of the main process, whose checked calls come in
// through window.electronAPI.onPluginRendererUi.

type Listener = (state: unknown, prevState: unknown) => void;
const store = vi.hoisted(() => ({
  registerPluginPanel: vi.fn((..._args: unknown[]) => true),
  openPluginPanel: vi.fn(),
  registerSidebarAction: vi.fn(),
  removePluginSidebarActions: vi.fn(),
  appListeners: [] as Array<(state: unknown, prevState: unknown) => void>,
  appConfig: { theme: 'dark', language: 'zh-CN' },
}));
// The main process side of renderer.js (preload methods of the main window).
const host = vi.hoisted(() => ({
  ui: null as null | ((call: unknown) => void),
  gone: null as null | ((pluginId: string) => void),
  state: [] as unknown[],
  env: vi.fn(),
  click: vi.fn(),
}));
vi.mock('../store/sessionStore', () => ({ useSessionStore: { getState: () => store } }));
vi.mock('../store/pluginStore', () => ({ usePluginStore: {
  getState: () => ({ registerSidebarAction: store.registerSidebarAction, removePluginSidebarActions: store.removePluginSidebarActions }),
} }));
vi.mock('../store/appStore', () => ({ useAppStore: {
  subscribe: (listener: Listener) => {
    store.appListeners.push(listener);
    return () => { store.appListeners.splice(store.appListeners.indexOf(listener), 1); };
  },
  getState: () => ({ appConfig: store.appConfig }),
} }));

import { initPluginBridge } from './PluginBridge';

let stop: () => void;
let frame: HTMLIFrameElement;
// What initPluginBridge replayed and sent at start, before the tests below clear the mocks.
const atStart = { actions: [] as string[], panels: [] as unknown[][], env: [] as unknown[][] };
beforeAll(async () => {
  (window as any).electronAPI = {
    onPluginRendererUi: (callback: (call: unknown) => void) => { host.ui = callback; return () => { host.ui = null; }; },
    onPluginRendererGone: (callback: (pluginId: string) => void) => { host.gone = callback; return () => { host.gone = null; }; },
    getPluginRendererState: async () => host.state,
    setPluginRendererEnv: host.env,
    pluginRendererSidebarClick: host.click,
  };
  // What renderer.js registered before this window loaded.
  host.state = [
    { pluginId: 'early', action: 'registerSidebarAction', payload: { id: 'boot', icon: '', label: 'Boot' } },
    { pluginId: 'early', action: 'registerPanel', payload: { panelId: 'early.main', title: 'Early', renderUrl: 'getssh-plugin://early/index.html' } },
  ];
  stop = initPluginBridge();
  await vi.waitFor(() => expect(store.registerPluginPanel).toHaveBeenCalled());
  atStart.actions = store.registerSidebarAction.mock.calls.map(call => (call[0] as { id: string }).id);
  atStart.panels = store.registerPluginPanel.mock.calls;
  atStart.env = host.env.mock.calls;
  store.registerSidebarAction.mockClear();
  store.registerPluginPanel.mockClear();
  frame = document.createElement('iframe');
  frame.setAttribute('data-plugin-id', 'busy');
  document.body.appendChild(frame);
});
afterAll(() => stop());

const send = (action: string, payload: unknown) =>
  window.dispatchEvent(new MessageEvent('message', { data: { __getssh_plugin: true, pluginId: 'busy', action, payload }, source: frame.contentWindow }));

describe('plugin panels', () => {
  it('registers at most 16 panels per plugin', () => {
    for (let i = 0; i < 40; i++) send('registerPanel', { panelId: `p${i}`, title: 'P', renderUrl: 'getssh-plugin://busy/p.html' });
    expect(store.registerPluginPanel).toHaveBeenCalledTimes(16);
    send('registerPanel', { panelId: 'p3', title: 'P again', renderUrl: 'getssh-plugin://busy/p.html' });
    expect(store.registerPluginPanel).toHaveBeenCalledTimes(17);
  });

  it('does not count a panel id the store refused (another plugin owns it)', () => {
    store.registerPluginPanel.mockClear();
    frame.setAttribute('data-plugin-id', 'other');
    const sendAs = (panelId: string) => window.dispatchEvent(new MessageEvent('message', { data: { __getssh_plugin: true, pluginId: 'other', action: 'registerPanel', payload: { panelId, title: 'X', renderUrl: 'getssh-plugin://other/x.html' } }, source: frame.contentWindow }));
    store.registerPluginPanel.mockReturnValue(false);
    for (let i = 0; i < 20; i++) sendAs(`taken-${i}`);
    store.registerPluginPanel.mockReturnValue(true);
    for (let i = 0; i < 16; i++) sendAs(`own-${i}`);
    expect(store.registerPluginPanel).toHaveBeenCalledTimes(36);
    frame.setAttribute('data-plugin-id', 'busy');
  });

  it('opens a panel at most once a second', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    for (let i = 0; i < 10; i++) send('openPanel', { panelId: `p${i}` });
    expect(store.openPluginPanel).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_001_000);
    send('openPanel', { panelId: 'p1' });
    expect(store.openPluginPanel).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('plugin sidebar actions', () => {
  it('registers at most 8 per plugin, refuses huge icons, and allows re-registering an id', () => {
    for (let i = 0; i < 20; i++) send('registerSidebarAction', { id: `a${i}`, icon: '<svg></svg>', label: 'A' });
    expect(store.registerSidebarAction).toHaveBeenCalledTimes(8);
    send('registerSidebarAction', { id: 'a2', icon: '<svg></svg>', label: 'A again' });
    expect(store.registerSidebarAction).toHaveBeenCalledTimes(9);
    send('registerSidebarAction', { id: 'a3', icon: `<svg>${'x'.repeat(40 * 1024)}</svg>`, label: 'big' });
    expect(store.registerSidebarAction).toHaveBeenCalledTimes(9);
  });
});

describe('plugin notifications', () => {
  const shown: Array<{ title: string; body?: string }> = [];
  let permission = 'granted';
  beforeAll(() => {
    vi.stubGlobal('Notification', class {
      static get permission() { return permission; }
      constructor(title: string, options?: { body?: string }) { shown.push({ title, body: options?.body }); }
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    shown.length = 0;
    permission = 'granted';
  });
  afterAll(() => vi.unstubAllGlobals());

  it('shows at most 3 in 30 seconds per plugin, with the plugin\'s name first in the title', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    for (let i = 0; i < 5; i++) send('showNotification', { title: `T${i}`, body: 'B' });
    expect(shown.map(n => n.title)).toEqual(['[busy] T0', '[busy] T1', '[busy] T2']);
    // Another plugin has its own allowance; the id the message names does not matter.
    frame.setAttribute('data-plugin-id', 'quiet');
    send('showNotification', { title: 'Q', body: 'B' });
    frame.setAttribute('data-plugin-id', 'busy');
    expect(shown.at(-1)?.title).toBe('[quiet] Q');
    vi.setSystemTime(2_029_999);
    send('showNotification', { title: 'still too soon', body: 'B' });
    expect(shown).toHaveLength(4);
    vi.setSystemTime(2_030_000);
    send('showNotification', { title: 'later', body: 'B' });
    expect(shown.at(-1)?.title).toBe('[busy] later');
  });

  it('cuts long text, ignores text that is not a string, and shows nothing without permission', () => {
    frame.setAttribute('data-plugin-id', 'wordy');
    send('showNotification', { title: 'T'.repeat(300), body: 'b'.repeat(5000) });
    expect(shown[0]).toEqual({ title: `[wordy] ${'T'.repeat(256)}`, body: 'b'.repeat(4096) });
    send('showNotification', { title: { toString: () => 'object' }, body: 42 });
    expect(shown[1]).toEqual({ title: '[wordy]', body: '' });
    permission = 'denied';
    send('showNotification', { title: 'T', body: 'B' });
    expect(shown).toHaveLength(2);
    frame.setAttribute('data-plugin-id', 'busy');
  });
});

describe('plugin identity', () => {
  it('takes the plugin from the sending frame, not from the id the message names', () => {
    store.registerSidebarAction.mockClear();
    frame.setAttribute('data-plugin-id', 'liar');
    for (let i = 0; i < 20; i++) {
      window.dispatchEvent(new MessageEvent('message', { data: { __getssh_plugin: true, pluginId: `s${i}"],iframe[data-plugin-id="liar`, action: 'registerSidebarAction', payload: { id: 'a', icon: '<svg></svg>', label: 'x' } }, source: frame.contentWindow }));
    }
    expect(store.registerSidebarAction).toHaveBeenCalledTimes(20);
    expect(new Set(store.registerSidebarAction.mock.calls.map(call => (call[0] as { id: string }).id))).toEqual(new Set(['plugin-liar-a']));
    window.dispatchEvent(new MessageEvent('message', { data: { __getssh_plugin: true, pluginId: 'liar', action: 'registerSidebarAction', payload: { id: 'b', icon: '', label: 'x' } }, source: window }));
    expect(store.registerSidebarAction).toHaveBeenCalledTimes(20);
    frame.setAttribute('data-plugin-id', 'busy');
  });
});

describe('plugin panel pages', () => {
  it('registers a panel only for one of the plugin\'s own getssh-plugin:// pages', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    frame.setAttribute('data-plugin-id', 'pages');
    store.registerPluginPanel.mockClear();
    const register = (panelId: unknown, renderUrl: unknown, title: unknown = 'T') => window.dispatchEvent(new MessageEvent('message', {
      data: { __getssh_plugin: true, action: 'registerPanel', payload: { panelId, title, renderUrl } }, source: frame.contentWindow,
    }));
    for (const url of ['getssh-plugin://other/index.html', 'getssh-plugin://pages.evil/index.html', 'https://example.com/', 'file:///etc/passwd',
      '/index.html', 'index.html', 'data:text/html,x', `getssh-plugin://pages/${'x'.repeat(2048)}`, 42, null]) {
      register('pages.main', url);
    }
    for (const panelId of ['', 42, null, 'x'.repeat(129)]) register(panelId, 'getssh-plugin://pages/index.html');
    expect(store.registerPluginPanel).not.toHaveBeenCalled();
    register('pages.main', 'getssh-plugin://PAGES/index.html', 42);
    register('pages.other', 'getssh-plugin://pages/other.html', 'y'.repeat(200));
    expect(store.registerPluginPanel.mock.calls).toEqual([
      ['pages', 'pages.main', '42', 'getssh-plugin://PAGES/index.html'],
      ['pages', 'pages.other', 'y'.repeat(128), 'getssh-plugin://pages/other.html'],
    ]);
    frame.setAttribute('data-plugin-id', 'busy');
    warn.mockRestore();
  });
});

describe('renderer.js, through the main process', () => {
  const fromRenderer = (pluginId: unknown, action: unknown, payload: unknown) => host.ui?.({ pluginId, action, payload });

  it('replays what renderer.js registered before the window loaded, and sends the theme and language', () => {
    expect(atStart.actions).toEqual(['plugin-early-boot']);
    expect(atStart.panels).toEqual([['early', 'early.main', 'Early', 'getssh-plugin://early/index.html']]);
    expect(atStart.env).toEqual([[{ theme: 'dark', locale: 'zh-CN' }]]);
    host.env.mockClear();
    const before = { appConfig: { ...store.appConfig } };
    store.appConfig = { theme: 'light', language: 'en-US' };
    store.appListeners.forEach(listener => listener({ appConfig: store.appConfig }, before));
    expect(host.env).toHaveBeenCalledExactlyOnceWith({ theme: 'light', locale: 'en-US' });
    store.appConfig = before.appConfig;
  });

  it('sends a click on an action of renderer.js to the main process, and one of a panel to its frame', () => {
    store.registerSidebarAction.mockClear();
    fromRenderer('delta', 'registerSidebarAction', { id: 'open', icon: '', label: 'Open' });
    const action = store.registerSidebarAction.mock.calls[0][0] as { id: string; pluginId: string; onClick: () => void };
    expect(action).toMatchObject({ id: 'plugin-delta-open', pluginId: 'delta', label: 'Open' });
    // An open panel of the same plugin gets no click meant for renderer.js.
    const panel = document.createElement('iframe');
    panel.setAttribute('data-plugin-id', 'delta');
    document.body.prepend(panel);
    const toPanel = vi.spyOn(panel.contentWindow!, 'postMessage');
    action.onClick();
    expect(host.click).toHaveBeenCalledExactlyOnceWith('delta', 'open');
    expect(toPanel).not.toHaveBeenCalled();
    // An action the panel registered goes to the panel.
    window.dispatchEvent(new MessageEvent('message', {
      data: { __getssh_plugin: true, action: 'registerSidebarAction', payload: { id: 'refresh', icon: '', label: 'Refresh' } }, source: panel.contentWindow,
    }));
    (store.registerSidebarAction.mock.calls[1][0] as { onClick: () => void }).onClick();
    expect(toPanel).toHaveBeenCalledExactlyOnceWith({ __getssh_host: true, event: 'sidebarClick', actionId: 'refresh' }, '*');
    expect(host.click).toHaveBeenCalledOnce();
    panel.remove();
  });

  it('counts the sidebar actions and panels of renderer.js and of the plugin\'s pages together', () => {
    store.registerSidebarAction.mockClear();
    store.registerPluginPanel.mockClear();
    frame.setAttribute('data-plugin-id', 'both');
    for (let i = 0; i < 5; i++) send('registerSidebarAction', { id: `page${i}`, icon: '', label: 'P' });
    for (let i = 0; i < 5; i++) fromRenderer('both', 'registerSidebarAction', { id: `renderer${i}`, icon: '', label: 'R' });
    expect(store.registerSidebarAction).toHaveBeenCalledTimes(8);
    for (let i = 0; i < 10; i++) send('registerPanel', { panelId: `both.page${i}`, title: 'P', renderUrl: 'getssh-plugin://both/p.html' });
    for (let i = 0; i < 10; i++) fromRenderer('both', 'registerPanel', { panelId: `both.renderer${i}`, title: 'R', renderUrl: 'getssh-plugin://both/r.html' });
    expect(store.registerPluginPanel).toHaveBeenCalledTimes(16);
    // renderer.js gets the same check of the panel page as a frame does.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.registerPluginPanel.mockClear();
    fromRenderer('fresh', 'registerPanel', { panelId: 'fresh.main', title: 'X', renderUrl: 'getssh-plugin://other/index.html' });
    expect(store.registerPluginPanel).not.toHaveBeenCalled();
    warn.mockRestore();
    frame.setAttribute('data-plugin-id', 'busy');
  });

  it('counts a plugin\'s notifications from renderer.js and its pages together', () => {
    const shown: string[] = [];
    vi.stubGlobal('Notification', class {
      static get permission() { return 'granted'; }
      constructor(title: string) { shown.push(title); }
    });
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    frame.setAttribute('data-plugin-id', 'noisy');
    send('showNotification', { title: 'page 1', body: '' });
    fromRenderer('noisy', 'showNotification', { title: 'renderer 1', body: '' });
    send('showNotification', { title: 'page 2', body: '' });
    fromRenderer('noisy', 'showNotification', { title: 'renderer 2', body: '' });
    send('showNotification', { title: 'page 3', body: '' });
    expect(shown).toEqual(['[noisy] page 1', '[noisy] renderer 1', '[noisy] page 2']);
    frame.setAttribute('data-plugin-id', 'busy');
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('drops what a plugin registered once its renderer.js stops, and its counts with it', () => {
    store.registerSidebarAction.mockClear();
    store.removePluginSidebarActions.mockClear();
    for (let i = 0; i < 8; i++) fromRenderer('stopped', 'registerSidebarAction', { id: `a${i}`, icon: '', label: 'A' });
    fromRenderer('stopped', 'registerSidebarAction', { id: 'over', icon: '', label: 'A' });
    expect(store.registerSidebarAction).toHaveBeenCalledTimes(8);
    host.gone?.('stopped');
    expect(store.removePluginSidebarActions).toHaveBeenCalledExactlyOnceWith('stopped');
    fromRenderer('stopped', 'registerSidebarAction', { id: 'again', icon: '', label: 'A' });
    expect(store.registerSidebarAction).toHaveBeenCalledTimes(9);
  });

  it('takes only the four calls the main process passes on, and nothing without a plugin or an action', () => {
    store.registerSidebarAction.mockClear();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    host.ui?.(null);
    host.ui?.({ action: 'registerSidebarAction', payload: { id: 'x', icon: '', label: 'x' } });
    fromRenderer(42, 'registerSidebarAction', { id: 'x', icon: '', label: 'x' });
    fromRenderer('odd', { toString: () => 'registerSidebarAction' }, { id: 'x', icon: '', label: 'x' });
    expect(warn).not.toHaveBeenCalled();
    // Plugin pages may ask for the active session; renderer.js has no frame to answer. The rest
    // is not for plugins at all. Either way the call stops before the page rules see it.
    for (const action of ['getActiveSessionId', 'sshWrite', 'invokeBackend', 'constructor']) fromRenderer('odd', action, { requestId: 1, data: 'rm -rf /' });
    expect(warn.mock.calls.map(([message]) => message)).toEqual(['getActiveSessionId', 'sshWrite', 'invokeBackend', 'constructor']
      .map(action => `[PluginBridge] Ignored "${action}" for plugin "odd": not a call the main process passes on from renderer.js`));
    expect(store.registerSidebarAction).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
