import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// get-plugin-renderers: the renderer.js page of each installed plugin, for the main window to open
// in hidden frames. It answers once the boot-time plugin scan is over, and only a known window.
// An update (commit-plugin-install of an installed name) replaces the plugin's manifest and page.

const mocks = vi.hoisted(() => ({
  userData: '',
  temp: '',
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'temp' ? mocks.temp : mocks.userData) },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { mocks.handlers.set(channel, handler); },
    on: () => {},
  },
  Notification: class { show() {} },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  clipboard: {},
}));
vi.mock('./handlers/storeHandler', () => ({ clipboardTextForPlugin: vi.fn() }));
vi.mock('./handlers/systemHandler', () => ({ getBackendConfig: () => ({ pluginSecurityMode: 'safe' }) }));
vi.mock('./handlers/workspaceHandler', () => ({ getActiveWorkspaceId: () => 'default' }));
vi.mock('./services/plugin/pluginSecrets', () => ({}));
vi.mock('./services/SSHBridge', () => ({ sshBridge: {} }));
vi.mock('./services/PluginStorageManager', () => ({ pluginStorageManager: {} }));
vi.mock('./security/SecureCenter', () => ({ MAX_AUDITED_COMMAND: 65536, SecureCenter: { getInstance: () => ({}) } }));
vi.mock('./windowRegistry', () => ({
  broadcastToAllWindows: vi.fn(),
  getMainWindow: () => null,
  isKnownTopLevelSender: (event: { trusted?: boolean }) => event.trusted === true,
}));
vi.mock('./utils/rustCorePath', () => ({ getRustCorePath: () => '' }));
vi.mock('./services/plugin/PluginProcessHost', () => ({ PluginProcessHost: class {} }));
vi.mock('./services/plugin/PluginNetworkGateway', () => ({ fetchForPlugin: vi.fn(), isPrivateNetworkAddress: () => false }));

import { PluginManager } from './PluginManager';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-plugin-renderer-ipc-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function plugin(name: string, manifest: Record<string, unknown>, files: string[] = []) {
  const folder = path.join(root, 'plugins', name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.html', getssh: { type: 'sandbox' }, ...manifest }));
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.writeFileSync(path.join(folder, file), 'window.GETSSH.registerSidebarAction("a", "", "A");');
  }
}

describe('get-plugin-renderers', () => {
  it('lists the renderer.js page of each installed plugin once the plugins are loaded', async () => {
    mocks.userData = root;
    plugin('alpha', { renderer: 'renderer.js' }, ['renderer.js']);
    plugin('beta', { renderer: 'dist/renderer.js' }, ['dist/renderer.js']);
    plugin('plain', {}, ['index.html']);
    plugin('missing', { renderer: 'renderer.js' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const manager = new PluginManager();
      manager.setupIPC();
      const handler = mocks.handlers.get('get-plugin-renderers')!;
      let answered = false;
      const pending = Promise.resolve(handler({ trusted: true })).then(pages => { answered = true; return pages; });
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(answered).toBe(false);
      await manager.loadPlugins();
      manager.markInitialLoadDone();
      const pages = await pending as Array<{ pluginId: string; url: string }>;
      expect([...pages].sort((a, b) => a.pluginId.localeCompare(b.pluginId))).toEqual([
        { pluginId: 'alpha', url: 'getssh-plugin://alpha/?renderer=renderer.js' },
        { pluginId: 'beta', url: 'getssh-plugin://beta/?renderer=dist%2Frenderer.js' },
      ]);
      expect(await handler({ trusted: false })).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('commit-plugin-install', () => {
  it('replaces an updated plugin in the list and in its renderer.js page, and restarts a backend it stopped', async () => {
    const userData = fs.mkdtempSync(path.join(root, 'update-'));
    mocks.userData = userData;
    mocks.temp = fs.mkdtempSync(path.join(root, 'temp-'));
    const write = (dir: string, files: Record<string, string>) => {
      for (const [file, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), text);
      }
    };
    const manifest = (name: string, version: string, extra: Record<string, unknown>) => JSON.stringify({ name, version, main: 'index.html', getssh: { type: 'sandbox' }, ...extra });
    write(path.join(userData, 'plugins'), {
      'alpha/package.json': manifest('alpha', '1.0.0', { main: 'main.js', renderer: 'renderer.js', getssh: { capabilities: ['lifecycle'] } }),
      'alpha/renderer.js': '',
      'beta/package.json': manifest('beta', '1.0.0', { renderer: 'renderer.js' }),
      'beta/renderer.js': '',
    });
    const manager = new PluginManager();
    manager.setupIPC();
    await manager.loadPlugins();
    manager.markInitialLoadDone();
    const call = (channel: string, ...args: unknown[]) => Promise.resolve(mocks.handlers.get(channel)!({ trusted: true }, ...args));
    // alpha's backend runs; beta has none.
    const host = { shutdown: vi.fn(async () => {}), kill: vi.fn() };
    (manager as unknown as { runningPlugins: Map<string, unknown> }).runningPlugins.set('alpha', { host });
    const reload = vi.spyOn(manager, 'reloadPlugin').mockResolvedValue(undefined);
    let previews = 0;
    const install = (name: string, files: Record<string, string>) => {
      const tempDir = path.join(mocks.temp, `getssh-plugin-preview-${++previews}`);
      write(path.join(tempDir, name), files);
      (manager as unknown as { _previewSourceDirCache: Record<string, string> })._previewSourceDirCache[path.resolve(tempDir)] = path.join(tempDir, name);
      return call('commit-plugin-install', { tempDir }) as Promise<{ success: boolean; error?: string }>;
    };
    const listed = async () => (await call('get-plugin-list') as Array<{ name: string; version: string }>).map(plugin => `${plugin.name}@${plugin.version}`);
    const pages = async () => Object.fromEntries((await call('get-plugin-renderers') as Array<{ pluginId: string; url: string }>).map(page => [page.pluginId, page.url]));

    const before = await listed();
    expect(await install('alpha', {
      'package.json': manifest('alpha', '2.0.0', { main: 'main.js', renderer: 'dist/renderer.js', getssh: { capabilities: ['lifecycle'] } }),
      'dist/renderer.js': '',
    })).toMatchObject({ success: true });
    expect(await listed()).toEqual(before.map(entry => (entry === 'alpha@1.0.0' ? 'alpha@2.0.0' : entry)));
    expect(await pages()).toEqual({
      alpha: 'getssh-plugin://alpha/?renderer=dist%2Frenderer.js&install=1',
      beta: 'getssh-plugin://beta/?renderer=renderer.js',
    });
    expect(host.shutdown).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledExactlyOnceWith('alpha');

    // A plugin with no backend running is not started; every install counts up.
    expect(await install('beta', { 'package.json': manifest('beta', '1.1.0', { renderer: 'renderer.js' }), 'renderer.js': '' })).toMatchObject({ success: true });
    expect(await install('alpha', {
      'package.json': manifest('alpha', '2.0.1', { main: 'main.js', renderer: 'dist/renderer.js', getssh: { capabilities: ['lifecycle'] } }),
      'dist/renderer.js': '',
    })).toMatchObject({ success: true });
    expect(await pages()).toEqual({
      alpha: 'getssh-plugin://alpha/?renderer=dist%2Frenderer.js&install=2',
      beta: 'getssh-plugin://beta/?renderer=renderer.js&install=1',
    });
    expect(await listed()).toEqual(before.map(entry => (entry === 'alpha@1.0.0' ? 'alpha@2.0.1' : 'beta@1.1.0')));
    expect(reload).toHaveBeenCalledOnce();
  });
});
