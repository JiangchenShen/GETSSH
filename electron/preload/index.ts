import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { SysmonData, OsFingerprintData, HostVerificationData, BackendConfig, ExportPayload, ImportPayload, SshConnectConfig } from '../src/types/ipc'

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
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
  updateBackendConfig: (config: BackendConfig) => ipcRenderer.send('update-backend-config', config),
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
  installPlugin: (zipPath: string) => ipcRenderer.invoke('install-plugin', zipPath),
  uninstallPlugin: (pluginName: string) => ipcRenderer.invoke('uninstall-plugin', pluginName),
  getPluginRenderers: () => ipcRenderer.invoke('get-plugin-renderers'),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  onUpdateAvailable: (callback: (info: { version: string, url: string }) => void) => {
    const listener = (_event: IpcRendererEvent, info: { version: string, url: string }) => callback(info)
    ipcRenderer.on('update-available', listener)
    return () => ipcRenderer.removeListener('update-available', listener)
  },
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
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
})
