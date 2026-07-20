import { BrowserWindow } from 'electron';
import { registerCryptoHandlers } from './cryptoHandler';
import { registerSshHandlers } from './sshHandler';
import { registerSftpHandlers } from './sftpHandler';
import { registerProfileHandlers } from './profileHandler';
import { registerSystemHandlers } from './systemHandler';
import { registerThemeHandlers } from './themeHandler';
import { registerWindowHandlers } from './windowHandler';
import { registerAiHandlers } from './aiHandler';
import { setupWorkspaceHandlers } from './workspaceHandler';
import { registerAgentHandlers } from '../services/AgentExecutor';
import { registerAppHandlers } from './appHandler';

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

  // AI Center Security Gateway
  registerAiHandlers(ipcMain, getWin);

  // Workspace 2.0 Engine
  setupWorkspaceHandlers();

  // App-Level Settings Engine
  registerAppHandlers();

  // Agentic Execution Shell & TECTONIUM Integration
  registerAgentHandlers(ipcMain);
}
