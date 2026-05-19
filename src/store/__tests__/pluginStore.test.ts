import { describe, it, expect, beforeEach } from 'vitest';
import { usePluginStore } from '../pluginStore';
import type { PluginManifest } from '../../types/plugin';

describe('usePluginStore', () => {
  beforeEach(() => {
    usePluginStore.setState({ installedPlugins: [], sidebarActions: [] });
  });

  it('should have empty installedPlugins and sidebarActions by default', () => {
    const state = usePluginStore.getState();
    expect(state.installedPlugins).toEqual([]);
    expect(state.sidebarActions).toEqual([]);
  });

  it('should update installedPlugins when setPlugins is called', () => {
    const plugins: PluginManifest[] = [
      {
        name: 'test-plugin',
        version: '1.0.0',
        displayName: 'Test Plugin',
        description: 'A plugin for testing',
        main: 'main.js'
      }
    ];

    usePluginStore.getState().setPlugins(plugins);

    const state = usePluginStore.getState();
    expect(state.installedPlugins).toEqual(plugins);
  });

  it('should add a new action when registerSidebarAction is called', () => {
    const action = {
      id: 'action-1',
      icon: '<svg></svg>',
      label: 'Action 1',
      onClick: () => {}
    };

    usePluginStore.getState().registerSidebarAction(action);

    const state = usePluginStore.getState();
    expect(state.sidebarActions).toEqual([action]);
    expect(state.sidebarActions.length).toBe(1);
  });

  it('should replace an existing action with the same id to prevent duplicates on hot reload', () => {
    const action1 = {
      id: 'action-1',
      icon: '<svg></svg>',
      label: 'Action 1',
      onClick: () => {}
    };

    const action2 = {
      id: 'action-2',
      icon: '<svg></svg>',
      label: 'Action 2',
      onClick: () => {}
    };

    const action1Updated = {
      id: 'action-1',
      icon: '<svg>Updated</svg>',
      label: 'Action 1 Updated',
      onClick: () => {}
    };

    usePluginStore.getState().registerSidebarAction(action1);
    usePluginStore.getState().registerSidebarAction(action2);
    usePluginStore.getState().registerSidebarAction(action1Updated);

    const state = usePluginStore.getState();
    expect(state.sidebarActions.length).toBe(2);
    // Since it filters out the old one and appends the new one to the end
    expect(state.sidebarActions[0]).toEqual(action2);
    expect(state.sidebarActions[1]).toEqual(action1Updated);
  });
});
