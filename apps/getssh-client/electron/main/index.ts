import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginManager } from './PluginManager'
import { registerAllIpcHandlers } from './handlers'
import { getBackendConfig } from './handlers/systemHandler'
import { getBrowserWindowOptions, bindWindowEvents, setupSecurityPolicies } from './handlers/windowHandler'

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
const originalIpcOn = ipcMain.on.bind(ipcMain);
ipcMain.on = (channel, listener) => {
  return originalIpcOn(channel, (event, ...args) => {
    // Only allow IPC messages from the top-level frame (the main GETSSH UI)
    // If event is null/undefined (e.g., emitted internally by main process), skip this check
    if (event && event.senderFrame && event.senderFrame.parent !== null) {
      console.warn(`[Security] Blocked unauthorized IPC 'on' message from subframe to channel: ${channel}`);
      return;
    }
    listener(event, ...args);
  });
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

const originalIpcOnce = ipcMain.once.bind(ipcMain);
ipcMain.once = (channel, listener) => {
  return originalIpcOnce(channel, (event, ...args) => {
    if (event && event.senderFrame && event.senderFrame.parent !== null) {
      console.warn(`[Security] Blocked unauthorized IPC 'once' message from subframe to channel: ${channel}`);
      return;
    }
    listener(event, ...args);
  });
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
  return originalIpcAddListener(channel, (event, ...args) => {
    if (event && event.senderFrame && event.senderFrame.parent !== null) {
      console.warn(`[Security] Blocked unauthorized IPC 'addListener' message from subframe to channel: ${channel}`);
      return;
    }
    listener(event, ...args);
  });
};

// Chromium's os_crypt tries to store a key in the macOS keychain.
// Because the app signature is absent (identity: null for small builds), macOS prompts the user. 
// We use a mock keychain to prevent this annoying popup that blocks the main thread.
// Since we use our own Vault for sensitive data, mock keychain is perfectly safe here.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('use-mock-keychain')
}

process.on('uncaughtException', (err) => {
  console.error("Critical Uncaught Exception: ", err)
})
process.on('unhandledRejection', (err) => {
  console.error("Critical Unhandled Rejection: ", err)
})
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST

let win: BrowserWindow | null = null
const preload = join(__dirname, '../preload/index.js')
const url = process.env.VITE_DEV_SERVER_URL
const indexHtml = join(process.env.DIST, 'index.html')

function createWindow() {
  const options = getBrowserWindowOptions(preload);
  options.show = false;
  win = new BrowserWindow(options);
  
  win.once('ready-to-show', () => {
    win?.show();
  });
  
  setupSecurityPolicies(win.webContents, process.env.VITE_DEV_SERVER_URL, indexHtml);
  bindWindowEvents(win, () => getBackendConfig().confirmQuit ?? false);

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
import { bootstrapAppWorkspace } from './handlers/workspaceHandler'
import { DatabaseManager } from './services/DatabaseManager'

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  // Setup IPC Handlers before window creation to ensure early IPC works
  registerAllIpcHandlers(ipcMain, app, () => win);
  nexusBridge.setupIpcHandlers();
  
  // Show UI instantly without waiting for heavy async operations
  createWindow();
  if (win) {
    nexusBridge.setupStateBroadcaster();
  }
  
  // Init GETSSH Secure Center (RASP)
  SecureCenter.getInstance().start(() => win);
  
  let appKeyBuffer: Buffer | null = null;
  try {
    const appKeyPathEnc = join(app.getPath('home'), '.getssh', 'app_key.enc');
    const appKeyPathPlain = join(app.getPath('home'), '.getssh', 'app_key.txt');
    const fs = require('fs');
    const crypto = require('crypto');
    const { safeStorage } = require('electron');

    if (fs.existsSync(appKeyPathEnc) && safeStorage.isEncryptionAvailable()) {
      const encryptedKey = fs.readFileSync(appKeyPathEnc);
      const appKeyStr = safeStorage.decryptString(encryptedKey);
      appKeyBuffer = Buffer.from(appKeyStr, 'utf8');
    } else if (fs.existsSync(appKeyPathPlain)) {
      const appKeyStr = fs.readFileSync(appKeyPathPlain, 'utf8');
      appKeyBuffer = Buffer.from(appKeyStr, 'utf8');
    } else {
      // First boot: generate key
      const newKey = crypto.randomBytes(32).toString('hex');
      if (safeStorage.isEncryptionAvailable()) {
        const encryptedKey = safeStorage.encryptString(newKey);
        fs.writeFileSync(appKeyPathEnc, encryptedKey);
      } else {
        fs.writeFileSync(appKeyPathPlain, newKey, { mode: 0o600 });
      }
      appKeyBuffer = Buffer.from(newKey, 'utf8');
    }
  } catch (e) {
    console.error('Failed to initialize or retrieve global app key', e);
  }

  // Initialize Master SQLite Database synchronously with the Global App Key
  DatabaseManager.init(appKeyBuffer);
  
  // Background asynchronous heavy initialization (workspaces, plugins, hollow windows)
  bootstrapAppWorkspace().then(async () => {
    TornWindowManager.getInstance().init();
    
    const pluginManager = new PluginManager();
    pluginManager.setupIPC();
    await pluginManager.loadPlugins();
    
    // Wire plugin teardown into RASP: on SIGKILL threat, deactivate all plugins first
    SecureCenter.getInstance().setPluginTeardown(() => pluginManager.deactivateAll());
  }).catch(console.error);
  
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

app.on('browser-window-created', (e, window) => {
  window.on('close', () => {
    // Trigger quit if this is the last visible window (ignoring background hollow windows)
    const visibleWindows = BrowserWindow.getAllWindows().filter(w => w.isVisible() && w !== window);
    if (visibleWindows.length === 0) {
      app.quit();
    }
  });
});

app.on('window-all-closed', () => {
  win = null
  // Clean up all sessions (PTY/SSH/Telnet) to prevent zombie processes
  import('./handlers/sshHandler').then(({ killAllSessions }) => {
    killAllSessions(app).catch(console.error);
  });
  app.quit()
})

app.on('before-quit', () => {
  // Gracefully deactivate all plugins before the process exits
  SecureCenter.getInstance().gracefulShutdown();
  import('./handlers/sshHandler').then(({ killAllSessions }) => {
    killAllSessions(app).catch(console.error);
  });
})

app.on('activate', () => {
  if (win === null) createWindow()
})

app.on('browser-window-blur', () => {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send('app-blur'); } catch (e) {}
  }
})

app.on('browser-window-focus', () => {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send('app-focus'); } catch (e) {}
  }
})
