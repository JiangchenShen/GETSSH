// Initialize the CI probe's temporary paths before any backend module captures them.
import {
  runPackagedStartupSmoke,
  shouldRunPackagedStartupSmoke,
  writePackagedStartupSmokeResult,
} from './startupSmoke'
// A fake-store development run keeps userData and the Keychain out of the real profile.
import './devProfile'
import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, session, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginManager } from './PluginManager'
import { PLUGIN_PAGE_SCHEME, PLUGIN_PAGE_SCHEME_PRIVILEGES, createPluginPageHandler, disableWebRtcUdp } from './services/plugin/pluginPageProtocol'
import { PLUGIN_RENDERER_ACTION_CHANNEL, PluginRendererHost, isPluginRendererSender } from './services/plugin/pluginRendererHost'
import { installIpcSenderGuard } from './security/ipcSenderGuard'
import { registerAllIpcHandlers } from './handlers'
import { getBackendConfig } from './handlers/systemHandler'
import { getBrowserWindowOptions, bindWindowEvents, denyClipboardRead, setupSecurityPolicies } from './handlers/windowHandler'

if (process.platform !== 'darwin' && process.platform !== 'win32') {
  const message = `GETSSH desktop is unsupported on ${process.platform}.`;
  console.error(message);
  app.exit(1);
  throw new Error(message);
}

process.env.DIST_ELECTRON = join(__dirname, '..')
process.env.DIST = join(process.env.DIST_ELECTRON, '../dist')

protocol.registerSchemesAsPrivileged([
  { scheme: PLUGIN_PAGE_SCHEME, privileges: PLUGIN_PAGE_SCHEME_PRIVILEGES }
])
// Before any window exists: plugin pages in any WebContents get no WebRTC over UDP.
disableWebRtcUdp(app)

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

// [M-11] Every IPC listener and handler hears the GETSSH window's top-level frame only; a plugin's
// renderer.js page may send on its one channel and invoke nothing (security/ipcSenderGuard.ts).
installIpcSenderGuard(ipcMain, { isPluginPage: isPluginRendererSender, pluginPageChannel: PLUGIN_RENDERER_ACTION_CHANNEL })

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
// Set once the app is ready; stopped first when quitting.
let pluginRendererHost: PluginRendererHost | null = null
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
import { tidalBridge } from './tidal/tidalBridge'
import { TornWindowManager } from './windowManager'
import { broadcastToAllWindows, getMainWindow, setMainWindow } from './windowRegistry'
import { killAllSessions } from './handlers/sshHandler'
import { bootstrapAppWorkspace } from './handlers/workspaceHandler'
import { appLock } from './security/appLock'
import { mcpManager } from './services/mcp/McpManager'
import { clearCopiedSecret } from './handlers/storeHandler'
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
  denyClipboardRead(session.defaultSession);
  if (process.platform === 'darwin' && process.env.VITE_PUBLIC) {
    app.dock?.setIcon(join(process.env.VITE_PUBLIC, 'logo.png'));
  }

  // Setup IPC Handlers before window creation to ensure early IPC works.
  // None of these depend on the database; plugins are only loaded after bootstrap below.
  registerAllIpcHandlers(ipcMain, app, () => getMainWindow());
  tidalBridge.setupIpcHandlers();
  tidalBridge.setupStateBroadcaster();
  TornWindowManager.getInstance().init();

  // Each plugin's renderer.js runs in a WebContents of its own, started once the plugins are loaded.
  pluginRendererHost = new PluginRendererHost({
    pluginsDir: join(app.getPath('userData'), 'plugins'),
    preload: join(__dirname, '../plugin-preload/pluginRenderer.js'),
  });
  pluginRendererHost.registerIpc();
  const pluginManager = new PluginManager(pluginRendererHost);
  pluginManager.setupIPC();
  SecureCenter.getInstance().setPluginTeardown(() => pluginManager.forceKillAll());
  // Quit and safe-mode restart also stop the MCP servers (deactivating a plugin does not).
  SecureCenter.getInstance().setShutdownTeardown(() => mcpManager.stopAll());
  
  // Show UI instantly without waiting for heavy async operations
  createWindow();
  
  // Init GETSSH Secure Center (RASP)
  SecureCenter.getInstance().start();

  // Init Model Context Protocol (MCP) Manager
  mcpManager.init().catch(err => {
    console.warn('[Main] MCP Manager init error:', err);
  });
  
  // Nothing is decrypted before getssh-store says so: without a master password the device key
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
  // A startup error is shown by the window's lock screen (phase 'error'), not by a native box: on
  // macOS a message box without a visible parent runs modally and stops the main thread, so the
  // watchdog took a box left open for a minute as a freeze, killed the app and restarted it.
  void appLock.start();

  protocol.handle(PLUGIN_PAGE_SCHEME, createPluginPageHandler(join(app.getPath('userData'), 'plugins')));
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
    // A dialog for a hidden or minimized window would run app-modal on macOS and stop the main
    // thread (the watchdog kills GETSSH after 65 s): bring the window back first.
    const parent = BrowserWindow.getFocusedWindow() ?? getMainWindow();
    if (parent && !parent.isDestroyed()) {
      if (parent.isMinimized()) parent.restore();
      if (!parent.isVisible()) parent.show();
    }
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
  pluginRendererHost?.destroyAll();
  // A password copied from the reveal dialog less than 30 s ago must not outlive the app.
  await clearCopiedSecret().catch(err => console.warn('[Main] Clipboard cleanup failed:', err));
  // Gracefully deactivate all plugins and release the ocean-sentinel before the process exits
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
