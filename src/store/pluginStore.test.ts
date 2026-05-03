import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePluginStore, SidebarAction } from './pluginStore';

describe('usePluginStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    usePluginStore.setState({
      installedPlugins: [],
      sidebarActions: [],
    });
  });

  it('should have initial state', () => {
    const state = usePluginStore.getState();
    expect(state.installedPlugins).toEqual([]);
    expect(state.sidebarActions).toEqual([]);
  });

  describe('setPlugins', () => {
    it('sets the installedPlugins', () => {
      const mockPlugins = [{ name: 'test-plugin', version: '1.0.0' } as any];
      usePluginStore.getState().setPlugins(mockPlugins);

      expect(usePluginStore.getState().installedPlugins).toEqual(mockPlugins);
    });
  });

  describe('registerSidebarAction', () => {
    it('adds a new action to the sidebarActions', () => {
      const action: SidebarAction = {
        id: 'action1',
        icon: '<svg></svg>',
        label: 'Action 1',
        onClick: vi.fn(),
      };

      usePluginStore.getState().registerSidebarAction(action);

      expect(usePluginStore.getState().sidebarActions).toEqual([action]);
    });

    it('prevents duplicate registration on hot reload by updating the existing action with the same id', () => {
      const action1: SidebarAction = {
        id: 'action1',
        icon: '<svg></svg>',
        label: 'Action 1',
        onClick: vi.fn(),
      };

      const updatedAction1: SidebarAction = {
        ...action1,
        label: 'Updated Action 1',
        icon: '<svg>updated</svg>',
      };

      const action2: SidebarAction = {
        id: 'action2',
        icon: '<svg></svg>',
        label: 'Action 2',
        onClick: vi.fn(),
      };

      // Register initial actions
      usePluginStore.getState().registerSidebarAction(action1);
      usePluginStore.getState().registerSidebarAction(action2);
      
      // Attempt to re-register action1 with updated data (simulating hot reload)
      usePluginStore.getState().registerSidebarAction(updatedAction1);

      const actions = usePluginStore.getState().sidebarActions;
      expect(actions).toHaveLength(2);
      // The implementation filters out the old one and appends the new one, so order might change
      expect(actions.find(a => a.id === 'action1')).toEqual(updatedAction1);
      expect(actions.find(a => a.id === 'action2')).toEqual(action2);
    });

    it('should allow registration of multiple different sidebar actions', () => {
      const action1: SidebarAction = {
        id: 'action-1',
        icon: '<svg></svg>',
        label: 'Action 1',
        onClick: vi.fn(),
      };

      const action2: SidebarAction = {
        id: 'action-2',
        icon: '<svg></svg>',
        label: 'Action 2',
        onClick: vi.fn(),
      };

      usePluginStore.getState().registerSidebarAction(action1);
      usePluginStore.getState().registerSidebarAction(action2);

      const state = usePluginStore.getState();
      expect(state.sidebarActions).toHaveLength(2);
      // We check for containment to be order-agnostic if the implementation changes order
      expect(state.sidebarActions).toContainEqual(action1);
      expect(state.sidebarActions).toContainEqual(action2);
    });
  });
});
