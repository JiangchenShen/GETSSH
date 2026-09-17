import React, { useRef, useEffect, useState } from 'react';
import { getTerminalBuffer } from './Terminal';
import { PaneLeaf, PaneNode, useSessionStore, isSSHConfig } from '../store/sessionStore';
import { useShallow } from 'zustand/react/shallow';
import { Columns, Rows, X, TerminalSquare, Maximize, Minimize, ExternalLink, ArrowDownToLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { paneRegistry } from '../registry/paneRegistry';

function countLeaves(node: PaneNode | undefined): number {
  if (!node) return 0;
  if (node.type === 'leaf') return 1;
  return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

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
  const isHollow = new URLSearchParams(window.location.search).get('isHollow') === 'true';
  const activePaneId = useSessionStore(state => state.activePaneId);
  const setActivePaneId = useSessionStore(s => s.setActivePaneId);
  const isActive = activePaneId === node.paneId;
  const welcomeRef = useRef<HTMLDivElement>(null);
  const lastSplitTime = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canSplit, setCanSplit] = useState(true);

  // Anti-collapse protection
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanSplit(width >= 200 && height >= 200);
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
  
  const totalPanes = countLeaves(paneTree as PaneNode);
  const isMaxPanes = totalPanes >= 4;

  const isZoomed = node.isZoomed;
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
          {!isMaxPanes && (
            <>
              {parentDirection !== 'hsplit' && (
                <button
                  title={t('pane.splitRight', 'Split Right')}
                  disabled={!canSplit}
                  onClick={(e) => { e.stopPropagation(); handleSplit('hsplit'); }}
                  className={`w-[18px] h-[18px] rounded grid place-items-center transition-colors ${!canSplit ? 'opacity-25 cursor-not-allowed text-ink-3' : 'text-ink-3 hover:bg-surf-2 hover:text-ink'}`}
                >
                  <Columns className="w-3 h-3" />
                </button>
              )}
              {parentDirection !== 'vsplit' && (
                <button
                  title="Split Down"
                  disabled={!canSplit}
                  onClick={(e) => { e.stopPropagation(); handleSplit('vsplit'); }}
                  className={`w-[18px] h-[18px] rounded grid place-items-center transition-colors ${!canSplit ? 'opacity-25 cursor-not-allowed text-ink-3' : 'text-ink-3 hover:bg-surf-2 hover:text-ink'}`}
                >
                  <Rows className="w-3 h-3" />
                </button>
              )}
              <div className="w-px h-3 mx-1 bg-line"></div>
            </>
          )}
          <button
            title={isZoomed ? "Exit Zen Mode" : "Zen Mode"}
            onClick={(e) => { 
              e.stopPropagation(); 
              window.electronAPI.nexusToggleZoom(node.paneId).catch(console.error);
            }}
            className={`w-[18px] h-[18px] rounded grid place-items-center transition-colors ${isZoomed ? 'text-primary bg-primary/10' : 'text-ink-3 hover:bg-surf-2 hover:text-ink'}`}
          >
            {isZoomed ? <Minimize className="w-3 h-3" /> : <Maximize className="w-3 h-3" />}
          </button>
          {!isHollow ? (
            <button
              title="Tear Off (Native Window)"
              onClick={(e) => { 
                e.stopPropagation(); 
                window.electronAPI.windowTearArm();
                const terminalBuffers: Record<string, string> = {};
                if (node.sessionId) {
                  const buf = getTerminalBuffer(node.sessionId);
                  (window.electronAPI as any).hollowLog?.('Sending buf to IPC, len:', buf?.length);
                  if (buf) terminalBuffers[node.sessionId] = buf;
                }
                window.electronAPI.windowTearExecute({
                   screenX: window.screenX + 50,
                   screenY: window.screenY + 50,
                   width: Math.max(800, window.outerWidth * 0.8),
                   height: Math.max(600, window.outerHeight * 0.8),
                   paneId: node.paneId,
                   terminalBuffers,
                   tornTitle: tabTitle
                });
              }}
              className="w-[18px] h-[18px] rounded grid place-items-center text-ink-3 transition-colors hover:bg-surf-2 hover:text-ink"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          ) : (
            <button
              title="Attach to Main Window"
              onClick={(e) => { 
                e.stopPropagation(); 
                const terminalBuffers: Record<string, string> = {};
                if (node.sessionId) {
                  const buf = getTerminalBuffer(node.sessionId);
                  if (buf) terminalBuffers[node.sessionId] = buf;
                }
                window.electronAPI.windowTearIn({
                   paneId: node.paneId,
                   terminalBuffers
                });
              }}
              className="w-[18px] h-[18px] rounded grid place-items-center text-ink-3 transition-colors hover:bg-surf-2 hover:text-ink"
            >
              <ArrowDownToLine className="w-3 h-3" />
            </button>
          )}
          <button
            title="Close Pane"
            onClick={(e) => { 
              e.stopPropagation(); 
              window.electronAPI.nexusClosePane(node.paneId).catch(console.error); 
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
          useSessionStore.getState().patchNexusLeaf(node.paneId, { isDisconnected: val });
        },
        onClosePane: () => {
          window.electronAPI?.nexusClosePane(node.paneId).catch(console.error);
        },
        onReconnect: () => {
          if (!isSSHConfig(node.config)) return;
          const payload = { ...node.config, enableAuditLogging: appConfig.enableAuditLogging };
          window.electronAPI.sshConnect(payload).then(res => {
            if (res.success && res.sessionId) {
              useSessionStore.getState().patchNexusLeaf(node.paneId, { sessionId: res.sessionId });
            }
          });
        }
      })}
    </div>
  );
};
