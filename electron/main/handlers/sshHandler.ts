import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import { Client, ConnectConfig } from 'ssh2';
import { SocksClient } from 'socks';
import { connectionManager } from '../services/ConnectionManager';
import path from 'node:path';
import crypto from 'node:crypto';

let knownHosts: Record<string, string> | null = null;
const pendingVerifications = new Map<string, (accept: boolean) => void>();

async function getKnownHosts(app: Electron.App): Promise<Record<string, string>> {
  if (knownHosts) return knownHosts;
  const filePath = path.join(app.getPath('userData'), 'known_hosts.json');
  try {
    const data = await fs.promises.readFile(filePath, 'utf-8');
    knownHosts = JSON.parse(data);
  } catch (e) {
    knownHosts = {};
  }
  return knownHosts!;
}

async function saveKnownHosts(app: Electron.App, hosts: Record<string, string>) {
  knownHosts = hosts;
  const filePath = path.join(app.getPath('userData'), 'known_hosts.json');
  await fs.promises.writeFile(filePath, JSON.stringify(hosts, null, 2), 'utf-8');
}

export function registerSshHandlers(ipcMain: Electron.IpcMain, app: Electron.App, getWindow: () => BrowserWindow | null) {
  ipcMain.on('host-verification-result', async (event, { requestId, result, hostname, fingerprint }) => {
    const callback = pendingVerifications.get(requestId);
    if (!callback) return;
    pendingVerifications.delete(requestId);

    if (result === 'accept-save') {
      const hosts = await getKnownHosts(app);
      hosts[hostname] = fingerprint;
      await saveKnownHosts(app, hosts);
      callback(true);
    } else if (result === 'accept-once') {
      callback(true);
    } else {
      callback(false);
    }
  });

  ipcMain.handle('ssh-connect', async (event, config) => {
    let privateKeyData: Buffer | undefined;

    if (config.privateKeyPath) {
      try {
        const keyPath = config.privateKeyPath.replace(/^~/, app.getPath('home'));
        privateKeyData = await fs.promises.readFile(keyPath);
      } catch (err: unknown) {
        return { success: false, error: 'Failed to read private key: ' + (err instanceof Error ? err.message : String(err)) };
      }
    }

    return new Promise((resolve, reject) => {
      (async () => {
      try {
        const sessionId = connectionManager.generateSessionId();
        
        const sshClient = new Client();
        connectionManager.sessions.set(sessionId, { client: sshClient, stream: null });

        let connectConfig: ConnectConfig = {
          host: config.host,
          port: config.port || 22,
          username: config.username,
          keepaliveInterval: config.keepaliveInterval !== undefined ? config.keepaliveInterval : 10000, // Heartbeat
          hostVerifier: (hashedKey: string, callback: (accept: boolean) => void) => {
            (async () => {
              const hosts = await getKnownHosts(app);
              const hostKey = `${config.host}:${config.port || 22}`;
              
              if (hosts[hostKey] === hashedKey) {
                return callback(true);
              }

              const requestId = crypto.randomUUID();
              pendingVerifications.set(requestId, callback);
              
              const win = getWindow();
              if (win && !win.isDestroyed()) {
                win.webContents.send('prompt-host-verification', {
                  requestId,
                  hostname: hostKey,
                  fingerprint: hashedKey
                });
              } else {
                callback(false);
              }
            })().catch(() => callback(false));
          }
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
              const sock = await new Promise<any>((sockResolve, sockReject) => {
                 const req = http.request({
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
            sshClient.shell({ term: 'xterm-256color' }, async (err, stream) => {
            if (err) {
              await connectionManager.removeSession(sessionId);
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

            stream.on('close', async () => {
              sshClient.end();
              await connectionManager.removeSession(sessionId);
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
        }).on('error', async (err: any) => {
          await connectionManager.removeSession(sessionId);
          const win = getWindow();
          if (win && !win.isDestroyed()) win.webContents.send(`ssh-closed-${sessionId}`);
          resolve({ success: false, error: err.message });
        }).connect(connectConfig);
        }).catch(async (err: unknown) => {
           await connectionManager.removeSession(sessionId);
           resolve({ success: false, error: err instanceof Error ? err.message : String(err) });
        });
      } catch (e: unknown) {
        resolve({ success: false, error: e instanceof Error ? e.message : String(e) });
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

  ipcMain.on('ssh-disconnect', async (event, sessionId) => {
    const session = connectionManager.sessions.get(sessionId);
    if (session) {
      if (session.stream) session.stream.close();
      if (session.client) session.client.end();
      await connectionManager.removeSession(sessionId);
    }
  });
}
