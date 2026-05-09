import { create } from 'zustand';

// ── Pane Layout Tree ──────────────────────────────────────────────────────
//
//  A Tab now holds a tree of PaneNodes:
//
//   { type: 'leaf', sessionId, config }
//   { type: 'hsplit', children: [left, right], sizes: [50, 50] }
//   { type: 'vsplit', children: [top, bottom], sizes: [50, 50] }
//
//  All sizes are percentages summing to 100.

export interface PaneLeaf {
  type: 'leaf';
  paneId: string;      // unique per pane, used as React key / activePaneId
  sessionId: string;   // SSH session id
  config: any;         // SSH config (host, user, …)
}

export interface PaneSplit {
  type: 'hsplit' | 'vsplit';
  paneId: string;
  children: [PaneNode, PaneNode];
  sizes: [number, number];  // percentages, sum = 100
}

export type PaneNode = PaneLeaf | PaneSplit;

// ── Tab ───────────────────────────────────────────────────────────────────

export interface Tab {
  id: string;           // same as the root pane's sessionId (for compat)
  title: string;
  config: any;          // root SSH config (kept for backward compat)
  paneTree?: PaneNode;  // undefined → legacy single-pane mode
}

// ── Session Profile ───────────────────────────────────────────────────────

export interface SessionProfile {
  host: string;
  username: string;
  password?: string;
  privateKeyPath?: string;
  autoStart?: boolean;
  port?: number;
  useKeepAlive?: boolean;
}

// ── Store ─────────────────────────────────────────────────────────────────

interface SessionStore {
  sessions: SessionProfile[];
  tabs: Tab[];
  activeTabId: string | null;
  activePaneId: string | null;   // NEW: which leaf pane is focused
  selectedSessionIndex: number | null;
  connecting: boolean;
  error: string | null;
  searchQuery: string;
  showSFTP: boolean;
  sftpWidth: number;

  setSessions: (sessions: SessionProfile[]) => void;
  setTabs: (updater: Tab[] | ((prev: Tab[]) => Tab[])) => void;
  setActiveTabId: (id: string | null) => void;
  setActivePaneId: (id: string | null) => void;   // NEW
  setSelectedSessionIndex: (idx: number | null) => void;
  setConnecting: (val: boolean) => void;
  setError: (err: string | null) => void;
  setSearchQuery: (q: string) => void;
  setShowSFTP: (show: boolean) => void;
  setSftpWidth: (w: number) => void;

  // NEW: update a pane's size in the tree (for drag-resize)
  updatePaneSizes: (tabId: string, paneId: string, sizes: [number, number]) => void;

  closeTab: (tabId: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Recursively collect all sessionIds from a PaneNode tree */
export function collectSessionIds(node: PaneNode): string[] {
  if (node.type === 'leaf') return [node.sessionId];
  return [...collectSessionIds(node.children[0]), ...collectSessionIds(node.children[1])];
}

/** Recursively update sizes on a specific split node */
function updateSizesInTree(node: PaneNode, targetPaneId: string, sizes: [number, number]): PaneNode {
  if (node.type === 'leaf') return node;
  if (node.paneId === targetPaneId) return { ...node, sizes };
  return {
    ...node,
    children: [
      updateSizesInTree(node.children[0], targetPaneId, sizes),
      updateSizesInTree(node.children[1], targetPaneId, sizes),
    ] as [PaneNode, PaneNode],
  };
}

// ── Store Implementation ──────────────────────────────────────────────────

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  tabs: [],
  activeTabId: null,
  activePaneId: null,
  selectedSessionIndex: null,
  connecting: false,
  error: null,
  searchQuery: '',
  showSFTP: false,
  sftpWidth: 320,

  setSessions: (sessions) => set({ sessions }),
  setTabs: (updater) => set((state) => ({
    tabs: typeof updater === 'function' ? updater(state.tabs) : updater
  })),
  setActiveTabId: (id) => set({ activeTabId: id }),
  setActivePaneId: (id) => set({ activePaneId: id }),
  setSelectedSessionIndex: (idx) => set({ selectedSessionIndex: idx }),
  setConnecting: (val) => set({ connecting: val }),
  setError: (err) => set({ error: err }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setShowSFTP: (show) => set({ showSFTP: show }),
  setSftpWidth: (w) => set({ sftpWidth: w }),

  updatePaneSizes: (tabId, paneId, sizes) => {
    set((state) => ({
      tabs: state.tabs.map(tab => {
        if (tab.id !== tabId || !tab.paneTree) return tab;
        return { ...tab, paneTree: updateSizesInTree(tab.paneTree, paneId, sizes) };
      }),
    }));
  },

  closeTab: (tabId) => {
    const { activeTabId } = get();
    set((state) => {
      const tab = state.tabs.find(t => t.id === tabId);
      // Disconnect all sessions in the pane tree
      if (tab?.paneTree) {
        collectSessionIds(tab.paneTree).forEach(sid => {
          if (sid !== tabId) window.electronAPI.sshDisconnect(sid);
        });
      }
      const remaining = state.tabs.filter(t => t.id !== tabId);
      let newActiveId = state.activeTabId;
      if (activeTabId === tabId) {
        const sshTabs = remaining.filter(t => t.id !== 'settings');
        newActiveId = sshTabs.length > 0 ? sshTabs[sshTabs.length - 1].id : null;
      }
      return { tabs: remaining, activeTabId: newActiveId, activePaneId: null };
    });
    window.electronAPI.sshDisconnect(tabId);
  },
}));
