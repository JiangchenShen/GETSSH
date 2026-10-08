import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plugins with host:clipboard read the clipboard through clipboardTextForPlugin, which refuses a
// password copied from the reveal window in this run. Both plugin kinds go through it.

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
  safeStorage: {},
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  clipboard: { readText: mocks.readText, writeText: vi.fn() },
}));
vi.mock('./handlers/storeHandler', () => ({ clipboardTextForPlugin: mocks.clipboardTextForPlugin }));
vi.mock('./handlers/systemHandler', () => ({ getBackendConfig: () => ({}) }));
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

function isolatedRead(manager: PluginManager) {
  const internals = manager as unknown as {
    runningPlugins: Map<string, unknown>;
    dispatchPluginHostCall: (id: string, m: unknown, h: unknown, method: string, args: unknown[]) => Promise<unknown>;
  };
  internals.runningPlugins.set('clip', { host });
  return internals.dispatchPluginHostCall('clip', manifest, host, 'host.clipboard.readText', []);
}

function developerRead(manager: PluginManager) {
  const context = (manager as unknown as { createMainContext: (m: unknown) => any }).createMainContext(manifest);
  return context.host.clipboard.readText() as Promise<string>;
}

beforeEach(() => {
  mocks.notifications.length = 0;
  mocks.clipboardTextForPlugin.mockReset();
  mocks.clipboardTextForPlugin.mockResolvedValue('clipboard text');
});

describe('plugin clipboard reads', () => {
  for (const [kind, read] of [['isolated', isolatedRead], ['developer', developerRead]] as const) {
    it(`gives ${kind} plugins the clipboard through the copied-secret check`, async () => {
      expect(await read(new PluginManager())).toBe('clipboard text');
      expect(mocks.clipboardTextForPlugin).toHaveBeenCalledTimes(1);
      expect(mocks.readText).not.toHaveBeenCalled();
      expect(mocks.notifications).toHaveLength(1);
    });

    it(`refuses ${kind} plugins a freshly copied secret and does not say they read it`, async () => {
      mocks.clipboardTextForPlugin.mockRejectedValue(new Error('The clipboard holds a password copied from GETSSH.'));
      await expect(read(new PluginManager())).rejects.toThrow('password copied from GETSSH');
      expect(mocks.notifications).toHaveLength(0);
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
