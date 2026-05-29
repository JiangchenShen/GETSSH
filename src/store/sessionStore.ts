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

export type PaneConfig = SSHConnectConfig | { pluginUrl: string } | { isSettings: true } | null;

export const isSSHConfig = (config: PaneConfig): config is SSHConnectConfig => {
  return config !== null && typeof config === 'object' && !('isSettings' in config) && !('pluginUrl' in config);
};

export interface PaneLeaf {
  type: 'leaf';
  paneId: string;      // unique per pane, used as React key / activePaneId
  paneType: 'welcome' | 'terminal' | 'plugin';
  sessionId: string | null;   // SSH session id
  config: PaneConfig;         // SSH config (host, user, …) or plugin config
  isDisconnected?: boolean;   // persisted disconnect state — survives re-renders
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
  config: PaneConfig;          // root SSH config (kept for backward compat)
  paneTree?: PaneNode;  // undefined → legacy single-pane mode
}

// ── Session Profile ───────────────────────────────────────────────────────

export type OsType = 'ubuntu' | 'debian' | 'centos' | 'rhel' | 'fedora' | 'alpine' | 'arch' | 'suse' | 'windows' | 'macos' | 'cisco' | 'huawei' | 'generic';

export interface SessionProfile {
  protocol?: 'ssh' | 'local' | 'telnet';
  host: string;
  username: string;
  password?: string;
  privateKeyPath?: string;
  autoStart?: boolean;
  port?: number;
  useKeepAlive?: boolean;
  alias?: string;
  authType?: 'password' | 'key';
  osType?: OsType;
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
  registeredPanels: Record<string, { title: string, renderUrl: string, pluginId: string }>;

  setSessions: (sessions: SessionProfile[]) => void;
  setTabs: (updater: Tab[] | ((prev: Tab[]) => Tab[])) => void;
  setActiveTabId: (id: string | null) => void;
  setActivePaneId: (id: string | null) => void;
  setSelectedSessionIndex: (idx: number | null) => void;
  setConnecting: (val: boolean) => void;
  setError: (err: string | null) => void;
  setSearchQuery: (q: string) => void;
  setShowSFTP: (show: boolean) => void;
  setSftpWidth: (w: number) => void;
  updateSessionOsType: (host: string, username: string, osType: OsType) => void;

  // NEW: update a pane's size in the tree (for drag-resize)
  updatePaneSizes: (tabId: string, paneId: string, sizes: [number, number]) => void;

  closeTab: (tabId: string) => void;

  registerPluginPanel: (pluginId: string, panelId: string, title: string, renderUrl: string) => void;
  openPluginPanel: (pluginId: string, panelId: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Recursively collect all sessionIds from a PaneNode tree */
export function collectSessionIds(node: PaneNode, acc: string[] = []): string[] {
  if (node.type === 'leaf') {
    if (node.sessionId) acc.push(node.sessionId);
  } else {
    collectSessionIds(node.children[0], acc);
    collectSessionIds(node.children[1], acc);
  }
  return acc;
}

/** Recursively update isDisconnected flag on a specific leaf */
export function patchLeafDisconnected(node: PaneNode, paneId: string, isDisconnected: boolean): PaneNode {
  if (node.type === 'leaf') {
    return node.paneId === paneId ? { ...node, isDisconnected } : node;
  }
  return {
    ...node,
    children: [
      patchLeafDisconnected(node.children[0], paneId, isDisconnected),
      patchLeafDisconnected(node.children[1], paneId, isDisconnected),
    ] as [PaneNode, PaneNode],
  };
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
  registeredPanels: {},

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
  updateSessionOsType: (host, username, osType) => set((state) => ({
    sessions: state.sessions.map(s =>
      s.host === host && s.username === username ? { ...s, osType } : s
    )
  })),

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

  registerPluginPanel: (pluginId, panelId, title, renderUrl) => {
    set(state => ({
      registeredPanels: {
        ...state.registeredPanels,
        [panelId]: { pluginId, title, renderUrl }
      }
    }));
  },

  openPluginPanel: (pluginId, panelId) => {
    const { registeredPanels } = get();
    const panel = registeredPanels[panelId];
    if (!panel) {
      console.error(`[PluginPanel] Panel ${panelId} is not registered`);
      return;
    }
    
    const tabId = `panel-${pluginId}-${panelId}`;
    
    set(state => {
      // If tab already exists, just switch to it
      if (state.tabs.find(t => t.id === tabId)) {
        return { activeTabId: tabId };
      }
      
      const newTab: Tab = {
        id: tabId,
        title: panel.title,
        config: { pluginUrl: panel.renderUrl },
        paneTree: {
          type: 'leaf',
          paneId: tabId,
          paneType: 'plugin',
          sessionId: null,
          config: { pluginUrl: panel.renderUrl }
        }
      };
      
      return {
        tabs: [...state.tabs, newTab],
        activeTabId: tabId,
        activePaneId: tabId
      };
    });
  }
}));
