/**
 * ptyHandler.ts — Multi-Protocol Terminal Bus
 * 
 * Routes terminal sessions based on protocol:
 *   - 'local'  → node-pty (local shell)
 *   - 'telnet' → raw net.Socket with Telnet NVT negotiation (vt100 termType for network gear)
 * 
 * Data path (both protocols):
 *   Main → Renderer: webContents.send(`ssh-data-${sessionId}`, str)
 *   Main ← Renderer: ipcMain.on('ssh-write', { sessionId, data })   [reuses SSH write channel]
 *   Main ← Renderer: ipcMain.handle('ssh-connect', config)          [reuses SSH connect IPC]
 */

import { BrowserWindow } from 'electron';
import net from 'node:net';
import { connectionManager } from '../services/ConnectionManager';
import { sshBridge } from '../services/SSHBridge';

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
  getWindow: () => BrowserWindow | null
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
        const safeEnv: Record<string, string> = { ...process.env } as Record<string, string>;
        const sensitivePrefixes = ['AWS_', 'AZURE_', 'GCP_', 'GOOGLE_', 'npm_', 'NPM_', 'STRIPE_', 'GITHUB_', 'GITLAB_'];
        for (const key of Object.keys(safeEnv)) {
          const lowerKey = key.toLowerCase();
          if (
            sensitivePrefixes.some(prefix => key.startsWith(prefix)) || 
            lowerKey.includes('token') || 
            lowerKey.includes('secret') || 
            lowerKey.includes('password')
          ) {
            delete safeEnv[key];
          }
        }
        return safeEnv;
      })(),
    });

    localPtyProcesses.set(sessionId, ptyProcess);

    // Pipe PTY output → Renderer
    ptyProcess.onData((data: string) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        try { win.webContents.send(`ssh-data-${sessionId}`, data); } catch(e) {}
      }
      sshBridge.broadcastData(sessionId, data);
    });

    ptyProcess.onExit(async () => {
      localPtyProcesses.delete(sessionId);
      await connectionManager.removeSession(sessionId);
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        try { win.webContents.send(`ssh-closed-${sessionId}`); } catch(e) {}
      }
    });

    // Instant local OS fingerprint from process.platform
    const localOs = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'generic';
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      try { win.webContents.send('os-fingerprint', { host: 'localhost', username: '', osType: localOs, sessionId }); } catch(e) {}
    }

    // Register a dummy session so connectionManager tracks it
    connectionManager.sessions.set(sessionId, { client: null as any, stream: null });

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

/**
 * Respond to Telnet option negotiation and strip IAC sequences from data.
 * Returns cleaned printable text.
 */
function processTelnetData(raw: Buffer, socket: net.Socket): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === TELNET_IAC) {
      if (i + 2 >= raw.length) break;
      const cmd = raw[i + 1];
      const opt = raw[i + 2];
      if (cmd === TELNET_DO) {
        if (opt === OPT_TERMINAL) {
          // Respond: WILL TERMINAL-TYPE, then SB TERMINAL-TYPE IS vt100 SE
          socket.write(Buffer.from([TELNET_IAC, TELNET_WILL, OPT_TERMINAL]));
          const termName = Buffer.from('vt100');
          socket.write(Buffer.from([
            TELNET_IAC, TELNET_SB, OPT_TERMINAL, 0x00, // IS
            ...termName,
            TELNET_IAC, TELNET_SE
          ]));
        } else if (opt === OPT_SGA) {
          socket.write(Buffer.from([TELNET_IAC, TELNET_WILL, OPT_SGA]));
        } else {
          socket.write(Buffer.from([TELNET_IAC, TELNET_WONT, opt]));
        }
        i += 3;
      } else if (cmd === TELNET_WILL) {
        if (opt === OPT_ECHO) {
          socket.write(Buffer.from([TELNET_IAC, TELNET_DO, OPT_ECHO]));
        } else {
          socket.write(Buffer.from([TELNET_IAC, TELNET_DONT, opt]));
        }
        i += 3;
      } else if (cmd === TELNET_SB) {
        // Skip sub-negotiation until SE
        while (i < raw.length && !(raw[i] === TELNET_IAC && raw[i + 1] === TELNET_SE)) i++;
        i += 2;
      } else {
        i += 2;
      }
    } else {
      out += String.fromCharCode(raw[i]);
      i++;
    }
  }
  return out;
}

export async function spawnTelnetSession(
  config: any,
  sessionId: string,
  getWindow: () => BrowserWindow | null
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  return new Promise((resolve) => {
    const host = config.host;
    const port = config.port || 23;

    const socket = net.createConnection({ host, port }, () => {
      telnetSockets.set(sessionId, socket);
      connectionManager.sessions.set(sessionId, { client: null as any, stream: null });

      // Announce initial capabilities
      socket.write(Buffer.from([TELNET_IAC, TELNET_WILL, OPT_SGA]));

      resolve({ success: true, sessionId });
    });

    let bannerFingerprinted = false;
    socket.on('data', (raw: Buffer) => {
      const text = processTelnetData(raw, socket);
      if (text) {
        const win = getWindow();
        if (win && !win.isDestroyed()) {
          try { win.webContents.send(`ssh-data-${sessionId}`, text); } catch(e) {}
        }
        sshBridge.broadcastData(sessionId, text);
        // Fingerprint from welcome banner (first packet only)
        if (!bannerFingerprinted) {
          bannerFingerprinted = true;
          const lower = text.toLowerCase();
          type OsType = 'cisco'|'huawei'|'generic';
          let osType: OsType = 'generic';
          if (lower.includes('cisco') || lower.includes('ios') || lower.includes('catalyst')) osType = 'cisco';
          else if (lower.includes('huawei') || lower.includes('vrp') || lower.includes('quidway')) osType = 'huawei';
          if (win && !win.isDestroyed()) {
            try { win.webContents.send('os-fingerprint', { host, username: config?.username || '', osType, sessionId }); } catch(e) {}
          }
        }
      }
    });

    socket.on('close', async () => {
      telnetSockets.delete(sessionId);
      await connectionManager.removeSession(sessionId);
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        try { win.webContents.send(`ssh-closed-${sessionId}`); } catch(e) {}
      }
    });

    socket.on('error', async (err) => {
      telnetSockets.delete(sessionId);
      await connectionManager.removeSession(sessionId);
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        try { win.webContents.send(`ssh-closed-${sessionId}`); } catch(e) {}
      }
      resolve({ success: false, error: err.message });
    });

    setTimeout(() => {
      if (!telnetSockets.has(sessionId)) {
        resolve({ success: false, error: `Telnet connection to ${host}:${port} timed out` });
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
