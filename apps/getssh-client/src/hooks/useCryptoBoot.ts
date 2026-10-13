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
        || useAppLockStore.getState().state?.phase === 'locked') return;
      if (useSessionStore.getState().sessionsRevision !== revision) {
        if (useSessionStore.getState().profilesWorkspaceId === workspaceId) useWorkspaceStore.setState({ isVaultLocked: false });
        return;
      }
      setWorkspaceUnprotected(!res.hasPassword);
      if (res.status === 'plain') {
        if (!(await loadActiveWorkspace())) useWorkspaceStore.setState({ isVaultLocked: true, isUnlockModalOpen: false });
        return;
      }
      if (res.status === 'encrypted') {
        useWorkspaceStore.setState({ isVaultLocked: true, isUnlockModalOpen: false });
        if (res.biometricEnabled) await unlockActiveWorkspaceWithPresence();
        return;
      }
      const sessions = useSessionStore.getState();
      sessions.replaceSessions(sessions.sessions.filter(profile => profile.isDraft || profile.isQuickConnect), workspaceId);
      useWorkspaceStore.setState({ isVaultLocked: false });
    };
    bootCrypto().catch(error => console.error('[CryptoBoot] Failed to open the active workspace:', error));
    return () => { active = false; };
  }, [setWorkspaceUnprotected]);
};
