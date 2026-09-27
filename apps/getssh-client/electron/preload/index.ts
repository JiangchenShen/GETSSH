import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'
import type { SysmonData, OsFingerprintData, HostVerificationData, BackendConfig, ExportPayload, ImportPayload, SshConnectConfig } from '../../src/types/ipc'

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (theme: 'system' | 'light' | 'dark') => ipcRenderer.invoke('set-theme', theme),
  onThemeChanged: (callback: (isDark: boolean) => void) => {
    const listener = (_event: IpcRendererEvent, isDark: boolean) => callback(isDark)
    ipcRenderer.on('theme-changed', listener)
    return () => ipcRenderer.removeListener('theme-changed', listener)
  },
  sshConnect: (config: SshConnectConfig) => ipcRenderer.invoke('ssh-connect', config),
  sshWrite: (sessionId: string, data: string) => ipcRenderer.send('ssh-write', { sessionId, data }),
  sshResize: (sessionId: string, rows: number, cols: number) => ipcRenderer.send('ssh-resize', { sessionId, rows, cols }),
  sshDisconnect: (sessionId: string) => ipcRenderer.send('ssh-disconnect', sessionId),
  sshGetScrollback: (sessionId: string, fromOffset?: number) => ipcRenderer.invoke('ssh-get-scrollback', sessionId, fromOffset),
  // Reconnects with the credentials the main process kept for this session (they never come back to the renderer).
  sshReconnect: (sessionId: string) => ipcRenderer.invoke('ssh-reconnect', sessionId),

  // SFTP
  sftpList: (sessionId: string, remotePath: string) => ipcRenderer.invoke('sftp-list', sessionId, remotePath),
  sftpMkdir: (sessionId: string, remotePath: string) => ipcRenderer.invoke('sftp-mkdir', sessionId, remotePath),
  sftpDelete: (sessionId: string, remotePath: string, isDir: boolean) => ipcRenderer.invoke('sftp-delete', sessionId, remotePath, isDir),
  sftpReadFile: (sessionId: string, remotePath: string) => ipcRenderer.invoke('sftp-read-file', sessionId, remotePath),
  sftpWriteFile: (sessionId: string, remotePath: string, data: string) => ipcRenderer.invoke('sftp-write-file', sessionId, remotePath, data),
  sftpEditSync: (sessionId: string, remoteFilePath: string) => ipcRenderer.invoke('sftp-edit-sync', sessionId, remoteFilePath),
  sftpEditStop: (watchId: string) => ipcRenderer.invoke('sftp-edit-stop', watchId),
  sftpDownloadFile: (sessionId: string, remoteFilePath: string, providedLocalDir?: string) => ipcRenderer.invoke('sftp-download-file', sessionId, remoteFilePath, providedLocalDir),
  onSshData: (sessionId: string, callback: (data: string, endOffset?: number) => void) => {
    const listener = (_event: IpcRendererEvent, data: string, endOffset?: number) => callback(data, endOffset)
    ipcRenderer.on(`ssh-data-${sessionId}`, listener)
    return () => ipcRenderer.removeListener(`ssh-data-${sessionId}`, listener)
  },
  onSshClosed: (sessionId: string, callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on(`ssh-closed-${sessionId}`, listener)
    return () => ipcRenderer.removeListener(`ssh-closed-${sessionId}`, listener)
  },
  updateBackendConfig: (config: BackendConfig, authToken?: string) => ipcRenderer.invoke('update-backend-config', config, authToken),
  checkProfiles: () => ipcRenderer.invoke('check-profiles'),
  bridgeFetchProfiles: (sourceWorkspaceId: string) => ipcRenderer.invoke('workspace:bridge:fetchProfiles', sourceWorkspaceId),
  bridgeImportProfiles: (targetWorkspaceId: string, profiles: any[], runbooks: any[]) => ipcRenderer.invoke('workspace:bridge:importProfiles', targetWorkspaceId, profiles, runbooks),
  unlockProfiles: (password: string) => ipcRenderer.invoke('unlock-profiles', password),
  saveProfiles: (payload: { masterPassword?: string; payload: unknown[]; workspaceId?: string }) => ipcRenderer.invoke('save-profiles', payload),
  assetFolders: {
    list: (workspaceId: string) => ipcRenderer.invoke('asset-folders:list', workspaceId),
    create: (workspaceId: string, path: string) => ipcRenderer.invoke('asset-folders:create', workspaceId, path),
    rename: (workspaceId: string, path: string, newName: string) => ipcRenderer.invoke('asset-folders:rename', workspaceId, path, newName),
    remove: (workspaceId: string, path: string) => ipcRenderer.invoke('asset-folders:remove', workspaceId, path),
    moveProfile: (workspaceId: string, profileId: string, path: string | null) => ipcRenderer.invoke('asset-folders:move-profile', workspaceId, profileId, path),
    moveProfiles: (workspaceId: string, profileIds: string[], path: string | null) => ipcRenderer.invoke('asset-folders:move-profiles', workspaceId, profileIds, path),
  },
  onAppBlur: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('app-blur', listener)
    return () => ipcRenderer.removeListener('app-blur', listener)
  },
  onAppFocus: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('app-focus', listener)
    return () => ipcRenderer.removeListener('app-focus', listener)
  },
  getPluginsList: () => ipcRenderer.invoke('get-plugin-list'),
  previewPlugin: (zipPath: string) => ipcRenderer.invoke('preview-plugin', zipPath),
  commitPluginInstall: (payload: any) => ipcRenderer.invoke('commit-plugin-install', payload),
  abortPluginInstall: (tempDir: string) => ipcRenderer.invoke('abort-plugin-install', tempDir),
  uninstallPlugin: (pluginName: string) => ipcRenderer.invoke('uninstall-plugin', pluginName),
  getPluginRenderers: () => ipcRenderer.invoke('get-plugin-renderers'),
  reloadPlugins: () => ipcRenderer.invoke('reload-plugins'),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  onUpdateAvailable: (callback: (info: { version: string, url: string }) => void) => {
    const listener = (_event: IpcRendererEvent, info: { version: string, url: string }) => callback(info)
    ipcRenderer.on('update-available', listener)
    return () => ipcRenderer.removeListener('update-available', listener)
  },
  showContextMenu: (payload?: any) => ipcRenderer.send('show-context-menu', payload),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  exportDatabaseAll: () => ipcRenderer.invoke('export-database-all'),
  exportDatabaseWorkspace: () => ipcRenderer.invoke('export-database-workspace'),
  importDatabase: () => ipcRenderer.invoke('import-database'),
  confirmImportDatabase: (sourcePath: string, strategy: 'overwrite' | 'merge') => ipcRenderer.invoke('import-database-confirm', sourcePath, strategy),
  getGlobalSetting: (key: string) => ipcRenderer.invoke('app:getGlobalSetting', key),
  setGlobalSetting: (key: string, value: string) => ipcRenderer.invoke('app:setGlobalSetting', key, value),
  deleteWorkspace: (id: string) => ipcRenderer.invoke('workspace:delete', id),
  getWorkspaceStats: (id: string) => ipcRenderer.invoke('workspace:getStats', id),
  getWorkspaceAuditLogs: (id: string) => ipcRenderer.invoke('workspace:getAuditLogs', id),
  setMainWorkspace: (id: string) => ipcRenderer.invoke('workspace:setMain', id),
  toggleWorkspaceBiometric: (id: string, enabled: boolean) => ipcRenderer.invoke('workspace:toggleBiometric', id, enabled),
  promptTouchID: (reason: string) => ipcRenderer.invoke('system:promptTouchID', reason),
  updateWorkspacePreferences: (id: string, preferencesStr: string) => ipcRenderer.invoke('workspace:updatePreferences', id, preferencesStr),
  exportProfiles: () => ipcRenderer.invoke('export-profiles'),
  onSysmonData: (callback: (data: SysmonData) => void) => {
    const listener = (_event: IpcRendererEvent, data: SysmonData) => callback(data)
    ipcRenderer.on('sysmon:data', listener)
    return () => ipcRenderer.removeListener('sysmon:data', listener)
  },
  importProfiles: (payload: ImportPayload) => ipcRenderer.invoke('import-profiles', payload),
  promptBiometricUnlock: () => ipcRenderer.invoke('prompt-biometric-unlock'),
  onPromptHostVerification: (callback: (data: HostVerificationData) => void) => {
    const listener = (_event: IpcRendererEvent, data: HostVerificationData) => callback(data);
    ipcRenderer.on('prompt-host-verification', listener);
    return () => ipcRenderer.removeListener('prompt-host-verification', listener);
  },
  sendHostVerificationResult: (payload: { requestId: string, result: 'accept-save' | 'accept-once' | 'reject', hostname: string, fingerprint: string }) => 
    ipcRenderer.send('host-verification-result', payload),
  onHostVerificationCancelled: (callback: (requestId: string) => void) => {
    const listener = (_event: IpcRendererEvent, requestId: string) => callback(requestId);
    ipcRenderer.on('host-verification-cancelled', listener);
    return () => ipcRenderer.removeListener('host-verification-cancelled', listener);
  },
  getKnownHosts: () => ipcRenderer.invoke('get-known-hosts'),
  deleteKnownHost: (host: string, port: number) => ipcRenderer.invoke('delete-known-host', host, port),
  getConnectionLogs: () => ipcRenderer.invoke('get-connection-logs'),
  getWatchdogStatus: () => ipcRenderer.invoke('get-watchdog-status'),
  exportConnectionLogs: () => ipcRenderer.invoke('export-connection-logs'),
  openAuditFolder: () => ipcRenderer.invoke('open-audit-folder'),
  getEnvInfo: () => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch
  }),
  onFullScreenState: (callback: (isFullScreen: boolean) => void) => {
    const listener = (_event: IpcRendererEvent, isFullScreen: boolean) => callback(isFullScreen);
    ipcRenderer.on('fullscreen-state', listener);
    return () => ipcRenderer.removeListener('fullscreen-state', listener);
  },
  onOsFingerprint: (callback: (data: OsFingerprintData) => void) => {
    const listener = (_event: IpcRendererEvent, data: OsFingerprintData) => callback(data);
    ipcRenderer.on('os-fingerprint', listener);
    return () => ipcRenderer.removeListener('os-fingerprint', listener);
  },
  onSecurityLockdown: (callback: (data: { reason: string, countdown: number }) => void) => {
    const listener = (_event: IpcRendererEvent, data: { reason: string, countdown: number }) => callback(data);
    ipcRenderer.on('security-lockdown', listener);
    return () => ipcRenderer.removeListener('security-lockdown', listener);
  },
  resolveSecurityLockdown: (action: 'restart-safe' | 'save-15s' | 'ignore', masterPassword?: string) => ipcRenderer.invoke('resolve-security-lockdown', action, masterPassword),
  onSecurityLockdownResolved: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('security-lockdown-resolved', listener);
    return () => ipcRenderer.removeListener('security-lockdown-resolved', listener);
  },
  onSyncPluginUIExtensions: (callback: (payload: { terminal: any[], sftp: any[] }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { terminal: any[], sftp: any[] }) => callback(payload);
    ipcRenderer.on('sync-plugin-ui-extensions', listener);
    return () => ipcRenderer.removeListener('sync-plugin-ui-extensions', listener);
  },
  getPluginUiExtensions: () => ipcRenderer.invoke('get-plugin-ui-extensions'),
  getPluginSettingsSchemas: () => ipcRenderer.invoke('get-plugin-settings-schemas'),
  triggerPluginAction: (pluginId: string, actionId: string, contextData: any) => 
    ipcRenderer.send('trigger-plugin-action', { pluginId, actionId, contextData }),
  pluginRpcInvoke: (pluginId: string, method: string, payload: any) => ipcRenderer.invoke('plugin-rpc-invoke', pluginId, method, payload),
  onPluginRpcMessage: (pluginId: string, callback: (payload: any) => void) => {
    const listener = (_event: IpcRendererEvent, id: string, payload: any) => {
      if (id === pluginId) callback(payload);
    };
    ipcRenderer.on('plugin-rpc-message', listener);
    return () => ipcRenderer.removeListener('plugin-rpc-message', listener);
  },
  reloadPlugin: (pluginId: string) => ipcRenderer.invoke('reload-plugin', pluginId),
  pluginStorageGet: (pluginId: string, key: string) => ipcRenderer.invoke('plugin-storage-get', pluginId, key),
  pluginStorageSet: (pluginId: string, key: string, value: any) => ipcRenderer.invoke('plugin-storage-set', pluginId, key, value),
  onSyncPluginSettingsSchemas: (callback: (payload: Record<string, any[]>) => void) => {
    const listener = (_event: IpcRendererEvent, payload: Record<string, any[]>) => callback(payload);
    ipcRenderer.on('sync-plugin-settings-schemas', listener);
    return () => ipcRenderer.removeListener('sync-plugin-settings-schemas', listener);
  },
  encryptConfig: (data: any) => ipcRenderer.invoke('encrypt-config', data),
  decryptConfig: (base64: string) => ipcRenderer.invoke('decrypt-config', base64),
  // Nexus Core API — Rust nexus-core owns the tab/pane layout; the main process owns session lifetime.
  nexusSplit: (targetPaneId: string, direction: 'horizontal' | 'vertical') => ipcRenderer.invoke('nexus:split', { targetPaneId, direction }),
  nexusClosePane: (paneId: string) => ipcRenderer.invoke('nexus:close', { paneId }),
  nexusToggleZoom: (paneId: string) => ipcRenderer.invoke('nexus:toggle-zoom', { paneId }),
  nexusUpdateSizes: (paneId: string, sizes: number[]) => ipcRenderer.invoke('nexus:update-sizes', { paneId, sizes }),
  nexusSetDisconnected: (paneId: string, disconnected: boolean) => ipcRenderer.invoke('nexus:set-disconnected', { paneId, disconnected }),
  nexusCloseTab: (tabId: string) => ipcRenderer.invoke('nexus:close-tab', { tabId }),
  nexusReplacePane: (paneId: string, paneType: string, sessionId: string | null, configJson: string) => ipcRenderer.invoke('nexus:replace-pane', { paneId, paneType, sessionId, configJson }),
  nexusRegisterTab: (tabId: string, rootPaneId: string, sessionId: string, paneType: string, configJson: string, title: string, workspaceId?: string | null) => ipcRenderer.invoke('nexus:register-tab', { tabId, rootPaneId, sessionId, paneType, configJson, title, workspaceId: workspaceId ?? null }),
  nexusGetTab: (tabId: string) => ipcRenderer.invoke('nexus:get-tab', { tabId }),
  onNexusSyncTree: (callback: (payload: any) => void) => {
    const handler = (_event: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('nexus:sync-tree', handler);
    return () => ipcRenderer.removeListener('nexus:sync-tree', handler);
  },
  // Main process asks the main window to focus a pane (e.g. after a torn pane was docked back into its tab).
  onNexusFocusPane: (callback: (payload: { tabId: string, paneId: string }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { tabId: string, paneId: string }) => callback(payload);
    ipcRenderer.on('nexus:focus-pane', listener);
    return () => ipcRenderer.removeListener('nexus:focus-pane', listener);
  },

  // Tear-off windows: the main process performs the layout change and owns the window ↔ tab mapping.
  windowTearOff: (payload: { paneId: string, screenX: number, screenY: number, width: number, height: number }) =>
    ipcRenderer.invoke('window:tear-off', payload),
  windowGetTornIdentity: () => ipcRenderer.invoke('window:get-torn-identity'),
  windowTearIn: () => ipcRenderer.invoke('window:tear-in'),

  // AI Center Gateway
  ai: {
    invokePrivileged: (payload: any) => ipcRenderer.invoke('ai-privileged-invoke', payload),
    getModels: (payload: { endpoint?: string, apiKey?: string, provider?: string }) => ipcRenderer.invoke('ai-get-models', payload),
    saveApiKey: (apiKey: string, provider?: string) => ipcRenderer.invoke('ai-save-api-key', apiKey, provider),
    deleteApiKey: (provider?: string) => ipcRenderer.invoke('ai-delete-api-key', provider),
    clearHistory: (workspaceId: string) => ipcRenderer.invoke('clear-ai-history', workspaceId),
    onStreamChunk: (requestId: string, callback: (payload: { chunk: string, isDone: boolean, error?: string }) => void) => {
      const listener = (_event: IpcRendererEvent, payload: { chunk: string, isDone: boolean, error?: string }) => callback(payload);
      ipcRenderer.on(`ai-stream-chunk-${requestId}`, listener);
      return () => ipcRenderer.removeListener(`ai-stream-chunk-${requestId}`, listener);
    },
    onAgentApprovalRequest: (callback: (payload: { requestId: string, streamRequestId: string, command: string }) => void) => {
      const listener = (_event: IpcRendererEvent, payload: { requestId: string, streamRequestId: string, command: string }) => callback(payload);
      ipcRenderer.on(`ai-agent-approval-request`, listener);
      return () => ipcRenderer.removeListener(`ai-agent-approval-request`, listener);
    },
    onAgentGlobalAction: (callback: (payload: { type: string, target: string, execute?: string }) => void) => {
      const listener = (_event: IpcRendererEvent, payload: { type: string, target: string, execute?: string }) => callback(payload);
      ipcRenderer.on(`ai-agent-global-action`, listener);
      return () => ipcRenderer.removeListener(`ai-agent-global-action`, listener);
    },
    getSessions: () => ipcRenderer.invoke('ai-get-sessions'),
    createSession: (id: string, title: string, timestamp: number) => ipcRenderer.invoke('ai-create-session', id, title, timestamp),
    saveMessage: (msg: any) => ipcRenderer.invoke('ai-save-message', msg),
    deleteSession: (id: string) => ipcRenderer.invoke('ai-delete-session', id),
    updateSessionTitle: (id: string, title: string) => ipcRenderer.invoke('ai-update-session-title', id, title),
    approveAgentAction: (requestId: string, approved: boolean) => ipcRenderer.send('ai-agent-approve', requestId, approved),
    testSearch: (config: any) => ipcRenderer.invoke('ai-test-search', config)
  },
  
  // Workspace 2.0 API
  workspace: {
    getWorkspaces: () => ipcRenderer.invoke('workspace:list'),
    createWorkspace: (workspaceId: string, visualMeta?: any) => ipcRenderer.invoke('workspace:create', workspaceId, visualMeta),
    switchWorkspace: (workspaceId: string) => ipcRenderer.invoke('workspace:switch', workspaceId)
  },
  
  // Model Context Protocol (MCP) API
  mcp: {
    getServers: () => ipcRenderer.invoke('mcp:get-servers'),
    addServer: (config: any) => ipcRenderer.invoke('mcp:add-server', config),
    updateServer: (id: string, updates: any) => ipcRenderer.invoke('mcp:update-server', { id, updates }),
    removeServer: (id: string) => ipcRenderer.invoke('mcp:remove-server', id),
    restartServer: (id: string) => ipcRenderer.invoke('mcp:restart-server', id),
    getResources: () => ipcRenderer.invoke('mcp:get-resources'),
    readResource: (serverId: string, uri: string) => ipcRenderer.invoke('mcp:read-resource', { serverId, uri }),
    getPrompts: () => ipcRenderer.invoke('mcp:get-prompts'),
    getPrompt: (serverId: string, name: string, args?: Record<string, string>) => ipcRenderer.invoke('mcp:get-prompt', { serverId, name, args })
  },

  // Agentic Execution Shell API
  onAgentPropose: (callback: (payload: { id: string, intent: string, command: string, riskLevel: 'low' | 'medium' | 'high' }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('app:agent-propose', listener);
    return () => ipcRenderer.removeListener('app:agent-propose', listener);
  }
})
