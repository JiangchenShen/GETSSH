// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// A plugin page can register at most 16 panels and 8 sidebar actions, and open a panel at most
// once a second. Each plugin's renderer.js runs in a hidden sandboxed frame of its own.

type Listener = (state: unknown, prevState: unknown) => void;
const store = vi.hoisted(() => ({
  registerPluginPanel: vi.fn((..._args: unknown[]) => true),
  openPluginPanel: vi.fn(),
  registerSidebarAction: vi.fn(),
  removePluginSidebarActions: vi.fn(),
  pluginListeners: [] as Array<(state: unknown, prevState: unknown) => void>,
  appConfig: { theme: 'dark', language: 'zh-CN' },
}));
vi.mock('../store/sessionStore', () => ({ useSessionStore: { getState: () => store } }));
vi.mock('../store/pluginStore', () => ({ usePluginStore: {
  getState: () => ({ registerSidebarAction: store.registerSidebarAction, removePluginSidebarActions: store.removePluginSidebarActions }),
  subscribe: (listener: Listener) => {
    store.pluginListeners.push(listener);
    return () => { store.pluginListeners.splice(store.pluginListeners.indexOf(listener), 1); };
  },
} }));
vi.mock('../store/appStore', () => ({ useAppStore: { subscribe: () => () => {}, getState: () => ({ appConfig: store.appConfig }) } }));

import { bootSandboxedPlugins, initPluginBridge } from './PluginBridge';

