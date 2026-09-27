import { ipcMain } from 'electron';
import { DatabaseManager } from '../services/DatabaseManager';
import { isMainWebContents } from '../windowRegistry';

export function registerAppHandlers() {
  ipcMain.handle('app:getGlobalSetting', async (event, key: string) => {
    try {
      return DatabaseManager.getGlobalSetting(key);
    } catch (e) {
      console.error(`[App IPC] Failed to get global setting ${key}`, e);
      return null;
    }
  });

  ipcMain.handle('app:setGlobalSetting', async (event, key: string, value: string) => {
    // Global settings (e.g. the app boot password hash) are only changed from the main window.
    if (!isMainWebContents(event.sender)) return { success: false, error: 'unauthorized' };
    try {
      DatabaseManager.setGlobalSetting(key, value);
      return { success: true };
    } catch (e) {
      console.error(`[App IPC] Failed to set global setting ${key}`, e);
      return { success: false, error: String(e) };
    }
  });
}
