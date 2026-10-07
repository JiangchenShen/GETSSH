import { describe, expect, it } from 'vitest';
import type { PaneLeaf, PaneNode } from '../store/sessionStore';
import { getAvailableSplitDirection } from './paneHelpers';

const leaf = (paneId: string): PaneLeaf => ({ type: 'leaf', paneId, paneType: 'welcome', sessionId: null, config: null });
const split = (type: 'hsplit' | 'vsplit', first: PaneNode, second: PaneNode): PaneNode => ({
  type, paneId: `${first.paneId}-${second.paneId}`, children: [first, second], sizes: [50, 50],
});

describe('top split action', () => {
  it('starts with a horizontal split and alternates at the active leaf', () => {
    expect(getAvailableSplitDirection(leaf('a'), 'a')).toBe('hsplit');
    const tree = split('hsplit', leaf('a'), split('vsplit', leaf('b'), leaf('c')));
    expect(getAvailableSplitDirection(tree, 'a')).toBe('vsplit');
    expect(getAvailableSplitDirection(tree, 'b')).toBe('hsplit');
    expect(getAvailableSplitDirection(tree, 'c')).toBe('hsplit');
  });

  it('disables when focus has no matching leaf', () => {
    expect(getAvailableSplitDirection(undefined, 'a')).toBeNull();
    expect(getAvailableSplitDirection(leaf('a'), null)).toBeNull();
    const tree = split('hsplit', leaf('a'), leaf('b'));
    expect(getAvailableSplitDirection(tree, 'missing')).toBeNull();
    expect(getAvailableSplitDirection(tree, tree.paneId)).toBeNull();
  });

  it('disables at the native four-pane limit and enables again after closing', () => {
    const tree = split('hsplit', split('vsplit', leaf('a'), leaf('b')), split('vsplit', leaf('c'), leaf('d')));
    expect(getAvailableSplitDirection(tree, 'd')).toBeNull();
    const afterClose = split('hsplit', split('vsplit', leaf('a'), leaf('b')), leaf('c'));
    expect(getAvailableSplitDirection(afterClose, 'c')).toBe('vsplit');
  });
});
