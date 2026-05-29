import { app, shell, dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import type { FileEntry } from 'ssh2';
import { connectionManager } from '../services/ConnectionManager';

const addonPath = join(__dirname, '../../rust-core/sftp-stream');
const { SftpDownloader, SftpUploader } = require(addonPath);

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
      session.sftp.readdir(remotePath, (err: Error | undefined, list: FileEntry[]) => {
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
      
      session.sftp.stat(remotePath, (statErr: any, stats: any) => {
         // If stat fails (e.g. symlinks, or servers that don't support it), allow the read anyway
         const fileSize = stats?.size ?? -1;
         
         // [C-06] Security Fix: Enforce 10MB limit for direct memory reads to prevent V8 OOM crashes
         if (fileSize > 10 * 1024 * 1024) {
             return resolve({ 
                 success: false, 
                 error: '文件过大(>10MB)。为防止内存溢出，请直接下载或双击使用本地编辑器同步修改，不要直接在应用内预览。' 
             });
         }
         
         session.sftp!.readFile(remotePath, 'utf8', (err: any, data: any) => {
            if (err) return resolve({ success: false, error: err.message });
            resolve({ success: true, data });
         });
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
    
    // 1. Safe Download using Rust N-API (max 5MB, Track A: Edit Mode)
    // [L-01] Security Fix: Enforce 5MB limit on SFTP edit-sync to prevent local editor crashes
    const downloader = SftpDownloader.create(5 * 1024 * 1024, undefined);
    
    await new Promise<void>((resolve, reject) => {
      const readStream = session.sftp!.createReadStream(remoteFilePath);
      readStream.on('data', (chunk: Buffer) => {
        try {
          downloader.append(chunk);
        } catch (e) {
          readStream.destroy();
          reject(e);
        }
      });
      readStream.on('end', () => resolve());
      readStream.on('error', (err: any) => reject(err));
    });

    const { safePath, dirPath } = downloader.finish();
    
    // Rename to actual filename within the secure dir so external editors recognize the extension
    const finalLocalPath = join(dirPath!, fileName);
    fs.renameSync(safePath, finalLocalPath);

    shell.showItemInFolder(finalLocalPath);

    let timeoutId: NodeJS.Timeout;
    let isUploading = false;
    let pendingUpload = false;

    const doUpload = async () => {
      if (isUploading) {
         pendingUpload = true;
         return;
      }
      isUploading = true;
      pendingUpload = false;

      try {
        const uploader = SftpUploader.open(finalLocalPath);
        const writeStream = session.sftp!.createWriteStream(remoteFilePath);
        
        await new Promise<void>((resolve, reject) => {
           writeStream.on('close', resolve);
           writeStream.on('error', reject);
           
           const pipeNext = () => {
             try {
               const chunk = uploader.readChunk(64 * 1024); // 64KB chunks
               if (!chunk) {
                 writeStream.end();
                 return;
               }
               const canContinue = writeStream.write(chunk);
               if (canContinue) {
                 setImmediate(pipeNext);
               } else {
                 writeStream.once('drain', pipeNext);
               }
             } catch (e) {
               writeStream.destroy();
               reject(e);
             }
           };
           pipeNext();
        });
        
        uploader.close();
      } catch (err) {
        console.error(`[SFTP Sync] Rust stream upload failed for ${remoteFilePath}:`, err);
      } finally {
        isUploading = false;
        if (pendingUpload) {
          doUpload();
        }
      }
    };

    const watcher = fs.watch(dirPath!, (eventType: string, eventFilename: string | null) => {
      if (eventFilename === fileName && eventType === 'change') {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          doUpload();
        }, 500); // Strict 500ms debounce
      }
    });

    const watchId = `${sessionId}_${remoteFilePath}`;
    connectionManager.activeSftpWatchers[watchId] = { watcher, tempPath: dirPath! };

    return { success: true, watchId };
  });

  ipcMain.handle('sftp-edit-stop', async (event, watchId: string) => {
    const active = connectionManager.activeSftpWatchers[watchId];
    if (active) {
      active.watcher.close();
      try {
        await fs.promises.rm(active.tempPath, { recursive: true, force: true });
      } catch (e: any) {
        console.error('[SFTP Sync] Cleanup failed', e);
      }
      delete connectionManager.activeSftpWatchers[watchId];
    }
    return { success: true };
  });

  ipcMain.handle('sftp-download-file', async (event, sessionId: string, remoteFilePath: string, providedLocalDir?: string) => {
    const session = connectionManager.sessions.get(sessionId); 
    if (!session || !session.sftp) return { success: false, error: 'SFTP session not available' };

    const fileName = require('node:path').basename(remoteFilePath);
    
    let targetFilePath = '';
    
    if (providedLocalDir) {
      // [Security Fix] prevent arbitrary file write via strict path bounds check in sftpHandler
      // Use path.relative to securely ensure the provided download directory falls strictly under 
      // the OS Downloads or Desktop folders, mitigating potential directory traversal.
      const path = require('node:path');
      const downloadsPath = require('electron').app.getPath('downloads');
      const desktopPath = require('electron').app.getPath('desktop');
      const resolvedDir = path.resolve(providedLocalDir);
      
      const relToDownloads = path.relative(downloadsPath, resolvedDir);
      const isUnderDownloads = !relToDownloads.startsWith('..') && !path.isAbsolute(relToDownloads);
      
      const relToDesktop = path.relative(desktopPath, resolvedDir);
      const isUnderDesktop = !relToDesktop.startsWith('..') && !path.isAbsolute(relToDesktop);
      
      if (!isUnderDownloads && !isUnderDesktop) {
        console.warn(`[Security] sftp-download-file rejected suspicious providedLocalDir: ${resolvedDir}`);
        return { success: false, error: 'Security: Automatic downloads are only permitted strictly within the Downloads or Desktop folders.' };
      }
      
      targetFilePath = join(providedLocalDir, fileName);
    } else {
      const result = await dialog.showSaveDialog({
        defaultPath: require('electron').app.getPath('downloads') + '/' + fileName,
        properties: ['createDirectory', 'showOverwriteConfirmation']
      });

      if (result.canceled || !result.filePath) {
        return { success: true, canceled: true };
      }
      targetFilePath = result.filePath;
    }

    try {
      // Get remote file size before downloading for user confirmation
      const fileSize: number = await new Promise((resolve, reject) => {
        session.sftp!.stat(remoteFilePath, (err: any, stats: any) => {
          if (err) {
            // If stat fails, allow download anyway (some SFTP servers don't support stat)
            resolve(-1);
          } else {
            resolve(stats.size ?? -1);
          }
        });
      });

      // Show confirmation dialog for large files (> 100 MB) or any file when size is known
      if (fileSize > 0) {
        const fileSizeFormatted = fileSize >= 1024 * 1024 * 1024
          ? `${(fileSize / 1024 / 1024 / 1024).toFixed(2)} GB`
          : fileSize >= 1024 * 1024
          ? `${(fileSize / 1024 / 1024).toFixed(2)} MB`
          : `${(fileSize / 1024).toFixed(1)} KB`;

        const { response } = await dialog.showMessageBox({
          type: 'question',
          buttons: ['下载', '取消'],
          defaultId: 0,
          cancelId: 1,
          title: '确认下载',
          message: `即将下载文件`,
          detail: `文件名：${fileName}\n文件大小：${fileSizeFormatted}\n\n确定要下载此文件吗？`,
        });

        if (response === 1) {
          return { success: true, canceled: true };
        }
      }

      // Track B: Download Mode (max_size = 0, with target_local_path) — no size limit
      const downloader = SftpDownloader.create(0, targetFilePath);
      
      await new Promise<void>((resolve, reject) => {
        const readStream = session.sftp!.createReadStream(remoteFilePath);
        readStream.on('data', (chunk: Buffer) => {
          try {
            downloader.append(chunk);
          } catch (e) {
            readStream.destroy();
            reject(e);
          }
        });
        readStream.on('end', () => resolve());
        readStream.on('error', (err: any) => reject(err));
      });

      downloader.finish();
      return { success: true };
    } catch (error: any) {
      console.error('[SFTP Download] Failed:', error);
      return { success: false, error: error.message || 'Download failed' };
    }
  });
}
