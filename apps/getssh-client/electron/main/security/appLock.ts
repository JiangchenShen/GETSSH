import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, powerMonitor } from 'electron';
import type { AppState, UnlockRoute } from '../../../../../rust-core/getssh-store/store';
import { configureStore, getStore, storeBaseDir, storeMode, toStoreError } from '../services/getsshStore';
import type { MigrationReport } from './keystoreMigration';

/**
 * Whether GETSSH's data is open, and the transitions between locked and ready.
 *
 * Without a master password the app opens by itself (the quiet device key) and locking only
 * affects workspaces that have their own password. With a master password nothing is readable
 * until it, Touch ID / Windows Hello or the recovery code unlocks the app; idle time, a locked
 * screen and sleep lock it again and close the databases. getssh-store does the work; this class
 * runs the GETSSH 2.x migration first and tells the windows about the state.
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
  /**
   * Unlocked with a master password shorter than 12 characters (set before 3.0): the renderer
   * shows a blocking "change your master password" dialog; exports are refused until it changes.
   */
  masterPasswordMustChange: boolean;
  error?: string;
  /** Set on the start that moved GETSSH 2.x data. */
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

type LockReason = Parameters<typeof import('../../../../../rust-core/getssh-store/store').lockApp>[0];

/**
 * Whether GETSSH 2.x data still has to move to the keystore: there is no keyring yet but older
 * files are there, or an earlier attempt was interrupted.
 */
function needsLegacyMigration(baseDir: string): boolean {
  if (fs.existsSync(path.join(baseDir, 'keyring.json'))) {
    return fs.existsSync(path.join(baseDir, MIGRATION_BACKUP)) ||
      ['app_key.enc', 'app_key.txt'].some(name => fs.existsSync(path.join(baseDir, name)));
  }
  const { hasLegacyData } = require('./keystoreMigration') as typeof import('./keystoreMigration');
  return hasLegacyData(baseDir);
}

/**
 * Runs the 2.x migration with getssh-keystore and better-sqlite3-multiple-ciphers (loaded only
 * here). Every database it opens is closed again before it returns; getssh-store starts after.
 */
async function runLegacyMigration(baseDir: string): Promise<MigrationReport> {
  const { keystore } = require('./keystore') as typeof import('./keystore');
  const { migrateLegacyData } = require('./keystoreMigration') as typeof import('./keystoreMigration');
  const { prepareLegacyMainDatabase } = require('./legacyDatabase') as typeof import('./legacyDatabase');
  keystore.configure(path.join(baseDir, 'keyring.json'));
  return migrateLegacyData(baseDir, key => prepareLegacyMainDatabase(baseDir, key));
}

/** The keystore's old error names, which the lock screen shows. */
function unlockError(request: UnlockRequest, error: unknown): { ok: false; error: string; retryAfterMs?: number } {
  const failure = toStoreError(error);
  let code: string = failure.code;
  if (request.method === 'recovery' && code === 'wrong_password') code = 'invalid_recovery_code';
  else if (code === 'unavailable' && /device key/.test(failure.detail)) code = 'device_key_lost';
  else if (request.method === 'presence' && code === 'needs_password') code = 'unavailable';
  if (code === 'internal') console.error('[AppLock] Unlock failed:', error);
  return { ok: false, error: code, retryAfterMs: failure.retryAfterMs };
}

class AppLock {
  private phase: LockPhase = 'starting';
  private error: string | undefined;
  private migration: MigrationReport | undefined;
  private readyOnce: (() => Promise<void>) | null = null;
  private readyRan = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private triggersInstalled = false;
  private lockListeners: Array<() => void> = [];
  private settledWaiters: Array<() => void> = [];

  private storeState(): AppState | null {
    try {
      return getStore().appState();
    } catch {
      return null;
    }
  }

