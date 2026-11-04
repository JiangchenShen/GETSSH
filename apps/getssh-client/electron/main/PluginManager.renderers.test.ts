import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// The renderer.js pages PluginManager asks its runner (pluginRendererHost.ts) to run: the page of
// each installed plugin once the boot-time scan is over, a new page after an update (a new install
// count in the URL), none for an uninstalled plugin; calls one after another.

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

import { PluginManager, type PluginRendererRunner } from './PluginManager';
import type { PluginRendererPage } from './services/plugin/pluginPageProtocol';

/** A runner that records the pages it was asked to run, by plugin. */
function runner() {
  const runs: Array<Record<string, string>> = [];
  const fake: PluginRendererRunner & { runs: typeof runs } = {
    runs,
    sync: vi.fn(async (pages: ReadonlyArray<PluginRendererPage>) => { runs.push(Object.fromEntries(pages.map(page => [page.pluginId, page.url]))); }),
  };
  return fake;
}

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

describe('renderer.js pages', () => {
  it('runs the page of each installed plugin once the plugins are loaded', async () => {
    mocks.userData = root;
    plugin('alpha', { renderer: 'renderer.js' }, ['renderer.js']);
    plugin('beta', { renderer: 'dist/renderer.js' }, ['dist/renderer.js']);
    plugin('plain', {}, ['index.html']);
    plugin('missing', { renderer: 'renderer.js' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pages = runner();
      const manager = new PluginManager(pages);
      manager.setupIPC();
      await manager.loadPlugins();
      expect(pages.sync).not.toHaveBeenCalled();
      manager.markInitialLoadDone();
      await vi.waitFor(() => expect(pages.sync).toHaveBeenCalledOnce());
      expect(pages.runs).toEqual([{
        alpha: 'getssh-plugin://alpha/?renderer=renderer.js',
        beta: 'getssh-plugin://beta/?renderer=dist%2Frenderer.js',
      }]);
      expect(mocks.handlers.has('get-plugin-renderers')).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('asks the runner one call at a time, each with the list as it is then', async () => {
    const pages = runner();
    let finishFirst!: () => void;
    (pages.sync as ReturnType<typeof vi.fn>).mockImplementationOnce(async (list: ReadonlyArray<{ pluginId: string; url: string }>) => {
      pages.runs.push(Object.fromEntries(list.map(page => [page.pluginId, page.url])));
      await new Promise<void>(resolve => { finishFirst = resolve; });
    });
    const manager = new PluginManager(pages);
    const first = manager.syncRenderers();
    const second = manager.syncRenderers();
    await vi.waitFor(() => expect(pages.sync).toHaveBeenCalledOnce());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(pages.sync).toHaveBeenCalledOnce();
    finishFirst();
    await Promise.all([first, second]);
    expect(pages.sync).toHaveBeenCalledTimes(2);
  });

  it('keeps going after a failed run', async () => {
    const pages = runner();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    (pages.sync as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('no session'));
    const manager = new PluginManager(pages);
    await manager.syncRenderers();
    await manager.syncRenderers();
    expect(pages.sync).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
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
    const pagesRunner = runner();
    const manager = new PluginManager(pagesRunner);
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
    // The pages the runner was last asked to run.
    const pages = async () => {
      await manager.syncRenderers();
      return pagesRunner.runs.at(-1);
    };

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

    // An uninstalled plugin's page stops.
    expect(await call('uninstall-plugin', 'beta')).toMatchObject({ success: true });
    expect(pagesRunner.runs.at(-1)).toEqual({ alpha: 'getssh-plugin://alpha/?renderer=dist%2Frenderer.js&install=2' });
  });
});
