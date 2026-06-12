export interface PluginManifest {
  name: string;
  version: string;
  displayName: string;
  icon?: string;
  description: string;
  main: string;
  renderer?: string;
  localPath?: string;
  _rendererContentCache?: string;
  getssh?: {
    pluginId: string;
    name?: string;
    /**
     * 'sandbox': pure UI plugin (index.html iframe). No backend code.
     * Omit for Node.js backend plugins.
     */
    type?: 'sandbox';
    /**
     * Required for Node.js plugins.
     * Must include 'lifecycle' to confirm deactivate() is implemented.
     */
    capabilities?: string[];
  };
}

export interface PluginSettingsSchema {
  id: string;
  type: 'string' | 'number' | 'boolean' | 'password';
  label: string;
  description?: string;
  default?: any;
}

export interface MainContextAPI {
  showNotification: (title: string, body: string) => void;
  safeStorageEncrypt: (text: string) => string;
  onSSHSessionConnect?: (callback: (sessionId: string, host: string) => void) => void;
  ssh?: {
    onData: (sessionId: string, callback: (chunk: string) => void) => void;
    write: (sessionId: string, command: string) => void;
  };
  storage: {
    set: (key: string, value: any) => Promise<void>;
    get: (key: string) => Promise<any>;
    delete: (key: string) => Promise<void>;
    clear: () => Promise<void>;
  };
  rpc: {
    registerMethod: (method: string, handler: (payload: any) => Promise<any>) => void;
    sendToFrontend: (payload: any) => void;
  };
  ui: {
    registerTerminalContextMenu: (actionId: string, label: string, handler: (context: { sessionId: string, selectionText: string }) => void) => void;
    registerSFTPContextMenu: (actionId: string, label: string, handler: (context: { sessionId: string, currentPath: string, selectedFiles: string[] }) => void) => void;
    registerSettings: (schema: PluginSettingsSchema[]) => void;
  };
  host: {
    notify: (title: string, body: string, type?: 'info' | 'warning' | 'error') => void;
    clipboard: {
      writeText: (text: string) => Promise<void>;
      readText: () => Promise<string>;
    };
    showMessageBox: (options: {
      type?: 'none' | 'info' | 'warning' | 'error' | 'question';
      buttons?: string[];
      defaultId?: number;
      cancelId?: number;
      title?: string;
      message: string;
      detail?: string;
      checkboxLabel?: string;
    }) => Promise<{ response: number; checkboxChecked: boolean }>;
    showOpenDialog: (options: {
      title?: string;
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
      properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>;
    }) => Promise<{ canceled: boolean; filePaths: string[] }>;
    showSaveDialog: (options: {
      title?: string;
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
    }) => Promise<{ canceled: boolean; filePath?: string }>;
  };
  net?: {
    fetch: (url: string, options?: RequestInit) => Promise<Response>;
  };
}

export interface RendererContextAPI {
  registerSidebarAction: (
    id: string, 
    icon: string, 
    label: string, 
    onClick: () => void
  ) => void;
  getLocale: () => string;
  onThemeChange: (callback: (theme: 'dark' | 'light' | 'system') => void) => void;
}
