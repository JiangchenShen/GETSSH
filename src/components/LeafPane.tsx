import { CommandCenter } from './CommandCenter';
import React, { useRef, useEffect } from 'react';
import { Terminal as TerminalComponent } from './Terminal';
import { PaneLeaf, PaneNode, useSessionStore, patchLeafDisconnected, isSSHConfig } from '../store/sessionStore';
import { Columns, Rows, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PluginPane } from './PluginPane';

export const LeafPane: React.FC<{
  node: PaneLeaf;
  tabId: string;
  appConfig: any;
  isDark: boolean;
  isTabActive: boolean;
  onSplit: (paneId: string, direction: 'hsplit' | 'vsplit') => void;
  onClosePane: (paneId: string) => void;
  onConnectInPane: (paneId: string, session: any) => void;
}> = ({ node, tabId, appConfig, isDark, isTabActive, onSplit, onClosePane,  onConnectInPane
}) => {
  const { t } = useTranslation();
  const activePaneId = useSessionStore(state => state.activePaneId);
  const setActivePaneId = useSessionStore(s => s.setActivePaneId);
  const isActive = activePaneId === node.paneId;
  const welcomeRef = useRef<HTMLDivElement>(null);
  const lastSplitTime = useRef<number>(0);

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
           {node.paneType === 'welcome' ? t('welcome.selectHost', '选择主机') : (node.paneType === 'plugin' ? (tabTitle || 'Plugin') : (isSSHConfig(node.config) ? `${node.config.username || ''}@${node.config.host || ''}` : ''))}
        </span>
        <div className="flex items-center gap-1">
          <button
            title="Split Right"
            onClick={(e) => { e.stopPropagation(); handleSplit('hsplit'); }}
            className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-white/20 text-white/70' : 'hover:bg-black/10 text-black/70'}`}
          >
            <Columns className="w-3.5 h-3.5" />
          </button>
          <button
            title="Split Down"
            onClick={(e) => { e.stopPropagation(); handleSplit('vsplit'); }}
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
            if (!isSSHConfig(node.config)) return;
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
        <CommandCenter 
          onConnect={(s) => onConnectInPane(node.paneId, s)} 
          onOpenPlugin={(plugin) => {
             useSessionStore.setState(state => ({
                tabs: state.tabs.map(t => {
                  if (t.id !== tabId || !t.paneTree) return t;
                  const entryFile = (plugin as any).getssh?.entry || plugin.main || 'index.html';
                  const pluginUrl = `getssh-plugin://${plugin.name}/${entryFile}`;
                  return {
                    ...t,
                    paneTree: patchLeafToPlugin(t.paneTree, node.paneId, pluginUrl),
                  };
                }),
             }));
          }}
        />
      )}

      {node.paneType === 'plugin' && (
        <PluginPane paneId={node.paneId} isDark={isDark} pluginUrl={node.config && 'pluginUrl' in node.config ? node.config.pluginUrl : undefined} />
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

function patchLeafToPlugin(node: PaneNode, paneId: string, pluginUrl: string): PaneNode {
  if (node.type === 'leaf') {
    return node.paneId === paneId
      ? { ...node, paneType: 'plugin', config: { pluginUrl: pluginUrl || '' } }
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
