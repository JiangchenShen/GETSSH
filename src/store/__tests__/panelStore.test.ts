// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { usePanelStore, PanelConfig } from '../panelStore';
import React from 'react';

const DummyComponent = () => React.createElement('div');

const createPanel = (id: string, opts: Partial<PanelConfig> = {}): PanelConfig => ({
  id,
  title: `Panel ${id}`,
  component: DummyComponent,
  position: 'right',
  defaultSize: 300,
  minSize: 200,
  maxSize: 500,
  ...opts,
});

describe('usePanelStore', () => {
  beforeEach(() => {
    usePanelStore.setState({
      panels: [],
      activePanelId: null,
      panelSizes: {},
    });
  });

  it('should have correct initial state', () => {
    const state = usePanelStore.getState();
    expect(state.panels).toEqual([]);
    expect(state.activePanelId).toBeNull();
    expect(state.panelSizes).toEqual({});
  });

  it('should register a new panel', () => {
    const panel = createPanel('test1', { defaultSize: 250 });
    usePanelStore.getState().registerPanel(panel);

    const state = usePanelStore.getState();
    expect(state.panels).toHaveLength(1);
    expect(state.panels[0]).toEqual(panel);
    expect(state.panelSizes['test1']).toBe(250);
  });

  it('should register an existing panel without changing existing size if it exists', () => {
    const panel1 = createPanel('test1', { defaultSize: 250 });
    const store = usePanelStore.getState();

    store.registerPanel(panel1);
    usePanelStore.getState().setPanelSize('test1', 300);

    const panel2 = createPanel('test1', { defaultSize: 400 }); // Same id, different default size
    usePanelStore.getState().registerPanel(panel2);

    const state = usePanelStore.getState();
    expect(state.panels).toHaveLength(1);
    expect(state.panels[0]).toEqual(panel2);
    expect(state.panelSizes['test1']).toBe(300); // Should retain the previous size
  });

  it('should unregister a panel', () => {
    const store = usePanelStore.getState();
    store.registerPanel(createPanel('test1'));
    store.registerPanel(createPanel('test2'));

    expect(usePanelStore.getState().panels).toHaveLength(2);

    usePanelStore.getState().unregisterPanel('test1');

    const state = usePanelStore.getState();
    expect(state.panels).toHaveLength(1);
    expect(state.panels[0].id).toBe('test2');
  });

  it('should clear activePanelId if the unregistered panel was active', () => {
    const store = usePanelStore.getState();
    store.registerPanel(createPanel('test1'));
    store.togglePanel('test1');

    expect(usePanelStore.getState().activePanelId).toBe('test1');

    usePanelStore.getState().unregisterPanel('test1');

    expect(usePanelStore.getState().activePanelId).toBeNull();
  });

  it('should not clear activePanelId if another panel was unregistered', () => {
    const store = usePanelStore.getState();
    store.registerPanel(createPanel('test1'));
    store.registerPanel(createPanel('test2'));
    store.togglePanel('test1');

    usePanelStore.getState().unregisterPanel('test2');

    expect(usePanelStore.getState().activePanelId).toBe('test1');
  });

  it('should toggle a panel as active or inactive', () => {
    const store = usePanelStore.getState();

    store.togglePanel('test1');
    expect(usePanelStore.getState().activePanelId).toBe('test1');

    store.togglePanel('test1');
    expect(usePanelStore.getState().activePanelId).toBeNull();

    store.togglePanel('test2');
    expect(usePanelStore.getState().activePanelId).toBe('test2');
  });

  it('should set panel size and clamp it between minSize and maxSize', () => {
    const store = usePanelStore.getState();
    store.registerPanel(createPanel('test1', { minSize: 100, maxSize: 500, defaultSize: 200 }));

    // Normal size
    usePanelStore.getState().setPanelSize('test1', 300);
    expect(usePanelStore.getState().panelSizes['test1']).toBe(300);

    // Too small -> clamped to minSize
    usePanelStore.getState().setPanelSize('test1', 50);
    expect(usePanelStore.getState().panelSizes['test1']).toBe(100);

    // Too big -> clamped to maxSize
    usePanelStore.getState().setPanelSize('test1', 600);
    expect(usePanelStore.getState().panelSizes['test1']).toBe(500);
  });

  it('should not set panel size if panel is not registered', () => {
    const store = usePanelStore.getState();
    store.setPanelSize('non-existent', 300);
    expect(usePanelStore.getState().panelSizes['non-existent']).toBeUndefined();
  });

  it('should get active panel config', () => {
    const store = usePanelStore.getState();
    const panel1 = createPanel('test1');

    store.registerPanel(panel1);
    expect(store.getActivePanel()).toBeNull();

    store.togglePanel('test1');
    expect(usePanelStore.getState().getActivePanel()).toEqual(panel1);

    store.togglePanel('test1');
    expect(usePanelStore.getState().getActivePanel()).toBeNull();
  });
});
