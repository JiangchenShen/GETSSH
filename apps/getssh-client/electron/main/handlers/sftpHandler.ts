import { app, shell, dialog } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import type { FileEntry } from 'ssh2';
import { connectionManager } from '../services/ConnectionManager';
import { listDirectoryBounded } from '../services/sftpListing';
import { windowForSender } from '../windowRegistry';
import { getRustCorePath } from '../utils/rustCorePath';

interface ISftpDownloader {
  append(chunk: Buffer): void;
  finish(): { safePath: string; dirPath?: string };
}

interface ISftpDownloaderConstructor {
  create(maxSize: number, targetPath?: string): ISftpDownloader;
}

interface ISftpUploader {
  readChunk(size: number): Buffer | null;
  close(): void;
}

interface ISftpUploaderConstructor {
  open(filePath: string): ISftpUploader;
}

let SftpDownloader: ISftpDownloaderConstructor;
let SftpUploader: ISftpUploaderConstructor;
try {
  const addonPath = getRustCorePath('sftp-stream');
  const native = require(addonPath);
  SftpDownloader = native.SftpDownloader;
  SftpUploader = native.SftpUploader;
} catch (e) {
  if (process.env.VITEST) {
    SftpDownloader = class MockSftpDownloader { static create() { return new MockSftpDownloader(); } start() {} abort() {} append() {} finish() { return { safePath: '/tmp/getssh_sync_12345_file.txt', dirPath: '/tmp/getssh_sync_12345' }; } } as any;
    SftpUploader = class MockSftpUploader { static create() { return new MockSftpUploader(); } static open() { return new MockSftpUploader(); } start() {} abort() {} append() {} finish() {} readChunk() { return null; } close() {} } as any;
  } else {
    throw e;
  }
}

function normalizeRemotePath(p: string): string | null {
  if (typeof p !== 'string' || p.length === 0) return null;
  // NUL 截断：底层 C 侧按 NUL 结尾会把后半段丢掉，路径变成另一个
  if (p.includes('\0')) return null;

  const normalized = require('node:path').posix.normalize(p);

  // 归一化后仍以 .. 开头 = 这条路径要跳出起点。
  // 绝对路径经 normalize 已把 .. 折叠干净（/a/../../etc -> /etc），
  // 只有相对路径会把 .. 留下来（../../etc/passwd 原样保留），
  // 之前直接透传，等于没拦。
  if (normalized === '..' || normalized.startsWith('../')) return null;

  return normalized;
}

/** A single path component that names a file: not empty, "." or "..", and without separators. */
function isPlainFileName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && !/[\\/\u0000]/.test(name);
}

const SFTP_DISABLED = 'SFTP is disabled for this workspace (Secure Center → Isolation Rules)';

/** Workspace isolation rule "Disable SFTP File Transfers"; the UI hides SFTP, this enforces it. */
function isSftpDisabledByWorkspace(): boolean {
  try {
    const { getActiveWorkspaceId } = require('./workspaceHandler');
    const { DatabaseManager } = require('../services/DatabaseManager');
    const workspaceId = getActiveWorkspaceId();
    const workspace = DatabaseManager.getWorkspaces().find((w: { id: string }) => w.id === workspaceId);
    const preferences = workspace?.preferences ? JSON.parse(workspace.preferences) : {};
    return preferences?.isolationRules?.disableSftp === true;
  } catch (e) {
    console.warn('[SFTP] Could not read workspace isolation rules:', e);
    return false;
  }
}

/**
 * The window a dialog belongs to, brought back first if it is minimized or hidden. On macOS a
 * message box without a visible parent runs as an app-modal alert that stops the main thread,
 * and the watchdog then kills GETSSH after 65 s.
 */
function dialogParent(sender: Electron.WebContents): Electron.BrowserWindow | null {
  const win = windowForSender(sender);
  if (!win || win.isDestroyed()) return null;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  return win;
}

const FILE_TYPE_MASK = 0o170000;
const REGULAR_FILE = 0o100000;
const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
/** A file that stats as 0 bytes (/proc files) is read up to this much. */
const MAX_ZERO_SIZE_DOWNLOAD = 16 * 1024 * 1024;
/** When the server cannot stat, a download stops here. */
const MAX_UNKNOWN_SIZE_DOWNLOAD = 2 * 1024 * 1024 * 1024;

