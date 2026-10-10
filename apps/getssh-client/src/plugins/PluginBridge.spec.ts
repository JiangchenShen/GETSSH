// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// A plugin page can register at most 16 panels and 8 sidebar actions, and open a panel at most
// once a second.

const store = vi.hoisted(() => ({ registerPluginPanel: vi.fn((..._args: unknown[]) => true), openPluginPanel: vi.fn(), registerSidebarAction: vi.fn() }));
vi.mock('../store/sessionStore', () => ({ useSessionStore: { getState: () => store } }));
vi.mock('../store/pluginStore', () => ({ usePluginStore: { getState: () => ({ registerSidebarAction: store.registerSidebarAction }) } }));
vi.mock('../store/appStore', () => ({ useAppStore: { subscribe: () => () => {} } }));

import { initPluginBridge } from './PluginBridge';

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
