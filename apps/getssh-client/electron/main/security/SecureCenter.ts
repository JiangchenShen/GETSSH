import { app, ipcMain } from 'electron';
import child_process from 'child_process';
import net from 'net';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getBackendConfig } from '../handlers/systemHandler';
import { broadcastToAllWindows, isKnownTopLevelSender } from '../windowRegistry';
import { OceanSentinel } from '../services/OceanSentinel';

/** Longest command a plugin or the agent may send to a terminal in one write. */
export const MAX_AUDITED_COMMAND = 64 * 1024;

/**
 * `rm -r … f /`, `rm -r … f /*`, `dd if=… of=/dev/sda|hda|nvme`, mkfs and the bash fork bomb,
 * with exactly the meaning the old `.*` patterns had, in linear time. `.*` stays on one line,
 * so on each line only the first `rm -r` (or `dd if=`) needs checking: the rest of the line
 * after it contains the rest after any later one. The whitespace in `rm\s+-r` and `f\s+/` may
 * still cross line breaks, as before.
 */
const LINE_BREAK = /[\n\r\u2028\u2029]/g;
const RM_RECURSIVE = /\brm\s+-r/g;
const RM_ROOT = /f\s+\/\*?(?!\S)/y;
const DD_INPUT = /\bdd\s+if=/g;
const DD_DISK = /of=\/dev\/(sda|hda|nvme)\b/;

function lineEndAfter(text: string, index: number): number {
  LINE_BREAK.lastIndex = index;
  const found = LINE_BREAK.exec(text);
  return found ? found.index : text.length;
}

export function isDangerousCommand(command: string): boolean {
  if (/\bmkfs(\.[a-z0-9]+)?\b/.test(command) || /:\(\)\{:\|:&\};:/.test(command)) return true;
  let checkedLine = -1;
  RM_RECURSIVE.lastIndex = 0;
  for (let match = RM_RECURSIVE.exec(command); match; match = RM_RECURSIVE.exec(command)) {
    const from = match.index + match[0].length;
    const lineEnd = lineEndAfter(command, from);
    if (lineEnd === checkedLine) continue;
    checkedLine = lineEnd;
    for (let f = command.indexOf('f', from); f !== -1 && f < lineEnd; f = command.indexOf('f', f + 1)) {
      RM_ROOT.lastIndex = f;
      if (RM_ROOT.test(command)) return true;
    }
  }
  checkedLine = -1;
  DD_INPUT.lastIndex = 0;
  for (let match = DD_INPUT.exec(command); match; match = DD_INPUT.exec(command)) {
    const from = match.index + match[0].length;
    const lineEnd = lineEndAfter(command, from);
    if (lineEnd === checkedLine) continue;
    checkedLine = lineEnd;
    if (DD_DISK.test(command.slice(from, lineEnd))) return true;
  }
  return false;
}

export class SecureCenter {
  private static instance: SecureCenter;
  private monitorInterval: NodeJS.Timeout | null = null;
  private isPolluted: boolean = false;
  private socket: net.Socket | null = null;
  private server: net.Server | null = null;
  private sentinelProcess: child_process.ChildProcess | null = null;
  private lockdownMode: boolean = false;
  private pluginTeardownFn: (() => void) | null = null;
  private shutdownTeardownFn: (() => void) | null = null;
  private sentinelDisabled: boolean = false;
  private sentinelLifecycle: 'starting' | 'running' | 'unavailable' = 'starting';
  // Time of the last completed PING write; this one-way protocol has no daemon acknowledgement.
  private lastSentinelPing: number = 0;
  private lastLockdownReason?: string;
  private lastLockdownLevel?: 'red' | 'yellow';

  private constructor() {}

  public static getInstance(): SecureCenter {
    if (!SecureCenter.instance) {
      SecureCenter.instance = new SecureCenter();
    }
    return SecureCenter.instance;
  }

  /** Runs on quit and before a safe-mode restart only (not when one plugin is deactivated). */
  public setShutdownTeardown(fn: () => void) {
    this.shutdownTeardownFn = fn;
  }

  public setPluginTeardown(fn: () => void) {
    this.pluginTeardownFn = fn;
  }

  public gracefulShutdown() {
    OceanSentinel.flushMetrics();
    if (this.socket && !this.socket.destroyed && this.socket.writable) {
      try { this.socket.write('ACTION:QUIT\n'); } catch (e) {}
    }
    try { this.pluginTeardownFn?.(); } catch (e) { console.error('[SecureCenter] Plugin teardown error:', e); }
    try { this.shutdownTeardownFn?.(); } catch (e) { console.error('[SecureCenter] Shutdown teardown error:', e); }
  }

