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
    passphrase?: string;
    keepaliveInterval?: number;
    proxyType?: string;
    proxyHost?: string;
    proxyPort?: number;
    initScript?: string;
    alias?: string;
    strictHostKeyChecking?: boolean;
    initialDirectory?: string;
    postConnectScript?: string;
    themeOverride?: string;
  }

  interface NexusResult {
    success: boolean;
    error?: string;
  }

  /** One tab's layout as broadcast by nexus-core. `tree === null` means the tab no longer exists. */
  interface NexusTabSync {
    tabId: string;
    rev: number;
    tree: import('./store/sessionStore').PaneNode | null;
    title: string;
    isTornOff: boolean;
    workspaceId: string | null;
  }

  interface Window {
    electronAPI: {
      getTheme: () => Promise<boolean>;
      setTheme: (theme: 'system' | 'light' | 'dark') => Promise<void>;
      onThemeChanged: (cb: (isDark: boolean) => void) => (() => void);
      sshConnect: (config: SSHConnectConfig) => Promise<{ success: boolean; error?: string; sessionId?: string }>;
      sshWrite: (sessionId: string, data: string) => void;
      sshResize: (sessionId: string, rows: number, cols: number) => void;
      sshDisconnect: (sessionId: string) => void;
      /** Session output kept by the main process; `reset` means the caller must clear its terminal before writing `data`. */
      sshGetScrollback: (sessionId: string, fromOffset?: number) => Promise<{ data: string; endOffset: number; reset: boolean }>;
      /** Reconnect with the credentials kept in the main process for `sessionId`; `error: 'unknown_session'` when none are kept. */
      sshReconnect: (sessionId: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>;
      /** `endOffset` is the session output offset right after `data` (absent for legacy senders). */
      onSshData: (sessionId: string, cb: (data: string, endOffset?: number) => void) => (() => void);
      onSshClosed: (sessionId: string, cb: () => void) => (() => void);
      updateBackendConfig: (config: import('./types/ipc').BackendConfig, authToken?: string) => Promise<import('./types/ipc').BackendConfigUpdateResult>;
      selectFile: () => Promise<string | null>;
      getPathForFile: (file: File) => string;
      /** 'encrypted': the active workspace needs unlocking; hasPassword: it has a password of its own. */
      checkProfiles: () => Promise<{ status: 'encrypted' | 'plain' | 'none'; biometricEnabled: boolean; hasPassword: boolean }>;
      bridgeFetchProfiles: (sourceWorkspaceId: string) => Promise<{ success: boolean; profiles?: any[]; runbooks?: any[]; error?: string }>;
      bridgeImportProfiles: (targetWorkspaceId: string, profiles: any[], runbooks: any[]) => Promise<{ success: boolean; error?: string }>;
      unlockProfiles: (password: string) => Promise<import('./store/sessionStore').SessionProfile[]>;
      /** `workspaceId`: the workspace the renderer believes is active; main refuses the write if it differs. */
      /** Workspace passwords are set with workspace.setPassword / removePassword, never through a save. */
      saveProfiles: (payload: { payload: import('./store/sessionStore').SessionProfile[], workspaceId?: string }) => Promise<boolean>;
      assetFolders: {
        list: (workspaceId: string) => Promise<{ success: boolean; folders?: string[]; error?: string }>;
        create: (workspaceId: string, path: string) => Promise<{ success: boolean; folders?: string[]; memberships?: { id: string; group: string | null }[]; error?: string }>;
        rename: (workspaceId: string, path: string, newName: string) => Promise<{ success: boolean; folders?: string[]; memberships?: { id: string; group: string | null }[]; error?: string }>;
        remove: (workspaceId: string, path: string) => Promise<{ success: boolean; folders?: string[]; memberships?: { id: string; group: string | null }[]; error?: string }>;
        moveProfile: (workspaceId: string, profileId: string, path: string | null) => Promise<{ success: boolean; folders?: string[]; memberships?: { id: string; group: string | null }[]; error?: string }>;
        moveProfiles: (workspaceId: string, profileIds: string[], path: string | null) => Promise<{ success: boolean; folders?: string[]; memberships?: { id: string; group: string | null }[]; error?: string }>;
      };
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
      /** Touch ID / Windows Hello for the active workspace; on success load its profiles with unlockProfiles(''). */
      promptBiometricUnlock: () => Promise<{ success: boolean; reason?: string }>;
      onSysmonData: (cb: (data: any) => void) => (() => void);
      onPromptHostVerification: (cb: (data: { requestId: string, hostname: string, fingerprint: string, isChanged?: boolean, oldFingerprint?: string }) => void) => (() => void);
      sendHostVerificationResult: (payload: { requestId: string, result: 'accept-save' | 'accept-once' | 'reject', hostname: string, fingerprint: string }) => void;
      /** Main process gave up on a prompt (timeout, connection error, window gone); drop it from the queue. */
      onHostVerificationCancelled: (cb: (requestId: string) => void) => (() => void);
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
      /** 'ignore' is verified in the main process: Touch ID, or the master password when Touch ID is unavailable. */
      resolveSecurityLockdown: (action: 'restart-safe' | 'save-15s' | 'ignore' | 'deactivate-plugin' | 'continue', masterPassword?: string) => Promise<{ ok: boolean; reason?: 'unauthorized' | 'invalid_action' | 'password_required' | 'denied' } | undefined>;
      onSecurityLockdownResolved: (cb: () => void) => (() => void);
      invoke: (channel: string, data?: any) => Promise<any>;
      pluginRpcInvoke: (pluginId: string, action: string, data?: any) => Promise<any>;
      onPluginRpcMessage: (pluginId: string, cb: (payload: { pluginId: string, action: string, data: any }) => void) => (() => void);
      pluginStorageGet: (pluginId: string, key: string) => Promise<any>;
      pluginStorageSet: (pluginId: string, key: string, value: any) => Promise<void>;
      reloadPlugin: (pluginId: string) => Promise<{ success: boolean; error?: string }>;
      selectFolder: () => Promise<string | null>;
      onSyncPluginUIExtensions: (cb: (payload: any) => void) => (() => void);
      onSyncPluginSettingsSchemas: (cb: (payload: any) => void) => (() => void);
      /** Current plugin UI extensions / settings schemas, for windows created after the last broadcast. */
      getPluginUiExtensions: () => Promise<{ terminal: any[]; sftp: any[] }>;
      getPluginSettingsSchemas: () => Promise<Record<string, any[]>>;
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
      nexusSplit: (targetPaneId: string, direction: 'horizontal' | 'vertical') => Promise<NexusResult & { newPaneId?: string; tabId?: string }>;
      nexusClosePane: (paneId: string) => Promise<NexusResult & { tabClosed?: boolean }>;
      nexusToggleZoom: (paneId: string) => Promise<NexusResult>;
      nexusUpdateSizes: (paneId: string, sizes: number[]) => Promise<NexusResult>;
      nexusSetDisconnected: (paneId: string, disconnected: boolean) => Promise<NexusResult>;
      nexusCloseTab: (tabId: string) => Promise<NexusResult>;
      nexusReplacePane: (paneId: string, paneType: string, sessionId: string | null, configJson: string) => Promise<NexusResult>;
      nexusRegisterTab: (tabId: string, rootPaneId: string, sessionId: string, paneType: string, configJson: string, title: string, workspaceId?: string | null) => Promise<NexusResult>;
      nexusGetTab: (tabId: string) => Promise<NexusTabSync | null>;
      onNexusSyncTree: (callback: (payload: NexusTabSync) => void) => () => void;
      onNexusFocusPane: (callback: (payload: { tabId: string; paneId: string }) => void) => () => void;
      windowTearOff: (payload: { paneId: string; screenX: number; screenY: number; width: number; height: number }) => Promise<NexusResult>;
      windowGetTornIdentity: () => Promise<{ tabId: string; snapshot: NexusTabSync | null } | null>;
      windowTearIn: () => Promise<NexusResult>;
      
      workspace: {
        getWorkspaces: () => Promise<any[]>;
        createWorkspace: (workspaceId: string, visualMeta?: any) => Promise<{ success: boolean; error?: string; visualMeta?: any }>;
        switchWorkspace: (workspaceId: string) => Promise<{ success: boolean; error?: string; visualMeta?: any }>;
        setPassword: (request: { workspaceId: string; password: string; currentPassword?: string }) => Promise<import('./types/ipc').KeystoreResult>;
        removePassword: (request: { workspaceId: string; currentPassword?: string }) => Promise<import('./types/ipc').KeystoreResult>;
        unlock: (request: { workspaceId: string; method: 'password' | 'presence'; password?: string }) => Promise<import('./types/ipc').KeystoreResult>;
        lock: (workspaceId: string) => Promise<boolean>;
      };
      appLock: {
        getState: () => Promise<import('./types/ipc').AppLockState | null>;
        unlock: (request: { method: 'password'; password: string } | { method: 'presence' } | { method: 'recovery'; code: string }) => Promise<import('./types/ipc').KeystoreResult>;
        lock: () => Promise<boolean>;
        onChanged: (callback: (state: import('./types/ipc').AppLockState) => void) => () => void;
      };
      security: {
        status: () => Promise<import('./types/ipc').SecurityStatus | null>;
        /** OS check first (Touch ID / Windows Hello); `error: 'current_password_required'` where none exists. */
        verifyOwner: (request: { reason: string; password?: string }) => Promise<import('./types/ipc').KeystoreResult>;
        setMasterPassword: (request: { password: string; currentPassword?: string }) => Promise<import('./types/ipc').KeystoreResult<{ recoveryReset: boolean }>>;
        removeMasterPassword: (request: { currentPassword?: string }) => Promise<import('./types/ipc').KeystoreResult>;
        setupRecovery: (request: { currentPassword?: string }) => Promise<import('./types/ipc').KeystoreResult<{ code: string }>>;
        setPresence: (request: { workspaceId?: string | null; enabled: boolean }) => Promise<import('./types/ipc').KeystoreResult>;
      };
      /** getssh-store features (src/types/store.ts). Answers `unavailable` until the store is connected. */
      store: {
        profiles: {
          list: (request: { workspaceId: string }) => Promise<import('./types/store').StoreResult<{ profiles: import('./types/store').Profile[] }>>;
          /** Whole list: profiles left out are deleted. Secret fields: absent keeps, null clears, a string replaces. */
          save: (request: { workspaceId: string; profiles: import('./types/store').ProfileInput[] }) => Promise<import('./types/store').StoreResult<{ profiles: import('./types/store').Profile[] }>>;
          delete: (request: { workspaceId: string; ids: string[] }) => Promise<import('./types/store').StoreResult>;
        };
        reveal: {
          /** Touch ID / Windows Hello, or the workspace password; opens a 5-minute window that each reveal extends. */
          open: (request: { workspaceId: string } & import('./types/store').RevealRoute) => Promise<import('./types/store').StoreResult>;
          /**
           * Shows the secret in a system dialog; it never reaches the renderer. The dialog's Copy button
           * is the only way to copy it (cleared from the clipboard after 30 s). Resolves when the dialog
           * closes; `locked` when the app locked meanwhile, which also closes the dialog.
           */
          show: (request: { workspaceId: string; profileId: string; field: import('./types/store').SecretField; language?: import('./types/store').RevealLanguage }) => Promise<import('./types/store').StoreResult>;
          close: (request: { workspaceId: string }) => Promise<import('./types/store').StoreResult>;
        };
        sshKeys: {
          list: (request: { workspaceId: string }) => Promise<import('./types/store').StoreResult<{ keys: import('./types/store').SshKey[] }>>;
          /** Opens a file dialog in the main process; `name` defaults to the file name. */
          importFile: (request: { workspaceId: string; name?: string; passphrase?: string }) => Promise<import('./types/store').StoreResult<{ key: import('./types/store').SshKey }>>;
          generate: (request: { workspaceId: string; name: string }) => Promise<import('./types/store').StoreResult<{ key: import('./types/store').SshKey }>>;
          delete: (request: { workspaceId: string; id: string }) => Promise<import('./types/store').StoreResult>;
        };
        backup: {
          candidates: () => Promise<import('./types/store').StoreResult<{ candidates: import('./types/store').ExportCandidate[] }>>;
          /** One Touch ID / Windows Hello prompt; workspaces in `failed` need `workspace.unlock` with their password. */
          unlockForExport: (request: { workspaceIds: string[] }) => Promise<import('./types/store').StoreResult<{ unlocked: string[]; failed: { id: string; code: import('./types/store').StoreErrorCode }[] }>>;
          /** At least 12 characters; asks where to save. Opens every chosen workspace, even ones with their own password. */
          export: (request: { workspaceIds: string[]; password: string }) => Promise<import('./types/store').StoreResult<{ report: import('./types/store').ExportReport }>>;
          chooseImportFile: () => Promise<import('./types/store').StoreResult<{ fileId: string; fileName: string }>>;
          inspect: (request: { fileId: string; password: string }) => Promise<import('./types/store').StoreResult<{ info: import('./types/store').BundleInfo }>>;
          /** Replaces all data; the old data folder is kept as `report.backupPath`. Then call `relaunch`. */
          import: (request: { fileId: string; password: string }) => Promise<import('./types/store').StoreResult<{ report: import('./types/store').ImportReport }>>;
          relaunch: () => Promise<import('./types/store').StoreResult>;
        };
        /**
         * Servers saved by GETSSH 2.0. The app imports them by itself when no password is needed.
         * `import` (with the 2.0 master password the user typed) and `applyDefaultPort` (with
         * appConfig.defaultPort, the Default Port 2.0 used for servers without one) answer with the
         * active workspace's new list: replace the window's list with it, or its next save would
         * drop the imported servers again.
         */
        legacyV2: {
          status: () => Promise<import('./types/store').StoreResult<import('./types/store').LegacyV2Status>>;
          import: (request: { password?: string; defaultPort?: number }) => Promise<import('./types/store').StoreResult<{
            status: import('./types/store').LegacyV2ImportStatus; imported: number; skipped: number; error?: string;
            workspaceId: string; profiles: import('./store/sessionStore').SessionProfile[];
          }>>;
          applyDefaultPort: (request: { port: number }) => Promise<import('./types/store').StoreResult<{
            status: 'applied' | 'nothing' | 'failed'; changed: number; error?: string;
            workspaceId: string; profiles: import('./store/sessionStore').SessionProfile[];
          }>>;
        };
      };
      ai: {
        invokePrivileged: (payload: any) => Promise<{ success: boolean; data?: any; _audit?: { sanitizedPrompt: string; sanitizedContext: string } }>;
        clearHistory: (workspaceId: string) => Promise<{ success: boolean }>;
        getModels: (payload: { endpoint?: string, apiKey?: string, provider?: string }) => Promise<{ success: boolean; models?: string[]; error?: string }>;
        saveApiKey: (apiKey: string, provider?: string) => Promise<{ success: boolean; error?: string }>;
        deleteApiKey: (provider?: string) => Promise<{ success: boolean; error?: string }>;
        onStreamChunk: (requestId: string, cb: (payload: { chunk: string; isDone: boolean; error?: string }) => void) => () => void;
        getSessions: () => Promise<{ success: boolean; sessions: any[] }>;
        createSession: (id: string, title: string, timestamp: number) => Promise<{ success: boolean }>;
        saveMessage: (msg: any) => Promise<{ success: boolean }>;
        deleteSession: (id: string) => Promise<{ success: boolean }>;
        updateSessionTitle: (id: string, title: string) => Promise<{ success: boolean }>;
        onAgentApprovalRequest: (cb: (payload: { requestId: string; streamRequestId: string; command: string }) => void) => () => void;
        onAgentGlobalAction: (cb: (payload: { type: string; target: string; execute?: string }) => void) => () => void;
        approveAgentAction: (requestId: string, approved: boolean) => void;
        testSearch: (config: any) => Promise<{ success: boolean; count?: number; error?: string }>;
      };
      mcp: {
        getServers: () => Promise<{ success: boolean; servers?: any[]; error?: string }>;
        addServer: (config: any) => Promise<{ success: boolean; server?: any; error?: string }>;
        updateServer: (id: string, updates: any) => Promise<{ success: boolean; server?: any; error?: string }>;
        removeServer: (id: string) => Promise<{ success: boolean; error?: string }>;
        restartServer: (id: string) => Promise<{ success: boolean; tools?: any[]; resources?: any[]; prompts?: any[]; error?: string }>;
        getResources: () => Promise<{ success: boolean; resources?: Array<{ serverName: string; serverId: string; resource: any }>; error?: string }>;
        readResource: (serverId: string, uri: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        getPrompts: () => Promise<{ success: boolean; prompts?: Array<{ serverName: string; serverId: string; prompt: any }>; error?: string }>;
        getPrompt: (serverId: string, name: string, args?: Record<string, string>) => Promise<{ success: boolean; prompt?: any; error?: string }>;
      };
    };
  }
}
