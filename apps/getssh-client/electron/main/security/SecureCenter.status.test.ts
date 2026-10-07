// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  spawn: vi.fn(),
  createServer: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
  backend: { pluginSecurityMode: 'safe' },
  knownSender: true,
  flushMetrics: vi.fn(),
  runtimeStatus: vi.fn(() => ({
    gateway: { mode: 'native', state: 'ready', lastSanitizedAt: null, lastFailureAt: null },
    stats: { runtimeHits: 3, todayHits: 7, totalHits: 23, persistence: 'available', startedAt: 1, day: '2026-10-05', lastFilteredAt: 2, recordedSince: 1 },
  })),
}));
vi.mock('electron', () => ({
  app: { isPackaged: false, getLocale: () => 'en-US' },
  ipcMain: { handle: (channel: string, listener: (...args: any[]) => any) => mocks.handlers.set(channel, listener) },
}));
vi.mock('child_process', () => ({ default: { spawn: mocks.spawn } }));
vi.mock('net', () => ({ default: { createServer: mocks.createServer } }));
vi.mock('fs', () => ({ default: { existsSync: mocks.existsSync, unlinkSync: mocks.unlinkSync } }));
vi.mock('os', () => ({ default: { platform: () => 'darwin', tmpdir: () => '/private/tmp' } }));
vi.mock('../handlers/systemHandler', () => ({ getBackendConfig: () => mocks.backend }));
vi.mock('../windowRegistry', () => ({ broadcastToAllWindows: vi.fn(), isKnownTopLevelSender: () => mocks.knownSender }));
vi.mock('../services/OceanSentinel', () => ({ OceanSentinel: { getRuntimeStatus: mocks.runtimeStatus, flushMetrics: mocks.flushMetrics } }));