  /**
   * Checks a command a plugin or the agent sends to a terminal. Runs on the main thread, so it
   * must stay fast whatever the input: commands over 64 KiB are refused outright, and every
   * check is linear. (`rm -r.*f /` tried each `rm -r` against the rest of the line, so a 1 MiB
   * line took minutes, long enough for the watchdog to kill GETSSH.)
   */
  public auditPluginCommand(command: string): boolean {
    if (command.length > MAX_AUDITED_COMMAND) {
      console.warn(`[SecureCenter] Refused a terminal command of ${command.length} characters (limit ${MAX_AUDITED_COMMAND}).`);
      return false;
    }
    if (isDangerousCommand(command)) {
      this.triggerLockdown(`Plugin attempted to execute high-risk command: ${command.substring(0, 50)}`, 'yellow');
      return false;
    }
    return true;
  }

  public start() {
    // Check for Safe Mode
    if (process.argv.includes('--safe-mode')) {
        console.warn('[SecureCenter] Booting in SAFE MODE due to Ocean Sentinel recovery.');
        this.isPolluted = true;
        this.sentinelDisabled = true; // no watchdog in safe mode (see the end of start())
        getBackendConfig().pluginSecurityMode = 'safe';
    }

    
    // Register IPC
    ipcMain.handle('resolve-security-lockdown', async (event, action: 'restart-safe' | 'save-15s' | 'ignore' | 'deactivate-plugin' | 'continue', masterPassword?: unknown) => {
      if (!isKnownTopLevelSender(event)) return { ok: false, reason: 'unauthorized' };
      if (!['restart-safe', 'save-15s', 'ignore', 'deactivate-plugin', 'continue'].includes(action)) return { ok: false, reason: 'invalid_action' };
      // A red lockdown (core memory tampering) ends only by restarting, a 15 s save, or a verified
      // "ignore"; the yellow-only actions would otherwise end it without any check.
      if ((action === 'continue' || action === 'deactivate-plugin') && this.lastLockdownLevel === 'red') {
        return { ok: false, reason: 'invalid_action' };
      }
      // Ignoring keeps a compromised process running with the ocean-sentinel off, so the owner must prove
      // who they are here: the renderer's own prompt could simply be skipped. Outside a lockdown
      // there is nothing to ignore, and the check is not offered as a password oracle.
      if (action === 'ignore') {
        if (!this.lockdownMode) return { ok: false, reason: 'invalid_action' };
        const { verifyOwner } = require('./userPresence');
        const { appOwnerDeps } = require('./ownerChecks');
        const outcome = await verifyOwner(
          { password: typeof masterPassword === 'string' ? masterPassword : undefined, reason: 'ignore a security lockdown' },
          appOwnerDeps(),
        );
        if (outcome !== 'verified') return { ok: false, reason: outcome };
      }
      this.handleAction(action);
      return { ok: true };
    });

    ipcMain.handle('get-sentinel-status', (event) => {
      if (!isKnownTopLevelSender(event)) throw new Error('Unauthorized Ocean Sentinel status request');
      const child = this.sentinelProcess;
      const processAlive = !!child?.pid && !child.killed && child.exitCode === null && child.signalCode === null;
      const socketAlive = !!this.socket && !this.socket.destroyed && this.socket.writable;
      const daemonState = this.sentinelDisabled ? 'disabled'
        : this.sentinelLifecycle === 'unavailable' ? 'unavailable'
        : processAlive && socketAlive ? 'running'
        : this.sentinelLifecycle === 'starting' && (!child || processAlive) ? 'starting' : 'unavailable';
      const status = this.isPolluted || daemonState !== 'running' ? 'warning' : 'secure';
      return {
        status,
        level: this.isPolluted ? this.lastLockdownLevel : undefined,
        reason: this.isPolluted ? this.lastLockdownReason : undefined,
        lastPing: this.lastSentinelPing,
        sentinelDisabled: this.sentinelDisabled,
        daemonState,
        supervisorPid: processAlive ? child!.pid : null,
        supervisedPid: process.pid,
        ...OceanSentinel.getRuntimeStatus(),
      };
    });

    // Safe mode is where the watchdog sends the app after a freeze. A watchdog here would kill it
    // again at the next long stall (a modal prompt, a startup error left open) and relaunch it in
    // safe mode, over and over; safe mode runs without one, so a freeze there is neither killed
    // nor restarted.
    if (!this.sentinelDisabled) this.initSentinelWatchdog();
  }

