import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginManager } from './PluginManager'
import { registerAllIpcHandlers } from './handlers'
import { getBackendConfig } from './handlers/systemHandler'
import { getBrowserWindowOptions, bindWindowEvents, setupSecurityPolicies } from './handlers/windowHandler'

if (process.platform !== 'darwin' && process.platform !== 'win32') {
  const message = `GETSSH desktop is unsupported on ${process.platform}.`;
  console.error(message);
  app.exit(1);
  throw new Error(message);
}

process.env.DIST_ELECTRON = join(__dirname, '..')
process.env.DIST = join(process.env.DIST_ELECTRON, '../dist')

protocol.registerSchemesAsPrivileged([
  { scheme: 'getssh-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }
])

// Prevent background throttling for SSH persistence
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// Force Global GPU Acceleration (Frontend Rendering)
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('disable-software-rasterizer')

// [M-11] Security Fix: Enforce senderFrame validation globally for all IPC channels
// Only allow IPC messages from the top-level frame (the GETSSH UI).
// If event is null/undefined (e.g., emitted internally by main process), skip this check
const isSubframeIpcEvent = (event: any) => !!(event && event.senderFrame && event.senderFrame.parent !== null);

type IpcListener = (event: any, ...args: any[]) => void;
// The guard wraps every listener, so keep original listener -> wrappers (per channel) for removeListener/off.
const ipcListenerWrappers = new WeakMap<Function, Map<string | symbol, Function[]>>();

function wrapIpcListener(kind: string, channel: string | symbol, listener: Function, run: IpcListener): IpcListener {
  const wrapper: IpcListener = (event, ...args) => {
    if (isSubframeIpcEvent(event)) {
      console.warn(`[Security] Blocked unauthorized IPC '${kind}' message from subframe to channel: ${String(channel)}`);
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
    if (event && event.senderFrame && event.senderFrame.parent !== null) {
      console.warn(`[Security] Blocked unauthorized IPC 'handle' message from subframe to channel: ${channel}`);
      throw new Error('Unauthorized IPC channel access from subframe');
    }
    return listener(event, ...args);
  });
};

// once/prependOnceListener are built on the guarded wrapper (not EventEmitter's own once wrapper), so a
// blocked subframe message does not consume them and removeListener(channel, listener) still finds them.
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
    if (event && event.senderFrame && event.senderFrame.parent !== null) {
      console.warn(`[Security] Blocked unauthorized IPC 'handleOnce' message from subframe to channel: ${channel}`);
      throw new Error('Unauthorized IPC channel access from subframe');
    }
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

// macOS: safeStorage keys live in the real Keychain. The --use-mock-keychain switch used before 3.0
// derived every key from a public constant, so anyone with the files could decrypt the app key and
// saved master passwords. Blobs written that way are upgraded on first read (security/secretStore).
// An unsigned build is asked for Keychain access again after each update.

process.on('uncaughtException', (err) => {
  console.error("Critical Uncaught Exception: ", err)
})
process.on('unhandledRejection', (err) => {
  console.error("Critical Unhandled Rejection: ", err)
})
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST

const preload = join(__dirname, '../preload/index.js')
const url = process.env.VITE_DEV_SERVER_URL
const indexHtml = join(process.env.DIST, 'index.html')

function createWindow() {
  const options = getBrowserWindowOptions(preload);
  options.show = false;
  const win = new BrowserWindow(options);
  setMainWindow(win);
  
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });

  // Closing the main window quits the app (torn windows close with it), through the same
  // confirm-quit / teardown flow as Cmd+Q.
  win.on('close', (e) => {
    if (quitConfirmed) return;
    e.preventDefault();
    setImmediate(() => app.quit());
  });
  win.on('closed', () => {
    setMainWindow(null);
  });
  
  setupSecurityPolicies(win.webContents, process.env.VITE_DEV_SERVER_URL, indexHtml);
  bindWindowEvents(win);

  if (app.isPackaged) {
    win.loadFile(join(__dirname, '../../dist/index.html'))
  } else if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(url!)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(indexHtml)
  }

  // Native macOS Application Menu
  if (process.platform === 'darwin') {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          // [L-04] Security Fix: Disable DevTools and Reload in production environment
          ...(app.isPackaged ? [] : [
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' }
          ] as any),
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Learn More',
            click: async () => {
              await shell.openExternal('https://github.com/JiangchenShen/GETSSH')
            }
          }
        ]
      }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    Menu.setApplicationMenu(null);
  }
}


