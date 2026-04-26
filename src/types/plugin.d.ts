export interface PluginManifest {
  name: string;
  version: string;
  displayName: string;
  icon?: string;
  description: string;
  main: string;
  renderer?: string;
}

export interface MainContextAPI {
  showNotification: (title: string, body: string) => void;
  safeStorageEncrypt: (text: string) => string;
  safeStorageDecrypt: (encryptedData: string) => string;
  onSSHSessionConnect?: (callback: (sessionId: string, host: string) => void) => void;
}

export interface RendererContextAPI {
  registerSidebarAction: (
    id: string, 
    icon: string, 
    label: string, 
    onClick: () => void
  ) => void;
}
