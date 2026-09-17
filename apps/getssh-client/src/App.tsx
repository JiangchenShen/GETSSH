import React, { useState, useEffect, useRef } from 'react';
import { TerminalPaneRenderer } from './components/TerminalPane';
import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';

// Stores
import { useAppStore } from './store/appStore';
import { PaneNode, PaneLeaf, useSessionStore } from './store/sessionStore';
import { Runbook } from './store/workspaceStore';

// Hooks
import { useAppBoot } from './hooks/useAppBoot';
import { useAppEvents } from './hooks/useAppEvents';
import { useCoreAppEvents } from './hooks/useCoreAppEvents';
import { useCryptoBoot } from './hooks/useCryptoBoot';
import { useAutoStart } from './hooks/useAutoStart';
import { useSessionManager } from './hooks/useSessionManager';


// Components
import { GlobalWorkspaceBar } from './components/GlobalWorkspaceBar';
import { ContextSidebar } from './components/ContextSidebar';
import { NexusDashboard } from './components/NexusDashboard';
import { CreateWorkspaceModal } from './components/CreateWorkspaceModal';
import { AiCenter } from './components/AiCenter';
import { UnlockVaultModal } from './components/UnlockVaultModal';
import { CryptoModal } from './components/CryptoModal';
import { HostKeyVerificationModal } from './components/HostKeyVerificationModal';
import { TabBar } from './components/TabBar';
import { CommandCenter } from './components/CommandCenter';
import { ToastProvider } from './components/ToastProvider';
import { IpcManager } from './components/IpcManager';
import { StatusBar } from './components/StatusBar';

// Overlays
import { UpdateToastOverlay } from './components/app-overlays/UpdateToastOverlay';
import { ConnectFormOverlay } from './components/app-overlays/ConnectFormOverlay';
import { GlobalBootLockOverlay } from './components/app-overlays/GlobalBootLockOverlay';

const DASHBOARD_EASE = [0.33, 1, 0.68, 1] as const;

export type { AppConfig } from './store/appStore';

