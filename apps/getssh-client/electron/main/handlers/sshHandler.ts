import { BrowserWindow, dialog } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import { Client, ConnectConfig } from 'ssh2';
import { SocksClient } from 'socks';
import { connectionManager } from '../services/ConnectionManager';
import path from 'node:path';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
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
import { tidalBridge } from '../tidal/tidalBridge';
import { emitSessionData, readScrollback, dropSession } from '../services/SessionOutputBuffer';
import { broadcastToAllWindows, isKnownTopLevelSender } from '../windowRegistry';

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

interface PendingVerification {
  // What the main process verified. The renderer's answer only says accept/reject;
  // hostname and fingerprint it sends back are never trusted.
  host: string;
  port: number;
  hostKey: string;
  fingerprint: string;
  /** webContents the prompt was sent to; only it may answer. */
  targetId: number;
  /** Answers ssh2's hostVerifier once; later calls are ignored. */
  finish: (accept: boolean) => void;
  /** Forgets the prompt without answering (the connection is already gone). */
  cancel: () => void;
}

interface AuditStreamHandle {
  writeFrame(timestamp: number, data: Buffer): void;
  end(): void;
}

type ConnectResult = { success: boolean; sessionId?: string; error?: string };

// ssh2's own readyTimeout default; ours is paused while a host-key prompt is open.
const SSH_HANDSHAKE_TIMEOUT_MS = 20000;
// An unanswered host-key prompt (lost modal, hung renderer) rejects the connection after this.
const HOST_VERIFY_TIMEOUT_MS = 5 * 60 * 1000;

let knownHosts: Record<string, KnownHost> | null = null;
const pendingVerifications = new Map<string, PendingVerification>();
const activeConnections = new Map<string, ActiveConnectionInfo>();
const sshAuditStreams = new Map<string, AuditStreamHandle>();
const disconnecting = new Map<string, Promise<void>>();
// Full connect config (secrets included) of every session that connected, so 'ssh-reconnect' can
// dial it again the same way. Main-process memory only: never sent to a renderer. Kept after the
// session ends on its own (that is when it is needed); forgotten only in disconnectSession.
const sessionConfigs = new Map<string, any>();
let sessionApp: Electron.App | null = null;
// connection_history.json is read-modify-written; concurrent disconnects (closing a tab with
// several panes, quit) must not overwrite each other's records.
let historyWrites: Promise<void> = Promise.resolve();

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
  
  const append = async () => {
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
  };
  const write = historyWrites.then(append);
  historyWrites = write;
  await write;
}

function endAuditStream(sessionId: string) {
  const audit = sshAuditStreams.get(sessionId);
  if (!audit) return;
  sshAuditStreams.delete(sessionId);
  try { audit.end(); } catch (e) { console.error("AuditStream flush error:", e); }
}

function rememberConnectConfig(sessionId: string, config: any) {
  sessionConfigs.set(sessionId, { ...config });
}

/**
 * A session's transport has closed. If the session still has its stored connect config it ended on
 * its own (disconnectSession forgets the config before it closes anything), so every pane showing
 * it, in any window, is flagged disconnected in the layout. Fire and forget.
 */
function markIfEndedOnItsOwn(sessionId: string) {
  if (!sessionConfigs.has(sessionId)) return;
  tidalBridge.markSessionDisconnected(sessionId).catch((e: unknown) => {
    console.error(`[sshHandler] markSessionDisconnected(${sessionId}) failed`, e);
  });
}

/**
 * Registers a host-key prompt. `answer` is called exactly once: with the user's decision, or with
 * false when the window it was shown in goes away or nobody answers within HOST_VERIFY_TIMEOUT_MS.
 */
