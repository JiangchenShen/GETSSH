import { create } from 'zustand';

export interface AppConfig {
  language: string;
  themeColor: string;
  theme: 'system' | 'light' | 'dark';
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  bgOpacity: number;
  enableGlassmorphism: boolean;
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
  autoLockTimeout: number;
  pluginSecurityMode: 'safe' | 'strict' | 'normal' | 'developer';
  antiGlare?: boolean;
  terminalPadding?: number;
  cursorBlink?: boolean;
  bellStyle?: 'none' | 'audible' | 'visual';
  rightClickBehavior?: 'menu' | 'paste';
  terminalTheme: string;
  customThemes?: Record<string, any>;
  sftpDownloadPath?: string;
}

const isWindows = typeof process !== 'undefined' ? process.platform === 'win32' : navigator.userAgent.includes('Win');

export const DEFAULT_CONFIG: AppConfig = {
  language: 'en-US',
  themeColor: '168 85 247',
  theme: 'system',
  fontFamily: '"Fira Code", monospace, "Courier New", Courier',
  fontSize: 14,
  lineHeight: 1.2,
  bgOpacity: 1,
  enableGlassmorphism: true,
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
  initScript: '',
  autoLockTimeout: 0,
  terminalTheme: 'default',
  pluginSecurityMode: 'normal',
  antiGlare: false,
  terminalPadding: 8,
  cursorBlink: true,
  bellStyle: 'visual',
  rightClickBehavior: isWindows ? 'paste' : 'menu',
  customThemes: {},
  sftpDownloadPath: '',
};

interface AppStore {
  appConfig: AppConfig;
  isDark: boolean;
  systemIsDark: boolean;
  isAppBlurred: boolean;
  updateAvailable: { version: string; url: string } | null;
  securityPrompt: { isOpen: boolean; requestId: string; hostname: string; fingerprint: string; isChanged?: boolean; oldFingerprint?: string } | null;
  isMac: boolean;
  isFullScreen: boolean;

  setAppConfig: (config: AppConfig) => void;
  updateConfig: <K extends keyof AppConfig>(key: K, val: AppConfig[K]) => void;
  setIsDark: (dark: boolean) => void;
  setSystemIsDark: (dark: boolean) => void;
  setIsAppBlurred: (blurred: boolean) => void;
  setUpdateAvailable: (info: { version: string; url: string } | null) => void;
  setIsFullScreen: (full: boolean) => void;
  setSecurityPrompt: (prompt: { isOpen: boolean; requestId: string; hostname: string; fingerprint: string; isChanged?: boolean; oldFingerprint?: string } | null) => void;
  resolveSecurityPrompt: (result: 'accept-save' | 'accept-once' | 'reject') => void;
  isPolluted: boolean;
  setIsPolluted: (polluted: boolean) => void;
  watchdogStatus: { status: 'secure' | 'warning', level?: 'red' | 'yellow', reason?: string, lastPing: number, watchdogDisabled?: boolean } | null;
  setWatchdogStatus: (status: { status: 'secure' | 'warning', level?: 'red' | 'yellow', reason?: string, lastPing: number, watchdogDisabled?: boolean } | null) => void;
  pollWatchdogStatus: () => void;
  loadStoredConfig: () => void;
  syncConfigEffects: () => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  appConfig: DEFAULT_CONFIG,
  isDark: true,
  systemIsDark: true,
  isAppBlurred: false,
  updateAvailable: null,
  securityPrompt: null,
  isMac: window.electronAPI?.getEnvInfo ? window.electronAPI.getEnvInfo().platform === 'darwin' : false,
  isFullScreen: false,
  isPolluted: false,
  watchdogStatus: null,

