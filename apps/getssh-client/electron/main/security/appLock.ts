import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, powerMonitor } from 'electron';
import type { AppState, LegacySecrets, StartReport, UnlockRoute } from '../../../../../rust-core/getssh-store/store';
import { configureStore, getStore, storeBaseDir, storeMode, toStoreError } from '../services/getsshStore';
import { runAutomaticV2Import } from '../services/legacyV2Profiles';
import { isValidWorkspaceId } from '../utils/workspaceId';
import { decryptSecret } from './secretStore';

/**
 * Whether GETSSH's data is open, and the transitions between locked and ready.
 *
 * Without a master password the app opens by itself (the quiet device key) and locking only
 * affects workspaces that have their own password. With a master password nothing is readable
 * until it, Touch ID / Windows Hello or the recovery code unlocks the app; idle time, a locked
 * screen and sleep lock it again and close the databases. getssh-store does the work, including
 * moving data written by GETSSH 3.0 development builds; this class hands it the secrets only
 * Electron can decrypt, imports the servers saved by GETSSH 2.0 once, and tells the windows
 * about the state.
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
  /** Set on the start that moved data written by GETSSH 3.0 development builds. */
  migration?: StartReport;
}

export type UnlockRequest =
  | { method: 'password'; password: string }
  | { method: 'presence' }
  | { method: 'recovery'; code: string };

export type UnlockResult = { ok: true } | { ok: false; error: string; retryAfterMs?: number };

const IDLE_LOCK_SECONDS = 5 * 60;
const IDLE_POLL_MS = 15_000;
export const PRESENCE_REASON = 'unlock GETSSH';

type LockReason = Parameters<typeof import('../../../../../rust-core/getssh-store/store').lockApp>[0];

/**
 * What only Electron can decrypt in the layout of GETSSH 3.0 development builds: the app key
 * (app_key.enc) and the workspace passwords (workspaces/<id>/vault.key), both safeStorage blobs.
 * decryptSecret leaves the files as they are (getssh-store backs them up before it changes
 * anything). An app key that does not decrypt is left out: getssh-store refuses to migrate
 * without it (the start fails, as before), but does not need it when a master password is set
 * and it only sets leftovers aside. A vault.key that does not decrypt leaves its workspace
 * waiting for the password.
 */
