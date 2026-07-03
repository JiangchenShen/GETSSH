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
  activeSftpWatchers: Record<string, { watcher: fs.FSWatcher, tempPath: string }> = {};

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

  async cleanupSessionSftpWatchers(sessionId: string) {
    const cleanupPromises = [];

    for (const [watchId, active] of Object.entries(this.activeSftpWatchers)) {
      if (watchId.startsWith(`${sessionId}_`)) {
        active.watcher.close();

        const cleanup = (async () => {
          try {
            await fs.promises.unlink(active.tempPath);
          } catch (e: any) {
            if (e.code !== 'ENOENT') {
              console.error('[SFTP Sync] Cleanup failed', e);
            }
          }
        })();

        cleanupPromises.push(cleanup);
        delete this.activeSftpWatchers[watchId];
      }
    }

    await Promise.all(cleanupPromises);
  }

  async removeSession(sessionId: string) {
    this.sessions.delete(sessionId);
    await this.cleanupSessionSftpWatchers(sessionId);
    this.updatePowerSaveBlocker();
  }
}

export const connectionManager = new ConnectionManager();
