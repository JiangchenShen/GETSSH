import React, { useCallback, useRef } from 'react';
import { Terminal as TerminalComponent } from './Terminal';
import { PaneLeaf, PaneSplit, PaneNode, useSessionStore } from '../store/sessionStore';
import { Columns, Rows, X } from 'lucide-react';

interface TerminalPaneProps {
  node: PaneNode;
  tabId: string;
  appConfig: any;
  isDark: boolean;
  isTabActive: boolean;
  onSplit: (paneId: string, direction: 'hsplit' | 'vsplit') => void;
  onClosePane: (paneId: string) => void;
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
}> = ({ node, tabId, appConfig, isDark, isTabActive, onSplit, onClosePane }) => {
  const activePaneId = useSessionStore(s => s.activePaneId);
  const setActivePaneId = useSessionStore(s => s.setActivePaneId);
  const isActive = activePaneId === node.paneId;

  return (
    <div
      className="relative flex flex-col w-full h-full min-w-0 min-h-0 transition-all bg-transparent"
      onClick={() => setActivePaneId(node.paneId)}
    >
      {/* Pane header with title and toolbar */}
      <div
        className={`flex-none flex items-center justify-between px-2 py-1 text-xs select-none transition-colors ${
          isActive 
            ? (isDark ? 'bg-primary/20 text-white' : 'bg-primary/10 text-primary') 
            : (isDark ? 'bg-black/20 text-white/50' : 'bg-black/5 text-black/50')
        }`}
      >
        <span className="truncate opacity-70 font-medium">
           {node.config.username}@{node.config.host}
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

      <TerminalComponent
        sessionId={node.sessionId}
        onDisconnected={() => {}}
        onReconnect={() => {
          window.electronAPI.sshConnect(node.config).then(res => {
            if (res.success && res.sessionId) {
              // Patch the pane tree: replace the leaf's sessionId
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
}> = ({ node, tabId, appConfig, isDark, isTabActive, onSplit, onClosePane }) => {
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
    />
  );
};
