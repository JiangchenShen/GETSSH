import React, { useCallback, useRef, useEffect } from 'react';
import { Terminal as TerminalComponent } from './Terminal';
import { PaneLeaf, PaneSplit, PaneNode, useSessionStore, patchLeafDisconnected } from '../store/sessionStore';
import { Columns, Rows, X, Terminal as TerminalIcon, Cpu, Activity, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PluginPane } from './PluginPane';

interface TerminalPaneProps {
  node: PaneNode;
  tabId: string;
  appConfig: any;
  isDark: boolean;
  isTabActive: boolean;
  onSplit: (paneId: string, direction: 'hsplit' | 'vsplit') => void;
  onClosePane: (paneId: string) => void;
  onConnectInPane: (paneId: string, session: any) => void;
  sessions: any[];
}

// ── Leaf Pane ─────────────────────────────────────────────────────────────

const LeafPane: React.FC<{
  node: PaneLeaf;
  tabId: string;
  appConfig: any;
  isDark: boolean;
  isTabActive: boolean;
  onSplit: (paneId: string, direction: 'hsplit' | 'vsplit') => void;
  onClosePane: (paneId: string) => void;
  onConnectInPane: (paneId: string, session: any) => void;
  sessions: any[];
}> = ({ node, tabId, appConfig, isDark, isTabActive, onSplit, onClosePane,  onConnectInPane,
  sessions
}) => {
  const { t } = useTranslation();
  const activePaneId = useSessionStore(state => state.activePaneId);
  const setActivePaneId = useSessionStore(s => s.setActivePaneId);
  const isActive = activePaneId === node.paneId;
  const welcomeRef = useRef<HTMLDivElement>(null);

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

  return (
    <div
      className="relative flex flex-col w-full h-full min-w-0 min-h-0 transition-all bg-transparent"
      onClick={() => setActivePaneId(node.paneId)}
    >
      {/* Pane header with title and toolbar */}
      <div
        className={`relative z-10 flex-none flex items-center justify-between px-2 py-1 text-xs select-none transition-colors ${
          isActive 
            ? (isDark ? 'bg-white/10 text-white' : 'bg-black/10 text-black') 
            : (isDark ? 'bg-black/20 text-white/50' : 'bg-black/5 text-black/50')
        }`}
      >
        <span className="truncate opacity-70 font-medium">
           {node.paneType === 'welcome' ? t('welcome.selectHost', '选择主机') : (node.paneType === 'plugin' ? 'Plugin' : `${node.config?.username || ''}@${node.config?.host || ''}`)}
        </span>
        <div className="flex items-center gap-1">
          <button
            title="Split Right"
            onClick={(e) => { e.stopPropagation(); onSplit(node.paneId, 'hsplit'); }}
            className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-white/20 text-white/70' : 'hover:bg-black/10 text-black/70'}`}
          >
            <Columns className="w-3.5 h-3.5" />
          </button>
          <button
            title="Split Down"
            onClick={(e) => { e.stopPropagation(); onSplit(node.paneId, 'vsplit'); }}
            className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-white/20 text-white/70' : 'hover:bg-black/10 text-black/70'}`}
          >
            <Rows className="w-3.5 h-3.5" />
          </button>
          <button
            title="Close Pane"
            onClick={(e) => { e.stopPropagation(); onClosePane(node.paneId); }}
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
            useSessionStore.setState(state => ({
              tabs: state.tabs.map(tab => {
                if (tab.id !== tabId || !tab.paneTree) return tab;
                return { ...tab, paneTree: patchLeafDisconnected(tab.paneTree, node.paneId, val) };
              }),
            }));
          }}
          onDisconnected={() => { onClosePane(node.paneId); }}
          onReconnect={() => {
            window.electronAPI.sshConnect(node.config).then(res => {
              if (res.success && res.sessionId) {
                useSessionStore.setState(state => ({
                  tabs: state.tabs.map(tab => {
                    if (tab.id !== tabId || !tab.paneTree) return tab;
                    return { ...tab, paneTree: patchLeafSessionId(tab.paneTree, node.paneId, res.sessionId!) };
                  }),
                }));
              }
            });
          }}
          config={appConfig}
          isDark={isDark}
          isActive={isTabActive && isActive}
        />
      )}

      {node.paneType === 'welcome' && (
        <div
          ref={welcomeRef}
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); welcomeRef.current?.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClosePane(node.paneId);
            }
          }}
          className="flex-1 overflow-y-auto p-8 flex flex-col items-center justify-center gap-8 focus:outline-none cursor-default"
        >

          {/* ─── Command Center Header ─────────────────── */}
          <div className="w-full max-w-3xl">
            <p className={`text-xs font-semibold tracking-[0.2em] uppercase mb-1 ${
              isDark ? 'text-white/30' : 'text-black/30'
            }`}>GETSSH {t('welcome.commandCenter', 'Command Center')}</p>
            <h1 className={`text-2xl font-bold tracking-tight ${
              isDark ? 'text-white/90' : 'text-black/90'
            }`}>{t('welcome.whereTo', 'Where do you want to go?')}</h1>
          </div>

          {/* ─── Section A: Remote Infrastructure ────── */}
          <div className="w-full max-w-3xl flex flex-col gap-3">
            <div className={`flex items-center gap-2.5 pb-2.5 border-b ${
              isDark ? 'border-white/10' : 'border-black/10'
            }`}>
              <div className={`p-1.5 rounded-lg ${
                isDark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-500/10 text-emerald-600'
              }`}>
                <Server className="w-3.5 h-3.5" />
              </div>
              <span className={`text-sm font-semibold tracking-wide ${
                isDark ? 'text-white/70' : 'text-black/70'
              }`}>{t('welcome.remoteInfrastructure', '远程服务器')}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ml-auto ${
                isDark ? 'bg-white/5 text-white/30' : 'bg-black/5 text-black/30'
              }`}>{t('welcome.hostsCount', `${sessions.length} 个主机`, { count: sessions.length })}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {sessions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => onConnectInPane(node.paneId, s)}
                  className={`group relative p-4 rounded-2xl border text-left transition-all duration-200 flex items-center gap-4 ${
                    isDark
                      ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                      : 'bg-black/5 border-black/10 hover:bg-black/10 hover:border-black/20'
                  }`}
                >
                  <div className={`shrink-0 p-2.5 rounded-xl transition-colors ${
                    isDark ? 'bg-white/5 group-hover:bg-white/10' : 'bg-black/5 group-hover:bg-black/10'
                  }`}>
                    <TerminalIcon className={`w-5 h-5 transition-colors ${
                      isDark ? 'text-white/60 group-hover:text-white/90' : 'text-black/60 group-hover:text-black/90'
                    }`} />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className={`font-medium text-sm truncate transition-colors ${
                      isDark ? 'text-white/90' : 'text-black/90'
                    }`}>{s.host}</div>
                    <div className={`text-xs truncate mt-0.5 ${
                      isDark ? 'text-white/40' : 'text-black/40'
                    }`}>{s.username}</div>
                  </div>
                </button>
              ))}
              {sessions.length === 0 && (
                <div className={`col-span-full text-center py-6 text-sm rounded-2xl border border-dashed flex items-center justify-center ${
                  isDark ? 'text-white/30 border-white/10 bg-white/5' : 'text-black/30 border-black/10 bg-black/5'
                }`}>
                  {t('welcome.noSavedSessions', 'No saved sessions. Add one in the sidebar.')}
                </div>
              )}
            </div>
          </div>

          {/* ─── Section B: Local Extensions ─────────── */}
          <div className="w-full max-w-3xl flex flex-col gap-3">
            <div className={`flex items-center gap-2.5 pb-2.5 border-b ${
              isDark ? 'border-white/10' : 'border-black/10'
            }`}>
              <div className={`p-1.5 rounded-lg ${
                isDark ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-500/10 text-blue-600'
              }`}>
                <Cpu className="w-3.5 h-3.5" />
              </div>
              <span className={`text-sm font-semibold tracking-wide ${
                isDark ? 'text-white/70' : 'text-black/70'
              }`}>{t('welcome.localExtensions', '本地工具 & 插件')}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* System Monitor Demo Card */}
              <button
                onClick={() => {
                  useSessionStore.setState(state => ({
                    tabs: state.tabs.map(t => {
                      if (t.id !== tabId || !t.paneTree) return t;
                      return {
                        ...t,
                        paneTree: patchLeafToPlugin(t.paneTree, node.paneId, '/plugins/sysmon/index.html'),
                      };
                    }),
                  }));
                }}
                className={`group relative p-4 rounded-2xl border text-left transition-all duration-200 flex items-center gap-4 ${
                  isDark
                    ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                    : 'bg-black/5 border-black/10 hover:bg-black/10 hover:border-black/20'
                }`}
              >
                <div className={`shrink-0 p-2.5 rounded-xl transition-colors ${
                  isDark ? 'bg-white/5 group-hover:bg-white/10' : 'bg-black/5 group-hover:bg-black/10'
                }`}>
                  <Activity className={`w-5 h-5 transition-colors ${
                    isDark ? 'text-white/60 group-hover:text-white/90' : 'text-black/60 group-hover:text-black/90'
                  }`} />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className={`font-medium text-sm truncate transition-colors ${
                    isDark ? 'text-white/90' : 'text-black/90'
                  }`}>{t('welcome.systemMonitor', '系统监控')}</div>
                  <div className={`text-xs truncate mt-0.5 ${
                    isDark ? 'text-white/40' : 'text-black/40'
                  }`}>{t('welcome.sysmonDesc', '本地沙盒化资源监控。')}</div>
                </div>
              </button>

              {/* Future plugins placeholder */}
              <div className={`p-4 rounded-2xl border border-dashed flex items-center justify-center gap-2 ${
                isDark ? 'border-white/10 text-white/30 bg-white/5' : 'border-black/10 text-black/30 bg-black/5'
              }`}>
                <span className="text-xs">{t('welcome.morePlugins', '更多插件敬请期待...')}</span>
              </div>
            </div>
          </div>

        </div>
      )}

      {node.paneType === 'plugin' && (
        <PluginPane paneId={node.paneId} isDark={isDark} pluginUrl={node.config?.pluginUrl} />
      )}
    </div>
  );
};

function patchLeafSessionId(node: PaneNode, paneId: string, newSessionId: string): PaneNode {
  if (node.type === 'leaf') {
    return node.paneId === paneId ? { ...node, sessionId: newSessionId } : node;
  }
  return {
    ...node,
    children: [
      patchLeafSessionId(node.children[0], paneId, newSessionId),
      patchLeafSessionId(node.children[1], paneId, newSessionId),
    ] as [PaneNode, PaneNode],
  };
}

function patchLeafToPlugin(node: PaneNode, paneId: string, pluginUrl?: string): PaneNode {
  if (node.type === 'leaf') {
    return node.paneId === paneId
      ? { ...node, paneType: 'plugin', config: { ...(node.config || {}), pluginUrl } }
      : node;
  }
  return {
    ...node,
    children: [
      patchLeafToPlugin(node.children[0], paneId, pluginUrl),
      patchLeafToPlugin(node.children[1], paneId, pluginUrl),
    ] as [PaneNode, PaneNode],
  };
}

// ── Divider / Resizer ─────────────────────────────────────────────────────

const Divider: React.FC<{
  direction: 'hsplit' | 'vsplit';
  isDark: boolean;
  onDragStart: (e: React.MouseEvent) => void;
}> = ({ direction, isDark, onDragStart }) => (
  <div
    onMouseDown={onDragStart}
    className={`shrink-0 transition-colors hover:bg-primary/50 ${
      isDark ? 'bg-white/10' : 'bg-black/10'
    } ${
      direction === 'hsplit'
        ? 'w-[4px] cursor-col-resize h-full'
        : 'h-[4px] cursor-row-resize w-full'
    }`}
  />
);

// ── Split Pane (recursive) ────────────────────────────────────────────────

const SplitPaneNode: React.FC<{
  node: PaneSplit;
  tabId: string;
  appConfig: any;
  isDark: boolean;
  isTabActive: boolean;
  onSplit: (paneId: string, direction: 'hsplit' | 'vsplit') => void;
  onClosePane: (paneId: string) => void;
  onConnectInPane: (paneId: string, session: any) => void;
  sessions: any[];
}> = ({ node, tabId, appConfig, isDark, isTabActive, onSplit, onClosePane, onConnectInPane, sessions }) => {
  const updatePaneSizes = useSessionStore(s => s.updatePaneSizes);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const isHorizontal = node.type === 'hsplit';
    const totalSize = isHorizontal ? rect.width : rect.height;
    const startPos = isHorizontal ? e.clientX : e.clientY;
    const startSizes: [number, number] = [...node.sizes] as [number, number];

    const onMove = (mv: MouseEvent) => {
      const delta = (isHorizontal ? mv.clientX : mv.clientY) - startPos;
      const deltaPercent = (delta / totalSize) * 100;
      const newFirst = Math.max(10, Math.min(90, startSizes[0] + deltaPercent));
      const newSecond = 100 - newFirst;
      updatePaneSizes(tabId, node.paneId, [newFirst, newSecond]);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [node, tabId, updatePaneSizes]);

  const isHorizontal = node.type === 'hsplit';

  return (
    <div
      ref={containerRef}
      className={`flex w-full h-full min-w-0 min-h-0 ${isHorizontal ? 'flex-row' : 'flex-col'}`}
    >
      <div
        className="min-w-0 min-h-0 overflow-hidden"
        style={isHorizontal ? { width: `${node.sizes[0]}%` } : { height: `${node.sizes[0]}%` }}
      >
        <TerminalPaneRenderer
          node={node.children[0]}
          tabId={tabId}
          appConfig={appConfig}
          isDark={isDark}
          isTabActive={isTabActive}
          onSplit={onSplit}
          onClosePane={onClosePane}
          onConnectInPane={onConnectInPane}
          sessions={sessions}
        />
      </div>

      <Divider direction={node.type} isDark={isDark} onDragStart={handleDragStart} />

      <div
        className="flex-1 min-w-0 min-h-0 overflow-hidden"
        style={isHorizontal ? { width: `${node.sizes[1]}%` } : { height: `${node.sizes[1]}%` }}
      >
        <TerminalPaneRenderer
          node={node.children[1]}
          tabId={tabId}
          appConfig={appConfig}
          isDark={isDark}
          isTabActive={isTabActive}
          onSplit={onSplit}
          onClosePane={onClosePane}
          onConnectInPane={onConnectInPane}
          sessions={sessions}
        />
      </div>
    </div>
  );
};

// ── Public: Recursive renderer ────────────────────────────────────────────

export const TerminalPaneRenderer: React.FC<TerminalPaneProps> = (props) => {
  const { node } = props;

  if (node.type === 'leaf') {
    return (
      <LeafPane
        key={node.sessionId}
        node={node}
        tabId={props.tabId}
        appConfig={props.appConfig}
        isDark={props.isDark}
        isTabActive={props.isTabActive}
        onSplit={props.onSplit}
        onClosePane={props.onClosePane}
        onConnectInPane={props.onConnectInPane}
        sessions={props.sessions}
      />
    );
  }

  return (
    <SplitPaneNode
      node={node}
      tabId={props.tabId}
      appConfig={props.appConfig}
      isDark={props.isDark}
      isTabActive={props.isTabActive}
      onSplit={props.onSplit}
      onClosePane={props.onClosePane}
      onConnectInPane={props.onConnectInPane}
      sessions={props.sessions}
    />
  );
};
