import { create } from 'zustand';

export interface AppConfig {
  language: string;
  themeColor: string;
  theme: 'system' | 'light' | 'dark';
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  bgOpacity: number;
  copyOnSelect: boolean;
  cursorStyle: 'block' | 'underline' | 'bar';
  scrollback: number;
  keepalive: number;
  defaultPort: number;
  confirmQuit: boolean;
  globalHotkey: string;
  proxyType: 'none' | 'socks5' | 'http';
  proxyHost: string;
  proxyPort: number;
  privacyMode: boolean;
  initScript: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  language: 'en-US',
  themeColor: '168 85 247',
  theme: 'system',
  fontFamily: '"Fira Code", monospace, "Courier New", Courier',
  fontSize: 14,
  lineHeight: 1.2,
  bgOpacity: 1,
  copyOnSelect: false,
  cursorStyle: 'block',
  scrollback: 10000,
  keepalive: 15,
  defaultPort: 22,
  confirmQuit: false,
  globalHotkey: 'Option+Space',
  proxyType: 'none',
  proxyHost: '127.0.0.1',
  proxyPort: 1080,
  privacyMode: false,
  initScript: ''
};

interface AppStore {
  appConfig: AppConfig;
  isDark: boolean;
  systemIsDark: boolean;
  isAppBlurred: boolean;

  setAppConfig: (config: AppConfig) => void;
  updateConfig: <K extends keyof AppConfig>(key: K, val: AppConfig[K]) => void;
  setIsDark: (dark: boolean) => void;
  setSystemIsDark: (dark: boolean) => void;
  setIsAppBlurred: (blurred: boolean) => void;
  loadStoredConfig: () => void;
  syncConfigEffects: () => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  appConfig: DEFAULT_CONFIG,
  isDark: true,
  systemIsDark: true,
  isAppBlurred: false,

  setAppConfig: (config) => set({ appConfig: config }),
  updateConfig: (key, val) => set((state) => ({
    appConfig: { ...state.appConfig, [key]: val }
  })),
  setIsDark: (dark) => set({ isDark: dark }),
  setSystemIsDark: (dark) => set({ systemIsDark: dark }),
  setIsAppBlurred: (blurred) => set({ isAppBlurred: blurred }),

  loadStoredConfig: () => {
    try {
      const storedConf = localStorage.getItem('appConfig');
      if (storedConf) {
        set({ appConfig: { ...DEFAULT_CONFIG, ...JSON.parse(storedConf) } });
      } else {
        const legacyTheme = localStorage.getItem('themePref');
        if (legacyTheme) set((s) => ({ appConfig: { ...s.appConfig, theme: legacyTheme as any } }));
      }
    } catch {}
  },

  syncConfigEffects: () => {
    const { appConfig, systemIsDark } = get();
    localStorage.setItem('appConfig', JSON.stringify(appConfig));
    const dark = appConfig.theme === 'system' ? systemIsDark : appConfig.theme === 'dark';
    set({ isDark: dark });
    if (dark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    if (window.electronAPI?.updateBackendConfig) {
      window.electronAPI.updateBackendConfig({ confirmQuit: appConfig.confirmQuit, globalHotkey: appConfig.globalHotkey });
    }
  },
}));
