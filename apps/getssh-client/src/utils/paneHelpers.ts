import { PaneNode, PaneLeaf } from '../store/sessionStore';

export function findLeaf(node: PaneNode, paneId: string): PaneLeaf | null {
  if (node.type === 'leaf') return node.paneId === paneId ? node : null;
  return findLeaf(node.children[0], paneId) ?? findLeaf(node.children[1], paneId);
}

export function findWelcomePane(node: PaneNode): PaneLeaf | null {
  if (node.type === 'leaf') return node.paneType === 'welcome' ? node : null;
  return findWelcomePane(node.children[0]) ?? findWelcomePane(node.children[1]);
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
