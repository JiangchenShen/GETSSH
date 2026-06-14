import { useEffect } from 'react';
import { useCryptoStore } from '../store/cryptoStore';
import { useSessionStore } from '../store/sessionStore';

export const useCryptoBoot = () => {
  const setCryptoMode = useCryptoStore(state => state.setCryptoMode);
  const setEncryptionDisabled = useCryptoStore(state => state.setEncryptionDisabled);
  const setMasterPassword = useCryptoStore(state => state.setMasterPassword);
  const setSessions = useSessionStore(state => state.setSessions);

  useEffect(() => {
    const bootCrypto = async () => {
       const status = await window.electronAPI.checkProfiles();
       if (status === 'encrypted') {
          setEncryptionDisabled(false);
          setCryptoMode('locked');
          const bioRes = await window.electronAPI.promptBiometricUnlock();
          if (bioRes.success && bioRes.masterPassword) {
            try {
               const decrypted = await window.electronAPI.unlockProfiles(bioRes.masterPassword);
               setMasterPassword(bioRes.masterPassword);
               setSessions(decrypted);
               setCryptoMode('idle');
               return; 
            } catch (e) {
               console.warn('Biometric unlock failed to decrypt:', e);
            }
          }
       } else if (status === 'plain') {
          const plainSessions = await window.electronAPI.unlockProfiles('');
          setSessions(plainSessions);
          setEncryptionDisabled(true);
          setCryptoMode('idle');
       } else {
          setCryptoMode('idle');
       }
    };
    bootCrypto();
  }, [setCryptoMode, setEncryptionDisabled, setMasterPassword, setSessions]);
};
