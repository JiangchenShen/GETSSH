import { create } from 'zustand';
import type { PluginManifest } from '../types/plugin';

export interface SidebarAction {
  id: string;
  icon: string; // SVG string representation
  label: string;
  onClick: () => void;
}

interface PluginStore {
  installedPlugins: PluginManifest[];
  sidebarActions: SidebarAction[];
  setPlugins: (plugins: PluginManifest[]) => void;
  registerSidebarAction: (action: SidebarAction) => void;
}

export const usePluginStore = create<PluginStore>((set) => ({
  installedPlugins: [],
  sidebarActions: [],
  setPlugins: (plugins) => set({ installedPlugins: plugins }),
  registerSidebarAction: (action) => set((state) => ({ 
      sidebarActions: [...state.sidebarActions.filter(a => a.id !== action.id), action] 
  })), // Prevent duplicate registration on hot reload
}));
