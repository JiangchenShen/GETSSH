import { useEffect } from 'react';
import { loadActiveWorkspace, unlockActiveWorkspaceWithPresence } from '../lib/workspaceUnlock';
import { useCryptoStore } from '../store/cryptoStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useSessionStore } from '../store/sessionStore';
import { useAppLockStore } from '../store/appLockStore';

/** Opens the active workspace once the app is unlocked, asking for its password only if it has one. */
export const useCryptoBoot = () => {
  const setWorkspaceUnprotected = useCryptoStore(state => state.setWorkspaceUnprotected);

  useEffect(() => {
    let active = true;
    const bootCrypto = async () => {
      const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
      const revision = useSessionStore.getState().sessionsRevision;
      const res = await window.electronAPI.checkProfiles();
      if (!active || useWorkspaceStore.getState().activeWorkspaceId !== workspaceId
        || useWorkspaceStore.getState().isSwitching || useAppLockStore.getState().state?.phase !== 'ready') return;
      // `none` also means the main process has not unlocked the app. It cannot prove
      // that the saved list is empty; useAppLockSync loads that list after unlocking.
      if (res.status === 'none') return;
      setWorkspaceUnprotected(!res.hasPassword);
      if (res.status === 'plain') {
        if (useSessionStore.getState().sessionsRevision !== revision && useSessionStore.getState().profilesWorkspaceId === workspaceId) {
          useWorkspaceStore.setState({ isVaultLocked: false });
          return;
        }
        if (!(await loadActiveWorkspace())) useWorkspaceStore.setState({ isVaultLocked: true, isUnlockModalOpen: false });
        return;
      }
      if (res.status === 'encrypted') {
        useWorkspaceStore.setState({ isVaultLocked: true, isUnlockModalOpen: false });
        if (res.biometricEnabled) await unlockActiveWorkspaceWithPresence();
        return;
      }
    };
    bootCrypto().catch(error => console.error('[CryptoBoot] Failed to open the active workspace:', error));
    return () => { active = false; };
  }, [setWorkspaceUnprotected]);
};