  setAppConfig: (config) => set({ appConfig: config }),
  updateConfig: (key, val) => set((state) => ({
    appConfig: { ...state.appConfig, [key]: val }
  })),
  setIsDark: (dark) => set({ isDark: dark }),
  setSystemIsDark: (dark) => set({ systemIsDark: dark }),
  setIsAppBlurred: (blurred) => set({ isAppBlurred: blurred }),
  setUpdateAvailable: (info) => set({ updateAvailable: info }),
  setIsFullScreen: (full) => set({ isFullScreen: full }),
  setIsPolluted: (polluted) => set({ isPolluted: polluted }),
  setSecurityPrompt: (prompt) => set({ securityPrompt: prompt }),
  resolveSecurityPrompt: (result) => {
    const { securityPrompt } = get();
    if (securityPrompt && window.electronAPI?.sendHostVerificationResult) {
      window.electronAPI.sendHostVerificationResult({
        requestId: securityPrompt.requestId,
        result,
        hostname: securityPrompt.hostname,
        fingerprint: securityPrompt.fingerprint,
      });
      set({ securityPrompt: null });
    }
  },
  
  setWatchdogStatus: (status) => set({ watchdogStatus: status }),
  
  pollWatchdogStatus: async () => {
    if (window.electronAPI?.getWatchdogStatus) {
      try {
        const status = await window.electronAPI.getWatchdogStatus();
        set({ watchdogStatus: status });
      } catch (e) {
        console.error("Failed to fetch watchdog status", e);
      }
    }
  },

  loadStoredConfig: async () => {
    try {
      const storedConf = localStorage.getItem('appConfig');
      if (storedConf) {
        const parsed = JSON.parse(storedConf);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          set({ appConfig: { ...DEFAULT_CONFIG, ...parsed } });
          
          // Load secure fields
          if (window.electronAPI?.decryptConfig) {
            const secureData = localStorage.getItem('appConfig_secure');
            if (secureData) {
              const dec = await window.electronAPI.decryptConfig(secureData);
              if (dec) {
                set((state) => ({ appConfig: { ...state.appConfig, ...dec } }));
                if (window.electronAPI?.updateBackendConfig) {
                  const currentAppConfig = get().appConfig;
                  window.electronAPI.updateBackendConfig({ 
                    confirmQuit: currentAppConfig.confirmQuit, 
                    globalHotkey: currentAppConfig.globalHotkey,
                    pluginSecurityMode: currentAppConfig.pluginSecurityMode,
                    initScript: currentAppConfig.initScript,
                    proxyHost: currentAppConfig.proxyHost,
                    proxyPort: currentAppConfig.proxyPort
                  });
                }
              }
            }
          }
        } else {
          set({ appConfig: { ...DEFAULT_CONFIG } });
        }
      } else {
        const legacyTheme = localStorage.getItem('themePref');
        if (legacyTheme === 'system' || legacyTheme === 'light' || legacyTheme === 'dark') {
          set((s) => ({ appConfig: { ...s.appConfig, theme: legacyTheme } }));
        }
      }
    } catch (error) {
      console.error('Failed to load stored config:', error);
    }
  },

  syncConfigEffects: () => {
    const { appConfig, systemIsDark } = get();
    
    const safeConfig = { ...appConfig };
    const sensitive = {
      initScript: safeConfig.initScript,
      proxyHost: safeConfig.proxyHost,
      proxyPort: safeConfig.proxyPort
    };
    
    delete safeConfig.initScript;
    delete (safeConfig as any).proxyHost;
    delete (safeConfig as any).proxyPort;
    
    localStorage.setItem('appConfig', JSON.stringify(safeConfig));
    
    if (window.electronAPI?.encryptConfig) {
      window.electronAPI.encryptConfig(sensitive).then(enc => {
        if (enc) localStorage.setItem('appConfig_secure', enc);
      });
    }

    const dark = appConfig.theme === 'system' ? systemIsDark : appConfig.theme === 'dark';
    set({ isDark: dark });
    if (dark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    if (window.electronAPI?.updateBackendConfig) {
      window.electronAPI.updateBackendConfig({ 
        confirmQuit: appConfig.confirmQuit, 
        globalHotkey: appConfig.globalHotkey,
        pluginSecurityMode: appConfig.pluginSecurityMode,
        initScript: appConfig.initScript,
        proxyHost: appConfig.proxyHost,
        proxyPort: appConfig.proxyPort
      });
    }
  },
}));
