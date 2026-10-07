import { clipboard, type IpcMain } from 'electron';
import { isKnownTopLevelSender } from '../windowRegistry';
import { sessionInput } from './sshHandler';

/**
 * What a paste sends to the terminal, as xterm does for a keyboard paste: line breaks become CR,
 * and in bracketed paste mode the text is wrapped in ESC[200~ … ESC[201~. ESC characters are
 * removed from the text itself, so it cannot end the bracket early (with ESC[201~, or with pieces
 * that form one once a marker between them is removed) and have the shell run what follows as
 * typed commands. Keyboard paste does the same in the renderer (src/utils/terminalPaste.ts).
 */
export function textForPaste(text: string, bracketed: boolean): string {
  const body = text.replace(/\x1b/g, '').replace(/\r?\n/g, '\r');
  return bracketed ? `\x1b[200~${body}\x1b[201~` : body;
}

/**
 * Paste from the terminal's right-click menu. The main process reads the clipboard and writes it
 * to the session, so the text never reaches the renderer, which has no clipboard-read permission
 * (windowHandler.denyClipboardRead). Keyboard paste goes through the browser's paste event, which
 * needs no permission. Returns whether anything was written.
 */
export function registerTerminalPasteHandler(ipcMain: IpcMain) {
  ipcMain.handle('terminal:paste', async (event, payload: unknown) => {
    if (!isKnownTopLevelSender(event)) return false;
    const { sessionId, bracketed } = (payload ?? {}) as { sessionId?: unknown; bracketed?: unknown };
    if (typeof sessionId !== 'string' || typeof bracketed !== 'boolean') return false;
    const write = sessionInput(sessionId);
    if (!write) return false;
    const text = await clipboard.readText();
    if (!text) return false;
    write(textForPaste(text, bracketed));
    return true;
  });
}
