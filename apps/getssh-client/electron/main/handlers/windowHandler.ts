import { dialog, Menu, BrowserWindow, shell } from 'electron';
import os from 'os';

export function registerWindowHandlers(ipcMain: Electron.IpcMain, getWin: () => BrowserWindow | null) {
  // File Selection Handler
  ipcMain.handle('select-file', async () => {
    const win = getWin();
    if (!win) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Select Private Key',
      properties: ['openFile', 'showHiddenFiles']
    });
    if (!canceled) {
      return filePaths[0];
    }
    return null;
  });

  // Folder Selection Handler
  ipcMain.handle('select-folder', async () => {
    const win = getWin();
    if (!win) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Select Download Folder',
      properties: ['openDirectory', 'createDirectory']
    });
    if (!canceled) {
      return filePaths[0];
    }
    return null;
  });

  // Context Menu
  ipcMain.on('show-context-menu', (event, payload: any) => {
    const template: any[] = [
      { role: 'copy' },
      { role: 'paste' }
    ];

    if (payload && payload.extensions && payload.extensions.length > 0) {
      template.push({ type: 'separator' });
      for (const ext of payload.extensions) {
        template.push({
          label: ext.label,
          click: () => {
             ipcMain.emit('trigger-plugin-action', event, { pluginId: ext.pluginId, actionId: ext.actionId, contextData: payload.contextData });
          }
        });
      }
    }

    const menu = Menu.buildFromTemplate(template as any);
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin) {
      menu.popup({ window: senderWin });
    }
  });

  // Open External Links securely
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
  });
}

/**
 * Helper to determine native material support
 */
function getNativeGlassSupport(): 'vibrancy' | 'mica' | 'acrylic' | 'none' {
  if (process.platform === 'darwin') return 'vibrancy';
  if (process.platform === 'win32') {
    const buildNumber = parseInt(os.release().split('.')[2] || '0', 10);
    if (buildNumber >= 22000) return 'mica';
    if (buildNumber >= 17763) return 'acrylic'; // Windows 10 1809
  }
  return 'none';
}

/**
 * Extracted BrowserWindow options for cleaner index.ts
 */
export function getBrowserWindowOptions(preloadPath: string): Electron.BrowserWindowConstructorOptions {
  let width = 1280;
  let height = 800;
  try {
    const { screen } = require('electron');
    const workArea = screen.getPrimaryDisplay().workAreaSize;
    width = workArea.width;
    height = workArea.height;
  } catch (e) {}

  const glassSupport = getNativeGlassSupport();
  const isGlassSupported = glassSupport !== 'none';

  return {
    title: 'GETSSH',
    width,
    height,
    resizable: false,
    maximizable: false,
    fullscreenable: true,
    transparent: isGlassSupported,
    backgroundColor: isGlassSupported ? '#00000000' : '#09090b',
    vibrancy: glassSupport === 'vibrancy' ? 'fullscreen-ui' : undefined,
    backgroundMaterial: glassSupport === 'mica' || glassSupport === 'acrylic' ? glassSupport : undefined,
    titleBarStyle: 'hidden',
    frame: process.platform === 'darwin',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 16 } : undefined,
    titleBarOverlay: process.platform !== 'darwin' ? {
      color: '#00000000',
      symbolColor: '#ffffff',
      height: 32
    } : false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    },
  };
}

/**
 * Setup strict security policies for the webContents.
 */
export function setupSecurityPolicies(webContents: Electron.WebContents, devServerUrl?: string, indexHtmlPath?: string) {
  // Prevent arbitrary window spawning
  webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // Prevent arbitrary navigation within the main window
  webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (devServerUrl && parsedUrl.origin === new URL(devServerUrl).origin) {
      return; // Allow local dev server navigation
    }
    if (parsedUrl.protocol === 'file:') {
      try {
        const { fileURLToPath } = require('node:url');
        const { normalize } = require('node:path');
        if (indexHtmlPath && normalize(fileURLToPath(url)) === normalize(indexHtmlPath)) {
          return; // Allow ONLY the exact dist/index.html
        }
      } catch (e) {
        // Ignored, proceed to deny
      }
    }
    event.preventDefault();
    console.warn(`[Security] Prevented navigation to ${url}`);
  });
}

/**
 * Bind non-IPC window lifecycle events to the BrowserWindow instance.
 */
export function bindWindowEvents(win: BrowserWindow, confirmQuitProvider: () => boolean) {
  // Prevent Quit Logic Map
  win.on('close', (e) => {
    if (confirmQuitProvider()) {
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
  });

  // Fullscreen State Tracking
  win.on('enter-full-screen', () => {
    win.webContents.send('fullscreen-state', true);
  });
  win.on('leave-full-screen', () => {
    win.webContents.send('fullscreen-state', false);
  });
  
  // Capture console logs from the renderer
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message}`);
  });
}
