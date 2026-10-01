import { APP_SCOPE, isKeystoreError, keystore } from './keystore';
import type { OwnerCheckDeps, PresenceOutcome } from './userPresence';

/**
 * Identity checks backed by the keystore. The OS prompt (Touch ID / the login password, Windows
 * Hello) runs in native code; a typed password is checked against the keystore's own routes.
 * The renderer no longer keeps any password, so a password sent over IPC was typed just now.
 */

export async function keystorePresence(reason: string): Promise<PresenceOutcome> {
  try {
    await keystore.verifyPresence(reason);
    return 'verified';
  } catch (error) {
    if (isKeystoreError(error, 'cancelled')) return 'cancelled';
    if (isKeystoreError(error, 'unavailable') || isKeystoreError(error, 'not_configured')) return 'unsupported';
    console.warn('[OwnerChecks] OS verification failed:', error);
    return 'cancelled';
  }
}

async function passwordOpens(scope: string, candidate: string): Promise<boolean> {
  try {
    await keystore.verifyPassword(scope, candidate);
    return true;
  } catch (error) {
    if (isKeystoreError(error, 'wrong_password') || isKeystoreError(error, 'no_password')) return false;
    throw error;
  }
}

function scopeProtected(scope: string): boolean {
  return !!keystore.status().scopes.find(entry => entry.id === scope)?.protected;
}

/** For changes to one scope: the password that protects it (the master password when one is set). */
export function scopeOwnerDeps(scope: string): OwnerCheckDeps {
  return {
    hasStoredPassword: () => scopeProtected(scope),
    passwordMatches: candidate => passwordOpens(scope, candidate),
    presence: keystorePresence,
  };
}

/**
 * For app-wide actions (ignoring a lockdown, enabling backend plugins): required as soon as
 * anything is protected; the master password, or any workspace's own password, is accepted.
 */
export function appOwnerDeps(): OwnerCheckDeps {
  const protectedScopes = () => keystore.status().scopes.filter(scope => scope.protected);
  return {
    hasStoredPassword: () => protectedScopes().length > 0,
    passwordMatches: async candidate => {
      const status = keystore.status();
      const candidates = status.appProtected
        ? [APP_SCOPE]
        : status.scopes.filter(scope => scope.ownPassword).map(scope => scope.id);
      for (const scope of candidates) {
        if (await passwordOpens(scope, candidate)) return true;
      }
      return false;
    },
    presence: keystorePresence,
  };
}
