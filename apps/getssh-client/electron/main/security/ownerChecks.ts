import { getStore, toStoreError } from '../services/getsshStore';
import type { OwnerCheckDeps, PresenceOutcome } from './userPresence';

/**
 * Identity checks backed by getssh-store. The OS prompt (Touch ID / the login password, Windows
 * Hello) runs in native code; a typed password is checked against the store's own routes.
 * The renderer no longer keeps any password, so a password sent over IPC was typed just now.
 */

export async function storePresence(reason: string): Promise<PresenceOutcome> {
  try {
    return (await getStore().verifyPresence(reason)) ? 'verified' : 'cancelled';
  } catch (error) {
    const code = toStoreError(error).code;
    if (code === 'unavailable' || code === 'not_configured') return 'unsupported';
    console.warn('[OwnerChecks] OS verification failed:', error);
    return 'cancelled';
  }
}

function masterPasswordSet(): boolean {
  return getStore().appState().masterPassword;
}

/** Workspaces that have a password of their own (possible only without a master password). */
function workspacesWithPassword(): string[] {
  return getStore().listWorkspaces().filter(workspace => workspace.hasPassword).map(workspace => workspace.id);
}

/** For changes to one workspace: the password that protects it (the master password when one is set). */
export function workspaceOwnerDeps(workspaceId: string): OwnerCheckDeps {
  return {
    hasStoredPassword: () => masterPasswordSet() || workspacesWithPassword().includes(workspaceId),
    passwordMatches: candidate => masterPasswordSet()
      ? getStore().verifyPassword(candidate)
      : getStore().verifyPassword(candidate, workspaceId),
    presence: storePresence,
  };
}

/**
 * For app-wide actions (ignoring a lockdown, enabling backend plugins): required as soon as
 * anything is protected; the master password, or any workspace's own password, is accepted.
 */
export function appOwnerDeps(): OwnerCheckDeps {
  return {
    hasStoredPassword: () => masterPasswordSet() || workspacesWithPassword().length > 0,
    passwordMatches: async candidate => {
      if (masterPasswordSet()) return getStore().verifyPassword(candidate);
      for (const workspaceId of workspacesWithPassword()) {
        if (await getStore().verifyPassword(candidate, workspaceId)) return true;
      }
      return false;
    },
    presence: storePresence,
  };
}
