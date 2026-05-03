import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { useAppStore, DEFAULT_CONFIG } from './appStore';

// Mock browser globals properly
beforeAll(() => {
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value.toString();
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
    };
  })();

  vi.stubGlobal('localStorage', localStorageMock);

  const classListAddMock = vi.fn();
  const classListRemoveMock = vi.fn();

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
    useAppStore.setState({
      appConfig: DEFAULT_CONFIG,
      isDark: true,
      systemIsDark: true,
      isAppBlurred: false,
    });
  });

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
