import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plugins with host:clipboard read the clipboard through clipboardTextForPlugin, which hides a
// password just copied from the reveal window. Both plugin kinds' host API goes through it (a
// developer-mode plugin runs in the main process and could read the clipboard directly).

const mocks = vi.hoisted(() => ({
  clipboardTextForPlugin: vi.fn(async () => 'clipboard text'),
  readText: vi.fn(async () => 'read directly'),
  notifications: [] as unknown[],
  bridge: null as any,
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/nonexistent' },
  ipcMain: {},
  Notification: class {
    constructor(options: unknown) { mocks.notifications.push(options); }
    show() {}
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  clipboard: { readText: mocks.readText, writeText: vi.fn() },
}));
vi.mock('./handlers/storeHandler', () => ({ clipboardTextForPlugin: mocks.clipboardTextForPlugin }));
vi.mock('./handlers/systemHandler', () => ({ getBackendConfig: () => ({}) }));
vi.mock('./handlers/workspaceHandler', () => ({ getActiveWorkspaceId: () => 'default' }));
vi.mock('./services/plugin/pluginSecrets', () => ({}));
vi.mock('./services/SSHBridge', () => {
  const { EventEmitter } = require('node:events');
  mocks.bridge = new EventEmitter();
  return { sshBridge: mocks.bridge };
});
vi.mock('./services/PluginStorageManager', () => ({ pluginStorageManager: {} }));
vi.mock('./security/SecureCenter', () => ({ SecureCenter: { getInstance: () => ({}) } }));
vi.mock('./windowRegistry', () => ({ broadcastToAllWindows: vi.fn(), isKnownTopLevelSender: () => false }));
vi.mock('./utils/rustCorePath', () => ({ getRustCorePath: () => '' }));
vi.mock('./services/plugin/PluginProcessHost', () => ({ PluginProcessHost: class {} }));
vi.mock('./services/plugin/PluginNetworkGateway', () => ({ fetchForPlugin: vi.fn(), isPrivateNetworkAddress: () => false }));

import { PluginManager } from './PluginManager';

const manifest = { name: 'clip', getssh: { capabilities: ['host:clipboard'] } };
const host = {};

function isolated(manager: PluginManager) {
  const internals = manager as unknown as {
    runningPlugins: Map<string, unknown>;
    dispatchPluginHostCall: (id: string, m: unknown, h: unknown, method: string, args: unknown[]) => Promise<unknown>;
  };
  internals.runningPlugins.set('clip', { host });
  const call = (method: string, args: unknown[] = []) => internals.dispatchPluginHostCall('clip', manifest, host, method, args);
  return { read: () => call('host.clipboard.readText'), write: (text: string) => call('host.clipboard.writeText', [text]) };
}

function developer(manager: PluginManager) {
  const context = (manager as unknown as { createMainContext: (m: unknown) => any }).createMainContext(manifest);
  return { read: () => context.host.clipboard.readText() as Promise<string>, write: (text: string) => context.host.clipboard.writeText(text) };
}

beforeEach(() => {
  mocks.notifications.length = 0;
  mocks.clipboardTextForPlugin.mockReset();
  mocks.clipboardTextForPlugin.mockResolvedValue('clipboard text');
});

describe('plugin clipboard reads', () => {
  for (const [kind, api] of [['isolated', isolated], ['developer', developer]] as const) {
    it(`gives ${kind} plugins the clipboard through the copied-secret check`, async () => {
      expect(await api(new PluginManager()).read()).toBe('clipboard text');
      expect(mocks.clipboardTextForPlugin).toHaveBeenCalledExactlyOnceWith(undefined);
      expect(mocks.readText).not.toHaveBeenCalled();
      expect(mocks.notifications).toHaveLength(1);
    });

    it(`tells the check what a ${kind} plugin wrote itself`, async () => {
      const plugin = api(new PluginManager());
      await plugin.write('my own text');
      await plugin.read();
      expect(mocks.clipboardTextForPlugin).toHaveBeenLastCalledWith('my own text');
    });
  }
});

describe('plugin SSH subscriptions', () => {
  const sshManifest = { name: 'reader', getssh: { capabilities: ['ssh:read'] } };

  function subscribe(manager: PluginManager, host: unknown, id: string) {
    const internals = manager as unknown as {
      runningPlugins: Map<string, unknown>;
      dispatchPluginHostCall: (id: string, m: unknown, h: unknown, method: string, args: unknown[]) => Promise<unknown>;
    };
    if (!internals.runningPlugins.has('reader')) internals.runningPlugins.set('reader', { host });
    return internals.dispatchPluginHostCall('reader', sshManifest, host, 'ssh.subscribe', [id, 'session-1']);
  }

  it('caps the subscriptions of one plugin', async () => {
    const manager = new PluginManager();
    const host = { sendSshData: vi.fn() };
    for (let i = 0; i < 64; i++) await subscribe(manager, host, `ssh-${i}`);
    await expect(subscribe(manager, host, 'ssh-64')).rejects.toThrow(/at most 64/);
    mocks.bridge.emit('data:session-1', 'x');
    expect(host.sendSshData).toHaveBeenCalledTimes(64);
    mocks.bridge.removeAllListeners();
  });

  it('keeps a failing plugin process from throwing into the session', async () => {
    const manager = new PluginManager();
    const host = { sendSshData: vi.fn(() => { throw new Error('plugin process is gone'); }) };
    await subscribe(manager, host, 'ssh-0');
    expect(() => mocks.bridge.emit('data:session-1', 'output')).not.toThrow();
    mocks.bridge.removeAllListeners();
  });
});
