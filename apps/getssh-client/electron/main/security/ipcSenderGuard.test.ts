import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { IpcMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installIpcSenderGuard } from './ipcSenderGuard';

const ACTION = 'plugin-renderer:action';
type Listener = (event: any, ...args: any[]) => any;

/** ipcMain as far as the guard uses it: an EventEmitter, plus handle() and handleOnce() as Electron has them. */
class FakeIpcMain extends EventEmitter {
  handlers = new Map<string, Listener>();
  handle(channel: string, listener: Listener) {
    if (this.handlers.has(channel)) throw new Error(`a handler for ${channel} is already registered`);
    this.handlers.set(channel, listener);
  }
  // As Electron's: registered through this.handle, which the guard has wrapped by then, and
  // removed when it runs.
  handleOnce(channel: string, listener: Listener) {
    this.handle(channel, (event, ...args) => {
      this.handlers.delete(channel);
      return listener(event, ...args);
    });
  }
  async invoke(channel: string, event: unknown, ...args: unknown[]) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler(event, ...args);
  }
}

const mainWindow = { sender: { id: 1 }, senderFrame: { parent: null } };
const pluginPage = { sender: { id: 7 }, senderFrame: { parent: null } };
const subframe = { sender: { id: 1 }, senderFrame: { parent: {} } };

let ipc: FakeIpcMain;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ipc = new FakeIpcMain();
  installIpcSenderGuard(ipc as unknown as IpcMain, { isPluginPage: event => event?.sender?.id === 7, pluginPageChannel: ACTION });
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

const KEEPS = ['on', 'addListener', 'prependListener'] as const;
const ONCE = ['once', 'prependOnceListener'] as const;

describe('messages from a plugin\'s renderer.js page', () => {
  it.each([...KEEPS, ...ONCE])('reach %s listeners on its own channel only', method => {
    const other = vi.fn();
    const own = vi.fn();
    ipc[method]('ssh:connect', other);
    ipc[method](ACTION, own);

    ipc.emit('ssh:connect', pluginPage, 'host');
    expect(other).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(`[Security] Blocked IPC '${method}' message from a plugin's renderer.js page to channel: ssh:connect`);
    ipc.emit(ACTION, pluginPage, 'registerSidebarAction', {});
    expect(own).toHaveBeenCalledWith(pluginPage, 'registerSidebarAction', {});

    // The main window is heard as before; a refused message did not use up a once listener.
    ipc.emit('ssh:connect', mainWindow, 'host');
    ipc.emit('ssh:connect', mainWindow, 'again');
    const once = (ONCE as readonly string[]).includes(method);
    expect(other.mock.calls).toEqual(once ? [[mainWindow, 'host']] : [[mainWindow, 'host'], [mainWindow, 'again']]);
  });

  it('cannot invoke anything, its own channel included, while the main window can', async () => {
    const list = vi.fn(async () => ['vault']);
    const own = vi.fn(async () => 'answer');
    ipc.handle('vault:list', list);
    ipc.handle(ACTION, own);
    await expect(ipc.invoke('vault:list', pluginPage)).rejects.toThrow('Unauthorized IPC channel access from a plugin page');
    await expect(ipc.invoke(ACTION, pluginPage)).rejects.toThrow('Unauthorized IPC channel access from a plugin page');
    expect(list).not.toHaveBeenCalled();
    expect(own).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(`[Security] Blocked IPC 'handle' message from a plugin's renderer.js page to channel: vault:list`);
    await expect(ipc.invoke('vault:list', mainWindow)).resolves.toEqual(['vault']);

    const once = vi.fn(async () => 'once');
    ipc.handleOnce('vault:unlock', once);
    await expect(ipc.invoke('vault:unlock', pluginPage)).rejects.toThrow('Unauthorized IPC channel access from a plugin page');
    expect(once).not.toHaveBeenCalled();
    // The refused invoke did not use it up.
    await expect(ipc.invoke('vault:unlock', mainWindow)).resolves.toBe('once');
    await expect(ipc.invoke('vault:unlock', mainWindow)).rejects.toThrow('no handler for vault:unlock');
  });
});

describe('the M-11 subframe guard', () => {
  it('drops messages and refuses invokes from a subframe, on every channel', async () => {
    const listener = vi.fn();
    ipc.on('ssh:connect', listener);
    ipc.on(ACTION, listener);
    ipc.emit('ssh:connect', subframe);
    ipc.emit(ACTION, subframe);
    expect(listener).not.toHaveBeenCalled();
    ipc.handle('vault:list', async () => 'secret');
    await expect(ipc.invoke('vault:list', subframe)).rejects.toThrow('Unauthorized IPC channel access from subframe');
  });

  it('passes an event the main process emits itself', () => {
    const listener = vi.fn();
    ipc.on('app:quit', listener);
    ipc.emit('app:quit', undefined);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('removes a listener by the function it was given, a once listener too', () => {
    const kept = vi.fn();
    const removed = vi.fn();
    const offed = vi.fn();
    const once = vi.fn();
    ipc.on('ssh:data', kept);
    ipc.on('ssh:data', removed);
    ipc.addListener('ssh:data', offed);
    ipc.once('ssh:data', once);
    ipc.removeListener('ssh:data', removed);
    ipc.off('ssh:data', offed);
    ipc.removeListener('ssh:data', once);
    ipc.emit('ssh:data', mainWindow);
    expect(kept).toHaveBeenCalledOnce();
    expect(removed).not.toHaveBeenCalled();
    expect(offed).not.toHaveBeenCalled();
    expect(once).not.toHaveBeenCalled();
    expect(ipc.listenerCount('ssh:data')).toBe(1);
  });
});

describe('the app', () => {
  // index.ts cannot be loaded here; its text shows the guard is there, ahead of every handler.
  it('installs the guard in index.ts before anything registers on ipcMain', () => {
    const source = fs.readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8');
    const install = source.indexOf('\ninstallIpcSenderGuard(ipcMain, { isPluginPage: isPluginRendererSender, pluginPageChannel: PLUGIN_RENDERER_ACTION_CHANNEL })\n');
    expect(install).toBeGreaterThan(0);
    expect(install).toBeLessThan(source.indexOf('app.whenReady()'));
    expect(install).toBeLessThan(source.indexOf('registerAllIpcHandlers('));
  });
});
