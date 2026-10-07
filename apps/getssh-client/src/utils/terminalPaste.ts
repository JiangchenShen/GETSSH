/**
 * Keyboard and menu paste into the terminal. xterm sends the clipboard text as it is, so text
 * holding ESC could end bracketed paste early (ESC[201~) and have the shell run the rest as typed
 * commands. Such a paste goes to xterm without its ESC characters; other pastes are left to xterm.
 * The right-click paste does the same in the main process (terminalPasteHandler.textForPaste).
 */
export function sanitizePasteEvent(event: ClipboardEvent, paste: (text: string) => void): void {
  const text = event.clipboardData?.getData('text/plain');
  if (!text || !text.includes('\x1b')) return;
  event.preventDefault();
  event.stopPropagation();
  paste(text.replace(/\x1b/g, ''));
}
