import { app, BrowserWindow, ipcMain } from 'electron';
import child_process from 'child_process';
import net from 'net';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getBackendConfig } from '../handlers/systemHandler';

export class SecureCenter {
  private static instance: SecureCenter;
  private monitorInterval: NodeJS.Timeout | null = null;
  private getWin: (() => BrowserWindow | null) | null = null;
  private isPolluted: boolean = false;
  private socket: net.Socket | null = null;
  private server: net.Server | null = null;
  private watchdogProcess: child_process.ChildProcess | null = null;
  private lockdownMode: boolean = false;
  private pluginTeardownFn: (() => void) | null = null;
  private watchdogDisabled: boolean = false;
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
    if (this.socket && !this.socket.destroyed) {
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

  public start(getWin: () => BrowserWindow | null) {
    this.getWin = getWin;
    
    // Check for Safe Mode
    if (process.argv.includes('--safe-mode')) {
        console.warn('[SecureCenter] Booting in SAFE MODE due to Watchdog recovery.');
        this.isPolluted = true;
        this.watchdogDisabled = true; // Watchdog shouldn't kill safe mode
        getBackendConfig().pluginSecurityMode = 'safe';
    }

    
    // Register IPC
    ipcMain.handle('resolve-security-lockdown', async (event, action: 'restart-safe' | 'save-15s' | 'ignore') => {
      this.handleAction(action);
    });

    ipcMain.handle('get-watchdog-status', () => {
      return {
        status: this.isPolluted ? 'warning' : 'secure',
        level: this.lastLockdownLevel,
        reason: this.lastLockdownReason,
        lastPing: Date.now(),
        watchdogDisabled: this.watchdogDisabled
      };
    });

    this.initWatchdog();
  }

  private initWatchdog() {
    const pipeName = os.platform() === 'win32'
      ? `\\\\.\\pipe\\getssh-watchdog-${process.pid}`
      : path.join(os.tmpdir(), `getssh-watchdog-${process.pid}.sock`);

    // Clean up old socket file if it exists on Unix
    if (os.platform() !== 'win32' && fs.existsSync(pipeName)) {
      fs.unlinkSync(pipeName);
    }

    this.server = net.createServer((socket) => {
      console.log('[SecureCenter] Watchdog connected.');
      this.socket = socket;

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
            const win = this.getWin?.();
            if (win && !win.isDestroyed()) {
              win.webContents.send('security-lockdown', {
                reason: this.lastLockdownReason,
                countdown: 60,
                level: this.lastLockdownLevel
              });
            }
          } else if (line.startsWith('TICK:')) {
            const tick = parseInt(line.split(':')[1]);
            const win = this.getWin?.();
            if (win && !win.isDestroyed()) {
              win.webContents.send('security-lockdown', { 
                reason: this.lastLockdownReason, 
                countdown: tick,
                level: this.lastLockdownLevel
              });
            }
          } else if (line.includes('RESOLVED')) {
            this.lockdownMode = false;
            // Note: If action was ignore, we keep isPolluted true.
            // So we only reset isPolluted if watchdogDisabled is false.
            if (!this.watchdogDisabled) {
                this.isPolluted = false;
            }
            const win = this.getWin?.();
            if (win && !win.isDestroyed()) {
              win.webContents.send('security-lockdown-resolved');
            }
          }
        }
      });

      socket.on('close', () => {
        console.warn('[SecureCenter] Watchdog disconnected!');
        this.socket = null;
      });
      
      socket.on('error', (err) => {
        console.error('[SecureCenter] Watchdog socket error:', err);
      });
    });

    this.server.listen(pipeName, () => {
      let watchdogExecutable = 'watchdog';
      if (os.platform() === 'win32') watchdogExecutable += '.exe';

      const watchdogPath = app.isPackaged
        ? path.join(process.resourcesPath, watchdogExecutable)
        : path.join(__dirname, '../../../../target/release', watchdogExecutable);

      console.log(`[SecureCenter] Spawning Watchdog: ${watchdogPath} with PID ${process.pid} and pipe ${pipeName}`);

      try {
        if (!fs.existsSync(watchdogPath)) {
            console.error(`[SecureCenter] Watchdog binary not found at ${watchdogPath}! Please compile it first.`);
            this.watchdogDisabled = true;
            // Notice: we do NOT return here if we want manual RASP alerts to still show up as fallback
        } else {
          this.watchdogProcess = child_process.spawn(watchdogPath, [process.pid.toString(), pipeName, process.execPath], {
            stdio: 'inherit',
            windowsHide: true,
          });

          this.watchdogProcess.on('exit', (code) => {
              console.error(`[SecureCenter] Watchdog exited with code ${code}.`);
          });
        }

        // Start PING interval
        this.monitorInterval = setInterval(() => {
          if (this.socket && !this.socket.destroyed && !this.lockdownMode && !this.watchdogDisabled) {
            try {
              this.socket.write('PING\n');
              this.runLegacyHealthCheck();
            } catch (err) {
              // Ignore EPIPE
            }
          }
        }, 1000);

      } catch (e) {
        console.error('[SecureCenter] Failed to spawn Watchdog:', e);
      }
    });
  }

  // Still keep some lightweight JS health check to detect pollution and trigger the watchdog
  private runLegacyHealthCheck() {
    if (getBackendConfig().pluginSecurityMode === 'developer') return;
    
    // Simulating pollution check
    // If it triggers, we notify Watchdog
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
      // Fallback: If watchdog is dead/missing, send alert manually immediately
      this.lastLockdownReason = `【Fallback防御】${reason}`;
      this.lastLockdownLevel = level;
      const win = this.getWin?.();
      if (win && !win.isDestroyed()) {
        win.webContents.send('security-lockdown', {
          reason: this.lastLockdownReason,
          countdown: 60,
          level: this.lastLockdownLevel
        });
      }
    }
  }

  private handleAction(action: 'restart-safe' | 'save-15s' | 'ignore' | 'deactivate-plugin' | 'continue') {
    if (!this.socket) return;

    switch (action) {
      case 'restart-safe':
        getBackendConfig().pluginSecurityMode = 'safe';
        // Gracefully deactivate all plugins before RASP kills the process
        try { this.pluginTeardownFn?.(); } catch (e) { console.error('[SecureCenter] Plugin teardown on restart-safe:', e); }
        // Tell watchdog we resolved it so it doesn't kill us while restarting
        this.socket.write('ACTION:RESTART-SAFE\n');
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
        this.socket.write('ACTION:SAVE-15S\n');
        break;

      case 'ignore':
        this.isPolluted = true;
        this.watchdogDisabled = true;
        this.socket.write('ACTION:IGNORE\n');
        console.warn(`[SecureCenter] Risk ignored by user. System running in polluted state.`);
        break;

      case 'deactivate-plugin':
        try { this.pluginTeardownFn?.(); } catch (e) { console.error('[SecureCenter] Plugin teardown:', e); }
        this.isPolluted = false;
        this.socket.write('ACTION:CONTINUE\n');
        break;

      case 'continue':
        this.isPolluted = false;
        this.socket.write('ACTION:CONTINUE\n');
        break;
    }
  }
}
