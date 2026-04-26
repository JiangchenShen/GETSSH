import { app, BrowserWindow, ipcMain, dialog, nativeTheme, globalShortcut, safeStorage } from 'electron'
import { join } from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { Client } from 'ssh2'
import { SocksClient } from 'socks'
import { HttpProxyAgent } from 'http-proxy-agent'
import { PluginManager } from './PluginManager'

process.env.DIST_ELECTRON = join(__dirname, '..')
process.env.DIST = join(process.env.DIST_ELECTRON, '../dist')

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
  win = new BrowserWindow({
    title: 'GETSSH',
    width: 1024,
    height: 768,
    transparent: true,
    vibrancy: 'fullscreen-ui', // macOS vibrant glass effect
    titleBarStyle: 'hidden', // hide title bar to let web content handle drag
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  })

  // Prevent Quit Logic Map
  win.on('close', (e) => {
    if (win) {
       // We fetch boolean confirmQuit from the local mutable state (init false)
       if (backendConfig.confirmQuit) {
         const selection = dialog.showMessageBoxSync(win, {
           type: 'question',
           buttons: ['Cancel', 'Quit'],
           defaultId: 1,
           cancelId: 0,
           title: 'Confirm Quit',
           message: 'Are you sure you want to quit GETSSH?',
           detail: 'All active SSH terminal connections and running tasks will be disconnected immediately.'
         });
         
         if (selection === 0) {
           e.preventDefault();
         }
       }
    }
  })

  if (app.isPackaged) {
    win.loadFile(join(__dirname, '../../dist/index.html'))
  } else if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(url!)
    // win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(indexHtml)
  }
}

app.whenReady().then(() => {
  const pluginManager = new PluginManager();
  pluginManager.setupIPC();
  pluginManager.loadPlugins();
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

const sessions = new Map<string, { client: Client, stream: any }>()
let sessionCounter = 0;
let backendConfig = { confirmQuit: false, globalHotkey: '' };

const registerHotkey = (key: string) => {
  globalShortcut.unregisterAll();
  if (key) {
    try {
      globalShortcut.register(key, () => {
        if (win) {
          if (win.isVisible() && win.isFocused()) {
            win.hide();
          } else {
            win.show();
            win.focus();
          }
        }
      });
    } catch(e) { console.error("Hotkey failed to register", e) }
  }
}

ipcMain.on('update-backend-config', (event, config) => {
  backendConfig = { ...backendConfig, ...config };
  if (config.globalHotkey !== undefined) {
    registerHotkey(config.globalHotkey);
  }
})

// Theme integration
ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors)

nativeTheme.on('updated', () => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors)
  }
})
// File Selection Handler
ipcMain.handle('select-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: 'Select Private Key',
    properties: ['openFile', 'showHiddenFiles']
  })
  if (!canceled) {
    return filePaths[0]
  }
  return null
})

// Safe Storage Encryption Payload -> Zero-Knowledge Local AES
const PROFILES_ENC_PATH = join(app.getPath('userData'), 'profiles.enc');

const PROFILES_JSON_PATH = join(app.getPath('userData'), 'profiles.json');

ipcMain.handle('check-profiles', () => {
  if (fs.existsSync(PROFILES_ENC_PATH)) return { exists: true, encrypted: true };
  if (fs.existsSync(PROFILES_JSON_PATH)) return { exists: true, encrypted: false };
  return { exists: false, encrypted: false };
});

ipcMain.handle('unlock-profiles', (event, masterPassword) => {
  if (!masterPassword && fs.existsSync(PROFILES_JSON_PATH)) {
    return JSON.parse(fs.readFileSync(PROFILES_JSON_PATH, 'utf8'));
  }
  
  if (!fs.existsSync(PROFILES_ENC_PATH)) throw new Error('No encrypted profiles found');
  const buffer = fs.readFileSync(PROFILES_ENC_PATH);
  
  if (buffer.length < 44) throw new Error('Invalid encrypted profile');
  
  const salt = buffer.subarray(0, 16);
  const iv = buffer.subarray(16, 28);
  const authTag = buffer.subarray(28, 44);
  const cipherText = buffer.subarray(44);
  
  const key = crypto.pbkdf2Sync(masterPassword, salt, 100000, 32, 'sha256');
  
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(cipherText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return JSON.parse(decrypted.toString('utf8'));
  } catch (e) {
    throw new Error('Invalid master password or corrupted file');
  }
});

