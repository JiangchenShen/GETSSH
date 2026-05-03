import { app, BrowserWindow, ipcMain, dialog, nativeTheme, globalShortcut, safeStorage, Menu, powerSaveBlocker } from 'electron'
import { join } from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { Client, ClientChannel, SFTPWrapper } from 'ssh2'
import { SocksClient } from 'socks'
import { HttpProxyAgent } from 'http-proxy-agent'
import { PluginManager } from './PluginManager'

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
  win = new BrowserWindow({
    title: 'GETSSH',
    width: 1024,
    height: 768,
    transparent: true,
    vibrancy: 'fullscreen-ui', // macOS vibrant glass effect
    titleBarStyle: 'hidden', // hide title bar to let web content handle drag
    titleBarOverlay: process.platform !== 'darwin' ? {
      color: 'rgba(0,0,0,0)',
      symbolColor: '#a1a1aa',
      height: 32
    } : false,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false // Fix xterm and SSH disconnects on blur
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
  Menu.setApplicationMenu(null);
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

const sessions = new Map<string, { client: Client, stream: ClientChannel, sftp?: SFTPWrapper }>()
let sessionCounter = 0;
let powerSaveBlockerId: number | null = null;

const updatePowerSaveBlocker = () => {
  if (sessions.size > 0 && powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (sessions.size === 0 && powerSaveBlockerId !== null) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    powerSaveBlockerId = null;
  }
}
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
const PROFILES_PLAIN_PATH = join(app.getPath('userData'), 'profiles.json');

ipcMain.handle('check-profiles', () => {
  if (fs.existsSync(PROFILES_ENC_PATH)) return 'encrypted';
  if (fs.existsSync(PROFILES_PLAIN_PATH)) return 'plain';
  return 'none';
});

ipcMain.handle('unlock-profiles', (event, masterPassword) => {
  if (!masterPassword) {
    if (fs.existsSync(PROFILES_PLAIN_PATH)) {
      return JSON.parse(fs.readFileSync(PROFILES_PLAIN_PATH, 'utf8'));
    }
    return [];
  }

  if (!fs.existsSync(PROFILES_ENC_PATH)) throw new Error('No profiles found');
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
  const tmpPath = join(app.getPath('userData'), 'profiles.tmp');
  
  if (!masterPassword) {
     fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
     fs.renameSync(tmpPath, PROFILES_PLAIN_PATH); // Atomic write
     if (fs.existsSync(PROFILES_ENC_PATH)) fs.unlinkSync(PROFILES_ENC_PATH);
     return true;
  }
  
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(masterPassword, salt, 100000, 32, 'sha256');
  
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  const output = Buffer.concat([salt, iv, authTag, encrypted]);
  fs.writeFileSync(tmpPath, output);
  fs.renameSync(tmpPath, PROFILES_ENC_PATH); // Atomic write
  if (fs.existsSync(PROFILES_PLAIN_PATH)) fs.unlinkSync(PROFILES_PLAIN_PATH);
  return true;
})

// SSH IPC Handlers
ipcMain.handle('ssh-connect', async (event, config) => {
  let privateKeyData: Buffer | undefined;

  if (config.privateKeyPath) {
    try {
      const keyPath = config.privateKeyPath.replace(/^~/, app.getPath('home'));
      privateKeyData = await fs.promises.readFile(keyPath);
    } catch (err: any) {
      return { success: false, error: 'Failed to read private key: ' + err.message };
    }
  }

  return new Promise((resolve, reject) => {
    (async () => {
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

      if (privateKeyData) {
        connectConfig.privateKey = privateKeyData;
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
          sshClient!.shell({ term: 'xterm-256color' }, (err, stream) => {
          if (err) {
            sessions.delete(sessionId)
            updatePowerSaveBlocker();
            resolve({ success: false, error: err.message })
            return
          }
          const currentSession = sessions.get(sessionId)
          if (currentSession) currentSession.stream = stream
          updatePowerSaveBlocker();

          let isAttached = false;
          let dataBuffer = '';
          setTimeout(() => {
             isAttached = true;
             if (dataBuffer && win && !win.isDestroyed()) {
                 win.webContents.send(`ssh-data-${sessionId}`, dataBuffer);
             }
          }, 800); // Wait 800ms for React to mount the Terminal Component

          stream.on('close', () => {
            sshClient.end()
            sessions.delete(sessionId)
            updatePowerSaveBlocker();
            if (win && !win.isDestroyed()) win.webContents.send(`ssh-closed-${sessionId}`)
          }).on('data', (data: Buffer) => {
            const str = data.toString('utf-8');
            if (!isAttached) dataBuffer += str;
            else if (win && !win.isDestroyed()) win.webContents.send(`ssh-data-${sessionId}`, str)
          }).stderr.on('data', (data: Buffer) => {
            const str = data.toString('utf-8');
            if (!isAttached) dataBuffer += str;
            else if (win && !win.isDestroyed()) win.webContents.send(`ssh-data-${sessionId}`, str)
          });
          stream.on('error', (streamErr: any) => {
             console.error("Stream emitted error: ", streamErr)
          })

          sshClient.sftp((err, sftp) => {
             if (!err) {
                const current = sessions.get(sessionId);
                if (current) current.sftp = sftp;
             }
          });

          resolve({ success: true, sessionId })
        })
      }).on('error', (err: any) => {
        sessions.delete(sessionId)
        updatePowerSaveBlocker();
        if (win && !win.isDestroyed()) win.webContents.send(`ssh-closed-${sessionId}`)
        resolve({ success: false, error: err.message })
      }).connect(connectConfig)
      }).catch(err => {
         sessions.delete(sessionId)
         updatePowerSaveBlocker();
         resolve({ success: false, error: err.message })
      })
    } catch (e: any) {
      resolve({ success: false, error: e.message })
    }
    })();
  })
})


