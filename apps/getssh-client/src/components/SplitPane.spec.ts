// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { isSftpCapable, SplitPane } from './SplitPane';
import { registerSftpPanel } from './SFTPManager';
import { usePanelStore } from '../store/panelStore';
import { useSessionStore, type PaneLeaf } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const leaf = (overrides: Partial<PaneLeaf>): PaneLeaf => ({
  type: 'leaf',
  paneId: 'p1',
  paneType: 'terminal',
  sessionId: 's1',
  config: { host: 'example.com', port: 22, username: 'root' },
  ...overrides,
});

describe('isSftpCapable', () => {
  it('offers SFTP for connected SSH terminal panes', () => {
    expect(isSftpCapable(leaf({}))).toBe(true);
    expect(isSftpCapable(leaf({ config: { host: 'h', port: 22, username: 'u', protocol: 'ssh' } }))).toBe(true);
  });

  it('hides SFTP for local shells, telnet, sessionless and non-terminal panes', () => {
    expect(isSftpCapable(leaf({ config: { host: 'localhost', port: 0, username: '', protocol: 'local' } }))).toBe(false);
    expect(isSftpCapable(leaf({ config: { host: 'h', port: 23, username: '', protocol: 'telnet' } }))).toBe(false);
    expect(isSftpCapable(leaf({ sessionId: null }))).toBe(false);
    expect(isSftpCapable(leaf({ paneType: 'plugin', config: { pluginId: 'x' } }))).toBe(false);
    expect(isSftpCapable(leaf({ paneType: 'welcome', sessionId: null, config: null }))).toBe(false);
  });

  it('rejects disconnected SSH panes even when they retain a session ID', () => {
    expect(isSftpCapable(leaf({ isDisconnected: true }))).toBe(false);
  });
});

describe('SFTP dock', () => {
  it('discards the previous server list on switch and closes outside an eligible terminal', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const beforeSessions = useSessionStore.getState();
    const beforeWorkspace = useWorkspaceStore.getState();
    const beforePanels = usePanelStore.getState();
    const first = leaf({});
    const second = leaf({ paneId: 'p2', sessionId: 's2' });
    const local = leaf({ paneId: 'local', sessionId: 'local', config: { host: 'localhost', port: 0, username: '', protocol: 'local' } });
    const sftpList = vi.fn().mockResolvedValueOnce({
      success: true,
      list: [{ name: 'first-server.txt', longname: '', type: '-', size: 1, mtime: 0 }],
    }).mockReturnValue(new Promise(() => {}));
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('electronAPI', { sftpList });
    useWorkspaceStore.setState({ activeWorkspaceId: 'current', isVaultLocked: false, isSwitching: false, workspaces: [] });
    useSessionStore.setState({
      activeTabId: 'tab',
      activePaneId: first.paneId,
      selectedSessionIndex: null,
      tabs: [{ id: 'tab', title: 'SSH', config: null, workspaceId: 'current', paneTree: {
        type: 'hsplit', paneId: 'root', sizes: [50, 50], children: [first, {
          type: 'vsplit', paneId: 'child', sizes: [50, 50], children: [second, local],
        }],
      } }],
    });
    registerSftpPanel();
    try {
      await act(async () => root.render(createElement(SplitPane, { isDark: false, activeTabId: 'tab', children: createElement('div', { id: 'terminal' }) })));
      const terminal = container.querySelector('#terminal');
      await act(async () => usePanelStore.getState().togglePanel('sftp'));
      expect(sftpList).toHaveBeenCalledExactlyOnceWith('s1', '/');
      expect(container.textContent).toContain('first-server.txt');
      expect(container.querySelector('#terminal')).toBe(terminal);

      await act(async () => useSessionStore.getState().setActivePaneId(second.paneId));
      expect(sftpList).toHaveBeenLastCalledWith('s2', '/');
      expect(container.textContent).not.toContain('first-server.txt');

      await act(async () => useSessionStore.getState().setActivePaneId(local.paneId));
      expect(container.textContent).not.toContain('sftp.title');
      expect(usePanelStore.getState().activePanelId).toBeNull();
      expect(container.querySelector('#terminal')).toBe(terminal);
      expect(sftpList).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      useSessionStore.setState(beforeSessions);
      useWorkspaceStore.setState(beforeWorkspace);
      usePanelStore.setState(beforePanels);
      vi.unstubAllGlobals();
    }
  });
});
