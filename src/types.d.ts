export {};

declare global {
  interface Window {
    electronAPI: {
      getTheme: () => Promise<boolean>;
      onThemeChanged: (cb: (isDark: boolean) => void) => (() => void);
      sshConnect: (config: any) => Promise<{ success: boolean; error?: string; sessionId?: string }>;
      sshWrite: (sessionId: string, data: string) => void;
      sshResize: (sessionId: string, rows: number, cols: number) => void;
      sshDisconnect: (sessionId: string) => void;
      onSshData: (sessionId: string, cb: (data: string) => void) => (() => void);
      onSshClosed: (sessionId: string, cb: () => void) => (() => void);
      updateBackendConfig: (config: any) => void;
      selectFile: () => Promise<string | null>;
      checkProfiles: () => Promise<'encrypted' | 'plain' | 'none'>;
      unlockProfiles: (password: string) => Promise<any>;
      saveProfiles: (payload: { masterPassword: string, payload: any }) => Promise<boolean>;
      onAppBlur: (cb: () => void) => (() => void);
      onAppFocus: (cb: () => void) => (() => void);
      getPluginsList: () => Promise<any[]>;
      installPlugin: (zipPath: string) => Promise<{ success: boolean; manifest?: any; error?: string }>;
      uninstallPlugin: (pluginName: string) => Promise<{ success: boolean; error?: string }>;
      getPluginRenderers: () => Promise<string[]>;
    };
  }
}
