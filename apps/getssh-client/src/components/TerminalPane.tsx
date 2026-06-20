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
  parentDirection?: 'hsplit' | 'vsplit';
}



// ── Divider / Resizer ─────────────────────────────────────────────────────

const Divider: React.FC<{
  direction: 'hsplit' | 'vsplit';
  isDark: boolean;
  onDragStart: (e: React.PointerEvent<HTMLDivElement>) => void;
}> = ({ direction, isDark, onDragStart }) => (
  <div
    onPointerDown={onDragStart}
    className={`group shrink-0 relative z-10 flex items-center justify-center ${
      direction === 'hsplit' ? 'w-4 cursor-col-resize h-full' : 'h-4 cursor-row-resize w-full'
    }`}
  >
    <div className={`transition-all duration-200 ease-out rounded-full ${
      direction === 'hsplit' 
        ? 'w-[2px] h-8 group-hover:bg-primary/80' 
        : 'h-[2px] w-8 group-hover:bg-primary/80'
    } ${isDark ? 'bg-[#333]' : 'bg-black/20'}`} />
  </div>
);

// ── Split Pane (recursive) ────────────────────────────────────────────────

const SplitPaneNode: React.FC<{
  node: PaneSplit;
  tabId: string;
  appConfig: any;
  isDark: boolean;
  isTabActive: boolean;
  onSplit: (paneId: string, direction: 'hsplit' | 'vsplit') => void;
}> = ({ node, tabId, appConfig, isDark, isTabActive, onSplit }) => {
  const patchNexusSizes = useSessionStore(s => s.patchNexusSizes);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const rect = container.getBoundingClientRect();
    const isHorizontal = node.type === 'hsplit';
    const totalSize = isHorizontal ? rect.width : rect.height;
    const startPos = isHorizontal ? e.clientX : e.clientY;
    const startSizes: [number, number] = [...node.sizes] as [number, number];

    const onMove = (mv: PointerEvent) => {
      const delta = (isHorizontal ? mv.clientX : mv.clientY) - startPos;
      const deltaPercent = (delta / totalSize) * 100;
      const newFirst = Math.max(10, Math.min(90, startSizes[0] + deltaPercent));
      const newSecond = 100 - newFirst;
      patchNexusSizes(tabId, node.paneId, [newFirst, newSecond]);
    };

    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }, [node, tabId, patchNexusSizes]);

  const isHorizontal = node.type === 'hsplit';

  return (
    <div
      ref={containerRef}
      className={`flex w-full h-full min-w-0 min-h-0 ${isHorizontal ? 'flex-row' : 'flex-col'}`}
    >
      <div
        className="min-w-0 min-h-0 overflow-hidden"
        style={{ flex: `0 0 calc(${node.sizes[0]}% - 8px)` }}
      >
        <TerminalPaneRenderer
          node={node.children[0]}
          tabId={tabId}
          appConfig={appConfig}
          isDark={isDark}
          isTabActive={isTabActive}
          onSplit={onSplit}
          parentDirection={node.type}
        />
      </div>

      <Divider direction={node.type} isDark={isDark} onDragStart={handleDragStart} />

      <div
        className="min-w-0 min-h-0 overflow-hidden"
        style={{ flex: `0 0 calc(${node.sizes[1]}% - 8px)` }}
      >
        <TerminalPaneRenderer
          node={node.children[1]}
          tabId={tabId}
          appConfig={appConfig}
          isDark={isDark}
          isTabActive={isTabActive}
          onSplit={onSplit}
          parentDirection={node.type}
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
        key={node.paneId}
        node={node}
        tabId={props.tabId}
        appConfig={props.appConfig}
        isDark={props.isDark}
        isTabActive={props.isTabActive}
        onSplit={props.onSplit}
        parentDirection={props.parentDirection}
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
    />
  );
};
