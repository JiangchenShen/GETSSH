import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePluginStore, SidebarAction } from './pluginStore';

describe('usePluginStore', () => {
  beforeEach(() => {
    // reset store state before each test
    usePluginStore.setState({
      installedPlugins: [],
      sidebarActions: [],
    });
  });

  describe('setPlugins', () => {
    it('sets the installedPlugins', () => {
      const mockPlugins = [{ id: 'plugin1' }, { id: 'plugin2' }];
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
      };

      const action2: SidebarAction = {
        id: 'action2',
        icon: '<svg></svg>',
        label: 'Action 2',
        onClick: vi.fn(),
      };

      usePluginStore.getState().registerSidebarAction(action1);
      usePluginStore.getState().registerSidebarAction(action2);
      usePluginStore.getState().registerSidebarAction(updatedAction1);

      const actions = usePluginStore.getState().sidebarActions;
      expect(actions).toHaveLength(2);
      expect(actions).toEqual([action2, updatedAction1]); // order changes since it filters and appends
    });
  });
});
