import type { BrowserWindow, IpcMain } from 'electron';
import { DatabaseManager } from '../services/DatabaseManager';
import { getActiveWorkspaceId } from './workspaceHandler';

export function registerAssetFolderHandlers(ipcMain: IpcMain, getWin: () => BrowserWindow | null) {
  const handle = (channel: string, action: (workspaceId: string, ...args: unknown[]) => object) => {
    ipcMain.handle(channel, (event, expectedWorkspaceId: unknown, ...args: unknown[]) => {
      try {
        const main = getWin()?.webContents;
        if (!main || event.sender !== main || event.senderFrame !== main.mainFrame) {
          throw new Error('Asset folder request denied');
        }
        const workspaceId = getActiveWorkspaceId();
        if (typeof expectedWorkspaceId !== 'string' || expectedWorkspaceId !== workspaceId) {
          throw new Error('Workspace changed. Refresh assets and try again.');
        }
        return { success: true, ...action(workspaceId, ...args) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  };

  handle('asset-folders:list', workspaceId => ({ folders: DatabaseManager.getAssetFolders(workspaceId) }));
  handle('asset-folders:create', (workspaceId, path) => DatabaseManager.createAssetFolder(workspaceId, path as string));
  handle('asset-folders:rename', (workspaceId, path, name) => DatabaseManager.renameAssetFolder(workspaceId, path as string, name as string));
  handle('asset-folders:remove', (workspaceId, path) => DatabaseManager.removeAssetFolder(workspaceId, path as string));
  handle('asset-folders:move-profile', (workspaceId, profileId, path) => DatabaseManager.moveProfileToAssetFolder(workspaceId, profileId as string, path as string | null));
  handle('asset-folders:move-profiles', (workspaceId, profileIds, path) => DatabaseManager.moveProfilesToAssetFolder(workspaceId, profileIds as string[], path as string | null));
}
