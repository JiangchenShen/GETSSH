import fs from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceDir } from '../utils/workspaceId';
import { readSecretFileAsync, writeSecretFile } from './secretStore';
import { secretsEqual, verifyUserPresence, type OwnerCheckDeps } from './userPresence';

/** vault.key: the workspace master password, kept for biometric unlock and identity checks. */
export function workspaceVaultPath(workspaceId: string): string {
  return path.join(resolveWorkspaceDir(workspaceId), 'vault.key');
}

export function hasWorkspaceVault(workspaceId: string): boolean {
  try {
    return fs.existsSync(workspaceVaultPath(workspaceId));
  } catch {
    return false;
  }
}

export function readWorkspaceVault(workspaceId: string): Promise<string> {
  return readSecretFileAsync(workspaceVaultPath(workspaceId));
}

export function writeWorkspaceVault(workspaceId: string, masterPassword: string): void {
  writeSecretFile(workspaceVaultPath(workspaceId), masterPassword);
}

function databaseManager() {
  return require('../services/DatabaseManager').DatabaseManager;
}

function workspaceHasPassword(workspaceId: string): boolean {
  const workspace = databaseManager().getWorkspaces().find((entry: { id: string }) => entry.id === workspaceId);
  return !!workspace?.hasPassword || hasWorkspaceVault(workspaceId);
}

/** Whether `candidate` is this workspace's master password: vault.key if present, else the database key. */
export async function workspacePasswordMatches(workspaceId: string, candidate: string): Promise<boolean> {
  if (hasWorkspaceVault(workspaceId)) {
    try {
      return secretsEqual(candidate, await readWorkspaceVault(workspaceId));
    } catch {
      // Unreadable vault: fall through to the database itself.
    }
  }
  return databaseManager().workspaceKeyMatches(workspaceId, candidate);
}

/** verifyOwner() for an action on one workspace (changing or removing its password). */
export function workspaceOwnerDeps(workspaceId: string): OwnerCheckDeps {
  return {
    hasStoredPassword: () => workspaceHasPassword(workspaceId),
    passwordMatches: candidate => workspacePasswordMatches(workspaceId, candidate),
    presence: verifyUserPresence,
  };
}

/**
 * verifyOwner() for app-wide actions (ignoring a lockdown, enabling backend plugins). They are not
 * tied to the active workspace, which the renderer can switch to an unprotected one first: any
 * protected workspace makes the check required.
 */
export function appOwnerDeps(): OwnerCheckDeps {
  const protectedWorkspaces = (): string[] =>
    databaseManager().getWorkspaces()
      .map((entry: { id: string }) => entry.id)
      .filter((id: string) => workspaceHasPassword(id));
  return {
    hasStoredPassword: () => protectedWorkspaces().length > 0,
    passwordMatches: async candidate => {
      for (const workspaceId of protectedWorkspaces()) {
        if (await workspacePasswordMatches(workspaceId, candidate)) return true;
      }
      return false;
    },
    presence: verifyUserPresence,
  };
}
