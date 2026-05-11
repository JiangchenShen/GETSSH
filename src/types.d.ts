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
      getPluginsList: () => Promise<import('./types/plugin').PluginManifest[]>;
      installPlugin: (zipPath: string) => Promise<{ success: boolean; manifest?: import('./types/plugin').PluginManifest; error?: string }>;
      uninstallPlugin: (pluginName: string) => Promise<{ success: boolean; error?: string }>;
      getPluginRenderers: () => Promise<string[]>;
      sftpList: (sessionId: string, remotePath: string) => Promise<any>;
      sftpMkdir: (sessionId: string, remotePath: string) => Promise<any>;
      sftpDelete: (sessionId: string, remotePath: string, isDir: boolean) => Promise<any>;
      sftpReadFile: (sessionId: string, remotePath: string) => Promise<any>;
      sftpWriteFile: (sessionId: string, remotePath: string, data: string) => Promise<any>;
      sftpEditSync: (sessionId: string, remotePath: string) => Promise<{ success: boolean; watchId?: string; error?: string }>;
      sftpEditStop: (watchId: string) => Promise<{ success: boolean; error?: string }>;
      openExternal: (url: string) => void;
      onUpdateAvailable: (cb: (info: { version: string; url: string }) => void) => (() => void);
      showContextMenu: () => void;
      checkForUpdates: () => Promise<{ hasUpdate: boolean; version?: string; url?: string; error?: string }>;
      exportProfiles: (payload: { sessions: any[]; masterPassword: string }) => Promise<{ success: boolean; count?: number; reason?: string }>;
      importProfiles: (payload: { masterPassword: string }) => Promise<{ success: boolean; profiles?: any[]; reason?: string }>;
      promptBiometricUnlock: () => Promise<{ success: boolean; masterPassword?: string; reason?: string }>;
    };
  }
}