export function registerSftpHandlers(ipcMain: Electron.IpcMain) {
  ipcMain.handle('sftp-list', (event, sessionId: string, remotePath: string) => {
    if (isSftpDisabledByWorkspace()) return Promise.resolve({ success: false, error: SFTP_DISABLED });
    return new Promise((resolve) => {
      remotePath = normalizeRemotePath(remotePath) as string;
      if (!remotePath) return resolve({ success: false, error: 'Invalid path' });
      const session = connectionManager.sessions.get(sessionId);
      if (!session || !session.sftp) return resolve({ success: false, error: 'SFTP not available' });
      // At most 10,000 entries, 8 MB of names or 20 s: `truncated` says the folder holds more.
      listDirectoryBounded(session.sftp, remotePath).then(({ entries: list, truncated }) => {
        resolve({ 
           success: true, 
           truncated,
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
      }, (err: Error) => resolve({ success: false, error: err.message }));
    });
  });

  ipcMain.handle('sftp-mkdir', (event, sessionId: string, remotePath: string) => {
    if (isSftpDisabledByWorkspace()) return Promise.resolve({ success: false, error: SFTP_DISABLED });
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
    if (isSftpDisabledByWorkspace()) return Promise.resolve({ success: false, error: SFTP_DISABLED });
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
    if (isSftpDisabledByWorkspace()) return Promise.resolve({ success: false, error: SFTP_DISABLED });
    return new Promise((resolve) => {
      remotePath = normalizeRemotePath(remotePath) as string;
      if (!remotePath) return resolve({ success: false, error: 'Invalid path' });
      const session = connectionManager.sessions.get(sessionId);
      if (!session || !session.sftp) return resolve({ success: false, error: 'SFTP not available' });
      
      session.sftp.stat(remotePath, (statErr: any, stats: any) => {
         // If stat fails (e.g. symlinks, or servers that don't support it), allow the read anyway
         const fileSize = stats?.size ?? -1;
         
         // [C-06] Security Fix: Enforce 10MB limit for direct memory reads to prevent V8 OOM crashes
         if (fileSize > MAX_PREVIEW_BYTES) {
             return resolve({ 
                 success: false, 
                 error: '文件过大(>10MB)。为防止内存溢出，请直接下载或双击使用本地编辑器同步修改，不要直接在应用内预览。' 
             });
         }
         
         // A device or pipe stats as 0 bytes and never ends: refuse known non-regular types, and
         // stop at 10 MB whatever the stat said.
         const type = typeof stats?.mode === 'number' ? stats.mode & FILE_TYPE_MASK : 0;
         if (type !== 0 && type !== REGULAR_FILE) return resolve({ success: false, error: 'Only regular files can be read' });
         const chunks: Buffer[] = [];
         let received = 0;
         const stream = session.sftp!.createReadStream(remotePath);
         stream.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > MAX_PREVIEW_BYTES) {
               stream.destroy();
               resolve({ success: false, error: '文件过大(>10MB)。为防止内存溢出，请直接下载或双击使用本地编辑器同步修改，不要直接在应用内预览。' });
               return;
            }
            chunks.push(chunk);
         });
         stream.on('end', () => resolve({ success: true, data: Buffer.concat(chunks).toString('utf8') }));
         stream.on('error', (err: any) => resolve({ success: false, error: err.message }));
      });
    });
  });

  ipcMain.handle('sftp-write-file', (event, sessionId: string, remotePath: string, data: string) => {
    if (isSftpDisabledByWorkspace()) return Promise.resolve({ success: false, error: SFTP_DISABLED });
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
    if (isSftpDisabledByWorkspace()) throw new Error(SFTP_DISABLED);
    const session = connectionManager.sessions.get(sessionId); 
    if (!session || !session.sftp) throw new Error('SFTP session not available');

    const fileName = require('node:path').basename(remoteFilePath);
    // basename('dir/..') is '..': joined below it would name the parent directory, not a file inside ours.
    if (!isPlainFileName(fileName)) throw new Error('Invalid remote file name');
    
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

    const dispose = () => { clearTimeout(timeoutId); pendingUpload = false; };
    // The session may have closed while the file was downloading: its cleanup has run already, so
    // a sync registered now would never be stopped.
    if (connectionManager.sessions.get(sessionId) !== session) {
      watcher.close();
      dispose();
      await fs.promises.rm(dirPath!, { recursive: true, force: true }).catch(() => {});
      throw new Error('SFTP session closed');
    }
    // Each open keeps its own sync until the session ends: the file may still be open in an editor
    // from the first time, with saves on their way.
    const watchId = `${sessionId}_${remoteFilePath}_${crypto.randomUUID()}`;
    connectionManager.activeSftpWatchers[watchId] = {
      watcher,
      tempPath: dirPath!,
      // A debounced upload must not fire after the watcher is stopped and its temp dir removed.
      dispose,
    };

    return { success: true, watchId };
  });

  ipcMain.handle('sftp-edit-stop', async (event, watchId: string) => {
    await connectionManager.stopSftpWatcher(watchId);
    return { success: true };
  });

  ipcMain.handle('sftp-download-file', async (event, sessionId: string, remoteFilePath: string, providedLocalDir?: string) => {
    if (isSftpDisabledByWorkspace()) return { success: false, error: SFTP_DISABLED };
    const session = connectionManager.sessions.get(sessionId); 
    if (!session || !session.sftp) return { success: false, error: 'SFTP session not available' };

    const fileName = require('node:path').basename(remoteFilePath);
    if (!isPlainFileName(fileName)) return { success: false, error: 'Invalid remote file name' };

    // Size and type first. A device or a pipe (/dev/zero, a FIFO) lists as a 0-byte file and
    // would stream forever: only regular files are downloaded. Some servers cannot stat (null).
    const stats: { size: number; mode: number } | null = await new Promise((resolve) => {
      session.sftp!.stat(remoteFilePath, (err: any, result: any) => {
        resolve(err || !result ? null : { size: typeof result.size === 'number' ? result.size : -1, mode: typeof result.mode === 'number' ? result.mode : REGULAR_FILE });
      });
    });
    // Some servers send permissions without the type bits (0): those count as unknown.
    const fileType = stats ? stats.mode & FILE_TYPE_MASK : 0;
    if (fileType !== 0 && fileType !== REGULAR_FILE) {
      return { success: false, error: 'Only regular files can be downloaded' };
    }
    const fileSize = stats ? stats.size : -1;
    const parent = () => dialogParent(event.sender);

    let targetFilePath = '';
    
    if (providedLocalDir) {
      // [Security Fix] prevent arbitrary file write via strict path bounds check in sftpHandler
      // Use path.relative to securely ensure the provided download directory falls strictly under 
      // the OS Downloads or Desktop folders, mitigating potential directory traversal.
      // Compared after resolving links: a link inside Downloads must not lead the write elsewhere.
      const path = require('node:path');
      const realOrNull = (p: string) => fs.promises.realpath(p).catch(() => null);
      const [resolvedDir, downloadsPath, desktopPath] = await Promise.all([
        realOrNull(path.resolve(providedLocalDir)),
        realOrNull(app.getPath('downloads')),
        realOrNull(app.getPath('desktop')),
      ]);
      const isInside = (base: string | null) => {
        if (!base || !resolvedDir) return false;
        const rel = path.relative(base, resolvedDir);
        return !rel.startsWith('..') && !path.isAbsolute(rel);
      };

      if (!isInside(downloadsPath) && !isInside(desktopPath)) {
        console.warn(`[Security] sftp-download-file rejected suspicious providedLocalDir: ${providedLocalDir}`);
        return { success: false, error: 'Security: Automatic downloads are only permitted strictly within the Downloads or Desktop folders.' };
      }
      
      targetFilePath = join(resolvedDir!, fileName);
    } else {
      const saveOptions: Electron.SaveDialogOptions = {
        defaultPath: require('electron').app.getPath('downloads') + '/' + fileName,
        properties: ['createDirectory', 'showOverwriteConfirmation']
      };
      const saveParent = parent();
      const result = saveParent ? await dialog.showSaveDialog(saveParent, saveOptions) : await dialog.showSaveDialog(saveOptions);

      if (result.canceled || !result.filePath) {
        return { success: true, canceled: true };
      }
      targetFilePath = result.filePath;
    }

    try {
      // Show confirmation dialog for large files (> 100 MB) or any file when size is known
      if (fileSize > 0) {
        const fileSizeFormatted = fileSize >= 1024 * 1024 * 1024
          ? `${(fileSize / 1024 / 1024 / 1024).toFixed(2)} GB`
          : fileSize >= 1024 * 1024
          ? `${(fileSize / 1024 / 1024).toFixed(2)} MB`
          : `${(fileSize / 1024).toFixed(1)} KB`;

        const confirmOptions: Electron.MessageBoxOptions = {
          type: 'question',
          buttons: ['下载', '取消'],
          defaultId: 0,
          cancelId: 1,
          title: '确认下载',
          message: `即将下载文件`,
          detail: `文件名：${fileName}\n文件大小：${fileSizeFormatted}\n\n确定要下载此文件吗？`,
        };
        const confirmParent = parent();
        const { response } = confirmParent ? await dialog.showMessageBox(confirmParent, confirmOptions) : await dialog.showMessageBox(confirmOptions);

        if (response === 1) {
          return { success: true, canceled: true };
        }
      }

      // Track B: Download Mode (max_size = 0, with target_local_path) — no size limit
      const downloader = SftpDownloader.create(0, targetFilePath);
      
      // With a known size, read that many bytes and no more: a server that keeps sending would
      // otherwise fill the disk. A 0-byte stat (/proc files) or none at all still gets a ceiling.
      await new Promise<void>((resolve, reject) => {
        const ceiling = fileSize > 0 ? fileSize : fileSize === 0 ? MAX_ZERO_SIZE_DOWNLOAD : MAX_UNKNOWN_SIZE_DOWNLOAD;
        let received = 0;
        const readStream = fileSize > 0
          ? session.sftp!.createReadStream(remoteFilePath, { start: 0, end: fileSize - 1 })
          : session.sftp!.createReadStream(remoteFilePath);
        readStream.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > ceiling) {
            readStream.destroy();
            reject(new Error('The file is larger than the server reported'));
            return;
          }
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
