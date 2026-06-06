"use client";

import React, { useState, useCallback, useRef, useEffect } from 'react';

// ==========================================
// 1. 核心数据结构定义 (严格遵守)
// ==========================================
export type SplitDirection = 'horizontal' | 'vertical';

export interface PaneNode {
  id: string;
  type: 'leaf' | 'container';
  direction?: SplitDirection;
  firstChild?: PaneNode;
  secondChild?: PaneNode;
  splitRatio?: number; // 默认 50
  contentId?: string;
  isZoomed?: boolean;
}

// 辅助：生成短 UUID
const generateId = () => Math.random().toString(36).substring(2, 10);

// ==========================================
// 2. 状态管理核心：Immutable Tree 遍历算法
// ==========================================
/**
 * 纯函数：深度克隆并映射修改二叉树
 */
const mapTree = (node: PaneNode, mapFn: (n: PaneNode) => PaneNode): PaneNode => {
  let newNode = mapFn({ ...node });
  if (newNode.firstChild) newNode.firstChild = mapTree(newNode.firstChild, mapFn);
  if (newNode.secondChild) newNode.secondChild = mapTree(newNode.secondChild, mapFn);
  return newNode;
};

/**
 * 纯函数：在二叉树中查找指定节点的父节点以及其归属 (firstChild | secondChild)
 */
const findParent = (root: PaneNode, targetId: string): { parent: PaneNode, childKey: 'firstChild' | 'secondChild' } | null => {
  if (root.firstChild?.id === targetId) return { parent: root, childKey: 'firstChild' };
  if (root.secondChild?.id === targetId) return { parent: root, childKey: 'secondChild' };
  
  if (root.firstChild) {
    const res = findParent(root.firstChild, targetId);
    if (res) return res;
  }
  if (root.secondChild) {
    const res = findParent(root.secondChild, targetId);
    if (res) return res;
  }
  return null;
};

// ==========================================
// 3. UI 组件：可拖拽边界 (Draggable Resizer)
// ==========================================
interface ResizerProps {
  direction: SplitDirection;
  onDragDelta: (deltaRatio: number) => void;
}

const Resizer: React.FC<ResizerProps> = React.memo(({ direction, onDragDelta }) => {
  const isHorizontal = direction === 'horizontal';
  
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    let startX = e.clientX;
    let startY = e.clientY;
    
    // 获取父容器实际尺寸，计算百分比
    const parent = e.currentTarget.parentElement;
    if (!parent) return;
    const parentSize = isHorizontal ? parent.clientWidth : parent.clientHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      // 计算本次移动相对于父容器的增量百分比
      const deltaRatio = (isHorizontal ? deltaX : deltaY) / parentSize * 100;
      
      // 更新起点，实现严谨的增量累加计算，防范 React 闭包陷阱
      startX = moveEvent.clientX;
      startY = moveEvent.clientY;
      
      onDragDelta(deltaRatio);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`z-10 bg-black/40 hover:bg-cyan-500/80 transition-colors flex shrink-0 ${
        isHorizontal ? 'w-1 cursor-col-resize h-full' : 'h-1 cursor-row-resize w-full'
      }`}
    />
  );
});

// ==========================================
// 4. UI 组件：叶子节点终端 (Mock Terminal)
// ==========================================
interface MockTerminalProps {
  node: PaneNode;
  onSplit: (id: string, direction: SplitDirection) => void;
  onClose: (id: string) => void;
  onToggleZoom: (id: string) => void;
  isRoot: boolean;
}

