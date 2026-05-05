import { app, BrowserWindow, ipcMain, dialog, nativeTheme, globalShortcut, Menu, powerSaveBlocker, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import crypto from 'node:crypto'
import https from 'node:https'
import { PluginManager } from './PluginManager'
import { registerCryptoHandlers } from './handlers/cryptoHandler'
import { registerSshHandlers } from './handlers/sshHandler'
import { registerSftpHandlers } from './handlers/sftpHandler'

process.env.DIST_ELECTRON = join(__dirname, '..')
process.env.DIST = join(process.env.DIST_ELECTRON, '../dist')

// Prevent background throttling for SSH persistence
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

process.on('uncaughtException', (err) => {
  console.error("Critical Uncaught Exception: ", err)
})
process.on('unhandledRejection', (err) => {
  console.error("Critical Unhandled Rejection: ", err)
})
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST

let win: BrowserWindow | null = null
const preload = join(__dirname, '../preload/index.js')
const url = process.env.VITE_DEV_SERVER_URL
const indexHtml = join(process.env.DIST, 'index.html')

function createWindow() {
  win = new BrowserWindow({
    title: 'GETSSH',
    width: 1024,
    height: 768,
    transparent: true,
    vibrancy: 'fullscreen-ui', // macOS vibrant glass effect
    titleBarStyle: 'hidden', // hide title bar to let web content handle drag
    titleBarOverlay: process.platform !== 'darwin' ? {
      color: 'rgba(0,0,0,0)',
      symbolColor: '#a1a1aa',
      height: 32
    } : false,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false // Prevents xterm and SSH from disconnecting when window loses focus
    },
  })

  // Prevent Quit Logic Map
  win.on('close', (e) => {
    if (win) {
       // We fetch boolean confirmQuit from the local mutable state (init false)
       if (backendConfig.confirmQuit) {
         const selection = dialog.showMessageBoxSync(win, {
           type: 'question',
           buttons: ['Cancel', 'Quit'],
           defaultId: 1,
           cancelId: 0,
           title: 'Confirm Quit',
           message: 'Are you sure you want to quit GETSSH?',
           detail: 'All active SSH terminal connections and running tasks will be disconnected immediately.'
         });
         
         if (selection === 0) {
           e.preventDefault();
         }
       }
    }
  })

  // Security Hardening: Prevent arbitrary window spawning
  win.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // Security Hardening: Prevent arbitrary navigation within the main window
  win.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    const localUrl = process.env.VITE_DEV_SERVER_URL;
    if (localUrl && parsedUrl.origin === new URL(localUrl).origin) {
      return; // Allow local dev server navigation
    }
    if (parsedUrl.protocol === 'file:') {
      return; // Allow local file navigation (dist/index.html)
    }
    event.preventDefault();
    console.warn(`[Security] Prevented navigation to ${url}`);
  });

  if (app.isPackaged) {
    win.loadFile(join(__dirname, '../../dist/index.html'))
  } else if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(url!)
    // win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(indexHtml)
  }
}

function compareSemVer(v1: string, v2: string) {
  const parse = (v: string) => v.replace(/^[vV]/, '').split('.').map(Number);
  const a = parse(v1);
  const b = parse(v2);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const numA = a[i] || 0;
    const numB = b[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

function checkLatestRelease(): Promise<{ version: string, url: string } | null> {
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

async function checkForUpdates() {
  const update = await checkLatestRelease();
  if (update && win && !win.isDestroyed()) {
    win.webContents.send('update-available', update);
  }
}

ipcMain.handle('check-for-updates', async () => {
  try {
    const update = await checkLatestRelease();
    if (update) {
      return { hasUpdate: true, version: update.version, url: update.url };
    } else {
      return { hasUpdate: false };
    }
  } catch (e: any) {
    return { hasUpdate: false, error: e.message };
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const pluginManager = new PluginManager();
  pluginManager.setupIPC();
  await pluginManager.loadPlugins();
  
  registerCryptoHandlers(ipcMain, app);
  registerSshHandlers(ipcMain, app, () => win);
  registerSftpHandlers(ipcMain);
  createWindow();
  
  checkForUpdates();
  setInterval(checkForUpdates, 12 * 60 * 60 * 1000); // Check every 12 hours
})

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (win === null) createWindow()
})

app.on('browser-window-blur', () => {
  if (win && !win.isDestroyed()) win.webContents.send('app-blur')
})

app.on('browser-window-focus', () => {
  if (win && !win.isDestroyed()) win.webContents.send('app-focus')
})

let backendConfig = { confirmQuit: false, globalHotkey: '' };

const registerHotkey = (key: string) => {
  globalShortcut.unregisterAll();
  if (key) {
    try {
      globalShortcut.register(key, () => {
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

ipcMain.on('update-backend-config', (event, config) => {
  backendConfig = { ...backendConfig, ...config };
  if (config.globalHotkey !== undefined) {
    registerHotkey(config.globalHotkey);
  }
})

// Theme integration
ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors)

nativeTheme.on('updated', () => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors)
  }
})
// File Selection Handler
ipcMain.handle('select-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: 'Select Private Key',
    properties: ['openFile', 'showHiddenFiles']
  })
  if (!canceled) {
    return filePaths[0]
  }
  return null
})

// Safe Storage Encryption Payload -> Zero-Knowledge Local AES has been extracted to cryptoHandler.ts

ipcMain.on('show-context-menu', (event) => {
  const template = [
    { role: 'copy' },
    { role: 'paste' }
  ];
  const menu = Menu.buildFromTemplate(template as any);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender)! });
})

ipcMain.on('open-external', (event, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(url);
    } else {
      console.warn(`[Security] Blocked attempt to open non-http(s) URL: ${url}`);
    }
  } catch (e) {
    console.error(`[Security] Invalid URL format rejected: ${url}`);
  }
})
