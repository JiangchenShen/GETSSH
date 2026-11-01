import { create } from 'zustand';
import type { PluginManifest } from '../types/plugin';
import type { UIExtensionSyncPayload } from '../types/ipc';

import type { PluginSettingsSchema } from '../types/plugin';

export interface SidebarAction {
  id: string;
  /** The plugin whose page registered it (the frame's data-plugin-id). */
  pluginId: string;
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
  removePluginSidebarActions: (pluginId: string) => void;
  setUIExtensions: (payload: UIExtensionSyncPayload) => void;
  setSettingsSchemas: (schemas: Record<string, PluginSettingsSchema[]>) => void;
}

export const usePluginStore = create<PluginStore>((set) => ({
  installedPlugins: [],
  sidebarActions: [],
  uiExtensions: { terminal: [], sftp: [] },
  settingsSchemas: {},
  setPlugins: (plugins) => set({ installedPlugins: plugins }),
  // Registering an id again (hot reload, a page updating its icon) replaces it in place.
  registerSidebarAction: (action) => set((state) => ({
    sidebarActions: state.sidebarActions.some(a => a.id === action.id)
      ? state.sidebarActions.map(a => a.id === action.id ? action : a)
      : [...state.sidebarActions, action]
  })),
  removePluginSidebarActions: (pluginId) => set((state) => ({
    sidebarActions: state.sidebarActions.filter(a => a.pluginId !== pluginId)
  })),
  setUIExtensions: (payload) => set({ uiExtensions: payload }),
  setSettingsSchemas: (schemas) => set({ settingsSchemas: schemas }),
}));
