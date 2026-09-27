import React, { useCallback, useMemo, useRef } from 'react';
import { LeafPane } from './LeafPane';
import { PaneLeaf, PaneSplit, PaneNode, useSessionStore } from '../store/sessionStore';


interface TerminalPaneProps {
  node: PaneNode;
  tabId: string;
  appConfig: any;
  isDark: boolean;
  isTabActive: boolean;
  onSplit: (paneId: string, direction: 'hsplit' | 'vsplit') => void;
  parentDirection?: 'hsplit' | 'vsplit';
}

// ── Layout ────────────────────────────────────────────────────────────────
// Leaves are rendered flat, keyed by paneId, so a split, a sibling close or a re-dock never remounts them
// (plugin iframes and center panes keep their state). Rectangles are `pct% + px` pairs relative to the tab
// container: each child of a split gets its share minus 8px, leaving a 16px gutter for the divider.

const HALF_GUTTER = 8;

type Len = { pct: number; px: number };
interface Rect { left: Len; top: Len; width: Len; height: Len }
interface LeafSlot { node: PaneLeaf; rect: Rect; parentDirection?: 'hsplit' | 'vsplit' }
interface SplitSlot { node: PaneSplit; rect: Rect; gutter: Rect }

const FULL_RECT: Rect = { left: { pct: 0, px: 0 }, top: { pct: 0, px: 0 }, width: { pct: 100, px: 0 }, height: { pct: 100, px: 0 } };

const addLen = (a: Len, b: Len): Len => ({ pct: a.pct + b.pct, px: a.px + b.px });
const scaleLen = (a: Len, f: number): Len => ({ pct: a.pct * f, px: a.px * f });
const lenToCss = ({ pct, px }: Len) =>
  px === 0 ? `${pct}%` : pct === 0 ? `${px}px` : `calc(${pct}% ${px < 0 ? '-' : '+'} ${Math.abs(px)}px)`;
const lenToPx = ({ pct, px }: Len, total: number) => (pct / 100) * total + px;
const rectStyle = (r: Rect): React.CSSProperties => ({
  left: lenToCss(r.left), top: lenToCss(r.top), width: lenToCss(r.width), height: lenToCss(r.height),
});

// Depth-first, so leaves come out in tree order. nexus-core only inserts or removes leaves (never reorders them),
// so React never has to move an existing wrapper in the DOM (a moved iframe would reload).
function layoutTree(node: PaneNode, rect: Rect, parentDirection: LeafSlot['parentDirection'], leaves: LeafSlot[], splits: SplitSlot[]) {
  if (node.type === 'leaf') {
    leaves.push({ node, rect, parentDirection });
    return;
  }
  const isHorizontal = node.type === 'hsplit';
  const start = isHorizontal ? rect.left : rect.top;
  const extent = isHorizontal ? rect.width : rect.height;
  const along = (pos: Len, size: Len): Rect => (isHorizontal ? { ...rect, left: pos, width: size } : { ...rect, top: pos, height: size });

  const firstSize = addLen(scaleLen(extent, node.sizes[0] / 100), { pct: 0, px: -HALF_GUTTER });
  const secondSize = addLen(scaleLen(extent, node.sizes[1] / 100), { pct: 0, px: -HALF_GUTTER });
  const gutterPos = addLen(start, firstSize);
  const secondPos = addLen(gutterPos, { pct: 0, px: 2 * HALF_GUTTER });

  splits.push({ node, rect, gutter: along(gutterPos, { pct: 0, px: 2 * HALF_GUTTER }) });
  layoutTree(node.children[0], along(start, firstSize), node.type, leaves, splits);
  layoutTree(node.children[1], along(secondPos, secondSize), node.type, leaves, splits);
}

// ── Divider / Resizer ─────────────────────────────────────────────────────

