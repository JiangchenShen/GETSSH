import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { useSessionStore } from './sessionStore';

const sshDisconnectMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal('window', {
    electronAPI: {
      sshDisconnect: sshDisconnectMock,
    }
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  // Reset store to initial state
  useSessionStore.setState({
    sessions: [],
    tabs: [],
    activeTabId: null,
    selectedSessionIndex: null,
    connecting: false,
    error: null,
    searchQuery: '',
    showSFTP: false,
    sftpWidth: 320,
  });
});

describe('sessionStore', () => {
  describe('state setters', () => {
    it('should set sessions', () => {
      const sessions = [{ host: '127.0.0.1', username: 'root' }];
      useSessionStore.getState().setSessions(sessions);
      expect(useSessionStore.getState().sessions).toEqual(sessions);
    });

    it('should set tabs using an array', () => {
      const tabs = [{ id: 'tab1', title: 'Tab 1', config: {} }];
      useSessionStore.getState().setTabs(tabs);
      expect(useSessionStore.getState().tabs).toEqual(tabs);
    });

    it('should set tabs using an updater function', () => {
      const initialTabs = [{ id: 'tab1', title: 'Tab 1', config: {} }];
      useSessionStore.setState({ tabs: initialTabs });

      const newTab = { id: 'tab2', title: 'Tab 2', config: {} };
      useSessionStore.getState().setTabs((prev) => [...prev, newTab]);

      expect(useSessionStore.getState().tabs).toEqual([...initialTabs, newTab]);
    });

    it('should set activeTabId', () => {
      useSessionStore.getState().setActiveTabId('tab1');
      expect(useSessionStore.getState().activeTabId).toBe('tab1');
    });

    it('should set selectedSessionIndex', () => {
      useSessionStore.getState().setSelectedSessionIndex(1);
      expect(useSessionStore.getState().selectedSessionIndex).toBe(1);
    });

    it('should set connecting state', () => {
      useSessionStore.getState().setConnecting(true);
      expect(useSessionStore.getState().connecting).toBe(true);
    });

    it('should set error', () => {
      useSessionStore.getState().setError('Connection failed');
      expect(useSessionStore.getState().error).toBe('Connection failed');
    });

    it('should set searchQuery', () => {
      useSessionStore.getState().setSearchQuery('server1');
      expect(useSessionStore.getState().searchQuery).toBe('server1');
    });

    it('should set showSFTP', () => {
      useSessionStore.getState().setShowSFTP(true);
      expect(useSessionStore.getState().showSFTP).toBe(true);
    });

    it('should set sftpWidth', () => {
      useSessionStore.getState().setSftpWidth(500);
      expect(useSessionStore.getState().sftpWidth).toBe(500);
    });
  });

  describe('closeTab', () => {
    it('should remove an inactive tab and keep activeTabId unchanged', () => {
      useSessionStore.setState({
        tabs: [
          { id: 'tab1', title: 'Tab 1', config: {} },
          { id: 'tab2', title: 'Tab 2', config: {} }
        ],
        activeTabId: 'tab1'
      });

      useSessionStore.getState().closeTab('tab2');

      const state = useSessionStore.getState();
      expect(state.tabs).toEqual([{ id: 'tab1', title: 'Tab 1', config: {} }]);
      expect(state.activeTabId).toBe('tab1');
      expect(sshDisconnectMock).toHaveBeenCalledWith('tab2');
    });

    it('should switch to the last remaining ssh tab when removing the active tab', () => {
      useSessionStore.setState({
        tabs: [
          { id: 'tab1', title: 'Tab 1', config: {} },
          { id: 'tab2', title: 'Tab 2', config: {} },
          { id: 'settings', title: 'Settings', config: {} }
        ],
        activeTabId: 'tab2'
      });

      useSessionStore.getState().closeTab('tab2');

      const state = useSessionStore.getState();
      expect(state.tabs).toEqual([
        { id: 'tab1', title: 'Tab 1', config: {} },
        { id: 'settings', title: 'Settings', config: {} }
      ]);
      expect(state.activeTabId).toBe('tab1');
      expect(sshDisconnectMock).toHaveBeenCalledWith('tab2');
    });

    it('should set activeTabId to null when removing the active tab and no ssh tabs remain', () => {
      useSessionStore.setState({
        tabs: [
          { id: 'tab1', title: 'Tab 1', config: {} },
          { id: 'settings', title: 'Settings', config: {} }
        ],
        activeTabId: 'tab1'
      });

      useSessionStore.getState().closeTab('tab1');

      const state = useSessionStore.getState();
      expect(state.tabs).toEqual([
        { id: 'settings', title: 'Settings', config: {} }
      ]);
      expect(state.activeTabId).toBeNull();
      expect(sshDisconnectMock).toHaveBeenCalledWith('tab1');
    });
  });
});