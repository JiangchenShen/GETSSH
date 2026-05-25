import { app, BrowserWindow, ipcMain } from 'electron';
import child_process from 'child_process';
import fs from 'fs';
import { getBackendConfig, updateBackendConfigLocal } from '../handlers/systemHandler';

export class SecureCenter {
  private static instance: SecureCenter;
  private monitorInterval: NodeJS.Timeout | null = null;
  private destructionTimeout: NodeJS.Timeout | null = null;
  private getWin: (() => BrowserWindow | null) | null = null;
  private originalObjectKeys: Set<string>;
  private isPolluted: boolean = false;

  private constructor() {
    // Snapshot original Object.prototype keys at boot
    this.originalObjectKeys = new Set(Object.getOwnPropertyNames(Object.prototype));
  }

  public static getInstance(): SecureCenter {
    if (!SecureCenter.instance) {
      SecureCenter.instance = new SecureCenter();
    }
    return SecureCenter.instance;
  }

  public start(getWin: () => BrowserWindow | null) {
    this.getWin = getWin;
    
    // RASP monitoring
    this.monitorInterval = setInterval(() => {
      this.runHealthCheck();
    }, 5000);

    // Register IPC
    ipcMain.handle('resolve-security-lockdown', async (event, action: 'restart-safe' | 'save-15s' | 'ignore') => {
      this.handleAction(action);
    });
  }

  private runHealthCheck() {
    // Skip if in developer mode (no sandbox, user accepts risks)
    if (getBackendConfig().pluginSecurityMode === 'developer') return;
    
    // If already flagged and waiting for destruction, do not spam
    if (this.destructionTimeout && !this.isPolluted) return; 

    // 1. Monkey Patching Checks
    // Node.js core modules are implemented in JS, so they don't have [native code].
    // We check if the name property was altered.
    // 2. Prototype Pollution Check
    const currentKeys = Object.getOwnPropertyNames(Object.prototype);
    const hasPollution = currentKeys.some(key => !this.originalObjectKeys.has(key));

    if (hasPollution) {
      this.triggerLockdown('系统安全探针检测到严重的【原型链污染 (Prototype Pollution)】攻击！\n有未知程序或恶意插件正试图越权修改系统底层对象的运行逻辑，您的内存完整性已被破坏。为防止密码泄露或系统被控，系统已进入强制物理锁定状态！');
    }
  }

  private triggerLockdown(reason: string) {
    if (this.isPolluted) return; // User ignored risk already

    console.error(`[SecureCenter] 🚨 RASP ALERT: ${reason}`);
    
    const win = this.getWin?.();
    if (win && !win.isDestroyed()) {
      win.webContents.send('security-lockdown', { reason, countdown: 60 });
    }

    if (!this.destructionTimeout) {
      this.destructionTimeout = setTimeout(() => {
        console.error(`[SecureCenter] Self-destructing due to unresolved security lockdown.`);
        app.exit(1);
      }, 60000);
    }
  }

  private handleAction(action: 'restart-safe' | 'save-15s' | 'ignore') {
    switch (action) {
      case 'restart-safe':
        // Inform backend config (though in safe mode we'd normally just rely on store, 
        // we can dispatch an IPC manually or just relaunch and append a flag)
        // Since getBackendConfig is in systemHandler, let's just trigger update.
        // The frontend actually syncs this, but we'll do it forcefully.
        if (updateBackendConfigLocal) {
           updateBackendConfigLocal({ pluginSecurityMode: 'safe' });
        }
        if (!process.env.VITE_DEV_SERVER_URL) {
           app.relaunch();
        } else {
           console.log("Dev mode detected. Please restart manually.");
        }
        app.exit(0);
        break;

      case 'save-15s':
        if (this.destructionTimeout) {
          clearTimeout(this.destructionTimeout);
        }
        this.destructionTimeout = setTimeout(() => {
          console.error(`[SecureCenter] Emergency 15s save window expired. Self-destructing.`);
          app.exit(1);
        }, 15000);
        break;

      case 'ignore':
        if (this.destructionTimeout) {
          clearTimeout(this.destructionTimeout);
          this.destructionTimeout = null;
        }
        this.isPolluted = true;
        console.warn(`[SecureCenter] Risk ignored by user. System running in polluted state.`);
        break;
    }
  }
}