const MockTerminal: React.FC<MockTerminalProps> = React.memo(({ node, onSplit, onClose, onToggleZoom, isRoot }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canSplit, setCanSplit] = useState(true);

  // 防塌陷机制：基于 ResizeObserver 实时计算当前区域面积
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        // 宽高小于 200px 时禁用进一步拆分，防止 UI 彻底崩溃
        setCanSplit(width >= 200 && height >= 200);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 禅定模式绝对定位
  const isZoomed = node.isZoomed;
  const zoomClasses = isZoomed ? "fixed inset-0 z-50 m-2 shadow-2xl ring-2 ring-cyan-500/50 rounded-xl" : "w-full h-full relative rounded-md";

  return (
    <div ref={containerRef} className={`flex flex-col bg-[#1e1e1e] border border-white/5 overflow-hidden transition-all duration-200 ${zoomClasses}`}>
      {/* 终端 Toolbar */}
      <div className="h-8 bg-[#252526] flex items-center justify-between px-3 shrink-0 border-b border-black/50 select-none">
        <div className="flex items-center gap-2 text-xs text-gray-400 font-mono">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          {node.contentId}
        </div>
        
        <div className="flex items-center gap-1.5">
          <button 
            disabled={!canSplit}
            onClick={() => onSplit(node.id, 'horizontal')} 
            className="p-1 text-gray-400 hover:text-white hover:bg-white/10 rounded disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title="横向拆分 (左右)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line></svg>
          </button>
          <button 
            disabled={!canSplit}
            onClick={() => onSplit(node.id, 'vertical')} 
            className="p-1 text-gray-400 hover:text-white hover:bg-white/10 rounded disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title="纵向拆分 (上下)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="12" x2="21" y2="12"></line></svg>
          </button>
          
          <div className="w-[1px] h-3 bg-white/10 mx-1"></div>
          
          <button 
            onClick={() => onToggleZoom(node.id)} 
            className={`p-1 rounded transition-colors ${isZoomed ? 'text-cyan-400 bg-cyan-400/10' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
            title="禅定全屏 (Tmux Zoom)"
          >
            {isZoomed ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
            )}
          </button>

          {!isRoot && (
            <button 
              onClick={() => onClose(node.id)} 
              className="p-1 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors ml-1"
              title="关闭终端"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          )}
        </div>
      </div>
      
      {/* 终端内容占位 */}
      <div className="flex-1 p-3 font-mono text-sm bg-black overflow-hidden relative">
        <div className="text-green-400 mb-1">user@getssh:~$ <span className="animate-pulse">_</span></div>
        <div className="text-gray-500 opacity-50 mt-4">
          [Process {node.contentId} attached]<br/>
          Size constrained by binary tree engine.
        </div>
        {isZoomed && <div className="absolute bottom-4 right-4 text-cyan-500/50 font-bold pointer-events-none">ZEN MODE</div>}
      </div>
    </div>
  );
});

// ==========================================
// 5. 递归渲染引擎 (PaneRenderer)
// ==========================================
interface PaneRendererProps {
  node: PaneNode;
  onSplit: (id: string, direction: SplitDirection) => void;
  onClose: (id: string) => void;
  onRatioChange: (id: string, deltaRatio: number) => void;
  onToggleZoom: (id: string) => void;
  isRoot?: boolean;
}

const PaneRenderer: React.FC<PaneRendererProps> = ({ node, onSplit, onClose, onRatioChange, onToggleZoom, isRoot = false }) => {
  if (node.type === 'leaf') {
    return <MockTerminal node={node} onSplit={onSplit} onClose={onClose} onToggleZoom={onToggleZoom} isRoot={isRoot} />;
  }

  // 容器渲染逻辑 (Container)
  const isHorizontal = node.direction === 'horizontal';
  const ratio = node.splitRatio ?? 50;

  return (
    <div className={`flex w-full h-full overflow-hidden ${isHorizontal ? 'flex-row' : 'flex-col'}`}>
      {/* 结构左/上 */}
      <div style={{ flexBasis: `${ratio}%`, flexGrow: 0, flexShrink: 0, overflow: 'hidden' }}>
        {node.firstChild && (
          <PaneRenderer 
            node={node.firstChild} 
            onSplit={onSplit} onClose={onClose} 
            onRatioChange={onRatioChange} onToggleZoom={onToggleZoom} 
          />
        )}
      </div>

      {/* 控制器 */}
      <Resizer direction={node.direction!} onDragDelta={(delta) => onRatioChange(node.id, delta)} />

      {/* 结构右/下 */}
      <div style={{ flex: '1 1 0%', overflow: 'hidden' }}>
        {node.secondChild && (
          <PaneRenderer 
            node={node.secondChild} 
            onSplit={onSplit} onClose={onClose} 
            onRatioChange={onRatioChange} onToggleZoom={onToggleZoom} 
          />
        )}
      </div>
    </div>
  );
};

// ==========================================
// 6. 顶层状态调度器 (SplitEngine Entry)
// ==========================================
export default function SplitEngine() {
  const [rootNode, setRootNode] = useState<PaneNode>({
    id: generateId(),
    type: 'leaf',
    contentId: 'tty1',
    isZoomed: false,
  });

  /**
   * Action: 拆分节点
   * 将目标叶子节点原地升级为 Container，原来的内容变为 firstChild，新生叶子变为 secondChild
   */
  const handleSplit = useCallback((targetId: string, direction: SplitDirection) => {
    setRootNode(prev => mapTree(prev, (n) => {
      if (n.id === targetId && n.type === 'leaf') {
        return {
          id: n.id, // 保持原ID成为容器，React 会重用结构
          type: 'container',
          direction,
          splitRatio: 50,
          firstChild: {
            id: generateId(),
            type: 'leaf',
            contentId: n.contentId,
          },
          secondChild: {
            id: generateId(),
            type: 'leaf',
            contentId: `tty${Math.floor(Math.random() * 1000)}`,
          }
        };
      }
      return n;
    }));
  }, []);

  /**
   * Action: 关闭节点
   * 找到该节点的父节点，将存活的兄弟节点直接提升覆盖父节点
   */
  const handleClose = useCallback((targetId: string) => {
    setRootNode(prev => {
      if (prev.id === targetId) return prev; // 根节点不可关闭
      
      const parentInfo = findParent(prev, targetId);
      if (!parentInfo) return prev;
      
      const siblingKey = parentInfo.childKey === 'firstChild' ? 'secondChild' : 'firstChild';
      const siblingNode = parentInfo.parent[siblingKey];
      
      // 查父辈，决定如何替换
      const grandParentInfo = findParent(prev, parentInfo.parent.id);
      
      if (!grandParentInfo) {
        // 父节点即为根，兄弟节点上位成为新根
        return { ...siblingNode! };
      }
      
      // 普通层级替换
      return mapTree(prev, (n) => {
        if (n.id === grandParentInfo.parent.id) {
          n[grandParentInfo.childKey] = siblingNode;
        }
        return n;
      });
    });
  }, []);

  /**
   * Action: 更新拆分比例
   */
  const handleRatioChange = useCallback((containerId: string, deltaRatio: number) => {
    setRootNode(prev => mapTree(prev, (n) => {
      if (n.id === containerId && n.type === 'container') {
        const currentRatio = n.splitRatio ?? 50;
        // 刚性约束：边界预留 10%，防彻底坍塌
        n.splitRatio = Math.max(10, Math.min(currentRatio + deltaRatio, 90));
      }
      return n;
    }));
  }, []);

  /**
   * Action: 触发/取消全屏禅定 (全树排他)
   */
  const handleToggleZoom = useCallback((targetId: string) => {
    setRootNode(prev => mapTree(prev, (n) => {
      if (n.type === 'leaf') {
        n.isZoomed = n.id === targetId ? !n.isZoomed : false;
      }
      return n;
    }));
  }, []);

  return (
    <div className="w-full h-screen bg-black p-4 md:p-8 flex flex-col font-sans">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-emerald-400">
            Nexus Split Engine
          </h1>
          <p className="text-sm text-gray-500 mt-1">Binary Tree Terminal Multiplexer</p>
        </div>
      </div>
      
      <div className="flex-1 w-full h-full relative rounded-xl overflow-hidden ring-1 ring-white/10 bg-[#0d0d0d] shadow-2xl">
        <PaneRenderer 
          node={rootNode} 
          onSplit={handleSplit} 
          onClose={handleClose} 
          onRatioChange={handleRatioChange}
          onToggleZoom={handleToggleZoom}
          isRoot={true}
        />
      </div>
    </div>
  );
}