import { SecureCenter } from './security/SecureCenter'
import { nexusBridge } from './nexus/nexusBridge'
import { TornWindowManager } from './windowManager'
import { broadcastToAllWindows, getMainWindow, setMainWindow } from './windowRegistry'
import { killAllSessions } from './handlers/sshHandler'
import { bootstrapAppWorkspace } from './handlers/workspaceHandler'
import { appLock } from './security/appLock'
import { mcpManager } from './services/mcp/McpManager'
import { startStore } from './services/getsshStore'
import { clearCopiedSecret } from './handlers/storeHandler'
import {
  runPackagedStartupSmoke,
  shouldRunPackagedStartupSmoke,
  writePackagedStartupSmokeResult,
} from './startupSmoke'

app.whenReady().then(async () => {
  if (shouldRunPackagedStartupSmoke(app.isPackaged)) {
    try {
      const result = await runPackagedStartupSmoke();
      writePackagedStartupSmokeResult(result);
      console.log('[StartupSmoke] Packaged runtime validation passed.');
      app.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      try {
        writePackagedStartupSmokeResult({
          status: 'error',
          platform: process.platform,
          arch: process.arch,
          electron: process.versions.electron || 'unknown',
          error: message,
        });
      } catch (writeError) {
        console.error('[StartupSmoke] Failed to write result:', writeError);
      }
      console.error('[StartupSmoke] Packaged runtime validation failed:', error);
      app.exit(1);
    }
    return;
  }

  Menu.setApplicationMenu(null);

  // Setup IPC Handlers before window creation to ensure early IPC works.
  // None of these depend on the database; plugins are only loaded after bootstrap below.
  registerAllIpcHandlers(ipcMain, app, () => getMainWindow());
  // Only the in-memory fake for now (GETSSH_FAKE_STORE=1 in development); see services/getsshStore.ts.
  startStore().catch(error => console.error('[Main] getssh-store did not start:', error));
  nexusBridge.setupIpcHandlers();
  nexusBridge.setupStateBroadcaster();
  TornWindowManager.getInstance().init();

  const pluginManager = new PluginManager();
  pluginManager.setupIPC();
  SecureCenter.getInstance().setPluginTeardown(() => pluginManager.forceKillAll());
  
  // Show UI instantly without waiting for heavy async operations
  createWindow();
  
  // Init GETSSH Secure Center (RASP)
  SecureCenter.getInstance().start();

  // Init Model Context Protocol (MCP) Manager
  mcpManager.init().catch(err => {
    console.warn('[Main] MCP Manager init error:', err);
  });
  
  // Nothing is decrypted before the keystore says so: without a master password the device key
  // opens the data right away; with one, the window shows the lock screen until it is unlocked.
  // Workspace bootstrap and plugins wait for the first unlock.
  appLock.onFirstReady(async () => {
    try {
      await bootstrapAppWorkspace();
      await pluginManager.loadPlugins();
    } finally {
      pluginManager.markInitialLoadDone();
    }
  });
  appLock.start().then(() => {
    if (appLock.state().phase === 'error') {
      dialog.showErrorBox(
        'GETSSH could not open its data',
        'GETSSH could not open its encrypted data. Nothing was changed. Details: ' + (appLock.state().error || 'unknown error'),
      );
    }
  });

  protocol.handle('getssh-plugin', (request) => {
    try {
      const parsedUrl = new URL(request.url);
      const pluginId = parsedUrl.hostname;
      const pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      
      const pluginsDir = join(app.getPath('userData'), 'plugins');
      const pluginPath = join(pluginsDir, pluginId, pathname);
      
      // Prevent Path Traversal (C-01)
      if (!pluginPath.startsWith(pluginsDir + require('path').sep)) {
        return new Response('Forbidden', { status: 403 });
      }

    if (pluginPath.toLowerCase().endsWith('.html') || pluginPath.toLowerCase().endsWith('.htm')) {
      return require('fs').promises.readFile(pluginPath, 'utf-8').then((text: string) => {
        const injection = `
          <script>
            (function() {
              // #1 FIX: pluginId is JSON-encoded server-side — no XSS via plugin directory names
              var PLUGIN_ID = ${JSON.stringify(pluginId).replace(/</g, '\\u003c')};
              // #2 FIX: Capture and verify parent origin once at load time
              var PARENT_ORIGIN = (typeof location !== 'undefined' && location.ancestorOrigins && location.ancestorOrigins.length > 0) ? location.ancestorOrigins[0] : (document.referrer ? new URL(document.referrer).origin : '*');
              
              window.__GETSSH_LOCALE = navigator.language;
              window.__themeListeners = [];
              window.__sidebarHandlers = {};

              window.GETSSH = {
                _callbacks: {},
                _reqId: 0,
                _backendListeners: [],
                invokeBackend: function(method, payload) {
                  return new Promise((resolve, reject) => {
                    const reqId = ++this._reqId;
                    this._callbacks[reqId] = { resolve, reject };
                    window.parent.postMessage({
                      type: 'rpc-invoke',
                      pluginId: PLUGIN_ID,
                      method: method,
                      payload: payload,
                      reqId: reqId
                    }, PARENT_ORIGIN);
                  });
                },
                onBackendMessage: function(callback) {
                  this._backendListeners.push(callback);
                },
                registerPanel: function(panelId, title, renderUrl) {
                  window.parent.postMessage({ __getssh_plugin: true, pluginId: PLUGIN_ID, action: "registerPanel", payload: { panelId, title, renderUrl } }, PARENT_ORIGIN);
                },
                openPanel: function(panelId) {
                  window.parent.postMessage({ __getssh_plugin: true, pluginId: PLUGIN_ID, action: "openPanel", payload: { panelId } }, PARENT_ORIGIN);
                },
                registerSidebarAction: function(id, icon, label) {
                  window.parent.postMessage({ __getssh_plugin: true, pluginId: PLUGIN_ID, action: "registerSidebarAction", payload: { id, icon, label } }, PARENT_ORIGIN);
                },
                showNotification: function(title, body) {
                  window.parent.postMessage({ __getssh_plugin: true, pluginId: PLUGIN_ID, action: "showNotification", payload: { title, body } }, PARENT_ORIGIN);
                },
                getLocale: function() {
                  return window.__GETSSH_LOCALE;
                },
                onThemeChange: function(callback) {
                  window.__themeListeners.push(callback);
                }
              };

              window.addEventListener('message', (e) => {
                if (e.source !== window.parent || (PARENT_ORIGIN !== '*' && e.origin !== PARENT_ORIGIN)) return;
                const data = e.data;
                
                // RPC and Backend Messages
                if (data && data.type === 'rpc-response') {
                  const cb = window.GETSSH._callbacks[data.reqId];
                  if (cb) {
                    if (data.error) cb.reject(new Error(data.error));
                    else cb.resolve(data.result);
                    delete window.GETSSH._callbacks[data.reqId];
                  }
                } else if (data && data.type === 'backend-message') {
                  window.GETSSH._backendListeners.forEach(fn => fn(data.payload));
                }
                
                // Host UI/Env Messages
                if (data && data.__getssh_host) {
                  if (data.event === "sidebarClick") {
                    var handler = window.__sidebarHandlers[data.actionId];
                    if (handler) handler();
                  } else if (data.event === "envChange") {
                    if (data.locale) window.__GETSSH_LOCALE = data.locale;
                    if (data.theme) {
                      window.__themeListeners.forEach(cb => cb(data.theme));
                    }
                  }
                }
                
                // Also handle direct host:theme-change from PluginPane
                if (data && data.type === 'host:theme-change' && data.payload) {
                   window.__themeListeners.forEach(cb => cb(data.payload));
                }
              });
            })();
          </script>
        `;
        const modifiedText = text.includes('<head>') 
          ? text.replace('<head>', '<head>' + injection)
          : injection + text;
          
        return new Response(modifiedText, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }).catch((e: Error) => {
        return new Response(e.message, { status: 404 });
      });
    }
    
    // For non-HTML files, fetch manually to ensure correct MIME types on macOS
    return require('fs').promises.readFile(pluginPath).then((data: Buffer) => {
      let contentType = 'application/octet-stream';
      if (pluginPath.endsWith('.js')) contentType = 'application/javascript; charset=utf-8';
      else if (pluginPath.endsWith('.css')) contentType = 'text/css; charset=utf-8';
      else if (pluginPath.endsWith('.json')) contentType = 'application/json; charset=utf-8';
      else if (pluginPath.endsWith('.svg')) contentType = 'image/svg+xml';
      else if (pluginPath.endsWith('.png')) contentType = 'image/png';
      else if (pluginPath.endsWith('.jpg') || pluginPath.endsWith('.jpeg')) contentType = 'image/jpeg';
      
      return new Response(data as any, {
        headers: { 'content-type': contentType }
      });
    }).catch(() => new Response('Not Found', { status: 404 }));
    } catch (e: any) {
      return new Response('Bad Request: ' + e.message, { status: 400 });
    }
  });
})

// Quit flow (Cmd+Q, closing the main window, window-all-closed):
// 1. 'before-quit' asks once when Confirm Quit is on. Cancel prevents the quit and nothing is torn down.
// 2. Electron closes every window (torn windows do not close their tabs while quitting).
// 3. 'will-quit' runs the teardown once and waits for it (bounded) before the app really quits.
let quitConfirmed = false
let quitPromptOpen = false
let quitTeardownStarted = false
let quitTeardownDone = false
const QUIT_TEARDOWN_TIMEOUT_MS = 3000

app.on('before-quit', (e) => {
  if (!quitConfirmed && (getBackendConfig().confirmQuit ?? false)) {
    e.preventDefault();
    if (quitPromptOpen) return;
    quitPromptOpen = true;
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: ['Cancel', 'Quit'],
      defaultId: 1,
      cancelId: 0,
      title: 'Confirm Quit',
      message: 'Are you sure you want to quit GETSSH?',
      detail: 'All active SSH terminal connections and running tasks will be disconnected immediately.'
    };
    const parent = BrowserWindow.getFocusedWindow() ?? getMainWindow();
    (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options))
      .then(({ response }) => {
        quitPromptOpen = false;
        if (response !== 1) return;
        quitConfirmed = true;
        app.quit();
      })
      .catch((err) => {
        quitPromptOpen = false;
        console.error('[Main] Confirm-quit dialog failed:', err);
      });
    return;
  }
  quitConfirmed = true;
  TornWindowManager.getInstance().prepareForQuit();
})