function openHostVerification(
  requestId: string,
  target: Electron.WebContents,
  info: { host: string; port: number; hostKey: string; fingerprint: string },
  answer: (accept: boolean) => void
) {
  let done = false;
  const release = () => {
    done = true;
    pendingVerifications.delete(requestId);
    clearTimeout(timer);
    if (!target.isDestroyed()) {
      target.removeListener('destroyed', onTargetGone);
      // Lets the window drop a prompt that can no longer be answered (timeout, connection error).
      // After a normal answer the renderer has already removed it, so this is a no-op there.
      try { target.send('host-verification-cancelled', requestId); } catch {}
    }
  };
  const onTargetGone = () => {
    if (done) return;
    release();
    answer(false);
  };
  const timer = setTimeout(onTargetGone, HOST_VERIFY_TIMEOUT_MS);
  target.once('destroyed', onTargetGone);
  pendingVerifications.set(requestId, {
    ...info,
    targetId: target.id,
    finish: (accept) => {
      if (done) return;
      release();
      answer(accept);
    },
    cancel: () => {
      if (!done) release();
    },
  });
}

/**
 * Ends a session of any protocol, drops its scrollback and forgets its stored connect config.
 * Idempotent: for an id that is unknown or already closed it only drops the scrollback and the
 * config (no second audit record). Used by 'ssh-disconnect', by tidalBridge when Rust removes
 * panes/tabs, and at quit.
 */
export async function disconnectSession(sessionId: string): Promise<void> {
  if (typeof sessionId !== 'string' || !sessionId) return;
  const inFlight = disconnecting.get(sessionId);
  if (inFlight) return inFlight;

  const run = (async () => {
    // First, synchronously: the close events this triggers must not count as "ended on its own".
    sessionConfigs.delete(sessionId);
    const proto = sessionProtocols.get(sessionId);
    sessionProtocols.delete(sessionId);
    sshBridge.cleanupSession(sessionId);
    if (proto === 'local' || proto === 'telnet') {
      await ptyKill(sessionId, proto);
    } else {
      endAuditStream(sessionId);
      const session = connectionManager.sessions.get(sessionId);
      if (session) {
        try { if (session.stream) session.stream.close(); } catch (e) {}
        try { if (session.client) session.client.end(); } catch (e) {}
      }
      await connectionManager.removeSession(sessionId);
    }
    if (sessionApp) await recordDisconnect(sessionApp, sessionId);
    dropSession(sessionId);
  })()
    .catch((e) => console.error(`[sshHandler] disconnect of ${sessionId} failed`, e))
    .finally(() => disconnecting.delete(sessionId));
  disconnecting.set(sessionId, run);
  return run;
}

