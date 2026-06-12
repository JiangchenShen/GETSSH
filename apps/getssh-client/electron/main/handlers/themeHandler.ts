import { nativeTheme, BrowserWindow } from 'electron';

export function registerThemeHandlers(ipcMain: Electron.IpcMain, getWin: () => BrowserWindow | null) {
  ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors);

  nativeTheme.on('updated', () => {
    const win = getWin();
    if (win && !win.isDestroyed()) {
      win.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors);
    }
  });
}
