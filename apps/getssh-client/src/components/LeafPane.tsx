import React, { useRef, useEffect, useState } from 'react';
import { PaneLeaf, PaneNode, useSessionStore, callTidal, isSSHConfig, type SSHConnectConfig } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { Columns, Rows, X, TerminalSquare, Maximize, Minimize, ExternalLink, ArrowDownToLine, HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { paneRegistry } from '../registry/paneRegistry';
import { usePanelStore } from '../store/panelStore';
import { isSftpCapable } from './SplitPane';
import { SFTP_PANEL_ID } from './SFTPManager';
import { useWorkspaceStore } from '../store/workspaceStore';
import { buildConnectionConfig, stripConnectionSecrets } from '../utils/connectionProfile';
import { countLeaves } from '../utils/paneHelpers';

export const LeafPane: React.FC<{
  node: PaneLeaf;
  tabId: string;
  appConfig: any;
  isDark: boolean;
  isTabActive: boolean;
  onSplit: (paneId: string, direction: 'hsplit' | 'vsplit') => void;
  parentDirection?: 'hsplit' | 'vsplit';
}> = ({ node, tabId, appConfig, isDark, isTabActive, onSplit, parentDirection
}) => {
  const { t } = useTranslation();
  // Torn-off window: the whole tab lives here. No splits, no further tear-off; "attach" returns the tab to main.
  const isHollow = new URLSearchParams(window.location.search).get('isHollow') === 'true';
  const activePaneId = useSessionStore(state => state.activePaneId);
  const setActivePaneId = useSessionStore(s => s.setActivePaneId);
  const isActive = activePaneId === node.paneId;
  const welcomeRef = useRef<HTMLDivElement>(null);
  const lastSplitTime = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  const canSplitRight = paneSize.width >= 200;
  const canSplitDown = paneSize.height >= 200;

  // Anti-collapse protection
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setPaneSize({ width, height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleSplit = (direction: 'hsplit' | 'vsplit') => {
    const now = Date.now();
    if (now - lastSplitTime.current < 500) return;
    lastSplitTime.current = now;
    onSplit(node.paneId, direction);
  };

  // Auto-focus the welcome pane when it appears.
  // setTimeout pushes focus() past React batching AND Electron paint cycle.
  useEffect(() => {
    if (node.paneType === 'welcome') {
      const timer = setTimeout(() => {
        welcomeRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [node.paneType]);

  const { tabTitle, paneTree, tabWorkspaceId } = useSessionStore(useShallow(state => {
    const tab = state.tabs.find(t => t.id === tabId);
    return { tabTitle: tab?.title, paneTree: tab?.paneTree, tabWorkspaceId: tab?.workspaceId };
  }));
  // Secure Center → Isolation Rules → "Disable SFTP" hides the entry (main enforces it as well).
  const sftpDisabled = useWorkspaceStore(state => {
    const ws = state.workspaces.find(w => w.id === (tabWorkspaceId ?? state.activeWorkspaceId));
    return ws?.preferences?.isolationRules?.disableSftp === true;
  });
  const sftpPanelOpen = usePanelStore(state => state.activePanelId === SFTP_PANEL_ID);
  
  const totalPanes = countLeaves(paneTree as PaneNode);
  const isMaxPanes = totalPanes >= 4;

  const isZoomed = node.isZoomed;

  const handlePaneAction = async (message: string, call: Promise<{ success: boolean; error?: string }> | undefined, automatic = false) => {
    const result = await callTidal(message, call);
    // Terminal exit may race the native pane retirement that already closed it.
    if (!result.success && !(automatic && result.error === 'not_found')) {
      useAppStore.getState().addToast(`${message}: ${result.error}`, 'error');
    }
  };

  const closePane = (automatic = false) => handlePaneAction(
    t('pane.closeFailed', 'Could not close the pane'),
    window.electronAPI?.tidalClosePane?.(node.paneId),
    automatic,
  );

  const handleTearOff = async () => {
    try {
      const res = await window.electronAPI.windowTearOff({
        paneId: node.paneId,
        screenX: window.screenX + 50,
        screenY: window.screenY + 50,
        width: Math.max(800, window.outerWidth * 0.8),
        height: Math.max(600, window.outerHeight * 0.8),
      });
      if (!res.success) throw new Error(res.error || 'unknown');
    } catch (err: any) {
      useAppStore.getState().addToast(`${t('pane.tearOffFailed', 'Could not open the pane in a new window')}: ${err?.message || err}`, 'error');
    }
  };

  const handleTearIn = async () => {
    try {
      const res = await window.electronAPI.windowTearIn();
      if (!res.success) throw new Error(res.error || 'unknown');
    } catch (err: any) {
      useAppStore.getState().addToast(`${t('pane.tearInFailed', 'Could not attach to the main window')}: ${err?.message || err}`, 'error');
    }
  };

  // Main window only: rebuild the connect config (with credentials) from the saved, unlocked profile
  // of the workspace the pane belongs to.
  const connectFromProfile = async (): Promise<{ sessionId: string; config: SSHConnectConfig }> => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    const paneConfig = isSSHConfig(node.config) ? node.config : null;
    const profileId = paneConfig && (!paneConfig.workspaceId || paneConfig.workspaceId === workspaceId) ? paneConfig.profileId : undefined;
    const profile = !isHollow && profileId ? useSessionStore.getState().sessions.find(s => s.id === profileId) : undefined;
    if (!profile) throw new Error('unknown_session');
    const config = {
      ...buildConnectionConfig(profile, appConfig),
      profileId,
      workspaceId,
    };
    const payload = { ...config, enableAuditLogging: appConfig.enableAuditLogging };
    const res = await window.electronAPI.sshConnect(payload);
    if (!res.success || !res.sessionId) throw new Error(res.error || 'Connection failed');
    return { sessionId: res.sessionId, config };
  };

  // Rust owns the pane's sessionId: a reconnect replaces the leaf there (which also retires the dead
  // session) instead of patching the id locally, where the next sync would revert it.
  // Pane configs carry no credentials: the main process reconnects with the config it kept for the old session.
  const handleReconnect = async () => {
    if (!isSSHConfig(node.config)) return;
    let paneConfig: SSHConnectConfig = node.config;
    let newSessionId: string | undefined;
    try {
      const res = node.sessionId
        ? await window.electronAPI.sshReconnect(node.sessionId)
        : { success: false, error: 'unknown_session' };
      if (res.success && res.sessionId) {
        newSessionId = res.sessionId;
      } else if (res.error === 'unknown_session') {
        const fallback = await connectFromProfile();
        newSessionId = fallback.sessionId;
        paneConfig = fallback.config;
      } else {
        throw new Error(res.error || 'Connection failed');
      }
      const replaced = await window.electronAPI.tidalReplacePane(node.paneId, 'terminal', newSessionId, JSON.stringify(stripConnectionSecrets(paneConfig)));
      if (!replaced.success) throw new Error(replaced.error || 'replace_failed');
    } catch (err: any) {
      if (newSessionId) window.electronAPI.sshDisconnect(newSessionId);
      useSessionStore.getState().patchTidalLeaf(node.paneId, { isDisconnected: true });
      useAppStore.getState().addToast(`${t('pane.reconnectFailed', 'Reconnect failed')}: ${err?.message || err}`, 'error');
    }
  };

  const zoomClasses = isZoomed
    ? 'absolute inset-2 z-[100] rounded-[10px] border border-line bg-bg overflow-hidden'
    : 'relative w-full h-full overflow-hidden';

  return (
    <div
      ref={containerRef}
      className={`group flex flex-col min-w-0 min-h-0 transition-all duration-200 ${zoomClasses}`}
      onClick={() => setActivePaneId(node.paneId)}
    >
      {/* Pane header with title and toolbar */}
      <div
        className={`relative z-10 flex-none flex items-center justify-between gap-2 px-3 h-8 text-xs
                    select-none border-b border-line-soft bg-panel app-region-no-drag
                    ${isActive ? 'shadow-[inset_0_2px_0_var(--color-primary)]' : ''}`}
      >
        <div className="flex items-center gap-2 min-w-0 text-ink-2">
           <TerminalSquare className="w-3.5 h-3.5 flex-none text-ink-3" />
           <span className="truncate font-medium text-xs text-ink">
             {node.paneType === 'welcome' ? t('welcome.selectHost', '选择主机') : (node.paneType === 'plugin' ? (tabTitle || 'Plugin') : (node.paneType === 'center' ? (tabTitle || 'Center') : (isSSHConfig(node.config) ? `${node.config.username || ''}@${node.config.host || ''}` : '')))}
           </span>
        </div>
        <div className={`flex items-center gap-1 transition-opacity app-region-no-drag relative z-50 ${isActive || isZoomed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {!isMaxPanes && !isHollow && (
            <>
              {parentDirection !== 'hsplit' && (
                <button
                  title={t('pane.splitRight', 'Split Right')}
                  disabled={!canSplitRight}
                  onClick={(e) => { e.stopPropagation(); handleSplit('hsplit'); }}
                  className={`w-[18px] h-[18px] rounded grid place-items-center transition-colors ${!canSplitRight ? 'opacity-25 cursor-not-allowed text-ink-3' : 'text-ink-3 hover:bg-surf-2 hover:text-ink'}`}
                >
                  <Columns className="w-3 h-3" />
                </button>
              )}
              {parentDirection !== 'vsplit' && (
                <button
                  title="Split Down"
                  disabled={!canSplitDown}
                  onClick={(e) => { e.stopPropagation(); handleSplit('vsplit'); }}
                  className={`w-[18px] h-[18px] rounded grid place-items-center transition-colors ${!canSplitDown ? 'opacity-25 cursor-not-allowed text-ink-3' : 'text-ink-3 hover:bg-surf-2 hover:text-ink'}`}
                >
                  <Rows className="w-3 h-3" />
                </button>
              )}
              <div className="w-px h-3 mx-1 bg-line"></div>
            </>
          )}
          {isSftpCapable(node) && !sftpDisabled && (
            <button
              title={t('sftp.title', 'SFTP File Manager')}
              onClick={(e) => {
                e.stopPropagation();
                setActivePaneId(node.paneId);
                // The panel follows the active pane: open it, close it from its own pane, or just switch panes.
                const panels = usePanelStore.getState();
                if (panels.activePanelId !== SFTP_PANEL_ID || isActive) panels.togglePanel(SFTP_PANEL_ID);
              }}
              className={`w-[18px] h-[18px] rounded grid place-items-center transition-colors ${sftpPanelOpen && isActive ? 'text-primary bg-primary/10' : 'text-ink-3 hover:bg-surf-2 hover:text-ink'}`}
            >
              <HardDrive className="w-3 h-3" />
            </button>
          )}
          <button
            title={isZoomed ? "Exit Zen Mode" : "Zen Mode"}
            onClick={(e) => { 
              e.stopPropagation(); 
              void handlePaneAction(t('pane.zoomFailed', 'Could not change Zen Mode'), window.electronAPI?.tidalToggleZoom?.(node.paneId));
            }}
            className={`w-[18px] h-[18px] rounded grid place-items-center transition-colors ${isZoomed ? 'text-primary bg-primary/10' : 'text-ink-3 hover:bg-surf-2 hover:text-ink'}`}
          >
            {isZoomed ? <Minimize className="w-3 h-3" /> : <Maximize className="w-3 h-3" />}
          </button>
          {isHollow ? (
            <button
              title="Attach to Main Window"
              onClick={(e) => { 
                e.stopPropagation(); 
                void handleTearIn();
              }}
              className="w-[18px] h-[18px] rounded grid place-items-center text-ink-3 transition-colors hover:bg-surf-2 hover:text-ink"
            >
              <ArrowDownToLine className="w-3 h-3" />
            </button>
          ) : node.paneType === 'terminal' && (
            <button
              title="Tear Off (Native Window)"
              onClick={(e) => { 
                e.stopPropagation(); 
                void handleTearOff();
              }}
              className="w-[18px] h-[18px] rounded grid place-items-center text-ink-3 transition-colors hover:bg-surf-2 hover:text-ink"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
          <button
            title="Close Pane"
            onClick={(e) => { 
              e.stopPropagation(); 
              void closePane();
            }}
            className="w-[18px] h-[18px] rounded grid place-items-center text-ink-3 transition-colors hover:bg-down/15 hover:text-down"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {paneRegistry.render({
        node,
        tabId,
        appConfig,
        isDark,
        isTabActive,
        isActive,
        onDisconnectedChange: (val) => {
          useSessionStore.getState().patchTidalLeaf(node.paneId, { isDisconnected: val });
        },
        onClosePane: () => {
          void closePane(true);
        },
        onReconnect: () => { void handleReconnect(); }
      })}
    </div>
  );
};
