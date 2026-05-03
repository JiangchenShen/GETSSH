import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginManager } from '../PluginManager';
import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    readFileSync: vi.fn(),
    promises: {
      access: vi.fn(),
      rm: vi.fn(),
      mkdtemp: vi.fn(),
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
      readFile: vi.fn(),
      rename: vi.fn(),
    }
  }
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name) => {
      if (name === 'userData') return '/mock/userData';
      if (name === 'temp') return '/mock/temp';
      return '/mock/path';
    })
  },
  ipcMain: {
    handle: vi.fn()
  },
  Notification: vi.fn(() => ({ show: vi.fn() })),
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  }
}));

const mockAdmZipInstance = {
  getEntries: vi.fn(() => [])
};
vi.mock('adm-zip', () => {
  return {
    default: vi.fn(function() {
      return mockAdmZipInstance;
    })
  };
});

describe('PluginManager', () => {
  let pluginManager: PluginManager;

  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as any).mockReturnValue(true);
    pluginManager = new PluginManager();
  });

  describe('constructor', () => {
    it('should initialize and create plugins directory if it does not exist', () => {
      (fs.existsSync as any).mockReturnValue(false);
      new PluginManager();
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('/mock/userData', 'plugins'), { recursive: true });
    });
  });

  describe('loadPlugins', () => {
    it('should load plugins and add to installedPlugins', () => {
      (fs.readdirSync as any).mockReturnValue(['plugin1']);
      (fs.statSync as any).mockReturnValue({ isDirectory: () => true });

      (fs.existsSync as any).mockImplementation((p: string) => p.includes('package.json'));
      (fs.readFileSync as any).mockReturnValue(JSON.stringify({ name: 'plugin1', main: 'main.js' }));

      pluginManager.loadPlugins();

      expect(pluginManager.installedPlugins.length).toBe(1);
      expect(pluginManager.installedPlugins[0].name).toBe('plugin1');
    });

    it('should ignore non-directories', () => {
      (fs.readdirSync as any).mockReturnValue(['not-a-dir']);
      (fs.statSync as any).mockReturnValue({ isDirectory: () => false });

      pluginManager.loadPlugins();

      expect(pluginManager.installedPlugins.length).toBe(0);
    });
  });

  describe('setupIPC', () => {
    beforeEach(() => {
      pluginManager.setupIPC();
    });

    it('should register IPC handlers', () => {
      expect(ipcMain.handle).toHaveBeenCalledWith('get-plugin-list', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('uninstall-plugin', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('install-plugin', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('get-plugin-renderers', expect.any(Function));
    });

    describe('get-plugin-list', () => {
      it('should return installed plugins', async () => {
        const handler = (ipcMain.handle as any).mock.calls.find((call: any) => call[0] === 'get-plugin-list')[1];
        pluginManager.installedPlugins = [{ name: 'test', main: 'main.js' }];
        const result = await handler();
        expect(result).toEqual([{ name: 'test', main: 'main.js' }]);
      });
    });

    describe('uninstall-plugin', () => {
      it('should uninstall an existing plugin successfully', async () => {
        const handler = (ipcMain.handle as any).mock.calls.find((call: any) => call[0] === 'uninstall-plugin')[1];
        pluginManager.installedPlugins = [{ name: 'test-plugin', main: 'main.js' }];

        (fs.promises.access as any).mockResolvedValue(undefined);
        (fs.promises.rm as any).mockResolvedValue(undefined);

        const result = await handler(null, 'test-plugin');

        expect(fs.promises.rm).toHaveBeenCalledWith(path.join('/mock/userData/plugins', 'test-plugin'), { recursive: true, force: true });
        expect(result).toEqual({ success: true });
        expect(pluginManager.installedPlugins.length).toBe(0);
      });

      it('should prevent path traversal during uninstall', async () => {
        const handler = (ipcMain.handle as any).mock.calls.find((call: any) => call[0] === 'uninstall-plugin')[1];

        const result = await handler(null, '../malicious-plugin');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Path traversal detected');
      });
    });

    describe('install-plugin', () => {
      it('should install a plugin successfully', async () => {
        const handler = (ipcMain.handle as any).mock.calls.find((call: any) => call[0] === 'install-plugin')[1];

        const mockManifest = { name: 'new-plugin', main: 'main.js' };

        mockAdmZipInstance.getEntries.mockReturnValue([
          { entryName: 'package.json', isDirectory: false, getData: () => Buffer.from(JSON.stringify(mockManifest)) },
          { entryName: 'main.js', isDirectory: false, getData: () => Buffer.from('console.log("main")') }
        ] as any);

        (fs.promises.mkdtemp as any).mockResolvedValue('/mock/temp/plugin_123');
        (fs.promises.access as any).mockImplementation((p: string) => p.endsWith('package.json') ? Promise.resolve() : Promise.reject(new Error('ENOENT')));
        (fs.promises.readFile as any).mockResolvedValue(JSON.stringify(mockManifest));
        (fs.promises.rm as any).mockResolvedValue(undefined);
        (fs.promises.rename as any).mockResolvedValue(undefined);

        const result = await handler(null, '/path/to/plugin.zip');

        expect(result.success).toBe(true);
        expect(result.manifest).toEqual(mockManifest);
        expect(pluginManager.installedPlugins.length).toBe(1);
        expect(pluginManager.installedPlugins[0].name).toBe('new-plugin');
      });

      it('should prevent path traversal for plugin name in manifest', async () => {
        const handler = (ipcMain.handle as any).mock.calls.find((call: any) => call[0] === 'install-plugin')[1];

        const mockManifest = { name: '../../malicious', main: 'main.js' };

        mockAdmZipInstance.getEntries.mockReturnValue([
          { entryName: 'package.json', isDirectory: false, getData: () => Buffer.from(JSON.stringify(mockManifest)) }
        ] as any);

        (fs.promises.mkdtemp as any).mockResolvedValue('/mock/temp/plugin_123');
        (fs.promises.access as any).mockResolvedValue(undefined); // package.json exists
        (fs.promises.readFile as any).mockResolvedValue(JSON.stringify(mockManifest));

        const result = await handler(null, '/path/to/plugin.zip');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Path traversal detected');
      });

      it('should handle missing package.json manifest during extraction', async () => {
        const handler = (ipcMain.handle as any).mock.calls.find((call: any) => call[0] === 'install-plugin')[1];

        mockAdmZipInstance.getEntries.mockReturnValue([
          { entryName: 'main.js', isDirectory: false, getData: () => Buffer.from('console.log("main")') }
        ] as any);

        (fs.promises.mkdtemp as any).mockResolvedValue('/mock/temp/plugin_123');
        (fs.promises.access as any).mockRejectedValue(new Error('ENOENT'));
        (fs.promises.readdir as any).mockResolvedValue([]);

        const result = await handler(null, '/path/to/plugin.zip');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Missing package.json manifest');
      });

      it('should correctly handle nested directory structure where zip has single root directory', async () => {
        const handler = (ipcMain.handle as any).mock.calls.find((call: any) => call[0] === 'install-plugin')[1];

        const mockManifest = { name: 'nested-plugin', main: 'main.js' };

        mockAdmZipInstance.getEntries.mockReturnValue([
          { entryName: 'folder/package.json', isDirectory: false, getData: () => Buffer.from(JSON.stringify(mockManifest)) },
        ] as any);

        (fs.promises.mkdtemp as any).mockResolvedValue('/mock/temp/plugin_123');

        (fs.promises.access as any).mockImplementation((p: string) => {
          if (p === path.join('/mock/temp/plugin_123', 'package.json')) return Promise.reject(new Error('ENOENT'));
          if (p === path.join('/mock/temp/plugin_123', 'folder', 'package.json')) return Promise.resolve();
          return Promise.reject(new Error('ENOENT'));
        });

        (fs.promises.readdir as any).mockResolvedValue(['folder']);
        (fs.promises.stat as any).mockResolvedValue({ isDirectory: () => true });

        (fs.promises.readFile as any).mockResolvedValue(JSON.stringify(mockManifest));
        (fs.promises.rm as any).mockResolvedValue(undefined);
        (fs.promises.rename as any).mockResolvedValue(undefined);

        const result = await handler(null, '/path/to/plugin.zip');

        expect(result.success).toBe(true);
        expect(result.manifest.name).toBe('nested-plugin');
        expect(fs.promises.rename).toHaveBeenCalledWith(path.join('/mock/temp/plugin_123', 'folder'), path.join('/mock/userData/plugins', 'nested-plugin'));
      });
    });

    describe('get-plugin-renderers', () => {
      it('should return renderer scripts', async () => {
        const handler = (ipcMain.handle as any).mock.calls.find((call: any) => call[0] === 'get-plugin-renderers')[1];

        pluginManager.installedPlugins = [
          { name: 'plugin1', main: 'main.js', renderer: 'renderer.js' },
          { name: 'plugin2', main: 'main.js' } // no renderer
        ];

        (fs.promises.readFile as any).mockResolvedValue('console.log("renderer")');

        const result = await handler();

        expect(result).toEqual(['console.log("renderer")']);
        expect(fs.promises.readFile).toHaveBeenCalledWith(path.join('/mock/userData/plugins/plugin1', 'renderer.js'), 'utf8');
      });

      it('should prevent path traversal for renderer path', async () => {
         const handler = (ipcMain.handle as any).mock.calls.find((call: any) => call[0] === 'get-plugin-renderers')[1];

         pluginManager.installedPlugins = [
           { name: 'plugin1', main: 'main.js', renderer: '../../malicious.js' }
         ];

         const result = await handler();

         expect(result).toEqual(['']);
      });
    });
  });
});
