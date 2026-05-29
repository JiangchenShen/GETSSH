import { app, BrowserWindow, globalShortcut, shell } from 'electron';
import fs from 'node:fs';
import https from 'node:https';
import { join } from 'node:path';
import type { BackendConfig } from '../../../src/types/ipc';

let sysprobe: any = null;
try {
  const addonPath = join(__dirname, '../../rust-core/getssh-sysprobe');
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
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/JiangchenShen/GETSSH/releases/latest',
      headers: {
        'User-Agent': 'GETSSH-Updater'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
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
    }).on('error', (e) => {
      console.error('Failed to check for updates', e);
      resolve(null);
    });
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

  startSysmon();
  
  app.on('browser-window-created', () => {
    startSysmon();
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
  
  // Periodic background update check
  checkForUpdates(app, getWin);
  setInterval(() => checkForUpdates(app, getWin), 12 * 60 * 60 * 1000); // Check every 12 hours
}

export function getBackendConfig() {
  return backendConfig;
}
