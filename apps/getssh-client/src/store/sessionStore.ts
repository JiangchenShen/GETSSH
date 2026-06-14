import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// ── Pane Layout Tree ──────────────────────────────────────────────────────

export interface SSHConnectConfig {
    pluginUrl?: string;
    protocol?: 'ssh' | 'local' | 'telnet';
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    keepaliveInterval?: number;
    proxyType?: string;
    proxyHost?: string;
    proxyPort?: number;
    initScript?: string;
    alias?: string;
}

export type PaneConfig = SSHConnectConfig | { pluginUrl: string } | { pluginId: string } | { isSettings: true } | { centerType: 'ai' | 'plugin' | 'secure' | 'workspace' } | null;

export const isSSHConfig = (config: PaneConfig): config is SSHConnectConfig => {
  return config !== null && typeof config === 'object' && !('isSettings' in config) && !('pluginUrl' in config) && !('pluginId' in config) && !('centerType' in config);
};

export interface PaneLeaf {
  type: 'leaf';
  paneId: string;
  paneType: 'welcome' | 'terminal' | 'plugin' | 'center';
  sessionId: string | null;
  config: PaneConfig;
  isDisconnected?: boolean;
  isZoomed?: boolean;
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
  id: string;
  title: string;
  config: PaneConfig;
  paneTree?: PaneNode;
}

// ── Session Profile ───────────────────────────────────────────────────────

export type OsType = 'ubuntu' | 'debian' | 'centos' | 'rhel' | 'fedora' | 'alpine' | 'arch' | 'suse' | 'windows' | 'macos' | 'cisco' | 'huawei' | 'generic';

export interface FloatingAiContext {
  x: number;
  y: number;
  selection: string;
}

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
  group?: string; // e.g. "Production/DB"
}

// ── Store ─────────────────────────────────────────────────────────────────

interface SessionStore {
  sessions: SessionProfile[];
  expandedGroups: string[];
  tabs: Tab[];
  activeTabId: string | null;
  activePaneId: string | null;
  selectedSessionIndex: number | null;
  connecting: boolean;
  error: string | null;
  floatingAiContext: FloatingAiContext | null;
  searchQuery: string;
  showSFTP: boolean;
  sftpWidth: number;
  registeredPanels: Record<string, { title: string, renderUrl: string, pluginId: string }>;

  setSessions: (sessions: SessionProfile[]) => void;
  setExpandedGroups: (groups: string[]) => void;
  setTabs: (tabs: Tab[]) => void;
  setActiveTabId: (id: string | null) => void;
  setActivePaneId: (id: string | null) => void;
  setSelectedSessionIndex: (idx: number | null) => void;
  setFloatingAiContext: (ctx: FloatingAiContext | null) => void;
  setConnecting: (val: boolean) => void;
  setError: (err: string | null) => void;
  setSearchQuery: (q: string) => void;
  setShowSFTP: (show: boolean) => void;
  setSftpWidth: (w: number) => void;
  updateSessionOsType: (host: string, username: string, osType: OsType) => void;
  switchWorkspace: (targetWorkspaceId: string) => Promise<boolean>;

  // ⚡ NEXUS CORE SYNC RECEIVERS (Dumb terminal architecture)
  syncNexusTree: (tabId: string, tree: PaneNode | null) => void;
  patchNexusLeaf: (paneId: string, updates: Partial<PaneLeaf>) => void;
  patchNexusSizes: (tabId: string, splitPaneId: string, sizes: [number, number]) => void;
  
