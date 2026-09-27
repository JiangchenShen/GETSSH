import type { SessionProfile } from '../store/sessionStore';

export type IndexedProfile = SessionProfile & { originalIndex: number };

export interface AssetFolderNode {
  path: string;
  name: string;
  children: AssetFolderNode[];
  sessions: IndexedProfile[];
  total: number;
}

export function buildAssetFolderTree(folderPaths: string[], sessions: IndexedProfile[]) {
  const nodes = new Map<string, AssetFolderNode>();
  const roots: AssetFolderNode[] = [];
  const rootSessions: IndexedProfile[] = [];

  const ensure = (rawPath: string): AssetFolderNode | undefined => {
    const path = rawPath;
    if (!path) return undefined;
    const existing = nodes.get(path);
    if (existing) return existing;

    const parts = path.split('/');
    const node: AssetFolderNode = { path, name: parts.at(-1)!.trim() || parts.at(-1)!, children: [], sessions: [], total: 0 };
    nodes.set(path, node);
    const parent = ensure(parts.slice(0, -1).join('/'));
    (parent?.children ?? roots).push(node);
    return node;
  };

  folderPaths.forEach(ensure);
  sessions.forEach(session => {
    const folder = ensure(session.group || '');
    (folder?.sessions ?? rootSessions).push(session);
  });

  const finish = (items: AssetFolderNode[]) => {
    items.sort((a, b) => a.name.localeCompare(b.name));
    items.forEach(node => {
      finish(node.children);
      node.total = node.sessions.length + node.children.reduce((sum, child) => sum + child.total, 0);
    });
  };
  finish(roots);

  return { folders: roots, rootSessions };
}
