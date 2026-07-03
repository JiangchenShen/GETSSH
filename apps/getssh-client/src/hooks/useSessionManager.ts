import { useTranslation } from 'react-i18next';
import { useSessionStore, PaneLeaf } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';
import { useCryptoStore } from '../store/cryptoStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { findLeaf, findWelcomePane, updateLeafInTree } from '../utils/paneHelpers';

export const useSessionManager = () => {
  const { t } = useTranslation();

  const sessions = useSessionStore(state => state.sessions);
  const setSessions = useSessionStore(state => state.setSessions);
  const selectedSessionIndex = useSessionStore(state => state.selectedSessionIndex);
  const setSelectedSessionIndex = useSessionStore(state => state.setSelectedSessionIndex);
  const activeTabId = useSessionStore(state => state.activeTabId);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);
  const activePaneId = useSessionStore(state => state.activePaneId);
  const setActivePaneId = useSessionStore(state => state.setActivePaneId);
  const tabs = useSessionStore(state => state.tabs);
  const setTabs = useSessionStore(state => state.setTabs);
  const setConnecting = useSessionStore(state => state.setConnecting);
  const setError = useSessionStore(state => state.setError);

  const appConfig = useAppStore(state => state.appConfig);
  const masterPassword = useCryptoStore(state => state.masterPassword);
  const setMasterPassword = useCryptoStore(state => state.setMasterPassword);
  const encryptionDisabled = useCryptoStore(state => state.encryptionDisabled);
  const setCryptoMode = useCryptoStore(state => state.setCryptoMode);

  const syncProfiles = async (updatedSessions: any[]) => {
    setSessions(updatedSessions);
    if (masterPassword || encryptionDisabled) {
      await window.electronAPI.saveProfiles({ masterPassword: encryptionDisabled ? '' : masterPassword, payload: updatedSessions });
    } else {
      setCryptoMode('setup');
    }
  };

  const handleSetup = async (pwd: string) => {
    setMasterPassword(pwd);
    await window.electronAPI.saveProfiles({ masterPassword: pwd, payload: sessions });
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

  const deleteSession = (e: React.MouseEvent, targetSession: any) => {
    e.stopPropagation();
    const index = sessions.findIndex(s => s === targetSession);
    if (index === -1) return;
    const confirmed = window.confirm(t('common.confirmDelete'));
    if (!confirmed) return;
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

    const config = { 
        host: targetSession.host, 
        username: targetSession.username, 
        password: targetSession.password, 
        privateKeyPath: targetSession.privateKeyPath,
        port: targetSession.port || appConfig.defaultPort || 22,
        keepaliveInterval: targetSession.useKeepAlive !== false ? (appConfig.keepalive * 1000) : 0,
        protocol: targetSession.protocol,
        proxyType: appConfig.proxyType,
        proxyHost: appConfig.proxyHost,
        proxyPort: appConfig.proxyPort,
        initScript: appConfig.initScript
    };
    
    const payload = { ...config, enableAuditLogging: appConfig.enableAuditLogging };
    const res = await window.electronAPI.sshConnect(payload);
    setConnecting(false);

    if (res.success && res.sessionId) {
      const tabTitle = targetSession.alias || `${config.username}@${config.host}`;
      const rootPaneId = res.sessionId;
      const paneTree: PaneLeaf = { type: 'leaf', paneId: rootPaneId, paneType: 'terminal', sessionId: res.sessionId, config };

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
          return { ...t, paneTree: updateLeafInTree(t.paneTree, targetPaneId!, { paneType: 'terminal', sessionId: res.sessionId, config }) };
        }));
        try {
            await window.electronAPI.nexusReplacePane(targetPaneId, 'terminal', res.sessionId, JSON.stringify(config));
        } catch (e) {
            console.error('[Stateless UI] Failed to replace pane in Rust:', e);
        }
      } else {
        setTabs([...tabs, { id: res.sessionId, title: tabTitle, config, paneTree }]);
        setActiveTabId(res.sessionId);
        setActivePaneId(rootPaneId);
        setSelectedSessionIndex(null);
        try {
            await window.electronAPI.nexusRegisterTab(res.sessionId, rootPaneId, res.sessionId, 'terminal', JSON.stringify(config), tabTitle);
        } catch (e) {
            console.error('[Stateless UI] Failed to register tab in Rust:', e);
        }
      }
    } else {
      if (res.error === 'Host denied (verification failed)') {
        setError(t('connect.hostDenied'));
      } else {
        setError(res.error || t('connect.failed'));
      }
    }
  };

  const handleOpenPlugin = (plugin: any) => {
     const pluginId = plugin.id;
     const title = plugin.name || plugin.title || 'Plugin';
     const existingTab = tabs.find(t => t.config && (t.config as any).pluginId === pluginId);
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
         return { ...t, paneTree: updateLeafInTree(t.paneTree, targetPaneId!, { paneType: 'plugin', sessionId: null, config: { pluginId } }) };
       }));
       window.electronAPI.nexusReplacePane(targetPaneId, 'plugin', null, JSON.stringify({ pluginId })).catch(e => {
         console.error('[Stateless UI] Failed to replace pane to plugin in Rust:', e);
       });
     } else {
       const newTabId = `plugin-${pluginId}-${Date.now()}`;
       const newPaneId = `pane-${Date.now()}`;
       setTabs([...tabs, {
         id: newTabId,
         title,
         config: { pluginId },
         paneTree: { type: 'leaf', paneId: newPaneId, paneType: 'plugin', sessionId: null, config: { pluginId } }
       }]);
       setActiveTabId(newTabId);
       window.electronAPI.nexusRegisterTab(newTabId, newPaneId, "", 'plugin', JSON.stringify({ pluginId }), title).catch(e => {
         console.error('[Stateless UI] Failed to register plugin tab in Rust:', e);
       });
     }
  };

  const splitPane = async (paneId: string, direction: 'hsplit' | 'vsplit', config: any) => {
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (!currentTab || !currentTab.paneTree) return;

    try {
        const res = await window.electronAPI.sshConnect({ ...config, enableAuditLogging: appConfig.enableAuditLogging });
        if (res.success && res.sessionId) {
            const newPaneId = res.sessionId;
            const newLeaf: PaneLeaf = { type: 'leaf', paneId: newPaneId, paneType: 'terminal', sessionId: res.sessionId, config };
            
            const splitNode = (node: any): any => {
                if (node.type === 'leaf' && node.paneId === paneId) {
                    return {
                        type: 'split',
                        paneId: `split-${Date.now()}`,
                        direction,
                        children: [node, newLeaf],
                        sizes: [50, 50]
                    };
                }
                if (node.type === 'split') {
                    return { ...node, children: node.children.map(splitNode) };
                }
                return node;
            };

            const updatedTree = splitNode(currentTab.paneTree);
            setTabs(tabs.map(t => t.id === activeTabId ? { ...t, paneTree: updatedTree } : t));
            setActivePaneId(newPaneId);

            await window.electronAPI.nexusSplit(paneId, direction === 'hsplit' ? 'horizontal' : 'vertical').catch(() => {});
        } else {
            setError(res.error || 'Split connection failed');
        }
    } catch (e) {
        console.error('[Stateless UI] Split Pane failed:', e);
    }
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
