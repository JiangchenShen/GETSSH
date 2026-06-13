import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'
import type { SysmonData, OsFingerprintData, HostVerificationData, BackendConfig, ExportPayload, ImportPayload, SshConnectConfig } from '../../src/types/ipc'

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onThemeChanged: (callback: (isDark: boolean) => void) => {
    const listener = (_event: IpcRendererEvent, isDark: boolean) => callback(isDark)
    ipcRenderer.on('theme-changed', listener)
    return () => ipcRenderer.removeListener('theme-changed', listener)
  },
  sshConnect: (config: SshConnectConfig) => ipcRenderer.invoke('ssh-connect', config),
  sshWrite: (sessionId: string, data: string) => ipcRenderer.send('ssh-write', { sessionId, data }),
  sshResize: (sessionId: string, rows: number, cols: number) => ipcRenderer.send('ssh-resize', { sessionId, rows, cols }),
  sshDisconnect: (sessionId: string) => ipcRenderer.send('ssh-disconnect', sessionId),
  
  // SFTP
  sftpList: (sessionId: string, remotePath: string) => ipcRenderer.invoke('sftp-list', sessionId, remotePath),
  sftpMkdir: (sessionId: string, remotePath: string) => ipcRenderer.invoke('sftp-mkdir', sessionId, remotePath),
  sftpDelete: (sessionId: string, remotePath: string, isDir: boolean) => ipcRenderer.invoke('sftp-delete', sessionId, remotePath, isDir),
  sftpReadFile: (sessionId: string, remotePath: string) => ipcRenderer.invoke('sftp-read-file', sessionId, remotePath),
  sftpWriteFile: (sessionId: string, remotePath: string, data: string) => ipcRenderer.invoke('sftp-write-file', sessionId, remotePath, data),
  sftpEditSync: (sessionId: string, remoteFilePath: string) => ipcRenderer.invoke('sftp-edit-sync', sessionId, remoteFilePath),
  sftpEditStop: (watchId: string) => ipcRenderer.invoke('sftp-edit-stop', watchId),
  sftpDownloadFile: (sessionId: string, remoteFilePath: string, providedLocalDir?: string) => ipcRenderer.invoke('sftp-download-file', sessionId, remoteFilePath, providedLocalDir),
  onSshData: (sessionId: string, callback: (data: string) => void) => {
    const listener = (_event: IpcRendererEvent, data: string) => callback(data)
    ipcRenderer.on(`ssh-data-${sessionId}`, listener)
    return () => ipcRenderer.removeListener(`ssh-data-${sessionId}`, listener)
  },
  onSshClosed: (sessionId: string, callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on(`ssh-closed-${sessionId}`, listener)
    return () => ipcRenderer.removeListener(`ssh-closed-${sessionId}`, listener)
  },
  updateBackendConfig: (config: BackendConfig, authToken?: string) => ipcRenderer.send('update-backend-config', config, authToken),
  checkProfiles: () => ipcRenderer.invoke('check-profiles'),
  unlockProfiles: (password: string) => ipcRenderer.invoke('unlock-profiles', password),
  saveProfiles: (payload: { masterPassword?: string; payload: unknown[] }) => ipcRenderer.invoke('save-profiles', payload),
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
  exportProfiles: (payload: ExportPayload) => ipcRenderer.invoke('export-profiles', payload),
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
  getKnownHosts: () => ipcRenderer.invoke('get-known-hosts'),
  deleteKnownHost: (host: string, port: number) => ipcRenderer.invoke('delete-known-host', host, port),
  getConnectionLogs: () => ipcRenderer.invoke('get-connection-logs'),
  getWatchdogStatus: () => ipcRenderer.invoke('get-watchdog-status'),
  exportConnectionLogs: () => ipcRenderer.invoke('export-connection-logs'),
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
  resolveSecurityLockdown: (action: 'restart-safe' | 'save-15s' | 'ignore') => ipcRenderer.invoke('resolve-security-lockdown', action),
  onSyncPluginUIExtensions: (callback: (payload: { terminal: any[], sftp: any[] }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { terminal: any[], sftp: any[] }) => callback(payload);
    ipcRenderer.on('sync-plugin-ui-extensions', listener);
    return () => ipcRenderer.removeListener('sync-plugin-ui-extensions', listener);
  },
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
  
  // Nexus Core API
  nexusSplit: (targetPaneId: string, direction: 'horizontal' | 'vertical') => ipcRenderer.invoke('nexus:split', { targetPaneId, direction }),
  nexusTearOff: (paneId: string) => ipcRenderer.invoke('nexus:tear-off', { paneId }),
  nexusClosePane: (paneId: string) => ipcRenderer.invoke('nexus:close', { paneId }),
  nexusToggleZoom: (paneId: string) => ipcRenderer.invoke('nexus:toggle-zoom', { paneId }),
  nexusUpdateSizes: (paneId: string, sizes: number[]) => ipcRenderer.invoke('nexus:update-sizes', { paneId, sizes }),
  nexusSetDisconnected: (paneId: string, disconnected: boolean) => ipcRenderer.invoke('nexus:set-disconnected', { paneId, disconnected }),
  nexusCloseTab: (tabId: string) => ipcRenderer.invoke('nexus:close-tab', { tabId }),
  nexusReplacePane: (paneId: string, paneType: string, sessionId: string | null, configJson: string) => ipcRenderer.invoke('nexus:replace-pane', { paneId, paneType, sessionId, configJson }),
  onNexusPtyData: (paneId: string, callback: (data: Uint8Array) => void) => {
    const listener = (_event: IpcRendererEvent, data: Uint8Array) => callback(data);
    ipcRenderer.on(`pty:data:${paneId}`, listener);
    return () => ipcRenderer.removeListener(`pty:data:${paneId}`, listener);
  },
  onNexusPatchLeaf: (callback: (paneId: string, updates: any) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { paneId: string, updates: any }) => callback(payload.paneId, payload.updates);
    ipcRenderer.on('nexus:patch-leaf', listener);
    return () => ipcRenderer.removeListener('nexus:patch-leaf', listener);
  },
  nexusRegisterTab: (tabId: string, rootPaneId: string, sessionId: string, paneType: string, configJson: string, title: string) => ipcRenderer.invoke('nexus:register-tab', { tabId, rootPaneId, sessionId, paneType, configJson, title }),
  onNexusSyncTree: (callback: (tabId: string, tree: any) => void) => {
    const listener = (_event: IpcRendererEvent, tabId: string, tree: any) => callback(tabId, tree);
    ipcRenderer.on('nexus:sync-tree', listener);
    return () => ipcRenderer.removeListener('nexus:sync-tree', listener);
  },
  
  // Window Multi-Window Tear-off
  windowTearArm: () => ipcRenderer.sendSync('window:tear-arm'),
  windowTearExecute: (payload: { screenX: number, screenY: number, width: number, height: number, paneId: string }) => 
    ipcRenderer.send('window:tear-execute', payload),
  onWindowHijackIdentity: (callback: (payload: { paneId: string }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { paneId: string }) => callback(payload);
    ipcRenderer.on('window:hijack-identity', listener);
    return () => ipcRenderer.removeListener('window:hijack-identity', listener);
  },
  
  // AI Center Gateway
  ai: {
    invokePrivileged: (payload: { requestId: string, prompt: string, context?: string, endpoint?: string, apiKey?: string }) => ipcRenderer.invoke('ai-privileged-invoke', payload),
    clearHistory: (workspaceId: string) => ipcRenderer.invoke('clear-ai-history', workspaceId),
    onStreamChunk: (requestId: string, callback: (payload: { chunk: string, isDone: boolean, error?: string }) => void) => {
      const listener = (_event: IpcRendererEvent, payload: { chunk: string, isDone: boolean, error?: string }) => callback(payload);
      ipcRenderer.on(`ai-stream-chunk-${requestId}`, listener);
      return () => ipcRenderer.removeListener(`ai-stream-chunk-${requestId}`, listener);
    }
  },
  
  // Workspace 2.0 API
  workspace: {
    getWorkspaces: () => ipcRenderer.invoke('workspace:list'),
    createWorkspace: (workspaceId: string) => ipcRenderer.invoke('workspace:create', workspaceId),
    switchWorkspace: (workspaceId: string) => ipcRenderer.invoke('workspace:switch', workspaceId)
  }
})

