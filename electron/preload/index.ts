import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onThemeChanged: (callback: (isDark: boolean) => void) => {
    const listener = (_event: any, isDark: boolean) => callback(isDark)
    ipcRenderer.on('theme-changed', listener)
    return () => ipcRenderer.removeListener('theme-changed', listener)
  },
  sshConnect: (config: object) => ipcRenderer.invoke('ssh-connect', config),
  sshWrite: (sessionId: string, data: string) => ipcRenderer.send('ssh-write', { sessionId, data }),
  sshResize: (sessionId: string, rows: number, cols: number) => ipcRenderer.send('ssh-resize', { sessionId, rows, cols }),
  sshDisconnect: (sessionId: string) => ipcRenderer.send('ssh-disconnect', sessionId),
  
  // SFTP
  sftpList: (sessionId: string, remotePath: string) => ipcRenderer.invoke('sftp-list', sessionId, remotePath),
  sftpMkdir: (sessionId: string, remotePath: string) => ipcRenderer.invoke('sftp-mkdir', sessionId, remotePath),
  sftpDelete: (sessionId: string, remotePath: string, isDir: boolean) => ipcRenderer.invoke('sftp-delete', sessionId, remotePath, isDir),
  sftpReadFile: (sessionId: string, remotePath: string) => ipcRenderer.invoke('sftp-read-file', sessionId, remotePath),
  sftpWriteFile: (sessionId: string, remotePath: string, data: string) => ipcRenderer.invoke('sftp-write-file', sessionId, remotePath, data),
  onSshData: (sessionId: string, callback: (data: string) => void) => {
    const listener = (_event: any, data: string) => callback(data)
    ipcRenderer.on(`ssh-data-${sessionId}`, listener)
    return () => ipcRenderer.removeListener(`ssh-data-${sessionId}`, listener)
  },
  onSshClosed: (sessionId: string, callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on(`ssh-closed-${sessionId}`, listener)
    return () => ipcRenderer.removeListener(`ssh-closed-${sessionId}`, listener)
  },
  updateBackendConfig: (config: object) => ipcRenderer.send('update-backend-config', config),
  checkProfiles: () => ipcRenderer.invoke('check-profiles'),
  unlockProfiles: (password: string) => ipcRenderer.invoke('unlock-profiles', password),
  saveProfiles: (payload: any) => ipcRenderer.invoke('save-profiles', payload),
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
  showContextMenu: () => ipcRenderer.send('show-context-menu')
})
