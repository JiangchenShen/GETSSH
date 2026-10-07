import { app, BrowserWindow, globalShortcut, shell } from 'electron';
import fs from 'node:fs';
import https from 'node:https';
import { join } from 'node:path';
import type { BackendConfig } from '../../../src/types/ipc';
import { getRustCorePath } from '../utils/rustCorePath';
import { isMainWebContents } from '../windowRegistry';

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

let backendConfig: BackendConfig = {
  confirmQuit: false,
  globalHotkey: '',
  pluginSecurityMode: 'safe'
};

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
  ipcMain.handle('update-backend-config', async (event, requestedConfig: BackendConfig, authToken?: string) => {
    // Global backend config is owned by the main window's settings (torn windows only read config).
    if (!isMainWebContents(event.sender)) {
      return {
        success: false,
        effectiveConfig: { ...backendConfig },
        error: 'Unauthorized sender.'
      };
    }
    if (!requestedConfig || typeof requestedConfig !== 'object' || Array.isArray(requestedConfig)) {
      return {
        success: false,
        effectiveConfig: { ...backendConfig },
        error: 'Invalid backend configuration.'
      };
    }

    const config: BackendConfig = {};
    if (typeof requestedConfig.confirmQuit === 'boolean') config.confirmQuit = requestedConfig.confirmQuit;
    if (typeof requestedConfig.globalHotkey === 'string') config.globalHotkey = requestedConfig.globalHotkey;
    if (
      requestedConfig.pluginSecurityMode === 'safe' ||
      requestedConfig.pluginSecurityMode === 'strict' ||
      requestedConfig.pluginSecurityMode === 'normal' ||
      requestedConfig.pluginSecurityMode === 'developer'
    ) {
      config.pluginSecurityMode = requestedConfig.pluginSecurityMode;
    }

    let modeChangeAccepted = true;
    let modeChangeError: string | undefined;
    let modeChangeVerification: 'password_required' | 'denied' | undefined;
    // Safe mode reduces privileges and is always allowed. Any transition that
    // enables backend plugin code must be authenticated in the main process.
    if (config.pluginSecurityMode && config.pluginSecurityMode !== backendConfig.pluginSecurityMode) {
      if (config.pluginSecurityMode !== 'safe') {
        try {
          const { verifyOwner } = require('../security/userPresence');
          const { appOwnerDeps } = require('../security/ownerChecks');
          // Touch ID where available; otherwise the master password typed in the settings flow.
          // Without any protected workspace there is no identity secret to verify.
          const outcome = await verifyOwner(
            { password: typeof authToken === 'string' ? authToken : undefined, reason: 'enable backend plugins' },
            appOwnerDeps(),
          );

          if (outcome !== 'verified') {
            console.warn(`[Security] Blocked unauthorized attempt to change pluginSecurityMode to ${config.pluginSecurityMode}`);
            delete config.pluginSecurityMode;
            modeChangeAccepted = false;
            modeChangeVerification = outcome;
            modeChangeError = outcome === 'password_required'
              ? 'Enter your master password to change the plugin security mode.'
              : 'Identity verification failed. Plugin security mode was not changed.';
          }
        } catch (e) {
          console.error("Failed to verify plugin mode change", e);
          delete config.pluginSecurityMode;
          modeChangeAccepted = false;
          modeChangeError = 'Plugin security mode verification failed.';
        }
      }
    }
    
    backendConfig = { ...backendConfig, ...config };
    if (config.globalHotkey !== undefined) {
      registerHotkey(config.globalHotkey, getWin);
    }
    return {
      success: modeChangeAccepted,
      effectiveConfig: { ...backendConfig },
      ...(modeChangeError ? { error: modeChangeError } : {}),
      ...(modeChangeVerification ? { verification: modeChangeVerification } : {})
    };
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

  // The database export and import of GETSSH 2.x went with step S6: they copied files that only
  // this computer's keys open, and wrote getssh.db, which getssh-store does not read. Backups are
  // store:backup:* (handlers/storeHandler.ts), encrypted with a password and portable.

  // The main window's sensitive settings, kept as an app secret in getssh-store. The renderer
  // stores only a marker in localStorage. An old safeStorage blob is moved into the store the
  // first time it is read (and re-saved right after, which replaces it with the marker).
  const fromMainFrame = (event: Electron.IpcMainInvokeEvent) =>
    isMainWebContents(event.sender) && !!event.senderFrame && event.senderFrame.parent === null;
  ipcMain.handle('encrypt-config', (event, data: unknown) => {
    if (!fromMainFrame(event)) return null;
    const { saveRendererConfig } = require('../security/appSecrets');
    return saveRendererConfig(data);
  });

  ipcMain.handle('decrypt-config', (event, blob: unknown) => {
    if (!fromMainFrame(event)) return null;
    const { readRendererConfig } = require('../security/appSecrets');
    return readRendererConfig(blob);
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
