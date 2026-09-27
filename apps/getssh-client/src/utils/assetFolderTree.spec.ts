import { describe, expect, it } from 'vitest';
import { buildAssetFolderTree } from './assetFolderTree';

describe('asset folder tree', () => {
  it('keeps empty folders, derives legacy parents, and counts descendants', () => {
    const host = { id: 'host', host: 'example.com', username: 'root', group: 'Ops / DB', originalIndex: 0 };
    const root = { id: 'root', host: 'localhost', username: 'me', originalIndex: 1 };
    const tree = buildAssetFolderTree(['Empty', 'Ops / Logs'], [host, root]);

    expect(tree.folders.map(folder => folder.path)).toEqual(['Empty', 'Ops ']);
    expect(tree.folders[0].total).toBe(0);
    expect(tree.folders[1].children.map(folder => folder.path)).toEqual(['Ops / DB', 'Ops / Logs']);
    expect(tree.folders[1].total).toBe(1);
    expect(tree.folders[1].children[0].sessions).toEqual([host]);
    expect(tree.rootSessions).toEqual([root]);
  });
});
