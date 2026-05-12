// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { connectionManager } from '../services/ConnectionManager';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    default: {
      ...actual.default,
      existsSync: vi.fn(),
      unlinkSync: vi.fn(),
      promises: {
        ...actual.default.promises,
        unlink: vi.fn(),
      }
    },
    existsSync: vi.fn(),
    unlinkSync: vi.fn(),
    promises: {
      unlink: vi.fn(),
    }
  };
});

vi.mock('electron', () => ({
  powerSaveBlocker: {
    start: vi.fn().mockReturnValue(1),
    stop: vi.fn(),
  },
}));

describe('ConnectionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionManager.sessions.clear();
    connectionManager.activeSftpWatchers = {};
    connectionManager.sessionCounter = 0;
    connectionManager.powerSaveBlockerId = null;
  });

  it('should cleanup SFTP watchers for a session', async () => {
    const sessionId = 'req-1';
    const mockWatcher = { close: vi.fn() };
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

  it('should handle errors during cleanup', async () => {
    const sessionId = 'req-1';
    const mockWatcher = { close: vi.fn() };
    const tempPath = '/tmp/test-file';

    connectionManager.activeSftpWatchers[`${sessionId}_file1`] = {
      watcher: mockWatcher as any,
      tempPath,
    };

    vi.mocked(fs.promises.unlink).mockRejectedValue(new Error('Unlink failed'));

    // Should not throw
    await connectionManager.cleanupSessionSftpWatchers(sessionId);

    expect(mockWatcher.close).toHaveBeenCalled();
    expect(connectionManager.activeSftpWatchers).not.toHaveProperty(`${sessionId}_file1`);
  });

  it('should ignore ENOENT errors during cleanup', async () => {
    const sessionId = 'req-1';
    const mockWatcher = { close: vi.fn() };
    const tempPath = '/tmp/test-file';

    connectionManager.activeSftpWatchers[`${sessionId}_file1`] = {
      watcher: mockWatcher as any,
      tempPath,
    };

    const error: any = new Error('File not found');
    error.code = 'ENOENT';
    vi.mocked(fs.promises.unlink).mockRejectedValue(error);

    // Should not throw and should not log error (implicitly checked by lack of crash)
    await connectionManager.cleanupSessionSftpWatchers(sessionId);

    expect(mockWatcher.close).toHaveBeenCalled();
    expect(connectionManager.activeSftpWatchers).not.toHaveProperty(`${sessionId}_file1`);
  });
});
