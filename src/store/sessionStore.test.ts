import { describe, it, test, expect, vi, beforeEach, beforeAll } from 'vitest';
import { useSessionStore } from './sessionStore';

const sshDisconnectMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal('window', {
    electronAPI: {
      sshDisconnect: sshDisconnectMock,
    }
  });
});

describe('useSessionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useSessionStore.getState();
      expect(state.sessions).toEqual([]);
      expect(state.tabs).toEqual([]);
      expect(state.activeTabId).toBeNull();
      expect(state.selectedSessionIndex).toBeNull();
      expect(state.connecting).toBe(false);
      expect(state.error).toBeNull();
      expect(state.searchQuery).toBe('');
      expect(state.showSFTP).toBe(false);
      expect(state.sftpWidth).toBe(320);
    });
  });

  describe('state setters', () => {
    it('setSessions should update sessions', () => {
      const mockSessions = [{ host: 'localhost', username: 'test' }];
      useSessionStore.getState().setSessions(mockSessions);
      expect(useSessionStore.getState().sessions).toEqual(mockSessions);
    });

    it('setTabs should update tabs with array', () => {
      const mockTabs = [{ id: '1', title: 'Tab 1', config: {} }];
      useSessionStore.getState().setTabs(mockTabs);
      expect(useSessionStore.getState().tabs).toEqual(mockTabs);
    });

    it('setTabs should update tabs with updater function', () => {
      const initialTabs = [{ id: '1', title: 'Tab 1', config: {} }];
      useSessionStore.setState({ tabs: initialTabs });

      const newTab = { id: '2', title: 'Tab 2', config: {} };
      useSessionStore.getState().setTabs(prev => [...prev, newTab]);
      expect(useSessionStore.getState().tabs).toEqual([...initialTabs, newTab]);
    });

    it('setActiveTabId should update activeTabId', () => {
      useSessionStore.getState().setActiveTabId('tab-1');
      expect(useSessionStore.getState().activeTabId).toBe('tab-1');
    });

    it('setSelectedSessionIndex should update selectedSessionIndex', () => {
      useSessionStore.getState().setSelectedSessionIndex(2);
      expect(useSessionStore.getState().selectedSessionIndex).toBe(2);
    });

    it('setConnecting should update connecting', () => {
      useSessionStore.getState().setConnecting(true);
      expect(useSessionStore.getState().connecting).toBe(true);
    });

    it('setError should update error', () => {
      useSessionStore.getState().setError('Connection failed');
      expect(useSessionStore.getState().error).toBe('Connection failed');
    });

    it('setSearchQuery should update searchQuery', () => {
      useSessionStore.getState().setSearchQuery('my server');
      expect(useSessionStore.getState().searchQuery).toBe('my server');
    });

    it('setShowSFTP should update showSFTP', () => {
      useSessionStore.getState().setShowSFTP(true);
      expect(useSessionStore.getState().showSFTP).toBe(true);
    });

    it('setSftpWidth should update sftpWidth', () => {
      useSessionStore.getState().setSftpWidth(400);
      expect(useSessionStore.getState().sftpWidth).toBe(400);
    });
  });

  describe('closeTab', () => {
    it('should remove the tab and call sshDisconnect', () => {
      const mockTabs = [
        { id: '1', title: 'Tab 1', config: {} },
        { id: '2', title: 'Tab 2', config: {} }
      ];
      useSessionStore.setState({ tabs: mockTabs, activeTabId: '1' });

      useSessionStore.getState().closeTab('2');

      expect(useSessionStore.getState().tabs).toEqual([{ id: '1', title: 'Tab 1', config: {} }]);
      expect(useSessionStore.getState().activeTabId).toBe('1');
      expect(sshDisconnectMock).toHaveBeenCalledWith('2');
    });

    it('should update activeTabId to last remaining ssh tab if closed tab was active', () => {
      const mockTabs = [
        { id: '1', title: 'Tab 1', config: {} },
        { id: '2', title: 'Tab 2', config: {} },
        { id: '3', title: 'Tab 3', config: {} }
      ];
      useSessionStore.setState({ tabs: mockTabs, activeTabId: '3' });

      useSessionStore.getState().closeTab('3');

      expect(useSessionStore.getState().tabs).toEqual([
        { id: '1', title: 'Tab 1', config: {} },
        { id: '2', title: 'Tab 2', config: {} }
      ]);
      expect(useSessionStore.getState().activeTabId).toBe('2');
      expect(sshDisconnectMock).toHaveBeenCalledWith('3');
    });

    it('should update activeTabId to null if closed tab was active and no ssh tabs remain', () => {
      const mockTabs = [
        { id: '1', title: 'Tab 1', config: {} }
      ];
      useSessionStore.setState({ tabs: mockTabs, activeTabId: '1' });

      useSessionStore.getState().closeTab('1');

      expect(useSessionStore.getState().tabs).toEqual([]);
      expect(useSessionStore.getState().activeTabId).toBeNull();
      expect(sshDisconnectMock).toHaveBeenCalledWith('1');
    });

    it('should skip settings tab when selecting a new active tab', () => {
      const mockTabs = [
        { id: '1', title: 'Tab 1', config: {} },
        { id: 'settings', title: 'Settings', config: {} },
        { id: '3', title: 'Tab 3', config: {} }
      ];
      useSessionStore.setState({ tabs: mockTabs, activeTabId: '3' });

      useSessionStore.getState().closeTab('3');

      expect(useSessionStore.getState().tabs).toEqual([
        { id: '1', title: 'Tab 1', config: {} },
        { id: 'settings', title: 'Settings', config: {} }
      ]);
      expect(useSessionStore.getState().activeTabId).toBe('1');
      expect(sshDisconnectMock).toHaveBeenCalledWith('3');
    });

    it('should update activeTabId to null if closed tab was active and only settings tab remain', () => {
      const mockTabs = [
        { id: 'settings', title: 'Settings', config: {} },
        { id: '1', title: 'Tab 1', config: {} }
      ];
      useSessionStore.setState({ tabs: mockTabs, activeTabId: '1' });

      useSessionStore.getState().closeTab('1');

      expect(useSessionStore.getState().tabs).toEqual([
        { id: 'settings', title: 'Settings', config: {} }
      ]);
      expect(useSessionStore.getState().activeTabId).toBeNull();
      expect(sshDisconnectMock).toHaveBeenCalledWith('1');
    });
  });
});
