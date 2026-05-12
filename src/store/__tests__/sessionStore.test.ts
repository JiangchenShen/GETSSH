import { describe, it, expect } from 'vitest';
import { collectSessionIds, PaneLeaf, PaneSplit } from '../sessionStore';

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
