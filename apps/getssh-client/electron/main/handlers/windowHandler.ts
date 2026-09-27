import { dialog, Menu, BrowserWindow, shell, app, nativeTheme } from 'electron';
import os from 'os';
import { windowForSender } from '../windowRegistry';

export function registerWindowHandlers(ipcMain: Electron.IpcMain, getWin: () => BrowserWindow | null) {
  // File Selection Handler (parented to the window that asked, torn windows included)
  ipcMain.handle('select-file', async (event) => {
    const win = windowForSender(event.sender) ?? getWin();
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
  ipcMain.handle('select-folder', async (event) => {
    const win = windowForSender(event.sender) ?? getWin();
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
 * Windows caption-button overlay. The glyph color follows the effective theme so the buttons stay visible
 * on the light background.
 */
export function getTitleBarOverlay(): Electron.TitleBarOverlay {
  return {
    color: '#00000000',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#18181b',
    height: 32
  };
}

/**
 * Solid window background for windows that cannot be transparent, matching the renderer's base colour
 * for the effective theme (dark #09090b / light #f4f4f5).
 */
export function getOpaqueBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#09090b' : '#f4f4f5';
}

/**
 * Options for a torn-off window: the shared options, but resizable. On Windows, Electron cannot resize
 * transparent windows, so torn windows there are opaque; mica/acrylic would be hidden behind the opaque
 * background (alpha is ignored without `transparent`), so the material is dropped too.
 */
export function getTornWindowOptions(preloadPath: string): Electron.BrowserWindowConstructorOptions {
  const options = getBrowserWindowOptions(preloadPath);
  options.resizable = true;
  options.maximizable = true;
  if (process.platform === 'win32') {
    options.transparent = false;
    options.backgroundMaterial = undefined;
    options.backgroundColor = getOpaqueBackgroundColor();
  }
  return options;
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
    titleBarOverlay: process.platform === 'win32' ? getTitleBarOverlay() : false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
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

  // [L-04] Security Fix: Disable DevTools and Reload in production environment globally
  if (app.isPackaged) {
    webContents.on('devtools-opened', () => {
      webContents.closeDevTools();
    });

    webContents.on('before-input-event', (event, input) => {
      const isDevTools =
        (input.control && input.shift && input.key.toLowerCase() === 'i') ||
        (input.meta && input.alt && input.key.toLowerCase() === 'i') ||
        input.key === 'F12';
      const isReload =
        (input.control && input.key.toLowerCase() === 'r') ||
        (input.meta && input.key.toLowerCase() === 'r') ||
        input.key === 'F5';

      if (isDevTools || isReload) {
        event.preventDefault();
      }
    });
  }

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
 * Bind non-IPC window lifecycle events to the BrowserWindow instance (main and torn windows).
 * The confirm-quit prompt is not here: it runs once per quit in the app's 'before-quit' handler.
 */
export function bindWindowEvents(win: BrowserWindow) {
  // Fullscreen State Tracking
  const sendFullscreenState = (isFullscreen: boolean) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('fullscreen-state', isFullscreen);
    }
  };
  win.on('enter-full-screen', () => sendFullscreenState(true));
  win.on('leave-full-screen', () => sendFullscreenState(false));
  
  // Capture console logs from the renderer
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message}`);
  });
}
