import { useCryptoStore } from '../store/cryptoStore';
import { useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * Unlocking the active workspace. The main process does the unlocking (keystore) and returns
 * profiles; nothing here keeps a password.
 */

function opened(profiles: unknown): true {
  useSessionStore.getState().setSessions(Array.isArray(profiles) ? profiles : []);
  useWorkspaceStore.setState({ isVaultLocked: false, isUnlockModalOpen: false });
  useCryptoStore.getState().setCryptoMode('idle');
  return true;
}

/** Loads the active workspace if it opens without a prompt; false while it needs unlocking. */
export async function loadActiveWorkspace(): Promise<boolean> {
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
  const sessions = useSessionStore.getState().sessions;
  const stillCurrent = () => useWorkspaceStore.getState().activeWorkspaceId === workspaceId
    && useSessionStore.getState().sessions === sessions;
  try {
    const profiles = await window.electronAPI.unlockProfiles('');
    // A later import or workspace switch already replaced the list; keep that newer result.
    return stillCurrent() ? opened(profiles) : true;
  } catch {
    return !stillCurrent();
  }
}

export async function unlockActiveWorkspaceWithPassword(password: string): Promise<boolean> {
  try {
    return opened(await window.electronAPI.unlockProfiles(password));
  } catch (error) {
    console.warn('[WorkspaceUnlock] Unlock failed:', error);
    return false;
  }
}

/** Touch ID / Windows Hello; resolves false when the user cancels or it is not enabled. */
export async function unlockActiveWorkspaceWithPresence(): Promise<boolean> {
  const result = await window.electronAPI.promptBiometricUnlock();
  if (!result.success) return false;
  return loadActiveWorkspace();
}

/** Locks the active workspace again (it has its own password) and clears its profiles. */
export async function lockActiveWorkspace(): Promise<void> {
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
  await window.electronAPI.workspace.lock(workspaceId);
  useSessionStore.getState().setSessions([]);
  useWorkspaceStore.setState({ isVaultLocked: true, isUnlockModalOpen: false });
}
