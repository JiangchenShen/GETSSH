import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePluginStore, SidebarAction } from './pluginStore';

describe('usePluginStore', () => {
  beforeEach(() => {
    // Reset store state before each test to ensure isolation
    usePluginStore.setState({
      installedPlugins: [],
      sidebarActions: [],
    });
  });

  it('should initialize with correct default state', () => {
    const state = usePluginStore.getState();
    expect(state.installedPlugins).toEqual([]);
    expect(state.sidebarActions).toEqual([]);
  });

  describe('setPlugins', () => {
    it('sets the installedPlugins correctly', () => {
      const mockPlugins = [
        { name: 'test-plugin', version: '1.0.0', displayName: 'Test', description: 'Desc', main: 'main.js' },
        { name: 'another-plugin', version: '2.1.0', displayName: 'Another', description: 'Desc', main: 'main.js' }
      ];
      usePluginStore.getState().setPlugins(mockPlugins);

      const state = usePluginStore.getState();
      expect(state.installedPlugins).toEqual(mockPlugins);
      expect(state.installedPlugins).toHaveLength(2);
    });
  });

  describe('registerSidebarAction', () => {
    it('adds a new action to the sidebarActions array', () => {
      const action: SidebarAction = {
        id: 'action-unique-1',
        icon: '<svg></svg>',
        label: 'Action 1',
        onClick: vi.fn(),
      };

      usePluginStore.getState().registerSidebarAction(action);

      const state = usePluginStore.getState();
      expect(state.sidebarActions).toHaveLength(1);
      expect(state.sidebarActions[0]).toEqual(action);
    });

    it('prevents duplicate registration on hot reload by updating the existing action with the same id', () => {
      const action1: SidebarAction = {
        id: 'action1',
        icon: '<svg></svg>',
        label: 'Action 1',
        onClick: vi.fn(),
      };

      // Updated version of the same action (e.g., changed label/icon in code)
      const updatedAction1: SidebarAction = {
        ...action1,
        label: 'Updated Action 1',
        icon: '<svg class="updated"></svg>',
      };

      const action2: SidebarAction = {
        id: 'action2',
        icon: '<svg></svg>',
        label: 'Action 2',
        onClick: vi.fn(),
      };

      // 1. Initial registration
      usePluginStore.getState().registerSidebarAction(action1);
      usePluginStore.getState().registerSidebarAction(action2);
      
      // 2. Simulate Hot Reload: Re-register action1 with updated data
      usePluginStore.getState().registerSidebarAction(updatedAction1);

      const state = usePluginStore.getState();
      const actions = state.sidebarActions;
      
      // Should still only have 2 actions total
      expect(actions).toHaveLength(2);
      
      // The action with id "action1" should now match the updated version
      const foundAction1 = actions.find(a => a.id === 'action1');
      expect(foundAction1).toEqual(updatedAction1);
      expect(foundAction1?.label).toBe('Updated Action 1');
      
      // The other action should remain untouched
      expect(actions).toContainEqual(action2);
    });

    it('successfully allows registration of multiple different sidebar actions', () => {
      const action1: SidebarAction = {
        id: 'id-1',
        icon: '<svg></svg>',
        label: 'Action 1',
        onClick: vi.fn(),
      };

      const action2: SidebarAction = {
        id: 'id-2',
        icon: '<svg></svg>',
        label: 'Action 2',
        onClick: vi.fn(),
      };

      const action3: SidebarAction = {
        id: 'id-3',
        icon: '<svg></svg>',
        label: 'Action 3',
        onClick: vi.fn(),
      };

      usePluginStore.getState().registerSidebarAction(action1);
      usePluginStore.getState().registerSidebarAction(action2);
      usePluginStore.getState().registerSidebarAction(action3);

      const state = usePluginStore.getState();
      expect(state.sidebarActions).toHaveLength(3);
      expect(state.sidebarActions).toContainEqual(action1);
      expect(state.sidebarActions).toContainEqual(action2);
      expect(state.sidebarActions).toContainEqual(action3);
    });
  });
});
