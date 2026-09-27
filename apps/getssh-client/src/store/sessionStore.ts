import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
// Only read inside actions: workspaceStore imports this module too.
import { useWorkspaceStore } from './workspaceStore';
import { stripConnectionSecrets } from '../utils/connectionProfile';

// ── Pane Layout Tree ──────────────────────────────────────────────────────

export interface SSHConnectConfig {
    pluginUrl?: string;
    profileId?: string;
    workspaceId?: string;
    protocol?: 'ssh' | 'local' | 'telnet' | 'auto';
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    passphrase?: string;
    keepaliveInterval?: number;
    proxyType?: string;
    proxyHost?: string;
    proxyPort?: number;
    initScript?: string;
    alias?: string;
    strictHostKeyChecking?: boolean;
    initialDirectory?: string;
    postConnectScript?: string;
    themeOverride?: string;
}

export type PaneConfig = SSHConnectConfig | { pluginUrl: string } | { pluginId: string } | { isSettings: true } | { centerType: 'ai' | 'plugin' | 'secure' | 'workspace' | 'settings'; settingsTab?: string; workspacePage?: string } | null;

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
  workspaceId?: string;
  paneTree?: PaneNode;
  isTornOff?: boolean;
}

// ── Session Profile ───────────────────────────────────────────────────────

export type OsType = 'ubuntu' | 'debian' | 'centos' | 'rhel' | 'fedora' | 'alpine' | 'arch' | 'suse' | 'windows' | 'macos' | 'cisco' | 'huawei' | 'generic';

export interface FloatingAiContext {
  x: number;
  y: number;
  selection: string;
}

export interface SessionProfile {
  id?: string;
  isDraft?: boolean;
  isQuickConnect?: boolean; // Temporary connection; never persist as a saved profile.
  protocol?: 'ssh' | 'local' | 'telnet' | 'auto';
  host: string;
  username: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  autoStart?: boolean;
  port?: number;
  useKeepAlive?: boolean;
  alias?: string;
  authType?: 'password' | 'key';
  osType?: OsType;
  group?: string; // e.g. "Production/DB"
  
  // Advanced Networking
  proxyJump?: string;
  strictHostKeyChecking?: boolean;
  
  // Automation
  postConnectScript?: string;
  initialDirectory?: string;
  envVars?: Record<string, string>;
  
  // Appearance
  themeOverride?: string;
}

export const savedProfiles = (sessions: SessionProfile[]) => sessions.filter(session => !session.isDraft && !session.isQuickConnect);

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
  syncNexusTree: (payload: NexusTabSync) => void;
  patchNexusLeaf: (paneId: string, updates: Partial<PaneLeaf>) => void;
  /** Local-only while dragging; pass `commit` once (pointerup) to persist the sizes in nexus-core. */
  patchNexusSizes: (tabId: string, splitPaneId: string, sizes: [number, number], commit?: boolean) => void;
  
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

export function treeHasPane(node: PaneNode, paneId: string): boolean {
  if (node.paneId === paneId) return true;
  return node.type !== 'leaf' && (treeHasPane(node.children[0], paneId) || treeHasPane(node.children[1], paneId));
}

export function firstLeafId(node: PaneNode): string {
  return node.type === 'leaf' ? node.paneId : firstLeafId(node.children[0]);
}

/**
 * nexus:* handlers resolve to `{ success:false, error }` instead of throwing (e.g. native module missing).
 * Normalise both failure shapes and log them so a failed layout call is never silent.
 */
export async function callNexus<T extends { success: boolean; error?: string }>(
  action: string,
  call: Promise<T> | undefined,
): Promise<Partial<T> & { success: boolean; error?: string }> {
  try {
    const res = await call;
    if (res?.success) return res;
    console.error(`[Nexus] ${action} failed:`, res?.error ?? 'no result');
    return { ...res, success: false, error: res?.error ?? 'no_result' } as Partial<T> & { success: boolean; error?: string };
  } catch (e: any) {
    console.error(`[Nexus] ${action} failed:`, e);
    return { success: false, error: e?.message || String(e) } as Partial<T> & { success: boolean; error?: string };
  }
}

// Highest applied sync revision per tab; payloads can arrive out of order across IPC paths.
const lastNexusRev = new Map<string, number>();
// Last pane the user focused in each tab, restored when the tab is re-selected.
const lastPaneByTab = new Map<string, string>();

type SessionDraft = { tabs: Tab[]; activeTabId: string | null; activePaneId: string | null };

// Replacement for a closed/hidden active tab: last non-torn tab of the ACTIVE workspace (App renders only those).
function pickReplacementTab(state: SessionDraft): string | null {
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
  const candidates = state.tabs.filter(t => t.id !== 'settings' && !t.isTornOff && (t.workspaceId ?? workspaceId) === workspaceId);
  return candidates.length > 0 ? candidates[candidates.length - 1].id : null;
}

