import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('should set installed plugins', () => {
    const mockPlugins = [{ name: 'test-plugin', version: '1.0.0' }];
    usePluginStore.getState().setPlugins(mockPlugins);

    const state = usePluginStore.getState();
    expect(state.installedPlugins).toEqual(mockPlugins);
  });

  it('should register a sidebar action', () => {
    const mockAction: SidebarAction = {
      id: 'test-action',
      icon: '<svg></svg>',
      label: 'Test Action',
      onClick: vi.fn(),
    };

    usePluginStore.getState().registerSidebarAction(mockAction);

    const state = usePluginStore.getState();
    expect(state.sidebarActions).toHaveLength(1);
    expect(state.sidebarActions[0]).toEqual(mockAction);
  });

  it('should prevent duplicate registration of sidebar actions based on id', () => {
    const mockAction: SidebarAction = {
      id: 'test-action',
      icon: '<svg></svg>',
      label: 'Test Action',
      onClick: vi.fn(),
    };

    const mockActionUpdated: SidebarAction = {
      id: 'test-action',
      icon: '<svg>updated</svg>',
      label: 'Test Action Updated',
      onClick: vi.fn(),
    };

    usePluginStore.getState().registerSidebarAction(mockAction);
    usePluginStore.getState().registerSidebarAction(mockActionUpdated);

    const state = usePluginStore.getState();
    expect(state.sidebarActions).toHaveLength(1);
    expect(state.sidebarActions[0]).toEqual(mockActionUpdated);
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
    expect(state.sidebarActions).toEqual([action1, action2]);
  });
});
