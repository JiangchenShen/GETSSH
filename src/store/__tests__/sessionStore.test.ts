import { describe, it, expect } from 'vitest';
import { collectSessionIds, PaneLeaf, PaneSplit } from '../sessionStore';

describe('collectSessionIds', () => {
  it('should return an empty array for a leaf node without a sessionId', () => {
    const node: PaneLeaf = {
      type: 'leaf',
      paneId: 'pane-1',
      paneType: 'welcome',
      sessionId: null,
      config: null,
    };
    expect(collectSessionIds(node)).toEqual([]);
  });

  it('should return an array with the sessionId for a leaf node with a sessionId', () => {
    const node: PaneLeaf = {
      type: 'leaf',
      paneId: 'pane-2',
      paneType: 'terminal',
      sessionId: 'session-123',
      config: null,
    };
    expect(collectSessionIds(node)).toEqual(['session-123']);
  });

  it('should collect sessionIds from nested hsplit and vsplit nodes', () => {
    const node: PaneSplit = {
      type: 'hsplit',
      paneId: 'split-1',
      sizes: [50, 50],
      children: [
        {
          type: 'leaf',
          paneId: 'pane-3',
          paneType: 'terminal',
          sessionId: 'session-456',
          config: null,
        },
        {
          type: 'vsplit',
          paneId: 'split-2',
          sizes: [50, 50],
          children: [
            {
              type: 'leaf',
              paneId: 'pane-4',
              paneType: 'welcome',
              sessionId: null,
              config: null,
            },
            {
              type: 'leaf',
              paneId: 'pane-5',
              paneType: 'plugin',
              sessionId: 'session-789',
              config: null,
            },
          ],
        },
      ],
    };

    const result = collectSessionIds(node);
    expect(result).toEqual(['session-456', 'session-789']);
  });

  it('should handle complex nested trees with no session IDs', () => {
    const node: PaneSplit = {
      type: 'vsplit',
      paneId: 'split-3',
      sizes: [50, 50],
      children: [
        {
          type: 'leaf',
          paneId: 'pane-6',
          paneType: 'welcome',
          sessionId: null,
          config: null,
        },
        {
          type: 'hsplit',
          paneId: 'split-4',
          sizes: [50, 50],
          children: [
            {
              type: 'leaf',
              paneId: 'pane-7',
              paneType: 'welcome',
              sessionId: null,
              config: null,
            },
            {
              type: 'leaf',
              paneId: 'pane-8',
              paneType: 'welcome',
              sessionId: null,
              config: null,
            },
          ],
        },
      ],
    };

    expect(collectSessionIds(node)).toEqual([]);
  });
});
