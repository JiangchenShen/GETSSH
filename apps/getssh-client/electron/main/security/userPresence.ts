import { systemPreferences } from 'electron';
import crypto from 'node:crypto';

/**
 * Identity checks performed by the main process. A renderer can ask for them but never decides the
 * outcome: before this, the renderer ran a WebAuthn ceremony that verified nothing and then asked
 * the main process for the master password, which the main process handed out unconditionally.
 */
export type PresenceOutcome = 'verified' | 'unsupported' | 'cancelled';

/** Runs tasks one at a time, in order. */
function createQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

// One OS prompt at a time; a second request waits for the first instead of stacking dialogs.
// Password checks have their own queue so failed guesses never hold up a Touch ID prompt.
const promptQueue = createQueue();
const passwordQueue = createQueue();

/**
 * Asks the operating system to verify the person at the keyboard.
 * `reason` completes the sentence "GETSSH is trying to …" in the macOS Touch ID sheet.
 *
 * Windows Hello needs a native WinRT call (UserConsentVerifier) that GETSSH does not ship yet, so
 * Windows reports 'unsupported' and callers fall back to the master password.
 */
export function verifyUserPresence(reason: string): Promise<PresenceOutcome> {
  return promptQueue(async () => {
    if (process.platform !== 'darwin' || !systemPreferences.canPromptTouchID()) return 'unsupported';
    try {
      await systemPreferences.promptTouchID(reason);
      return 'verified';
    } catch {
      return 'cancelled';
    }
  });
}

/** Constant-time comparison that does not leak the length of either input. */
export function secretsEqual(a: string, b: string): boolean {
  const digest = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

const FAILED_PASSWORD_BASE_DELAY_MS = 750;
const FAILED_PASSWORD_MAX_DELAY_MS = 30_000;
let consecutivePasswordFailures = 0;

/** Delay after a failed check: flat for the first few typos, then doubling up to 30 s. */
export function failedPasswordDelay(failures: number): number {
  return Math.min(FAILED_PASSWORD_BASE_DELAY_MS * 2 ** Math.max(0, failures - 3), FAILED_PASSWORD_MAX_DELAY_MS);
}

/**
 * Checks a typed master password. Checks run one at a time and each failure costs a growing delay,
 * so the check cannot be used to guess the password quickly. `matches` compares against whatever
 * the caller treats as the stored password; a throw counts as a mismatch.
 */
export function checkMasterPassword(candidate: string, matches: (candidate: string) => Promise<boolean>): Promise<boolean> {
  return passwordQueue(async () => {
    let ok = false;
    try {
      ok = await matches(candidate);
    } catch (error) {
      console.warn('[UserPresence] Stored master password could not be read:', error);
    }
    if (ok) {
      consecutivePasswordFailures = 0;
    } else {
      consecutivePasswordFailures++;
      await new Promise(resolve => setTimeout(resolve, failedPasswordDelay(consecutivePasswordFailures)));
    }
    return ok;
  });
}

/** For tests. */
export function resetPasswordFailuresForTest(): void {
  consecutivePasswordFailures = 0;
}

export type OwnerCheck = 'verified' | 'password_required' | 'denied';

export interface OwnerCheckDeps {
  /** Some identity secret (a workspace master password) is configured. */
  hasStoredPassword: () => boolean;
  /** Whether a typed password matches a stored one. */
  passwordMatches: (candidate: string) => Promise<boolean>;
  presence: (reason: string) => Promise<PresenceOutcome>;
}

/**
 * Verifies the owner before a sensitive action.
 *
 * Where the OS can verify the user (Touch ID) that is the only accepted proof: the renderer keeps
 * the master password in memory after an unlock, so a password passed over IPC proves nothing
 * about who is at the keyboard. Only where no OS prompt exists (Windows for now, Macs without
 * Touch ID) is a typed master password accepted instead.
 */
export async function verifyOwner(
  request: { password?: string; reason: string },
  deps: OwnerCheckDeps,
): Promise<OwnerCheck> {
  if (!deps.hasStoredPassword()) return 'verified';
  const outcome = await deps.presence(request.reason);
  if (outcome === 'verified') return 'verified';
  if (outcome === 'cancelled') return 'denied';
  if (typeof request.password === 'string' && request.password.length > 0) {
    return (await checkMasterPassword(request.password, deps.passwordMatches)) ? 'verified' : 'denied';
  }
  return 'password_required';
}
