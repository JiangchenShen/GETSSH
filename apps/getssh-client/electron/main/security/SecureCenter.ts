import { app, ipcMain } from 'electron';
import child_process from 'child_process';
import net from 'net';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getBackendConfig } from '../handlers/systemHandler';
import { broadcastToAllWindows, isKnownTopLevelSender } from '../windowRegistry';
import { OceanSentinel } from '../services/OceanSentinel';

export class SecureCenter {
  private static instance: SecureCenter;
  private monitorInterval: NodeJS.Timeout | null = null;
  private isPolluted: boolean = false;
  private socket: net.Socket | null = null;
  private server: net.Server | null = null;
  private sentinelProcess: child_process.ChildProcess | null = null;
  private lockdownMode: boolean = false;
  private pluginTeardownFn: (() => void) | null = null;
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

  public setPluginTeardown(fn: () => void) {
    this.pluginTeardownFn = fn;
  }

  public gracefulShutdown() {
    OceanSentinel.flushMetrics();
    if (this.socket && !this.socket.destroyed && this.socket.writable) {
      try { this.socket.write('ACTION:QUIT\n'); } catch (e) {}
    }
    try { this.pluginTeardownFn?.(); } catch (e) { console.error('[SecureCenter] Plugin teardown error:', e); }
  }

  public auditPluginCommand(command: string): boolean {
    const dangerousPatterns = [
      /\brm\s+-r.*f\s+\/(?!\S)/,   // rm -rf /
      /\brm\s+-r.*f\s+\/\*(?!\S)/, // rm -rf /*
      /\bmkfs(\.[a-z0-9]+)?\b/, // mkfs
      /:\(\)\{:\|:&\};:/,      // fork bomb
      /\bdd\s+if=.*of=\/dev\/(sda|hda|nvme)\b/ // dd overwriting disks
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        this.triggerLockdown(`Plugin attempted to execute high-risk command: ${command.substring(0, 50)}`, 'yellow');
        return false;
      }
    }
    return true;
  }

  public start() {
    // Check for Safe Mode
    if (process.argv.includes('--safe-mode')) {
        console.warn('[SecureCenter] Booting in SAFE MODE due to Ocean Sentinel recovery.');
        this.isPolluted = true;
        this.sentinelDisabled = true; // Ocean Sentinel shouldn't kill safe mode
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

    this.initSentinelWatchdog();
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
          this.sentinelProcess = child_process.spawn(sentinelPath, [process.pid.toString(), pipeName, process.execPath, app.getLocale()], {
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

        // Start PING interval
        this.monitorInterval = setInterval(() => {
          if (this.socket && !this.socket.destroyed && !this.lockdownMode && !this.sentinelDisabled) {
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
              this.runLegacyHealthCheck();
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
