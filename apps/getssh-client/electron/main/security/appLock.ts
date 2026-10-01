import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, powerMonitor } from 'electron';
import { DatabaseManager } from '../services/DatabaseManager';
import { APP_SCOPE, isKeystoreError, keystore, toKeystoreError, workspaceScope } from './keystore';
import { hasLegacyData, migrateLegacyData, type MigrationReport } from './keystoreMigration';

/**
 * Whether GETSSH's data is open, and the transitions between locked and ready.
 *
 * Without a master password the app opens by itself (the quiet device key) and locking only
 * affects workspaces that have their own password. With a master password nothing is readable
 * until it, Touch ID / Windows Hello or the recovery code unlocks the app; idle time, a locked
 * screen and sleep lock it again and close the databases.
 */

export type LockPhase = 'starting' | 'locked' | 'ready' | 'error';

export interface AppLockState {
  phase: LockPhase;
  appProtected: boolean;
  /** The OS can verify the user (Touch ID / login password, Windows Hello). */
  presenceSupported: boolean;
  /** Touch ID / Windows Hello can unlock the app. */
  presenceEnabled: boolean;
  recoveryConfigured: boolean;
  /** The device key of this installation is gone (another computer): only the recovery code or the master password opens the data. */
  deviceKeyLost: boolean;
  error?: string;
  migration?: MigrationReport;
}

export type UnlockRequest =
  | { method: 'password'; password: string }
  | { method: 'presence' }
  | { method: 'recovery'; code: string };

export type UnlockResult = { ok: true } | { ok: false; error: string; retryAfterMs?: number };

const IDLE_LOCK_SECONDS = 5 * 60;
const IDLE_POLL_MS = 15_000;
const MIGRATION_BACKUP = '.keystore-migration-backup';
export const PRESENCE_REASON = 'unlock GETSSH';

class AppLock {
  private phase: LockPhase = 'starting';
  private error: string | undefined;
  private deviceKeyLost = false;
  private migration: MigrationReport | undefined;
  private readyOnce: (() => Promise<void>) | null = null;
  private readyRan = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private triggersInstalled = false;

  state(): AppLockState {
    let status: ReturnType<typeof keystore.status> | null = null;
    try {
      status = keystore.status();
    } catch {
      status = null;
    }
    const app = status?.scopes.find(scope => scope.id === APP_SCOPE);
    return {
      phase: this.phase,
      appProtected: !!status?.appProtected,
      presenceSupported: !!status?.presenceSupported,
      presenceEnabled: !!app?.presence,
      recoveryConfigured: !!status?.recoveryConfigured,
      deviceKeyLost: this.deviceKeyLost || !!status?.deviceKeyLost,
      error: this.error,
      migration: this.migration,
    };
  }

  isReady(): boolean {
    return this.phase === 'ready';
  }

  /** Runs once, the first time the data opens (workspace bootstrap, plugins). */
  onFirstReady(task: () => Promise<void>): void {
    this.readyOnce = task;
  }