  private initSentinelWatchdog() {
    const platform = os.platform();
    if (platform !== 'darwin' && platform !== 'win32') {
      throw new Error(`GETSSH desktop security runtime is unavailable on ${platform}.`);
    }

    const pipeName = platform === 'win32'
      ? `\\\\.\\pipe\\getssh-ocean-sentinel-${process.pid}`
      : path.join(os.tmpdir(), `getssh-ocean-sentinel-${process.pid}.sock`);

    // Clean up an old macOS socket file if it exists.
    if (platform === 'darwin' && fs.existsSync(pipeName)) {
      fs.unlinkSync(pipeName);
    }

    this.server = net.createServer((socket) => {
      console.log('[SecureCenter] Ocean Sentinel connected.');
      this.socket = socket;
      this.sentinelLifecycle = 'running';
      this.lastSentinelPing = 0;

      socket.on('data', (data) => {
        const msg = data.toString();
        const lines = msg.split('\n');
        for (const line of lines) {
          if (line.startsWith('LOCKDOWN_TRIGGER:')) {
            const parts = line.split(':');
            const level = parts[1] === 'YELLOW' ? 'yellow' : 'red';
            const reason = parts.slice(2).join(':');
            
            if (level === 'red') {
              this.lastLockdownReason = `【核心内存异常】检测到内核 API 被劫持 (${reason})`;
            } else {
              this.lastLockdownReason = `【高危操作阻断】${reason}`;
            }
            this.lastLockdownLevel = level;
            this.lockdownMode = true;
            this.isPolluted = true;
            broadcastToAllWindows('security-lockdown', {
              reason: this.lastLockdownReason,
              countdown: 60,
              level: this.lastLockdownLevel
            });
          } else if (line.startsWith('TICK:')) {
            const tick = parseInt(line.split(':')[1]);
            broadcastToAllWindows('security-lockdown', {
              reason: this.lastLockdownReason,
              countdown: tick,
              level: this.lastLockdownLevel
            });
          } else if (line.includes('RESOLVED')) {
            this.lockdownMode = false;
            // Note: If action was ignore, we keep isPolluted true.
            // So we only reset isPolluted if sentinelDisabled is false.
            if (!this.sentinelDisabled) {
                this.isPolluted = false;
            }
            broadcastToAllWindows('security-lockdown-resolved');
          }
        }
      });

      socket.on('close', () => {
        console.warn('[SecureCenter] Ocean Sentinel disconnected!');
        if (this.socket === socket) {
          this.socket = null;
          this.sentinelLifecycle = 'unavailable';
        }
      });
      
      socket.on('error', (err) => {
        console.error('[SecureCenter] Ocean Sentinel socket error:', err);
        if (this.socket === socket) this.sentinelLifecycle = 'unavailable';
      });
    });

    this.server.on('error', (err) => {
      this.sentinelLifecycle = 'unavailable';
      console.error('[SecureCenter] Ocean Sentinel server error:', err);
    });

    this.server.listen(pipeName, () => {
      // Ocean Sentinel keeps its supervisor in a separate executable.
      let sentinelExecutable = 'watchdog';
      if (platform === 'win32') sentinelExecutable += '.exe';

      const sentinelPath = app.isPackaged
        ? path.join(process.resourcesPath, sentinelExecutable)
        : path.join(__dirname, '../../../../target/release', sentinelExecutable);

      console.log(`[SecureCenter] Spawning Ocean Sentinel: ${sentinelPath} with PID ${process.pid} and pipe ${pipeName}`);

      try {
        if (!fs.existsSync(sentinelPath)) {
            console.error(`[SecureCenter] Ocean Sentinel binary not found at ${sentinelPath}! Please compile it first.`);
            this.sentinelDisabled = true;
            // Notice: we do NOT return here if we want manual RASP alerts to still show up as fallback
        } else {
          // The locale lets the ocean-sentinel's own "not responding" dialog speak the user's language.
          // A development build's executable is the bare Electron binary: restarting it would open
          // Electron's welcome window, so the watchdog gets no executable there and restarts nothing.
          const relaunchPath = app.isPackaged ? process.execPath : '';
          this.sentinelProcess = child_process.spawn(sentinelPath, [process.pid.toString(), pipeName, relaunchPath, app.getLocale()], {
            stdio: 'inherit',
            windowsHide: true,
          });

          this.sentinelProcess.on('exit', (code) => {
              this.sentinelLifecycle = 'unavailable';
              console.error(`[SecureCenter] Ocean Sentinel exited with code ${code}.`);
          });
          this.sentinelProcess.on('error', (err) => {
              this.sentinelLifecycle = 'unavailable';
              console.error('[SecureCenter] Ocean Sentinel process error:', err);
          });
        }

        // Start PING interval. It keeps running during a lockdown: the watchdog ignores heartbeats
        // in an alert, and on Windows its reader and writer share one synchronous pipe handle, so
        // each line it sends (the alert echo, TICK, RESOLVED) goes out only once a PING arrives.
        this.monitorInterval = setInterval(() => {
          if (this.socket && !this.socket.destroyed && !this.sentinelDisabled) {
            const socket = this.socket;
            try {
              socket.write('PING\n', (err) => {
                if (this.socket !== socket) return;
                if (err) this.sentinelLifecycle = 'unavailable';
                else {
                  this.lastSentinelPing = Date.now();
                  this.sentinelLifecycle = 'running';
                }
              });
              if (!this.lockdownMode) this.runLegacyHealthCheck();
            } catch (err) {
              this.sentinelLifecycle = 'unavailable';
            }
          }
        }, 1000);

      } catch (e) {
        this.sentinelLifecycle = 'unavailable';
        console.error('[SecureCenter] Failed to spawn Ocean Sentinel:', e);
      }
    });
  }

