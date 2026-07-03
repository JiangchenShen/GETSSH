import React, { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useCryptoStore } from '../store/cryptoStore';

/**
 * IpcManager handles all window.electronAPI IPC event subscriptions.
 * It is a non-rendering component that acts as a bridge between Electron IPC and Zustand stores.
 */
export const IpcManager: React.FC = () => {
  const setUpdateAvailable = useAppStore(state => state.setUpdateAvailable);
  const setIsFullScreen = useAppStore(state => state.setIsFullScreen);
  const setPendingAgentProposal = useWorkspaceStore(state => state.setPendingAgentProposal);
  const updateSessionOsType = useSessionStore(state => state.updateSessionOsType);
  const setTornPaneId = useAppStore(state => state.setTornPaneId);
  const setSecurityPrompt = useAppStore(state => state.setSecurityPrompt);

  // --------------------------------------------------------------------------
  // Hollow Window / Tear-out IPC
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!window.electronAPI?.windowGetHijackIdentity) return;
    
    // Actively request hijack identity once React has mounted.
    // This avoids race conditions where the main process sends the identity before the renderer is listening.
    window.electronAPI.windowGetHijackIdentity().then((payload) => {
      if (payload) {
        setTornPaneId(payload.paneId);
        if (payload.terminalBuffers) {
           (window as any).__tornBuffers = payload.terminalBuffers;
        }
        if (payload.tornTitle) {
           (window as any).__tornTitle = payload.tornTitle;
        }
      }
    });
  }, [setTornPaneId]);

  useEffect(() => {
    if (!window.electronAPI?.onWindowReceiveTornBuffers) return;
    const cleanup = window.electronAPI.onWindowReceiveTornBuffers((payload) => {
      // Hollow windows should NEVER process Tear In buffers, because they are the ones sending it!
      // This prevents reused Hollow Windows in the pool from accidentally accumulating stale buffers.
      if (new URLSearchParams(window.location.search).get('isHollow') === 'true') {
        return;
      }
      if (!(window as any).__tornTerminalBuffers) {
         (window as any).__tornTerminalBuffers = {};
      }
      (window as any).__tornTerminalBuffers = { ...(window as any).__tornTerminalBuffers, ...payload };
    });
    return cleanup;
  }, []);

  // --------------------------------------------------------------------------
  // Nexus Core Sync (State, Trees, Patches)
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!window.electronAPI?.onNexusSyncTree) return;
    const cleanup = window.electronAPI.onNexusSyncTree((tabId: string, title: string, tree: any, isTornOff: boolean) => {
      useSessionStore.getState().syncNexusTree(tabId, title, tree, isTornOff);
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onNexusPatchLeaf) return;
    const cleanup = window.electronAPI.onNexusPatchLeaf((paneId: string, updates: any) => {
      useSessionStore.getState().patchNexusLeaf(paneId, updates);
    });
    return cleanup;
  }, []);

  // --------------------------------------------------------------------------
  // Host Key Verification
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!window.electronAPI?.onPromptHostVerification) return;
    const cleanup = window.electronAPI.onPromptHostVerification((data) => {
      setSecurityPrompt({
        isOpen: true,
        requestId: data.requestId,
        hostname: data.hostname,
        fingerprint: data.fingerprint,
        isChanged: data.isChanged,
        oldFingerprint: data.oldFingerprint,
      });
    });
    return cleanup;
  }, [setSecurityPrompt]);

  // --------------------------------------------------------------------------
  // OS Fingerprinting
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!window.electronAPI?.onOsFingerprint) return;
    const cleanup = window.electronAPI.onOsFingerprint(({ host, username, osType }) => {
      const currentSessions = useSessionStore.getState().sessions;
      const matched = currentSessions.find(s => s.host.replace(/[/\s]+$/g, '') === host && s.username === username);
      if (matched) {
        updateSessionOsType(matched.host, username, osType as any);
        // Persist the updated osType to disk so it doesn't revert to a question mark on restart
        setTimeout(() => {
           const sessions = useSessionStore.getState().sessions;
           const { masterPassword, encryptionDisabled } = useCryptoStore.getState();
           if (masterPassword || encryptionDisabled) {
              window.electronAPI.saveProfiles({ masterPassword: encryptionDisabled ? '' : masterPassword, payload: sessions });
           }
        }, 50);
      }
    });
    return cleanup;
  }, [updateSessionOsType]);

  // --------------------------------------------------------------------------
  // App Updates
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!window.electronAPI?.onUpdateAvailable) return;
    const cleanup = window.electronAPI.onUpdateAvailable((info) => {
      setUpdateAvailable(info);
    });
    return cleanup;
  }, [setUpdateAvailable]);

  // --------------------------------------------------------------------------
  // Agent Proposals
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!(window as any).electronAPI?.onAgentPropose) return;
    const cleanup = (window as any).electronAPI.onAgentPropose((payload: any) => {
      setPendingAgentProposal(payload);
    });
    return cleanup;
  }, [setPendingAgentProposal]);

  // --------------------------------------------------------------------------
  // UI Fullscreen State
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!window.electronAPI?.onFullScreenState) return;
    const cleanup = window.electronAPI.onFullScreenState((full) => {
      setIsFullScreen(full);
    });
    return cleanup;
  }, [setIsFullScreen]);

  return null;
};
