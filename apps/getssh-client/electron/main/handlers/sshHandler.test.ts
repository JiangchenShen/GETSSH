import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// SSH through an HTTP proxy: a proxy that never answers the CONNECT, or refuses it, ends the
// connect attempt and frees its session entry. The OS probe reads a bounded amount.

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { id: 1 } }] },
  dialog: {},
  app: { getPath: () => '/nonexistent' },
  powerSaveBlocker: { start: () => 1, stop: () => {} },
}));
vi.mock('../services/savedConnection', () => ({ savedConnection: () => null }));
vi.mock('../services/getsshStore', () => ({ toStoreError: (error: unknown) => error }));
vi.mock('./ptyHandler', () => ({
  sessionProtocols: new Map(),
  spawnLocalTerminal: vi.fn(),
  spawnTelnetSession: vi.fn(),
  ptyWrite: vi.fn(),
  ptyResize: vi.fn(),
  ptyKill: vi.fn(),
}));
vi.mock('../services/SSHBridge', () => ({ sshBridge: { cleanupSession: vi.fn(), emit: vi.fn() } }));
vi.mock('../tidal/tidalBridge', () => ({ tidalBridge: { setSessionTerminator: vi.fn() } }));
vi.mock('../services/SessionOutputBuffer', () => ({ emitSessionData: vi.fn(), readScrollback: vi.fn(), dropSession: vi.fn() }));
vi.mock('../windowRegistry', () => ({ broadcastToAllWindows: vi.fn(), isKnownTopLevelSender: () => true }));

import { connectionManager } from '../services/ConnectionManager';
import { readOsRelease, registerSshHandlers } from './sshHandler';
import { EventEmitter } from 'node:events';

type Handler = (event: unknown, ...args: unknown[]) => Promise<any>;
const handlers = new Map<string, Handler>();
registerSshHandlers(
  { handle: (channel: string, run: Handler) => handlers.set(channel, run), on: () => {} } as any,
  {} as any,
  () => null,
);
const SENDER = { senderFrame: { parent: null }, sender: { id: 1, isDestroyed: () => false } };

let proxy: http.Server;
let port = 0;
const tunnels: Socket[] = [];
let reply: 'never' | 'refuse' = 'never';

beforeAll(async () => {
  proxy = http.createServer();
  proxy.on('connect', (_req, socket: Socket) => {
    tunnels.push(socket);
    if (reply === 'refuse') socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  port = (proxy.address() as AddressInfo).port;
});

afterEach(() => vi.useRealTimers());
afterAll(() => {
  tunnels.forEach(socket => socket.destroy());
  proxy.close();
});

const connect = () => handlers.get('ssh-connect')!(SENDER, {
  host: 'ssh.example.invalid', port: 22, username: 'u', password: 'p',
  proxyType: 'http', proxyHost: '127.0.0.1', proxyPort: port,
});

describe('SSH through an HTTP proxy', () => {
  it('gives up when the proxy never answers the CONNECT, and frees the session', async () => {
    reply = 'never';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const result = connect();
    await vi.waitFor(() => expect(tunnels.length).toBe(1));
    expect(connectionManager.sessions.size).toBe(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toEqual({ success: false, error: 'Timed out while waiting for handshake' });
    expect(connectionManager.sessions.size).toBe(0);
    await vi.waitFor(() => expect(tunnels[0].destroyed || tunnels[0].readableEnded).toBe(true));
  });

  it('reports a proxy that refuses the CONNECT instead of using its reply as a tunnel', async () => {
    reply = 'refuse';
    const result = await connect();
    expect(result.success).toBe(false);
    expect(result.error).toContain('407');
    expect(connectionManager.sessions.size).toBe(0);
  });
});

describe('readOsRelease', () => {
  const probe = () => Object.assign(new EventEmitter(), { close: vi.fn() });

  it('reads the whole file of a normal server', () => {
    const stream = probe();
    const done = vi.fn();
    readOsRelease(stream, done);
    stream.emit('data', Buffer.from('NAME="Ubuntu"\nID=ubuntu\n'));
    stream.emit('close');
    expect(done).toHaveBeenCalledExactlyOnceWith('NAME="Ubuntu"\nID=ubuntu\n');
  });

  it('stops at 16 K characters on a server that never stops talking', () => {
    const stream = probe();
    const done = vi.fn();
    readOsRelease(stream, done);
    for (let i = 0; i < 256; i++) stream.emit('data', Buffer.alloc(4096, 0x61));
    stream.emit('close');
    expect(done).toHaveBeenCalledOnce();
    expect(done.mock.calls[0][0]).toHaveLength(16 * 1024);
    expect(stream.close).toHaveBeenCalled();
  });

  it('gives up after 5 seconds of a channel that neither ends nor fills up', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stream = probe();
    const done = vi.fn();
    readOsRelease(stream, done);
    stream.emit('data', Buffer.from('ID=deb'));
    vi.advanceTimersByTime(5000);
    expect(done).toHaveBeenCalledExactlyOnceWith('ID=deb');
    expect(stream.close).toHaveBeenCalled();
  });
});
