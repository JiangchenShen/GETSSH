import { BrowserWindow, globalShortcut, shell } from 'electron';
import os from 'node:os';
import https from 'node:https';
import type { BackendConfig } from '../../../src/types/ipc';

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

export async function checkForUpdates(app: Electron.App, getWin: () => BrowserWindow | null) {
  const update = await checkLatestRelease(app);
  const win = getWin();
  if (update && win && !win.isDestroyed()) {
    win.webContents.send('update-available', update);
  }
}

export function registerSystemHandlers(ipcMain: Electron.IpcMain, app: Electron.App, getWin: () => BrowserWindow | null) {
  
  // System Monitor Stream
  setInterval(() => {
    const win = getWin();
    if (win && !win.isDestroyed()) {
      win.webContents.send('sysmon:data', {
        cpus: os.cpus(),
        mem: { total: os.totalmem(), free: os.freemem() }
      });
    }
  }, 1000);

  // Background config and hotkeys
  ipcMain.on('update-backend-config', (event, config: BackendConfig) => {
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
