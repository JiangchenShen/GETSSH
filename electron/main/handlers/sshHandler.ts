import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import { Client } from 'ssh2';
import { SocksClient } from 'socks';
import { connectionManager } from '../services/ConnectionManager';

export function registerSshHandlers(ipcMain: Electron.IpcMain, app: Electron.App, getWindow: () => BrowserWindow | null) {
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
        const sessionId = connectionManager.generateSessionId();
        
        const sshClient = new Client();
        connectionManager.sessions.set(sessionId, { client: sshClient, stream: null });

        let connectConfig: any = {
          host: config.host,
          port: config.port || 22,
          username: config.username,
          keepaliveInterval: config.keepaliveInterval !== undefined ? config.keepaliveInterval : 10000 // Heartbeat
        };

        if (privateKeyData) {
          connectConfig.privateKey = privateKeyData;
        } else {
          connectConfig.password = config.password;
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
        };

        establishConnection().then(() => {
          sshClient.on('ready', () => {
            sshClient.shell({ term: 'xterm-256color' }, (err, stream) => {
            if (err) {
              connectionManager.removeSession(sessionId);
              resolve({ success: false, error: err.message });
              return;
            }
            const currentSession = connectionManager.sessions.get(sessionId);
            if (currentSession) currentSession.stream = stream;
            connectionManager.updatePowerSaveBlocker();

            let isAttached = false;
            let dataBuffer = '';
            setTimeout(() => {
               isAttached = true;
               const win = getWindow();
               if (dataBuffer && win && !win.isDestroyed()) {
                   win.webContents.send(`ssh-data-${sessionId}`, dataBuffer);
               }
            }, 800); // Wait 800ms for React to mount the Terminal Component

            stream.on('close', () => {
              sshClient.end();
              connectionManager.removeSession(sessionId);
              const win = getWindow();
              if (win && !win.isDestroyed()) win.webContents.send(`ssh-closed-${sessionId}`);
            }).on('data', (data: Buffer) => {
              const str = data.toString('utf-8');
              const win = getWindow();
              if (!isAttached) dataBuffer += str;
              else if (win && !win.isDestroyed()) win.webContents.send(`ssh-data-${sessionId}`, str);
            }).stderr.on('data', (data: Buffer) => {
              const str = data.toString('utf-8');
              const win = getWindow();
              if (!isAttached) dataBuffer += str;
              else if (win && !win.isDestroyed()) win.webContents.send(`ssh-data-${sessionId}`, str);
            });
            stream.on('error', (streamErr: any) => {
               console.error("Stream emitted error: ", streamErr);
            });

            sshClient.sftp((err, sftp) => {
               if (!err) {
                  const current = connectionManager.sessions.get(sessionId);
                  if (current) current.sftp = sftp;
               }
            });

            resolve({ success: true, sessionId });
          });
        }).on('error', (err: any) => {
          connectionManager.removeSession(sessionId);
          const win = getWindow();
          if (win && !win.isDestroyed()) win.webContents.send(`ssh-closed-${sessionId}`);
          resolve({ success: false, error: err.message });
        }).connect(connectConfig);
        }).catch(err => {
           connectionManager.removeSession(sessionId);
           resolve({ success: false, error: err.message });
        });
      } catch (e: any) {
        resolve({ success: false, error: e.message });
      }
      })();
    });
  });

  ipcMain.on('ssh-write', (event, { sessionId, data }) => {
    const session = connectionManager.sessions.get(sessionId);
    if (session && session.stream) {
      session.stream.write(data);
    }
  });

  ipcMain.on('ssh-resize', (event, { sessionId, cols, rows }) => {
    const session = connectionManager.sessions.get(sessionId);
    if (session && session.stream && session.stream.setWindow) {
      session.stream.setWindow(rows, cols, 0, 0);
    }
  });

  ipcMain.on('ssh-disconnect', (event, sessionId) => {
    const session = connectionManager.sessions.get(sessionId);
    if (session) {
      if (session.stream) session.stream.close();
      if (session.client) session.client.end();
      connectionManager.removeSession(sessionId);
    }
  });
}
