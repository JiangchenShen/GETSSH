import { BrowserWindow, dialog } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import { Client, ConnectConfig } from 'ssh2';
import { SocksClient } from 'socks';
import { connectionManager } from '../services/ConnectionManager';
import path from 'node:path';
import crypto from 'node:crypto';
import { getRustCorePath } from '../utils/rustCorePath';
import {
  spawnLocalTerminal,
  spawnTelnetSession,
  ptyWrite,
  ptyResize,
  ptyKill,
  sessionProtocols
} from './ptyHandler';
import { sshBridge } from '../services/SSHBridge';
import { nexusBridge } from '../nexus/nexusBridge';

export interface KnownHost {
  host: string;
  port: number;
  fingerprint: string;
  trustedAt: number;
}

export interface AuditLogRecord {
  id: string;
  alias: string;
  host: string;
  port: number;
  connectedAt: string;
  disconnectedAt: string;
  duration: string;
}

interface ActiveConnectionInfo {
  id: string;
  alias: string;
  host: string;
  port: number;
  connectedAtStr: string;
  connectedAtMs: number;
}

let knownHosts: Record<string, KnownHost> | null = null;
const pendingVerifications = new Map<string, (accept: boolean) => void>();
const activeConnections = new Map<string, ActiveConnectionInfo>();

async function getKnownHosts(app: Electron.App): Promise<Record<string, KnownHost>> {
  if (knownHosts) return knownHosts;
  const filePath = path.join(app.getPath('userData'), 'known_hosts.json');
  try {
    const data = await fs.promises.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    
    let needsMigration = false;
    for (const [key, value] of Object.entries(parsed)) {
      if (value && typeof value === 'object') {
        const valObj = value as any;
        if (valObj.fingerprint && typeof valObj.fingerprint === 'object') {
          needsMigration = true;
          // Recover Uint8Array or Buffer objects
          let rawBuffer: Buffer | null = null;
          if (valObj.fingerprint.type === 'Buffer' && Array.isArray(valObj.fingerprint.data)) {
            rawBuffer = Buffer.from(valObj.fingerprint.data);
          } else {
            const values = Object.values(valObj.fingerprint);
            if (values.length > 0 && values.every(v => typeof v === 'number')) {
              rawBuffer = Buffer.from(values as number[]);
            }
          }
          if (rawBuffer) {
            valObj.fingerprint = 'SHA256:' + crypto.createHash('sha256').update(rawBuffer).digest('base64').replace(/=*$/, '');
          } else {
            valObj.fingerprint = 'INVALID_FINGERPRINT';
          }
        }
      } else if (typeof value === 'string') {
        needsMigration = true;
        const [host, portStr] = key.split(':');
        parsed[key] = {
          host,
          port: portStr ? parseInt(portStr, 10) : 22,
          fingerprint: value,
          trustedAt: Date.now()
        };
      }
    }
    
    knownHosts = parsed;
    
    if (needsMigration) {
      await saveKnownHosts(app, knownHosts as Record<string, KnownHost>);
    }
  } catch (e) {
    knownHosts = {};
  }
  return knownHosts!;
}

async function saveKnownHosts(app: Electron.App, hosts: Record<string, KnownHost>) {
  knownHosts = hosts;
  const filePath = path.join(app.getPath('userData'), 'known_hosts.json');
  await fs.promises.writeFile(filePath, JSON.stringify(hosts, null, 2), 'utf-8');
}

