import React, { useRef, useEffect, useState } from 'react';
import { Terminal as TerminalComponent } from './Terminal';
import { PaneLeaf, PaneNode, useSessionStore, isSSHConfig } from '../store/sessionStore';
import { Columns, Rows, X, TerminalSquare, Maximize, Minimize, ExternalLink } from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';
import { PluginPane } from './PluginPane';

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

  const tabTitle = useSessionStore(state => state.tabs.find(t => t.id === tabId)?.title);
  const paneTree = useSessionStore(state => state.tabs.find(t => t.id === tabId)?.paneTree);
  
  const totalPanes = countLeaves(paneTree as PaneNode);
  const isMaxPanes = totalPanes >= 4;

  const isZoomed = node.isZoomed;
  const zoomClasses = isZoomed 
    ? `absolute bottom-4 left-4 right-4 top-12 z-[100] shadow-[0_0_100px_rgba(0,0,0,0.8)] ring-1 ring-[#222] rounded-2xl overflow-hidden ${isDark ? 'bg-[#0a0a0a]' : 'bg-slate-50'}` 
    : `relative w-full h-full ${isDark ? 'bg-[#0a0a0a] border border-[#222]' : 'bg-white border border-gray-200'} rounded-2xl overflow-hidden`;

  return (
    <div
      ref={containerRef}
      className={`group flex flex-col min-w-0 min-h-0 transition-all duration-200 ${zoomClasses}`}
      onClick={() => setActivePaneId(node.paneId)}
    >
      {/* Pane header with title and toolbar */}
      <div
        className={`relative z-10 flex-none flex items-center justify-between px-4 h-[38px] text-xs select-none transition-colors border-b ${
          isDark ? (isActive ? 'bg-[#1a1a1a] border-[#222]' : 'bg-[#111] border-[#222]') : (isActive ? 'bg-slate-100 border-gray-200' : 'bg-slate-50 border-gray-100')
        }`}
      >
        <div className="flex items-center gap-2 text-gray-400">
           <TerminalSquare className="w-4 h-4 opacity-70" />
           <span className="truncate font-medium text-sm">
             {node.paneType === 'welcome' ? t('welcome.selectHost', '选择主机') : (node.paneType === 'plugin' ? (tabTitle || 'Plugin') : (isSSHConfig(node.config) ? `${node.config.username || ''}@${node.config.host || ''}` : ''))}
           </span>
        </div>
        <div className={`flex items-center gap-1 transition-opacity ${isActive || isZoomed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {!isMaxPanes && (
            <>
              {parentDirection !== 'hsplit' && (
                <button
                  title={t('pane.splitRight', 'Split Right')}
                  disabled={!canSplit}
                  onClick={(e) => { e.stopPropagation(); handleSplit('hsplit'); }}
                  className={`p-1 rounded transition-colors ${!canSplit ? 'opacity-20 cursor-not-allowed' : (isDark ? 'hover:bg-white/20 text-white/70' : 'hover:bg-black/10 text-black/70')}`}
                >
                  <Columns className="w-3.5 h-3.5" />
                </button>
              )}
              {parentDirection !== 'vsplit' && (
                <button
                  title="Split Down"
                  disabled={!canSplit}
                  onClick={(e) => { e.stopPropagation(); handleSplit('vsplit'); }}
                  className={`p-1 rounded transition-colors ${!canSplit ? 'opacity-20 cursor-not-allowed' : (isDark ? 'hover:bg-white/20 text-white/70' : 'hover:bg-black/10 text-black/70')}`}
                >
                  <Rows className="w-3.5 h-3.5" />
                </button>
              )}
              <div className={`w-[1px] h-3 mx-1 ${isDark ? 'bg-white/10' : 'bg-black/10'}`}></div>
            </>
          )}
          <button
            title={isZoomed ? "Exit Zen Mode" : "Zen Mode"}
            onClick={(e) => { 
              e.stopPropagation(); 
              window.electronAPI.nexusToggleZoom(node.paneId).catch(console.error);
            }}
            className={`p-1 rounded transition-colors ${isZoomed ? 'text-cyan-400 bg-cyan-400/10' : (isDark ? 'hover:bg-white/20 text-white/70' : 'hover:bg-black/10 text-black/70')}`}
          >
            {isZoomed ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          </button>
          <button
            title="Tear Off (Native Window)"
            onClick={(e) => { 
              e.stopPropagation(); 
              window.electronAPI.nexusTearOff(node.paneId).catch(console.error);
            }}
            className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-white/20 text-white/70' : 'hover:bg-black/10 text-black/70'}`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button
            title="Close Pane"
            onClick={(e) => { 
              e.stopPropagation(); 
              window.electronAPI.nexusClosePane(node.paneId).catch(console.error); 
            }}
            className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-red-500/30 text-white/70 hover:text-red-400' : 'hover:bg-red-500/20 text-black/70 hover:text-red-500'}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {node.paneType === 'terminal' && node.sessionId && (
        <TerminalComponent
          sessionId={node.sessionId}
          isDisconnected={node.isDisconnected ?? false}
          onDisconnectedChange={(val) => {
            useSessionStore.getState().patchNexusLeaf(node.paneId, { isDisconnected: val });
          }}
          onDisconnected={() => { window.electronAPI.nexusClosePane(node.paneId).catch(console.error); }}
          onReconnect={() => {
            if (!isSSHConfig(node.config)) return;
            window.electronAPI.sshConnect(node.config).then(res => {
              if (res.success && res.sessionId) {
                useSessionStore.getState().patchNexusLeaf(node.paneId, { sessionId: res.sessionId });
              }
            });
          }}
          config={appConfig}
          isDark={isDark}
          isActive={isTabActive && isActive}
        />
      )}

      {node.paneType === 'welcome' && (
        <div className="w-full h-full flex flex-col items-center justify-center bg-transparent min-h-0 overflow-y-auto">
          <div className="flex flex-col items-center gap-3 text-center px-4 py-4 min-h-min shrink-0">
            <div className="w-12 h-12 shrink-0 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <TerminalSquare className="w-6 h-6" />
            </div>
            <div className="shrink-0">
              <h3 className={`text-base font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{t('welcome.readyToConnect', 'Ready to Connect')}</h3>
              <p className={`text-xs mt-1.5 leading-relaxed ${isDark ? 'text-white/50' : 'text-slate-500'} max-w-[220px]`}>
                <Trans i18nKey="welcome.openCommandCenter">
                  Press <kbd className="px-1.5 py-0.5 rounded border border-current opacity-70 font-mono text-[10px] mx-0.5 shadow-sm bg-background">Ctrl+K</kbd> or <kbd className="px-1.5 py-0.5 rounded border border-current opacity-70 font-mono text-[10px] mx-0.5 shadow-sm bg-background">Option+Space</kbd> to open Command Center
                </Trans>
              </p>
            </div>
          </div>
        </div>
      )}

      {node.paneType === 'plugin' && (
        <PluginPane paneId={node.paneId} isDark={isDark} pluginUrl={node.config && 'pluginUrl' in node.config ? node.config.pluginUrl : undefined} />
      )}
    </div>
  );
};