// Keep activePaneId inside the active tab: remembered pane, else the first leaf.
function reconcileActivePane(state: SessionDraft) {
  const tab = state.activeTabId ? state.tabs.find(t => t.id === state.activeTabId) : undefined;
  if (!tab?.paneTree) {
    state.activePaneId = null;
    return;
  }
  if (state.activePaneId && treeHasPane(tab.paneTree, state.activePaneId)) return;
  const remembered = lastPaneByTab.get(tab.id);
  state.activePaneId = remembered && treeHasPane(tab.paneTree, remembered) ? remembered : firstLeafId(tab.paneTree);
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
    setActiveTabId: (id) => set(state => {
      state.activeTabId = id;
      reconcileActivePane(state);
    }),
    setActivePaneId: (id) => set(state => {
      state.activePaneId = id;
      if (!id) return;
      const owner = state.tabs.find(t => t.paneTree && treeHasPane(t.paneTree, id));
      if (owner) lastPaneByTab.set(owner.id, id);
    }),
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
    syncNexusTree: (payload) => set(state => {
      const { tabId, rev, tree, title, isTornOff, workspaceId } = payload;
      if (typeof rev === 'number') {
        if (rev <= (lastNexusRev.get(tabId) ?? 0)) return;
        lastNexusRev.set(tabId, rev);
      }
      const tabIndex = state.tabs.findIndex(t => t.id === tabId);

      // tree === null: the tab no longer exists. Unknown tabs are ignored (no phantom tabs).
      if (!tree) {
        if (tabIndex < 0) return;
        state.tabs.splice(tabIndex, 1);
        lastPaneByTab.delete(tabId);
        if (state.activeTabId === tabId) state.activeTabId = pickReplacementTab(state);
        reconcileActivePane(state);
        return;
      }

      const tab = tabIndex >= 0 ? state.tabs[tabIndex] : undefined;
      if (tab) {
        const wasTornOff = !!tab.isTornOff;
        tab.paneTree = tree;
        if (title && tab.title !== title) tab.title = title;
        if (workspaceId) tab.workspaceId = workspaceId;
        tab.isTornOff = !!isTornOff;
        if (wasTornOff && !tab.isTornOff) {
          // Torn back in: only bring it forward when it belongs to the workspace on screen.
          const activeWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId;
          if ((tab.workspaceId ?? activeWorkspaceId) === activeWorkspaceId) {
            state.activeTabId = tabId;
            state.activePaneId = firstLeafId(tree);
          }
        } else if (!wasTornOff && tab.isTornOff && state.activeTabId === tabId) {
          // The whole tab moved to its own window; the main view shows another tab of this workspace.
          state.activeTabId = pickReplacementTab(state);
        }
      } else {
        // Tabs first seen through sync (tear-off subtree, other windows). Never auto-focused here.
        const rootConfig = tree.type === 'leaf' ? tree.config : null;
        state.tabs.push({
          id: tabId,
          title: title || (tree.type === 'leaf' && tree.paneType === 'plugin' ? 'Plugin' : 'Terminal'),
          config: rootConfig ?? null,
          workspaceId: workspaceId ?? useWorkspaceStore.getState().activeWorkspaceId,
          paneTree: tree,
          isTornOff: !!isTornOff,
        });
      }
      reconcileActivePane(state);
    }),

    patchNexusLeaf: (paneId, updates) => set(state => {
      let patched = false;
      state.tabs.forEach(tab => {
        if (tab.paneTree) {
          mutateLeafInTree(tab.paneTree, paneId, updates, () => { patched = true; });
        }
      });
      if (patched && updates.isDisconnected !== undefined) {
          void callNexus('set-disconnected', window.electronAPI.nexusSetDisconnected(paneId, updates.isDisconnected));
      }
    }),

    patchNexusSizes: (tabId, splitPaneId, sizes, commit = false) => {
      set(state => {
        const tab = state.tabs.find(t => t.id === tabId);
        if (tab?.paneTree) mutateSizesInTree(tab.paneTree, splitPaneId, sizes);
      });
      if (commit) void callNexus('update-sizes', window.electronAPI.nexusUpdateSizes(splitPaneId, sizes));
    },

    closeTab: (tabId) => {
      const tab = get().tabs.find(t => t.id === tabId);
      // Session ids come from the tree only: a tab id may equal a session that now lives in another tab.
      const sessionIds = tab?.paneTree ? collectSessionIds(tab.paneTree) : [];
      set((state) => {
        state.tabs = state.tabs.filter(t => t.id !== tabId);
        lastPaneByTab.delete(tabId);
        if (state.activeTabId === tabId) state.activeTabId = pickReplacementTab(state);
        reconcileActivePane(state);
      });
      // nexus-core closes the tab and the main process disconnects its sessions.
      // Disconnect here only when that path is unavailable.
      void callNexus('close-tab', window.electronAPI.nexusCloseTab(tabId)).then(res => {
        if (!res.success) sessionIds.forEach(sid => window.electronAPI.sshDisconnect(sid));
      });
    },

    registerPluginPanel: (pluginId, panelId, title, renderUrl) => set(state => {
      state.registeredPanels[panelId] = { pluginId, title, renderUrl };
    }),

    openPluginPanel: (pluginId, panelId) => {
      const { registeredPanels } = get();
      const panel = registeredPanels[panelId];
      if (!panel) return;
      const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
      // Tab ids are global in nexus-core, so one panel tab per workspace.
      const tabId = `panel-${workspaceId}-${pluginId}-${panelId}`;
      const paneId = `${tabId}-pane`;
      if (get().tabs.some(t => t.id === tabId)) {
        get().setActiveTabId(tabId);
        return;
      }
      set(state => {
        state.tabs.push({
          id: tabId,
          title: panel.title,
          config: { pluginUrl: panel.renderUrl },
          workspaceId,
          paneTree: {
            type: 'leaf',
            paneId,
            paneType: 'plugin',
            sessionId: null,
            config: { pluginUrl: panel.renderUrl }
          }
        });
        state.activeTabId = tabId;
        state.activePaneId = paneId;
      });
      // Registered like every other tab so the pane's close/zoom buttons reach nexus-core.
      void callNexus('register plugin panel tab', window.electronAPI.nexusRegisterTab(tabId, paneId, '', 'plugin', JSON.stringify(stripConnectionSecrets({ pluginUrl: panel.renderUrl })), panel.title, workspaceId));
    }
  }))
);

export function patchLeafDisconnected() { throw new Error('Legacy function removed. Use syncNexusTree instead.'); }
export function patchLeafZoom() { throw new Error('Legacy function removed. Use syncNexusTree instead.'); }
