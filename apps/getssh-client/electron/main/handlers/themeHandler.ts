import { nativeTheme, BrowserWindow } from 'electron';

export function registerThemeHandlers(ipcMain: Electron.IpcMain, getWin: () => BrowserWindow | null) {
  ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors);
  ipcMain.handle('set-theme', (_, theme: 'system' | 'light' | 'dark') => {
    nativeTheme.themeSource = theme;
  });

  nativeTheme.on('updated', () => {
    const win = getWin();
    if (win && !win.isDestroyed()) {
      win.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors);
    }
  });
}
