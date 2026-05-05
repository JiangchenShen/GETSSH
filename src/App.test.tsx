/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import App from './App';
import { useSessionStore } from './store/sessionStore';
import { useAppStore } from './store/appStore';
import { usePanelStore } from './store/panelStore';
import { usePluginStore } from './store/pluginStore';
import { useCryptoStore } from './store/cryptoStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
}));

vi.mock('./components/Terminal', () => ({
  Terminal: () => <div data-testid="mock-terminal">Terminal</div>
}));

vi.mock('./components/PluginSettings', () => ({
  PluginSettings: () => <div data-testid="mock-plugin-settings">PluginSettings</div>
}));

vi.mock('./components/SFTPManager', () => ({
  SFTPManager: () => <div data-testid="mock-sftp-manager">SFTPManager</div>
}));

vi.mock('./components/SplitPane', () => ({
  SplitPane: ({ children }: any) => <div data-testid="mock-split-pane">{children}</div>
}));

vi.mock('./components/TabBar', () => ({
  TabBar: () => <div data-testid="mock-tab-bar">TabBar</div>
}));

vi.mock('./components/EmptyState', () => ({
  EmptyState: () => <div data-testid="mock-empty-state">EmptyState</div>
}));

vi.mock('./plugins/PluginBridge', () => ({
  initPluginBridge: vi.fn(() => vi.fn()),
  bootSandboxedPlugins: vi.fn(),
}));

// Setup window.electronAPI
window.electronAPI = {
  sshConnect: vi.fn().mockResolvedValue({ success: true, sessionId: 'test-session-id' }),
  sshDisconnect: vi.fn(),
  sshResize: vi.fn(),
  sshData: vi.fn(),
  sftpRequest: vi.fn(),
  sftpList: vi.fn(),
  sftpGet: vi.fn(),
  sftpPut: vi.fn(),
  sftpMkdir: vi.fn(),
  sftpRm: vi.fn(),
  sftpRename: vi.fn(),
  getProfiles: vi.fn().mockResolvedValue([]),
  saveProfiles: vi.fn().mockResolvedValue(undefined),
  deleteProfile: vi.fn().mockResolvedValue(undefined),
  getConfig: vi.fn().mockResolvedValue({}),
  saveConfig: vi.fn().mockResolvedValue(undefined),
  platform: vi.fn().mockResolvedValue('linux'),
  on: vi.fn(),
  off: vi.fn(),
  installPlugin: vi.fn(),
  uninstallPlugin: vi.fn(),
  getPlugins: vi.fn().mockResolvedValue([]),
  getPluginState: vi.fn(),
  setPluginState: vi.fn(),
  invokePluginAction: vi.fn(),
  onPluginMessage: vi.fn(),
  selectFile: vi.fn(),
  readFile: vi.fn(),
  selectDirectory: vi.fn(),
  openExternal: vi.fn(),
  focusWindow: vi.fn(),
  safeStorageStatus: vi.fn().mockResolvedValue('unavailable'),
  checkProfiles: vi.fn().mockResolvedValue('none'),
  onUpdateAvailable: vi.fn(),
} as any;

describe('App Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      sessions: [],
      tabs: [],
      activeTabId: null,
      selectedSessionIndex: null,
      searchQuery: '',
      connecting: false,
      error: null,
    });
    useAppStore.setState({
      appConfig: { defaultPort: 22, themeColor: "119,173,255" } as any,
      isDark: true,
      systemIsDark: true,
      isAppBlurred: false,
    });
    useCryptoStore.setState({
      cryptoMode: 'idle',
      masterPassword: '',
    });
    usePanelStore.setState({
      panels: [],
      activePanelId: null,
      panelSizes: {},
    });
    usePluginStore.setState({
      installedPlugins: [],
      sidebarActions: [],
    });
  });

  it('renders without crashing', async () => {
    render(<App />);
    expect(screen.getByTestId('mock-tab-bar')).toBeDefined();
    await waitFor(() => {
      expect(window.electronAPI.checkProfiles).toHaveBeenCalled();
    });
  });

  it('shows connect form when a session is selected and connects on submit', async () => {
    const mockSession = {
      id: 'session-1',
      name: 'Test Session',
      host: '127.0.0.1',
      username: 'user',
      port: 22,
    };

    useSessionStore.setState({
      sessions: [mockSession as any],
      selectedSessionIndex: 0,
      activeTabId: null, // Ensure not on settings
    });

    render(<App />);

    // Check if the connect form header is rendered
    expect(screen.getAllByText('Connect to Server').length).toBeGreaterThan(0);

    // Verify fields are populated from the store
    const hostInput = screen.getAllByDisplayValue('127.0.0.1')[0];
    expect(hostInput).toBeDefined();

    // Find the connect button (via its text or role)
    const submitButton = screen.getAllByText('connect.connectBtn')[0];

    // Make sure sshConnect is not called yet
    expect(window.electronAPI.sshConnect).not.toHaveBeenCalled();

    // Submit the form
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(window.electronAPI.sshConnect).toHaveBeenCalledWith(expect.objectContaining({
        host: '127.0.0.1',
        username: 'user',
        port: 22
      }));
    });
  });

  it('navigates through settings tabs correctly', () => {
    useSessionStore.setState({
      activeTabId: 'settings', // Open settings
      tabs: [{ id: 'settings', title: 'Settings' }] as any,
    });

    render(<App />);

    // Check if the Appearance tab is selected by default
    // We mocked react-i18next so t('settings.appearance') returns 'settings.appearance'
    // The h3 looks like: {t('settings.appearance')} {t('settings.configuration')} -> 'settings.appearance settings.configuration'
    expect(screen.getAllByText('settings.appearance settings.configuration').length).toBeGreaterThan(0);

    // Click the Terminal settings tab
    const terminalTabButton = screen.getAllByText('settings.terminal')[0];
    fireEvent.click(terminalTabButton);

    // Check if terminal settings are rendered
    expect(screen.getAllByText('settings.terminal settings.configuration').length).toBeGreaterThan(0);

    // Click the About settings tab
    const aboutTabButton = screen.getAllByText('settings.about')[0];
    fireEvent.click(aboutTabButton);

    // Check if about settings are rendered
    expect(screen.getAllByText('about.version').length).toBeGreaterThan(0);
  });
});
