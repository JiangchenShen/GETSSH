import React, { useState, useEffect, useRef } from 'react';
import { Terminal as TerminalComponent } from './components/Terminal';
import { TerminalPaneRenderer } from './components/TerminalPane';
import { Monitor, X } from 'lucide-react';
import { SFTPManager } from './components/SFTPManager';
import { useAppStore } from './store/appStore';
import { Tab, PaneNode, PaneLeaf, useSessionStore } from './store/sessionStore';
import { usePanelStore } from './store/panelStore';
import { SplitPane } from './components/SplitPane';
import { TabBar } from './components/TabBar';
import { EmptyState } from './components/EmptyState';
import { initPluginBridge, bootSandboxedPlugins } from './plugins/PluginBridge';
import { useTranslation } from 'react-i18next';
import { Sidebar } from './components/Sidebar';
import { CryptoModal } from './components/CryptoModal';
import { ConnectForm } from './components/ConnectForm';
import { SettingsView } from './components/SettingsView';
// Types re-exported from stores for backward compatibility
export type { AppConfig } from './store/appStore';

function App() {
  const { t, i18n } = useTranslation();

  // Session Store (Zustand)
  const sessions = useSessionStore(state => state.sessions);
  const setSessions = useSessionStore(state => state.setSessions);
  const tabs = useSessionStore(state => state.tabs);
  const setTabs = useSessionStore(state => state.setTabs);
  const activeTabId = useSessionStore(state => state.activeTabId);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);
  const setActivePaneId = useSessionStore(state => state.setActivePaneId);
  const selectedSessionIndex = useSessionStore(state => state.selectedSessionIndex);
  const setSelectedSessionIndex = useSessionStore(state => state.setSelectedSessionIndex);
  const connecting = useSessionStore(state => state.connecting);
  const setConnecting = useSessionStore(state => state.setConnecting);
  const error = useSessionStore(state => state.error);
  const setError = useSessionStore(state => state.setError);
  const closeTab = useSessionStore(state => state.closeTab);

  // App Store (Zustand)
  const appConfig = useAppStore(state => state.appConfig);
  const isDark = useAppStore(state => state.isDark);
  const systemIsDark = useAppStore(state => state.systemIsDark);
  const isAppBlurred = useAppStore(state => state.isAppBlurred);
  const setSystemIsDark = useAppStore(state => state.setSystemIsDark);
  const setIsAppBlurred = useAppStore(state => state.setIsAppBlurred);
  const loadStoredConfig = useAppStore(state => state.loadStoredConfig);
  const syncConfigEffects = useAppStore(state => state.syncConfigEffects);
  
  // Settings modal state
  const [settingsActiveTab, setSettingsActiveTab] = useState<'Appearance'|'Terminal'|'SSH'|'System'|'Security'|'Plugins'|'About'>('Appearance');
  
  const openSettingsTab = (tab: 'Appearance'|'Terminal'|'SSH'|'System'|'Security'|'Plugins'|'About' = 'Appearance') => {
     setSettingsActiveTab(tab);
     setSelectedSessionIndex(null);
     if (!tabs.find(t => t.id === 'settings')) {
         setTabs([...tabs, { id: 'settings', title: t('settings.title'), config: { isSettings: true } as any }]);
     }
     setActiveTabId('settings');
  };

  const hasAutoStarted = useRef(false);

  // Crypto State
  const [cryptoMode, setCryptoMode] = useState<'idle' | 'locked' | 'setup'>('idle');
  const [masterPassword, setMasterPassword] = useState('');
  const [encryptionDisabled, setEncryptionDisabled] = useState(false);

  const setUpdateAvailable = useAppStore(state => state.setUpdateAvailable);
  const updateAvailable = useAppStore(state => state.updateAvailable);
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onUpdateAvailable) {
      const unsub = window.electronAPI.onUpdateAvailable((info) => {
        setUpdateAvailable(info);
      });
      return unsub;
    }
  }, []);

  useEffect(() => {
    const bootCrypto = async () => {
       const status = await window.electronAPI.checkProfiles();
       if (status === 'encrypted') {
          setEncryptionDisabled(false);
          // Render the modal first to blur the background, then prompt biometric
          setCryptoMode('locked');
          const bioRes = await window.electronAPI.promptBiometricUnlock();
          if (bioRes.success && bioRes.masterPassword) {
            try {
               const decrypted = await window.electronAPI.unlockProfiles(bioRes.masterPassword);
               setMasterPassword(bioRes.masterPassword);
               setSessions(decrypted);
               setCryptoMode('idle');
               return; // Successfully unlocked biometrically
            } catch (e) {
               console.warn('Biometric unlock failed to decrypt:', e);
            }
          }
          // If biometric fails, modal is already shown for manual entry fallback.
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

    loadStoredConfig();

    // Boot Plugins in Sandbox (secure)
    const cleanupPluginBridge = initPluginBridge();
    bootSandboxedPlugins().catch(e => console.error('Failed to boot plugins:', e));

    // Register core panels in the dynamic panel engine
    usePanelStore.getState().registerPanel({
      id: 'sftp',
      title: 'SFTP Manager',
      component: SFTPManager,
      position: 'bottom',
      defaultSize: 280,
      minSize: 180,
      maxSize: 520,
    });

    // Init Theme Sync
    let unsubTheme: (() => void) | undefined;
    let unsubBlur: (() => void) | undefined;
    let unsubFocus: (() => void) | undefined;
    if (window.electronAPI && window.electronAPI.getTheme) {
      window.electronAPI.getTheme().then(setSystemIsDark);
      unsubTheme = window.electronAPI.onThemeChanged(setSystemIsDark);
      
      if (window.electronAPI.onAppBlur) {
        unsubBlur = window.electronAPI.onAppBlur(() => setIsAppBlurred(true));
        unsubFocus = window.electronAPI.onAppFocus(() => setIsAppBlurred(false));
      }
    }
    
    return () => {
      if (unsubTheme) unsubTheme();
      if (unsubBlur) unsubBlur();
      if (unsubFocus) unsubFocus();
      if (cleanupPluginBridge) cleanupPluginBridge();
    };
  }, []); // Run ONCE on mount

  // Watch i18n & Theme Color
  useEffect(() => {
    i18n.changeLanguage(appConfig.language);
    document.documentElement.style.setProperty('--primary-color', appConfig.themeColor);
  }, [appConfig.language, appConfig.themeColor]);

  // Auto-Start trigger
  useEffect(() => {
    if (sessions.length > 0 && !hasAutoStarted.current) {
        hasAutoStarted.current = true;
        const autoSessions = sessions.filter(s => s.autoStart);
        autoSessions.forEach(autoSession => {
            const config = { 
                host: autoSession.host, 
                username: autoSession.username, 
                password: autoSession.password, 
                privateKeyPath: autoSession.privateKeyPath,
                port: autoSession.port || appConfig.defaultPort || 22,
                keepaliveInterval: appConfig.keepalive * 1000,
                // Append Proxy
                proxyType: appConfig.proxyType,
                proxyHost: appConfig.proxyHost,
                autoStart: autoSession.autoStart,
                initScript: appConfig.initScript
            };
            
            window.electronAPI.sshConnect(config).then(res => {
               if (res.success && res.sessionId) {
                 const tabTitle = `${config.username}@${config.host}`;
                 setTabs([...tabs, { id: res.sessionId as string, title: tabTitle, config }]);
                 setActiveTabId(res.sessionId);
                 if (config.initScript && res.sessionId) {
                     const sessionId = res.sessionId;
                     setTimeout(() => {
                        window.electronAPI.sshWrite(sessionId, config.initScript + '\n');
                     }, 1500); // Allow shell load buffer
                 }
               }
            });
        });
    }
  }, [sessions, appConfig]);

  // Sync config effect
  useEffect(() => {
    syncConfigEffects();
  }, [appConfig, systemIsDark, syncConfigEffects]);

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
  };

  const handleUnlock = async (pwd: string) => {
     try {
       const decrypted = await window.electronAPI.unlockProfiles(pwd);
       setMasterPassword(pwd);
       setSessions(decrypted);
       setCryptoMode('idle');
       return true;
     } catch (e) {
       return false;
     }
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
        proxyType: appConfig.proxyType,
        proxyHost: appConfig.proxyHost,
        proxyPort: appConfig.proxyPort,
        initScript: appConfig.initScript
    };
    
    const res = await window.electronAPI.sshConnect(config);
    setConnecting(false);

    if (res.success && res.sessionId) {
      const tabTitle = `${config.username}@${config.host}`;
      const rootPaneId = res.sessionId;
      const paneTree: PaneLeaf = { type: 'leaf', paneId: rootPaneId, paneType: 'terminal', sessionId: res.sessionId, config };
      setTabs([...tabs, { id: res.sessionId, title: tabTitle, config, paneTree }]);
      setActiveTabId(res.sessionId);
      setActivePaneId(rootPaneId);
      setSelectedSessionIndex(null);
    } else {
      setError(res.error || 'Connection failed');
    }
  };

  const deleteSession = (e: React.MouseEvent, targetHost: string, targetUser: string) => {
    e.stopPropagation();
    const targetIdx = sessions.findIndex(s => s.host === targetHost && s.username === targetUser);
    if (selectedSessionIndex === targetIdx) setSelectedSessionIndex(null);
    else if (selectedSessionIndex !== null && selectedSessionIndex > targetIdx) setSelectedSessionIndex(selectedSessionIndex - 1);

    const updated = sessions.filter(s => s.host !== targetHost || s.username !== targetUser);
    syncProfiles(updated);
  };
  
  const toggleAutoStart = (e: React.MouseEvent, targetHost: string, targetUser: string) => {
    e.stopPropagation();
    const updated = sessions.map(s => {
       if(s.host === targetHost && s.username === targetUser) return { ...s, autoStart: !s.autoStart };
       return s;
    });
    syncProfiles(updated);
  };
  
  const handleReconnect = async (tab: Tab) => {
    const res = await window.electronAPI.sshConnect(tab.config);
    if (res.success && res.sessionId) {
      // For legacy tabs without paneTree, also rebuild a leaf
      const paneTree: PaneLeaf = { type: 'leaf', paneId: res.sessionId, paneType: 'terminal', sessionId: res.sessionId, config: tab.config };
      setTabs(tabs.map(t => t.id === tab.id ? { ...t, id: res.sessionId as string, paneTree } : t));
      if (activeTabId === tab.id) {
        setActiveTabId(res.sessionId as string);
        setActivePaneId(res.sessionId as string);
      }
    } else {
      window.alert(`Reconnect failed: ${res.error}`);
    }
  };

  // ── Split Pane Logic ──────────────────────────────────────────────────

  /** Insert a new split into the tree at the target pane, rendering a welcome screen */
  const splitPane = async (paneId: string, direction: 'hsplit' | 'vsplit') => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab?.paneTree) return;

    const newPaneId = `pane-${Date.now()}`;
    const newLeaf: PaneLeaf = { type: 'leaf', paneId: newPaneId, paneType: 'welcome', sessionId: null, config: null };

    setTabs(tabs.map(t => {
      if (t.id !== activeTabId || !t.paneTree) return t;
      return { ...t, paneTree: insertSplit(t.paneTree, paneId, direction, newLeaf) };
    }));
    setActivePaneId(newPaneId);
  };

  /** Connect a session within an existing Welcome pane */
  const connectInPane = async (paneId: string, targetSession: any) => {
    setConnecting(true);
    setError(null);
    const config = { 
        host: targetSession.host, 
        username: targetSession.username, 
        password: targetSession.password, 
        privateKeyPath: targetSession.privateKeyPath,
        port: targetSession.port || appConfig.defaultPort || 22,
        keepaliveInterval: targetSession.useKeepAlive !== false ? (appConfig.keepalive * 1000) : 0,
        proxyType: appConfig.proxyType,
        proxyHost: appConfig.proxyHost,
        proxyPort: appConfig.proxyPort,
        initScript: appConfig.initScript
    };
    
    const res = await window.electronAPI.sshConnect(config);
    setConnecting(false);

    if (res.success && res.sessionId) {
      setTabs(tabs.map(t => {
        if (t.id !== activeTabId || !t.paneTree) return t;
        return { ...t, paneTree: updateLeafInTree(t.paneTree, paneId, { paneType: 'terminal', sessionId: res.sessionId, config }) };
      }));
    } else {
      window.alert(`Connection failed: ${res.error}`);
    }
  };

  /** Close a pane; if it's the last pane, close the entire tab */
  const closePaneInTab = (paneId: string) => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab?.paneTree) return;

    // Find session to disconnect
    const leaf = findLeaf(tab.paneTree, paneId);
    if (leaf && leaf.sessionId) window.electronAPI.sshDisconnect(leaf.sessionId);

    // If this is the ONLY pane in the tree, we convert it to welcome pane instead of closing the tab
    if (tab.paneTree.type === 'leaf' && tab.paneTree.paneId === paneId) {
      setTabs(tabs.map(t => {
        if (t.id === activeTabId) {
          return {
            ...t,
            paneTree: { ...tab.paneTree, paneType: 'welcome', sessionId: null, config: null } as PaneLeaf
          };
        }
        return t;
      }));
      return; // Stop here, do not remove the tab
    }

    const newTree = removePane(tab.paneTree, paneId);
    if (!newTree) {
      // Last pane → close the whole tab
      closeTab(tab.id);
      return;
    }

    setTabs(tabs.map(t => t.id === activeTabId ? { ...t, paneTree: newTree } : t));

    // Focus first remaining leaf
    const firstLeaf = findFirstLeaf(newTree);
    if (firstLeaf) setActivePaneId(firstLeaf.paneId);
  };

  // Dynamic Backdrop Opacity Color
  const appBgStyle = {
      backgroundColor: isDark 
        ? `rgba(0, 0, 0, ${appConfig.bgOpacity})` 
        : `rgba(255, 255, 255, ${appConfig.bgOpacity})`
  };

  return (
    <div 
      onContextMenu={(e) => {
        e.preventDefault();
        window.electronAPI.showContextMenu();
      }}
      className={`h-screen w-screen flex backdrop-blur-xl relative overflow-hidden transition-all ${isDark ? 'text-gray-100' : 'text-gray-900'} ${isAppBlurred && appConfig.privacyMode ? 'blur-2xl brightness-50 pointer-events-none' : ''}`} style={appBgStyle}>
      {(cryptoMode === 'locked' || cryptoMode === 'setup') && (
        <CryptoModal 
          mode={cryptoMode} 
          isDark={isDark} 
          onUnlock={handleUnlock} 
          onSetup={handleSetup}
          onSkip={cryptoMode === 'setup' ? () => {
            // Skip this time — modal will show again next time a new session is added
            setCryptoMode('idle');
          } : undefined}
          onCancel={cryptoMode === 'setup' && sessions.length === 0 && !masterPassword ? undefined : () => {
              if (cryptoMode === 'setup') {
                 setEncryptionDisabled(true);
                 window.electronAPI.saveProfiles({ masterPassword: '', payload: sessions });
              }
              setCryptoMode('idle');
          }}
          onRetryBiometric={async () => {
             const bioRes = await window.electronAPI.promptBiometricUnlock();
             if (bioRes.success && bioRes.masterPassword) {
               try {
                  const decrypted = await window.electronAPI.unlockProfiles(bioRes.masterPassword);
                  setMasterPassword(bioRes.masterPassword);
                  setSessions(decrypted);
                  setCryptoMode('idle');
               } catch (e) {
                  console.warn('Biometric unlock failed on manual retry:', e);
               }
             }
          }}
        />
      )}
      <div className="absolute top-0 left-0 right-0 h-8 z-[100] flex items-center justify-center text-xs opacity-50 font-medium pointer-events-none pr-[120px]" style={{ WebkitAppRegion: 'drag', pointerEvents: 'auto' } as React.CSSProperties & { WebkitAppRegion?: string }}>
         GETSSH
      </div>

      {/* Left Sidebar */}
      <Sidebar 
        onAddSession={() => {
          const newSession = { host: '', username: '', password: '', privateKeyPath: '', autoStart: false };
          const updated = [...sessions, newSession];
          syncProfiles(updated);
          setSelectedSessionIndex(updated.length - 1);
          setActiveTabId(null);
        }}
        onToggleAutoStart={toggleAutoStart}
        onDeleteSession={deleteSession}
        openSettingsTab={openSettingsTab}
        settingsActiveTab={settingsActiveTab}
      />

      {/* Main Area - Switch Mode */}
      <div className="flex-1 flex flex-col overflow-hidden pt-8">

        {/* Tab Bar - Extracted Component */}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          isDark={isDark}
          onSelectTab={(tabId) => { setActiveTabId(tabId); setSelectedSessionIndex(null); }}
          onCloseTab={closeTab}
        />

        {/* Settings Panel */}
        <div style={{ display: (activeTabId === 'settings' && selectedSessionIndex === null) ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
           <SettingsView 
             settingsActiveTab={settingsActiveTab}
             setSettingsActiveTab={setSettingsActiveTab}
             masterPassword={masterPassword}
             setMasterPassword={setMasterPassword}
             encryptionDisabled={encryptionDisabled}
             setEncryptionDisabled={setEncryptionDisabled}
           />
        </div>

        {/* Connect Form - always mounted, shown via CSS */}
        <div
          className="flex-1 flex items-center justify-center p-8 overflow-y-auto"
          style={{ display: (selectedSessionIndex !== null && sessions[selectedSessionIndex] && activeTabId !== 'settings') ? 'flex' : 'none' }}
        >
          {selectedSessionIndex !== null && sessions[selectedSessionIndex] && (
            <ConnectForm
              session={sessions[selectedSessionIndex]}
              index={selectedSessionIndex}
              appConfig={appConfig}
              isDark={isDark}
              connecting={connecting}
              error={error}
              onConnect={handleConnect}
              onUpdateSession={(index, updatedSession) => {
                const u = [...sessions];
                u[index] = updatedSession;
                syncProfiles(u);
              }}
            />
          )}
        </div>

        {/* Terminals area with pane tree renderer */}
        <div
          className={`flex-1 flex overflow-hidden ${isDark ? 'bg-black/40' : 'bg-white/60'}`}
          style={{ display: (tabs.filter(t => t.id !== 'settings').length > 0 && selectedSessionIndex === null && activeTabId && activeTabId !== 'settings') ? 'flex' : 'none' }}
        >
          <SplitPane isDark={isDark} activeTabId={activeTabId}>
            <div className="absolute inset-0">
              {tabs.filter(t => t.id !== 'settings').map(tab => (
                <div key={tab.id} className={`absolute inset-0 flex ${activeTabId === tab.id ? 'z-10' : '-z-10 opacity-0 pointer-events-none'}`}>
                  {tab.paneTree ? (
                    <TerminalPaneRenderer
                      node={tab.paneTree}
                      tabId={tab.id}
                      appConfig={appConfig}
                      isDark={isDark}
                      isTabActive={activeTabId === tab.id}
                      onSplit={splitPane}
                      onClosePane={closePaneInTab}
                      onConnectInPane={connectInPane}
                      sessions={sessions}
                    />
                  ) : (
                    /* Legacy fallback for tabs without paneTree */
                    <TerminalComponent
                      sessionId={tab.id}
                      onDisconnected={() => {}}
                      onReconnect={() => handleReconnect(tab)}
                      config={appConfig}
                      isDark={isDark}
                      isActive={activeTabId === tab.id}
                    />
                  )}
                </div>
              ))}
            </div>
          </SplitPane>
        </div>

        {/* Empty State */}
        <div style={{ display: (selectedSessionIndex === null && !activeTabId) ? 'flex' : 'none' }} className="flex-1">
          <EmptyState />
        </div>

      </div>

      {/* Update Toast Notification */}
      {updateAvailable && (
        <div className={`absolute bottom-6 right-6 p-4 rounded-xl shadow-2xl border flex flex-col gap-3 z-[200] max-w-sm animate-in slide-in-from-bottom-5 fade-in duration-300 ${isDark ? 'bg-[#2a2a2a] border-white/10 text-white' : 'bg-white border-black/10 text-black'}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0">
                <Monitor className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-sm">GETSSH {updateAvailable.version} 已发布！</h4>
                <p className="text-xs opacity-70 mt-0.5">有新版本可供升级，体验最新特性与修复。</p>
              </div>
            </div>
            <button onClick={() => setUpdateAvailable(null)} className="opacity-50 hover:opacity-100 p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setUpdateAvailable(null)} className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-all ${isDark ? 'border-white/20 hover:bg-white/10 text-white/70 hover:text-white' : 'border-black/20 hover:bg-black/5 text-black/70 hover:text-black'}`}>暂不更新</button>
            <button onClick={() => { window.electronAPI.openExternal(updateAvailable.url); setUpdateAvailable(null); }} className="flex-1 py-1.5 text-xs font-medium rounded-lg bg-primary hover:bg-primary/80 text-white shadow-md shadow-primary/20 transition-all">立即下载</button>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Pane Tree Helpers (module-level, no hooks) ────────────────────────────

function findLeaf(node: PaneNode, paneId: string): PaneLeaf | null {
  if (node.type === 'leaf') return node.paneId === paneId ? node : null;
  return findLeaf(node.children[0], paneId) ?? findLeaf(node.children[1], paneId);
}

function updateLeafInTree(node: PaneNode, targetPaneId: string, updates: Partial<PaneLeaf>): PaneNode {
  if (node.type === 'leaf') {
    if (node.paneId === targetPaneId) {
      return { ...node, ...updates } as PaneLeaf;
    }
    return node;
  }
  return {
    ...node,
    children: [
      updateLeafInTree(node.children[0], targetPaneId, updates),
      updateLeafInTree(node.children[1], targetPaneId, updates),
    ] as [PaneNode, PaneNode],
  };
}

function findFirstLeaf(node: PaneNode): PaneLeaf | null {
  if (node.type === 'leaf') return node;
  return findFirstLeaf(node.children[0]);
}

function insertSplit(
  node: PaneNode,
  targetPaneId: string,
  direction: 'hsplit' | 'vsplit',
  newLeaf: PaneLeaf,
): PaneNode {
  if (node.type === 'leaf') {
    if (node.paneId !== targetPaneId) return node;
    return {
      type: direction,
      paneId: `split-${targetPaneId}-${newLeaf.paneId}`,
      children: [node, newLeaf],
      sizes: [50, 50],
    };
  }
  return {
    ...node,
    children: [
      insertSplit(node.children[0], targetPaneId, direction, newLeaf),
      insertSplit(node.children[1], targetPaneId, direction, newLeaf),
    ] as [PaneNode, PaneNode],
  };
}

/** Remove a pane from the tree; returns null if the tree becomes empty */
function removePane(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === 'leaf') return node.paneId === paneId ? null : node;

  const left  = removePane(node.children[0], paneId);
  const right = removePane(node.children[1], paneId);

  if (!left && !right) return null;
  if (!left)  return right;
  if (!right) return left;

  return { ...node, children: [left, right] };
}

export default App;