  // Still keep some lightweight JS health check to detect pollution and trigger the ocean-sentinel
  private runLegacyHealthCheck() {
    if (getBackendConfig().pluginSecurityMode === 'developer') return;
    
    // Simulating pollution check
    // If it triggers, we notify Ocean Sentinel
    if (this.isPolluted) return;

    // Example of a mock trigger: (for testing, you can expose an IPC to set this to true)
    // if (Math.random() < 0.0001) this.triggerLockdown('Random mock attack');
  }

  public triggerLockdown(reason: string, level: 'red' | 'yellow' = 'yellow') {
    if (this.isPolluted || this.lockdownMode) return;
    this.isPolluted = true;
    this.lockdownMode = true;

    console.error(`[SecureCenter] 🚨 RASP ALERT: ${reason}`);
    
    if (this.socket && !this.socket.destroyed) {
      try { this.socket.write(`LOCKDOWN_TRIGGER:${level.toUpperCase()}:${reason}\n`); } catch(e) {}
    } else {
      // Fallback: If ocean-sentinel is dead/missing, send alert manually immediately
      this.lastLockdownReason = `【Fallback防御】${reason}`;
      this.lastLockdownLevel = level;
      broadcastToAllWindows('security-lockdown', {
        reason: this.lastLockdownReason,
        countdown: 60,
        level: this.lastLockdownLevel
      });
    }
  }

  private handleAction(action: 'restart-safe' | 'save-15s' | 'ignore' | 'deactivate-plugin' | 'continue') {
    // The local consequences of the user's choice must happen even when the ocean-sentinel is missing
    // (the fallback lockdown path); only the acknowledgement to the ocean-sentinel depends on the socket.
    const sentinelAlive = !!this.socket && !this.socket.destroyed;
    const tellSentinel = (message: string) => {
      if (!sentinelAlive) return;
      try { this.socket!.write(message); } catch (e) { console.error('[SecureCenter] Ocean Sentinel write failed:', e); }
    };

    switch (action) {
      case 'restart-safe':
        getBackendConfig().pluginSecurityMode = 'safe';
        // Gracefully deactivate all plugins before RASP kills the process
        try { this.pluginTeardownFn?.(); } catch (e) { console.error('[SecureCenter] Plugin teardown on restart-safe:', e); }
        try { this.shutdownTeardownFn?.(); } catch (e) { console.error('[SecureCenter] Shutdown teardown on restart-safe:', e); }
        // Tell ocean-sentinel we resolved it so it doesn't kill us while restarting
        tellSentinel('ACTION:RESTART-SAFE\n');
        setTimeout(() => {
          if (!process.env.VITE_DEV_SERVER_URL) {
             app.relaunch();
          } else {
             console.log("Dev mode detected. Please restart manually.");
          }
          app.exit(0);
        }, 500);
        break;

      case 'save-15s':
        tellSentinel('ACTION:SAVE-15S\n');
        break;

      case 'ignore':
        this.isPolluted = true;
        this.sentinelDisabled = true;
        tellSentinel('ACTION:IGNORE\n');
        console.warn(`[SecureCenter] Risk ignored by user. System running in polluted state.`);
        break;

      case 'deactivate-plugin':
        try { this.pluginTeardownFn?.(); } catch (e) { console.error('[SecureCenter] Plugin teardown:', e); }
        this.isPolluted = false;
        tellSentinel('ACTION:CONTINUE\n');
        break;

      case 'continue':
        this.isPolluted = false;
        tellSentinel('ACTION:CONTINUE\n');
        break;
    }

    // Without a ocean-sentinel nobody will answer RESOLVED, so settle the lockdown state here.
    if (!sentinelAlive && action !== 'restart-safe') {
      this.lockdownMode = false;
      broadcastToAllWindows('security-lockdown-resolved');
    }
  }
}
