import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// get-plugin-renderers: the renderer.js page of each installed plugin, for the main window to open
// in hidden frames. It answers once the boot-time plugin scan is over, and only a known window.

const mocks = vi.hoisted(() => ({
  userData: '',
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
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
