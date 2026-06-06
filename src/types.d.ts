export {};

declare module '*.png' {
  const value: string;
  export default value;
}

declare global {
  interface SSHConnectConfig { pluginUrl?: string;
    protocol?: 'ssh' | 'local' | 'telnet';
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    keepaliveInterval?: number;
    proxyType?: string;
    proxyHost?: string;
    proxyPort?: number;
    initScript?: string;
    alias?: string;
  }

  interface Window {
    electronAPI: {
      getTheme: () => Promise<boolean>;
      onThemeChanged: (cb: (isDark: boolean) => void) => (() => void);
      sshConnect: (config: SSHConnectConfig) => Promise<{ success: boolean; error?: string; sessionId?: string }>;
      sshWrite: (sessionId: string, data: string) => void;
      sshResize: (sessionId: string, rows: number, cols: number) => void;
      sshDisconnect: (sessionId: string) => void;
      onSshData: (sessionId: string, cb: (data: string) => void) => (() => void);
      onSshClosed: (sessionId: string, cb: () => void) => (() => void);
      updateBackendConfig: (config: import('./types/ipc').BackendConfig, authToken?: string) => void;
      selectFile: () => Promise<string | null>;
      getPathForFile: (file: File) => string;
      checkProfiles: () => Promise<'encrypted' | 'plain' | 'none'>;
      unlockProfiles: (password: string) => Promise<import('./store/sessionStore').SessionProfile[]>;
      saveProfiles: (payload: { masterPassword: string, payload: import('./store/sessionStore').SessionProfile[] }) => Promise<boolean>;
      onAppBlur: (cb: () => void) => (() => void);
      onAppFocus: (cb: () => void) => (() => void);
      getPluginsList: () => Promise<import('./types/plugin').PluginManifest[]>;
      previewPlugin: (zipPath: string) => Promise<{ success: boolean; manifest?: import('./types/plugin').PluginManifest; tempDir?: string; sourceDir?: string; error?: string }>;
      commitPluginInstall: (payload: { sourceDir: string; tempDir: string }) => Promise<{ success: boolean; manifest?: import('./types/plugin').PluginManifest; error?: string }>;
      abortPluginInstall: (tempDir: string) => Promise<{ success: boolean; error?: string }>;
      uninstallPlugin: (pluginName: string) => Promise<{ success: boolean; error?: string }>;
      getPluginRenderers: () => Promise<string[]>;
      reloadPlugins: () => Promise<{ success: boolean; error?: string }>;
      sftpList: (sessionId: string, remotePath: string) => Promise<{ success: boolean; error?: string; list?: import('./components/SFTPManager').SFTPFile[] }>;
      sftpMkdir: (sessionId: string, remotePath: string) => Promise<{ success: boolean; error?: string }>;
      sftpDelete: (sessionId: string, remotePath: string, isDir: boolean) => Promise<{ success: boolean; error?: string }>;
      sftpReadFile: (sessionId: string, remotePath: string) => Promise<{ success: boolean; error?: string; data?: string }>;
      sftpWriteFile: (sessionId: string, remotePath: string, data: string) => Promise<{ success: boolean; error?: string }>;
      sftpEditSync: (sessionId: string, remotePath: string) => Promise<{ success: boolean; watchId?: string; error?: string }>;
      sftpEditStop: (watchId: string) => Promise<{ success: boolean; error?: string }>;
      sftpDownloadFile: (sessionId: string, remoteFilePath: string, providedLocalDir?: string) => Promise<{ success: boolean; error?: string; canceled?: boolean }>;
      openExternal: (url: string) => void;
      onUpdateAvailable: (cb: (info: { version: string; url: string }) => void) => (() => void);
      showContextMenu: (payload?: any) => void;
      checkForUpdates: () => Promise<{ hasUpdate: boolean; version?: string; url?: string; error?: string }>;
      exportProfiles: (payload: { sessions: import('./store/sessionStore').SessionProfile[]; masterPassword: string }) => Promise<{ success: boolean; count?: number; reason?: string }>;
      importProfiles: (payload: { masterPassword: string }) => Promise<{ success: boolean; profiles?: import('./store/sessionStore').SessionProfile[]; reason?: string }>;
      promptBiometricUnlock: () => Promise<{ success: boolean; masterPassword?: string; reason?: string }>;
      onSysmonData: (cb: (data: any) => void) => (() => void);
      onPromptHostVerification: (cb: (data: { requestId: string, hostname: string, fingerprint: string, isChanged?: boolean, oldFingerprint?: string }) => void) => (() => void);
      sendHostVerificationResult: (payload: { requestId: string, result: 'accept-save' | 'accept-once' | 'reject', hostname: string, fingerprint: string }) => void;
      getKnownHosts: () => Promise<{host: string, port: number, fingerprint: string, trustedAt: number}[]>;
      deleteKnownHost: (host: string, port: number) => Promise<boolean>;
      getConnectionLogs: () => Promise<{ id: string, alias: string, host: string, port: number, connectedAt: string, disconnectedAt: string, duration: string }[]>;
      exportConnectionLogs: () => Promise<boolean>;
      getWatchdogStatus: () => Promise<{ status: 'secure' | 'warning'; level?: 'red' | 'yellow'; reason?: string; lastPing: number; watchdogDisabled?: boolean }>;
      getEnvInfo: () => { electron: string, chrome: string, node: string, platform: string, arch: string };
      onFullScreenState: (cb: (state: boolean) => void) => (() => void);
      onOsFingerprint: (cb: (data: { host: string; username: string; osType: string; sessionId?: string }) => void) => (() => void);
      onSecurityLockdown: (cb: (data: { reason: string, countdown: number }) => void) => (() => void);
      resolveSecurityLockdown: (action: 'restart-safe' | 'save-15s' | 'ignore' | 'deactivate-plugin' | 'continue') => void;
      invoke: (channel: string, data?: any) => Promise<any>;
      pluginRpcInvoke: (pluginId: string, action: string, data?: any) => Promise<any>;
      onPluginRpcMessage: (pluginId: string, cb: (payload: { pluginId: string, action: string, data: any }) => void) => (() => void);
      pluginStorageGet: (pluginId: string, key: string) => Promise<any>;
      pluginStorageSet: (pluginId: string, key: string, value: any) => Promise<void>;
      reloadPlugin: (pluginId: string) => Promise<{ success: boolean; error?: string }>;
      selectFolder: () => Promise<string | null>;
      onSyncPluginUIExtensions: (cb: (payload: any) => void) => (() => void);
      onSyncPluginSettingsSchemas: (cb: (payload: any) => void) => (() => void);
      encryptConfig: (data: any) => Promise<string>;
      decryptConfig: (base64: string) => Promise<any>;
      nexusSplit: (targetPaneId: string, direction: 'horizontal' | 'vertical') => Promise<any>;
      nexusTearOff: (paneId: string) => Promise<any>;
      nexusClosePane: (paneId: string) => Promise<any>;
      nexusToggleZoom: (paneId: string) => Promise<any>;
      nexusUpdateSizes: (paneId: string, sizes: number[]) => Promise<any>;
      nexusSetDisconnected: (paneId: string, disconnected: boolean) => Promise<any>;
      nexusCloseTab: (tabId: string) => Promise<any>;
      nexusReplacePane: (paneId: string, paneType: string, sessionId: string | null, configJson: string) => Promise<any>;
      onNexusPtyData: (paneId: string, cb: (data: Uint8Array) => void) => (() => void);
      onNexusPatchLeaf: (cb: (paneId: string, updates: any) => void) => (() => void);
      onNexusSyncTree: (cb: (tabId: string, tree: any) => void) => (() => void);
      nexusRegisterTab: (tabId: string, rootPaneId: string, sessionId: string, paneType: string, configJson: string, title: string) => Promise<any>;
    };
  }
}
