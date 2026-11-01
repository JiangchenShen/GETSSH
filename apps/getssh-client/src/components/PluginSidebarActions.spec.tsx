// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Sidebar buttons registered by plugin pages (PluginBridge), in the real plugin store. A plugin's
// SVG is drawn as a mask, never added to this window as markup.

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => (key === 'settings.plugins' ? '插件' : key) }) }));

import { usePluginStore } from '../store/pluginStore';
import { PluginSidebarActions } from './PluginSidebarActions';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  usePluginStore.setState({ sidebarActions: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = () => act(() => root.render(<PluginSidebarActions />));
const register = (pluginId: string, actionId: string, icon: string, label: string, onClick = vi.fn()) => {
  act(() => usePluginStore.getState().registerSidebarAction({ id: `plugin-${pluginId}-${actionId}`, pluginId, icon, label, onClick }));
  return onClick;
};
const buttons = () => [...container.querySelectorAll('button')];

describe('PluginSidebarActions', () => {
  it('shows nothing until a plugin registers an action', () => {
    render();
    expect(container.innerHTML).toBe('');
  });

  it('shows each action as a labelled button that runs its handler', () => {
    render();
    const open = register('alpha', 'open', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>', 'Open Alpha');
    register('beta', 'open', '', 'Open Beta');
    expect(container.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBe('插件');
    expect(buttons().map(button => button.getAttribute('aria-label'))).toEqual(['Open Alpha', 'Open Beta']);
    act(() => buttons()[0].click());
    expect(open).toHaveBeenCalledOnce();
  });

  it('never puts a plugin\'s SVG into the window as markup', () => {
    render();
    const icon = '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:parent.ran=1"><rect width="9" height="9"/></a>'
      + '<image href="x" onerror="parent.ran=1"/><script>parent.ran=1</script><foreignObject><div>x</div></foreignObject></svg>';
    register('evil', 'a', icon, 'Evil');
    expect(container.querySelector('svg, a, rect, image, script, foreignObject')).toBeNull();
    expect(container.textContent).toBe('插件');
    expect(container.innerHTML).not.toContain('javascript:');
    const mask = container.querySelector('button span')!;
    expect(mask.getAttribute('aria-hidden')).toBe('true');
    expect(mask.getAttribute('style')).toContain(`url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon)}")`);
  });

  it('keeps a button in place when its plugin registers it again, and drops a removed plugin\'s buttons', () => {
    render();
    register('alpha', 'open', '', 'Open');
    register('beta', 'open', '', 'Beta');
    register('alpha', 'open', '', 'Open again');
    expect(buttons().map(button => button.getAttribute('aria-label'))).toEqual(['Open again', 'Beta']);
    act(() => usePluginStore.getState().removePluginSidebarActions('alpha'));
    expect(buttons().map(button => button.getAttribute('aria-label'))).toEqual(['Beta']);
  });
});
