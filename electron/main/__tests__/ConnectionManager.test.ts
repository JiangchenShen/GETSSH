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

  describe('cleanupSessionSftpWatchers', () => {
    let mockWatcher: any;

    beforeEach(() => {
      mockWatcher = {
        close: vi.fn(),
      };

      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should cleanup watchers for a specific sessionId', () => {
      connectionManager.activeSftpWatchers = {
        'req-1_path1': { watcher: mockWatcher, tempPath: '/tmp/file1' },
        'req-1_path2': { watcher: mockWatcher, tempPath: '/tmp/file2' },
        'req-2_path1': { watcher: mockWatcher, tempPath: '/tmp/file3' },
      };

      vi.mocked(fs.existsSync).mockImplementation((path) => path === '/tmp/file1');

      connectionManager.cleanupSessionSftpWatchers('req-1');

      // Watcher 1
      expect(mockWatcher.close).toHaveBeenCalledTimes(2);
      expect(fs.existsSync).toHaveBeenCalledWith('/tmp/file1');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/file1');

      // Watcher 2
      expect(fs.existsSync).toHaveBeenCalledWith('/tmp/file2');
      expect(fs.unlinkSync).not.toHaveBeenCalledWith('/tmp/file2');

      // Remaining watchers
      expect(Object.keys(connectionManager.activeSftpWatchers)).toEqual(['req-2_path1']);
    });

    it('should catch and log errors during cleanup without crashing', () => {
      connectionManager.activeSftpWatchers = {
        'req-1_path1': { watcher: mockWatcher, tempPath: '/tmp/file1' },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      const error = new Error('unlink failed');
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw error;
      });

      connectionManager.cleanupSessionSftpWatchers('req-1');

      expect(mockWatcher.close).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('[SFTP Sync] Cleanup failed', error);

      // Still deleted from the record
      expect(Object.keys(connectionManager.activeSftpWatchers)).toEqual([]);
    });
  });

  describe('removeSession', () => {
    it('should delete the session, cleanup watchers, and update powerSaveBlocker', () => {
      connectionManager.sessions.set('req-1', {} as SessionData);
      connectionManager.powerSaveBlockerId = 123;

      vi.spyOn(connectionManager, 'cleanupSessionSftpWatchers');
      vi.spyOn(connectionManager, 'updatePowerSaveBlocker');

      connectionManager.removeSession('req-1');

      expect(connectionManager.sessions.has('req-1')).toBe(false);
      expect(connectionManager.cleanupSessionSftpWatchers).toHaveBeenCalledWith('req-1');
      expect(connectionManager.updatePowerSaveBlocker).toHaveBeenCalled();

      // updatePowerSaveBlocker should have noticed sessions is empty and stopped it
      expect(powerSaveBlocker.stop).toHaveBeenCalledWith(123);
      expect(connectionManager.powerSaveBlockerId).toBeNull();
    });
  });
});
