import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginManager } from './PluginManager'
import { registerAllIpcHandlers } from './handlers'
import { getBackendConfig } from './handlers/systemHandler'
import { getBrowserWindowOptions, bindWindowEvents, setupSecurityPolicies } from './handlers/windowHandler'

process.env.DIST_ELECTRON = join(__dirname, '..')
process.env.DIST = join(process.env.DIST_ELECTRON, '../dist')

// Prevent background throttling for SSH persistence
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

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
  win = new BrowserWindow(getBrowserWindowOptions(preload));
  
  setupSecurityPolicies(win.webContents, process.env.VITE_DEV_SERVER_URL);
  bindWindowEvents(win, () => getBackendConfig().confirmQuit);

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
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
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


app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const pluginManager = new PluginManager();
  pluginManager.setupIPC();
  await pluginManager.loadPlugins();
  
  protocol.handle('getssh-plugin', (request) => {
    // getssh-plugin://pluginName/entryPath
    const url = request.url.substring('getssh-plugin://'.length);
    const decodedUrl = decodeURIComponent(url);
    const pluginPath = path.join(app.getPath('userData'), 'plugins', decodedUrl);
    return net.fetch(pathToFileURL(pluginPath).toString());
  });
  
  registerAllIpcHandlers(ipcMain, app, () => win);
  createWindow();
})

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (win === null) createWindow()
})

app.on('browser-window-blur', () => {
  if (win && !win.isDestroyed()) win.webContents.send('app-blur')
})

app.on('browser-window-focus', () => {
  if (win && !win.isDestroyed()) win.webContents.send('app-focus')
})
