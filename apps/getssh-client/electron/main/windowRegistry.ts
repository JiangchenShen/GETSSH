import { BrowserWindow, WebContents } from 'electron';

/**
 * Single place that knows which BrowserWindow is the main window.
 *
 * Torn-off windows are ordinary BrowserWindows too, so `BrowserWindow.getAllWindows()[0]`
 * or a module-level `win` that outlives its window are not reliable ways to reach the
 * main UI. Everything that must target "the main window" or "every window" goes through here.
 */
let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null) {
  mainWindow = win;
}

export function getMainWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return null;
  return mainWindow;
}

export function isMainWebContents(webContents: WebContents | null | undefined): boolean {
  const main = getMainWindow();
  return !!main && !!webContents && main.webContents.id === webContents.id;
}

/** True when the IPC event comes from the top-level frame of one of our own windows. */
export function isKnownTopLevelSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  if (!event || !event.sender) return false;
  if (event.senderFrame && event.senderFrame.parent !== null) return false;
  return BrowserWindow.getAllWindows().some(
    w => !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.id === event.sender.id
  );
}

/** The window that owns `webContents`, falling back to the main window. */
export function windowForSender(webContents: WebContents | null | undefined): BrowserWindow | null {
  if (webContents && !webContents.isDestroyed()) {
    const owner = BrowserWindow.fromWebContents(webContents);
    if (owner && !owner.isDestroyed()) return owner;
  }
  return getMainWindow();
}

export function broadcastToAllWindows(channel: string, ...args: unknown[]) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed() || w.webContents.isDestroyed()) continue;
    try {
      w.webContents.send(channel, ...args);
    } catch {
      // Window is tearing down; nothing to deliver to.
    }
  }
}

export function sendToMainWindow(channel: string, ...args: unknown[]) {
  const main = getMainWindow();
  if (!main) return;
  try {
    main.webContents.send(channel, ...args);
  } catch {
    // Main window is tearing down.
  }
}