type FakeSocket = EventEmitter & { destroyed: boolean; writable: boolean; write: ReturnType<typeof vi.fn> };
let child: EventEmitter & { pid: number; killed: boolean; exitCode: number | null; signalCode: string | null };
let server: EventEmitter & { listen: ReturnType<typeof vi.fn> };
let acceptSocket: (socket: FakeSocket) => void;
let originalArgv: string[];

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  originalArgv = [...process.argv];
  mocks.handlers.clear();
  mocks.backend.pluginSecurityMode = 'safe';
  mocks.knownSender = true;
  child = Object.assign(new EventEmitter(), { pid: 424242, killed: false, exitCode: null, signalCode: null });
  server = Object.assign(new EventEmitter(), { listen: vi.fn((_pipe, callback) => callback()) });
  mocks.spawn.mockReturnValue(child);
  mocks.existsSync.mockImplementation((file: string) => !file.endsWith('.sock'));
  mocks.createServer.mockImplementation((connected: typeof acceptSocket) => { acceptSocket = connected; return server; });
});
afterEach(() => {
  process.argv = originalArgv;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const newSocket = (): FakeSocket => Object.assign(new EventEmitter(), {
  destroyed: false,
  writable: true,
  write: vi.fn((_line: string, callback?: (error?: Error) => void) => { callback?.(); return true; }),
});
const readStatus = () => mocks.handlers.get('get-sentinel-status')!();
const start = async () => {
  const { SecureCenter } = await import('./SecureCenter');
  SecureCenter.getInstance().start();
};

describe('Ocean Sentinel status IPC', () => {
  it('flushes pending numeric metrics only on graceful shutdown, preserving the read-only status path', async () => {
    await start();
    readStatus();
    expect(mocks.flushMetrics).not.toHaveBeenCalled();
    const { SecureCenter } = await import('./SecureCenter');
    SecureCenter.getInstance().gracefulShutdown();
    expect(mocks.flushMetrics).toHaveBeenCalledTimes(1);
  });

  it('aggregates gateway metrics with actual watchdog and supervised process IDs without sending a PING', async () => {
    await start();
    const socket = newSocket();
    acceptSocket(socket);
    expect(readStatus()).toMatchObject({
      supervisorPid: child.pid,
      supervisedPid: process.pid,
      gateway: { mode: 'native', state: 'ready', lastSanitizedAt: null },
      stats: { runtimeHits: 3, todayHits: 7, totalHits: 23 },
    });
    expect(socket.write).not.toHaveBeenCalled();
    child.killed = true;
    expect(readStatus()).toMatchObject({ supervisorPid: null, daemonState: 'unavailable' });
  });

  it('rejects unknown IPC senders before exposing any gateway or process metadata', async () => {
    await start();
    mocks.knownSender = false;
    expect(() => readStatus()).toThrow(/Unauthorized/);
    expect(mocks.runtimeStatus).not.toHaveBeenCalled();
  });

  it('reports starting before connection and records only completed PING writes, not status reads', async () => {
    await start();
    expect(readStatus()).toMatchObject({ status: 'warning', daemonState: 'starting', lastPing: 0, sentinelDisabled: false });
    const socket = newSocket();
    acceptSocket(socket);
    expect(readStatus()).toMatchObject({ status: 'secure', daemonState: 'running', lastPing: 0 });
    expect(socket.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(readStatus().lastPing).toBe(1_700_000_001_000);
    vi.setSystemTime(1_700_000_100_000);
    expect(readStatus().lastPing).toBe(1_700_000_001_000);
    expect(socket.write).toHaveBeenCalledTimes(1);
    expect(socket.write).toHaveBeenCalledWith('PING\n', expect.any(Function));
  });

  it.each(['exit', 'process error', 'socket close', 'socket error'])('cannot report secure after %s', async failure => {
    await start();
    const socket = newSocket();
    acceptSocket(socket);
    expect(readStatus().status).toBe('secure');
    if (failure === 'exit') { child.exitCode = 1; child.emit('exit', 1); }
    else if (failure === 'process error') child.emit('error', new Error('spawn failed'));
    else if (failure === 'socket close') socket.emit('close');
    else socket.emit('error', new Error('socket failed'));
    expect(readStatus()).toMatchObject({ status: 'warning', daemonState: 'unavailable' });
  });

  it('also derives unavailability directly from dead child and destroyed socket properties', async () => {
    await start();
    const socket = newSocket();
    acceptSocket(socket);
    child.killed = true;
    expect(readStatus().daemonState).toBe('unavailable');
    child.killed = false;
    socket.destroyed = true;
    expect(readStatus()).toMatchObject({ status: 'warning', daemonState: 'unavailable' });
  });

  it('rejects a failed PING write without inventing a heartbeat timestamp', async () => {
    await start();
    const socket = newSocket();
    socket.write.mockImplementation((_line: string, callback: (error?: Error) => void) => { callback(new Error('EPIPE')); return false; });
    acceptSocket(socket);
    vi.advanceTimersByTime(1000);
    expect(readStatus()).toMatchObject({ status: 'warning', daemonState: 'unavailable', lastPing: 0 });
  });

  it('leaves the PING timestamp unset until its write callback completes', async () => {
    await start();
    const socket = newSocket();
    let finishWrite: () => void;
    socket.write.mockImplementation((_line: string, callback: typeof finishWrite) => { finishWrite = callback; return false; });
    acceptSocket(socket);
    vi.advanceTimersByTime(1000);
    expect(readStatus().lastPing).toBe(0);
    finishWrite!();
    expect(readStatus().lastPing).toBe(1_700_000_001_000);
  });

  it('ignores close, error and delayed write callbacks from a replaced socket', async () => {
    await start();
    const oldSocket = newSocket();
    let finishOldWrite: (error?: Error) => void;
    oldSocket.write.mockImplementation((_line: string, callback: typeof finishOldWrite) => { finishOldWrite = callback; return true; });
    acceptSocket(oldSocket);
    vi.advanceTimersByTime(1000);
    const currentSocket = newSocket();
    acceptSocket(currentSocket);
    oldSocket.emit('close');
    oldSocket.emit('error', new Error('retired socket'));
    finishOldWrite!(new Error('retired write'));
    expect(readStatus()).toMatchObject({ status: 'secure', daemonState: 'running', lastPing: 0 });
    vi.advanceTimersByTime(1000);
    expect(currentSocket.write).toHaveBeenCalledTimes(1);
    expect(readStatus().lastPing).toBe(1_700_000_002_000);
  });

  it('preserves alert warnings and omits historical level/reason after resolution', async () => {
    await start();
    const socket = newSocket();
    acceptSocket(socket);
    socket.emit('data', Buffer.from('LOCKDOWN_TRIGGER:YELLOW:blocked command\n'));
    expect(readStatus()).toMatchObject({ status: 'warning', daemonState: 'running', level: 'yellow' });
    expect(readStatus().reason).toContain('blocked command');
    socket.emit('data', Buffer.from('RESOLVED\n'));
    expect(readStatus()).toMatchObject({ status: 'secure', daemonState: 'running', level: undefined, reason: undefined });
  });

  it('does not revive a resolved alert when the daemon later disconnects', async () => {
    await start();
    const socket = newSocket();
    acceptSocket(socket);
    socket.emit('data', Buffer.from('LOCKDOWN_TRIGGER:RED:historical alert\n'));
    socket.emit('data', Buffer.from('RESOLVED\n'));
    socket.emit('close');
    expect(readStatus()).toMatchObject({ status: 'warning', daemonState: 'unavailable', level: undefined, reason: undefined });
  });

  it.each(['missing binary', 'safe mode'])('preserves the disabled state for %s', async cause => {
    if (cause === 'missing binary') mocks.existsSync.mockReturnValue(false);
    else process.argv.push('--safe-mode');
    await start();
    expect(readStatus()).toMatchObject({ status: 'warning', daemonState: 'disabled', sentinelDisabled: true, lastPing: 0 });
  });

  it('reports server startup errors as unavailable', async () => {
    await start();
    server.emit('error', new Error('listen failed'));
    expect(readStatus()).toMatchObject({ status: 'warning', daemonState: 'unavailable' });
  });

  it('reports a synchronous spawn failure as unavailable', async () => {
    mocks.spawn.mockImplementationOnce(() => { throw new Error('spawn failed'); });
    await start();
    expect(readStatus()).toMatchObject({ status: 'warning', daemonState: 'unavailable', lastPing: 0 });
  });
});
