import React, { useCallback, useRef } from 'react';
import { LeafPane } from './LeafPane';
import { PaneSplit, PaneNode, useSessionStore } from '../store/sessionStore';


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
