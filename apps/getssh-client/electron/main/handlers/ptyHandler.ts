/**
 * ptyHandler.ts — Multi-Protocol Terminal Bus
 * 
 * Routes terminal sessions based on protocol:
 *   - 'local'  → node-pty (local shell)
 *   - 'telnet' → raw net.Socket with Telnet NVT negotiation (vt100 termType for network gear)
 * 
 * Data path (both protocols):
 *   Main → Renderer: emitSessionData → every window gets (`ssh-data-${sessionId}`, str, endOffset)
 *   Main ← Renderer: ipcMain.on('ssh-write', { sessionId, data })   [reuses SSH write channel]
 *   Main ← Renderer: ipcMain.handle('ssh-connect', config)          [reuses SSH connect IPC]
 */

import net from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import { connectionManager } from '../services/ConnectionManager';
import { sshBridge } from '../services/SSHBridge';
import { emitSessionData } from '../services/SessionOutputBuffer';
import { broadcastToAllWindows } from '../windowRegistry';

// Lazy-load node-pty to avoid issues when native module not present
let pty: typeof import('node-pty') | null = null;
function getPty() {
  if (!pty) {
    try {
      pty = require('node-pty');
    } catch (e) {
      throw new Error('node-pty-prebuilt-multiarch is not available: ' + String(e));
    }
  }
  return pty!;
}

// Track pty processes keyed by sessionId so we can write/kill them
const localPtyProcesses = new Map<string, import('node-pty').IPty>();
// Track telnet sockets
const telnetSockets = new Map<string, net.Socket>();

/** Called when a local/telnet session ends, whether it was killed or ended on its own. */
export type SessionEndedHandler = (sessionId: string) => void | Promise<void>;

function emitOutput(sessionId: string, data: string) {
  emitSessionData(sessionId, data);
  sshBridge.broadcastData(sessionId, data);
}

