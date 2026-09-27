import { useTranslation } from 'react-i18next';
import { callNexus, savedProfiles, useSessionStore, type PaneLeaf, type SessionProfile } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';
import { useCryptoStore } from '../store/cryptoStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { findLeaf, findWelcomePane, updateLeafInTree } from '../utils/paneHelpers';
import { buildConnectionConfig, buildStartupCommand, stripConnectionSecrets } from '../utils/connectionProfile';

export const useSessionManager = () => {
  const { t } = useTranslation();

  const sessions = useSessionStore(state => state.sessions);
  const setSessions = useSessionStore(state => state.setSessions);
  const selectedSessionIndex = useSessionStore(state => state.selectedSessionIndex);
  const setSelectedSessionIndex = useSessionStore(state => state.setSelectedSessionIndex);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);
  const setActivePaneId = useSessionStore(state => state.setActivePaneId);
  const setTabs = useSessionStore(state => state.setTabs);
  const setConnecting = useSessionStore(state => state.setConnecting);
  const setError = useSessionStore(state => state.setError);

  const appConfig = useAppStore(state => state.appConfig);
  const masterPassword = useCryptoStore(state => state.masterPassword);
  const setMasterPassword = useCryptoStore(state => state.setMasterPassword);
  const encryptionDisabled = useCryptoStore(state => state.encryptionDisabled);
  const setCryptoMode = useCryptoStore(state => state.setCryptoMode);

  const syncProfiles = async (updatedSessions: SessionProfile[]) => {
    setSessions(updatedSessions);
    const persistedSessions = savedProfiles(updatedSessions);
    if (masterPassword || encryptionDisabled) {
      await window.electronAPI.saveProfiles({ masterPassword: encryptionDisabled ? '' : masterPassword, payload: persistedSessions, workspaceId: useWorkspaceStore.getState().activeWorkspaceId });
    } else {
      setCryptoMode('setup');
    }
  };

  const handleSetup = async (pwd: string) => {
    setMasterPassword(pwd);
    await window.electronAPI.saveProfiles({ masterPassword: pwd, payload: savedProfiles(sessions), workspaceId: useWorkspaceStore.getState().activeWorkspaceId });
    setCryptoMode('idle');
    return true;
  };

  const handleUnlock = async (pwd: string) => {
    try {
      const decrypted = await window.electronAPI.unlockProfiles(pwd);
      setMasterPassword(pwd);
      setSessions(decrypted);
      setCryptoMode('idle');
      useWorkspaceStore.setState({ isVaultLocked: false, isUnlockModalOpen: false });
      return true;
    } catch (e) {
      return false;
    }
  };

  // Sidebar calls (event, session) and asks here; Command Center calls (session) after its own two-step confirm.
  const deleteSession = (eventOrSession: React.MouseEvent | SessionProfile, sidebarSession?: SessionProfile) => {
    const fromSidebar = typeof (eventOrSession as React.MouseEvent).stopPropagation === 'function';
    const targetSession = fromSidebar ? sidebarSession : eventOrSession as SessionProfile;
    if (fromSidebar) (eventOrSession as React.MouseEvent).stopPropagation();
    if (!targetSession) return;
    const index = sessions.findIndex(s => s === targetSession || (!!targetSession.id && s.id === targetSession.id));
    if (index === -1) return;
    if (fromSidebar && !window.confirm(t('common.confirmDelete'))) return;
    const updated = [...sessions];
    updated.splice(index, 1);
    syncProfiles(updated);
    if (selectedSessionIndex === index) {
      setSelectedSessionIndex(null);
    } else if (selectedSessionIndex !== null && selectedSessionIndex > index) {
      setSelectedSessionIndex(selectedSessionIndex - 1);
    }
  };

  const toggleAutoStart = (e: React.MouseEvent, targetSession: any) => {
    e.stopPropagation();
    const index = sessions.findIndex(s => s === targetSession);
    if (index === -1) return;
    const updated = [...sessions];
    updated[index] = { ...updated[index], autoStart: !updated[index].autoStart };
    syncProfiles(updated);
  };

  const handleConnect = async (targetSession: any) => {
    setError(null);
    setConnecting(true);

    const connectionWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    const config = {
      ...buildConnectionConfig(targetSession, appConfig),
      profileId: targetSession.isQuickConnect ? undefined : targetSession.id,
      workspaceId: connectionWorkspaceId,
    };
    
    const payload = { ...config, enableAuditLogging: appConfig.enableAuditLogging };
    const res = await window.electronAPI.sshConnect(payload);
    setConnecting(false);

    if (res.success && res.sessionId) {
      const stayedInWorkspace = useWorkspaceStore.getState().activeWorkspaceId === connectionWorkspaceId;
      const startupCommand = buildStartupCommand(targetSession);
      if (stayedInWorkspace && startupCommand && window.confirm(t('connection.confirmStartup', { command: startupCommand }))) {
        window.electronAPI.sshWrite(res.sessionId, `${startupCommand}\n`);
      }
      const tabTitle = targetSession.alias || `${config.username}@${config.host}`;
      const rootPaneId = res.sessionId;
      // Leaf configs reach nexus-core and every window: never with credentials (the tab config may keep them).
      const paneConfig = stripConnectionSecrets(config);
      const paneTree: PaneLeaf = { type: 'leaf', paneId: rootPaneId, paneType: 'terminal', sessionId: res.sessionId, config: paneConfig };

      const sessionState = useSessionStore.getState();
      const latestTabs = sessionState.tabs;
      const targetTabId = stayedInWorkspace ? sessionState.activeTabId : null;
      const targetActivePaneId = stayedInWorkspace ? sessionState.activePaneId : null;
      const currentTab = latestTabs.find(t => t.id === targetTabId && (t.workspaceId ?? connectionWorkspaceId) === connectionWorkspaceId);
      let targetPaneId: string | null = null;
      if (currentTab && currentTab.paneTree) {
        if (targetActivePaneId) {
            const activeLeaf = findLeaf(currentTab.paneTree, targetActivePaneId);
            if (activeLeaf && activeLeaf.paneType === 'welcome') targetPaneId = activeLeaf.paneId;
        }
        if (!targetPaneId) {
            const welcomeLeaf = findWelcomePane(currentTab.paneTree);
            if (welcomeLeaf) targetPaneId = welcomeLeaf.paneId;
        }
      }

      if (targetPaneId) {
        setTabs(latestTabs.map(t => {
          if (t.id !== targetTabId || !t.paneTree) return t;
          return {
            ...t,
            workspaceId: connectionWorkspaceId,
            paneTree: updateLeafInTree(t.paneTree, targetPaneId!, { paneType: 'terminal', sessionId: res.sessionId, config: paneConfig }),
          };
        }));
        // The local tree already shows the terminal; a nexus failure is logged by callNexus.
        await callNexus('replace pane with terminal', window.electronAPI.nexusReplacePane(targetPaneId, 'terminal', res.sessionId, JSON.stringify(paneConfig)));
      } else {
        setTabs([...latestTabs, {
          id: res.sessionId,
          title: tabTitle,
          config,
          workspaceId: connectionWorkspaceId,
          paneTree,
        }]);
        if (stayedInWorkspace) {
          setActiveTabId(res.sessionId);
          setActivePaneId(rootPaneId);
          setSelectedSessionIndex(null);
        }
        await callNexus('register terminal tab', window.electronAPI.nexusRegisterTab(res.sessionId, rootPaneId, res.sessionId, 'terminal', JSON.stringify(paneConfig), tabTitle, connectionWorkspaceId));
      }
      if (targetSession.isQuickConnect) {
        const current = useSessionStore.getState();
        current.setSessions(current.sessions.filter(session => session.id !== targetSession.id));
      }
    } else if (useWorkspaceStore.getState().activeWorkspaceId === connectionWorkspaceId) {
      if (res.error === 'Host denied (verification failed)') {
        setError(t('connect.hostDenied'));
      } else {
        setError(res.error || t('connect.failed'));
      }
    }
  };

  const handleOpenPlugin = (plugin: any) => {
     // Manifests carry `getssh.pluginId` (not `id`); the pane needs a URL the getssh-plugin:// handler can serve.
     const pluginId: string | undefined = plugin?.getssh?.pluginId ?? plugin?.id ?? plugin?.name;
     if (!pluginId) return;
     const title = plugin.getssh?.name || plugin.displayName || plugin.name || plugin.title || 'Plugin';
     const pluginDir = typeof plugin.localPath === 'string' ? plugin.localPath.split(/[\\/]/).filter(Boolean).pop() : plugin.name;
     const pluginUrl = pluginDir && typeof plugin.main === 'string' && /\.html?$/i.test(plugin.main)
       ? `getssh-plugin://${pluginDir}/${plugin.main.replace(/^\.?\/+/, '')}`
       : undefined;
     const config = pluginUrl ? { pluginId, pluginUrl } : { pluginId };

     const { tabs, activeTabId, activePaneId } = useSessionStore.getState();
     const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
     const existingTab = tabs.find(t => (t.workspaceId ?? workspaceId) === workspaceId && t.config && 'pluginId' in t.config && t.config.pluginId === pluginId);
     if (existingTab) {
       setActiveTabId(existingTab.id);
       return;
     }

     const currentTab = tabs.find(t => t.id === activeTabId);
     let targetPaneId: string | null = null;
     if (currentTab && currentTab.paneTree) {
        if (activePaneId) {
            const activeLeaf = findLeaf(currentTab.paneTree, activePaneId);
            if (activeLeaf && activeLeaf.paneType === 'welcome') targetPaneId = activeLeaf.paneId;
        }
        if (!targetPaneId) {
            const welcomeLeaf = findWelcomePane(currentTab.paneTree);
            if (welcomeLeaf) targetPaneId = welcomeLeaf.paneId;
        }
     }

     if (targetPaneId) {
       setTabs(tabs.map(t => {
         if (t.id !== activeTabId || !t.paneTree) return t;
         return {
           ...t,
           workspaceId,
           paneTree: updateLeafInTree(t.paneTree, targetPaneId!, { paneType: 'plugin', sessionId: null, config }),
         };
       }));
       void callNexus('replace pane with plugin', window.electronAPI.nexusReplacePane(targetPaneId, 'plugin', null, JSON.stringify(stripConnectionSecrets(config))));
     } else {
       const newTabId = `plugin-${pluginId}-${Date.now()}`;
       const newPaneId = `pane-${Date.now()}`;
       setTabs([...tabs, {
         id: newTabId,
         title,
         config,
         workspaceId,
         paneTree: { type: 'leaf', paneId: newPaneId, paneType: 'plugin', sessionId: null, config }
       }]);
       setActiveTabId(newTabId);
       void callNexus('register plugin tab', window.electronAPI.nexusRegisterTab(newTabId, newPaneId, "", 'plugin', JSON.stringify(stripConnectionSecrets(config)), title, workspaceId));
     }
  };

  // nexus-core owns the layout: it creates the new welcome leaf and broadcasts the tree.
  // The user then connects inside that leaf (handleConnect replaces it).
  const splitPane = async (paneId: string, direction: 'hsplit' | 'vsplit'): Promise<void> => {
    const res = await callNexus('split pane', window.electronAPI.nexusSplit(paneId, direction === 'hsplit' ? 'horizontal' : 'vertical'));
    if (!res.success || !res.newPaneId) {
      const reason = res.error || 'unknown';
      const message = reason === 'max_panes' ? t('pane.splitMaxPanes', 'A tab can hold at most 4 panes')
        : reason === 'direction_not_allowed' ? t('pane.splitDirectionNotAllowed', 'This pane cannot be split in that direction')
        : reason === 'nexus_core_unavailable' ? t('pane.layoutEngineUnavailable', 'Pane layout engine is unavailable')
        : t('pane.splitFailed', { defaultValue: 'Split failed: {{reason}}', reason });
      useAppStore.getState().addToast(message, 'error');
      return;
    }
    // The invoke reply can overtake the sync broadcast; pull the tab so the new pane exists before focusing it.
    if (res.tabId) {
      const snapshot = await window.electronAPI.nexusGetTab(res.tabId).catch(() => null);
      if (snapshot) useSessionStore.getState().syncNexusTree(snapshot);
    }
    const state = useSessionStore.getState();
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    if (activeTab?.paneTree && findLeaf(activeTab.paneTree, res.newPaneId)) state.setActivePaneId(res.newPaneId);
  };

  return {
    syncProfiles,
    handleSetup,
    handleUnlock,
    deleteSession,
    toggleAutoStart,
    handleConnect,
    handleOpenPlugin,
    splitPane
  };
};