function normalizeRemotePath(p: string): string | null {
  if (typeof p !== 'string') return null;
  // Safely normalize the path to resolve any traversal sequences.
  // SFTP paths are POSIX-compliant.
  return require('node:path').posix.normalize(p);
}

// --- SFTP Handlers ---
ipcMain.handle('sftp-list', (event, sessionId: string, remotePath: string) => {
  return new Promise((resolve) => {
    remotePath = normalizeRemotePath(remotePath) as string;
    if (!remotePath) return resolve({ success: false, error: 'Invalid path' });
    const session = sessions.get(sessionId);
    if (!session || !session.sftp) return resolve({ success: false, error: 'SFTP not available' });
    session.sftp.readdir(remotePath, (err: any, list: any[]) => {
      if (err) return resolve({ success: false, error: err.message });
      resolve({ 
         success: true, 
         list: list.map(item => ({
           name: item.filename,
           longname: item.longname,
           type: item.attrs.isDirectory() ? 'd' : item.attrs.isFile() ? '-' : 'l',
           size: item.attrs.size,
           mtime: item.attrs.mtime
         }))
      });
    });
  });
});

ipcMain.handle('sftp-mkdir', (event, sessionId: string, remotePath: string) => {
  return new Promise((resolve) => {
    remotePath = normalizeRemotePath(remotePath) as string;
    if (!remotePath) return resolve({ success: false, error: 'Invalid path' });
    const session = sessions.get(sessionId);
    if (!session || !session.sftp) return resolve({ success: false, error: 'SFTP not available' });
    session.sftp.mkdir(remotePath, (err: any) => {
      if (err) return resolve({ success: false, error: err.message });
      resolve({ success: true });
    });
  });
});

ipcMain.handle('sftp-delete', (event, sessionId: string, remotePath: string, isDir: boolean) => {
  return new Promise((resolve) => {
    remotePath = normalizeRemotePath(remotePath) as string;
    if (!remotePath) return resolve({ success: false, error: 'Invalid path' });
    const session = sessions.get(sessionId);
    if (!session || !session.sftp) return resolve({ success: false, error: 'SFTP not available' });
    if (isDir) {
       session.sftp.rmdir(remotePath, (err: any) => {
         if (err) return resolve({ success: false, error: err.message });
         resolve({ success: true });
       });
    } else {
       session.sftp.unlink(remotePath, (err: any) => {
         if (err) return resolve({ success: false, error: err.message });
         resolve({ success: true });
       });
    }
  });
});

ipcMain.handle('sftp-read-file', (event, sessionId: string, remotePath: string) => {
  return new Promise((resolve) => {
    remotePath = normalizeRemotePath(remotePath) as string;
    if (!remotePath) return resolve({ success: false, error: 'Invalid path' });
    const session = sessions.get(sessionId);
    if (!session || !session.sftp) return resolve({ success: false, error: 'SFTP not available' });
    session.sftp.readFile(remotePath, 'utf8', (err: any, data: any) => {
       if (err) return resolve({ success: false, error: err.message });
       resolve({ success: true, data });
    });
  });
});

ipcMain.handle('sftp-write-file', (event, sessionId: string, remotePath: string, data: string) => {
  return new Promise((resolve) => {
    remotePath = normalizeRemotePath(remotePath) as string;
    if (!remotePath) return resolve({ success: false, error: 'Invalid path' });
    const session = sessions.get(sessionId);
    if (!session || !session.sftp) return resolve({ success: false, error: 'SFTP not available' });
    session.sftp.writeFile(remotePath, data, 'utf8', (err: any) => {
       if (err) return resolve({ success: false, error: err.message });
       resolve({ success: true });
    });
  });
});

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
    updatePowerSaveBlocker();
  }
})

ipcMain.on('show-context-menu', (event) => {
  const template = [
    { role: 'copy' },
    { role: 'paste' }
  ];
  const menu = Menu.buildFromTemplate(template as any);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender)! });
})
