import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Plugin secrets (context.secrets) and password settings in getssh-store, for both kinds of
// plugin and the settings form, on rust-core/getssh-store/store.fake.js with a temporary home.
// The plugin storage file is an in-memory stand-in that follows the active workspace.

const mocks = vi.hoisted(() => ({
  home: '',
  phase: 'ready' as 'ready' | 'locked',
  workspace: 'default',
  kv: new Map<string, Map<string, unknown>>(),
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getVersion: () => '3.0.0-test',
    getPath: () => mocks.home,
  },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { mocks.handlers.set(channel, handler); },
    on: () => {},
  },
  Notification: class { show() {} },
  safeStorage: {},
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  clipboard: {},
}));
vi.mock('./security/appLock', () => ({ appLock: { isReady: () => mocks.phase === 'ready' } }));
vi.mock('./handlers/workspaceHandler', () => ({ getActiveWorkspaceId: () => mocks.workspace }));
vi.mock('./handlers/storeHandler', () => ({ clipboardTextForPlugin: vi.fn() }));
vi.mock('./handlers/systemHandler', () => ({ getBackendConfig: () => ({}) }));
vi.mock('./services/SSHBridge', () => ({ sshBridge: {} }));
vi.mock('./services/PluginStorageManager', () => {
  const file = (pluginId: string) => {
    const name = `${mocks.workspace}/${pluginId}`;
    if (!mocks.kv.has(name)) mocks.kv.set(name, new Map());
    return mocks.kv.get(name)!;
  };
  return {
    pluginStorageManager: {
      get: async (pluginId: string, key: string) => file(pluginId).get(key),
      set: async (pluginId: string, key: string, value: unknown) => { file(pluginId).set(key, value); },
      delete: async (pluginId: string, key: string) => { file(pluginId).delete(key); },
      clear: async (pluginId: string) => { file(pluginId).clear(); },
    },
  };
});
vi.mock('./security/SecureCenter', () => ({ MAX_AUDITED_COMMAND: 65536, SecureCenter: { getInstance: () => ({}) } }));
vi.mock('./windowRegistry', () => ({
  broadcastToAllWindows: vi.fn(),
  getMainWindow: () => null,
  isKnownTopLevelSender: (event: { trusted?: boolean }) => event.trusted === true,
}));
vi.mock('./services/plugin/PluginProcessHost', () => ({ PluginProcessHost: class {} }));
vi.mock('./services/plugin/PluginNetworkGateway', () => ({ fetchForPlugin: vi.fn(), isPrivateNetworkAddress: () => false }));

import { PluginManager } from './PluginManager';
import { configureStore, getStore, resetStoreForTest } from './services/getsshStore';
import { MAX_PLUGIN_SECRET_BYTES, MAX_PLUGIN_SECRETS, removeWorkspacePluginSettings } from './services/plugin/pluginSecrets';

