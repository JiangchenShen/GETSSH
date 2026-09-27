import { nativeTheme, BrowserWindow } from 'electron';
import { broadcastToAllWindows } from '../windowRegistry';
import { getTitleBarOverlay } from './windowHandler';

/** Windows draws the caption buttons itself; keep their glyph color in step with the theme in every window. */
function syncTitleBarOverlays() {
  if (process.platform !== 'win32') return;
  const overlay = getTitleBarOverlay();
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    try {
      w.setTitleBarOverlay(overlay);
    } catch {
      // Window was created without an overlay.
    }
  }
}

export function registerThemeHandlers(ipcMain: Electron.IpcMain, _getWin: () => BrowserWindow | null) {
  ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors);
  ipcMain.handle('set-theme', (_, theme: 'system' | 'light' | 'dark') => {
    nativeTheme.themeSource = theme;
    syncTitleBarOverlays();
  });

  nativeTheme.on('updated', () => {
    broadcastToAllWindows('theme-changed', nativeTheme.shouldUseDarkColors);
    syncTitleBarOverlays();
  });
}
