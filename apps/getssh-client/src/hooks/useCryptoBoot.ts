import { useEffect } from 'react';
import { useCryptoStore } from '../store/cryptoStore';
import { useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';

export const useCryptoBoot = () => {
  const setEncryptionDisabled = useCryptoStore(state => state.setEncryptionDisabled);
  const setMasterPassword = useCryptoStore(state => state.setMasterPassword);
  const setSessions = useSessionStore(state => state.setSessions);

  useEffect(() => {
    const bootCrypto = async () => {
       const res = await window.electronAPI.checkProfiles();
       if (res.status === 'encrypted') {
          setEncryptionDisabled(false);
          useWorkspaceStore.setState({ isVaultLocked: true, isUnlockModalOpen: false });
          
          if (res.biometricEnabled) {
            const bioRes = await window.electronAPI.promptBiometricUnlock();
            if (bioRes.success && bioRes.masterPassword) {
              try {
                 const decrypted = await window.electronAPI.unlockProfiles(bioRes.masterPassword);
                 setMasterPassword(bioRes.masterPassword);
                 setSessions(decrypted);
                 useWorkspaceStore.setState({ isVaultLocked: false });
                 return; 
              } catch (e) {
                 console.warn('Biometric unlock failed to decrypt:', e);
              }
            }
          }
       } else if (res.status === 'plain') {
          const plainSessions = await window.electronAPI.unlockProfiles('');
          setSessions(plainSessions);
          setEncryptionDisabled(true);
          useWorkspaceStore.setState({ isVaultLocked: false });
       } else {
          useWorkspaceStore.setState({ isVaultLocked: false });
       }
    };
    bootCrypto();
  }, [setEncryptionDisabled, setMasterPassword, setSessions]);
};
