import { useCryptoStore } from '../store/cryptoStore';
import { useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAppLockStore } from '../store/appLockStore';
import type { SessionProfile } from '../store/sessionStore';

/**
 * Unlocking the active workspace. The main process does the unlocking (keystore) and returns
 * profiles; nothing here keeps a password.
 */

function opened(): true {
  useWorkspaceStore.setState({ isVaultLocked: false, isUnlockModalOpen: false });
  useCryptoStore.getState().setCryptoMode('idle');
  return true;
}

/** Loads the active workspace if it opens without a prompt; false while it needs unlocking. */
export async function loadActiveWorkspace(): Promise<boolean> {
  return loadProfiles('');
}

async function loadProfiles(password: string): Promise<boolean> {
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
  const revision = useSessionStore.getState().sessionsRevision;
  let leftScope = false;
  const stopWorkspace = useWorkspaceStore.subscribe((current, previous) => {
    if (current.activeWorkspaceId !== workspaceId || (current.isSwitching && !previous.isSwitching)
      || (current.isVaultLocked && !previous.isVaultLocked)) leftScope = true;
  });
  const stopApp = useAppLockStore.subscribe(current => { if (current.state?.phase === 'locked') leftScope = true; });
  const stillCurrent = () => !leftScope && useWorkspaceStore.getState().activeWorkspaceId === workspaceId
    && useAppLockStore.getState().state?.phase !== 'locked';
  try {
    const profiles = await window.electronAPI.unlockProfiles(password);
    if (!stillCurrent()) return true;
    const sessions = useSessionStore.getState();
    if (sessions.sessionsRevision === revision) {
      const selected = sessions.sessions[sessions.selectedSessionIndex ?? -1];
      const updated: SessionProfile[] = [...profiles, ...sessions.sessions.filter(profile => profile.isDraft || profile.isQuickConnect)];
      sessions.replaceSessions(updated, workspaceId);
      const selectedIndex = selected ? updated.findIndex(profile => profile === selected || !!profile.id && profile.id === selected.id) : -1;
      sessions.setSelectedSessionIndex(selectedIndex >= 0 ? selectedIndex : null);
    }
    return opened();
  } catch {
    if (!stillCurrent()) return true;
    const sessions = useSessionStore.getState();
    return sessions.sessionsRevision !== revision && sessions.profilesWorkspaceId === workspaceId ? opened() : false;
  } finally {
    stopWorkspace(); stopApp();
  }
}

export async function unlockActiveWorkspaceWithPassword(password: string): Promise<boolean> {
  return loadProfiles(password);
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
  useSessionStore.getState().replaceSessions([], null);
  useWorkspaceStore.setState({ isVaultLocked: true, isUnlockModalOpen: false });
}