export function registerSshHandlers(ipcMain: Electron.IpcMain, app: Electron.App, getWindow: () => BrowserWindow | null) {
  sessionApp = app;

  // Rust hands back the session ids of the leaves it removed (close pane / close tab / replace pane).
  tidalBridge.setSessionTerminator((ids) => ids.forEach((id) => void disconnectSession(id)));

  // Runs whenever a local / telnet session ends (killed or on its own): sessions that end on their
  // own still need their audit record closed and their panes flagged disconnected.
  const onPtySessionEnded = (sessionId: string) => {
    markIfEndedOnItsOwn(sessionId);
    return recordDisconnect(app, sessionId);
  };

  ipcMain.on('host-verification-result', async (event, payload) => {
    const { requestId, result } = payload || {};
    const pending = typeof requestId === 'string' ? pendingVerifications.get(requestId) : undefined;
    if (!pending) return;
    // Only the window that was shown the prompt may answer it.
    if (!isKnownTopLevelSender(event) || event.sender.id !== pending.targetId) return;
    pendingVerifications.delete(requestId);

    if (result === 'accept-save') {
      try {
        const hosts = await getKnownHosts(app);
        hosts[pending.hostKey] = {
          host: pending.host,
          port: pending.port,
          fingerprint: pending.fingerprint,
          trustedAt: Date.now()
        };
        await saveKnownHosts(app, hosts);
      } catch (e) {
        console.error('[sshHandler] Failed to save known host', e);
      }
      pending.finish(true);
    } else if (result === 'accept-once') {
      pending.finish(true);
    } else {
      pending.finish(false);
    }
  });

  // A terminal (re)mounting in any window catches up on output it has not seen.
  ipcMain.handle('ssh-get-scrollback', (event, sessionId: unknown, fromOffset?: unknown) => {
    if (!isKnownTopLevelSender(event)) {
      throw new Error('Security Violation: ssh-get-scrollback from unknown sender rejected.');
    }
    if (typeof sessionId !== 'string') return { data: '', endOffset: 0, reset: true };
    return readScrollback(sessionId, typeof fromOffset === 'number' ? fromOffset : undefined);
  });

  /**
   * The one connect path of every protocol, shared by 'ssh-connect' and 'ssh-reconnect'. `invoker`
   * is the (already verified) window that asked; an SSH host-key prompt is shown there.
   */
  const connectSession = async (config: any, invoker: Electron.WebContents): Promise<ConnectResult> => {
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
      const result = await spawnLocalTerminal(config, sessionId, onPtySessionEnded);
      if (result.success) {
        activeConnections.set(sessionId, {
          id: sessionId,
          alias: config.alias || 'Local Terminal',
          host: 'localhost',
          port: 0,
          connectedAtStr: new Date().toLocaleString(),
          connectedAtMs: Date.now()
        });
        rememberConnectConfig(sessionId, config);
      } else {
        sessionProtocols.delete(sessionId);
      }
      return result;
    }

    if (protocol === 'telnet') {
      const result = await spawnTelnetSession(config, sessionId, onPtySessionEnded);
      if (result.success) {
        activeConnections.set(sessionId, {
          id: sessionId,
          alias: config.alias || `${config.host}:${config.port || 23}`,
          host: config.host,
          port: config.port || 23,
          connectedAtStr: new Date().toLocaleString(),
          connectedAtMs: Date.now()
        });
        rememberConnectConfig(sessionId, config);
      } else {
        sessionProtocols.delete(sessionId);
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
        sessionProtocols.delete(sessionId);
        return { success: false, error: 'Failed to read private key: ' + (err instanceof Error ? err.message : String(err)) };
      }
    }

    // The host-key prompt goes to the window that asked for this connection (a torn-off window
    // reconnecting shows it there), or to the main window if that one is gone by then.
    const promptTarget = (): Electron.WebContents | null => {
      if (!invoker.isDestroyed()) return invoker;
      const main = getWindow();
      return main && !main.isDestroyed() && !main.webContents.isDestroyed() ? main.webContents : null;
    };

    return new Promise<ConnectResult>((resolve) => {
      (async () => {
      try {
        // Reuse the sessionId allocated in the dispatch block above
        const sshClient = new Client();
        connectionManager.sessions.set(sessionId, { client: sshClient, stream: null });

        // Until the shell is up, every failure ends in failConnect, which runs once.
        let settled = false;
        let promptRequestId: string | null = null;
        // ssh2's readyTimeout keeps running while hostVerifier waits for the user, so a host-key
        // prompt left open for 20 s used to kill the connection under the modal. ssh2's timer is
        // disabled (readyTimeout: 0) and this one is paused while a prompt is open.
        let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
        const stopHandshakeTimer = () => {
          if (handshakeTimer) clearTimeout(handshakeTimer);
          handshakeTimer = null;
        };
        const startHandshakeTimer = () => {
          stopHandshakeTimer();
          if (settled) return;
          handshakeTimer = setTimeout(() => {
            handshakeTimer = null;
            sshClient.destroy();
            void failConnect('Timed out while waiting for handshake');
          }, SSH_HANDSHAKE_TIMEOUT_MS);
        };
        const failConnect = async (message: string) => {
          if (settled) return;
          settled = true;
          stopHandshakeTimer();
          if (promptRequestId) pendingVerifications.get(promptRequestId)?.cancel();
          try { sshClient.end(); } catch (e) {}
          sessionProtocols.delete(sessionId);
          sshBridge.cleanupSession(sessionId);
          await connectionManager.removeSession(sessionId);
          resolve({ success: false, error: message });
        };

        let connectConfig: ConnectConfig = {
          host: config.host,
          port: config.port || 22,
          username: config.username,
          keepaliveInterval: config.keepaliveInterval !== undefined ? config.keepaliveInterval : 10000, // Heartbeat
          readyTimeout: 0, // replaced by the pausable handshake timer above
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

              if (isChanged && config.strictHostKeyChecking === true) {
                return callback(false);
              }

              const target = promptTarget();
              if (!target || settled) {
                return callback(false);
              }

              const requestId = crypto.randomUUID();
              promptRequestId = requestId;
              stopHandshakeTimer();
              openHostVerification(
                requestId,
                target,
                { host: config.host, port: config.port || 22, hostKey, fingerprint: fingerprintStr },
                (accept) => {
                  promptRequestId = null;
                  // Key exchange and authentication still have to finish in time.
                  startHandshakeTimer();
                  callback(accept);
                }
              );
              try {
                target.send('prompt-host-verification', {
                  requestId,
                  hostname: hostKey,
                  fingerprint: fingerprintStr,
                  isChanged,
                  oldFingerprint
                });
              } catch (e) {
                pendingVerifications.get(requestId)?.finish(false);
              }
            })().catch(() => callback(false));
          }
        };

        if (privateKeyData) {
          connectConfig.privateKey = privateKeyData;
          if (config.passphrase) {
            connectConfig.passphrase = config.passphrase;
          }
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
            stopHandshakeTimer();
            sshClient.shell({ term: 'xterm-256color' }, async (err, stream) => {
            if (err) {
              // The client is authenticated at this point; failConnect ends it.
              await failConnect(err.message);
              return;
            }
            if (settled) {
              // Gave up on this connection while the shell channel was opening.
              try { sshClient.end(); } catch (e) {}
              return;
            }
            settled = true;
            const currentSession = connectionManager.sessions.get(sessionId);
            if (currentSession) currentSession.stream = stream;
            connectionManager.updatePowerSaveBlocker();

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
                 sshAuditStreams.set(sessionId, auditStream);
              } catch (e) {
                 console.error("[AuditStream] Failed to initialize native audit recording module:", e);
              }
            }

            // Output is emitted immediately: the session ring keeps it for terminals that mount later.
            // One decoder per stream, so a UTF-8 character split across two packets is joined
            // instead of turning into U+FFFD. The recording gets the same decoded text the user sees.
            const stdoutDecoder = new StringDecoder('utf8');
            const stderrDecoder = new StringDecoder('utf8');
            const emitOutput = (str: string) => {
              if (!str) return;
              // Looked up per frame: disconnectSession may have ended the recording already.
              const audit = sshAuditStreams.get(sessionId);
              if (audit) {
                 const elapsed = (Date.now() / 1000) - startTime;
                 try { audit.writeFrame(elapsed, Buffer.from(str, 'utf8')); } catch(e) {}
              }
              emitSessionData(sessionId, str);
              sshBridge.broadcastData(sessionId, str);
            };

            stream.on('close', async () => {
              emitOutput(stdoutDecoder.end());
              emitOutput(stderrDecoder.end());
              endAuditStream(sessionId);
              sshClient.end();
              sessionProtocols.delete(sessionId);
              await recordDisconnect(app, sessionId);
              await connectionManager.removeSession(sessionId);
              sshBridge.cleanupSession(sessionId);
              broadcastToAllWindows(`ssh-closed-${sessionId}`);
              markIfEndedOnItsOwn(sessionId);
            }).on('data', (data: Buffer) => {
              emitOutput(stdoutDecoder.write(data));
            }).stderr.on('data', (data: Buffer) => {
              emitOutput(stderrDecoder.write(data));
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
            rememberConnectConfig(sessionId, config);

            resolve({ success: true, sessionId });

            // ── Silent OS Fingerprint Probe ─────────────────────────────
            // Uses a separate exec channel so the PTY stream stays clean.
            setTimeout(() => {
              sshClient.exec('cat /etc/os-release', (execErr, execStream) => {
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
                  broadcastToAllWindows('os-fingerprint', {
                    host: connectConfig.host,
                    username: config.username,
                    osType
                  });
                });
              });
            }, 1200); // Probe once the shell has started
          });
        }).on('error', (err: any) => {
          if (!settled) {
            void failConnect(err.message);
            return;
          }
          // After the shell is up the channel's 'close' handler tears the session down.
          console.error(`[sshHandler] Connection error on ${sessionId}:`, err?.message || err);
        }).on('close', () => {
          void failConnect('Connection closed');
        });
        if (settled) {
          // Timed out or failed while the proxy connection was being set up.
          try { connectConfig.sock?.destroy(); } catch (e) {}
          return;
        }
        startHandshakeTimer();
        sshClient.connect(connectConfig);
        }).catch((err: unknown) => {
           void failConnect(err instanceof Error ? err.message : String(err));
        });
      } catch (e: unknown) {
        sessionProtocols.delete(sessionId);
        await connectionManager.removeSession(sessionId);
        resolve({ success: false, error: e instanceof Error ? e.message : String(e) });
      }
      })();
    });
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  ipcMain.handle('ssh-connect', async (event, config) => {
    // Sender verification: reject requests from sandboxed iframes or unknown windows
    if (event.senderFrame && event.senderFrame.parent !== null) {
      throw new Error('Security Violation: ssh-connect from sandbox sub-frame rejected.');
    }
    const senderIsKnownWindow = BrowserWindow.getAllWindows().some(
      w => !w.isDestroyed() && w.webContents.id === event.sender.id
    );
    if (!senderIsKnownWindow) {
      throw new Error('Security Violation: ssh-connect from unknown WebContents rejected.');
    }
    return connectSession(config, event.sender);
  });

  // Dials a session again with the config it connected with, which never leaves the main process.
  // The old session is left alone: the renderer swaps the pane to the new id and the layout's
  // session terminator (disconnectSession) retires the old one.
  ipcMain.handle('ssh-reconnect', async (event, oldSessionId: unknown): Promise<ConnectResult> => {
    if (!isKnownTopLevelSender(event)) {
      throw new Error('Security Violation: ssh-reconnect from unknown sender rejected.');
    }
    const stored = typeof oldSessionId === 'string' ? sessionConfigs.get(oldSessionId) : undefined;
    if (!stored) return { success: false, error: 'unknown_session' };
    return connectSession({ ...stored }, event.sender);
  });

  // 这条通道有两个来源：
  //   1. 渲染进程 ipcRenderer.send('ssh-write')  —— event 有值，用户在终端里敲字
  //   2. SSHBridge.writeCommand 经 ipcMain.emit  —— event 为 null，AI / 插件写入，
  //      已在 SSHBridge 那层过了 SecureCenter.auditPluginCommand
  // 来源以前无法区分（event 形参全程未使用，AI 侧又传 null）。
  ipcMain.on('ssh-write', (event, payload: any) => {
    if (!event && !payload?.__fromBridge) {
      console.warn('[sshHandler] 拒绝来源不明的 ssh-write（既非渲染进程，也无 bridge 标记）');
      return;
    }
    const { sessionId, data } = payload || {};
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

  ipcMain.on('ssh-disconnect', (_event, sessionId) => {
    void disconnectSession(sessionId);
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

  ipcMain.handle('open-audit-folder', async () => {
    const { getActiveWorkspaceId } = require('./workspaceHandler');
    const workspaceId = getActiveWorkspaceId() || 'default';
    const wsPath = path.join(app.getPath('home'), '.getssh', 'workspaces', workspaceId, 'audit_recordings');
    if (!fs.existsSync(wsPath)) {
       fs.mkdirSync(wsPath, { recursive: true });
    }
    const { shell } = require('electron');
    const error = await shell.openPath(wsPath);
    if (error) throw new Error(error);
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

/**
 * Closes every session (quit). Resolves once each one is torn down, its audit recording has been
 * told to flush and its connection-history record is written.
 */
export async function killAllSessions(app: Electron.App): Promise<void> {
  sessionApp = app;
  const ids = new Set<string>([
    ...connectionManager.sessions.keys(),
    ...sessionProtocols.keys(),
    ...activeConnections.keys(),
    // Sessions that ended on their own: only their stored connect config is left to forget.
    ...sessionConfigs.keys(),
  ]);
  await Promise.all([
    ...[...ids].map((id) => disconnectSession(id)),
    ...disconnecting.values(),
  ]);
  // Recordings of sessions whose channel was still closing on its own
  for (const id of [...sshAuditStreams.keys()]) endAuditStream(id);
  await historyWrites;
}
