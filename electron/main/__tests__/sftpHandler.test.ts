import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerSftpHandlers } from '../handlers/sftpHandler';
import { connectionManager } from '../services/ConnectionManager';
import { shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';

vi.mock('electron', () => ({
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  powerSaveBlocker: {
    start: vi.fn(),
    stop: vi.fn(),
  }
}));

vi.mock('node:fs', () => {
  return {
    default: {
      watch: vi.fn(),
      existsSync: vi.fn(),
      unlinkSync: vi.fn(),
      constants: {
        F_OK: 0,
      },
      promises: {
        access: vi.fn(),
        unlink: vi.fn(),
      }
    }
  };
});

vi.mock('node:os', () => ({
  default: {
    tmpdir: vi.fn().mockReturnValue('/tmp'),
  }
}));

vi.mock('../services/ConnectionManager', () => {
  return {
    connectionManager: {
      sessions: new Map(),
      activeSftpWatchers: {} as Record<string, any>,
    }
  };
});

describe('sftpHandler', () => {
  let handlers: Record<string, Function>;

  beforeEach(() => {
    handlers = {};
    const ipcMain = {
      handle: vi.fn((channel, handler) => {
        handlers[channel] = handler;
      }),
    };
    registerSftpHandlers(ipcMain as any);
    vi.clearAllMocks();
    connectionManager.sessions.clear();
    connectionManager.activeSftpWatchers = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('sftp-list', () => {
    it('returns error for invalid path', async () => {
      const result = await handlers['sftp-list']({} as any, 'session-id', 123 as any);
      expect(result).toEqual({ success: false, error: 'Invalid path' });
    });

    it('returns error if session or sftp not available', async () => {
      const result = await handlers['sftp-list']({} as any, 'session-id', '/path');
      expect(result).toEqual({ success: false, error: 'SFTP not available' });
    });

    it('returns error if readdir fails', async () => {
      const sftpMock = {
        readdir: vi.fn((path, cb) => cb(new Error('readdir error'), null)),
      };
      connectionManager.sessions.set('session-id', { sftp: sftpMock } as any);
      const result = await handlers['sftp-list']({} as any, 'session-id', '/path');
      expect(result).toEqual({ success: false, error: 'readdir error' });
    });

    it('returns list of mapped files on success', async () => {
      const listData = [
        { filename: 'dir1', longname: 'drwxr-xr-x 2 root root 4096 Jan 1', attrs: { size: 4096, mtime: 1000 } },
        { filename: 'file1', longname: '-rw-r--r-- 1 root root 1024 Jan 1', attrs: { size: 1024, mtime: 2000 } },
        { filename: 'symlink1', longname: 'lrwxrwxrwx 1 root root 4 Jan 1', attrs: { size: 4, mtime: 3000 } },
        { filename: 'dir2', attrs: { mode: 0o40000 | 0o0755, size: 4096, mtime: 4000 } },
        { filename: 'symlink2', attrs: { mode: 0o120000 | 0o0777, size: 4, mtime: 5000 } },
      ];
      const sftpMock = {
        readdir: vi.fn((path, cb) => cb(null, listData)),
      };
      connectionManager.sessions.set('session-id', { sftp: sftpMock } as any);
      const result = await handlers['sftp-list']({} as any, 'session-id', '/path');
      expect(result.success).toBe(true);
      expect(result.list).toEqual([
        { name: 'dir1', longname: 'drwxr-xr-x 2 root root 4096 Jan 1', type: 'd', size: 4096, mtime: 1000 },
        { name: 'file1', longname: '-rw-r--r-- 1 root root 1024 Jan 1', type: '-', size: 1024, mtime: 2000 },
        { name: 'symlink1', longname: 'lrwxrwxrwx 1 root root 4 Jan 1', type: 'l', size: 4, mtime: 3000 },
        { name: 'dir2', longname: undefined, type: 'd', size: 4096, mtime: 4000 },
        { name: 'symlink2', longname: undefined, type: 'l', size: 4, mtime: 5000 },
      ]);
    });
  });

  describe('sftp-mkdir', () => {
    it('returns error for invalid path', async () => {
      const result = await handlers['sftp-mkdir']({} as any, 'session-id', null as any);
      expect(result).toEqual({ success: false, error: 'Invalid path' });
    });

    it('returns error if session or sftp not available', async () => {
      const result = await handlers['sftp-mkdir']({} as any, 'session-id', '/path');
      expect(result).toEqual({ success: false, error: 'SFTP not available' });
    });

    it('returns error if mkdir fails', async () => {
      const sftpMock = {
        mkdir: vi.fn((path, cb) => cb(new Error('mkdir error'))),
      };
      connectionManager.sessions.set('session-id', { sftp: sftpMock } as any);
      const result = await handlers['sftp-mkdir']({} as any, 'session-id', '/path');
      expect(result).toEqual({ success: false, error: 'mkdir error' });
    });

    it('returns success when mkdir completes', async () => {
      const sftpMock = {
        mkdir: vi.fn((path, cb) => cb(null)),
      };
      connectionManager.sessions.set('session-id', { sftp: sftpMock } as any);
      const result = await handlers['sftp-mkdir']({} as any, 'session-id', '/path');
      expect(result).toEqual({ success: true });
      expect(sftpMock.mkdir).toHaveBeenCalledWith('/path', expect.any(Function));
    });
  });

  describe('sftp-delete', () => {
    it('returns error for invalid path', async () => {
      const result = await handlers['sftp-delete']({} as any, 'session-id', undefined as any, false);
      expect(result).toEqual({ success: false, error: 'Invalid path' });
    });

    it('returns error if session or sftp not available', async () => {
      const result = await handlers['sftp-delete']({} as any, 'session-id', '/path', false);
      expect(result).toEqual({ success: false, error: 'SFTP not available' });
    });

    it('calls rmdir and returns error if fails', async () => {
      const sftpMock = {
        rmdir: vi.fn((path, cb) => cb(new Error('rmdir error'))),
      };
      connectionManager.sessions.set('session-id', { sftp: sftpMock } as any);
      const result = await handlers['sftp-delete']({} as any, 'session-id', '/path', true);
      expect(result).toEqual({ success: false, error: 'rmdir error' });
      expect(sftpMock.rmdir).toHaveBeenCalledWith('/path', expect.any(Function));
    });

    it('calls rmdir and returns success when completes', async () => {
      const sftpMock = {
        rmdir: vi.fn((path, cb) => cb(null)),
      };
      connectionManager.sessions.set('session-id', { sftp: sftpMock } as any);
      const result = await handlers['sftp-delete']({} as any, 'session-id', '/path', true);
      expect(result).toEqual({ success: true });
      expect(sftpMock.rmdir).toHaveBeenCalledWith('/path', expect.any(Function));
    });

    it('calls unlink and returns error if fails', async () => {
      const sftpMock = {
        unlink: vi.fn((path, cb) => cb(new Error('unlink error'))),
      };
      connectionManager.sessions.set('session-id', { sftp: sftpMock } as any);
      const result = await handlers['sftp-delete']({} as any, 'session-id', '/path', false);
      expect(result).toEqual({ success: false, error: 'unlink error' });
      expect(sftpMock.unlink).toHaveBeenCalledWith('/path', expect.any(Function));
    });

    it('calls unlink and returns success when completes', async () => {
      const sftpMock = {
        unlink: vi.fn((path, cb) => cb(null)),
      };
      connectionManager.sessions.set('session-id', { sftp: sftpMock } as any);
      const result = await handlers['sftp-delete']({} as any, 'session-id', '/path', false);
      expect(result).toEqual({ success: true });
      expect(sftpMock.unlink).toHaveBeenCalledWith('/path', expect.any(Function));
    });
  });

  describe('sftp-read-file', () => {
    it('returns error for invalid path', async () => {
      const result = await handlers['sftp-read-file']({} as any, 'session-id', null as any);
      expect(result).toEqual({ success: false, error: 'Invalid path' });
    });

    it('returns error if session or sftp not available', async () => {
      const result = await handlers['sftp-read-file']({} as any, 'session-id', '/path');
      expect(result).toEqual({ success: false, error: 'SFTP not available' });
    });

    it('returns error if readFile fails', async () => {
      const sftpMock = {
        readFile: vi.fn((path, encoding, cb) => cb(new Error('read error'), null)),
      };
      connectionManager.sessions.set('session-id', { sftp: sftpMock } as any);
      const result = await handlers['sftp-read-file']({} as any, 'session-id', '/path');
      expect(result).toEqual({ success: false, error: 'read error' });
      expect(sftpMock.readFile).toHaveBeenCalledWith('/path', 'utf8', expect.any(Function));
    });

    it('returns success and data when readFile completes', async () => {
      const sftpMock = {
        readFile: vi.fn((path, encoding, cb) => cb(null, 'file content')),
      };
      connectionManager.sessions.set('session-id', { sftp: sftpMock } as any);
      const result = await handlers['sftp-read-file']({} as any, 'session-id', '/path');
      expect(result).toEqual({ success: true, data: 'file content' });
      expect(sftpMock.readFile).toHaveBeenCalledWith('/path', 'utf8', expect.any(Function));
    });
  });

  describe('sftp-write-file', () => {
    it('returns error for invalid path', async () => {
      const result = await handlers['sftp-write-file']({} as any, 'session-id', null as any, 'data');
      expect(result).toEqual({ success: false, error: 'Invalid path' });
    });

    it('returns error if session or sftp not available', async () => {
      const result = await handlers['sftp-write-file']({} as any, 'session-id', '/path', 'data');
      expect(result).toEqual({ success: false, error: 'SFTP not available' });
    });

    it('returns error if writeFile fails', async () => {
      const sftpMock = {
        writeFile: vi.fn((path, data, encoding, cb) => cb(new Error('write error'))),
      };
      connectionManager.sessions.set('session-id', { sftp: sftpMock } as any);
      const result = await handlers['sftp-write-file']({} as any, 'session-id', '/path', 'data');
      expect(result).toEqual({ success: false, error: 'write error' });
      expect(sftpMock.writeFile).toHaveBeenCalledWith('/path', 'data', 'utf8', expect.any(Function));
    });

    it('returns success when writeFile completes', async () => {
      const sftpMock = {
        writeFile: vi.fn((path, data, encoding, cb) => cb(null)),
      };
      connectionManager.sessions.set('session-id', { sftp: sftpMock } as any);
      const result = await handlers['sftp-write-file']({} as any, 'session-id', '/path', 'data');
      expect(result).toEqual({ success: true });
      expect(sftpMock.writeFile).toHaveBeenCalledWith('/path', 'data', 'utf8', expect.any(Function));
    });
  });

  describe('sftp-edit-sync', () => {
    it('throws error if session or sftp not available', async () => {
      await expect(handlers['sftp-edit-sync']({} as any, 'session-id', '/path')).rejects.toThrow('SFTP session not available');
    });

    it('successfully initiates sync and sets up watcher', async () => {
      vi.useFakeTimers();
      const sftpMock = {
        fastGet: vi.fn((remotePath, tempPath, cb) => cb(null)),
        fastPut: vi.fn((tempPath, remotePath, cb) => cb(null)),
      };
      connectionManager.sessions.set('session-id', { sftp: sftpMock } as any);

      const watcherMock = { close: vi.fn() };
      let watchCallback: Function;
      (fs.watch as any).mockImplementation((path: string, cb: Function) => {
        watchCallback = cb;
        return watcherMock;
      });

      const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(12345);

      const result = await handlers['sftp-edit-sync']({} as any, 'session-id', '/remote/file.txt');

      expect(sftpMock.fastGet).toHaveBeenCalledWith('/remote/file.txt', expect.stringContaining('/tmp/getssh_sync_12345_file.txt'), expect.any(Function));
      expect(shell.showItemInFolder).toHaveBeenCalledWith(expect.stringContaining('/tmp/getssh_sync_12345_file.txt'));
      expect(fs.watch).toHaveBeenCalledWith(expect.stringContaining('/tmp/getssh_sync_12345_file.txt'), expect.any(Function));

      const watchId = 'session-id_/remote/file.txt';
      expect(result).toEqual({ success: true, watchId });
      expect(connectionManager.activeSftpWatchers[watchId]).toBeDefined();
      expect(connectionManager.activeSftpWatchers[watchId].watcher).toBe(watcherMock);

      // Trigger change
      watchCallback!('change');
      // fastPut should be called after timeout
      vi.advanceTimersByTime(1000);
      expect(sftpMock.fastPut).toHaveBeenCalledWith(expect.stringContaining('/tmp/getssh_sync_12345_file.txt'), '/remote/file.txt', expect.any(Function));

      dateNowSpy.mockRestore();
    });

    it('rejects if fastGet fails', async () => {
      const sftpMock = {
        fastGet: vi.fn((remotePath, tempPath, cb) => cb(new Error('fastGet error'))),
      };
      connectionManager.sessions.set('session-id', { sftp: sftpMock } as any);
      await expect(handlers['sftp-edit-sync']({} as any, 'session-id', '/remote/file.txt')).rejects.toThrow('fastGet error');
    });
  });

  describe('sftp-edit-stop', () => {
    it('returns success if watchId not active', async () => {
      const result = await handlers['sftp-edit-stop']({} as any, 'unknown-watch-id');
      expect(result).toEqual({ success: true });
    });

    it('cleans up and removes watcher if active', async () => {
      const watcherMock = { close: vi.fn() };
      connectionManager.activeSftpWatchers['watch-id'] = {
        watcher: watcherMock,
        tempPath: '/tmp/file.txt',
      };

      (fs.promises.access as any).mockResolvedValue(undefined);
      (fs.promises.unlink as any).mockResolvedValue(undefined);

      const result = await handlers['sftp-edit-stop']({} as any, 'watch-id');

      expect(watcherMock.close).toHaveBeenCalled();
      expect(fs.promises.access).toHaveBeenCalledWith('/tmp/file.txt', 0);
      expect(fs.promises.unlink).toHaveBeenCalledWith('/tmp/file.txt');
      expect(connectionManager.activeSftpWatchers['watch-id']).toBeUndefined();
      expect(result).toEqual({ success: true });
    });

    it('handles cleanup failure gracefully', async () => {
      const watcherMock = { close: vi.fn() };
      connectionManager.activeSftpWatchers['watch-id'] = {
        watcher: watcherMock,
        tempPath: '/tmp/file.txt',
      };

      (fs.promises.access as any).mockResolvedValue(undefined);
      (fs.promises.unlink as any).mockRejectedValue(new Error('unlink failed'));

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await handlers['sftp-edit-stop']({} as any, 'watch-id');

      expect(watcherMock.close).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith('[SFTP Sync] Cleanup failed', expect.any(Error));
      expect(connectionManager.activeSftpWatchers['watch-id']).toBeUndefined();
      expect(result).toEqual({ success: true });

      consoleErrorSpy.mockRestore();
    });
  });
});
