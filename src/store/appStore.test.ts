import { describe, it, test, expect, vi, beforeEach, beforeAll } from 'vitest';
import { useAppStore, DEFAULT_CONFIG } from './appStore';

// Mock browser globals using vi.stubGlobal (compatible with both test suites)
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] || null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value.toString(); }),
  removeItem: vi.fn((key: string) => { delete localStorageStore[key]; }),
  clear: vi.fn(() => { for (const key in localStorageStore) delete localStorageStore[key]; }),
};

const classListAddMock = vi.fn();
const classListRemoveMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal('localStorage', localStorageMock);
  vi.stubGlobal('document', {
    documentElement: {
      classList: {
        add: classListAddMock,
        remove: classListRemoveMock,
      }
    }
  });
  vi.stubGlobal('window', {
    electronAPI: {
      updateBackendConfig: vi.fn()
    }
  });
});

describe('useAppStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key in localStorageStore) delete localStorageStore[key];
    useAppStore.setState({
      appConfig: { ...DEFAULT_CONFIG },
      isDark: true,
      systemIsDark: true,
      isAppBlurred: false,
    });
  });

  // ── loadStoredConfig ──────────────────────────────────────────────────────
  describe('loadStoredConfig', () => {
    test('loads appConfig from localStorage and merges with DEFAULT_CONFIG', () => {
      localStorageStore['appConfig'] = JSON.stringify({ fontSize: 24, theme: 'dark' });

      useAppStore.getState().loadStoredConfig();

      const config = useAppStore.getState().appConfig;
      expect(config.fontSize).toBe(24);
      expect(config.theme).toBe('dark');
      expect(config.language).toBe('en-US'); // default value preserved
    });

    test('loads legacy themePref if appConfig is not present', () => {
      localStorageStore['themePref'] = 'light';

      useAppStore.getState().loadStoredConfig();

      const config = useAppStore.getState().appConfig;
      expect(config.theme).toBe('light');
      expect(config.fontSize).toBe(14); // default value preserved
    });

    test('does not throw when appConfig is invalid JSON', () => {
      localStorageStore['appConfig'] = '{ invalid json }';

      expect(() => {
        useAppStore.getState().loadStoredConfig();
      }).not.toThrow();

      const config = useAppStore.getState().appConfig;
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    test('does nothing if no config or legacy theme is present', () => {
      useAppStore.getState().loadStoredConfig();

      const config = useAppStore.getState().appConfig;
      expect(config).toEqual(DEFAULT_CONFIG);
    });
  });

  // ── syncConfigEffects ─────────────────────────────────────────────────────
  describe('syncConfigEffects', () => {
    it('saves appConfig to localStorage', () => {
      const { syncConfigEffects } = useAppStore.getState();
      syncConfigEffects();

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'appConfig',
        JSON.stringify(DEFAULT_CONFIG)
      );
    });

    it('sets isDark to true and adds dark class when theme is "dark"', () => {
      useAppStore.setState({
        appConfig: { ...DEFAULT_CONFIG, theme: 'dark' },
        systemIsDark: false // Should be ignored when theme is explicitly 'dark'
      });

      const { syncConfigEffects } = useAppStore.getState();
      syncConfigEffects();

      const { isDark } = useAppStore.getState();
      expect(isDark).toBe(true);
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
      expect(document.documentElement.classList.remove).not.toHaveBeenCalled();
    });

    it('sets isDark to false and removes dark class when theme is "light"', () => {
      useAppStore.setState({
        appConfig: { ...DEFAULT_CONFIG, theme: 'light' },
        systemIsDark: true // Should be ignored when theme is explicitly 'light'
      });

      const { syncConfigEffects } = useAppStore.getState();
      syncConfigEffects();

      const { isDark } = useAppStore.getState();
      expect(isDark).toBe(false);
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');
      expect(document.documentElement.classList.add).not.toHaveBeenCalled();
    });

    it('uses systemIsDark when theme is "system" (system is dark)', () => {
      useAppStore.setState({
        appConfig: { ...DEFAULT_CONFIG, theme: 'system' },
        systemIsDark: true
      });

      const { syncConfigEffects } = useAppStore.getState();
      syncConfigEffects();

      const { isDark } = useAppStore.getState();
      expect(isDark).toBe(true);
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
    });

    it('uses systemIsDark when theme is "system" (system is light)', () => {
      useAppStore.setState({
        appConfig: { ...DEFAULT_CONFIG, theme: 'system' },
        systemIsDark: false
      });

      const { syncConfigEffects } = useAppStore.getState();
      syncConfigEffects();

      const { isDark } = useAppStore.getState();
      expect(isDark).toBe(false);
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');
    });

    it('calls window.electronAPI.updateBackendConfig if available', () => {
      const config = { ...DEFAULT_CONFIG, confirmQuit: true, globalHotkey: 'Ctrl+Q' };
      useAppStore.setState({ appConfig: config });

      const { syncConfigEffects } = useAppStore.getState();
      syncConfigEffects();

      // @ts-ignore
      expect(window.electronAPI.updateBackendConfig).toHaveBeenCalledWith({
        confirmQuit: true,
        globalHotkey: 'Ctrl+Q'
      });
    });

    it('does not error if window.electronAPI is undefined', () => {
      // Temporarily remove electronAPI
      const originalElectronAPI = (window as any).electronAPI;
      (window as any).electronAPI = undefined;

      const { syncConfigEffects } = useAppStore.getState();

      // Should not throw
      expect(() => syncConfigEffects()).not.toThrow();

      // Restore
      (window as any).electronAPI = originalElectronAPI;
    });
  });
});
