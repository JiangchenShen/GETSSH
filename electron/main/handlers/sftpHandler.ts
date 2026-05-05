import { shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { connectionManager } from '../services/ConnectionManager';

function normalizeRemotePath(p: string): string | null {
  if (typeof p !== 'string') return null;
  return require('node:path').posix.normalize(p);
}

export function registerSftpHandlers(ipcMain: Electron.IpcMain) {
  ipcMain.handle('sftp-list', (event, sessionId: string, remotePath: string) => {
    return new Promise((resolve) => {
      remotePath = normalizeRemotePath(remotePath) as string;
      if (!remotePath) return resolve({ success: false, error: 'Invalid path' });
      const session = connectionManager.sessions.get(sessionId);
      if (!session || !session.sftp) return resolve({ success: false, error: 'SFTP not available' });
      session.sftp.readdir(remotePath, (err: any, list: any[]) => {
        if (err) return resolve({ success: false, error: err.message });
        resolve({ 
           success: true, 
           list: list.map(item => {
             let itemType: 'd' | '-' | 'l' = '-';
             if (item.longname && item.longname.startsWith('d')) itemType = 'd';
             else if (item.longname && item.longname.startsWith('l')) itemType = 'l';
             else if (item.attrs && typeof item.attrs.mode === 'number') {
               if ((item.attrs.mode & 0o40000) === 0o40000) itemType = 'd';
               else if ((item.attrs.mode & 0o120000) === 0o120000) itemType = 'l';
             }
             return {
               name: item.filename,
               longname: item.longname,
               type: itemType,
               size: item.attrs?.size || 0,
               mtime: item.attrs?.mtime || 0
             };
           })
        });
      });
    });
  });

  ipcMain.handle('sftp-mkdir', (event, sessionId: string, remotePath: string) => {
    return new Promise((resolve) => {
      remotePath = normalizeRemotePath(remotePath) as string;
      if (!remotePath) return resolve({ success: false, error: 'Invalid path' });
      const session = connectionManager.sessions.get(sessionId);
      if (!session || !session.sftp) return resolve({ success: false, error: 'SFTP not available' });
      session.sftp.mkdir(remotePath, (err: any) => {
        if (err) return resolve({ success: false, error: err.message });
        resolve({ success: true });
      });
    });
  });

  ipcMain.handle('sftp-delete', (event, sessionId: string, remotePath: string, isDir: boolean) => {
    return new Promise((resolve) => {
      remotePath = normalizeRemotePath(remotePath) as string;
      if (!remotePath) return resolve({ success: false, error: 'Invalid path' });
      const session = connectionManager.sessions.get(sessionId);
      if (!session || !session.sftp) return resolve({ success: false, error: 'SFTP not available' });
      if (isDir) {
         session.sftp.rmdir(remotePath, (err: any) => {
           if (err) return resolve({ success: false, error: err.message });
           resolve({ success: true });
         });
      } else {
         session.sftp.unlink(remotePath, (err: any) => {
           if (err) return resolve({ success: false, error: err.message });
           resolve({ success: true });
         });
      }
    });
  });

  ipcMain.handle('sftp-read-file', (event, sessionId: string, remotePath: string) => {
    return new Promise((resolve) => {
      remotePath = normalizeRemotePath(remotePath) as string;
      if (!remotePath) return resolve({ success: false, error: 'Invalid path' });
      const session = connectionManager.sessions.get(sessionId);
      if (!session || !session.sftp) return resolve({ success: false, error: 'SFTP not available' });
      session.sftp.readFile(remotePath, 'utf8', (err: any, data: any) => {
         if (err) return resolve({ success: false, error: err.message });
         resolve({ success: true, data });
      });
    });
  });

  ipcMain.handle('sftp-write-file', (event, sessionId: string, remotePath: string, data: string) => {
    return new Promise((resolve) => {
      remotePath = normalizeRemotePath(remotePath) as string;
      if (!remotePath) return resolve({ success: false, error: 'Invalid path' });
      const session = connectionManager.sessions.get(sessionId);
      if (!session || !session.sftp) return resolve({ success: false, error: 'SFTP not available' });
      session.sftp.writeFile(remotePath, data, 'utf8', (err: any) => {
         if (err) return resolve({ success: false, error: err.message });
         resolve({ success: true });
      });
    });
  });

  ipcMain.handle('sftp-edit-sync', async (event, sessionId: string, remoteFilePath: string) => {
    const session = connectionManager.sessions.get(sessionId); 
    if (!session || !session.sftp) throw new Error('SFTP session not available');

    const fileName = require('node:path').basename(remoteFilePath);
    const tempPath = join(os.tmpdir(), `getssh_sync_${Date.now()}_${fileName}`);

    await new Promise<void>((resolve, reject) => {
      session.sftp!.fastGet(remoteFilePath, tempPath, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });

    await shell.openPath(tempPath);

    let timeoutId: NodeJS.Timeout;
    let isUploading = false;
    const watcher = fs.watch(tempPath, (eventType) => {
      if (eventType === 'change') {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          if (isUploading) return;
          isUploading = true;
          session.sftp!.fastPut(tempPath, remoteFilePath, (err: any) => {
            isUploading = false;
            if (err) console.error(`[SFTP Sync] Failed to upload ${remoteFilePath}:`, err);
          });
        }, 1000);
      }
    });

    const watchId = `${sessionId}_${remoteFilePath}`;
    connectionManager.activeSftpWatchers[watchId] = { watcher, tempPath };

    return { success: true, watchId };
  });

  ipcMain.handle('sftp-edit-stop', async (event, watchId: string) => {
    const active = connectionManager.activeSftpWatchers[watchId];
    if (active) {
      active.watcher.close();
      try {
        if (fs.existsSync(active.tempPath)) {
          fs.unlinkSync(active.tempPath);
        }
      } catch (e) {
        console.error('[SFTP Sync] Cleanup failed', e);
      }
      delete connectionManager.activeSftpWatchers[watchId];
    }
    return { success: true };
  });
}
