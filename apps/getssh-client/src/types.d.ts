export {};

declare module '*.png' {
  const value: string;
  export default value;
}

declare global {
  interface SSHConnectConfig { pluginUrl?: string;
    protocol?: 'ssh' | 'local' | 'telnet' | 'auto';
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
      checkProfiles: () => Promise<{ status: 'encrypted' | 'plain' | 'none'; biometricEnabled: boolean }>;
      bridgeFetchProfiles: (sourceWorkspaceId: string) => Promise<{ success: boolean; profiles?: any[]; runbooks?: any[]; error?: string }>;
      bridgeImportProfiles: (targetWorkspaceId: string, profiles: any[], runbooks: any[]) => Promise<{ success: boolean; error?: string }>;
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
      exportProfiles: () => Promise<{ success: boolean; count?: number; reason?: string }>;
      importProfiles: (payload: { masterPassword: string }) => Promise<{ success: boolean; count?: number; reason?: string }>;
      promptBiometricUnlock: () => Promise<{ success: boolean; masterPassword?: string; reason?: string }>;
      onSysmonData: (cb: (data: any) => void) => (() => void);
      onPromptHostVerification: (cb: (data: { requestId: string, hostname: string, fingerprint: string, isChanged?: boolean, oldFingerprint?: string }) => void) => (() => void);
      sendHostVerificationResult: (payload: { requestId: string, result: 'accept-save' | 'accept-once' | 'reject', hostname: string, fingerprint: string }) => void;
      getKnownHosts: () => Promise<{host: string, port: number, fingerprint: string, trustedAt: number}[]>;
      deleteKnownHost: (host: string, port: number) => Promise<boolean>;
      getConnectionLogs: () => Promise<{ id: string, alias: string, host: string, port: number, connectedAt: string, disconnectedAt: string, duration: string }[]>;
      exportConnectionLogs: () => Promise<boolean>;
      openAuditFolder: () => Promise<void>;
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
      exportDatabaseAll: () => Promise<{ success: boolean; path?: string; error?: string }>;
      exportDatabaseWorkspace: () => Promise<{ success: boolean; path?: string; error?: string }>;
      importDatabase: () => Promise<{ success: boolean; requiresConfirmation?: boolean; sourcePath?: string; merged?: boolean; error?: string }>;
      confirmImportDatabase: (sourcePath: string, strategy: 'overwrite' | 'merge') => Promise<{ success: boolean; merged?: boolean; error?: string }>;
      getGlobalSetting: (key: string) => Promise<string | null>;
      setGlobalSetting: (key: string, value: string) => Promise<{ success: boolean; error?: string }>;
      deleteWorkspace: (id: string) => Promise<{ success: boolean; error?: string }>;
      getWorkspaceStats: (id: string) => Promise<{ success: boolean; error?: string; stats?: any }>;
      getWorkspaceAuditLogs: (id: string) => Promise<{ success: boolean; error?: string; logs?: any[] }>;
      setMainWorkspace: (id: string) => Promise<{ success: boolean; error?: string }>;
      toggleWorkspaceBiometric: (id: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>;
      promptTouchID: (reason: string) => Promise<{ success: boolean; error?: string }>;
      updateWorkspacePreferences: (id: string, preferencesStr: string) => Promise<{ success: boolean; error?: string }>;
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
      onNexusPatchLeaf: (callback: (paneId: string, updates: any) => void) => () => void;
      nexusRegisterTab: (tabId: string, rootPaneId: string, sessionId: string, paneType: string, configJson: string, title: string) => Promise<any>;
      onNexusSyncTree: (callback: (tabId: string, title: string, tree: any, isTornOff: boolean) => void) => () => void;
      onWindowHijackIdentity: (callback: (payload: { paneId: string, terminalBuffers?: Record<string, string>, tornTitle?: string }) => void) => () => void;
      windowGetHijackIdentity: () => Promise<{ paneId: string, terminalBuffers?: Record<string, string>, tornTitle?: string } | null>;
      windowTearArm: () => number | null;
      windowTearExecute: (payload: { screenX: number; screenY: number; width: number; height: number; paneId: string; terminalBuffers?: Record<string, string>; tornTitle?: string }) => void;
      windowTearIn: (payload: { paneId: string; terminalBuffers?: Record<string, string> }) => void;
      onWindowReceiveTornBuffers: (cb: (payload: Record<string, string>) => void) => (() => void);
      windowSelfClose: () => void;
      hollowLog: (...args: any[]) => void;
      
      workspace: {
        getWorkspaces: () => Promise<any[]>;
        createWorkspace: (workspaceId: string, visualMeta?: any) => Promise<{ success: boolean; error?: string; visualMeta?: any }>;
        switchWorkspace: (workspaceId: string) => Promise<{ success: boolean; error?: string; visualMeta?: any }>;
      };
      ai: {
        invokePrivileged: (payload: { requestId: string, prompt: string, context?: string, endpoint?: string, apiKey?: string, provider?: string, model?: string }) => Promise<{ success: boolean; data?: any; _audit?: { sanitizedPrompt: string; sanitizedContext: string } }>;
        clearHistory: (workspaceId: string) => Promise<{ success: boolean }>;
        getModels: (payload: { endpoint?: string, apiKey?: string, provider?: string }) => Promise<{ success: boolean; models?: string[]; error?: string }>;
        saveApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
        deleteApiKey: () => Promise<{ success: boolean; error?: string }>;
        onStreamChunk: (requestId: string, cb: (payload: { chunk: string; isDone: boolean; error?: string }) => void) => () => void;
        getSessions: () => Promise<{ success: boolean; sessions: any[] }>;
        createSession: (id: string, title: string, timestamp: number) => Promise<{ success: boolean }>;
        saveMessage: (msg: any) => Promise<{ success: boolean }>;
        deleteSession: (id: string) => Promise<{ success: boolean }>;
        updateSessionTitle: (id: string, title: string) => Promise<{ success: boolean }>;
        approveAgentAction: (requestId: string, approved: boolean) => void;
        onAgentApprovalRequest: (cb: (payload: { requestId: string, command: string }) => void) => () => void;
        onAgentGlobalAction: (cb: (payload: { action: string, target: string, execute: string }) => void) => () => void;
      };
    };
  }
}