const Divider: React.FC<{
  direction: 'hsplit' | 'vsplit';
  isDark: boolean;
  style: React.CSSProperties;
  onDragStart: (e: React.PointerEvent<HTMLDivElement>) => void;
}> = ({ direction, isDark, style, onDragStart }) => (
  <div
    onPointerDown={onDragStart}
    style={style}
    className={`group absolute z-10 flex items-center justify-center ${
      direction === 'hsplit' ? 'cursor-col-resize' : 'cursor-row-resize'
    }`}
  >
    <div className={`transition-all duration-200 ease-out rounded-full ${
      direction === 'hsplit' 
        ? 'w-[2px] h-8 group-hover:bg-primary/80' 
        : 'h-[2px] w-8 group-hover:bg-primary/80'
    } ${isDark ? 'bg-[#333]' : 'bg-black/20'}`} />
  </div>
);

// ── Split divider (drag to resize) ────────────────────────────────────────

const SplitDivider: React.FC<{
  node: PaneSplit;
  rect: Rect;
  gutter: Rect;
  tabId: string;
  isDark: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}> = ({ node, rect, gutter, tabId, isDark, containerRef }) => {
  const patchNexusSizes = useSessionStore(s => s.patchNexusSizes);

  const handleDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    // The split's own size in px, resolved from its tab-relative rectangle.
    const box = container.getBoundingClientRect();
    const isHorizontal = node.type === 'hsplit';
    const totalSize = isHorizontal ? lenToPx(rect.width, box.width) : lenToPx(rect.height, box.height);
    if (totalSize <= 0) return;

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const startPos = isHorizontal ? e.clientX : e.clientY;
    const startSizes: [number, number] = [...node.sizes] as [number, number];

    // Drag updates only the local tree (one store write per frame); nexus-core gets the final sizes on release.
    let latest: [number, number] | null = null;
    let frame: number | null = null;

    const onMove = (mv: PointerEvent) => {
      const delta = (isHorizontal ? mv.clientX : mv.clientY) - startPos;
      const deltaPercent = (delta / totalSize) * 100;
      const newFirst = Math.round(Math.max(10, Math.min(90, startSizes[0] + deltaPercent)) * 100) / 100;
      latest = [newFirst, 100 - newFirst];
      if (frame === null) {
        frame = requestAnimationFrame(() => {
          frame = null;
          if (latest) patchNexusSizes(tabId, node.paneId, latest);
        });
      }
    };

    const onUp = (ev: PointerEvent) => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (target.hasPointerCapture(ev.pointerId)) target.releasePointerCapture(ev.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      if (latest) patchNexusSizes(tabId, node.paneId, latest, true);
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }, [node, rect, tabId, patchNexusSizes, containerRef]);

  return <Divider direction={node.type} isDark={isDark} style={rectStyle(gutter)} onDragStart={handleDragStart} />;
};

// ── Public: flat renderer ─────────────────────────────────────────────────

export const TerminalPaneRenderer: React.FC<TerminalPaneProps> = (props) => {
  const { node, parentDirection } = props;
  const containerRef = useRef<HTMLDivElement>(null);

  const { leaves, splits } = useMemo(() => {
    const leaves: LeafSlot[] = [];
    const splits: SplitSlot[] = [];
    layoutTree(node, FULL_RECT, parentDirection, leaves, splits);
    return { leaves, splits };
  }, [node, parentDirection]);

  return (
    <div ref={containerRef} className="relative w-full h-full min-w-0 min-h-0">
      {leaves.map(({ node: leaf, rect, parentDirection: leafParentDirection }) => (
        <div
          key={leaf.paneId}
          className="absolute overflow-hidden"
          // A zoomed leaf's wrapper spans the whole tab and stacks above the other leaves and the dividers;
          // LeafPane then insets itself (absolute inset-2) inside it.
          style={leaf.isZoomed ? { ...rectStyle(FULL_RECT), zIndex: 100 } : rectStyle(rect)}
        >
          <LeafPane
            node={leaf}
            tabId={props.tabId}
            appConfig={props.appConfig}
            isDark={props.isDark}
            isTabActive={props.isTabActive}
            onSplit={props.onSplit}
            parentDirection={leafParentDirection}
          />
        </div>
      ))}
      {splits.map(({ node: split, rect, gutter }) => (
        <SplitDivider
          key={split.paneId}
          node={split}
          rect={rect}
          gutter={gutter}
          tabId={props.tabId}
          isDark={props.isDark}
          containerRef={containerRef}
        />
      ))}
    </div>
  );
};
