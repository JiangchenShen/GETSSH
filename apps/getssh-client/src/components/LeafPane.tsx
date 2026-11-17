import React, { useRef, useEffect, useState } from 'react';
import { PaneLeaf, PaneNode, useSessionStore, callTidal, isSSHConfig, type SSHConnectConfig } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { Columns, Rows, X, TerminalSquare, Maximize, Minimize, ExternalLink, ArrowDownToLine, HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { paneRegistry } from '../registry/paneRegistry';
import { usePanelStore } from '../store/panelStore';
import { useSftpPane } from './SplitPane';
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

  const { tabTitle, paneTree } = useSessionStore(useShallow(state => {
    const tab = state.tabs.find(t => t.id === tabId);
    return { tabTitle: tab?.title, paneTree: tab?.paneTree };
  }));
  const sftpPane = useSftpPane(tabId);
  const canOpenSftp = isTabActive && sftpPane?.paneId === node.paneId;
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

  const terminalConfig = node.paneType === 'terminal' && isSSHConfig(node.config) ? node.config : null;
  const protocol = !terminalConfig || terminalConfig.protocol === 'local' ? null : terminalConfig.protocol === 'telnet' ? 'Telnet' : 'SSH';
  const host = terminalConfig?.host ?? '';
  const hostname = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const endpoint = terminalConfig
    ? protocol
      ? `${terminalConfig.username ? `${terminalConfig.username}@` : ''}${hostname}${terminalConfig.port ? `:${terminalConfig.port}` : ''}`
      : t('connection.systemShell')
    : '';
  const paneTitle = terminalConfig
    ? terminalConfig.alias || (protocol ? host : t('connection.protocol.local')) || tabTitle
    : node.paneType === 'welcome' ? t('welcome.selectHost', '选择主机') : tabTitle;
  const connected = node.paneType === 'terminal' && !!node.sessionId && !node.isDisconnected;
  const statusLabel = t(connected ? 'pane.statusConnected' : 'pane.statusDisconnected');

  return (
    <div
      ref={containerRef}
      className="workbench-pane"
      data-zoomed={isZoomed || undefined}
      onClick={() => setActivePaneId(node.paneId)}
    >
      {/* Pane header with title and toolbar */}
      <div
        className="workbench-pane-header no-drag-region"
        data-active={isActive || isZoomed || undefined}
        data-pane-type={node.paneType}
      >
        <div className="workbench-pane-identity">
          <span className="workbench-pane-glyph"><TerminalSquare size={16} aria-hidden="true" /></span>
          <div className="workbench-pane-title">
            <strong title={paneTitle}>{paneTitle}</strong>
            {endpoint && <span title={endpoint}>{endpoint}</span>}
          </div>
        </div>
        {node.paneType === 'terminal' && (
          <span className="workbench-pane-status" title={statusLabel}>
            <span className="workbench-session-dot" data-status={connected ? 'connected' : 'disconnected'} aria-hidden="true" />
            <span className="workbench-pane-status-label">{statusLabel}</span>
            {protocol && <span className="workbench-pane-protocol">{protocol}</span>}
          </span>
        )}
        <div className="workbench-pane-tools">
          {!isMaxPanes && !isHollow && (
            <>
              {parentDirection !== 'hsplit' && (
                <button
                  type="button"
                  title={t('pane.splitRight', 'Split Right')}
                  disabled={!canSplitRight}
                  onClick={(e) => { e.stopPropagation(); handleSplit('hsplit'); }}
                >
                  <Columns className="w-3 h-3" />
                </button>
              )}
              {parentDirection !== 'vsplit' && (
                <button
                  type="button"
                  title={t('pane.splitDown', 'Split Down')}
                  disabled={!canSplitDown}
                  onClick={(e) => { e.stopPropagation(); handleSplit('vsplit'); }}
                >
                  <Rows className="w-3 h-3" />
                </button>
              )}
              <span className="workbench-toolbar-divider" aria-hidden="true" />
            </>
          )}
          {canOpenSftp && (
            <button
              type="button"
              title={t('sftp.title', 'SFTP File Manager')}
              onClick={(e) => {
                e.stopPropagation();
                usePanelStore.getState().togglePanel(SFTP_PANEL_ID);
              }}
              aria-pressed={sftpPanelOpen}
            >
              <HardDrive className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            title={isZoomed ? t('pane.exitZoom', 'Exit Zen Mode') : t('pane.zoom', 'Zen Mode')}
            aria-pressed={!!isZoomed}
            onClick={(e) => { 
              e.stopPropagation(); 
              void handlePaneAction(t('pane.zoomFailed', 'Could not change Zen Mode'), window.electronAPI?.tidalToggleZoom?.(node.paneId));
            }}
          >
            {isZoomed ? <Minimize className="w-3 h-3" /> : <Maximize className="w-3 h-3" />}
          </button>
          {isHollow ? (
            <button
              type="button"
              title={t('pane.attach', 'Attach to Main Window')}
              onClick={(e) => { 
                e.stopPropagation(); 
                void handleTearIn();
              }}
            >
              <ArrowDownToLine className="w-3 h-3" />
            </button>
          ) : node.paneType === 'terminal' && (
            <button
              type="button"
              title={t('pane.detach', 'Tear Off (Native Window)')}
              onClick={(e) => { 
                e.stopPropagation(); 
                void handleTearOff();
              }}
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            title={t('pane.close', 'Close Pane')}
            onClick={(e) => { 
              e.stopPropagation(); 
              void closePane();
            }}
            className="workbench-pane-close"
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
