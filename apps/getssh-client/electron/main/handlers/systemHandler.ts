import { app, BrowserWindow, globalShortcut, shell } from 'electron';
import fs from 'node:fs';
import https from 'node:https';
import { join } from 'node:path';
import type { BackendConfig } from '../../../src/types/ipc';
import { getRustCorePath } from '../utils/rustCorePath';
import { checkForUpdates, fetchLatestRelease, notifyWindow } from '../services/updateCheck';
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

  // Updates: Settings → About runs the same check as the background one, but shows a failure.
  ipcMain.handle('check-for-updates', async () => {
    try {
      const update = await fetchLatestRelease(app.getVersion());
      if (!update) return { hasUpdate: false };
      notifyWindow(update, getWin);
      return { hasUpdate: true, version: update.version, url: update.url };
    } catch (e) {
      console.warn('[Update] Update check failed:', e);
      return { hasUpdate: false, error: e instanceof Error ? e.message : String(e) };
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
  checkForUpdates(app.getVersion(), getWin);
  setInterval(() => checkForUpdates(app.getVersion(), getWin), 12 * 60 * 60 * 1000); // Check every 12 hours

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