function readLegacySecrets(baseDir: string): { secrets: LegacySecrets; appKeyError?: string } {
  const secrets: LegacySecrets = { workspacePasswords: {} };
  let appKeyError: string | undefined;
  const appKeyFile = path.join(baseDir, 'app_key.enc');
  if (fs.existsSync(appKeyFile)) {
    try {
      secrets.appKey = decryptSecret(fs.readFileSync(appKeyFile), value => /^[0-9a-f]{64}$/i.test(value)).value;
    } catch (error) {
      appKeyError = error instanceof Error ? error.message : String(error);
      console.warn('[AppLock] app_key.enc could not be read:', error);
    }
  }
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(path.join(baseDir, 'workspaces'));
  } catch {
    ids = [];
  }
  for (const id of ids) {
    const vaultKey = path.join(baseDir, 'workspaces', id, 'vault.key');
    if (!isValidWorkspaceId(id) || !fs.existsSync(vaultKey)) continue;
    try {
      const password = decryptSecret(fs.readFileSync(vaultKey)).value;
      if (password) secrets.workspacePasswords![id] = password;
    } catch (error) {
      console.warn(`[AppLock] vault.key of ${id} could not be read; that workspace waits for its password:`, error);
    }
  }
  return { secrets, appKeyError };
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
  private migration: StartReport | undefined;
  /** The one automatic GETSSH 2.0 import; every becomeReady waits for it. */
  private v2Import: Promise<void> | null = null;
  /** The unlock in progress; a second request waits for it (unlock). */
  private unlocking: Promise<UnlockResult> | null = null;
  /** A lock asked for while the start or an unlock was still finishing (lock). */
  private lockRequested: string | null = null;
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
    if (phase !== 'ready') this.lockRequested = null;
    this.broadcast();
    if (phase === 'ready' || phase === 'error') {
      for (const resolve of this.settledWaiters.splice(0)) resolve();
    }
  }

  async start(): Promise<void> {
    let appKeyError: string | undefined;
    try {
      const baseDir = storeBaseDir();
      if (storeMode() === 'native') fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
      const store = configureStore();
      const legacy = store.needsLegacyMigration() ? readLegacySecrets(baseDir) : undefined;
      appKeyError = legacy?.appKeyError;
      const report = await store.start(legacy?.secrets);
      if (legacy) {
        this.migration = report;
        console.log('[AppLock] Moved data of GETSSH 3.0 development builds:', report);
      }
      if (report.failedWorkspaces.length) {
        console.error('[AppLock] Workspaces whose database could not be opened (left as they are):', report.failedWorkspaces);
      }
      this.installTriggers();
      if (store.appState().phase !== 'ready') {
        this.setPhase('locked');
        return;
      }
      await this.becomeReady();
    } catch (error) {
      if (this.storeState()?.deviceKeyLost) {
        this.installTriggers();
        this.setPhase('locked');
        return;
      }
      const failure = toStoreError(error);
      console.error('[AppLock] GETSSH could not open its data:', error);
      // The migration needed the app key of a development build, and safeStorage could not read
      // it: say so, rather than a bare invalid_argument.
      const detail = failure.code === 'invalid_argument' && appKeyError
        ? `app_key_unreadable: ${appKeyError}`
        : failure.code === 'internal' ? failure.detail : failure.code;
      this.setPhase('error', detail);
    }
  }

  /**
   * The servers saved by GETSSH 2.0 (profiles.enc / profiles.json in Electron's userData) are
   * imported into the MAIN workspace once, before any window loads the profile list: a window
   * that held the list from before would replace it on its next save. Every caller waits for the
   * same import, so 'ready' is never announced while it is still saving. Never throws.
   */
  private importV2Profiles(): Promise<void> {
    if (storeMode() !== 'native') return Promise.resolve();
    this.v2Import ??= (async () => {
      try {
        const result = await runAutomaticV2Import(app.getPath('userData'));
        if (result.status !== 'nothing' && result.status !== 'already') console.log('[AppLock] GETSSH 2.0 servers:', result);
      } catch (error) {
        console.warn('[AppLock] Importing the servers of GETSSH 2.0 failed:', error);
      }
    })();
    return this.v2Import;
  }

  private async becomeReady(): Promise<void> {
    await this.importV2Profiles();
    const requested = this.lockRequested;
    this.lockRequested = null;
    if (requested && this.storeState()?.masterPassword) {
      // The screen locked (or the Mac slept) while the unlock was finishing: stay locked rather
      // than announce 'ready' behind a locked screen.
      console.log(`[AppLock] Locking (${requested}) right after unlocking.`);
      this.runLockListeners();
      getStore().lockApp(lockReason(requested));
      this.setPhase('locked');
      return;
    }
    this.setPhase('ready');
    if (this.readyOnce && !this.readyRan) {
      this.readyRan = true;
      this.readyOnce().catch(error => console.error('[AppLock] Startup tasks failed:', error));
    }
    // Without a master password the app stays open; the workspaces with a password lock.
    if (requested) this.lock(requested);
  }

  /**
   * One unlock at a time: a request that arrives while another runs (a reloaded window, a second
   * Touch ID request) waits for it, then finds the app ready or tries its own credentials. It
   * never runs the store's unlock (Argon2, a prompt) next to the first one.
   */
  async unlock(request: UnlockRequest): Promise<UnlockResult> {
    const previous = this.unlocking;
    const run = (async () => {
      if (previous) await previous;
      return this.unlockOnce(request);
    })();
    this.unlocking = run;
    try {
      return await run;
    } finally {
      if (this.unlocking === run) this.unlocking = null;
    }
  }

  private async unlockOnce(request: UnlockRequest): Promise<UnlockResult> {
    if (this.phase === 'ready') return { ok: true };
    if (this.phase !== 'locked') return { ok: false, error: this.phase };
    const route: UnlockRoute = request.method === 'password'
      ? { password: request.password }
      : request.method === 'presence'
        ? { presence: PRESENCE_REASON }
        : { recoveryCode: request.code };
    try {
      const state = await getStore().unlockApp(route);
      if (state.phase !== 'ready') {
        this.dropLockRequest();
        return { ok: false, error: 'locked' };
      }
      await this.becomeReady();
      // becomeReady stays locked when a lock came in meanwhile.
      return this.isReady() ? { ok: true } : { ok: false, error: 'locked' };
    } catch (error) {
      this.dropLockRequest();
      return unlockError(request, error);
    }
  }

  /**
   * Locks everything that is protected. Workspaces without a password of their own stay open
   * while no master password is set: whoever is at the computer can open them anyway.
   */
  lock(reason: string): void {
    if (this.phase !== 'ready') {
      // The start, or an unlock whose store has opened already, is still finishing: lock as soon
      // as it has, instead of dropping the request (becomeReady). While an unlock still waits
      // (a password check, a Touch ID prompt) the app is locked anyway: nothing to do.
      if (this.phase === 'starting' || (this.unlocking && this.storeState()?.phase === 'ready')) this.lockRequested = reason;
      return;
    }
    this.runLockListeners();
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

  /**
   * An unlock that failed after its store had opened (a lock came in then) leaves nothing open
   * behind the lock screen, and its request does not carry over to the next unlock.
   */
  private dropLockRequest(): void {
    const requested = this.lockRequested;
    this.lockRequested = null;
    if (requested) getStore().lockApp(lockReason(requested));
  }

  private runLockListeners(): void {
    for (const listener of this.lockListeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[AppLock] A lock listener failed:', error);
      }
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