async function recordDisconnect(app: Electron.App, sessionId: string) {
  const info = activeConnections.get(sessionId);
  if (!info) return;
  activeConnections.delete(sessionId);
  
  const disconnectedAtMs = Date.now();
  const diffSec = Math.floor((disconnectedAtMs - info.connectedAtMs) / 1000);
  
  let durationStr = '';
  if (diffSec < 60) durationStr = '< 1m';
  else {
    const h = Math.floor(diffSec / 3600);
    const m = Math.floor((diffSec % 3600) / 60);
    const s = diffSec % 60;
    if (h > 0) durationStr += `${h}h `;
    if (m > 0) durationStr += `${m}m `;
    durationStr += `${s}s`;
    durationStr = durationStr.trim();
  }

  const record: AuditLogRecord = {
    id: info.id,
    alias: info.alias,
    host: info.host,
    port: info.port,
    connectedAt: info.connectedAtStr,
    disconnectedAt: new Date(disconnectedAtMs).toLocaleString(),
    duration: durationStr
  };
  
  try {
    const filePath = path.join(app.getPath('userData'), 'connection_history.json');
    let history: AuditLogRecord[] = [];
    if (fs.existsSync(filePath)) {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      try {
        const parsed = JSON.parse(data);
        // [M-15] Security Fix: Enforce basic schema validation on connection_history to prevent UI crashes if file is tampered
        if (Array.isArray(parsed)) {
          history = parsed;
        } else {
          console.warn('[Audit] connection_history.json is not an array, resetting');
        }
      } catch (parseErr) {
        console.warn('[Audit] connection_history.json contains invalid JSON, resetting');
      }
    }
    history.push(record);
    history = history.slice(-500);
    await fs.promises.writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write audit log', err);
  }
}