  state(): AppLockState {
    const store = this.storeState();
    return {
      phase: this.phase,
      appProtected: !!store?.masterPassword,
      presenceSupported: !!store?.presenceSupported,
      presenceEnabled: !!store?.presenceEnabled,
      recoveryConfigured: !!store?.recoveryConfigured,
      deviceKeyLost: !!store?.deviceKeyLost,
      masterPasswordMustChange: !!store?.masterPasswordMustChange,
      error: this.error,
      migration: this.migration,
    };
  }

  isReady(): boolean {
    return this.phase === 'ready';
  }

  /** Runs on every lock request while the app is open (idle, screen lock, sleep, the lock button), even when nothing is protected. */
  onLock(listener: () => void): void {
    this.lockListeners.push(listener);
  }

  /**
   * Resolves once the data is open, or once starting failed ('error'). Stays pending while the
   * app waits for its master password.
   */
  whenOpen(): Promise<void> {
    if (this.phase === 'ready' || this.phase === 'error') return Promise.resolve();
    return new Promise(resolve => this.settledWaiters.push(resolve));
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
    if (phase === 'ready' || phase === 'error') {
      for (const resolve of this.settledWaiters.splice(0)) resolve();
    }
  }

  async start(): Promise<void> {
    try {
      const baseDir = storeBaseDir();
      if (storeMode() === 'native') {
        fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
        if (needsLegacyMigration(baseDir)) {
          this.migration = await runLegacyMigration(baseDir);
          if (this.migration.deferredWorkspaces.length) {
            console.warn('[AppLock] Workspaces waiting for their password to finish moving to the keystore:', this.migration.deferredWorkspaces);
          }
        }
      }
      const store = configureStore();
      const report = await store.start();
      if (report.failedWorkspaces.length) {
        console.error('[AppLock] Workspaces whose database could not be opened (left as they are):', report.failedWorkspaces);
      }
      this.installTriggers();
      if (store.appState().phase !== 'ready') {
        this.setPhase('locked');
        return;
      }
      this.becomeReady();
    } catch (error) {
      if (this.storeState()?.deviceKeyLost) {
        this.installTriggers();
        this.setPhase('locked');
        return;
      }
      const failure = toStoreError(error);
      console.error('[AppLock] GETSSH could not open its data:', error);
      this.setPhase('error', failure.code === 'internal' ? failure.detail : failure.code);
    }
  }

  private becomeReady(): void {
    this.setPhase('ready');
    if (this.readyOnce && !this.readyRan) {
      this.readyRan = true;
      this.readyOnce().catch(error => console.error('[AppLock] Startup tasks failed:', error));
    }
  }

  async unlock(request: UnlockRequest): Promise<UnlockResult> {
    if (this.phase === 'ready') return { ok: true };
    if (this.phase !== 'locked') return { ok: false, error: this.phase };
    const route: UnlockRoute = request.method === 'password'
      ? { password: request.password }
      : request.method === 'presence'
        ? { presence: PRESENCE_REASON }
        : { recoveryCode: request.code };
    try {
      const state = await getStore().unlockApp(route);
      if (state.phase !== 'ready') return { ok: false, error: 'locked' };
      this.becomeReady();
      return { ok: true };
    } catch (error) {
      return unlockError(request, error);
    }
  }

  /**
   * Locks everything that is protected. Workspaces without a password of their own stay open
   * while no master password is set: whoever is at the computer can open them anyway.
   */
  lock(reason: string): void {
    if (this.phase !== 'ready') return;
    for (const listener of this.lockListeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[AppLock] A lock listener failed:', error);
      }
    }
    const store = getStore();
    const appProtected = !!this.storeState()?.masterPassword;
    const protectedOpen = appProtected || store.listWorkspaces().some(workspace => workspace.hasPassword && workspace.state === 'open');
    // Also closes every reveal window, protected or not.
    store.lockApp(lockReason(reason));
    if (!protectedOpen) return;
    console.log(`[AppLock] Locking (${reason}).`);
    if (appProtected) {
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

function lockReason(reason: string): LockReason {
  switch (reason) {
    case 'idle': return 'idle';
    case 'sleep': return 'sleep';
    case 'screen locked': return 'screen-locked';
    default: return 'manual';
  }
}

export const appLock = new AppLock();