ipcMain.handle('save-profiles', (event, { masterPassword, payload }) => {
  const tempPath = join(app.getPath('userData'), `profiles_${Date.now()}.tmp`);
  
  try {
    if (!masterPassword) {
      fs.writeFileSync(tempPath, JSON.stringify(payload));
      fs.renameSync(tempPath, PROFILES_JSON_PATH);
      if (fs.existsSync(PROFILES_ENC_PATH)) fs.unlinkSync(PROFILES_ENC_PATH);
    } else {
      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);
      const key = crypto.pbkdf2Sync(masterPassword, salt, 100000, 32, 'sha256');
      
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(JSON.stringify(payload), 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();
      
      const output = Buffer.concat([salt, iv, authTag, encrypted]);
      fs.writeFileSync(tempPath, output);
      fs.renameSync(tempPath, PROFILES_ENC_PATH);
      if (fs.existsSync(PROFILES_JSON_PATH)) fs.unlinkSync(PROFILES_JSON_PATH);
    }
    return true;
  } catch (err) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw err;
  }
});

// SSH IPC Handlers
ipcMain.handle('ssh-connect', async (event, config) => {
  return new Promise((resolve, reject) => {
    try {
      const sessionId = `req-${++sessionCounter}`
      
      const sshClient = new Client()
      sessions.set(sessionId, { client: sshClient, stream: null })

      let connectConfig: any = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
        keepaliveInterval: config.keepaliveInterval !== undefined ? config.keepaliveInterval : 10000 // Heartbeat
      }

      if (config.privateKeyPath) {
        try {
          const keyPath = config.privateKeyPath.replace(/^~/, app.getPath('home'))
          connectConfig.privateKey = fs.readFileSync(keyPath)
        } catch (err: any) {
          sessions.delete(sessionId)
          resolve({ success: false, error: 'Failed to read private key: ' + err.message })
          return
        }
      } else {
        connectConfig.password = config.password
      }

      // Proxy Attachment
      const establishConnection = async () => {
         if (config.proxyType === 'socks5') {
            const proxyOptions = {
              proxy: {
                host: config.proxyHost,
                port: parseInt(config.proxyPort) || 1080,
                type: 5 // Socks5
              },
              command: 'connect' as any,
              destination: {
                host: connectConfig.host,
                port: connectConfig.port
              }
            };
            const info = await SocksClient.createConnection(proxyOptions);
            connectConfig.sock = info.socket;
         } else if (config.proxyType === 'http') {
            const agent = new HttpProxyAgent(`http://${config.proxyHost}:${config.proxyPort || 8080}`);
            // Wait, ssh2 expects a raw `net.Socket` stream for sock
            // http-proxy-agent usually provides agent. But directly using it for ssh2
            // We can resolve a socket using native net connect through proxy or generic stream
            // Node HTTP CONNECT tunnel
            const net = require('net');
            const sock = await new Promise<any>((sockResolve, sockReject) => {
               const req = require('http').request({
                 host: config.proxyHost,
                 port: config.proxyPort || 8080,
                 method: 'CONNECT',
                 path: `${connectConfig.host}:${connectConfig.port}`
               });
               req.on('connect', (res: any, socket: any, head: any) => sockResolve(socket));
               req.on('error', sockReject);
               req.end();
            });
            connectConfig.sock = sock;
         }
      }

      establishConnection().then(() => {
        sshClient.on('ready', () => {
          sshClient!.shell((err, stream) => {
          if (err) {
            sessions.delete(sessionId)
            resolve({ success: false, error: err.message })
            return
          }
          const currentSession = sessions.get(sessionId)
          if (currentSession) currentSession.stream = stream
          
          stream.on('close', () => {
            sshClient.end()
            sessions.delete(sessionId)
            if (win && !win.isDestroyed()) win.webContents.send(`ssh-closed-${sessionId}`)
          }).on('data', (data: Buffer) => {
            if (win && !win.isDestroyed()) win.webContents.send(`ssh-data-${sessionId}`, data.toString('utf-8'))
          }).on('error', (streamErr: any) => {
             console.error("Stream emitted error: ", streamErr)
          })
          resolve({ success: true, sessionId })
        })
      }).on('error', (err: any) => {
        sessions.delete(sessionId)
        if (win && !win.isDestroyed()) win.webContents.send(`ssh-closed-${sessionId}`)
        resolve({ success: false, error: err.message })
      }).connect(connectConfig)
      }).catch(err => {
         sessions.delete(sessionId)
         resolve({ success: false, error: err.message })
      })
    } catch (e: any) {
      resolve({ success: false, error: e.message })
    }
  })
})

ipcMain.on('ssh-write', (event, { sessionId, data }) => {
  const session = sessions.get(sessionId)
  if (session && session.stream) {
    session.stream.write(data)
  }
})

ipcMain.on('ssh-resize', (event, { sessionId, cols, rows }) => {
  const session = sessions.get(sessionId)
  if (session && session.stream && session.stream.setWindow) {
    session.stream.setWindow(rows, cols, 0, 0)
  }
})

ipcMain.on('ssh-disconnect', (event, sessionId) => {
  const session = sessions.get(sessionId)
  if (session) {
    if (session.stream) session.stream.close()
    if (session.client) session.client.end()
    sessions.delete(sessionId)
  }
})
