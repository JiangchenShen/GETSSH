import { describe, expect, it, vi } from 'vitest';

// Telnet option negotiation answers a request only when it changes what was agreed, so a server
// that acknowledges every acknowledgement cannot keep the exchange going.

vi.mock('../services/ConnectionManager', () => ({ connectionManager: { sessions: new Map(), updatePowerSaveBlocker: vi.fn() } }));
vi.mock('../services/SSHBridge', () => ({ sshBridge: { emit: vi.fn(), cleanupSession: vi.fn() } }));
vi.mock('../services/SessionOutputBuffer', () => ({ emitSessionData: vi.fn() }));
vi.mock('../windowRegistry', () => ({ broadcastToAllWindows: vi.fn() }));

import { newTelnetStreamState, processTelnetData } from './ptyHandler';

const IAC = 0xff, DONT = 0xfe, DO = 0xfd, WONT = 0xfc, WILL = 0xfb, SB = 0xfa, SE = 0xf0;
const ECHO = 0x01, SGA = 0x03, TTYPE = 0x18, NAWS = 0x1f;

function connection() {
  const sent: number[][] = [];
  const socket = { write: (data: Buffer) => { sent.push([...data]); return true; } } as any;
  const state = newTelnetStreamState();
  const receive = (...bytes: number[]) => processTelnetData(Buffer.from(bytes), socket, state);
  return { sent, receive };
}

describe('telnet negotiation', () => {
  it('acknowledges each option once and stays quiet when the server repeats it', () => {
    const { sent, receive } = connection();
    receive(IAC, DO, SGA, IAC, WILL, ECHO);
    expect(sent).toEqual([[IAC, WILL, SGA], [IAC, DO, ECHO]]);
    // A server that acknowledges acknowledgements, a hundred times over.
    for (let i = 0; i < 100; i++) receive(IAC, DO, SGA, IAC, WILL, ECHO, IAC, DONT, NAWS, IAC, WONT, 0x22);
    expect(sent).toHaveLength(2);
  });

  it('refuses an unsupported option each time it is asked, up to three times', () => {
    const { sent, receive } = connection();
    for (let i = 0; i < 100; i++) receive(IAC, DO, NAWS, IAC, WILL, 0x22);
    expect(sent.filter(m => m[1] === WONT && m[2] === NAWS)).toHaveLength(3);
    expect(sent.filter(m => m[1] === DONT && m[2] === 0x22)).toHaveLength(3);
    expect(sent).toHaveLength(6);
  });

  it('answers TERMINAL-TYPE SEND with the terminal type', () => {
    const { sent, receive } = connection();
    receive(IAC, SB, TTYPE, 1, IAC, SE);
    expect(sent).toEqual([]);
    receive(IAC, DO, TTYPE);
    receive(IAC, SB, TTYPE, 1, IAC, SE);
    const isVt100 = [IAC, SB, TTYPE, 0, ...Buffer.from('vt100'), IAC, SE];
    expect(sent).toEqual([[IAC, WILL, TTYPE], isVt100, isVt100]);
  });

  it('sends the terminal type once and follows changes of mind', () => {
    const { sent, receive } = connection();
    receive(IAC, DO, TTYPE, IAC, DO, TTYPE);
    expect(sent).toEqual([[IAC, WILL, TTYPE], [IAC, SB, TTYPE, 0, ...Buffer.from('vt100'), IAC, SE]]);
    receive(IAC, WONT, ECHO);
    expect(sent).toHaveLength(2);
    receive(IAC, WILL, ECHO, IAC, WONT, ECHO, IAC, WONT, ECHO);
    expect(sent.slice(2)).toEqual([[IAC, DO, ECHO], [IAC, DONT, ECHO]]);
    receive(IAC, DONT, TTYPE);
    expect(sent.at(-1)).toEqual([IAC, WONT, TTYPE]);
  });

  it('still strips negotiation from the text', () => {
    const { receive } = connection();
    expect(receive(...Buffer.from('log'), IAC, DO, SGA, ...Buffer.from('in: '))).toBe('login: ');
  });
});
