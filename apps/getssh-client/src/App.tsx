import { useState, useEffect, useRef } from 'react';
import { TerminalPaneRenderer } from './components/TerminalPane';
import { PanelLeft, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';

// Stores
import { useAppStore } from './store/appStore';
import { useSessionStore, type PaneNode, type SessionProfile } from './store/sessionStore';
import { Runbook, useWorkspaceStore } from './store/workspaceStore';

// Hooks
import { useAppBoot } from './hooks/useAppBoot';
import { useAppEvents } from './hooks/useAppEvents';
import { useCoreAppEvents } from './hooks/useCoreAppEvents';
import { useCryptoBoot } from './hooks/useCryptoBoot';
import { useAutoStart } from './hooks/useAutoStart';
import { useSessionManager } from './hooks/useSessionManager';


// Components
import { GlobalWorkspaceBar } from './components/GlobalWorkspaceBar';
import { HomeNavigation } from './components/HomeNavigation';
import { ContextSidebar } from './components/ContextSidebar';
import { TidalDashboard } from './components/TidalDashboard';
import { CreateWorkspaceModal } from './components/CreateWorkspaceModal';
import { AiCenter } from './components/AiCenter';
import { UnlockVaultModal } from './components/UnlockVaultModal';
import { CryptoModal } from './components/CryptoModal';
import { HostKeyVerificationModal } from './components/HostKeyVerificationModal';
import { SecurityOverlay } from './components/SecurityOverlay';
import { TabBar } from './components/TabBar';
import { CommandCenter } from './components/CommandCenter';
import { ToastProvider } from './components/ToastProvider';
import { IpcManager } from './components/IpcManager';
import { StatusBar } from './components/StatusBar';
import { SplitPane } from './components/SplitPane';
import { getAvailableSplitDirection } from './utils/paneHelpers';
import './components/WorkbenchShell.css';

// Overlays
import { UpdateToastOverlay } from './components/app-overlays/UpdateToastOverlay';
import { ConnectFormOverlay } from './components/app-overlays/ConnectFormOverlay';
import { AppLockScreen } from './components/app-overlays/AppLockScreen';
import { ForceMasterPasswordChange } from './components/app-overlays/ForceMasterPasswordChange';
import { LegacyV2Import } from './components/app-overlays/LegacyV2Import';
import { MigrationPresenceNotice } from './components/app-overlays/MigrationPresenceNotice';
import { BackupRestartNotice } from './components/app-overlays/BackupRestartNotice';
import { useAppLockSync } from './hooks/useAppLockSync';
import { useAppLockStore } from './store/appLockStore';

export type { AppConfig } from './store/appStore';

function AppMain() {
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
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const isVaultLocked = useWorkspaceStore(state => state.isVaultLocked);
  const isSwitching = useWorkspaceStore(state => state.isSwitching);

  // App
  const appConfig = useAppStore(state => state.appConfig);
  const isDark = useAppStore(state => state.isDark);
  const isMac = useAppStore(state => state.isMac);
  const isFullScreen = useAppStore(state => state.isFullScreen);
  const isAppBlurred = useAppStore(state => state.isAppBlurred);
  const isCommandCenterOpen = useAppStore(state => state.isCommandCenterOpen);
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
  const isAiCenterOpen = useAppStore(state => state.isAiCenterOpen);
  const isConfigLoaded = useAppStore(state => state.isConfigLoaded);
  
  // Local State
  const [pendingHighRiskRunbook, setPendingHighRiskRunbook] = useState<Runbook | null>(null);
  const [assetsOpenFor, setAssetsOpenFor] = useState<string | null>(null);
  const [workbenchAssetsFor, setWorkbenchAssetsFor] = useState<string | null>(null);
  const workbenchAssetsButton = useRef<HTMLButtonElement>(null);
  const workbenchAssetsDrawer = useRef<HTMLElement>(null);
  const workspaceTabs = tabs.filter(tab => !tab.isTornOff && (tab.workspaceId ?? activeWorkspaceId) === activeWorkspaceId);
  const splitDirection = getAvailableSplitDirection(workspaceTabs.find(tab => tab.id === activeTabId)?.paneTree, activePaneId);
  const isHomeActive = selectedSessionIndex === null && !activeTabId;
  const showFullHome = isHomeActive && !isVaultLocked;
  const assetsOpen = showFullHome && !isSwitching && assetsOpenFor === activeWorkspaceId;
  const workbenchAssetsOpen = !showFullHome && !isSwitching && !isVaultLocked && workbenchAssetsFor === activeWorkspaceId;

  useEffect(() => {
    if (!showFullHome || isSwitching) setAssetsOpenFor(null);
  }, [showFullHome, isSwitching]);

  useEffect(() => {
    setWorkbenchAssetsFor(null);
  }, [showFullHome, isSwitching, isVaultLocked, activeWorkspaceId, activeTabId, selectedSessionIndex]);

  useEffect(() => {
    if (!workbenchAssetsOpen) return;
    workbenchAssetsDrawer.current?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
    const closeDrawer = (event: KeyboardEvent) => {
      // Escape remains a terminal key when focus isn't inside the drawer.
      if (event.key !== 'Escape' || !(event.target instanceof Element)
        || !workbenchAssetsDrawer.current?.contains(event.target)) return;
      event.preventDefault();
      setWorkbenchAssetsFor(null);
      workbenchAssetsButton.current?.focus();
    };
    window.addEventListener('keydown', closeDrawer);
    return () => window.removeEventListener('keydown', closeDrawer);
  }, [workbenchAssetsOpen]);

  const selectTab = (id: string) => {
    setSelectedSessionIndex(null);
    setActiveTabId(id);
  };

  const createConnection = (address = '') => {
    window.dispatchEvent(new CustomEvent('app:create-session', { detail: address }));
  };

  const editHost = (profile: SessionProfile) => {
    const state = useSessionStore.getState();
    const workspace = useWorkspaceStore.getState();
    if (workspace.isSwitching || workspace.isVaultLocked || state.profilesWorkspaceId !== workspace.activeWorkspaceId) return;
    const index = state.sessions.findIndex(session => session === profile || (profile.id && session.id === profile.id));
    if (index < 0) return;
    state.setError(null);
    setSelectedSessionIndex(index);
    setActiveTabId(null);
  };

  const handleHomeClick = () => {
    const state = useSessionStore.getState();
    if (state.selectedSessionIndex !== null && state.sessions[state.selectedSessionIndex]?.isDraft) {
      state.setSessions(state.sessions.filter((_, index) => index !== state.selectedSessionIndex));
    }
    setSelectedSessionIndex(null);
    setActiveTabId(null);
    setAssetsOpenFor(null);
  };

  // Crypto Boot Check
  useCryptoBoot();

  // Watch i18n changes
  useEffect(() => {
    i18n.changeLanguage(appConfig.language);
  }, [appConfig.language, i18n]);

  // Sync native window theme for OS Vibrancy (fixing glassmorphism layering issues).
  // nativeTheme is process-wide: wait for the stored config so the default theme never flashes every window.
  useEffect(() => {
    if (!isConfigLoaded) return;
    if (window.electronAPI?.setTheme) {
      window.electronAPI.setTheme(appConfig.theme);
    }
  }, [appConfig.theme, isConfigLoaded]);

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

  useCoreAppEvents(setPendingHighRiskRunbook, syncProfiles, handleConnect);

  // Torn-off windows never render App: main.tsx mounts TornWindowApp for ?isHollow=true.

  /** Types the confirmed high-risk runbook into the active terminal (not executed: no newline). */
  const fillPendingRunbook = () => {
    const runbook = pendingHighRiskRunbook;
    if (!runbook) return;
    const state = useSessionStore.getState();
    let sessionId: string | null = null;
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    const traverse = (node: PaneNode) => {
      if (node.type === 'leaf') {
        if (node.paneId === state.activePaneId && node.paneType === 'terminal') sessionId = node.sessionId || null;
      } else if (node.type === 'hsplit' || node.type === 'vsplit') {
        if (node.children[0]) traverse(node.children[0]);
        if (node.children[1]) traverse(node.children[1]);
      }
    };
    if (tab?.paneTree && state.activePaneId) traverse(tab.paneTree);
    if (!sessionId) {
      useAppStore.getState().addToast(t('commandCenter.noActiveTerminal', '未找到活动的终端面板以执行剧本'), 'warning');
    } else if (window.electronAPI?.sshWrite) {
      window.electronAPI.sshWrite(sessionId, runbook.command.replace(/[\r\n]+/g, ' ').trim());
      useAppStore.getState().addToast(t('commandCenter.runbookFilled', '剧本命令已安全填入终端缓冲'), 'success');
    }
    setPendingHighRiskRunbook(null);
  };

  return (
    <>
      <IpcManager />
      <div 
        className={`w-screen h-screen overflow-hidden flex flex-col font-sans text-ink transition-[filter] duration-200 ${isAppBlurred && appConfig.privacyMode ? 'blur-2xl brightness-50 pointer-events-none' : ''} relative`}
        style={isMac ? undefined : { backgroundColor: 'var(--v2-bg)' }}
      >
        <AnimatePresence>
          {pendingHighRiskRunbook && (
            <motion.div 
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 0.95 }}
               role="dialog"
               aria-modal="true"
               aria-label="High Risk Operation"
               className="fixed inset-0 z-[9999] flex items-center justify-center bg-scrim p-5 pointer-events-auto"
            >
              <div className="border border-line bg-surf rounded-xl max-w-md w-full p-5 shadow-2xl">
                <h3 className="text-base font-bold text-ink mb-2 flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-down" aria-hidden="true" /> High Risk Operation
                </h3>
                <p className="text-sm text-ink-2 mb-4">You are about to execute a high-risk runbook. Please enter your master password to authorize this action.</p>
                <CryptoModal 
                  mode="locked" 
                  isDark={isDark}
                  embedded
                  onSetup={async () => {}}
                  onUnlock={async (pwd) => {
                     // The main process checks the person: Touch ID / Windows Hello first, this
                     // workspace's password (or the master password) where the OS has no check.
                     const result = await window.electronAPI.security.verifyOwner({ reason: 'run a high-risk runbook', password: pwd });
                     if (!result.ok) return false;
                     fillPendingRunbook();
                     return true;
                  }}
                  onRetryBiometric={async () => {
                     const result = await window.electronAPI.security.verifyOwner({ reason: 'run a high-risk runbook' });
                     if (result.ok) fillPendingRunbook();
                  }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hiding the shell on Home leaves open terminal panes mounted. */}
        <div className="workbench-shell" hidden={showFullHome}
          data-caption={isFullScreen ? undefined : isMac ? 'mac' : 'windows'}>
          <div className="workbench-top">
            <TabBar
              tabs={workspaceTabs}
              activeTabId={activeTabId}
              onSelectTab={selectTab}
              onCloseTab={closeTab}
              onHomeClick={handleHomeClick}
              isHomeActive={isHomeActive}
              onSplit={() => { if (activePaneId && splitDirection) splitPane(activePaneId, splitDirection); }}
              canSplit={splitDirection !== null}
            />
          </div>

          <aside aria-label={t('statusBar.workspace')} className="workspace-navigation sidebar-material workbench-rail">
            <button
              ref={workbenchAssetsButton}
              type="button"
              className="workbench-rail-toggle"
              aria-label={t('assetFolders.assets')}
              title={t('assetFolders.assets')}
              aria-expanded={workbenchAssetsOpen}
              aria-controls={workbenchAssetsOpen ? 'workbench-asset-drawer' : undefined}
              onClick={() => setWorkbenchAssetsFor(workbenchAssetsOpen ? null : activeWorkspaceId)}
              disabled={isSwitching || isVaultLocked}
            >
              <PanelLeft size={18} aria-hidden="true" />
            </button>
            <GlobalWorkspaceBar poll={!showFullHome} />
          </aside>

          <div className="workbench-content">
            <BackupRestartNotice />
            <div className="workbench-session-frame">
              
              {/* Active Terminal Panes (+ the SFTP panel docked below the active tab) */}
              <SplitPane isDark={isDark} activeTabId={activeTabId}>
              {workspaceTabs.map((tab) => (
                <div 
                  key={tab.id}
                  className="absolute inset-0 flex flex-col"
                  style={{ display: activeTabId === tab.id ? 'flex' : 'none', zIndex: activeTabId === tab.id ? 10 : 0 }}
                >
                  {tab.paneTree ? (
                    <TerminalPaneRenderer node={tab.paneTree} tabId={tab.id} appConfig={appConfig} isDark={isDark} isTabActive={activeTabId === tab.id} onSplit={(paneId, direction) => splitPane(paneId, direction)} />
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-ink-3">
                      Waiting for Tidal Engine...
                    </div>
                  )}
                </div>
              ))}
              </SplitPane>

              {isHomeActive && isVaultLocked && (
                <TidalDashboard onConnect={handleConnect} />
              )}

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
            {workbenchAssetsOpen && (
              <aside id="workbench-asset-drawer" ref={workbenchAssetsDrawer} aria-label={t('assetFolders.assets')} className="workbench-asset-drawer">
                <ContextSidebar onAddSession={createConnection} onToggleAutoStart={toggleAutoStart}
                  onDeleteSession={deleteSession} onClose={() => {
                    setWorkbenchAssetsFor(null);
                    workbenchAssetsButton.current?.focus();
                  }} />
              </aside>
            )}
          </div>
          <div className="workbench-bottom">
            <StatusBar />
          </div>
        </div>

        {showFullHome && (
          <TidalDashboard onConnect={handleConnect} onEdit={editHost}
            navigation={<HomeNavigation onHome={handleHomeClick} hostsOpen={assetsOpen}
              onHosts={() => setAssetsOpenFor(assetsOpen ? null : activeWorkspaceId)} />}
            notice={<BackupRestartNotice />}
            assets={assetsOpen && <ContextSidebar onAddSession={createConnection} onToggleAutoStart={toggleAutoStart}
              onDeleteSession={deleteSession} onClose={() => setAssetsOpenFor(null)} />} />
        )}

        {/* Overlays / Modals */}
        <CreateWorkspaceModal />
        {isAiCenterOpen && <AiCenter />}
        <UnlockVaultModal />
        <UpdateToastOverlay />
        <HostKeyVerificationModal />
        <SecurityOverlay />
        
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

/**
 * Nothing that reads GETSSH data mounts before the main process has opened it: until the first
 * unlock only the lock screen exists. A later lock (master password, idle time) covers the app
 * instead, so terminal sessions keep running underneath.
 */
function App() {
  useAppLockSync();
  const phase = useAppLockStore(state => state.state?.phase);
  const [opened, setOpened] = useState(false);
  const [passwordDialogActive, setPasswordDialogActive] = useState(false);
  useEffect(() => {
    if (phase === 'ready') setOpened(true);
  }, [phase]);
  if (!opened) return <AppLockScreen />;
  return (
    <>
      <AppMain />
      {phase !== 'ready' && <AppLockScreen />}
      {phase === 'ready' && <ForceMasterPasswordChange onActiveChange={setPasswordDialogActive} />}
      {!passwordDialogActive && <LegacyV2Import />}
      <MigrationPresenceNotice suppressed={passwordDialogActive} />
    </>
  );
}

export default App;
