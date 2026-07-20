import { app, BrowserWindow, globalShortcut, shell } from 'electron';
import fs from 'node:fs';
import https from 'node:https';
import { join } from 'node:path';
import type { BackendConfig } from '../../../src/types/ipc';
import { getRustCorePath } from '../utils/rustCorePath';

let sysprobe: any = null;
try {
  const addonPath = getRustCorePath('getssh-sysprobe');
  if (fs.existsSync(addonPath)) {
     sysprobe = require(addonPath);
  } else {
     console.warn('Sysprobe native module not found at', addonPath);
  }
} catch (e) {
  console.error("Failed to load getssh-sysprobe native module:", e);
}

let backendConfig: BackendConfig = { confirmQuit: false, globalHotkey: '' };

const registerHotkey = (key: string, getWin: () => BrowserWindow | null) => {
  globalShortcut.unregisterAll();
  if (key) {
    try {
      globalShortcut.register(key, () => {
        const win = getWin();
        if (win) {
          if (win.isVisible() && win.isFocused()) {
            win.hide();
          } else {
            win.show();
            win.focus();
          }
        }
      });
    } catch(e) { console.error("Hotkey failed to register", e) }
  }
}

function compareSemVer(v1: string, v2: string) {
  const parse = (v: string) => {
    const match = v.match(/(\d+)\.(\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  };
  const a = parse(v1);
  const b = parse(v2);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

function checkLatestRelease(app: Electron.App): Promise<{ version: string, url: string } | null> {
  return new Promise((resolve) => {
    try {
      const { net } = require('electron');
      const request = net.request({
        method: 'GET',
        url: 'https://api.github.com/repos/JiangchenShen/GETSSH/releases/latest'
      });
      request.setHeader('User-Agent', 'GETSSH-Updater');

      request.on('response', (res: Electron.IncomingMessage) => {
        let data = '';
        res.on('data', (chunk) => data += chunk.toString('utf-8'));
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const release = JSON.parse(data);
              const latestVersion = release.tag_name;
              const currentVersion = app.getVersion();
              if (compareSemVer(latestVersion, currentVersion) > 0) {
                resolve({ version: latestVersion, url: release.html_url });
              } else {
                resolve(null);
              }
            } else {
              resolve(null);
            }
          } catch (e) {
            console.error('Failed to parse release data', e);
            resolve(null);
          }
        });
      });
      request.on('error', (e: Error) => {
        console.error('Update check failed', e);
        resolve(null);
      });
      request.end();
    } catch (e) {
      resolve(null);
    }
  });
}

import { autoUpdater } from 'electron-updater';

export async function checkForUpdates(app: Electron.App, getWin: () => BrowserWindow | null) {
  if (process.platform === 'darwin') {
    // macOS unsigned builds can't auto-update, fallback to manual check
    const update = await checkLatestRelease(app);
    const win = getWin();
    if (update && win && !win.isDestroyed()) {
      win.webContents.send('update-available', update);
    }
  } else {
    // Other platforms can use autoUpdater
    try {
      autoUpdater.autoDownload = false; // We can still prompt the user
      const res = await autoUpdater.checkForUpdates();
      const win = getWin();
      if (res && res.updateInfo && win && !win.isDestroyed()) {
        win.webContents.send('update-available', {
          version: res.updateInfo.version,
          url: `https://github.com/JiangchenShen/GETSSH/releases/latest`
        });
      }
    } catch (e) {
      console.error('autoUpdater error', e);
    }
  }
}

