import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { useCryptoStore } from '../store/cryptoStore';

export function useAppEvents() {
  const isCommandCenterOpen = useAppStore(state => state.isCommandCenterOpen);
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
  const appConfig = useAppStore(state => state.appConfig);
  const cryptoMode = useCryptoStore(state => state.cryptoMode);
  const setCryptoMode = useCryptoStore(state => state.setCryptoMode);
  const setMasterPassword = useCryptoStore(state => state.setMasterPassword);

  // Global Shortcut for Command Center
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isAltSpace = e.altKey && e.code === 'Space';
      const isCtrlSpace = e.ctrlKey && e.code === 'Space';
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      
      if (isAltSpace || isCtrlSpace || isCmdK) {
        e.preventDefault();
        useAppStore.getState().addToast('Command Center Shortcut Fired: ' + (!isCommandCenterOpen ? 'Open' : 'Close'));
        setIsCommandCenterOpen(!isCommandCenterOpen);
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isCommandCenterOpen, setIsCommandCenterOpen]);

  // Auto-Lock Inactivity Engine
  useEffect(() => {
    if (!appConfig.autoLockTimeout) return; // 0 means disabled
    
    let lastActive = Date.now();
    const updateActivity = () => { lastActive = Date.now(); };
    
    window.addEventListener('mousemove', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('click', updateActivity);

    const checkInterval = setInterval(() => {
      if (cryptoMode !== 'idle') return;
      
      if (Date.now() - lastActive > appConfig.autoLockTimeout * 60 * 1000) {
        setCryptoMode('locked');
        setMasterPassword(''); // Clear from memory for security
      }
    }, 10000); // check every 10 seconds

    return () => {
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('click', updateActivity);
      clearInterval(checkInterval);
    };
  }, [appConfig.autoLockTimeout, setCryptoMode, cryptoMode, setMasterPassword]);
}
