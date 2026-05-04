import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { app, ipcMain, safeStorage } from 'electron';

// Create it inside the module scope due to hoisting
vi.mock('electron', () => {
  const mockHandlers: Record<string, Function> = {};

  class MockBrowserWindow {
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      send: vi.fn()
    };
    on = vi.fn();
    loadFile = vi.fn();
    loadURL = vi.fn();
  }

  return {
    app: {
      getPath: vi.fn((name) => `/mock/path/${name}`),
      commandLine: { appendSwitch: vi.fn() },
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn()
    },
    ipcMain: {
      handle: vi.fn((channel, handler) => {
        mockHandlers[channel] = handler;
      }),
      on: vi.fn(),
      mockHandlers // Expose handlers array to the tests
    },
    BrowserWindow: MockBrowserWindow,
    dialog: { showOpenDialog: vi.fn() },
    nativeTheme: { shouldUseDarkColors: false, on: vi.fn() },
    globalShortcut: { register: vi.fn(), unregisterAll: vi.fn() },
    Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
    powerSaveBlocker: { start: vi.fn(), stop: vi.fn(), isStarted: vi.fn() },
    safeStorage: { isEncryptionAvailable: vi.fn(() => false), encryptString: vi.fn(), decryptString: vi.fn() },
    shell: { openPath: vi.fn() }
  };
});

vi.mock('fs', () => {
  return {
    default: {
      existsSync: vi.fn(),
      mkdirSync: vi.fn(), // Needed for PluginManager
      promises: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        rename: vi.fn(),
        unlink: vi.fn(),
        access: vi.fn(),
        rm: vi.fn(),
        readdir: vi.fn().mockResolvedValue([]), // Needed for PluginManager
      },
      watch: vi.fn()
    }
  };
});

const originalProcessOn = process.on;
vi.spyOn(process, 'on').mockImplementation((event, listener) => {
  if (event === 'uncaughtException' || event === 'unhandledRejection') {
    return process; // ignore
  }
  return originalProcessOn.call(process, event, listener);
});

import '../index';

describe('index.ts IPC Error Handlers', () => {
  let handlers: Record<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = (ipcMain as any).mockHandlers;
  });

  describe('ssh-connect error boundaries', () => {
    it('should return error payload when reading private key fails', async () => {
      const handler = handlers['ssh-connect'];
      expect(handler).toBeDefined();

      const mockError = new Error('Permission denied');
      vi.mocked(fs.promises.readFile).mockRejectedValueOnce(mockError);

      const config = { privateKeyPath: '~/.ssh/id_rsa' };
      const result = await handler(null, config);

      expect(fs.promises.readFile).toHaveBeenCalledWith('/mock/path/home/.ssh/id_rsa');
      expect(result).toEqual({
        success: false,
        error: 'Failed to read private key: Permission denied'
      });
    });
  });

  describe('save-profiles error boundaries', () => {
    it('should throw error when unlinking PROFILES_ENC_PATH fails with non-ENOENT', async () => {
      const handler = handlers['save-profiles'];
      expect(handler).toBeDefined();

      vi.mocked(fs.promises.writeFile).mockResolvedValueOnce(undefined);
      vi.mocked(fs.promises.rename).mockResolvedValueOnce(undefined);

      const mockError = new Error('EACCES: permission denied');
      (mockError as any).code = 'EACCES';
      vi.mocked(fs.promises.unlink).mockRejectedValueOnce(mockError);

      await expect(
        handler(null, { masterPassword: '', payload: {} })
      ).rejects.toThrow('EACCES: permission denied');

      expect(fs.promises.unlink).toHaveBeenCalledWith('/mock/path/userData/profiles.enc');
    });

    it('should not throw error when unlinking PROFILES_ENC_PATH fails with ENOENT', async () => {
      const handler = handlers['save-profiles'];
      expect(handler).toBeDefined();

      vi.mocked(fs.promises.writeFile).mockResolvedValueOnce(undefined);
      vi.mocked(fs.promises.rename).mockResolvedValueOnce(undefined);

      const mockError = new Error('ENOENT: no such file');
      (mockError as any).code = 'ENOENT';
      vi.mocked(fs.promises.unlink).mockRejectedValueOnce(mockError);

      const result = await handler(null, { masterPassword: '', payload: {} });
      expect(result).toBe(true);
    });
  });
});
