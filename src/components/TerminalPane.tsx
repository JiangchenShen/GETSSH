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
      className={`relative flex flex-col w-full h-full min-w-0 min-h-0 transition-all ${
        isActive
          ? 'ring-1 ring-inset ring-primary/60'
          : 'ring-1 ring-inset ring-transparent'
      }`}
      onClick={() => setActivePaneId(node.paneId)}
    >
      {/* Pane toolbar — only visible when focused */}
      {isActive && (
        <div
          className={`absolute top-1 right-1 z-20 flex items-center gap-0.5 rounded-md px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
            isDark ? 'bg-black/60' : 'bg-white/80'
          }`}
          style={{ opacity: 1 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            title="Split Right"
            onClick={() => onSplit(node.paneId, 'hsplit')}
            className={`p-1 rounded hover:bg-primary/20 transition-colors ${isDark ? 'text-white/60 hover:text-white' : 'text-black/50 hover:text-black'}`}
          >
            <Columns className="w-3.5 h-3.5" />
          </button>
          <button
            title="Split Down"
            onClick={() => onSplit(node.paneId, 'vsplit')}
            className={`p-1 rounded hover:bg-primary/20 transition-colors ${isDark ? 'text-white/60 hover:text-white' : 'text-black/50 hover:text-black'}`}
          >
            <Rows className="w-3.5 h-3.5" />
          </button>
          <button
            title="Close Pane"
            onClick={() => onClosePane(node.paneId)}
            className={`p-1 rounded hover:bg-red-500/20 transition-colors ${isDark ? 'text-white/40 hover:text-red-400' : 'text-black/40 hover:text-red-500'}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

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