function App() {
  const { t, i18n } = useTranslation();

  // Boot Application & Bind IPC / Window Events
  useAppBoot();
  useAppEvents();

  // Session
  const sessions = useSessionStore(state => state.sessions);
  const tabs = useSessionStore(state => state.tabs);
  const closeTab = useSessionStore(state => state.closeTab);
  const activeTabId = useSessionStore(state => state.activeTabId);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);
  const selectedSessionIndex = useSessionStore(state => state.selectedSessionIndex);
  const setSelectedSessionIndex = useSessionStore(state => state.setSelectedSessionIndex);
  const activePaneId = useSessionStore(state => state.activePaneId);
  const connecting = useSessionStore(state => state.connecting);
  const error = useSessionStore(state => state.error);

  // App
  const appConfig = useAppStore(state => state.appConfig);
  const isDark = useAppStore(state => state.isDark);
  const isMac = useAppStore(state => state.isMac);
  const isFullScreen = useAppStore(state => state.isFullScreen);
  const isAppBlurred = useAppStore(state => state.isAppBlurred);
  const isCommandCenterOpen = useAppStore(state => state.isCommandCenterOpen);
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
  const isAiCenterOpen = useAppStore(state => state.isAiCenterOpen);
  const isSidebarCollapsed = useAppStore(state => state.isSidebarCollapsed);
  const tornPaneId = useAppStore(state => state.tornPaneId);
  
  // Local State
  const [pendingHighRiskRunbook, setPendingHighRiskRunbook] = useState<Runbook | null>(null);

  let tornNode: PaneLeaf | null = null;
  let tornTabId: string | null = null;
  if (tornPaneId) {
     const traverse = (node: PaneNode, tId: string) => {
        if (node.type === 'leaf' && node.paneId === tornPaneId) {
          tornNode = node as PaneLeaf;
          tornTabId = tId;
        } else if (node.type === 'hsplit' || node.type === 'vsplit') {
          if (node.children[0]) traverse(node.children[0], tId);
          if (node.children[1]) traverse(node.children[1], tId);
        }
     };
     for (const t of tabs) {
       if (t.isTornOff && t.paneTree) traverse(t.paneTree, t.id);
     }
  }



  const handleHomeClick = () => {
    const state = useSessionStore.getState();
    if (state.selectedSessionIndex !== null && state.sessions[state.selectedSessionIndex]?.isDraft) {
      state.setSessions(state.sessions.filter((_, index) => index !== state.selectedSessionIndex));
    }
    setSelectedSessionIndex(null);
    setActiveTabId(null);
  };

  const syncProfilesRef = useRef<any>(null);

  // Crypto Boot Check
  useCryptoBoot();

  // Watch i18n changes
  useEffect(() => {
    i18n.changeLanguage(appConfig.language);
  }, [appConfig.language, i18n]);

  // Sync native window theme for OS Vibrancy (fixing glassmorphism layering issues)
  useEffect(() => {
    if (window.electronAPI?.setTheme) {
      window.electronAPI.setTheme(appConfig.theme);
    }
  }, [appConfig.theme]);

  // Auto-Start trigger
  useAutoStart();

  // Core App Events & Session Management
  const {
    syncProfiles,
    deleteSession,
    toggleAutoStart,
    handleConnect,
    handleOpenPlugin,
    splitPane
  } = useSessionManager();

  syncProfilesRef.current = syncProfiles;

  useCoreAppEvents(setPendingHighRiskRunbook, syncProfiles, handleConnect);

  // Prevent pre-warmed Hollow Windows from rendering heavy UI components (WebGL, TabBar, etc) until they are hijacked.
  // This saves massive amounts of CPU/RAM/GPU and prevents ghost terminals.
  const isHollowPreWarm = new URLSearchParams(window.location.search).get('isHollow') === 'true';
  useEffect(() => {
    (window as any).electronAPI?.hollowLog?.('App.tsx mount! search:', window.location.search, 'isHollowPreWarm:', isHollowPreWarm, 'tornPaneId:', tornPaneId);
  }, [isHollowPreWarm, tornPaneId]);
  if (isHollowPreWarm && !tornPaneId) {
    return (
      <>
        <IpcManager />
        <div className="w-screen h-screen bg-transparent pointer-events-none" />
      </>
    );
  }

  // Global Background & Glassmorphism Logic
  let appBgStyle = { 
    '--titlebar-height': isMac ? '40px' : '32px'
  } as React.CSSProperties;
  let containerClasses = '';

  // 窗口底色就是 --v2-bg（深 #09090b / 浅 #f4f4f5）。导轨、侧栏、主区在原型里
  // 是同一个底色，只靠发丝线分隔，所以它们保持透明，由这里统一上色；
  // 开了毛玻璃就把这层底色调透，让系统 vibrancy 透上来。
  // 文字颜色一律走 text-ink，不再写死 slate/neutral，否则换主题必然漏。
  containerClasses = 'text-ink border-none';
  if (!isDark) {
    const uiOpacity = appConfig.enableGlassmorphism ? (appConfig.bgOpacity ?? 0.8) : 1;
    appBgStyle = { ...appBgStyle, backgroundColor: `rgba(244, 244, 245, ${uiOpacity})` }; // --v2-bg 浅
  } else if (!appConfig.enableGlassmorphism) {
    appBgStyle = { ...appBgStyle, backgroundColor: '#09090b' }; // --v2-bg 深
  } else {
    const uiOpacity = appConfig.bgOpacity ?? 1;
    appBgStyle = { ...appBgStyle, backgroundColor: `rgba(9, 9, 11, ${uiOpacity})` };
  }

  return (
    <>
      <IpcManager />
      <div 
        className={`w-screen h-screen overflow-hidden flex flex-col font-sans transition-all duration-200 ${containerClasses} ${isAppBlurred && appConfig.privacyMode ? 'blur-2xl brightness-50 pointer-events-none' : ''} relative`}
        style={appBgStyle}
      >
        {/* Removed Duo-Tone Ambient Glow to let pure Liquid Glass shine through */}

        <AnimatePresence>
          <GlobalBootLockOverlay />
          {pendingHighRiskRunbook && (
            <motion.div 
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 0.95 }}
               className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm pointer-events-auto"
            >
              <div className="bg-[#1a1a1a] border border-red-500/30 p-8 rounded-xl max-w-md w-full shadow-2xl">
                <h3 className="text-xl font-bold text-red-500 mb-4 flex items-center gap-2">
                  <ShieldAlert className="w-6 h-6 animate-pulse" /> High Risk Operation
                </h3>
                <p className="text-sm text-gray-300 mb-6">You are about to execute a high-risk runbook. Please enter your master password to authorize this action.</p>
                <CryptoModal 
                  mode="locked" 
                  isDark={true}
                  onSetup={async () => {}}
                  onUnlock={async (pwd) => {
                     try {
                        const success = await window.electronAPI.unlockProfiles(pwd);
                        if (!success) return false;
                        
                        const getActiveSessionId = (): string | null => {
                          const state = useSessionStore.getState();
                          if (!state.activeTabId || !state.activePaneId) return null;
                          const tab = state.tabs.find(t => t.id === state.activeTabId);
                          if (!tab || !tab.paneTree) return null;
                          let foundSessionId: string | null = null;
                          const traverse = (node: PaneNode) => {
                            if (node.type === 'leaf') {
                              if (node.paneId === state.activePaneId && node.paneType === 'terminal') foundSessionId = node.sessionId || null;
                            } else if (node.type === 'hsplit' || node.type === 'vsplit') {
                              if (node.children[0]) traverse(node.children[0]);
                              if (node.children[1]) traverse(node.children[1]);
                            }
                          };
                          traverse(tab.paneTree);
                          return foundSessionId;
                        };
                        
                        const sessionId = getActiveSessionId();
                        if (!sessionId) {
                          useAppStore.getState().addToast('未找到活动的终端面板以执行剧本', 'warning');
                        } else {
                          const sanitized = pendingHighRiskRunbook.command.replace(/[\r\n]+/g, ' ').trim();
                          if (window.electronAPI?.sshWrite) {
                            window.electronAPI.sshWrite(sessionId, sanitized);
                            useAppStore.getState().addToast('剧本命令已安全填入终端缓冲', 'success');
                          }
                        }
                        setPendingHighRiskRunbook(null);
                        return true;
                     } catch (e) {
                        console.warn('Unlock failed:', e);
                        return false;
                     }
                  }}
                  onRetryBiometric={async () => {
                     // Fetch decrypted master password (automatically prompts OS TouchID if enabled)

                     const bioRes = await window.electronAPI.promptBiometricUnlock();
                     if (bioRes.success && bioRes.masterPassword) {
                       try {
                          await window.electronAPI.unlockProfiles(bioRes.masterPassword);
                          const getActiveSessionId = (): string | null => {
                            const state = useSessionStore.getState();
                            if (!state.activeTabId || !state.activePaneId) return null;
                            const tab = state.tabs.find(t => t.id === state.activeTabId);
                            if (!tab || !tab.paneTree) return null;
                            let foundSessionId: string | null = null;
                            const traverse = (node: PaneNode) => {
                              if (node.type === 'leaf') {
                                if (node.paneId === state.activePaneId && node.paneType === 'terminal') foundSessionId = node.sessionId;
                              } else {
                                traverse(node.children[0]); traverse(node.children[1]);
                              }
                            };
                            traverse(tab.paneTree);
                            return foundSessionId;
                          };
                          
                          const sessionId = getActiveSessionId();
                          if (!sessionId) {
                            useAppStore.getState().addToast(t('commandCenter.noActiveTerminal', '未找到活动的终端面板以执行剧本'), 'warning');
                          } else {
                            const sanitized = pendingHighRiskRunbook.command.replace(/[\r\n]+/g, ' ').trim();
                            if (window.electronAPI?.sshWrite) {
                              window.electronAPI.sshWrite(sessionId, sanitized);
                              useAppStore.getState().addToast(t('commandCenter.runbookFilled', '剧本命令已安全填入终端缓冲'), 'success');
                            }
                          }
                          setPendingHighRiskRunbook(null);
                       } catch (e) {
                          console.warn('Biometric unlock failed on manual retry:', e);
                       }
                     }
                  }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── STANDARD LOCK SCREEN MOVED TO NEXUS DASHBOARD ── */}
        {/* Main application grid */}
        {tornPaneId ? (
          <div className="w-full h-full bg-transparent flex flex-col no-drag-region">
            {/* Cinematic Torn Title Bar */}
            <div className={`drag-region flex items-center justify-center text-xs opacity-50 font-medium select-none w-full shrink-0 ${isMac ? 'h-10' : 'h-8'}`}>
              <span className="font-bold opacity-30 tracking-widest">{tornTabId ? tabs.find(t => t.id === tornTabId)?.title || 'Torn Terminal' : 'Torn Terminal'}</span>
            </div>
            {/* Edge-to-Edge Terminal Canvas */}
            <div className="flex-1 min-h-0 w-full relative">
              {tornNode && tornTabId ? (
                <TerminalPaneRenderer node={tornNode} tabId={tornTabId} appConfig={appConfig} isDark={isDark} isTabActive={true} onSplit={() => {}} />
              ) : (
                <div className="flex-1 flex items-center justify-center text-white/50 h-full w-full">
                  Loading Torn Pane...
                </div>
              )}
            </div>
          </div>
        ) : (
          <div 
            className="w-full h-full bg-transparent"
            style={{
               display: 'grid',
               gridTemplateColumns: `var(--rail-width) ${isSidebarCollapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)'} 1fr`,
               gridTemplateRows: `${isFullScreen ? '0px' : 'var(--titlebar-height)'} 1fr 0px`,
               zIndex: 'var(--z-app-chrome)'
            }}
          >
          {/* L3 Global Sidebar (Ultra-narrow) */}
          <div style={{ gridColumn: '1 / 2', gridRow: '1 / 4', zIndex: 'var(--z-region-material)' }}>
            <GlobalWorkspaceBar onHomeClick={handleHomeClick} />
          </div>

          {/* Left Sidebar (L4 Region Material, Edge-Flush) */}
          <div style={{ gridColumn: '2 / 3', gridRow: '1 / 4', zIndex: 'var(--z-region-material)', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div className="relative w-full h-full shrink-0 flex flex-col overflow-hidden backdrop-blur-xl">
              <ContextSidebar 
                onAddSession={() => {
                  const existingDraftIndex = sessions.findIndex(session => session.isDraft);
                  if (existingDraftIndex >= 0) {
                    setSelectedSessionIndex(existingDraftIndex);
                    setActiveTabId(null);
                    return;
                  }
                  const newSession = { id: crypto.randomUUID(), isDraft: true, host: '', username: '', password: '', privateKeyPath: '', autoStart: false, protocol: 'auto' as const };
                  const updated = [...sessions, newSession];
                  useSessionStore.getState().setSessions(updated);
                  setSelectedSessionIndex(updated.length - 1);
                  setActiveTabId(null);
                }}
                onToggleAutoStart={toggleAutoStart}
                onDeleteSession={deleteSession}
              />
            </div>
          </div>

            {/* Main Content Area (L5 Content) */}
          <div style={{ gridColumn: '3 / 4', gridRow: '1 / 4', zIndex: 'var(--z-content)' }} className="flex flex-col min-h-0 overflow-hidden relative">
            
            {/* Tab Bar ALWAYS visible if tabs.length > 0 */}
            <TabBar
              tabs={tabs.filter(t => !t.isTornOff)}
              activeTabId={activeTabId}
              onSelectTab={(id) => {
                setActiveTabId(id);
                setSelectedSessionIndex(null);
              }}
              onCloseTab={closeTab}
              onHomeClick={handleHomeClick}
              isHomeActive={selectedSessionIndex === null && !activeTabId}
              onSplit={() => { if (activePaneId) splitPane(activePaneId, 'hsplit', {}); }}
              canSplit={!!activeTabId && !!activePaneId}
            />

            <div className="flex-1 relative flex flex-col min-h-0 overflow-hidden">
              
              {/* Active Terminal Panes */}
              {tabs.filter(t => !t.isTornOff).map((tab) => (
                <div 
                  key={tab.id}
                  className="absolute inset-0 flex flex-col"
                  style={{ display: activeTabId === tab.id ? 'flex' : 'none', zIndex: activeTabId === tab.id ? 10 : 0 }}
                >
                  {tab.paneTree ? (
                    <TerminalPaneRenderer node={tab.paneTree} tabId={tab.id} appConfig={appConfig} isDark={isDark} isTabActive={activeTabId === tab.id} onSplit={(paneId, direction) => splitPane(paneId, direction, {})} />
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-white/50">
                      Waiting for Nexus Core...
                    </div>
                  )}
                </div>
              ))}

              {/* Welcome Dashboard Overlay */}
              <AnimatePresence mode="wait">
                {(selectedSessionIndex === null && !activeTabId) && (
                  <motion.div 
                    key="dashboard"
                    initial={{ opacity: 0, scale: 0.98, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, scale: 0.98, filter: 'blur(4px)' }}
                    transition={{ duration: 0.4, ease: DASHBOARD_EASE }}
                    className="absolute inset-0 z-20 bg-transparent"
                  >
                    <NexusDashboard onConnect={handleConnect} />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Connect Form Overlay */}
              <ConnectFormOverlay
                isDark={isDark}
                selectedSessionIndex={selectedSessionIndex}
                sessions={sessions}
                activeTabId={activeTabId}
                appConfig={appConfig}
                connecting={connecting}
                error={error}
                handleConnect={handleConnect}
                syncProfiles={syncProfiles}
                onCancel={handleHomeClick}
              />

            </div>

            <StatusBar />
          </div>
        </div>
        )}

        {/* Overlays / Modals */}
        <CreateWorkspaceModal />
        {isAiCenterOpen && <AiCenter />}
        <UnlockVaultModal />
        <UpdateToastOverlay />
        <HostKeyVerificationModal />
        
        {/* Global Command Center Overlay */}
        <AnimatePresence>
          {isCommandCenterOpen && (
            <CommandCenter
              isOpen={isCommandCenterOpen}
              onClose={() => setIsCommandCenterOpen(false)}
              onConnect={handleConnect}
              onOpenPlugin={handleOpenPlugin}
              onDeleteSession={deleteSession as any}
              isDark={isDark}
              appConfig={appConfig}
              sessions={sessions}
            />
          )}
        </AnimatePresence>
        <ToastProvider />
      </div>
    </>
  );
}

export default App;
