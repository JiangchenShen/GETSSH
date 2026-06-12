import { create } from 'zustand';
import type { PluginManifest } from '../types/plugin';
import type { UIExtensionSyncPayload } from '../types/ipc';

import type { PluginSettingsSchema } from '../types/plugin';

export interface SidebarAction {
  id: string;
  icon: string; // SVG string representation
  label: string;
  onClick: () => void;
}

interface PluginStore {
  installedPlugins: PluginManifest[];
  sidebarActions: SidebarAction[];
  uiExtensions: UIExtensionSyncPayload;
  settingsSchemas: Record<string, PluginSettingsSchema[]>;
  setPlugins: (plugins: PluginManifest[]) => void;
  registerSidebarAction: (action: SidebarAction) => void;
  setUIExtensions: (payload: UIExtensionSyncPayload) => void;
  setSettingsSchemas: (schemas: Record<string, PluginSettingsSchema[]>) => void;
}

export const usePluginStore = create<PluginStore>((set) => ({
  installedPlugins: [],
  sidebarActions: [],
  uiExtensions: { terminal: [], sftp: [] },
  settingsSchemas: {},
  setPlugins: (plugins) => set({ installedPlugins: plugins }),
  registerSidebarAction: (action) => set((state) => ({ 
      sidebarActions: [...state.sidebarActions.filter(a => a.id !== action.id), action] 
  })), // Prevent duplicate registration on hot reload
  setUIExtensions: (payload) => set({ uiExtensions: payload }),
  setSettingsSchemas: (schemas) => set({ settingsSchemas: schemas }),
}));
