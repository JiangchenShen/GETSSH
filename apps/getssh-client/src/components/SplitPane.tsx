import React, { useCallback, useEffect } from 'react';
import { usePanelStore } from '../store/panelStore';
import { useSessionStore, type PaneLeaf, isSSHConfig } from '../store/sessionStore';
import { useAppLockStore } from '../store/appLockStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { findLeaf, findZoomedPane } from '../utils/paneHelpers';
import { SFTP_PANEL_ID } from './SFTPManager';

/**
 * SplitPane - A dynamic, resizable split panel engine.
 * Renders the active panel (registered via panelStore) alongside the main content.
 * Supports both right-side (horizontal drag) and bottom (vertical drag) panels.
 * 
 * Props:
 *  - isDark: current theme
 *  - activeTabId: current active tab (passed from parent to avoid store dependency)
 */
/** SFTP runs over the SSH connection, so local shells and telnet panes have none. */
export function isSftpCapable(node: PaneLeaf): boolean {
  if (node.paneType !== 'terminal' || !node.sessionId || node.isDisconnected || !isSSHConfig(node.config)) return false;
  return node.config.protocol !== 'local' && node.config.protocol !== 'telnet';
}

/** The dock and its toolbar must agree on which terminal is visible and eligible. */
export function useSftpPane(tabId: string | null): PaneLeaf | null {
  const isHollow = new URLSearchParams(window.location.search).get('isHollow') === 'true';
  const phase = useAppLockStore(state => state.state?.phase);
  const tab = useSessionStore(state => state.activeTabId === tabId && state.selectedSessionIndex === null
    ? state.tabs.find(candidate => candidate.id === tabId && (isHollow || !candidate.isTornOff))
    : undefined);
  const activePaneId = useSessionStore(state => state.activePaneId);
  const allowed = useWorkspaceStore(state => {
    const workspaceId = tab?.workspaceId ?? state.activeWorkspaceId;
    if (state.isSwitching || state.isVaultLocked || (!isHollow && workspaceId !== state.activeWorkspaceId)) return false;
    const workspace = state.workspaces.find(item => item.id === workspaceId);
    if (isHollow && !workspace) return false;
    return workspace?.preferences?.isolationRules?.disableSftp !== true;
  });
  if (!tab?.paneTree || !allowed || (isHollow ? phase !== 'ready' : phase && phase !== 'ready')) return null;
  const pane = findZoomedPane(tab.paneTree) ?? (activePaneId ? findLeaf(tab.paneTree, activePaneId) : null);
  return pane && isSftpCapable(pane) ? pane : null;
}

interface SplitPaneProps {
  children: React.ReactNode;
  isDark: boolean;
  activeTabId: string | null;
}

export const SplitPane: React.FC<SplitPaneProps> = ({ children, isDark, activeTabId }) => {
  const activePanelId = usePanelStore(s => s.activePanelId);
  const panels = usePanelStore(s => s.panels);
  const panelSizes = usePanelStore(s => s.panelSizes);
  const setPanelSize = usePanelStore(s => s.setPanelSize);

  const activeSessionId = useSftpPane(activeTabId)?.sessionId;
  const isSftp = activePanelId === SFTP_PANEL_ID;
  useEffect(() => {
    if (!isSftp || activeSessionId) return;
    const state = usePanelStore.getState();
    if (state.activePanelId === SFTP_PANEL_ID) state.togglePanel(SFTP_PANEL_ID);
  }, [isSftp, activeSessionId]);

  const activePanel = panels.find(p => p.id === activePanelId) ?? null;
  const currentSize = activePanelId ? (panelSizes[activePanelId] ?? 320) : 0;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!activePanelId || !activePanel) return;
    e.preventDefault();

    if (activePanel.position === 'right') {
      const startX = e.clientX;
      const startWidth = currentSize;

      const onMouseMove = (mv: MouseEvent) => {
        setPanelSize(activePanelId, startWidth - (mv.clientX - startX));
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

    } else if (activePanel.position === 'bottom') {
      const startY = e.clientY;
      const startHeight = currentSize;

      const onMouseMove = (mv: MouseEvent) => {
        setPanelSize(activePanelId, startHeight - (mv.clientY - startY));
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }
  }, [activePanelId, activePanel, currentSize, setPanelSize]);

  const PanelComponent = activePanel?.component;
  const showPanel = PanelComponent && activeTabId && activeTabId !== 'settings' && (!isSftp || activeSessionId);
  const isBottom = showPanel && activePanel?.position === 'bottom';

  return (
    <div className={`flex w-full h-full min-h-0 ${isBottom ? 'flex-col' : ''}`}>
      <div className="flex-1 relative min-w-0 min-h-0 overflow-hidden">
        {children}
      </div>
      {showPanel && (
        <div
          className={`workbench-dock shrink-0 relative flex flex-col ${isBottom ? 'shadow-[inset_0_1px_0_var(--color-line-soft)]' : 'shadow-[inset_1px_0_0_var(--color-line-soft)]'}`}
          style={isBottom ? { height: currentSize } : { width: currentSize }}
        >
          <div
            className={`workbench-dock-resizer absolute top-0 left-0 z-50 hover:bg-primary/70 ${isBottom
              ? 'right-0 h-px hover:h-1 -translate-y-1/2 cursor-row-resize'
              : 'bottom-0 w-px hover:w-1 -translate-x-1/2 cursor-col-resize'}`}
            onMouseDown={handleMouseDown}
          />
          <PanelComponent key={isSftp ? activeSessionId : activePanelId} sessionId={activeSessionId || ''} isDark={isDark} />
        </div>
      )}
    </div>
  );
};
