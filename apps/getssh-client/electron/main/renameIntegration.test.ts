import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  api: null as any,
  authorized: true,
}));

vi.mock('electron', () => ({
  app: {},
  ipcMain: {
    handle(channel: string, handler: (...args: any[]) => unknown) {
      if (transport.handlers.has(channel)) throw new Error(`Duplicate handler: ${channel}`);
      transport.handlers.set(channel, handler);
    },
  },
  ipcRenderer: {
    invoke(channel: string, ...args: unknown[]) {
      const handler = transport.handlers.get(channel);
      if (!handler) throw new Error(`No handler registered for '${channel}'`);
      return Promise.resolve(handler({}, ...args));
    },
  },
  contextBridge: {
    exposeInMainWorld(_name: string, api: unknown) { transport.api = api; },
  },
  webUtils: {},
}));

vi.mock('./windowRegistry', () => ({
  broadcastToAllWindows: vi.fn(),
  isKnownTopLevelSender: () => transport.authorized,
}));
vi.mock('./utils/rustCorePath', () => ({ getRustCorePath: () => '/nonexistent/getssh-rename-test-native' }));
vi.mock('./handlers/systemHandler', () => ({ getBackendConfig: () => ({ pluginSecurityMode: 'safe' }) }));

describe('renamed renderer/main IPC integration', () => {
  beforeEach(() => {
    vi.resetModules();
    transport.handlers.clear();
    transport.api = null;
    transport.authorized = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  async function registerRuntime() {
    const { tidalBridge } = await import('./tidal/tidalBridge');
    const { SecureCenter } = await import('./security/SecureCenter');
    const center = SecureCenter.getInstance();
    // Exercise real IPC registration without starting a supervisor or touching daily app data.
    vi.spyOn(center as any, 'initSentinelWatchdog').mockImplementation(() => {});
    tidalBridge.setupIpcHandlers();
    center.start();
    await import('../preload');
    return tidalBridge;
  }

  it('routes the reported split, close-tab and security-status calls to main handlers', async () => {
    const bridge = await registerRuntime();
    const split = vi.spyOn(bridge, 'split').mockResolvedValue({ success: true, newPaneId: 'pane-2' });
    const close = vi.spyOn(bridge, 'closeTab').mockResolvedValue({ success: true });

    await expect(transport.api.tidalSplit('pane-1', 'horizontal')).resolves.toEqual({ success: true, newPaneId: 'pane-2' });
    await expect(transport.api.tidalCloseTab('tab-1')).resolves.toEqual({ success: true });
    await expect(transport.api.getSentinelStatus()).resolves.toMatchObject({ status: 'warning', daemonState: 'starting', sentinelDisabled: false });
    expect(split).toHaveBeenCalledWith('pane-1', 'horizontal');
    expect(close).toHaveBeenCalledWith('tab-1');
    // Startup may attempt registration again; it must not replace or duplicate the new channels.
    expect(() => bridge.setupIpcHandlers()).not.toThrow();
  });

  it('retains sender and payload checks on the renamed pane operations', async () => {
    const bridge = await registerRuntime();
    const split = vi.spyOn(bridge, 'split');
    const close = vi.spyOn(bridge, 'closeTab');

    transport.authorized = false;
    await expect(transport.api.tidalSplit('pane-1', 'horizontal')).resolves.toEqual({ success: false, error: 'unauthorized' });
    await expect(transport.api.tidalCloseTab('tab-1')).resolves.toEqual({ success: false, error: 'unauthorized' });
    transport.authorized = true;
    await expect(transport.api.tidalSplit('', 'horizontal')).resolves.toEqual({ success: false, error: 'invalid_arguments' });
    await expect(transport.api.tidalSplit('pane-1', 'diagonal')).resolves.toEqual({ success: false, error: 'invalid_arguments' });
    await expect(transport.api.tidalCloseTab('')).resolves.toEqual({ success: false, error: 'invalid_arguments' });
    expect(split).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
