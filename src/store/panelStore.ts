import { create } from 'zustand';
import React from 'react';

export interface PanelConfig {
  id: string;
  title: string;
  icon?: string; // SVG string
  component: React.ComponentType<any>;
  position: 'right' | 'bottom';
  defaultSize: number;
  minSize: number;
  maxSize: number;
}

interface PanelStore {
  panels: PanelConfig[];
  activePanelId: string | null;
  panelSizes: Record<string, number>;

  registerPanel: (config: PanelConfig) => void;
  unregisterPanel: (id: string) => void;
  togglePanel: (id: string) => void;
  setPanelSize: (id: string, size: number) => void;
  getActivePanel: () => PanelConfig | null;
}

export const usePanelStore = create<PanelStore>((set, get) => ({
  panels: [],
  activePanelId: null,
  panelSizes: {},

  registerPanel: (config) => set((state) => ({
    panels: [...state.panels.filter(p => p.id !== config.id), config],
    panelSizes: { ...state.panelSizes, [config.id]: state.panelSizes[config.id] ?? config.defaultSize },
  })),

  unregisterPanel: (id) => set((state) => ({
    panels: state.panels.filter(p => p.id !== id),
    activePanelId: state.activePanelId === id ? null : state.activePanelId,
  })),

  togglePanel: (id) => set((state) => ({
    activePanelId: state.activePanelId === id ? null : id,
  })),

  setPanelSize: (id, size) => {
    const panel = get().panels.find(p => p.id === id);
    if (!panel) return;
    const clamped = Math.max(panel.minSize, Math.min(panel.maxSize, size));
    set((state) => ({ panelSizes: { ...state.panelSizes, [id]: clamped } }));
  },

  getActivePanel: () => {
    const { panels, activePanelId } = get();
    return panels.find(p => p.id === activePanelId) ?? null;
  },
}));