let stop: () => void;
let frame: HTMLIFrameElement;
beforeAll(() => {
  (window as any).electronAPI = {};
  stop = initPluginBridge();
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

describe('renderer.js frames', () => {
  const rendererFrames = () => [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-plugin-renderer]')];
  const pages = (...ids: string[]) => ids.map(id => ({ pluginId: id, url: `getssh-plugin://${id}/?renderer=renderer.js` }));
  const installed = (...ids: string[]) => {
    const list = vi.fn(async () => pages(...ids));
    (window as any).electronAPI.getPluginRenderers = list;
    return list;
  };

  afterEach(async () => {
    installed();
    await bootSandboxedPlugins();
    store.removePluginSidebarActions.mockClear();
  });

  it('starts each plugin in a hidden, sandboxed frame on its own getssh-plugin:// page', async () => {
    installed('alpha', 'beta');
    await bootSandboxedPlugins();
    expect(rendererFrames().map(iframe => ({
      id: iframe.getAttribute('data-plugin-id'), sandbox: iframe.getAttribute('sandbox'), src: iframe.getAttribute('src'), display: iframe.style.display,
    }))).toEqual([
      { id: 'alpha', sandbox: 'allow-scripts', src: 'getssh-plugin://alpha/?renderer=renderer.js&locale=zh-CN', display: 'none' },
      { id: 'beta', sandbox: 'allow-scripts', src: 'getssh-plugin://beta/?renderer=renderer.js&locale=zh-CN', display: 'none' },
    ]);
  });

  it('does not let a plugin that cannot start stop the others', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    (window as any).electronAPI.getPluginRenderers = vi.fn(async () => [{ pluginId: 'broken', url: 'not a url' }, ...pages('gamma')]);
    await bootSandboxedPlugins();
    expect(rendererFrames().map(iframe => iframe.getAttribute('data-plugin-id'))).toEqual(['gamma']);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('starts a plugin once however often it is asked, and stops plugins no longer installed', async () => {
    installed('alpha', 'beta');
    await Promise.all([bootSandboxedPlugins(), bootSandboxedPlugins(), bootSandboxedPlugins()]);
    expect(rendererFrames()).toHaveLength(2);
    const beta = rendererFrames()[1];
    installed('beta', 'gamma');
    await bootSandboxedPlugins();
    expect(rendererFrames().map(iframe => iframe.getAttribute('data-plugin-id'))).toEqual(['beta', 'gamma']);
    expect(rendererFrames()[0]).toBe(beta);
    expect(store.removePluginSidebarActions).toHaveBeenCalledExactlyOnceWith('alpha');
  });

  it('applies plugin lists in the order they were asked for', async () => {
    let answerFirst!: (value: unknown) => void;
    (window as any).electronAPI.getPluginRenderers = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { answerFirst = resolve; }))
      .mockImplementationOnce(async () => []);
    const first = bootSandboxedPlugins();
    const second = bootSandboxedPlugins();
    await Promise.resolve();
    answerFirst(pages('alpha'));
    await Promise.all([first, second]);
    expect(rendererFrames()).toHaveLength(0);
  });

  it('reports a plugin list that could not be read, and takes the next one', async () => {
    (window as any).electronAPI.getPluginRenderers = vi.fn()
      .mockRejectedValueOnce(new Error('no list'))
      .mockResolvedValueOnce(pages('alpha'));
    await expect(bootSandboxedPlugins()).rejects.toThrow('no list');
    await bootSandboxedPlugins();
    expect(rendererFrames().map(iframe => iframe.getAttribute('data-plugin-id'))).toEqual(['alpha']);
  });

  it('follows installs and uninstalls through the plugin list', async () => {
    const list = installed('alpha');
    const plugins = [{ name: 'alpha' }];
    store.pluginListeners.forEach(listener => listener({ installedPlugins: plugins }, { installedPlugins: plugins }));
    await bootSandboxedPlugins();
    expect(list).toHaveBeenCalledOnce();
    store.pluginListeners.forEach(listener => listener({ installedPlugins: [...plugins] }, { installedPlugins: plugins }));
    await vi.waitFor(() => expect(rendererFrames().map(iframe => iframe.getAttribute('data-plugin-id'))).toEqual(['alpha']));
    installed();
    store.pluginListeners.forEach(listener => listener({ installedPlugins: [] }, { installedPlugins: plugins }));
    await vi.waitFor(() => expect(rendererFrames()).toHaveLength(0));
    expect(store.removePluginSidebarActions).toHaveBeenCalledExactlyOnceWith('alpha');
  });

  it('tells a page the theme and language once it has loaded', async () => {
    installed('alpha');
    await bootSandboxedPlugins();
    const [alpha] = rendererFrames();
    const post = vi.spyOn(alpha.contentWindow!, 'postMessage');
    alpha.dispatchEvent(new Event('load'));
    expect(post).toHaveBeenCalledWith({ __getssh_host: true, event: 'envChange', theme: 'dark', locale: 'zh-CN' }, '*');
  });

  it('sends a sidebar click to the page that registered the action', async () => {
    installed('delta');
    await bootSandboxedPlugins();
    const [renderer] = rendererFrames();
    // An open panel of the same plugin, earlier in the document than the hidden frame.
    const panel = document.createElement('iframe');
    panel.setAttribute('data-plugin-id', 'delta');
    document.body.prepend(panel);
    store.registerSidebarAction.mockClear();
    window.dispatchEvent(new MessageEvent('message', {
      data: { __getssh_plugin: true, action: 'registerSidebarAction', payload: { id: 'open', icon: '', label: 'Open' } }, source: renderer.contentWindow,
    }));
    const action = store.registerSidebarAction.mock.calls[0][0] as { id: string; pluginId: string; onClick: () => void };
    expect(action).toMatchObject({ id: 'plugin-delta-open', pluginId: 'delta' });
    const toRenderer = vi.spyOn(renderer.contentWindow!, 'postMessage');
    const toPanel = vi.spyOn(panel.contentWindow!, 'postMessage');
    action.onClick();
    expect(toRenderer).toHaveBeenCalledExactlyOnceWith({ __getssh_host: true, event: 'sidebarClick', actionId: 'open' }, '*');
    expect(toPanel).not.toHaveBeenCalled();
    // An action the panel registered goes to the panel.
    window.dispatchEvent(new MessageEvent('message', {
      data: { __getssh_plugin: true, action: 'registerSidebarAction', payload: { id: 'refresh', icon: '', label: 'Refresh' } }, source: panel.contentWindow,
    }));
    toRenderer.mockClear();
    (store.registerSidebarAction.mock.calls[1][0] as { onClick: () => void }).onClick();
    expect(toPanel).toHaveBeenCalledExactlyOnceWith({ __getssh_host: true, event: 'sidebarClick', actionId: 'refresh' }, '*');
    expect(toRenderer).not.toHaveBeenCalled();
    panel.remove();
  });
});