/** Bookkeeping shared by every way a local/telnet session can end. Safe to run more than once. */
async function finishSession(sessionId: string, onEnded: SessionEndedHandler) {
  sessionProtocols.delete(sessionId);
  sshBridge.cleanupSession(sessionId);
  await connectionManager.removeSession(sessionId);
  broadcastToAllWindows(`ssh-closed-${sessionId}`);
  try {
    await onEnded(sessionId);
  } catch (e) {
    console.error('[ptyHandler] session end handler failed', e);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// LOCAL TERMINAL
// ────────────────────────────────────────────────────────────────────────────

export function getSafeShell(): string {
  if (process.platform === 'win32') {
    return 'powershell.exe';
  }

  const defaultShell = '/bin/bash';
  const envShell = process.env.SHELL;

  if (!envShell) {
    return defaultShell;
  }

  const allowedShells = [
    '/bin/bash',
    '/bin/sh',
    '/bin/zsh',
    '/usr/bin/bash',
    '/usr/bin/sh',
    '/usr/bin/zsh',
    '/usr/local/bin/bash',
    '/usr/local/bin/zsh',
    '/opt/homebrew/bin/bash',
    '/opt/homebrew/bin/zsh'
  ];

  if (allowedShells.includes(envShell)) {
    return envShell;
  }

  return defaultShell;
}

export async function spawnLocalTerminal(
  config: any,
  sessionId: string,
  onEnded: SessionEndedHandler
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  try {
    const ptyLib = getPty();

    const shell = getSafeShell();

    // [H-06] Security Fix: Clamp PTY dimensions to prevent buffer allocation crashes
    const cols = Math.min(Math.max(config.cols || 80, 10), 1000);
    const rows = Math.min(Math.max(config.rows || 24, 10), 1000);

    const ptyProcess = ptyLib.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME || process.cwd(),
      env: ((): Record<string, string> => {
        // [M-14] Security Fix: Filter out sensitive tokens from the PTY environment using a blocklist
        // An allowlist is too brittle and breaks shell initialization on different OSes.
        const safeEnv: Record<string, string> = {};
        for (const key of Object.keys(process.env)) {
          if (!/^(?:AWS|AZURE|GCP|GOOGLE|npm|NPM|STRIPE|GITHUB|GITLAB)_/.test(key) &&
              !/token|secret|password/i.test(key)) {
            const val = process.env[key];
            if (val !== undefined) {
              safeEnv[key] = val;
            }
          }
        }
        return safeEnv;
      })(),
    });

    localPtyProcesses.set(sessionId, ptyProcess);

    // Pipe PTY output → every window (through the session output ring)
    ptyProcess.onData((data: string) => {
      emitOutput(sessionId, data);
    });

    // Fires both when the shell exits on its own and after killLocalPty
    ptyProcess.onExit(async () => {
      if (localPtyProcesses.get(sessionId) === ptyProcess) localPtyProcesses.delete(sessionId);
      await finishSession(sessionId, onEnded);
    });

    // Instant local OS fingerprint from process.platform
    const localOs = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'generic';
    broadcastToAllWindows('os-fingerprint', { host: 'localhost', username: '', osType: localOs, sessionId });

    // Register a dummy session so connectionManager tracks it
    connectionManager.sessions.set(sessionId, { client: null as any, stream: null });
    connectionManager.updatePowerSaveBlocker();

    return { success: true, sessionId };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function writeLocalPty(sessionId: string, data: string) {
  const proc = localPtyProcesses.get(sessionId);
  if (proc) proc.write(data);
}

export function resizeLocalPty(sessionId: string, cols: number, rows: number) {
  const proc = localPtyProcesses.get(sessionId);
  if (proc) {
    // [H-06] Security Fix: Clamp PTY dimensions during resize
    const safeCols = Math.min(Math.max(cols || 80, 10), 1000);
    const safeRows = Math.min(Math.max(rows || 24, 10), 1000);
    proc.resize(safeCols, safeRows);
  }
}

export async function killLocalPty(sessionId: string) {
  const proc = localPtyProcesses.get(sessionId);
  if (proc) {
    try { proc.kill(); } catch (_) {}
    localPtyProcesses.delete(sessionId);
  }
  await connectionManager.removeSession(sessionId);
}

export async function killAllPtys() {
  for (const sessionId of localPtyProcesses.keys()) {
    await killLocalPty(sessionId);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TELNET — RFC 854 NVT negotiation (minimal, network-gear compatible)
// ────────────────────────────────────────────────────────────────────────────

const TELNET_IAC  = 0xFF;
const TELNET_WILL = 0xFB;
const TELNET_WONT = 0xFC;
const TELNET_DO   = 0xFD;
const TELNET_DONT = 0xFE;
const TELNET_SB   = 0xFA;  // sub-negotiation begin
const TELNET_SE   = 0xF0;  // sub-negotiation end
const OPT_ECHO       = 0x01;
const OPT_SGA        = 0x03;  // Suppress Go-Ahead
const OPT_TERMINAL   = 0x18;  // Terminal Type

/** Per-connection telnet parser state. */
export interface TelnetStreamState {
  /** Start of an IAC sequence cut at the end of the previous packet. */
  pending: Buffer | null;
  /** Payload bytes are UTF-8; a character split across packets is completed by the next one. */
  decoder: StringDecoder;
  /**
   * Options as agreed so far: ours (WILL/WONT we sent) and the server's (DO/DONT we sent). A
   * request that would not change them gets no answer (RFC 854, RFC 1143); answering every DO and
   * WILL let a server that acknowledges acknowledgements keep the exchange going forever.
   */
  local: Map<number, boolean>;
  remote: Map<number, boolean>;
  /** Refusals sent per option (ours, and the server's at 256 + option). */
  refusals: Map<number, number>;
}

export function newTelnetStreamState(): TelnetStreamState {
  return { pending: null, decoder: new StringDecoder('utf8'), local: new Map(), remote: new Map(), refusals: new Map() };
}

const MAX_TELNET_REFUSALS = 3;

/**
 * Refuses a request to enable an option we do not support. RFC 1143 answers every such request;
 * after three for one option the server is asking in a loop, and it gets no more answers.
 */
function refuse(socket: net.Socket, state: TelnetStreamState, side: 'local' | 'remote', opt: number) {
  state[side].set(opt, false);
  const key = side === 'local' ? opt : 256 + opt;
  const sent = state.refusals.get(key) ?? 0;
  if (sent >= MAX_TELNET_REFUSALS) return;
  state.refusals.set(key, sent + 1);
  socket.write(Buffer.from([TELNET_IAC, side === 'local' ? TELNET_WONT : TELNET_DONT, opt]));
}

function sendTerminalType(socket: net.Socket) {
  socket.write(Buffer.from([
    TELNET_IAC, TELNET_SB, OPT_TERMINAL, 0x00, // IS
    ...Buffer.from('vt100'),
    TELNET_IAC, TELNET_SE
  ]));
}

/**
 * Answers a request to enable an option: `command` (WILL/DO to accept, WONT/DONT to refuse), unless
 * that answer was already given. Returns whether it was sent.
 */
function agree(socket: net.Socket, options: Map<number, boolean>, opt: number, enabled: boolean, command: number): boolean {
  if (options.get(opt) === enabled) return false;
  options.set(opt, enabled);
  socket.write(Buffer.from([TELNET_IAC, command, opt]));
  return true;
}

/** A request to disable an option: answered only when it is on (options start off, RFC 854). */
function disable(socket: net.Socket, options: Map<number, boolean>, opt: number, command: number) {
  if (options.get(opt) === true) agree(socket, options, opt, false, command);
  else options.set(opt, false);
}

// A sub-negotiation that never terminates must not grow the carry-over forever.
const TELNET_MAX_PENDING = 64 * 1024;

/**
 * Respond to Telnet option negotiation and strip IAC sequences from data.
 * Returns decoded text. An IAC sequence cut at the end of a packet is kept in
 * `state.pending` and finished with the next packet instead of leaking into the text.
 */
export function processTelnetData(raw: Buffer, socket: net.Socket, state: TelnetStreamState): string {
  const buf = state.pending ? Buffer.concat([state.pending, raw]) : raw;
  state.pending = null;

  const payload: Buffer[] = [];
  let runStart = 0;
  let i = 0;
  while (i < buf.length) {
    if (buf[i] !== TELNET_IAC) {
      i++;
      continue;
    }
    if (i > runStart) payload.push(buf.subarray(runStart, i));

    const seqStart = i;
    let incomplete = false;
    const cmd = i + 1 < buf.length ? buf[i + 1] : -1;
    if (cmd === -1) {
      incomplete = true;
    } else if (cmd === TELNET_IAC) {
      // IAC IAC is an escaped 0xFF data byte
      payload.push(buf.subarray(i + 1, i + 2));
      i += 2;
    } else if (cmd === TELNET_DO || cmd === TELNET_DONT || cmd === TELNET_WILL || cmd === TELNET_WONT) {
      if (i + 2 >= buf.length) {
        incomplete = true;
      } else {
        const opt = buf[i + 2];
        if (cmd === TELNET_DO) {
          // Options on our side: terminal type and suppress-go-ahead, nothing else.
          if (opt === OPT_TERMINAL) {
            // WILL TERMINAL-TYPE, then SB TERMINAL-TYPE IS vt100 SE right away (servers that wait
            // for it get it again on SB SEND below)
            if (agree(socket, state.local, opt, true, TELNET_WILL)) sendTerminalType(socket);
          } else if (opt === OPT_SGA) {
            agree(socket, state.local, opt, true, TELNET_WILL);
          } else {
            refuse(socket, state, 'local', opt);
          }
        } else if (cmd === TELNET_DONT) {
          disable(socket, state.local, opt, TELNET_WONT);
        } else if (cmd === TELNET_WILL) {
          // Options on the server's side: only echo.
          if (opt === OPT_ECHO) agree(socket, state.remote, opt, true, TELNET_DO);
          else refuse(socket, state, 'remote', opt);
        } else {
          disable(socket, state.remote, opt, TELNET_DONT);
        }
        i += 3;
      }
    } else if (cmd === TELNET_SB) {
      // Skip sub-negotiation until IAC SE
      let j = i + 2;
      while (j + 1 < buf.length && !(buf[j] === TELNET_IAC && buf[j + 1] === TELNET_SE)) j++;
      if (j + 1 >= buf.length) incomplete = true;
      else {
        // TERMINAL-TYPE SEND: the server asks for the terminal type.
        if (buf[i + 2] === OPT_TERMINAL && buf[i + 3] === 0x01 && state.local.get(OPT_TERMINAL) === true) sendTerminalType(socket);
        i = j + 2;
      }
    } else {
      // Two-byte commands (NOP, GA, ...)
      i += 2;
    }

    if (incomplete) {
      const rest = buf.subarray(seqStart);
      state.pending = rest.length <= TELNET_MAX_PENDING ? Buffer.from(rest) : null;
      runStart = buf.length;
      break;
    }
    runStart = i;
  }
  if (runStart < buf.length) payload.push(buf.subarray(runStart));

  if (payload.length === 0) return '';
  return state.decoder.write(payload.length === 1 ? payload[0] : Buffer.concat(payload));
}

export async function spawnTelnetSession(
  config: any,
  sessionId: string,
  onEnded: SessionEndedHandler
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  return new Promise((resolve) => {
    const host = config.host;
    const port = config.port || 23;

    let connected = false;
    let settled = false;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = (result: { success: boolean; sessionId?: string; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      resolve(result);
    };

    const streamState = newTelnetStreamState();
    const socket = net.createConnection({ host, port }, () => {
      if (settled) {
        // The connect attempt was already given up on (timeout); do not bring up a session nobody owns.
        socket.destroy();
        return;
      }
      connected = true;
      telnetSockets.set(sessionId, socket);
      connectionManager.sessions.set(sessionId, { client: null as any, stream: null });
      connectionManager.updatePowerSaveBlocker();

      // Announce initial capabilities
      agree(socket, streamState.local, OPT_SGA, true, TELNET_WILL);

      settle({ success: true, sessionId });
    });

    let bannerFingerprinted = false;
    socket.on('data', (raw: Buffer) => {
      const text = processTelnetData(raw, socket, streamState);
      if (text) {
        emitOutput(sessionId, text);
        // Fingerprint from welcome banner (first packet only)
        if (!bannerFingerprinted) {
          bannerFingerprinted = true;
          const lower = text.toLowerCase();
          type OsType = 'cisco'|'huawei'|'generic';
          let osType: OsType = 'generic';
          if (lower.includes('cisco') || lower.includes('ios') || lower.includes('catalyst')) osType = 'cisco';
          else if (lower.includes('huawei') || lower.includes('vrp') || lower.includes('quidway')) osType = 'huawei';
          broadcastToAllWindows('os-fingerprint', { host, username: config?.username || '', osType, sessionId });
        }
      }
    });

    // 'close' follows 'error', and also fires after killTelnetSocket: the single place a session ends.
    socket.on('close', async () => {
      if (telnetSockets.get(sessionId) === socket) telnetSockets.delete(sessionId);
      if (!connected) {
        settle({ success: false, error: `Telnet connection to ${host}:${port} closed` });
        return;
      }
      const tail = streamState.decoder.end();
      if (tail) emitOutput(sessionId, tail);
      await finishSession(sessionId, onEnded);
    });

    socket.on('error', (err) => {
      settle({ success: false, error: err.message });
    });

    connectTimer = setTimeout(() => {
      if (!connected) {
        settle({ success: false, error: `Telnet connection to ${host}:${port} timed out` });
        socket.destroy();
      }
    }, 10000);
  });
}

export function writeTelnetSocket(sessionId: string, data: string) {
  const socket = telnetSockets.get(sessionId);
  if (socket && !socket.destroyed) socket.write(data);
}

export function killTelnetSocket(sessionId: string) {
  const socket = telnetSockets.get(sessionId);
  if (socket) {
    try { socket.destroy(); } catch (_) {}
    telnetSockets.delete(sessionId);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// UNIFIED WRITE & RESIZE — called by ssh-write / ssh-resize IPC handlers
// ────────────────────────────────────────────────────────────────────────────

export function ptyWrite(sessionId: string, data: string, protocol: string) {
  if (protocol === 'local') {
    writeLocalPty(sessionId, data);
  } else if (protocol === 'telnet') {
    writeTelnetSocket(sessionId, data);
  }
}

export function ptyResize(sessionId: string, cols: number, rows: number, protocol: string) {
  if (protocol === 'local') {
    resizeLocalPty(sessionId, cols, rows);
  }
  // Telnet resize: send NAWS option if needed (optional, skip for now)
}

export async function ptyKill(sessionId: string, protocol: string) {
  if (protocol === 'local') {
    await killLocalPty(sessionId);
  } else if (protocol === 'telnet') {
    killTelnetSocket(sessionId);
    await connectionManager.removeSession(sessionId);
  }
}

// Protocol registry: maps sessionId → protocol type for routing writes/resizes
export const sessionProtocols = new Map<string, 'ssh' | 'local' | 'telnet'>();
