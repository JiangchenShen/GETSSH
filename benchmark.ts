import { performance } from 'perf_hooks';

interface PaneNodeLeaf {
  type: 'leaf';
  sessionId?: string;
}

interface PaneNodeBranch {
  type: 'branch';
  children: [PaneNode, PaneNode];
}

type PaneNode = PaneNodeLeaf | PaneNodeBranch;

function createTree(depth: number): PaneNode {
  if (depth === 0) {
    return { type: 'leaf', sessionId: Math.random().toString() };
  }
  return {
    type: 'branch',
    children: [createTree(depth - 1), createTree(depth - 1)]
  };
}

// Original
function collectSessionIdsOld(node: PaneNode): string[] {
  if (node.type === 'leaf') return node.sessionId ? [node.sessionId] : [];
  return [...collectSessionIdsOld(node.children[0]), ...collectSessionIdsOld(node.children[1])];
}

// Optimized
function collectSessionIdsNew(node: PaneNode, acc: string[] = []): string[] {
  if (node.type === 'leaf') {
    if (node.sessionId) acc.push(node.sessionId);
  } else {
    collectSessionIdsNew(node.children[0], acc);
    collectSessionIdsNew(node.children[1], acc);
  }
  return acc;
}

const tree = createTree(15); // 2^15 = 32768 leaves

let start = performance.now();
for(let i=0; i<100; i++) {
  collectSessionIdsOld(tree);
}
let end = performance.now();
console.log(`Old: ${end - start} ms`);

start = performance.now();
for(let i=0; i<100; i++) {
  collectSessionIdsNew(tree);
}
end = performance.now();
console.log(`New: ${end - start} ms`);
