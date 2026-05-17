import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionManager, SessionData } from '../services/ConnectionManager';
import { powerSaveBlocker } from 'electron';
import fs from 'node:fs';

vi.mock('electron', () => ({
  powerSaveBlocker: {
    start: vi.fn().mockReturnValue(123),
    stop: vi.fn(),
  },
}));

// Mock fs with async unlink (Jules' async optimization)
vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      promises: {
        ...actual.default.promises,
        unlink: vi.fn(),
      },
    },
    promises: {
      unlink: vi.fn(),
    },
  };
});

describe('ConnectionManager', () => {
  let connectionManager: ConnectionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    connectionManager = new ConnectionManager();
  });

  describe('generateSessionId', () => {
    it('should generate incrementing session IDs', () => {
      expect(connectionManager.generateSessionId()).toBe('req-1');
      expect(connectionManager.generateSessionId()).toBe('req-2');
      expect(connectionManager.generateSessionId()).toBe('req-3');
    });
  });

  describe('updatePowerSaveBlocker', () => {
    it('should start powerSaveBlocker when there are sessions and blocker is null', () => {
      connectionManager.sessions.set('req-1', {} as SessionData);
      connectionManager.updatePowerSaveBlocker();

      expect(powerSaveBlocker.start).toHaveBeenCalledWith('prevent-app-suspension');
      expect(connectionManager.powerSaveBlockerId).toBe(123);
    });

    it('should stop powerSaveBlocker when there are no sessions and blocker is not null', () => {
      connectionManager.powerSaveBlockerId = 123;
      connectionManager.updatePowerSaveBlocker();

      expect(powerSaveBlocker.stop).toHaveBeenCalledWith(123);
      expect(connectionManager.powerSaveBlockerId).toBeNull();
    });

    it('should do nothing if sessions > 0 and blocker is already active', () => {
      connectionManager.sessions.set('req-1', {} as SessionData);
      connectionManager.powerSaveBlockerId = 123;
      connectionManager.updatePowerSaveBlocker();

      expect(powerSaveBlocker.start).not.toHaveBeenCalled();
      expect(powerSaveBlocker.stop).not.toHaveBeenCalled();
    });

    it('should do nothing if sessions === 0 and blocker is null', () => {
      connectionManager.updatePowerSaveBlocker();

      expect(powerSaveBlocker.start).not.toHaveBeenCalled();
      expect(powerSaveBlocker.stop).not.toHaveBeenCalled();
    });
  });

  // Jules' async cleanup tests (PR #77) — replaces old sync existsSync/unlinkSync pattern
  describe('cleanupSessionSftpWatchers', () => {
    let mockWatcher: any;

    beforeEach(() => {
      mockWatcher = { close: vi.fn() };
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should cleanup SFTP watchers for a session using async unlink', async () => {
      const sessionId = 'req-1';
      const tempPath = '/tmp/test-file';

      connectionManager.activeSftpWatchers[`${sessionId}_file1`] = {
        watcher: mockWatcher as any,
        tempPath,
      };

      vi.mocked(fs.promises.unlink).mockResolvedValue(undefined);

      await connectionManager.cleanupSessionSftpWatchers(sessionId);

      expect(mockWatcher.close).toHaveBeenCalled();
      expect(fs.promises.unlink).toHaveBeenCalledWith(tempPath);
      expect(connectionManager.activeSftpWatchers).not.toHaveProperty(`${sessionId}_file1`);
    });

    it('should cleanup watchers for a specific sessionId and leave others intact', async () => {
      connectionManager.activeSftpWatchers = {
        'req-1_path1': { watcher: mockWatcher, tempPath: '/tmp/file1' },
        'req-1_path2': { watcher: mockWatcher, tempPath: '/tmp/file2' },
        'req-2_path1': { watcher: mockWatcher, tempPath: '/tmp/file3' },
      };

      vi.mocked(fs.promises.unlink).mockResolvedValue(undefined);

      await connectionManager.cleanupSessionSftpWatchers('req-1');

      expect(mockWatcher.close).toHaveBeenCalledTimes(2);
      expect(fs.promises.unlink).toHaveBeenCalledWith('/tmp/file1');
      expect(fs.promises.unlink).toHaveBeenCalledWith('/tmp/file2');
      expect(Object.keys(connectionManager.activeSftpWatchers)).toEqual(['req-2_path1']);
    });

    it('should handle non-ENOENT errors during cleanup and log them', async () => {
      connectionManager.activeSftpWatchers = {
        'req-1_path1': { watcher: mockWatcher, tempPath: '/tmp/file1' },
      };

      const error = new Error('Unlink failed');
      vi.mocked(fs.promises.unlink).mockRejectedValue(error);

      // Should not throw
      await connectionManager.cleanupSessionSftpWatchers('req-1');

      expect(mockWatcher.close).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('[SFTP Sync] Cleanup failed', error);
      expect(connectionManager.activeSftpWatchers).not.toHaveProperty('req-1_path1');
    });

    it('should silently ignore ENOENT errors during cleanup', async () => {
      connectionManager.activeSftpWatchers = {
        'req-1_path1': { watcher: mockWatcher, tempPath: '/tmp/file1' },
      };

      const error: any = new Error('File not found');
      error.code = 'ENOENT';
      vi.mocked(fs.promises.unlink).mockRejectedValue(error);

      await connectionManager.cleanupSessionSftpWatchers('req-1');

      expect(mockWatcher.close).toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
      expect(connectionManager.activeSftpWatchers).not.toHaveProperty('req-1_path1');
    });
  });

  describe('removeSession', () => {
    it('should delete the session, cleanup watchers, and update powerSaveBlocker', async () => {
      connectionManager.sessions.set('req-1', {} as SessionData);
      connectionManager.powerSaveBlockerId = 123;

      vi.spyOn(connectionManager, 'cleanupSessionSftpWatchers').mockResolvedValue(undefined);
      vi.spyOn(connectionManager, 'updatePowerSaveBlocker');

      await connectionManager.removeSession('req-1');

      expect(connectionManager.sessions.has('req-1')).toBe(false);
      expect(connectionManager.cleanupSessionSftpWatchers).toHaveBeenCalledWith('req-1');
      expect(connectionManager.updatePowerSaveBlocker).toHaveBeenCalled();
    });
  });
});
