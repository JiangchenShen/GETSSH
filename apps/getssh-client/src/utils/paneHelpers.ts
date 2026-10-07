import type { PaneNode, PaneLeaf } from '../store/sessionStore';

export function countLeaves(node: PaneNode | undefined): number {
  if (!node) return 0;
  if (node.type === 'leaf') return 1;
  return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

export function getAvailableSplitDirection(node: PaneNode | undefined, paneId: string | null): 'hsplit' | 'vsplit' | null {
  if (!node || !paneId || countLeaves(node) >= 4) return null;

  // Tidal allows a leaf to split only across its parent's direction.
  const visit = (current: PaneNode, parentDirection?: 'hsplit' | 'vsplit'): 'hsplit' | 'vsplit' | null => {
    if (current.type === 'leaf') {
      if (current.paneId !== paneId) return null;
      return parentDirection === 'hsplit' ? 'vsplit' : 'hsplit';
    }
    return visit(current.children[0], current.type) ?? visit(current.children[1], current.type);
  };
  return visit(node);
}

export function findLeaf(node: PaneNode, paneId: string): PaneLeaf | null {
  if (node.type === 'leaf') return node.paneId === paneId ? node : null;
  return findLeaf(node.children[0], paneId) ?? findLeaf(node.children[1], paneId);
}

export function findWelcomePane(node: PaneNode): PaneLeaf | null {
  if (node.type === 'leaf') return node.paneType === 'welcome' ? node : null;
  return findWelcomePane(node.children[0]) ?? findWelcomePane(node.children[1]);
}

export function findZoomedPane(node: PaneNode): PaneLeaf | null {
  if (node.type === 'leaf') return node.isZoomed ? node : null;
  return findZoomedPane(node.children[0]) ?? findZoomedPane(node.children[1]);
}

export function updateLeafInTree(node: PaneNode, targetPaneId: string, updates: Partial<PaneLeaf>): PaneNode {
  if (node.type === 'leaf') {
    if (node.paneId === targetPaneId) {
      return { ...node, ...updates } as PaneLeaf;
    }
    return node;
  }
  return {
    ...node,
    children: [
      updateLeafInTree(node.children[0], targetPaneId, updates),
      updateLeafInTree(node.children[1], targetPaneId, updates),
    ] as [PaneNode, PaneNode],
  };
}
