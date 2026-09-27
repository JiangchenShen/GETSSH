import fs from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceDir } from '../utils/workspaceId';
import { readSecretFileAsync, writeSecretFile } from './secretStore';
import { verifyUserPresence, type OwnerCheckDeps } from './userPresence';

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

/** verifyOwner() dependencies bound to the currently active workspace. */
export function activeWorkspaceOwnerDeps(): OwnerCheckDeps {
  const { getActiveWorkspaceId } = require('../handlers/workspaceHandler');
  const workspaceId: string = getActiveWorkspaceId();
  return {
    hasStoredPassword: () => hasWorkspaceVault(workspaceId),
    readStoredPassword: () => readWorkspaceVault(workspaceId),
    presence: verifyUserPresence,
  };
}
