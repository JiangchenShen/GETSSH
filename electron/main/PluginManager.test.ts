import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import Module from 'module';
import { app, ipcMain } from 'electron';
import { PluginManager } from './PluginManager';
import AdmZip from 'adm-zip';

// Mock electron
vi.mock('electron', () => {
  return {
    app: {
      getPath: vi.fn((name) => {
        if (name === 'userData') return '/mocked/path/userData';
        if (name === 'temp') return '/mocked/path/temp';
        return `/mocked/path/${name}`;
      })
    },
    ipcMain: {
      handle: vi.fn()
    },
    Notification: vi.fn().mockImplementation(() => ({
      show: vi.fn()
    })),
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => false),
      encryptString: vi.fn(),
      decryptString: vi.fn()
    }
  };
});

// Mock fs
vi.mock('fs', () => {
  return {
    default: {
      existsSync: vi.fn(),
      mkdirSync: vi.fn(),
      readdirSync: vi.fn(),
      statSync: vi.fn(),
      readFileSync: vi.fn(),
      rmSync: vi.fn(),
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
  };
});

// Mock AdmZip
vi.mock('adm-zip', () => {
  const mockZipInstance = {
    getEntries: vi.fn(() => []),
    addFile: vi.fn(),
    writeZip: vi.fn(),
    extractAllTo: vi.fn(),
  };
  // Use a regular function so it can be used with 'new'
  const MockAdmZip = vi.fn(function() {
    return mockZipInstance;
  });
  return {
    default: MockAdmZip
  };
});

describe('PluginManager', () => {
  let originalRequire: any;
  let pluginManager: PluginManager;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default setup for existsSync
    (fs.existsSync as any).mockImplementation((p: string) => {
      if (p === '/mocked/path/userData/plugins') return true;
      return false;
    });

    originalRequire = Module.prototype.require;
    pluginManager = new PluginManager();
  });

  afterEach(() => {
    Module.prototype.require = originalRequire;
  });

  describe('loadPlugins', () => {
    it('should catch JSON parse errors from invalid package.json', async () => {
      // Mock readdir to return one folder
      (fs.promises.readdir as any).mockResolvedValue(['invalid-plugin']);

      // Mock stat to say it's a directory
      (fs.promises.stat as any).mockResolvedValue({ isDirectory: () => true });

      // Mock access to say package.json exists
      (fs.promises.access as any).mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return Promise.resolve();
        return Promise.reject(new Error('ENOENT'));
      });

      // Mock readFile to return invalid JSON
      (fs.promises.readFile as any).mockResolvedValue('invalid-json-{');

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw, but should log error
      await pluginManager.loadPlugins();

      // The error should be caught and logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Plugin Kernel] Failed to load plugin from invalid-plugin:'),
        expect.any(SyntaxError)
      );

      // Should not add to installed plugins
      expect(pluginManager.installedPlugins).toHaveLength(0);

      consoleErrorSpy.mockRestore();
    });

    it('should catch errors thrown by plugin module activate function', async () => {
      // Mock readdir to return one folder
      (fs.promises.readdir as any).mockResolvedValue(['crashing-plugin']);

      // Mock stat to say it's a directory
      (fs.promises.stat as any).mockResolvedValue({ isDirectory: () => true });

      // Mock access to say package.json and main entry exist
      (fs.promises.access as any).mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return Promise.resolve();
        if (p.endsWith('index.js')) return Promise.resolve();
        return Promise.reject(new Error('ENOENT'));
      });

      // Mock readFile to return valid package.json
      (fs.promises.readFile as any).mockResolvedValue(JSON.stringify({
        name: 'crashing-plugin',
        version: '1.0.0',
        main: 'index.js'
      }));

      const mockPluginPath = path.join('/mocked/path/userData/plugins/crashing-plugin/index.js');
      const testError = new Error('Plugin activation failed');

      // Mock Node's require to return our crashing plugin when path matches
      Module.prototype.require = function(id: string) {
        if (id === mockPluginPath) {
          return {
            activate: () => {
              throw testError;
            }
          };
        }
        return originalRequire.apply(this, arguments as any);
      } as any;

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw, but should log error
      await pluginManager.loadPlugins();

      // The error should be caught and logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Plugin Kernel] Failed to load plugin from crashing-plugin:'),
        testError
      );

      // Even though it crashed on activate, it should still have been added to installed plugins
      expect(pluginManager.installedPlugins).toHaveLength(1);
      expect(pluginManager.installedPlugins[0].name).toBe('crashing-plugin');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('IPC Handlers (Async)', () => {
    let installHandler: Function;

    beforeEach(() => {
      pluginManager.setupIPC();
      const calls = (ipcMain.handle as any).mock.calls;
      const installCall = calls.find((call: any) => call[0] === 'install-plugin');
      installHandler = installCall[1];
    });

    it('should return error if zip file is missing package.json', async () => {
      const mockZipPath = '/mocked/path/temp/dummy.zip';
      const mockTempDir = '/mocked/path/temp/plugin_123';
      
      // Setup async mocks
      (fs.promises.mkdtemp as any).mockResolvedValue(mockTempDir);
      (fs.promises.readdir as any).mockResolvedValue([]); // Empty directory
      (fs.promises.access as any).mockRejectedValue(new Error('File not found')); // package.json doesn't exist
      
      // Get the mocked zip instance from the mock factory
      const mockZip = new AdmZip();
      (mockZip.getEntries as any).mockReturnValue([
        { entryName: 'index.js', isDirectory: false, getData: () => Buffer.from('') }
      ]);

      // Call the handler
      const result = await installHandler({} as any, mockZipPath);

      // Verify result
      expect(result).toEqual({
        success: false,
        error: 'Invalid Architecture: Missing package.json manifest.'
      });

      // Verify async flow
      expect(fs.promises.mkdtemp).toHaveBeenCalled();
      expect(fs.promises.access).toHaveBeenCalledWith(expect.stringContaining('package.json'));
    });

    it('should handle nested plugin folder if package.json is not in root', async () => {
      const mockZipPath = '/mocked/path/temp/nested.zip';
      const mockTempDir = '/mocked/path/temp/plugin_nested';
      const nestedDirName = 'plugin-v1';
      const nestedPath = path.join(mockTempDir, nestedDirName);
      
      (fs.promises.mkdtemp as any).mockResolvedValue(mockTempDir);
      
      // First access check (root) fails
      // Second access check (nested) succeeds
      (fs.promises.access as any).mockImplementation((p: string) => {
        if (p === path.join(nestedPath, 'package.json')) return Promise.resolve();
        return Promise.reject(new Error('Not found'));
      });
      
      (fs.promises.readdir as any).mockResolvedValue([nestedDirName]);
      (fs.promises.stat as any).mockResolvedValue({ isDirectory: () => true });
      (fs.promises.readFile as any).mockResolvedValue(JSON.stringify({
        name: 'nested-plugin',
        version: '1.0.0'
      }));
      (fs.promises.rename as any).mockResolvedValue(undefined);
      (fs.promises.rm as any).mockResolvedValue(undefined);

      const mockZip = new AdmZip();
      (mockZip.getEntries as any).mockReturnValue([
        { entryName: `${nestedDirName}/package.json`, isDirectory: false, getData: () => Buffer.from('{}') }
      ]);

      const result = await installHandler({} as any, mockZipPath);

      expect(result.success).toBe(true);
      expect(result.manifest.name).toBe('nested-plugin');
      expect(fs.promises.rename).toHaveBeenCalledWith(nestedPath, expect.any(String));
    });

    it('should catch errors thrown during installation', async () => {
      // Setup mock to throw an error
      (fs.promises.mkdtemp as any).mockRejectedValue(new Error('Simulated installation failure'));

      // Call the handler
      const result = await installHandler({} as any, '/mocked/path/temp/dummy.zip');

      // Assert result
      expect(result).toEqual({
        success: false,
        error: 'Simulated installation failure'
      });
    });
  });
});
