import { useEffect } from 'react';
import { loadActiveWorkspace, unlockActiveWorkspaceWithPresence } from '../lib/workspaceUnlock';
import { useCryptoStore } from '../store/cryptoStore';
import { useWorkspaceStore } from '../store/workspaceStore';

/** Opens the active workspace once the app is unlocked, asking for its password only if it has one. */
export const useCryptoBoot = () => {
  const setWorkspaceUnprotected = useCryptoStore(state => state.setWorkspaceUnprotected);

  useEffect(() => {
    const bootCrypto = async () => {
      const res = await window.electronAPI.checkProfiles();
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
      useWorkspaceStore.setState({ isVaultLocked: false });
    };
    bootCrypto().catch(error => console.error('[CryptoBoot] Failed to open the active workspace:', error));
  }, [setWorkspaceUnprotected]);
};