const fake = createRequire(import.meta.url)(path.resolve(process.cwd(), '../../rust-core/getssh-store/store.fake.js'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-plugin-secrets-'));
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, GETSSH_FAKE_STORE: process.env.GETSSH_FAKE_STORE };

const TOKEN = 'tok_example_123';
const SCHEMA = [
  { id: 'token', type: 'password', label: 'Token' },
  { id: 'endpoint', type: 'string', label: 'Endpoint' },
];
const manifest = { name: 'demo', getssh: { capabilities: [] } };
const host = {};
const trusted = { trusted: true };

type Internals = {
  runningPlugins: Map<string, unknown>;
  settingsSchemas: Map<string, unknown>;
  dispatchPluginHostCall: (id: string, m: unknown, h: unknown, method: string, args: unknown[]) => Promise<unknown>;
  createMainContext: (m: unknown) => any;
};

function setup(schema: unknown[] | null = SCHEMA) {
  const manager = new PluginManager();
  const internals = manager as unknown as Internals;
  internals.runningPlugins.set('demo', { host });
  if (schema) internals.settingsSchemas.set('demo', schema);
  manager.setupIPC();
  const call = (method: string, ...args: unknown[]) => internals.dispatchPluginHostCall('demo', manifest, host, method, args);
  const ipc = (channel: string, ...args: unknown[]) => mocks.handlers.get(channel)!(trusted, ...args);
  return { manager, internals, call, ipc, developer: () => internals.createMainContext(manifest) };
}

const kvFile = (workspace = mocks.workspace) => mocks.kv.get(`${workspace}/demo`) ?? new Map();
const stored = () => {
  const raw = getStore().getAppSecret('plugin/demo');
  return raw ? JSON.parse(raw.toString('utf8')) : null;
};

beforeEach(async () => {
  mocks.home = fs.mkdtempSync(path.join(root, 'home-'));
  process.env.HOME = mocks.home;
  process.env.USERPROFILE = mocks.home;
  process.env.GETSSH_FAKE_STORE = '1';
  mocks.phase = 'ready';
  mocks.workspace = 'default';
  mocks.kv.clear();
  mocks.handlers.clear();
  fake.__fake.reset();
  resetStoreForTest();
  await configureStore().start();
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

describe('context.secrets', () => {
  it('keeps an isolated plugin\'s secrets in the store and nowhere else', async () => {
    const { call } = setup();
    expect(await call('secrets.get', 'api')).toBeUndefined();
    await call('secrets.set', 'api', TOKEN);
    expect(await call('secrets.get', 'api')).toBe(TOKEN);
    expect(stored()).toEqual({ secrets: { api: TOKEN } });
    expect(kvFile().size).toBe(0);
    await call('secrets.delete', 'api');
    expect(await call('secrets.get', 'api')).toBeUndefined();
    expect(getStore().getAppSecret('plugin/demo')).toBeNull();
  });

  it('gives a developer-mode plugin the same secrets', async () => {
    const { call, developer } = setup();
    await developer().secrets.set('api', TOKEN);
    expect(await call('secrets.get', 'api')).toBe(TOKEN);
    await call('secrets.set', 'api', 'rotated');
    expect(await developer().secrets.get('api')).toBe('rotated');
  });

  it('checks names, values and how many a plugin keeps', async () => {
    const { call } = setup();
    await expect(call('secrets.set', '../x', 'v')).rejects.toThrow(/identifier/);
    await expect(call('secrets.set', 'api', 42)).rejects.toThrow(/must be a string/);
    await expect(call('secrets.set', 'api', 'x'.repeat(MAX_PLUGIN_SECRET_BYTES + 1))).rejects.toThrow(/at most/);
    await call('secrets.set', 'api', 'é'.repeat(MAX_PLUGIN_SECRET_BYTES / 2));
    for (let n = 1; n < MAX_PLUGIN_SECRETS; n++) await call('secrets.set', `k${n}`, 'v');
    await expect(call('secrets.set', 'one-more', 'v')).rejects.toThrow(/at most 64 secrets/);
    await call('secrets.set', 'k1', 'replaced');
    expect(await call('secrets.get', 'k1')).toBe('replaced');
  });

  it('fails while GETSSH is locked', async () => {
    const { call, developer } = setup();
    await call('secrets.set', 'api', TOKEN);
    mocks.phase = 'locked';
    await expect(call('secrets.get', 'api')).rejects.toThrow(/locked/);
    await expect(call('secrets.set', 'api', 'x')).rejects.toThrow(/locked/);
    await expect(developer().secrets.get('api')).rejects.toThrow(/locked/);
  });

  it('keeps each plugin to its own secrets', async () => {
    const { internals, call } = setup();
    await call('secrets.set', 'api', TOKEN);
    const other = await internals.dispatchPluginHostCall('other', { name: 'other' }, host, 'secrets.get', ['api']).catch(error => error);
    expect(other).toBeInstanceOf(Error);
    internals.runningPlugins.set('other', { host });
    expect(await internals.dispatchPluginHostCall('other', { name: 'other' }, host, 'secrets.get', ['api'])).toBeUndefined();
  });
});

describe('password settings', () => {
  it('moves a password setting out of the storage file the first time the plugin reads it', async () => {
    mocks.kv.set('default/demo', new Map<string, unknown>([['token', TOKEN], ['endpoint', 'https://api.example.com']]));
    const { call } = setup();
    expect(await call('storage.get', 'token')).toBe(TOKEN);
    expect(kvFile().has('token')).toBe(false);
    expect(kvFile().get('endpoint')).toBe('https://api.example.com');
    expect(stored()).toEqual({ settings: { default: { token: TOKEN } } });
    expect(await call('storage.get', 'token')).toBe(TOKEN);
  });

  it('reads it during activate(), before the main process has the schema', async () => {
    await setup().call('storage.set', 'token', TOKEN);
    expect(kvFile().has('token')).toBe(false);
    const { call } = setup(null);
    expect(await call('storage.get', 'token')).toBe(TOKEN);
    expect(await call('storage.get', 'missing')).toBeUndefined();
  });

  it('never sends it to the settings form, which learns only that it is saved', async () => {
    mocks.kv.set('default/demo', new Map<string, unknown>([['token', TOKEN], ['endpoint', 'https://api.example.com']]));
    const { ipc, call } = setup();
    expect(await ipc('plugin-storage-get', 'demo', 'token')).toBeNull();
    expect(await ipc('plugin-storage-get', 'demo', 'endpoint')).toBe('https://api.example.com');
    expect(kvFile().has('token')).toBe(false);
    expect(await ipc('plugin-storage-saved-passwords', 'demo')).toEqual(['token']);

    expect(await ipc('plugin-storage-set', 'demo', 'token', 'typed')).toEqual({ success: true });
    expect(await call('storage.get', 'token')).toBe('typed');
    expect(kvFile().has('token')).toBe(false);
    expect(await ipc('plugin-storage-set', 'demo', 'token', 7)).toMatchObject({ success: false });
    expect(await ipc('plugin-storage-set', 'demo', 'token', '')).toEqual({ success: true });
    expect(await ipc('plugin-storage-saved-passwords', 'demo')).toEqual([]);
    expect(await call('storage.get', 'token')).toBeUndefined();
  });

  it('answers only GETSSH\'s own windows', async () => {
    const { call } = setup();
    await call('storage.set', 'token', TOKEN);
    const untrusted = { trusted: false };
    expect(await mocks.handlers.get('plugin-storage-saved-passwords')!(untrusted, 'demo')).toEqual([]);
    expect(await mocks.handlers.get('plugin-storage-get')!(untrusted, 'demo', 'endpoint')).toBeNull();
    expect(await mocks.handlers.get('plugin-storage-set')!(untrusted, 'demo', 'token', 'x')).toMatchObject({ success: false });
    expect(await call('storage.get', 'token')).toBe(TOKEN);
  });

  it('follows the active workspace, and goes with a deleted one', async () => {
    const { call } = setup();
    await call('storage.set', 'token', 'for-default');
    mocks.workspace = 'work';
    expect(await call('storage.get', 'token')).toBeUndefined();
    await call('storage.set', 'token', 'for-work');
    expect(stored()).toEqual({ settings: { default: { token: 'for-default' }, work: { token: 'for-work' } } });
    removeWorkspacePluginSettings('work');
    expect(await call('storage.get', 'token')).toBeUndefined();
    mocks.workspace = 'default';
    expect(await call('storage.get', 'token')).toBe('for-default');
  });

  it('goes when the plugin removes it, clears its storage or saves something else under the name', async () => {
    const { call } = setup();
    await call('storage.set', 'token', TOKEN);
    await call('storage.delete', 'token');
    expect(stored()).toBeNull();
    await call('storage.set', 'token', TOKEN);
    await call('storage.clear');
    expect(stored()).toBeNull();
    await call('storage.set', 'token', TOKEN);
    await call('storage.set', 'token', { not: 'text' });
    expect(stored()).toBeNull();
    expect(await call('storage.get', 'token')).toEqual({ not: 'text' });
    await call('storage.set', 'a key with spaces', 1);
  });

  it('fails while GETSSH is locked instead of looking unset', async () => {
    const { call } = setup();
    await call('storage.set', 'token', TOKEN);
    await call('storage.set', 'endpoint', 'https://api.example.com');
    mocks.phase = 'locked';
    await expect(call('storage.get', 'token')).rejects.toThrow(/locked/);
    expect(await call('storage.get', 'endpoint')).toBe('https://api.example.com');
    expect(await call('storage.get', 'missing')).toBeUndefined();
  });
});

describe('uninstalling a plugin', () => {
  it('removes its secrets and its password settings', async () => {
    const { call, ipc, internals } = setup();
    await call('secrets.set', 'api', TOKEN);
    await call('storage.set', 'token', TOKEN);
    internals.runningPlugins.delete('demo');
    getStore().setAppSecret('plugin/other', JSON.stringify({ secrets: { api: 'theirs' } }));
    expect(await ipc('uninstall-plugin', 'demo')).toEqual({ success: true });
    expect(getStore().listAppSecretNames('plugin/')).toEqual(['plugin/other']);
  });
});
