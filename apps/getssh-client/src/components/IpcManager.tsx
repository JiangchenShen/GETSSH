import React, { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { savedProfiles, useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { usePluginStore } from '../store/pluginStore';
import { useCryptoStore } from '../store/cryptoStore';
import { findLeaf } from '../utils/paneHelpers';

/**
 * IpcManager handles all window.electronAPI IPC event subscriptions of the MAIN window.
 * It is a non-rendering component that acts as a bridge between Electron IPC and Zustand stores.
 * Torn-off windows do not mount it; TornWindowApp keeps its own, much smaller set of subscriptions.
 */
export const IpcManager: React.FC = () => {
  const setUpdateAvailable = useAppStore(state => state.setUpdateAvailable);
  const setIsFullScreen = useAppStore(state => state.setIsFullScreen);
  const setPendingAgentProposal = useWorkspaceStore(state => state.setPendingAgentProposal);
  const updateSessionOsType = useSessionStore(state => state.updateSessionOsType);
  const enqueueSecurityPrompt = useAppStore(state => state.enqueueSecurityPrompt);

  // --------------------------------------------------------------------------
  // Nexus Core Sync (rev-ordered tab snapshots from the Rust core)
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!window.electronAPI?.onNexusSyncTree) return;
    const cleanup = window.electronAPI.onNexusSyncTree((payload) => {
      useSessionStore.getState().syncNexusTree(payload);
    });
    return cleanup;
  }, []);

  // Focus request after a torn window was attached back (the pane may have been re-docked into another tab).
  useEffect(() => {
    if (!window.electronAPI?.onNexusFocusPane) return;
    return window.electronAPI.onNexusFocusPane(async ({ tabId, paneId }) => {
      const findTab = () => useSessionStore.getState().tabs.find(t => t.id === tabId);
      const initial = findTab();
      if (!initial?.paneTree || !findLeaf(initial.paneTree, paneId)) {
        // The focus request can overtake the sync broadcast; pull the tab so the pane exists first.
        const snapshot = await window.electronAPI.nexusGetTab(tabId).catch(() => null);
        if (snapshot) useSessionStore.getState().syncNexusTree(snapshot);
      }
      const tab = findTab();
      const activeWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId;
      if (!tab || tab.isTornOff || (tab.workspaceId ?? activeWorkspaceId) !== activeWorkspaceId) return;
      const state = useSessionStore.getState();
      state.setActiveTabId(tabId);
      state.setSelectedSessionIndex(null);
      if (tab.paneTree && findLeaf(tab.paneTree, paneId)) state.setActivePaneId(paneId);
    });
  }, []);

  // --------------------------------------------------------------------------
  // Plugin UI extensions / settings schemas: pull the current state once; the broadcasts
  // (subscribed in initPluginBridge) keep it fresh afterwards.
  // --------------------------------------------------------------------------
  useEffect(() => {
    let disposed = false;
    window.electronAPI?.getPluginUiExtensions?.()
      .then(payload => { if (!disposed && payload) usePluginStore.getState().setUIExtensions(payload); })
      .catch(() => {});
    window.electronAPI?.getPluginSettingsSchemas?.()
      .then(payload => { if (!disposed && payload) usePluginStore.getState().setSettingsSchemas(payload); })
      .catch(() => {});
    return () => { disposed = true; };
  }, []);

  // --------------------------------------------------------------------------
  // Host Key Verification (queued: a second prompt must not replace the first)
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!window.electronAPI?.onPromptHostVerification) return;
    const cleanup = window.electronAPI.onPromptHostVerification((data) => {
      enqueueSecurityPrompt({
        requestId: data.requestId,
        hostname: data.hostname,
        fingerprint: data.fingerprint,
        isChanged: data.isChanged,
        oldFingerprint: data.oldFingerprint,
      });
    });
    return cleanup;
  }, [enqueueSecurityPrompt]);

  useEffect(() => {
    if (!window.electronAPI?.onHostVerificationCancelled) return;
    return window.electronAPI.onHostVerificationCancelled((requestId) => {
      useAppStore.getState().dropSecurityPrompt(requestId);
    });
  }, []);

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
        // Persist the updated osType to disk so it doesn't revert to a question mark on restart.
        // The list belongs to this workspace: skip the save if the workspace changed meanwhile.
        const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
        setTimeout(() => {
           if (useWorkspaceStore.getState().activeWorkspaceId !== workspaceId) return;
           const sessions = useSessionStore.getState().sessions;
           const { masterPassword, encryptionDisabled } = useCryptoStore.getState();
           if (masterPassword || encryptionDisabled) {
              // Main refuses the write if the workspace changed meanwhile; the osType is re-detected next connect.
              window.electronAPI.saveProfiles({ masterPassword: encryptionDisabled ? '' : masterPassword, payload: savedProfiles(sessions), workspaceId })
                .catch((err) => console.warn('[IpcManager] Skipped persisting detected OS type:', err));
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
