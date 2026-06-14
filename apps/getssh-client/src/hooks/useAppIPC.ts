import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';

export function useAppIPC() {
  const setUpdateAvailable = useAppStore(state => state.setUpdateAvailable);
  const setIsFullScreen = useAppStore(state => state.setIsFullScreen);
  const setPendingAgentProposal = useWorkspaceStore(state => state.setPendingAgentProposal);
  const updateSessionOsType = useSessionStore(state => state.updateSessionOsType);
  
  // Create a ref wrapper for syncProfiles if needed later, but we can just use the store
  
  // IPC: Updates
  useEffect(() => {
    if (window.electronAPI?.onUpdateAvailable) {
      const removeUpdateListener = window.electronAPI.onUpdateAvailable((info) => {
        setUpdateAvailable(info);
      });
      return removeUpdateListener;
    }
  }, [setUpdateAvailable]);

  // IPC: Host Key Verification & Nexus State Sync
  useEffect(() => {
    if (window.electronAPI?.onPromptHostVerification) {
      const removeListener = window.electronAPI.onPromptHostVerification((data) => {
        useAppStore.getState().setSecurityPrompt({
          isOpen: true,
          requestId: data.requestId,
          hostname: data.hostname,
          fingerprint: data.fingerprint,
          isChanged: data.isChanged,
          oldFingerprint: data.oldFingerprint,
        });
      });
      
      const removePatchListener = window.electronAPI.onNexusPatchLeaf((paneId: string, updates: any) => {
        useSessionStore.getState().patchNexusLeaf(paneId, updates);
      });
      
      let removeSyncListener: (() => void) | undefined;
      if (window.electronAPI.onNexusSyncTree) {
         removeSyncListener = window.electronAPI.onNexusSyncTree((tabId: string, tree: any) => {
           useSessionStore.getState().syncNexusTree(tabId, tree);
         });
      }
      return () => {
        removeListener();
        removePatchListener();
        if (removeSyncListener) removeSyncListener();
      };
    }
  }, []);

  // IPC: Agent Proposals
  useEffect(() => {
    let removeListener: (() => void) | undefined;
    if ((window as any).electronAPI?.onAgentPropose) {
      removeListener = (window as any).electronAPI.onAgentPropose((payload: any) => {
        setPendingAgentProposal(payload);
      });
    }
    return () => {
      if (removeListener) removeListener();
    };
  }, [setPendingAgentProposal]);

  // IPC: Fullscreen State
  useEffect(() => {
    if (window.electronAPI?.onFullScreenState) {
      const removeListener = window.electronAPI.onFullScreenState((full) => {
        setIsFullScreen(full);
      });
      return removeListener;
    }
  }, [setIsFullScreen]);

  // IPC: OS Fingerprint
  useEffect(() => {
    if (!window.electronAPI?.onOsFingerprint) return;
    const unsub = window.electronAPI.onOsFingerprint(({ host, username, osType }) => {
      const currentSessions = useSessionStore.getState().sessions;
      const matched = currentSessions.find(s => s.host.replace(/[/\s]+$/g, '') === host && s.username === username);
      if (matched) {
        updateSessionOsType(matched.host, username, osType as any);
        // Persist the updated osType to disk so it doesn't revert to a question mark on restart
        setTimeout(() => {
           const sessions = useSessionStore.getState().sessions;
           const { masterPassword, encryptionDisabled } = require('../store/cryptoStore').useCryptoStore.getState();
           if (masterPassword || encryptionDisabled) {
              window.electronAPI.saveProfiles({ masterPassword: encryptionDisabled ? '' : masterPassword, payload: sessions });
           }
        }, 50);
      }
    });
    return unsub;
  }, [updateSessionOsType]);
}
