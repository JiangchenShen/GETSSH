import { create } from 'zustand';

export interface Tab {
  id: string;
  title: string;
  config: any;
}

export interface SessionProfile {
  host: string;
  username: string;
  password?: string;
  privateKeyPath?: string;
  autoStart?: boolean;
  port?: number;
  useKeepAlive?: boolean;
}

interface SessionStore {
  sessions: SessionProfile[];
  tabs: Tab[];
  activeTabId: string | null;
  selectedSessionIndex: number | null;
  connecting: boolean;
  error: string | null;
  searchQuery: string;
  showSFTP: boolean;
  sftpWidth: number;

  setSessions: (sessions: SessionProfile[]) => void;
  setTabs: (updater: Tab[] | ((prev: Tab[]) => Tab[])) => void;
  setActiveTabId: (id: string | null) => void;
  setSelectedSessionIndex: (idx: number | null) => void;
  setConnecting: (val: boolean) => void;
  setError: (err: string | null) => void;
  setSearchQuery: (q: string) => void;
  setShowSFTP: (show: boolean) => void;
  setSftpWidth: (w: number) => void;

  closeTab: (tabId: string) => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  tabs: [],
  activeTabId: null,
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
  setSelectedSessionIndex: (idx) => set({ selectedSessionIndex: idx }),
  setConnecting: (val) => set({ connecting: val }),
  setError: (err) => set({ error: err }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setShowSFTP: (show) => set({ showSFTP: show }),
  setSftpWidth: (w) => set({ sftpWidth: w }),

  closeTab: (tabId) => {
    const { activeTabId } = get();
    set((state) => {
      const remaining = state.tabs.filter(t => t.id !== tabId);
      let newActiveId = state.activeTabId;
      if (activeTabId === tabId) {
        const sshTabs = remaining.filter(t => t.id !== 'settings');
        newActiveId = sshTabs.length > 0 ? sshTabs[sshTabs.length - 1].id : null;
      }
      return { tabs: remaining, activeTabId: newActiveId };
    });
    window.electronAPI.sshDisconnect(tabId);
  },
}));
