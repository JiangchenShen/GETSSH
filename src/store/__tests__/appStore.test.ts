// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore, DEFAULT_CONFIG } from '../appStore';

// Mock browser globals
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

describe('useAppStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      appConfig: DEFAULT_CONFIG,
      isDark: true,
      systemIsDark: true,
      isAppBlurred: false,
      updateAvailable: null,
    });

    // reset electronAPI mock
    (window as any).electronAPI = {
      updateBackendConfig: vi.fn(),
    };

    // We do not mock document.documentElement.classList as jsdom provides it
    document.documentElement.classList.remove('dark');
  });

  it('should have default state', () => {
    const state = useAppStore.getState();
    expect(state.appConfig).toEqual(DEFAULT_CONFIG);
    expect(state.isDark).toBe(true);
    expect(state.systemIsDark).toBe(true);
    expect(state.isAppBlurred).toBe(false);
    expect(state.updateAvailable).toBe(null);
  });

  it('should update appConfig completely', () => {
    const newConfig = { ...DEFAULT_CONFIG, language: 'zh-CN' };
    useAppStore.getState().setAppConfig(newConfig);
    expect(useAppStore.getState().appConfig).toEqual(newConfig);
  });

  it('should update single config value', () => {
    useAppStore.getState().updateConfig('language', 'zh-CN');
    expect(useAppStore.getState().appConfig.language).toBe('zh-CN');
    expect(useAppStore.getState().appConfig.theme).toBe('system');
  });

  it('should update isDark', () => {
    useAppStore.getState().setIsDark(false);
    expect(useAppStore.getState().isDark).toBe(false);
  });

  it('should update systemIsDark', () => {
    useAppStore.getState().setSystemIsDark(false);
    expect(useAppStore.getState().systemIsDark).toBe(false);
  });

  it('should update isAppBlurred', () => {
    useAppStore.getState().setIsAppBlurred(true);
    expect(useAppStore.getState().isAppBlurred).toBe(true);
  });

  it('should update updateAvailable', () => {
    const updateInfo = { version: '1.0.1', url: 'http://example.com' };
    useAppStore.getState().setUpdateAvailable(updateInfo);
    expect(useAppStore.getState().updateAvailable).toEqual(updateInfo);
  });

  describe('loadStoredConfig', () => {
    it('should load valid JSON config from localStorage', () => {
      const storedConfig = { ...DEFAULT_CONFIG, language: 'fr-FR' };
      mockLocalStorage.getItem.mockReturnValueOnce(JSON.stringify(storedConfig));

      useAppStore.getState().loadStoredConfig();

      expect(mockLocalStorage.getItem).toHaveBeenCalledWith('appConfig');
      expect(useAppStore.getState().appConfig.language).toBe('fr-FR');
    });

    it('should fallback to DEFAULT_CONFIG if parsed config is an array', () => {
      mockLocalStorage.getItem.mockReturnValueOnce(JSON.stringify(['invalid', 'array']));

      useAppStore.getState().loadStoredConfig();

      expect(useAppStore.getState().appConfig).toEqual(DEFAULT_CONFIG);
    });

    it('should handle corrupted JSON config in localStorage gracefully', () => {
      mockLocalStorage.getItem.mockReturnValueOnce('{ invalid json');

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      useAppStore.getState().loadStoredConfig();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load stored config:',
        expect.any(SyntaxError)
      );

      consoleSpy.mockRestore();
    });

    it('should migrate legacy theme preference if no appConfig exists', () => {
      mockLocalStorage.getItem.mockImplementation((key) => {
        if (key === 'appConfig') return null;
        if (key === 'themePref') return 'dark';
        return null;
      });

      useAppStore.getState().loadStoredConfig();

      expect(useAppStore.getState().appConfig.theme).toBe('dark');
    });
  });

  describe('syncConfigEffects', () => {
    it('should sync config to localStorage and update document class and electron backend', () => {
      useAppStore.setState({
        appConfig: { ...DEFAULT_CONFIG, theme: 'dark', confirmQuit: true, globalHotkey: 'Ctrl+Space' },
        systemIsDark: false,
      });

      useAppStore.getState().syncConfigEffects();

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'appConfig',
        JSON.stringify(useAppStore.getState().appConfig)
      );

      // Should evaluate theme: 'dark' instead of systemIsDark
      expect(useAppStore.getState().isDark).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect((window as any).electronAPI!.updateBackendConfig).toHaveBeenCalledWith({
        confirmQuit: true,
        globalHotkey: 'Ctrl+Space',
      });
    });

    it('should evaluate system theme correctly when set to system', () => {
      useAppStore.setState({
        appConfig: { ...DEFAULT_CONFIG, theme: 'system' },
        systemIsDark: false,
      });
      document.documentElement.classList.add('dark');

      useAppStore.getState().syncConfigEffects();

      // systemIsDark is false, theme is system -> isDark should be false
      expect(useAppStore.getState().isDark).toBe(false);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('should not throw if window.electronAPI is undefined', () => {
      const originalAPI = (window as any).electronAPI;
      (window as any).electronAPI = undefined;

      expect(() => {
        useAppStore.getState().syncConfigEffects();
      }).not.toThrow();

      (window as any).electronAPI = originalAPI;
    });
  });
});
