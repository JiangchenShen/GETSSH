import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PluginManager } from '../PluginManager';
import fs from 'fs';

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/app/data'),
  },
  ipcMain: {
    handle: vi.fn(),
  },
  Notification: class {
    show = vi.fn();
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

// Mock adm-zip
vi.mock('adm-zip', () => {
  return {
    default: class AdmZip {
      getEntries = vi.fn().mockReturnValue([]);
    }
  };
});

// Setup a throwing module mock for require test
vi.mock('/mock/app/data/plugins/test-plugin/main.js', () => {
  throw new Error('Module initialization failed');
});

// Mock fs and fs.promises
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    promises: {
      readdir: vi.fn(),
      readFile: vi.fn(),
      rm: vi.fn(),
      access: vi.fn(),
      mkdtemp: vi.fn(),
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      rename: vi.fn(),
      stat: vi.fn(),
    },
  },
}));

describe('PluginManager - loadPlugins error paths', () => {
  let pluginManager: PluginManager;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    pluginManager = new PluginManager();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should catch and log error when fs.promises.readdir fails', async () => {
    const error = new Error('Readdir failed');
    vi.mocked(fs.promises.readdir).mockRejectedValueOnce(error);

    await pluginManager.loadPlugins();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Plugin Kernel] Failed to read plugins directory:',
      error
    );
  });

  it('should catch and log error when fs.promises.readFile fails with non-ENOENT error', async () => {
    // Setup a mock directory entry
    const dirents = [
      { name: 'test-plugin', isDirectory: () => true },
    ];
    vi.mocked(fs.promises.readdir).mockResolvedValueOnce(dirents as any);

    const error = new Error('Permission denied');
    (error as any).code = 'EACCES';
    vi.mocked(fs.promises.readFile).mockRejectedValueOnce(error);

    await pluginManager.loadPlugins();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Plugin Kernel] Failed to load plugin from test-plugin:',
      error
    );
  });

  it('should catch and log error when package.json JSON.parse fails', async () => {
    // Setup a mock directory entry
    const dirents = [
      { name: 'test-plugin', isDirectory: () => true },
    ];
    vi.mocked(fs.promises.readdir).mockResolvedValueOnce(dirents as any);

    // Return invalid JSON
    vi.mocked(fs.promises.readFile).mockResolvedValueOnce('invalid json {');

    await pluginManager.loadPlugins();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Plugin Kernel] Failed to load plugin from test-plugin:',
      expect.any(SyntaxError)
    );
  });

  it('should catch and log error when plugin module require throws a generic error', async () => {
    // Setup a mock directory entry
    const dirents = [
      { name: 'test-plugin', isDirectory: () => true },
    ];
    vi.mocked(fs.promises.readdir).mockResolvedValueOnce(dirents as any);

    // Return valid JSON pointing to the mocked throwing module
    const manifest = { name: 'test-plugin', version: '1.0.0', main: 'main.js' };
    vi.mocked(fs.promises.readFile).mockResolvedValueOnce(JSON.stringify(manifest));

    // Ensure we trigger the generic error. We can also simulate a MODULE_NOT_FOUND
    // that doesn't include the main file in the message.
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    const testError = new Error('Module initialization failed');
    vi.spyOn(Module.prototype, 'require').mockImplementation(function(this: any, path: string) {
      if (path.includes('test-plugin') && path.includes('main.js')) {
        throw testError;
      }
      return originalRequire.call(this, path);
    });

    try {
      await pluginManager.loadPlugins();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Plugin Kernel] Failed to load plugin from test-plugin:',
        testError
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
});
