import { create } from 'zustand';

export interface SidebarAction {
  id: string;
  icon: string; // SVG string representation
  label: string;
  onClick: () => void;
}

interface PluginStore {
  installedPlugins: any[];
  sidebarActions: SidebarAction[];
  setPlugins: (plugins: any[]) => void;
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
