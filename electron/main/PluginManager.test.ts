import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PluginManager } from './PluginManager';
import Module from 'module';

// Mock electron
vi.mock('electron', () => {
  return {
    app: {
      getPath: vi.fn((name) => `/mocked/path/${name}`)
    },
    ipcMain: {
      handle: vi.fn()
    },
    Notification: vi.fn(),
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
  return {
    default: vi.fn()
  };
});

describe('PluginManager', () => {
  let originalRequire: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default setup
    (fs.existsSync as any).mockImplementation((p: string) => {
      // By default the plugins directory exists
      if (p === '/mocked/path/userData/plugins') return true;
      return false;
    });

    originalRequire = Module.prototype.require;
  });

  afterEach(() => {
    Module.prototype.require = originalRequire;
  });

  describe('loadPlugins', () => {
    it('should catch JSON parse errors from invalid package.json', () => {
      const pluginManager = new PluginManager();

      // Mock readdirSync to return one folder
      (fs.readdirSync as any).mockReturnValue(['invalid-plugin']);

      // Mock statSync to say it's a directory
      (fs.statSync as any).mockReturnValue({ isDirectory: () => true });

      // Mock existsSync to say package.json exists
      (fs.existsSync as any).mockImplementation((p: string) => {
        if (p === '/mocked/path/userData/plugins') return true;
        if (p.endsWith('package.json')) return true;
        return false;
      });

      // Mock readFileSync to return invalid JSON
      (fs.readFileSync as any).mockReturnValue('invalid-json-{');

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw, but should log error
      expect(() => pluginManager.loadPlugins()).not.toThrow();

      // The error should be caught and logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Plugin Kernel] Failed to load plugin from invalid-plugin:'),
        expect.any(SyntaxError)
      );

      // Should not add to installed plugins
      expect(pluginManager.installedPlugins).toHaveLength(0);

      consoleErrorSpy.mockRestore();
    });

    it('should catch errors thrown by plugin module activate function', () => {
      const pluginManager = new PluginManager();

      // Mock readdirSync to return one folder
      (fs.readdirSync as any).mockReturnValue(['crashing-plugin']);

      // Mock statSync to say it's a directory
      (fs.statSync as any).mockReturnValue({ isDirectory: () => true });

      // Mock existsSync to say package.json and main entry exist
      (fs.existsSync as any).mockImplementation((p: string) => {
        if (p === '/mocked/path/userData/plugins') return true;
        if (p.endsWith('package.json')) return true;
        if (p.endsWith('index.js')) return true;
        return false;
      });

      // Mock readFileSync to return valid package.json
      (fs.readFileSync as any).mockReturnValue(JSON.stringify({
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
      expect(() => pluginManager.loadPlugins()).not.toThrow();

      // The error should be caught and logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Plugin Kernel] Failed to load plugin from crashing-plugin:'),
        testError
      );

      // Even though it crashed on activate, it should still have been added to installed plugins
      // since the addition happens before the activation.
      expect(pluginManager.installedPlugins).toHaveLength(1);
      expect(pluginManager.installedPlugins[0].name).toBe('crashing-plugin');

      consoleErrorSpy.mockRestore();
    });
  });
});