async function runQuitTeardown() {
  // A password copied from the reveal dialog less than 30 s ago must not outlive the app.
  await clearCopiedSecret().catch(err => console.warn('[Main] Clipboard cleanup failed:', err));
  // Gracefully deactivate all plugins and release the watchdog before the process exits
  try {
    SecureCenter.getInstance().gracefulShutdown();
  } catch (err) {
    console.error('[Main] Secure Center shutdown failed:', err);
  }
  // Clean up all sessions (PTY/SSH/Telnet) so audit records are flushed and no zombie processes remain
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[Main] Session teardown still running after ${QUIT_TEARDOWN_TIMEOUT_MS} ms; quitting anyway.`);
      resolve();
    }, QUIT_TEARDOWN_TIMEOUT_MS);
  });
  const sessions = Promise.resolve()
    .then(() => killAllSessions(app))
    .catch((err) => console.error('[Main] Session teardown failed:', err));
  await Promise.race([sessions, timeout]);
  clearTimeout(timer);
}

app.on('will-quit', (e) => {
  if (quitTeardownDone) return;
  e.preventDefault();
  if (quitTeardownStarted) return;
  quitTeardownStarted = true;
  runQuitTeardown().finally(() => {
    quitTeardownDone = true;
    app.quit();
  });
})

app.on('window-all-closed', () => {
  // Normally the main window's close already started the quit. If the windows went away some other
  // way there is no UI left to cancel from, so quit without asking.
  quitConfirmed = true
  app.quit()
})

app.on('activate', () => {
  if (quitConfirmed) return
  const main = getMainWindow()
  if (!main) {
    createWindow()
    return
  }
  // Bring back a main window that was minimized or hidden by the global hotkey.
  if (main.isMinimized()) main.restore()
  if (!main.isVisible()) main.show()
})

// Privacy blur is app-level: moving focus between GETSSH windows is not a blur.
app.on('browser-window-blur', () => {
  setTimeout(() => {
    if (!BrowserWindow.getFocusedWindow()) broadcastToAllWindows('app-blur');
  }, 50);
})

app.on('browser-window-focus', () => {
  broadcastToAllWindows('app-focus');
})
