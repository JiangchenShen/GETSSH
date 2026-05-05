import { Client, ClientChannel, SFTPWrapper } from 'ssh2';
import fs from 'node:fs';
import { powerSaveBlocker } from 'electron';

export interface SessionData {
  client: Client;
  stream: ClientChannel | null;
  sftp?: SFTPWrapper;
}

class ConnectionManager {
  sessions = new Map<string, SessionData>();
  sessionCounter = 0;
  powerSaveBlockerId: number | null = null;
  activeSftpWatchers: Record<string, { watcher: fs.FSWatcher, tempPath: string }> = {};

  generateSessionId() {
    return `req-${++this.sessionCounter}`;
  }

  updatePowerSaveBlocker() {
    if (this.sessions.size > 0 && this.powerSaveBlockerId === null) {
      this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    } else if (this.sessions.size === 0 && this.powerSaveBlockerId !== null) {
      powerSaveBlocker.stop(this.powerSaveBlockerId);
      this.powerSaveBlockerId = null;
    }
  }

  cleanupSessionSftpWatchers(sessionId: string) {
    for (const [watchId, active] of Object.entries(this.activeSftpWatchers)) {
      if (watchId.startsWith(`${sessionId}_`)) {
        active.watcher.close();
        try {
          if (fs.existsSync(active.tempPath)) fs.unlinkSync(active.tempPath);
        } catch (e) {
          console.error('[SFTP Sync] Cleanup failed', e);
        }
        delete this.activeSftpWatchers[watchId];
      }
    }
  }

  removeSession(sessionId: string) {
    this.sessions.delete(sessionId);
    this.cleanupSessionSftpWatchers(sessionId);
    this.updatePowerSaveBlocker();
  }
}

export const connectionManager = new ConnectionManager();
