import type { IpcMain } from 'electron';

/**
 * [M-11] Every IPC listener and handler of the main process hears the GETSSH window's top-level
 * frame only. A message from a subframe is dropped, and an invoke from one throws. A plugin's
 * renderer.js page (pluginRendererHost.ts) is a top-level frame too, in a WebContents of its own:
 * it may send on its one channel and nothing else, and invoke nothing. This is what stands when
 * such a renderer process is taken over, since its preload only sends on that channel.
 *
 * An event without a sender frame (one the main process emits itself) passes.
 */
export interface IpcSenderGuardOptions {
  /** True for an event from a plugin's renderer.js page (isPluginRendererSender). */
  isPluginPage: (event: any) => boolean;
  /** The one channel such a page may send on (PLUGIN_RENDERER_ACTION_CHANNEL). */
  pluginPageChannel: string;
}

type IpcListener = (event: any, ...args: any[]) => void;

const isSubframeIpcEvent = (event: any) => !!(event && event.senderFrame && event.senderFrame.parent !== null);

/** Wraps ipcMain's listener and handler methods. Call it before anything registers on ipcMain. */
export function installIpcSenderGuard(ipcMain: IpcMain, { isPluginPage, pluginPageChannel }: IpcSenderGuardOptions): void {
  // The guard wraps every listener, so keep original listener -> wrappers (per channel) for removeListener/off.
  const ipcListenerWrappers = new WeakMap<Function, Map<string | symbol, Function[]>>();

  function wrapIpcListener(kind: string, channel: string | symbol, listener: Function, run: IpcListener): IpcListener {
    const wrapper: IpcListener = (event, ...args) => {
      if (isSubframeIpcEvent(event)) {
        console.warn(`[Security] Blocked unauthorized IPC '${kind}' message from subframe to channel: ${String(channel)}`);
        return;
      }
      if (channel !== pluginPageChannel && isPluginPage(event)) {
        console.warn(`[Security] Blocked IPC '${kind}' message from a plugin's renderer.js page to channel: ${String(channel)}`);
        return;
      }
      run(event, ...args);
    };
    let byChannel = ipcListenerWrappers.get(listener);
    if (!byChannel) {
      byChannel = new Map();
      ipcListenerWrappers.set(listener, byChannel);
    }
    const wrappers = byChannel.get(channel) ?? [];
    wrappers.push(wrapper);
    byChannel.set(channel, wrappers);
    return wrapper;
  }

  /** The registered wrapper for `listener` (the given one, else the most recent), forgotten from the map. */
  function takeIpcListenerWrapper(channel: string | symbol, listener: Function, exact?: Function): (...args: any[]) => void {
    const byChannel = ipcListenerWrappers.get(listener);
    const wrappers = byChannel?.get(channel);
    if (!byChannel || !wrappers || wrappers.length === 0) return listener as (...args: any[]) => void;
    const index = exact ? wrappers.lastIndexOf(exact) : wrappers.length - 1;
    if (index < 0) return listener as (...args: any[]) => void;
    const [wrapper] = wrappers.splice(index, 1);
    if (wrappers.length === 0) byChannel.delete(channel);
    return wrapper as (...args: any[]) => void;
  }

  /** Throws for an invoke the guard refuses: from a subframe, or from a renderer.js page on any channel. */
  function checkInvoke(kind: string, channel: string, event: any): void {
    if (isSubframeIpcEvent(event)) {
      console.warn(`[Security] Blocked unauthorized IPC '${kind}' message from subframe to channel: ${channel}`);
      throw new Error('Unauthorized IPC channel access from subframe');
    }
    if (isPluginPage(event)) {
      console.warn(`[Security] Blocked IPC '${kind}' message from a plugin's renderer.js page to channel: ${channel}`);
      throw new Error('Unauthorized IPC channel access from a plugin page');
    }
  }

  const originalIpcOn = ipcMain.on.bind(ipcMain);
  ipcMain.on = (channel, listener) => {
    return originalIpcOn(channel, wrapIpcListener('on', channel, listener, listener));
  };

  const originalIpcRemoveListener = ipcMain.removeListener.bind(ipcMain);
  ipcMain.removeListener = (channel, listener) => {
    return originalIpcRemoveListener(channel, takeIpcListenerWrapper(channel, listener));
  };
  ipcMain.off = (channel, listener) => {
    return originalIpcRemoveListener(channel, takeIpcListenerWrapper(channel, listener));
  };

  const originalIpcHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    originalIpcHandle(channel, async (event, ...args) => {
      checkInvoke('handle', channel, event);
      return listener(event, ...args);
    });
  };

  // once/prependOnceListener are built on the guarded wrapper (not EventEmitter's own once wrapper), so a
  // blocked message does not consume them and removeListener(channel, listener) still finds them.
  ipcMain.once = (channel, listener) => {
    const wrapper: IpcListener = wrapIpcListener('once', channel, listener, (event, ...args) => {
      originalIpcRemoveListener(channel, takeIpcListenerWrapper(channel, listener, wrapper));
      listener(event, ...args);
    });
    return originalIpcOn(channel, wrapper);
  };

  const originalIpcHandleOnce = ipcMain.handleOnce.bind(ipcMain);
  ipcMain.handleOnce = (channel, listener) => {
    originalIpcHandleOnce(channel, async (event, ...args) => {
      checkInvoke('handleOnce', channel, event);
      return listener(event, ...args);
    });
  };

  const originalIpcAddListener = ipcMain.addListener.bind(ipcMain);
  ipcMain.addListener = (channel, listener) => {
    return originalIpcAddListener(channel, wrapIpcListener('addListener', channel, listener, listener));
  };

  const originalIpcPrependListener = ipcMain.prependListener.bind(ipcMain);
  ipcMain.prependListener = (channel, listener) => {
    return originalIpcPrependListener(channel, wrapIpcListener('prependListener', channel, listener, listener));
  };
  ipcMain.prependOnceListener = (channel, listener) => {
    const wrapper: IpcListener = wrapIpcListener('prependOnceListener', channel, listener, (event, ...args) => {
      originalIpcRemoveListener(channel as string, takeIpcListenerWrapper(channel, listener, wrapper));
      listener(event, ...args);
    });
    return originalIpcPrependListener(channel, wrapper);
  };
}