  // Internal Legacy overrides (for compat)
  closeTab: (tabId: string) => void;
  registerPluginPanel: (pluginId: string, panelId: string, title: string, renderUrl: string) => void;
  openPluginPanel: (pluginId: string, panelId: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function collectSessionIds(node: PaneNode, acc: string[] = []): string[] {
  if (node.type === 'leaf') {
    if (node.sessionId) acc.push(node.sessionId);
  } else {
    collectSessionIds(node.children[0], acc);
    collectSessionIds(node.children[1], acc);
  }
  return acc;
}

// Immer mutators for deep tree patches
function mutateLeafInTree(node: PaneNode, paneId: string, updates: Partial<PaneLeaf>, onPatched?: () => void) {
  if (node.type === 'leaf') {
    if (node.paneId === paneId) {
      Object.assign(node, updates);
      if (onPatched) onPatched();
    }
  } else {
    mutateLeafInTree(node.children[0], paneId, updates, onPatched);
    mutateLeafInTree(node.children[1], paneId, updates, onPatched);
  }
}

function mutateSizesInTree(node: PaneNode, targetPaneId: string, sizes: [number, number]) {
  if (node.type === 'leaf') return;
  if (node.paneId === targetPaneId) {
    node.sizes = sizes;
  } else {
    mutateSizesInTree(node.children[0], targetPaneId, sizes);
    mutateSizesInTree(node.children[1], targetPaneId, sizes);
  }
}

// ── Store Implementation ──────────────────────────────────────────────────

export const useSessionStore = create<SessionStore>()(
  immer((set, get) => ({
    sessions: [],
    expandedGroups: [],
    tabs: [],
    activeTabId: null,
    activePaneId: null,
    selectedSessionIndex: null,
    connecting: false,
    error: null,
    floatingAiContext: null,
    searchQuery: '',
    showSFTP: false,
    sftpWidth: 320,
    registeredPanels: {},

    setSessions: (sessions) => set(state => { state.sessions = sessions; }),
    setExpandedGroups: (expandedGroups) => set(state => { state.expandedGroups = expandedGroups; }),
    setTabs: (tabs) => set(state => { state.tabs = tabs; }),
    setActiveTabId: (id) => set(state => { state.activeTabId = id }),
    setActivePaneId: (id) => set(state => { state.activePaneId = id }),
    setSelectedSessionIndex: (idx) => set(state => { state.selectedSessionIndex = idx }),
    setFloatingAiContext: (ctx) => set(state => { state.floatingAiContext = ctx }),
    setConnecting: (val) => set(state => { state.connecting = val }),
    setError: (err) => set(state => { state.error = err }),
    setSearchQuery: (q) => set(state => { state.searchQuery = q }),
    setShowSFTP: (show) => set(state => { state.showSFTP = show }),
    setSftpWidth: (w) => set(state => { state.sftpWidth = w }),
    updateSessionOsType: (host, username, osType) => set(state => {
      const s = state.sessions.find(s => s.host === host && s.username === username);
      if (s) s.osType = osType;
    }),
    switchWorkspace: async (targetWorkspaceId: string) => {
      set({ connecting: true, error: null });
      try {
        const currentTabs = get().tabs;
        const disconnectPromises = currentTabs.map(async (tab) => {
          return window.electronAPI.nexusCloseTab(tab.id);
        });
        await Promise.all(disconnectPromises);

        const mainSwitchResult = await window.electronAPI.workspace.switchWorkspace(targetWorkspaceId);
        if (!mainSwitchResult.success) {
          throw new Error(mainSwitchResult.error || 'Failed to switch workspace');
        }

        if (window.electronAPI.ai && window.electronAPI.ai.clearHistory) {
           await window.electronAPI.ai.clearHistory(targetWorkspaceId);
        }
        
        set({
          tabs: [],
          activeTabId: null,
          activePaneId: null,
          selectedSessionIndex: null,
          floatingAiContext: null,
        });

        if ((mainSwitchResult as any).profiles) {
           set({ sessions: (mainSwitchResult as any).profiles });
        }

        if (mainSwitchResult.visualMeta?.themeColor) {
          document.documentElement.style.setProperty('--primary-color', mainSwitchResult.visualMeta.themeColor);
        }
        
        return true;
      } catch (err: any) {
        set({ error: err.message || 'Workspace switch failed' });
        return false;
      } finally {
        set({ connecting: false });
      }
    },

    // ⚡ NEXUS RECEIVERS
    syncNexusTree: (tabId, tree) => set(state => {
      if (tree === null) {
        state.tabs = state.tabs.filter(t => t.id !== tabId);
        if (state.activeTabId === tabId) {
          const sshTabs = state.tabs.filter(t => t.id !== 'settings');
          state.activeTabId = sshTabs.length > 0 ? sshTabs[sshTabs.length - 1].id : null;
          state.activePaneId = null;
        }
        return;
      }

      const tab = state.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.paneTree = tree;
      } else {
        // Rust spawned a new tab (e.g., via Tear-off)
        let title = 'Torn Tab';
        if (tree.type === 'leaf') {
          if (tree.paneType === 'plugin') title = 'Torn Plugin';
          if (tree.paneType === 'terminal') title = 'Torn Terminal';
        }
        
        state.tabs.push({
          id: tabId,
          title,
          config: null,
          paneTree: tree,
        });
        state.activeTabId = tabId;
      }
    }),

    patchNexusLeaf: (paneId, updates) => set(state => {
      let patched = false;
      state.tabs.forEach(tab => {
        if (tab.paneTree) {
          mutateLeafInTree(tab.paneTree, paneId, updates, () => { patched = true; });
        }
      });
      if (patched && updates.isDisconnected !== undefined) {
          window.electronAPI.nexusSetDisconnected(paneId, updates.isDisconnected).catch(console.error);
      }
    }),

    patchNexusSizes: (tabId, splitPaneId, sizes) => set(state => {
      const tab = state.tabs.find(t => t.id === tabId);
      if (tab?.paneTree) {
        mutateSizesInTree(tab.paneTree, splitPaneId, sizes);
        window.electronAPI.nexusUpdateSizes(splitPaneId, sizes).catch(console.error);
      }
    }),

    closeTab: (tabId) => {
      const { activeTabId } = get();
      set((state) => {
        const tab = state.tabs.find(t => t.id === tabId);
        if (tab?.paneTree) {
          collectSessionIds(tab.paneTree).forEach(sid => {
            if (sid !== tabId) window.electronAPI.sshDisconnect(sid);
          });
        }
        state.tabs = state.tabs.filter(t => t.id !== tabId);
        if (activeTabId === tabId) {
          const sshTabs = state.tabs.filter(t => t.id !== 'settings');
          state.activeTabId = sshTabs.length > 0 ? sshTabs[sshTabs.length - 1].id : null;
          state.activePaneId = null;
        }
      });
      window.electronAPI.sshDisconnect(tabId);
      window.electronAPI.nexusCloseTab(tabId).catch(console.error);
    },

    registerPluginPanel: (pluginId, panelId, title, renderUrl) => set(state => {
      state.registeredPanels[panelId] = { pluginId, title, renderUrl };
    }),

    openPluginPanel: (pluginId, panelId) => {
      const { registeredPanels } = get();
      const panel = registeredPanels[panelId];
      if (!panel) return;
      const tabId = `panel-${pluginId}-${panelId}`;
      set(state => {
        if (state.tabs.find(t => t.id === tabId)) {
          state.activeTabId = tabId;
          return;
        }
        state.tabs.push({
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
        });
        state.activeTabId = tabId;
        state.activePaneId = tabId;
      });
    }
  }))
);

export function patchLeafDisconnected() { throw new Error('Legacy function removed. Use syncNexusTree instead.'); }
export function patchLeafZoom() { throw new Error('Legacy function removed. Use syncNexusTree instead.'); }
