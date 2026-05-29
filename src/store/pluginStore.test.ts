import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import { usePluginStore, SidebarAction } from './pluginStore';

// Mock browser globals using vi.stubGlobal (compatible with both test suites)
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] || null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value.toString(); }),
  removeItem: vi.fn((key: string) => { delete localStorageStore[key]; }),
  clear: vi.fn(() => { for (const key in localStorageStore) delete localStorageStore[key]; }),
};

const classListAddMock = vi.fn();
const classListRemoveMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal('localStorage', localStorageMock);
  vi.stubGlobal('document', {
    documentElement: {
      classList: {
        add: classListAddMock,
        remove: classListRemoveMock,
      }
    }
  });
  vi.stubGlobal('window', {
    electronAPI: {
      updateBackendConfig: vi.fn()
    }
  });
});

describe('usePluginStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePluginStore.setState({
      installedPlugins: [],
      sidebarActions: [],
    });
  });

  it('should initialize with default state', () => {
    const state = usePluginStore.getState();
    expect(state.installedPlugins).toEqual([]);
    expect(state.sidebarActions).toEqual([]);
  });

  it('should update installed plugins when setPlugins is called', () => {
    const plugins = [{ id: 'plugin-1', name: 'Test Plugin' }, { id: 'plugin-2', name: 'Another Plugin' }];
    usePluginStore.getState().setPlugins(plugins);

    const state = usePluginStore.getState();
    expect(state.installedPlugins).toEqual(plugins);
  });

  it('should register a sidebar action', () => {
    const action: SidebarAction = {
      id: 'action-1',
      icon: '<svg></svg>',
      label: 'Action 1',
      onClick: vi.fn(),
    };

    usePluginStore.getState().registerSidebarAction(action);

    const state = usePluginStore.getState();
    expect(state.sidebarActions).toHaveLength(1);
    expect(state.sidebarActions[0]).toEqual(action);
  });

  it('should prevent duplicate registration of sidebar actions on hot reload', () => {
    const action1: SidebarAction = {
      id: 'action-1',
      icon: '<svg></svg>',
      label: 'Action 1',
      onClick: vi.fn(),
    };

    // An action with the same id but updated properties (like on hot reload)
    const action1Updated: SidebarAction = {
      id: 'action-1',
      icon: '<svg class="updated"></svg>',
      label: 'Action 1 Updated',
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

    expect(usePluginStore.getState().sidebarActions).toHaveLength(2);
    expect(usePluginStore.getState().sidebarActions[0].id).toBe('action-1');
    expect(usePluginStore.getState().sidebarActions[1].id).toBe('action-2');

    // Register updated action1
    usePluginStore.getState().registerSidebarAction(action1Updated);

    const state = usePluginStore.getState();
    expect(state.sidebarActions).toHaveLength(2);

    // The previous action-1 should be replaced by action1Updated and moved to the end of the array
    expect(state.sidebarActions[0].id).toBe('action-2');
    expect(state.sidebarActions[1]).toEqual(action1Updated);
  });
});
