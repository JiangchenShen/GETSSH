import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionManager } from './ConnectionManager';
import { powerSaveBlocker } from 'electron';
import fs from 'node:fs';

vi.mock('electron', () => ({
  powerSaveBlocker: {
    start: vi.fn().mockReturnValue(123),
    stop: vi.fn(),
  },
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

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
    it('should start power save blocker when there are active sessions', () => {
      connectionManager.sessions.set('session-1', {} as any);
      connectionManager.updatePowerSaveBlocker();

      expect(powerSaveBlocker.start).toHaveBeenCalledWith('prevent-app-suspension');
      expect(connectionManager.powerSaveBlockerId).toBe(123);
    });

    it('should not start power save blocker if it is already started', () => {
      connectionManager.sessions.set('session-1', {} as any);
      connectionManager.powerSaveBlockerId = 123;
      connectionManager.updatePowerSaveBlocker();

      expect(powerSaveBlocker.start).not.toHaveBeenCalled();
    });

    it('should stop power save blocker when there are no active sessions', () => {
      connectionManager.powerSaveBlockerId = 123;
      // sessions is empty by default
      connectionManager.updatePowerSaveBlocker();

      expect(powerSaveBlocker.stop).toHaveBeenCalledWith(123);
      expect(connectionManager.powerSaveBlockerId).toBeNull();
    });

    it('should not stop power save blocker if it is not started', () => {
      connectionManager.powerSaveBlockerId = null;
      connectionManager.updatePowerSaveBlocker();

      expect(powerSaveBlocker.stop).not.toHaveBeenCalled();
    });
  });

  describe('cleanupSessionSftpWatchers', () => {
    it('should close watchers and unlink temp files for the given session', () => {
      const mockWatcher = { close: vi.fn() };
      connectionManager.activeSftpWatchers = {
        'session1_file1': { watcher: mockWatcher as any, tempPath: '/tmp/file1' },
        'session1_file2': { watcher: mockWatcher as any, tempPath: '/tmp/file2' },
        'session2_file1': { watcher: mockWatcher as any, tempPath: '/tmp/file3' },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);

      connectionManager.cleanupSessionSftpWatchers('session1');

      expect(mockWatcher.close).toHaveBeenCalledTimes(2);
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/file1');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/file2');
      expect(connectionManager.activeSftpWatchers).toHaveProperty('session2_file1');
      expect(connectionManager.activeSftpWatchers).not.toHaveProperty('session1_file1');
      expect(connectionManager.activeSftpWatchers).not.toHaveProperty('session1_file2');
    });

    it('should handle errors during file unlinking gracefully', () => {
        const mockWatcher = { close: vi.fn() };
        connectionManager.activeSftpWatchers = {
          'session1_file1': { watcher: mockWatcher as any, tempPath: '/tmp/file1' },
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.unlinkSync).mockImplementation(() => {
          throw new Error('Unlink failed');
        });

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        connectionManager.cleanupSessionSftpWatchers('session1');

        expect(mockWatcher.close).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith('[SFTP Sync] Cleanup failed', expect.any(Error));
        expect(connectionManager.activeSftpWatchers).not.toHaveProperty('session1_file1');

        consoleSpy.mockRestore();
      });
  });

  describe('removeSession', () => {
    it('should remove session and trigger cleanup and power save blocker update', () => {
      const cleanupSpy = vi.spyOn(connectionManager, 'cleanupSessionSftpWatchers');
      const updateBlockerSpy = vi.spyOn(connectionManager, 'updatePowerSaveBlocker');

      connectionManager.sessions.set('session-1', {} as any);

      connectionManager.removeSession('session-1');

      expect(connectionManager.sessions.has('session-1')).toBe(false);
      expect(cleanupSpy).toHaveBeenCalledWith('session-1');
      expect(updateBlockerSpy).toHaveBeenCalled();
    });
  });
});
