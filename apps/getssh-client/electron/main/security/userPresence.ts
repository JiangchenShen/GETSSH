import { systemPreferences } from 'electron';
import crypto from 'node:crypto';

/**
 * Identity checks performed by the main process. A renderer can ask for them but never decides the
 * outcome: before this, the renderer ran a WebAuthn ceremony that verified nothing and then asked
 * the main process for the master password, which the main process handed out unconditionally.
 */
export type PresenceOutcome = 'verified' | 'unsupported' | 'cancelled';

// One OS prompt at a time; a second request waits for the first instead of stacking dialogs.
let promptQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = promptQueue.then(task, task);
  promptQueue = run.catch(() => undefined);
  return run;
}

/**
 * Asks the operating system to verify the person at the keyboard.
 * `reason` completes the sentence "GETSSH is trying to …" in the macOS Touch ID sheet.
 *
 * Windows Hello needs a native WinRT call (UserConsentVerifier) that GETSSH does not ship yet, so
 * Windows reports 'unsupported' and callers fall back to the master password.
 */
export function verifyUserPresence(reason: string): Promise<PresenceOutcome> {
  return serialized(async () => {
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

const FAILED_PASSWORD_DELAY_MS = 750;

/**
 * Checks a typed master password against the stored one. Checks run one at a time and a failure
 * costs FAILED_PASSWORD_DELAY_MS, so the check cannot be used to guess the password quickly.
 */
export function checkMasterPassword(candidate: string, readStored: () => Promise<string>): Promise<boolean> {
  return serialized(async () => {
    let matches = false;
    try {
      matches = secretsEqual(candidate, await readStored());
    } catch (error) {
      console.warn('[UserPresence] Stored master password could not be read:', error);
    }
    if (!matches) await new Promise(resolve => setTimeout(resolve, FAILED_PASSWORD_DELAY_MS));
    return matches;
  });
}

export type OwnerCheck = 'verified' | 'password_required' | 'denied';

export interface OwnerCheckDeps {
  /** The active workspace has a stored master password (vault.key). */
  hasStoredPassword: () => boolean;
  readStoredPassword: () => Promise<string>;
  presence: (reason: string) => Promise<PresenceOutcome>;
}

/**
 * Verifies the owner before a sensitive action. With a stored master password, a typed password or
 * a successful OS prompt is required; a workspace without one has no identity secret to check.
 */
export async function verifyOwner(
  request: { password?: string; reason: string },
  deps: OwnerCheckDeps,
): Promise<OwnerCheck> {
  if (!deps.hasStoredPassword()) return 'verified';
  if (typeof request.password === 'string' && request.password.length > 0) {
    return (await checkMasterPassword(request.password, deps.readStoredPassword)) ? 'verified' : 'denied';
  }
  const outcome = await deps.presence(request.reason);
  if (outcome === 'verified') return 'verified';
  return outcome === 'unsupported' ? 'password_required' : 'denied';
}

export type BiometricUnlockResult =
  | { success: true; masterPassword: string }
  | { success: false; reason: 'unauthorized' | 'not_enabled' | 'no_key' | 'unsupported' | 'cancelled' | 'workspace_changed' | 'read_failed' };

export interface BiometricUnlockDeps {
  isMainSender: boolean;
  getActiveWorkspaceId: () => string;
  /** Name and biometric flag of a workspace, or null if it does not exist. */
  getWorkspace: (workspaceId: string) => { name: string; biometricEnabled: boolean } | null;
  hasStoredPassword: (workspaceId: string) => boolean;
  readStoredPassword: (workspaceId: string) => Promise<string>;
  presence: (reason: string) => Promise<PresenceOutcome>;
}

/**
 * Releases a workspace master password only when all of these hold: the request comes from the
 * main window, the workspace opted in to biometric unlock, a password is stored, the OS verified
 * the user, and the active workspace did not change while the prompt was open.
 */
export async function unlockWithBiometrics(deps: BiometricUnlockDeps): Promise<BiometricUnlockResult> {
  if (!deps.isMainSender) return { success: false, reason: 'unauthorized' };
  const workspaceId = deps.getActiveWorkspaceId();
  const workspace = deps.getWorkspace(workspaceId);
  if (!workspace?.biometricEnabled) return { success: false, reason: 'not_enabled' };
  if (!deps.hasStoredPassword(workspaceId)) return { success: false, reason: 'no_key' };

  const outcome = await deps.presence(`unlock the workspace "${workspace.name || workspaceId}"`);
  if (outcome !== 'verified') return { success: false, reason: outcome };
  if (deps.getActiveWorkspaceId() !== workspaceId) return { success: false, reason: 'workspace_changed' };

  try {
    return { success: true, masterPassword: await deps.readStoredPassword(workspaceId) };
  } catch (error) {
    console.warn('[UserPresence] Stored master password could not be read:', error);
    return { success: false, reason: 'read_failed' };
  }
}
