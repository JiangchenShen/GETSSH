import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// MCP environment variables and headers (tokens) in getssh-store instead of mcp_servers.json,
// on rust-core/getssh-store/store.fake.js with a temporary home directory. No server is started.

// The module creates its singleton on import: give it a home of its own from the start.
const mocks = vi.hoisted(() => {
  const importHome = `${process.env.TMPDIR || '/tmp/'}getssh-mcp-import-${process.pid}`;
  return {
    importHome,
    state: { home: importHome, phase: 'ready' as 'starting' | 'locked' | 'ready', waiters: [] as Array<() => void> },
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getVersion: () => '3.0.0-test',
    getPath: () => mocks.state.home,
  },
}));
vi.mock('../../security/appLock', () => ({
  appLock: {
    isReady: () => mocks.state.phase === 'ready',
    whenOpen: () => mocks.state.phase === 'ready'
      ? Promise.resolve()
      : new Promise<void>(resolve => mocks.state.waiters.push(resolve)),
  },
}));
vi.mock('./McpClient', () => ({ McpClient: class {} }));
vi.mock('./McpToolWrapper', () => ({ McpToolWrapper: class {} }));
vi.mock('./McpSamplingBridge', () => ({ mcpSamplingBridge: {} }));
vi.mock('../agent/ToolRegistry', () => ({ toolRegistry: { register: vi.fn(), unregister: vi.fn() } }));

import { configureStore, getStore, resetStoreForTest } from '../getsshStore';
import { McpManager } from './McpManager';

const fake = createRequire(import.meta.url)(path.resolve(process.cwd(), '../../rust-core/getssh-store/store.fake.js'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-mcp-secrets-'));
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, GETSSH_FAKE_STORE: process.env.GETSSH_FAKE_STORE };

const TOKEN = 'ghp_example_token_123';
const legacyServers = [
  { id: 'github', name: 'GitHub', transport: 'stdio', enabled: false, command: '/usr/bin/true', env: { GITHUB_TOKEN: TOKEN } },
  { id: 'remote', name: 'Remote', transport: 'http', enabled: false, url: 'https://mcp.example.com', headers: { Authorization: `Bearer ${TOKEN}` } },
  { id: 'plain', name: 'Plain', transport: 'http', enabled: false, url: 'https://plain.example.com' },
];

const configFile = () => path.join(mocks.state.home, '.getssh', 'mcp_servers.json');
const fresh = () => new (McpManager as unknown as { new(): McpManager })();
const configs = (manager: McpManager) => Object.fromEntries(manager.getAllServersState().map(state => [state.config.id, state.config]));

function open(phase: typeof mocks.state.phase) {
  mocks.state.phase = phase;
  if (phase === 'ready') for (const resolve of mocks.state.waiters.splice(0)) resolve();
}

beforeEach(async () => {
  mocks.state.home = fs.mkdtempSync(path.join(root, 'home-'));
  process.env.HOME = mocks.state.home;
  process.env.USERPROFILE = mocks.state.home;
  process.env.GETSSH_FAKE_STORE = '1';
  open('ready');
  fake.__fake.reset();
  resetStoreForTest();
  await configureStore().start();
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(legacyServers));
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(mocks.importHome, { recursive: true, force: true });
});

describe('MCP secrets', () => {
  it('moves tokens out of mcp_servers.json into the store, and reads them back', async () => {
    const manager = fresh();
    await manager.init();
    const file = fs.readFileSync(configFile(), 'utf8');
    expect(file).not.toContain(TOKEN);
    expect(JSON.parse(file).map((server: { id: string }) => server.id)).toEqual(['github', 'remote', 'plain']);
    expect(getStore().listAppSecretNames('mcp/')).toEqual(['mcp/github', 'mcp/remote']);

    const restarted = fresh();
    expect(configs(restarted).github.env).toBeUndefined();
    await restarted.init();
    expect(configs(restarted).github.env).toEqual({ GITHUB_TOKEN: TOKEN });
    expect(configs(restarted).remote.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(configs(restarted).plain.headers).toBeUndefined();
  });

  it('starts nothing and saves no token until the data is open', async () => {
    await fresh().init();
    open('locked');
    const manager = fresh();
    let started = false;
    const init = manager.init().then(() => { started = true; });
    await Promise.resolve();
    expect(started).toBe(false);
    expect(() => manager.saveConfigs()).not.toThrow();
    expect(getStore().listAppSecretNames('mcp/')).toEqual(['mcp/github', 'mcp/remote']);
    await expect(manager.updateServer('plain', { headers: { Authorization: 'Bearer x' } })).rejects.toThrow(/locked/);
    expect(fs.readFileSync(configFile(), 'utf8')).not.toContain('Bearer x');
    open('ready');
    await init;
    expect(configs(manager).github.env).toEqual({ GITHUB_TOKEN: TOKEN });
  });

  it('updates and removes a server\'s stored secrets with it', async () => {
    const manager = fresh();
    await manager.init();
    await manager.updateServer('github', { env: { GITHUB_TOKEN: 'ghp_rotated' } });
    manager.removeServer('remote');
    expect(getStore().listAppSecretNames('mcp/')).toEqual(['mcp/github']);
    const restarted = fresh();
    await restarted.init();
    expect(configs(restarted).github.env).toEqual({ GITHUB_TOKEN: 'ghp_rotated' });
    expect(configs(restarted).remote).toBeUndefined();
    expect(fs.readFileSync(configFile(), 'utf8')).not.toContain('ghp_rotated');
  });
});
