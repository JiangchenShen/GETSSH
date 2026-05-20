import { describe, it, expect } from 'vitest';
import { collectSessionIds, patchLeafDisconnected, PaneLeaf, PaneSplit } from '../sessionStore';

describe('collectSessionIds', () => {
  it('should return session ID for a single leaf node with a valid sessionId', () => {
    const leaf: PaneLeaf = {
      type: 'leaf',
      paneId: 'pane-1',
      paneType: 'terminal',
      sessionId: 'session-123',
      config: null,
    };
    expect(collectSessionIds(leaf)).toEqual(['session-123']);
  });

  it('should return an empty array for a leaf node with null sessionId', () => {
    const leaf: PaneLeaf = {
      type: 'leaf',
      paneId: 'pane-2',
      paneType: 'welcome',
      sessionId: null,
      config: null,
    };
    expect(collectSessionIds(leaf)).toEqual([]);
  });

  it('should return session IDs for a split node containing multiple leaf nodes', () => {
    const leaf1: PaneLeaf = {
      type: 'leaf',
      paneId: 'pane-1',
      paneType: 'terminal',
      sessionId: 'session-1',
      config: null,
    };
    const leaf2: PaneLeaf = {
      type: 'leaf',
      paneId: 'pane-2',
      paneType: 'terminal',
      sessionId: 'session-2',
      config: null,
    };
    const split: PaneSplit = {
      type: 'vsplit',
      paneId: 'split-1',
      sizes: [50, 50],
      children: [leaf1, leaf2],
    };
    expect(collectSessionIds(split)).toEqual(['session-1', 'session-2']);
  });

  it('should return session IDs for deeply nested split nodes', () => {
    const leaf1: PaneLeaf = {
      type: 'leaf',
      paneId: 'pane-1',
      paneType: 'terminal',
      sessionId: 'session-1',
      config: null,
    };
    const leaf2: PaneLeaf = {
      type: 'leaf',
      paneId: 'pane-2',
      paneType: 'terminal',
      sessionId: 'session-2',
      config: null,
    };
    const leaf3: PaneLeaf = {
      type: 'leaf',
      paneId: 'pane-3',
      paneType: 'terminal',
      sessionId: null,
      config: null,
    };

    const innerSplit: PaneSplit = {
      type: 'hsplit',
      paneId: 'split-2',
      sizes: [30, 70],
      children: [leaf2, leaf3],
    };

    const rootSplit: PaneSplit = {
      type: 'vsplit',
      paneId: 'split-1',
      sizes: [50, 50],
      children: [leaf1, innerSplit],
    };

    expect(collectSessionIds(rootSplit)).toEqual(['session-1', 'session-2']);
  });
});

describe('patchLeafDisconnected', () => {
  it('should update isDisconnected for a matching leaf node', () => {
    const leaf: PaneLeaf = {
      type: 'leaf',
      paneId: 'pane-1',
      paneType: 'terminal',
      sessionId: 'session-123',
      config: null,
      isDisconnected: false,
    };
    const patched = patchLeafDisconnected(leaf, 'pane-1', true);
    expect((patched as PaneLeaf).isDisconnected).toBe(true);
    expect(patched).not.toBe(leaf); // Should return a new object
  });

  it('should not update a non-matching leaf node', () => {
    const leaf: PaneLeaf = {
      type: 'leaf',
      paneId: 'pane-2',
      paneType: 'terminal',
      sessionId: 'session-456',
      config: null,
      isDisconnected: false,
    };
    const patched = patchLeafDisconnected(leaf, 'pane-1', true);
    expect((patched as PaneLeaf).isDisconnected).toBe(false);
    expect(patched).toBe(leaf); // Should return the exact same object
  });

  it('should recursively update the correct leaf node in a split', () => {
    const leaf1: PaneLeaf = {
      type: 'leaf',
      paneId: 'pane-1',
      paneType: 'terminal',
      sessionId: 'session-1',
      config: null,
      isDisconnected: false,
    };
    const leaf2: PaneLeaf = {
      type: 'leaf',
      paneId: 'pane-2',
      paneType: 'terminal',
      sessionId: 'session-2',
      config: null,
      isDisconnected: false,
    };
    const split: PaneSplit = {
      type: 'vsplit',
      paneId: 'split-1',
      sizes: [50, 50],
      children: [leaf1, leaf2],
    };

    const patched = patchLeafDisconnected(split, 'pane-2', true);

    // Split object itself is cloned
    expect(patched).not.toBe(split);

    // Check children
    const pSplit = patched as PaneSplit;
    expect(pSplit.children[0]).toBe(leaf1); // Unmodified leaf should be identical
    expect((pSplit.children[1] as PaneLeaf).isDisconnected).toBe(true);
    expect(pSplit.children[1]).not.toBe(leaf2); // Modified leaf should be a new object
  });
});
