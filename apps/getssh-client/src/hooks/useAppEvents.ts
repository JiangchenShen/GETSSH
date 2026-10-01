import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { useCryptoStore } from '../store/cryptoStore';

export function useAppEvents() {
  const isCommandCenterOpen = useAppStore(state => state.isCommandCenterOpen);
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
  const appConfig = useAppStore(state => state.appConfig);
  const cryptoMode = useCryptoStore(state => state.cryptoMode);
  const setCryptoMode = useCryptoStore(state => state.setCryptoMode);

  // Global Shortcut for Command Center
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const isAltSpace = e.altKey && e.code === 'Space';
      const isCmdK = e.metaKey && !e.ctrlKey && key === 'k';
      const isCtrlShiftK = e.ctrlKey && e.shiftKey && !e.metaKey && key === 'k';
      // Ctrl+K (readline kill-line) and Ctrl+Space (set-mark) belong to the shell while a terminal has focus.
      const inTerminal = e.target instanceof Element && !!e.target.closest('.xterm');
      const isCtrlK = e.ctrlKey && !e.shiftKey && !e.metaKey && key === 'k';
      const isCtrlSpace = e.ctrlKey && e.code === 'Space';

      if (isAltSpace || isCmdK || isCtrlShiftK || (!inTerminal && (isCtrlK || isCtrlSpace))) {
        // Consume the key: xterm ignores defaultPrevented, so it must not reach the terminal at all.
        e.preventDefault();
        e.stopPropagation();
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
        lastActive = Date.now();
        // The main process drops the keys of everything protected and tells every window.
        void window.electronAPI.appLock.lock();
      }
    }, 10000); // check every 10 seconds

    return () => {
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('click', updateActivity);
      clearInterval(checkInterval);
    };
  }, [appConfig.autoLockTimeout, setCryptoMode, cryptoMode]);
}
