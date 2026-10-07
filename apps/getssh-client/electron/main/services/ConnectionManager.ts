import { Client, ClientChannel, SFTPWrapper } from 'ssh2';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { powerSaveBlocker } from 'electron';

export interface SessionData {
  client: Client;
  stream: ClientChannel | null;
  sftp?: SFTPWrapper;
}

export class ConnectionManager {
  sessions = new Map<string, SessionData>();
  powerSaveBlockerId: number | null = null;
  activeSftpWatchers: Record<string, { watcher: fs.FSWatcher, tempPath: string, dispose?: () => void }> = {};

  generateSessionId() {
    // [M-12] Security Fix: Use cryptographically secure random UUIDs instead of predictable incremental integers
    return crypto.randomUUID();
  }

  updatePowerSaveBlocker() {
    if (this.sessions.size > 0 && this.powerSaveBlockerId === null) {
      this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    } else if (this.sessions.size === 0 && this.powerSaveBlockerId !== null) {
      powerSaveBlocker.stop(this.powerSaveBlockerId);
      this.powerSaveBlockerId = null;
    }
  }

  /** Stops an SFTP edit sync: its file watcher, a pending upload, and its temp directory. */
  async stopSftpWatcher(watchId: string) {
    const active = this.activeSftpWatchers[watchId];
    if (!active) return;
    delete this.activeSftpWatchers[watchId];
    active.watcher.close();
    active.dispose?.();
    try {
      // tempPath is the per-edit temp directory holding the downloaded file.
      await fs.promises.rm(active.tempPath, { recursive: true, force: true });
    } catch (e: any) {
      console.error('[SFTP Sync] Cleanup failed', e);
    }
  }

  async cleanupSessionSftpWatchers(sessionId: string) {
    const ids = Object.keys(this.activeSftpWatchers).filter(watchId => watchId.startsWith(`${sessionId}_`));
    await Promise.all(ids.map(watchId => this.stopSftpWatcher(watchId)));
  }

  async removeSession(sessionId: string) {
    this.sessions.delete(sessionId);
    await this.cleanupSessionSftpWatchers(sessionId);
    this.updatePowerSaveBlocker();
  }
}

export const connectionManager = new ConnectionManager();
