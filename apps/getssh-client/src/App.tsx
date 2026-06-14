import React, { useState, useEffect, useRef } from 'react';
import { MoovierTile, MoovierFocusProvider } from '@moovier/core';
import { TerminalPaneRenderer } from './components/TerminalPane';
import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';

// Stores
import { useAppStore } from './store/appStore';
import { PaneNode, useSessionStore } from './store/sessionStore';
import { useWorkspaceStore, Runbook } from './store/workspaceStore';
import { useCryptoStore } from './store/cryptoStore';

// Hooks
import { useAppBoot } from './hooks/useAppBoot';
import { useAppIPC } from './hooks/useAppIPC';
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

// Overlays
import { SettingsModalOverlay } from './components/app-overlays/SettingsModalOverlay';
import { UpdateToastOverlay } from './components/app-overlays/UpdateToastOverlay';
import { ConnectFormOverlay } from './components/app-overlays/ConnectFormOverlay';

export type { AppConfig } from './store/appStore';

function App() {
  const { t, i18n } = useTranslation();

  // Boot Application & Bind IPC / Window Events
  useAppBoot();
  useAppIPC();
  useAppEvents();

  // Workspace
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const switchWorkspace = useWorkspaceStore(state => state.switchWorkspace);

  // Session
  const sessions = useSessionStore(state => state.sessions);
  const setSessions = useSessionStore(state => state.setSessions);
  const tabs = useSessionStore(state => state.tabs);
  const closeTab = useSessionStore(state => state.closeTab);
  const activeTabId = useSessionStore(state => state.activeTabId);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);
  const selectedSessionIndex = useSessionStore(state => state.selectedSessionIndex);
  const setSelectedSessionIndex = useSessionStore(state => state.setSelectedSessionIndex);
  const connecting = useSessionStore(state => state.connecting);
  const error = useSessionStore(state => state.error);

  // App
  const appConfig = useAppStore(state => state.appConfig);
  const isDark = useAppStore(state => state.isDark);
  const isMac = useAppStore(state => state.isMac);
  const isFullScreen = useAppStore(state => state.isFullScreen);
  const isPolluted = useAppStore(state => state.isPolluted);
  const isAppBlurred = useAppStore(state => state.isAppBlurred);
  const isCommandCenterOpen = useAppStore(state => state.isCommandCenterOpen);
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
  const isAiCenterOpen = useAppStore(state => state.isAiCenterOpen);
  const isSidebarCollapsed = useAppStore(state => state.isSidebarCollapsed);
  
  // Crypto State
  const cryptoMode = useCryptoStore(state => state.cryptoMode);
  const setCryptoMode = useCryptoStore(state => state.setCryptoMode);
  const masterPassword = useCryptoStore(state => state.masterPassword);
  const setMasterPassword = useCryptoStore(state => state.setMasterPassword);
  const encryptionDisabled = useCryptoStore(state => state.encryptionDisabled);
  const setEncryptionDisabled = useCryptoStore(state => state.setEncryptionDisabled);

  // Local State
  const [pendingHighRiskRunbook, setPendingHighRiskRunbook] = useState<Runbook | null>(null);
  const [settingsActiveTab, setSettingsActiveTab] = useState<'Appearance'|'Terminal'|'SSH'|'System'|'About'|'Audit'>('Appearance');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const openSettingsTab = (tab: 'Appearance'|'Terminal'|'SSH'|'System'|'About'|'Audit'|string = 'Appearance', toggle: boolean = false) => {
     if (isSettingsOpen && toggle) {
         setIsSettingsOpen(false);
         return;
     }
     setSettingsActiveTab(tab as any);
     setIsSettingsOpen(true);
  };

  const handleHomeClick = () => {
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

  // Auto-Start trigger
  useAutoStart();

  // Core App Events & Session Management
  const {
    syncProfiles,
    handleSetup,
    handleUnlock,
    deleteSession,
    toggleAutoStart,
    handleConnect,
    handleOpenPlugin,
    splitPane
  } = useSessionManager();

  syncProfilesRef.current = syncProfiles;

  useCoreAppEvents(setPendingHighRiskRunbook, setIsSettingsOpen, syncProfiles);

  // Global Background & Glassmorphism Logic
  let appBgStyle = { '--titlebar-height': isMac ? '40px' : '32px' } as React.CSSProperties;
  let containerClasses = '';

  if (!isDark) {
    // Light Mode (Glass on): Pure white base with very high opacity, using primary color as extremely subtle tint
    appBgStyle = { ...appBgStyle, backgroundColor: `rgba(255, 255, 255, ${appConfig.bgOpacity ?? 0.85})` };
    containerClasses = 'bg-primary/[0.02] text-slate-900 border-none';
  } else if (!appConfig.enableGlassmorphism) {
    // Dark Mode (Glass off): Solid, no blur
    containerClasses = 'bg-[#0A0A0A] text-neutral-200 border-none';
  } else {
    // Dark Mode (Glass on): Semi-transparent, blur
    appBgStyle = { ...appBgStyle, backgroundColor: `rgba(9, 9, 11, ${appConfig.bgOpacity ?? 0.8})` };
    containerClasses = 'glass-effect text-neutral-200 border-none';
  }

  return (
    <MoovierFocusProvider>
      <div 
        className={`w-screen h-screen overflow-hidden flex flex-col font-sans transition-all duration-200 ${containerClasses} ${isAppBlurred && appConfig.privacyMode ? 'blur-2xl brightness-50 pointer-events-none' : ''} relative`}
        style={appBgStyle}
      >
        {/* Subtle Duo-Tone Ambient Glow - Enabled in both modes! */}
        <div className={`absolute inset-0 pointer-events-none z-[0] transition-all duration-1000 bg-gradient-duo ${isDark ? 'opacity-[0.12] mix-blend-screen' : 'opacity-[0.04] mix-blend-normal'}`} />

        <AnimatePresence>
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

        {/* ── STANDARD LOCK SCREEN ── */}
        {(cryptoMode === 'locked' || cryptoMode === 'setup') && !pendingHighRiskRunbook && (() => {
          const _activeWs = workspaces.find(w => w.id === activeWorkspaceId);
          const _wsName = _activeWs?.name || activeWorkspaceId;
          const _wsColor = _activeWs?.themeColor;
          return (
          <CryptoModal 
            mode={cryptoMode} 
            isDark={isDark} 
            encryptionDisabled={encryptionDisabled}
            onUnlock={handleUnlock} 
            onSetup={async (pwd) => { await handleSetup(pwd); }}
            onSkip={cryptoMode === 'setup' ? () => setCryptoMode('idle') : undefined}
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
                    useWorkspaceStore.setState({ isVaultLocked: false, isUnlockModalOpen: false });
                 } catch (e) {
                    console.warn('Biometric unlock failed on manual retry:', e);
                 }
               }
            }}
            workspaceName={cryptoMode === 'locked' ? _wsName : undefined}
            themeColor={cryptoMode === 'locked' ? _wsColor : undefined}
            onSwitchWorkspace={cryptoMode === 'locked' && activeWorkspaceId !== 'default' ? async () => {
              setCryptoMode('idle');
              await switchWorkspace('default');
            } : undefined}
          />
          );
        })()}
        
        {!isFullScreen && (
          <div className={`absolute top-0 left-0 right-0 z-[100] flex items-center justify-center text-xs opacity-50 font-medium pointer-events-none pr-[120px] select-none ${isMac ? 'h-10' : 'h-8'}`} style={{ WebkitAppRegion: 'drag', pointerEvents: 'auto' } as React.CSSProperties & { WebkitAppRegion?: string }}>
             {isPolluted && (
               <span title="☢️ 污染警告" style={{ WebkitAppRegion: 'no-drag', display: 'flex', alignItems: 'center' } as React.CSSProperties}>
                 <ShieldAlert className="w-3 h-3 text-red-500 mr-2 animate-pulse" />
               </span>
             )}
          </div>
        )}

        {/* --- MOOVIER SUPREME: Absolute Grid Layout --- */}
        <div 
          className="w-full h-full bg-transparent"
          style={{
             display: 'grid',
             gridTemplateColumns: `64px ${isSidebarCollapsed ? '48px' : '240px'} 1fr`,
             gridTemplateRows: `${isFullScreen ? '0px' : 'var(--titlebar-height)'} 1fr 0px`,
             zIndex: 'var(--z-app-chrome)'
          }}
        >
          {/* L3 Global Sidebar (Ultra-narrow) */}
          <div style={{ gridColumn: '1 / 2', gridRow: '1 / 4', zIndex: 'var(--z-region-material)' }}>
            <GlobalWorkspaceBar openSettingsTab={openSettingsTab} onHomeClick={handleHomeClick} />
          </div>

          {/* Left Sidebar (L4 Region Material, Edge-Flush) */}
          <div style={{ gridColumn: '2 / 3', gridRow: '1 / 4', zIndex: 'var(--z-region-material)', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <MoovierTile 
              exemptFromFocus 
              dragLevel="fixed" 
              className={`w-full h-full shrink-0 flex flex-col rounded-xl ${!isDark && '!bg-black/[0.02] border-r !border-black/5 !shadow-none'}`}
              style={{ borderRadius: 0 }}
            >
              <ContextSidebar 
                onAddSession={() => {
                  const newSession = { host: '', username: '', password: '', privateKeyPath: '', autoStart: false };
                  const updated = [...sessions, newSession];
                  syncProfiles(updated);
                  setSelectedSessionIndex(updated.length - 1);
                  setActiveTabId(null);
                }}
                onToggleAutoStart={toggleAutoStart}
                onDeleteSession={deleteSession}
              />
            </MoovierTile>
          </div>

          {/* Main Content Area (L5 Content) */}
          <div style={{ gridColumn: '3 / 4', gridRow: '2 / 3', zIndex: 'var(--z-content)' }} className="flex flex-col min-h-0 overflow-hidden relative">
            
            {/* Tab Bar ALWAYS visible if tabs.length > 0 */}
            {(tabs.length > 0 && activeTabId !== 'settings') && (
              <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                isDark={isDark}
                onSelectTab={(id) => {
                  setActiveTabId(id);
                  setSelectedSessionIndex(null);
                }}
                onCloseTab={closeTab}
              />
            )}

            <div className="flex-1 relative flex flex-col min-h-0 overflow-hidden">
              
              {/* Active Terminal Panes */}
              {tabs.map((tab) => (
                <div 
                  key={tab.id}
                  className="absolute inset-0 flex flex-col"
                  style={{ display: (activeTabId === tab.id && selectedSessionIndex === null) ? 'flex' : 'none', zIndex: activeTabId === tab.id ? 10 : 0 }}
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
              {(selectedSessionIndex === null && !activeTabId) && (
                <div className={`absolute inset-0 flex items-center justify-center overflow-y-auto overflow-x-hidden p-4 z-20 ${tabs.length > 0 ? 'bg-black/80 backdrop-blur-md' : 'bg-transparent'}`}>
                  <NexusDashboard openSettingsTab={openSettingsTab} />
                </div>
              )}

              {/* Connect Form Overlay */}
              <ConnectFormOverlay
                tabsLength={tabs.length}
                isDark={isDark}
                selectedSessionIndex={selectedSessionIndex}
                sessions={sessions}
                activeTabId={activeTabId}
                appConfig={appConfig}
                connecting={connecting}
                error={error}
                handleConnect={handleConnect}
                syncProfiles={syncProfiles}
              />

            </div>
          </div>
        </div>

        {/* Overlays / Modals */}
        <CreateWorkspaceModal />
        {isAiCenterOpen && <AiCenter />}
        <UnlockVaultModal />
        <SettingsModalOverlay 
          isOpen={isSettingsOpen} 
          isDark={isDark} 
          settingsActiveTab={settingsActiveTab} 
          encryptionDisabled={encryptionDisabled}
          onClose={() => setIsSettingsOpen(false)} 
          setSettingsActiveTab={setSettingsActiveTab}
        />
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
    </MoovierFocusProvider>
  );
}

export default App;