export function registerSystemHandlers(ipcMain: Electron.IpcMain, app: Electron.App, getWin: () => BrowserWindow | null) {
  
  // [M-09] Security Fix: Properly manage sysmon interval lifecycle
  let sysmonInterval: NodeJS.Timeout | null = null;

  const startSysmon = () => {
    if (sysmonInterval) return;
    sysmonInterval = setInterval(() => {
      const win = getWin();
      if (!win || win.isDestroyed()) {
        if (sysmonInterval) {
          clearInterval(sysmonInterval);
          sysmonInterval = null;
        }
        return;
      }
      try {
        if (sysprobe) {
          const stats = sysprobe.getSystemStats();
          win.webContents.send('sysmon:data', stats);
        }
      } catch (e) {
        console.error("Sysprobe polling error:", e);
      }
    }, 1000);
  };

  const stopSysmon = () => {
    if (sysmonInterval) {
      clearInterval(sysmonInterval);
      sysmonInterval = null;
    }
  };

  startSysmon();
  
  app.on('browser-window-created', () => {
    startSysmon();
  });

  app.on('window-all-closed', () => {
    stopSysmon();
  });

  app.on('before-quit', () => {
    stopSysmon();
  });

  // Background config and hotkeys
  ipcMain.on('update-backend-config', async (event, config: BackendConfig, authToken?: string) => {
    // Intercept plugin security mode changes for biometric verification
    if (config.pluginSecurityMode && config.pluginSecurityMode !== backendConfig.pluginSecurityMode) {
      if (config.pluginSecurityMode === 'safe' || config.pluginSecurityMode === 'developer') {
        try {
          const win = getWin();
          if (win) {
            const fs = require('node:fs');
            const path = require('node:path');
            const { systemPreferences, safeStorage } = require('electron');
            const PROFILES_KEY_PATH = path.join(app.getPath('userData'), 'profiles.key');
            
            let verified = false;
            if (fs.existsSync(PROFILES_KEY_PATH)) {
               // 1. Check Auth Token Fallback
               if (authToken && safeStorage.isEncryptionAvailable()) {
                  try {
                     const encryptedKey = await fs.promises.readFile(PROFILES_KEY_PATH);
                     const masterPassword = safeStorage.decryptString(encryptedKey);
                     if (authToken === masterPassword) {
                        verified = true;
                     }
                  } catch (e) {
                     console.warn("Failed to decrypt master password for auth token verification", e);
                  }
               }
               
               // 2. Check Biometric
               if (!verified && process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
                  try {
                    await systemPreferences.promptTouchID('Verify identity to change critical plugin security mode');
                    verified = true;
                  } catch (e) { verified = false; }
               }
            } else {
               // No key means no encryption, meaning anyone can change it. 
               verified = true; 
            }
            
            if (!verified) {
               console.warn(`[Security] Blocked unauthorized attempt to change pluginSecurityMode to ${config.pluginSecurityMode}`);
               delete config.pluginSecurityMode; // Strip it out
            }
          }
        } catch (e) {
          console.error("Failed to verify plugin mode change", e);
          delete config.pluginSecurityMode;
        }
      }
    }
    
    backendConfig = { ...backendConfig, ...config };
    if (config.globalHotkey !== undefined) {
      registerHotkey(config.globalHotkey, getWin);
    }
  });

  // Updates
  ipcMain.handle('check-for-updates', async () => {
    try {
      const update = await checkLatestRelease(app);
      const win = getWin();
      if (update && win && !win.isDestroyed()) {
        win.webContents.send('update-available', update);
        return { hasUpdate: true, version: update.version, url: update.url };
      }
      return { hasUpdate: false };
    } catch (e) {
      return { hasUpdate: false, error: String(e) };
    }
  });

  // Export Global DB (All workspaces)
  ipcMain.handle('export-database-all', async () => {
    const win = getWin();
    if (!win) return { success: false, error: 'No active window' };
    try {
      const { dialog } = require('electron');
      const fs = require('node:fs');
      const path = require('node:path');
      const AdmZip = require('adm-zip');
      const baseDir = path.join(app.getPath('home'), '.getssh');
      
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Export All Databases (ZIP)',
        defaultPath: 'getssh_backup.zip',
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
      });

      if (!canceled && filePath) {
        const zip = new AdmZip();
        const files = fs.readdirSync(baseDir);
        for (const file of files) {
          if (file.endsWith('.db')) {
            zip.addLocalFile(path.join(baseDir, file));
          }
        }
        zip.writeZip(filePath);
        return { success: true, path: filePath };
      }
      return { success: false, error: 'canceled' };
    } catch (e) {
      console.error('Failed to export all DBs', e);
      return { success: false, error: String(e) };
    }
  });

  // Export Specific Workspace DB
  ipcMain.handle('export-database-workspace', async () => {
    const win = getWin();
    if (!win) return { success: false, error: 'No active window' };
    try {
      const { dialog } = require('electron');
      const fs = require('node:fs');
      const path = require('node:path');
      const { getActiveWorkspaceId } = require('./workspaceHandler');
      const wsId = getActiveWorkspaceId();
      const dbPath = path.join(app.getPath('home'), '.getssh', `workspace_${wsId}.db`);
      
      if (!fs.existsSync(dbPath)) {
         return { success: false, error: 'Workspace database not found' };
      }

      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Export Workspace Database Backup',
        defaultPath: `workspace_${wsId}_backup.db`,
        filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite'] }]
      });

      if (!canceled && filePath) {
        await fs.promises.copyFile(dbPath, filePath);
        return { success: true, path: filePath };
      }
      return { success: false, error: 'canceled' };
    } catch (e) {
      console.error('Failed to export workspace DB', e);
      return { success: false, error: String(e) };
    }
  });

  // Import DB
  ipcMain.handle('import-database', async () => {
    const win = getWin();
    if (!win) return { success: false, error: 'No active window' };
    try {
      const { dialog, app } = require('electron');
      const fs = require('node:fs');
      const path = require('node:path');
      const dbPath = path.join(app.getPath('home'), '.getssh', 'getssh.db');
      
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: 'Import Database Backup',
        filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite'] }],
        properties: ['openFile']
      });

      if (!canceled && filePaths.length > 0) {
        const sourcePath = filePaths[0];
        if (sourcePath !== dbPath) {
          try {
            const Database = require('better-sqlite3');
            const extDb = new Database(sourcePath, { readonly: true });
            let hasMain = false;
            try {
              const row = extDb.prepare("SELECT COUNT(*) as count FROM workspaces WHERE id = 'default' OR is_main = 1").get();
              hasMain = row && row.count > 0;
            } catch (e) {
              // old db structure maybe
              const row = extDb.prepare("SELECT COUNT(*) as count FROM workspaces WHERE id = 'default'").get();
              hasMain = row && row.count > 0;
            }
            extDb.close();

            if (hasMain) {
              return { success: true, requiresConfirmation: true, sourcePath };
            }
            
            // Safe to just merge automatically if no main workspace
            return await handleMergeDatabase(dbPath, sourcePath);
          } catch (e) {
            console.error('Failed to read external db', e);
            return { success: false, error: String(e) };
          }
        }
        return { success: true, requiresConfirmation: false };
      }
      return { success: false, error: 'canceled' };
    } catch (e) {
      console.error('Failed to import DB', e);
      return { success: false, error: String(e) };
    }
  });

  async function handleMergeDatabase(dbPath: string, sourcePath: string) {
    const Database = require('better-sqlite3');
    const localDb = new Database(dbPath);
    try {
      localDb.exec(`ATTACH DATABASE '${sourcePath}' AS imported`);
      
      const transaction = localDb.transaction(() => {
        // We only insert non-main workspaces
        // Check if imported workspaces has is_main
        let isMainColExists = false;
        try {
           localDb.prepare("SELECT is_main FROM imported.workspaces LIMIT 1").get();
           isMainColExists = true;
        } catch {}

        const filter = isMainColExists ? "id != 'default' AND is_main = 0" : "id != 'default'";

        localDb.exec(`INSERT OR REPLACE INTO main.workspaces SELECT * FROM imported.workspaces WHERE ${filter}`);
        localDb.exec(`INSERT OR REPLACE INTO main.profiles SELECT p.* FROM imported.profiles p JOIN imported.workspaces w ON p.workspace_id = w.id WHERE w.${filter}`);
        localDb.exec(`INSERT OR REPLACE INTO main.runbooks SELECT r.* FROM imported.runbooks r JOIN imported.workspaces w ON r.workspace_id = w.id WHERE w.${filter}`);
        localDb.exec(`INSERT OR REPLACE INTO main.ai_sessions SELECT s.* FROM imported.ai_sessions s JOIN imported.workspaces w ON s.workspace_id = w.id WHERE w.${filter}`);
        localDb.exec(`INSERT OR REPLACE INTO main.ai_messages SELECT m.* FROM imported.ai_messages m JOIN imported.ai_sessions s ON m.session_id = s.id JOIN imported.workspaces w ON s.workspace_id = w.id WHERE w.${filter}`);
      });
      transaction();
      localDb.exec('DETACH DATABASE imported');
      localDb.close();
      return { success: true, requiresConfirmation: false, merged: true };
    } catch (e) {
      console.error('Failed to merge DB', e);
      localDb.close();
      return { success: false, error: String(e) };
    }
  }

  ipcMain.handle('import-database-confirm', async (event, sourcePath: string, strategy: 'overwrite' | 'merge') => {
    try {
      const { app } = require('electron');
      const fs = require('node:fs');
      const path = require('node:path');
      const dbPath = path.join(app.getPath('home'), '.getssh', 'getssh.db');

      if (strategy === 'overwrite') {
        await fs.promises.copyFile(sourcePath, dbPath);
        app.relaunch();
        app.exit(0);
        return { success: true };
      } else {
        return await handleMergeDatabase(dbPath, sourcePath);
      }
    } catch(e) {
      return { success: false, error: String(e) };
    }
  });

  // Config Encryption
  ipcMain.handle('encrypt-config', async (_e, data: any) => {
    try {
      const { safeStorage } = require('electron');
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.encryptString(JSON.stringify(data)).toString('base64');
      }
    } catch (err) {}
    // Fallback to base64 if no encryption available
    return Buffer.from(JSON.stringify(data)).toString('base64');
  });

  ipcMain.handle('decrypt-config', async (_e, base64: string) => {
    try {
      const { safeStorage } = require('electron');
      const buf = Buffer.from(base64, 'base64');
      if (safeStorage.isEncryptionAvailable()) {
        return JSON.parse(safeStorage.decryptString(buf));
      }
      return JSON.parse(buf.toString('utf-8'));
    } catch (err) {
      // Return null if decryption fails
      return null;
    }
  });
  
  // Periodic background update check
  checkForUpdates(app, getWin);
  setInterval(() => checkForUpdates(app, getWin), 12 * 60 * 60 * 1000); // Check every 12 hours

  ipcMain.handle('system:promptTouchID', async (event, reason: string) => {
    try {
      const { systemPreferences } = require('electron');
      if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
        await systemPreferences.promptTouchID(reason);
        return { success: true };
      }
      return { success: false, error: 'Touch ID not available' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });
}

export function getBackendConfig() {
  return backendConfig;
}
