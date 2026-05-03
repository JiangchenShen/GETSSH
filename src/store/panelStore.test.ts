import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import { usePanelStore, PanelConfig } from './panelStore';

// Mock browser globals using vi.stubGlobal (compatible with both test suites)
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] || null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value.toString(); }),
  removeItem: vi.fn((key: string) => { delete localStorageStore[key]; }),
  clear: vi.fn(() => { for (const key in localStorageStore) delete localStorageStore[key]; }),
};

beforeAll(() => {
  vi.stubGlobal('localStorage', localStorageMock);
  vi.stubGlobal('document', {
    documentElement: {
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
      }
    }
  });
  vi.stubGlobal('window', {});
});

const DummyComponent = () => null;

const createMockPanel = (id: string, defaultSize = 300, minSize = 100, maxSize = 800): PanelConfig => ({
  id,
  title: `Panel ${id}`,
  component: DummyComponent,
  position: 'right',
  defaultSize,
  minSize,
  maxSize,
});

describe('usePanelStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePanelStore.setState({
      panels: [],
      activePanelId: null,
      panelSizes: {},
    });
  });

  describe('registerPanel', () => {
    it('should add a new panel to the store', () => {
      const panel = createMockPanel('panel-1');
      usePanelStore.getState().registerPanel(panel);

      const state = usePanelStore.getState();
      expect(state.panels).toHaveLength(1);
      expect(state.panels[0]).toEqual(panel);
      expect(state.panelSizes['panel-1']).toBe(300);
    });

    it('should update an existing panel if registered again with the same id', () => {
      const panel = createMockPanel('panel-1');
      usePanelStore.getState().registerPanel(panel);

      const updatedPanel = { ...panel, title: 'Updated Panel' };
      usePanelStore.getState().registerPanel(updatedPanel);

      const state = usePanelStore.getState();
      expect(state.panels).toHaveLength(1);
      expect(state.panels[0].title).toBe('Updated Panel');
    });

    it('should not overwrite panel size if already set', () => {
      const panel = createMockPanel('panel-1');
      usePanelStore.getState().registerPanel(panel);
      usePanelStore.getState().setPanelSize('panel-1', 400);

      // Re-register
      usePanelStore.getState().registerPanel(panel);

      const state = usePanelStore.getState();
      expect(state.panelSizes['panel-1']).toBe(400); // Should still be 400
    });
  });

  describe('unregisterPanel', () => {
    it('should remove a panel from the store', () => {
      const panel1 = createMockPanel('panel-1');
      const panel2 = createMockPanel('panel-2');
      usePanelStore.getState().registerPanel(panel1);
      usePanelStore.getState().registerPanel(panel2);

      usePanelStore.getState().unregisterPanel('panel-1');

      const state = usePanelStore.getState();
      expect(state.panels).toHaveLength(1);
      expect(state.panels[0].id).toBe('panel-2');
    });

    it('should set activePanelId to null if the active panel is unregistered', () => {
      const panel1 = createMockPanel('panel-1');
      usePanelStore.getState().registerPanel(panel1);
      usePanelStore.getState().togglePanel('panel-1'); // Make it active

      expect(usePanelStore.getState().activePanelId).toBe('panel-1');

      usePanelStore.getState().unregisterPanel('panel-1');

      expect(usePanelStore.getState().activePanelId).toBeNull();
    });

    it('should not change activePanelId if an inactive panel is unregistered', () => {
      const panel1 = createMockPanel('panel-1');
      const panel2 = createMockPanel('panel-2');
      usePanelStore.getState().registerPanel(panel1);
      usePanelStore.getState().registerPanel(panel2);
      usePanelStore.getState().togglePanel('panel-1');

      usePanelStore.getState().unregisterPanel('panel-2');

      expect(usePanelStore.getState().activePanelId).toBe('panel-1');
    });
  });

  describe('togglePanel', () => {
    it('should set the active panel', () => {
      usePanelStore.getState().togglePanel('panel-1');
      expect(usePanelStore.getState().activePanelId).toBe('panel-1');
    });

    it('should unset the active panel if toggled again', () => {
      usePanelStore.getState().togglePanel('panel-1');
      usePanelStore.getState().togglePanel('panel-1');
      expect(usePanelStore.getState().activePanelId).toBeNull();
    });

    it('should switch active panel if another panel is toggled', () => {
      usePanelStore.getState().togglePanel('panel-1');
      usePanelStore.getState().togglePanel('panel-2');
      expect(usePanelStore.getState().activePanelId).toBe('panel-2');
    });
  });

  describe('setPanelSize', () => {
    it('should set the panel size', () => {
      const panel = createMockPanel('panel-1');
      usePanelStore.getState().registerPanel(panel);

      usePanelStore.getState().setPanelSize('panel-1', 500);

      expect(usePanelStore.getState().panelSizes['panel-1']).toBe(500);
    });

    it('should clamp size to minSize', () => {
      const panel = createMockPanel('panel-1', 300, 100, 800);
      usePanelStore.getState().registerPanel(panel);

      usePanelStore.getState().setPanelSize('panel-1', 50); // Below minSize

      expect(usePanelStore.getState().panelSizes['panel-1']).toBe(100);
    });

    it('should clamp size to maxSize', () => {
      const panel = createMockPanel('panel-1', 300, 100, 800);
      usePanelStore.getState().registerPanel(panel);

      usePanelStore.getState().setPanelSize('panel-1', 900); // Above maxSize

      expect(usePanelStore.getState().panelSizes['panel-1']).toBe(800);
    });

    it('should do nothing if panel is not found', () => {
      usePanelStore.getState().setPanelSize('panel-1', 500);

      // panelSizes should still be empty because panel doesn't exist
      expect(usePanelStore.getState().panelSizes).toEqual({});
    });
  });

  describe('getActivePanel', () => {
    it('should return the active panel', () => {
      const panel1 = createMockPanel('panel-1');
      const panel2 = createMockPanel('panel-2');
      usePanelStore.getState().registerPanel(panel1);
      usePanelStore.getState().registerPanel(panel2);

      usePanelStore.getState().togglePanel('panel-2');

      const activePanel = usePanelStore.getState().getActivePanel();
      expect(activePanel).toEqual(panel2);
    });

    it('should return null if no panel is active', () => {
      const panel = createMockPanel('panel-1');
      usePanelStore.getState().registerPanel(panel);

      const activePanel = usePanelStore.getState().getActivePanel();
      expect(activePanel).toBeNull();
    });

    it('should return null if active panel is not found in panels array', () => {
      usePanelStore.setState({ activePanelId: 'non-existent' });

      const activePanel = usePanelStore.getState().getActivePanel();
      expect(activePanel).toBeNull();
    });
  });
});