export function registerSshHandlers(ipcMain: Electron.IpcMain, app: Electron.App, getWindow: () => BrowserWindow | null) {
  ipcMain.on('host-verification-result', async (event, { requestId, result, hostname, fingerprint }) => {
    const callback = pendingVerifications.get(requestId);
    if (!callback) return;
    pendingVerifications.delete(requestId);

    if (result === 'accept-save') {
      const hosts = await getKnownHosts(app);
      const [host, portStr] = hostname.split(':');
      hosts[hostname] = {
        host,
        port: portStr ? parseInt(portStr, 10) : 22,
        fingerprint,
        trustedAt: Date.now()
      };
      await saveKnownHosts(app, hosts);
      callback(true);
    } else if (result === 'accept-once') {
      callback(true);
    } else {
      callback(false);
    }
  });

  ipcMain.handle('ssh-connect', async (event, config) => {
    if (typeof config.host === 'string') {
        // Sanitize host input: remove 'ssh://', 'http://', trailing slashes, and spaces
        config.host = config.host.replace(/^(https?|ssh):\/\//i, '').replace(/[\/\\\s]+$/g, '').trim();
    }

    if (typeof config.host === 'string' && config.host.includes(':') && !config.host.includes(']')) {
       const parts = config.host.split(':');
       if (parts.length === 2 && !isNaN(parseInt(parts[1], 10))) {
           config.host = parts[0];
           config.port = parseInt(parts[1], 10);
       }
    } else if (typeof config.host === 'string' && config.host.startsWith('[') && config.host.includes(']:')) {
       const match = config.host.match(/^\[(.*)\]:(\d+)$/);
       if (match) {
           config.host = match[1];
           config.port = parseInt(match[2], 10);
       }
    }

    try {
      const protocol: 'ssh' | 'local' | 'telnet' = config.protocol || 'ssh';
      const sessionId = connectionManager.generateSessionId();
      sessionProtocols.set(sessionId, protocol);

    if (protocol === 'local') {
      const result = await spawnLocalTerminal(config, sessionId, getWindow);
      if (result.success) {
        activeConnections.set(sessionId, {
          id: sessionId,
          alias: config.alias || 'Local Terminal',
          host: 'localhost',
          port: 0,
          connectedAtStr: new Date().toLocaleString(),
          connectedAtMs: Date.now()
        });
      }
      return result;
    }

    if (protocol === 'telnet') {
      const result = await spawnTelnetSession(config, sessionId, getWindow);
      if (result.success) {
        activeConnections.set(sessionId, {
          id: sessionId,
          alias: config.alias || `${config.host}:${config.port || 23}`,
          host: config.host,
          port: config.port || 23,
          connectedAtStr: new Date().toLocaleString(),
          connectedAtMs: Date.now()
        });
      }
      return result;
    }

    // ── SSH (default) ────────────────────────────────────────────────────

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
        // Reuse the sessionId allocated in the dispatch block above
        const sshClient = new Client();
        connectionManager.sessions.set(sessionId, { client: sshClient, stream: null });

        let connectConfig: ConnectConfig = {
          host: config.host,
          port: config.port || 22,
          username: config.username,
          keepaliveInterval: config.keepaliveInterval !== undefined ? config.keepaliveInterval : 10000, // Heartbeat
          hostVerifier: (hashedKey: any, callback: (accept: boolean) => void) => {
            (async () => {
              const fingerprintStr = Buffer.isBuffer(hashedKey) 
                ? 'SHA256:' + crypto.createHash('sha256').update(hashedKey).digest('base64').replace(/=*$/, '')
                : String(hashedKey);

              const hosts = await getKnownHosts(app);
              const hostKey = `${config.host}:${config.port || 22}`;
              
              let isChanged = false;
              let oldFingerprint = undefined;

              if (hosts[hostKey]) {
                if (hosts[hostKey].fingerprint === fingerprintStr) {
                  return callback(true);
                } else {
                  // Key changed! Potential MITM
                  isChanged = true;
                  oldFingerprint = hosts[hostKey].fingerprint;
                }
              }

              const requestId = crypto.randomUUID();
              pendingVerifications.set(requestId, callback);
              
              const win = getWindow();
              if (win && !win.isDestroyed()) {
                try {
                  win.webContents.send('prompt-host-verification', {
                    requestId,
                    hostname: hostKey,
                    fingerprint: fingerprintStr,
                    isChanged,
                    oldFingerprint
                  });
                } catch (e) {}
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
                  type: 5 as any // Socks5
                },
                command: 'connect' as any,
                destination: {
                  host: connectConfig.host || '',
                  port: connectConfig.port || 22
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
            
            let auditStream: any = null;
            let startTime = Date.now() / 1000;
            
            if (config.enableAuditLogging) {
              try {
                 // Load the N-API module
                 const { AuditStream } = require(getRustCorePath('audit-stream'));
                 const { getActiveWorkspaceId } = require('./workspaceHandler');
                 const workspaceId = getActiveWorkspaceId() || 'default';
                 const wsPath = path.join(app.getPath('home'), '.getssh', 'workspaces', workspaceId, 'audit_recordings');
                 if (!fs.existsSync(wsPath)) fs.mkdirSync(wsPath, { recursive: true });
                 
                 const outPath = path.join(wsPath, `${sessionId}_${Date.now()}.cast.gz`);
                 const headerJson = JSON.stringify({ version: 2, width: 80, height: 24, timestamp: Math.floor(startTime), env: { TERM: 'xterm-256color' } });
                 auditStream = new AuditStream(outPath, headerJson);
              } catch (e) {
                 console.error("[AuditStream] Failed to initialize native audit recording module:", e);
              }
            }

             setTimeout(() => {
               isAttached = true;
               if (dataBuffer) {
                 const windows = BrowserWindow.getAllWindows();
                 for (const w of windows) {
                   if (!w.webContents.isDestroyed()) {
                     try { w.webContents.send(`ssh-data-${sessionId}`, dataBuffer); } catch(e) {}
                   }
                 }
                 sshBridge.broadcastData(sessionId, dataBuffer);
               }
             }, 800);

            stream.on('close', async () => {
              if (auditStream) {
                 try { auditStream.end(); } catch (e) { console.error("AuditStream flush error:", e); }
              }
              sshClient.end();
              await recordDisconnect(app, sessionId);
              await connectionManager.removeSession(sessionId);
              sshBridge.cleanupSession(sessionId);
              const windows = BrowserWindow.getAllWindows();
              for (const w of windows) {
                if (!w.webContents.isDestroyed()) {
                  try { w.webContents.send(`ssh-closed-${sessionId}`); } catch(e) {}
                }
              }
            }).on('data', (data: Buffer) => {
              if (auditStream) {
                 const elapsed = (Date.now() / 1000) - startTime;
                 try { auditStream.writeFrame(elapsed, data); } catch(e) {}
              }
              const str = data.toString('utf-8');
              if (!isAttached) dataBuffer += str;
              else {
                const windows = BrowserWindow.getAllWindows();
                for (const w of windows) {
                  if (!w.webContents.isDestroyed()) {
                    try { w.webContents.send(`ssh-data-${sessionId}`, str); } catch(e) {}
                  }
                }
                sshBridge.broadcastData(sessionId, str);
              }
            }).stderr.on('data', (data: Buffer) => {
              if (auditStream) {
                 const elapsed = (Date.now() / 1000) - startTime;
                 try { auditStream.writeFrame(elapsed, data); } catch(e) {}
              }
              const str = data.toString('utf-8');
              if (!isAttached) dataBuffer += str;
              else {
                const windows = BrowserWindow.getAllWindows();
                for (const w of windows) {
                  if (!w.webContents.isDestroyed()) {
                    try { w.webContents.send(`ssh-data-${sessionId}`, str); } catch(e) {}
                  }
                }
                sshBridge.broadcastData(sessionId, str);
              }
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

            activeConnections.set(sessionId, {
              id: sessionId,
              alias: config.alias || connectConfig.host || 'Unknown',
              host: connectConfig.host || '',
              port: connectConfig.port || 22,
              connectedAtStr: new Date().toLocaleString(),
              connectedAtMs: Date.now()
            });

            resolve({ success: true, sessionId });

            // ── Silent OS Fingerprint Probe ─────────────────────────────
            // Uses a separate exec channel so the PTY stream stays clean.
            setTimeout(() => {
              sshClient.exec('cat /etc/os-release 2>/dev/null | grep -E "^ID="', (execErr, execStream) => {
                if (execErr) return;
                let output = '';
                execStream.on('data', (d: Buffer) => { output += d.toString('utf-8'); });
                execStream.on('close', () => {
                  const idMatch = output.match(/^ID="?([a-z0-9_.-]+)"?/im);
                  const rawId = idMatch ? idMatch[1].toLowerCase() : '';
                  type OsType = 'ubuntu'|'debian'|'centos'|'rhel'|'fedora'|'alpine'|'arch'|'suse'|'windows'|'macos'|'cisco'|'huawei'|'generic';
                  const osMap: Record<string, OsType> = {
                    ubuntu: 'ubuntu', debian: 'debian', raspbian: 'debian',
                    centos: 'centos', rhel: 'rhel', fedora: 'fedora',
                    alpine: 'alpine', arch: 'arch', manjaro: 'arch',
                    opensuse: 'suse', sles: 'suse',
                  };
                  const osType: OsType = osMap[rawId] || 'generic';
                  const windows = BrowserWindow.getAllWindows();
                  for (const w of windows) {
                    if (!w.webContents.isDestroyed()) {
                      try {
                        w.webContents.send('os-fingerprint', {
                          host: connectConfig.host,
                          username: config.username,
                          osType
                        });
                      } catch (e) {}
                    }
                  }
                });
              });
            }, 1200); // Probe after shell buffer window
          });
        }).on('error', async (err: any) => {
          await recordDisconnect(app, sessionId);
          await connectionManager.removeSession(sessionId);
          sshBridge.cleanupSession(sessionId);
          const windows = BrowserWindow.getAllWindows();
          for (const w of windows) {
            if (!w.webContents.isDestroyed()) {
              try { w.webContents.send(`ssh-closed-${sessionId}`); } catch(e) {}
            }
          }
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
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.on('ssh-write', (event, { sessionId, data }) => {
    const proto = sessionProtocols.get(sessionId);
    if (proto === 'local' || proto === 'telnet') {
      ptyWrite(sessionId, data, proto);
    } else {
      const session = connectionManager.sessions.get(sessionId);
      if (session && session.stream) session.stream.write(data);
    }
  });

  ipcMain.on('ssh-resize', (event, { sessionId, cols, rows }) => {
    const proto = sessionProtocols.get(sessionId);
    if (proto === 'local' || proto === 'telnet') {
      ptyResize(sessionId, cols, rows, proto);
    } else {
      const session = connectionManager.sessions.get(sessionId);
      if (session && session.stream && session.stream.setWindow) {
        session.stream.setWindow(rows, cols, 0, 0);
      }
    }
  });

  ipcMain.on('ssh-disconnect', async (event, sessionId) => {
    const proto = sessionProtocols.get(sessionId);
    sessionProtocols.delete(sessionId);
    sshBridge.cleanupSession(sessionId);
    if (proto === 'local' || proto === 'telnet') {
      await ptyKill(sessionId, proto);
      await recordDisconnect(app, sessionId);
      return;
    }
    await recordDisconnect(app, sessionId);
    const session = connectionManager.sessions.get(sessionId);
    if (session) {
      if (session.stream) session.stream.close();
      if (session.client) session.client.end();
    }
    await connectionManager.removeSession(sessionId);
  });

  ipcMain.handle('get-known-hosts', async () => {
    const hosts = await getKnownHosts(app);
    return Object.values(hosts);
  });

  ipcMain.handle('get-connection-logs', async () => {
    let history: AuditLogRecord[] = [];
    const filePath = path.join(app.getPath('userData'), 'connection_history.json');
    if (fs.existsSync(filePath)) {
      try {
        const data = await fs.promises.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(data);
        // [M-15] Security Fix: Enforce basic schema validation
        if (Array.isArray(parsed)) {
          history = parsed;
        } else {
          history = [];
        }
      } catch (e) {
        history = [];
      }
    }

    // Append active sessions
    const now = Date.now();
    for (const info of activeConnections.values()) {
      const diffSec = Math.floor((now - info.connectedAtMs) / 1000);
      let durationStr = '';
      if (diffSec < 60) durationStr = '< 1m';
      else {
        const h = Math.floor(diffSec / 3600);
        const m = Math.floor((diffSec % 3600) / 60);
        const s = diffSec % 60;
        if (h > 0) durationStr += `${h}h `;
        if (m > 0) durationStr += `${m}m `;
        durationStr += `${s}s`;
        durationStr = durationStr.trim();
      }

      history.push({
        id: info.id,
        alias: info.alias,
        host: info.host,
        port: info.port,
        connectedAt: info.connectedAtStr,
        disconnectedAt: 'Online',
        duration: durationStr
      });
    }

    return history;
  });

  ipcMain.handle('export-connection-logs', async () => {
    const win = getWindow();
    if (!win) return false;
    
    const filePath = path.join(app.getPath('userData'), 'connection_history.json');
    if (!fs.existsSync(filePath)) return false;
    
    const { canceled, filePath: savePath } = await dialog.showSaveDialog(win, {
      title: 'Export Audit Logs',
      defaultPath: `audit_logs_${new Date().toISOString().slice(0,10)}.json`,
      filters: [{ name: 'JSON Reports', extensions: ['json'] }]
    });

    if (canceled || !savePath) return false;
    
    try {
      await fs.promises.copyFile(filePath, savePath);
      return true;
    } catch (err) {
      console.error('Failed to export logs', err);
      return false;
    }
  });

  ipcMain.handle('delete-known-host', async (event, host: string, port: number) => {
    const hosts = await getKnownHosts(app);
    const hostKey = `${host}:${port}`;
    if (hosts[hostKey]) {
      delete hosts[hostKey];
      await saveKnownHosts(app, hosts);
      return true;
    }
    return false;
  });
}

export async function killAllSessions(app: Electron.App) {
  for (const sessionId of connectionManager.sessions.keys()) {
    const proto = sessionProtocols.get(sessionId);
    sessionProtocols.delete(sessionId);
    sshBridge.cleanupSession(sessionId);
    if (proto === 'local' || proto === 'telnet') {
      await ptyKill(sessionId, proto);
      await recordDisconnect(app, sessionId);
      continue;
    }
    await recordDisconnect(app, sessionId);
    const session = connectionManager.sessions.get(sessionId);
    if (session) {
      if (session.stream) session.stream.close();
      if (session.client) session.client.end();
    }
    await connectionManager.removeSession(sessionId);
  }
}
