import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore, DEFAULT_CONFIG } from '../appStore';

describe('appStore - syncConfigEffects', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    window.electronAPI = undefined as any;
    useAppStore.setState({
      appConfig: { ...DEFAULT_CONFIG },
      systemIsDark: false,
      isDark: false
    });
    vi.restoreAllMocks();
  });

  it('saves appConfig to localStorage', () => {
    const { syncConfigEffects } = useAppStore.getState();
    syncConfigEffects();
    expect(localStorage.getItem('appConfig')).toBe(JSON.stringify(DEFAULT_CONFIG));
  });

  it('sets isDark to true and adds dark class when theme is dark', () => {
    useAppStore.setState({ appConfig: { ...DEFAULT_CONFIG, theme: 'dark' } });
    const { syncConfigEffects } = useAppStore.getState();
    syncConfigEffects();
    expect(useAppStore.getState().isDark).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('sets isDark to false and removes dark class when theme is light', () => {
    document.documentElement.classList.add('dark');
    useAppStore.setState({ appConfig: { ...DEFAULT_CONFIG, theme: 'light' } });
    const { syncConfigEffects } = useAppStore.getState();
    syncConfigEffects();
    expect(useAppStore.getState().isDark).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('uses systemIsDark when theme is system (system is dark)', () => {
    useAppStore.setState({ appConfig: { ...DEFAULT_CONFIG, theme: 'system' }, systemIsDark: true });
    const { syncConfigEffects } = useAppStore.getState();
    syncConfigEffects();
    expect(useAppStore.getState().isDark).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('uses systemIsDark when theme is system (system is light)', () => {
    document.documentElement.classList.add('dark');
    useAppStore.setState({ appConfig: { ...DEFAULT_CONFIG, theme: 'system' }, systemIsDark: false });
    const { syncConfigEffects } = useAppStore.getState();
    syncConfigEffects();
    expect(useAppStore.getState().isDark).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('calls electronAPI.updateBackendConfig if available', () => {
    const mockUpdateBackendConfig = vi.fn();
    window.electronAPI = { updateBackendConfig: mockUpdateBackendConfig } as any;

    useAppStore.setState({
      appConfig: { ...DEFAULT_CONFIG, confirmQuit: true, globalHotkey: 'Ctrl+Shift+X' }
    });

    const { syncConfigEffects } = useAppStore.getState();
    syncConfigEffects();

    expect(mockUpdateBackendConfig).toHaveBeenCalledWith({
      confirmQuit: true,
      globalHotkey: 'Ctrl+Shift+X'
    });
  });
});
