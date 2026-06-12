import { BrowserWindow } from 'electron';
import { registerCryptoHandlers } from './cryptoHandler';
import { registerSshHandlers } from './sshHandler';
import { registerSftpHandlers } from './sftpHandler';
import { registerProfileHandlers } from './profileHandler';
import { registerSystemHandlers } from './systemHandler';
import { registerThemeHandlers } from './themeHandler';
import { registerWindowHandlers } from './windowHandler';

/**
 * Central Registry for all Main Process IPC handlers.
 * Promotes Domain-Driven Design and keeps the main entry file clean.
 */
export function registerAllIpcHandlers(ipcMain: Electron.IpcMain, app: Electron.App, getWin: () => BrowserWindow | null) {
  // Security/Crypto Handlers
  registerCryptoHandlers(ipcMain, app);
  
  // Connection Handlers
  registerSshHandlers(ipcMain, app, getWin);
  registerSftpHandlers(ipcMain);
  
  // Storage Handlers
  registerProfileHandlers(ipcMain);
  
  // System/App Lifecycle Handlers
  registerSystemHandlers(ipcMain, app, getWin);
  
  // UI/Theme Handlers
  registerThemeHandlers(ipcMain, getWin);
  
  // Window/Native OS Interactions
  registerWindowHandlers(ipcMain, getWin);
}
