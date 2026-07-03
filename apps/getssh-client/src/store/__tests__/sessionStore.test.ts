import { describe, it, expect } from 'vitest';
import { collectSessionIds } from '../sessionStore';
import type { PaneNode, PaneLeaf } from '../sessionStore';

const baseLeaf: Omit<PaneLeaf, 'paneId'> = {
  type: 'leaf',
  paneType: 'terminal',
  sessionId: null,
  config: null
};

describe('collectSessionIds', () => {
  it('should return empty array for a leaf with no sessionId', () => {
    const node: PaneNode = {
      ...baseLeaf,
      paneId: 'p1'
    };
    expect(collectSessionIds(node)).toEqual([]);
  });

  it('should return array with one element for a leaf with sessionId', () => {
    const node: PaneNode = {
      ...baseLeaf,
      paneId: 'p1',
      sessionId: 's1'
    };
    expect(collectSessionIds(node)).toEqual(['s1']);
  });

  it('should return sessionIds from nested splits', () => {
    const node: PaneNode = {
      type: 'hsplit',
      paneId: 's1',
      sizes: [50, 50],
      children: [
        {
          ...baseLeaf,
          paneId: 'p1',
          sessionId: 'id1'
        },
        {
          type: 'vsplit',
          paneId: 's2',
          sizes: [50, 50],
          children: [
            {
              ...baseLeaf,
              paneId: 'p2' // No sessionId
            },
            {
              ...baseLeaf,
              paneId: 'p3',
              sessionId: 'id2'
            }
          ]
        }
      ]
    };
    expect(collectSessionIds(node)).toEqual(['id1', 'id2']);
  });

  it('should handle complex nested structures with empty leaf nodes', () => {
    const node: PaneNode = {
      type: 'vsplit',
      paneId: 's1',
      sizes: [50, 50],
      children: [
        {
          type: 'hsplit',
          paneId: 's2',
          sizes: [50, 50],
          children: [
            { ...baseLeaf, paneId: 'p1' },
            { ...baseLeaf, paneId: 'p2' }
          ]
        },
        {
          type: 'hsplit',
          paneId: 's3',
          sizes: [50, 50],
          children: [
            { ...baseLeaf, paneId: 'p3', sessionId: 'target-1' },
            { ...baseLeaf, paneId: 'p4', sessionId: 'target-2' }
          ]
        }
      ]
    };
    expect(collectSessionIds(node)).toEqual(['target-1', 'target-2']);
  });

  it('should append to an existing accumulator if provided', () => {
    const node: PaneNode = {
      ...baseLeaf,
      paneId: 'p1',
      sessionId: 's2'
    };
    const acc = ['s1'];
    expect(collectSessionIds(node, acc)).toEqual(['s1', 's2']);
    expect(acc).toEqual(['s1', 's2']); // Should mutate the provided array
  });

  it('should ignore empty string sessionIds', () => {
    const node: PaneNode = {
      ...baseLeaf,
      paneId: 'p1',
      sessionId: ''
    };
    expect(collectSessionIds(node)).toEqual([]);
  });
});