  private broadcast(): void {
    const state = this.state();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send('app-lock:changed', state);
      }
    }
  }

  private setPhase(phase: LockPhase, error?: string): void {
    this.phase = phase;
    this.error = error;
    this.broadcast();
  }

  async start(): Promise<void> {
    try {
      const baseDir = DatabaseManager.getBaseDir();
      fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
      keystore.configure();
      const interrupted = fs.existsSync(path.join(baseDir, MIGRATION_BACKUP)) ||
        ['app_key.enc', 'app_key.txt'].some(name => fs.existsSync(path.join(baseDir, name)));
      if (!keystore.status().initialized ? hasLegacyData(baseDir) : interrupted) {
        this.migration = await migrateLegacyData(baseDir, key => DatabaseManager.prepareLegacyMainDatabase(key));
        if (this.migration.deferredWorkspaces.length) {
          console.warn('[AppLock] Workspaces waiting for their password to finish moving to the keystore:', this.migration.deferredWorkspaces);
        }
      } else if (!keystore.status().initialized) {
        await keystore.initialize();
      }
      this.installTriggers();
      if (keystore.status().appProtected) {
        this.setPhase('locked');
        return;
      }
      try {
        await keystore.openScope(APP_SCOPE);
      } catch (error) {
        // Removing the master password was interrupted before main.db moved to the new key:
        // the old master password opens it once more and the removal finishes.
        if (isKeystoreError(error, 'locked')) {
          this.setPhase('locked');
          return;
        }
        throw error;
      }
      await this.openData();
    } catch (error) {
      const failure = toKeystoreError(error);
      if (failure.code === 'device_key_lost') {
        this.deviceKeyLost = true;
        this.setPhase('locked');
        return;
      }
      console.error('[AppLock] GETSSH could not open its data:', error);
      this.setPhase('error', failure.code === 'internal' ? failure.detail : failure.code);
    }
  }

  /** Opens main.db and every workspace that needs no password, then marks the app ready. */
  private async openData(): Promise<void> {
    DatabaseManager.init();
    await DatabaseManager.completeRotation(APP_SCOPE);
    for (const scope of keystore.status().scopes) {
      if (scope.id === APP_SCOPE || scope.protected) continue;
      try {
        await keystore.openScope(scope.id);
      } catch (error) {
        console.warn(`[AppLock] ${scope.id} could not be opened:`, error);
      }
    }
    await DatabaseManager.completePendingRotations();
    this.deviceKeyLost = false;
    this.setPhase('ready');
    if (this.readyOnce && !this.readyRan) {
      this.readyRan = true;
      this.readyOnce().catch(error => console.error('[AppLock] Startup tasks failed:', error));
    }
  }

  async unlock(request: UnlockRequest): Promise<UnlockResult> {
    if (this.phase === 'ready') return { ok: true };
    if (this.phase !== 'locked') return { ok: false, error: this.phase };
    try {
      switch (request.method) {
        case 'password':
          await keystore.unlockWithPassword(APP_SCOPE, request.password);
          break;
        case 'presence':
          await keystore.unlockWithPresence(APP_SCOPE, PRESENCE_REASON);
          break;
        case 'recovery':
          await keystore.unlockWithRecovery(request.code);
          break;
      }
      if (!this.appUnlocked()) await keystore.openScope(APP_SCOPE);
      await this.openData();
      return { ok: true };
    } catch (error) {
      const failure = toKeystoreError(error);
      return { ok: false, error: failure.code, retryAfterMs: failure.retryAfterMs };
    }
  }

  private appUnlocked(): boolean {
    return !!keystore.status().scopes.find(scope => scope.id === APP_SCOPE)?.unlocked;
  }

  /**
   * Locks everything that is protected. Workspaces without a password of their own stay open
   * while no master password is set: whoever is at the computer can open them anyway.
   */
  lock(reason: string): void {
    if (this.phase !== 'ready') return;
    const status = keystore.status();
    if (!status.scopes.some(scope => scope.protected && scope.unlocked)) {
      keystore.closeReveal();
      return;
    }
    console.log(`[AppLock] Locking (${reason}).`);
    keystore.lockProtected();
    DatabaseManager.closeLockedDatabases();
    if (status.appProtected) {
      this.setPhase('locked');
    } else {
      this.broadcast();
    }
  }

  /** Called after a workspace lock state changed, so windows can refresh. */
  notifyChanged(): void {
    this.broadcast();
  }

  private installTriggers(): void {
    if (this.triggersInstalled) return;
    this.triggersInstalled = true;
    powerMonitor.on('lock-screen', () => this.lock('screen locked'));
    powerMonitor.on('suspend', () => this.lock('sleep'));
    this.idleTimer = setInterval(() => {
      try {
        if (powerMonitor.getSystemIdleTime() >= IDLE_LOCK_SECONDS) this.lock('idle');
      } catch (error) {
        console.warn('[AppLock] Idle check failed:', error);
      }
    }, IDLE_POLL_MS);
    this.idleTimer.unref?.();
  }
}

export const appLock = new AppLock();

/** Scope id for a workspace, or null for an invalid id. */
export function scopeForWorkspace(workspaceId: unknown): string | null {
  try {
    return typeof workspaceId === 'string' ? workspaceScope(workspaceId) : null;
  } catch {
    return null;
  }
}

export function isLockedError(error: unknown): boolean {
  return isKeystoreError(error, 'locked');
}
