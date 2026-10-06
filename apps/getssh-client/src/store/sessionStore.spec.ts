// @vitest-environment jsdom
// Regression tests for the tidal-engine sync contract: rev ordering, tab replacement, session lifetime, divider commits.
import { describe, it, expect, vi, beforeAll } from 'vitest';

const calls: any[] = [];
let closeTabResult: any = { success: true };
(globalThis as any).window.electronAPI = new Proxy({}, {
  get: (_t, name: string) => (...args: any[]) => {
    calls.push([name, ...args]);
    if (name === 'tidalCloseTab') return Promise.resolve(closeTabResult);
    if (name.startsWith('tidal')) return Promise.resolve({ success: true });
    if (name.startsWith('on')) return () => {};
    return Promise.resolve(undefined);
  },
});


let S: any, W: any;
beforeAll(async () => {
  S = (await import('./sessionStore')).useSessionStore;
  W = (await import('./workspaceStore')).useWorkspaceStore;
});

const leaf = (paneId: string, sessionId: string | null = null, paneType = 'terminal') => ({ type: 'leaf', paneId, paneType, sessionId, config: sessionId ? { host: 'h', port: 22, username: 'u' } : null });
const split = (paneId: string, a: any, b: any) => ({ type: 'hsplit', paneId, children: [a, b], sizes: [50, 50] });
const payload = (tabId: string, rev: number, tree: any, extra: any = {}) => ({ tabId, rev, tree, title: 'T', isTornOff: false, workspaceId: 'A', ...extra });

describe('sessionStore tidal sync', () => {
  it('rev ordering, null tree, replacement in same workspace, reconcile', async () => {
    W.setState({ activeWorkspaceId: 'A' });
    S.setState({ tabs: [
      { id: 'b1', title: 'b', config: null, workspaceId: 'B', paneTree: leaf('pb', 'sb') },
      { id: 'a1', title: 'a', config: null, workspaceId: 'A', paneTree: leaf('pa1', 'sa1') },
      { id: 'a2', title: 'a2', config: null, workspaceId: 'A', paneTree: split('sp', leaf('a2x', 'sx'), leaf('a2y', 'sy')) },
      { id: 'b2', title: 'b', config: null, workspaceId: 'B', paneTree: leaf('pb2', 'sb2') },
    ], activeTabId: null, activePaneId: null });
    S.getState().setActiveTabId('a2');
    expect(S.getState().activePaneId).toBe('a2x');
    S.getState().setActivePaneId('a2y');
    S.getState().setActiveTabId('a1');
    expect(S.getState().activePaneId).toBe('pa1');
    S.getState().setActiveTabId('a2');
    expect(S.getState().activePaneId).toBe('a2y'); // remembered

    // stale rev ignored
    S.getState().syncTidalTree(payload('a2', 5, leaf('a2x', 'sx')));
    S.getState().syncTidalTree(payload('a2', 4, split('sp', leaf('a2x', 'sx'), leaf('a2y', 'sy'))));
    expect(S.getState().tabs.find((t: any) => t.id === 'a2').paneTree.type).toBe('leaf');
    expect(S.getState().activePaneId).toBe('a2x'); // reconciled

    // unknown null ignored; active null -> replacement from workspace A only
    S.getState().syncTidalTree(payload('zzz', 1, null));
    S.getState().syncTidalTree(payload('a2', 6, null));
    expect(S.getState().activeTabId).toBe('a1');
    expect(S.getState().activePaneId).toBe('pa1');
    S.getState().syncTidalTree(payload('a2', 7, leaf('ghost')));
    expect(S.getState().tabs.find((t: any) => t.id === 'a2')).toBeTruthy(); // later rev re-registers
    S.getState().syncTidalTree(payload('a2', 8, null));

    // new tab via sync gets workspace + root config, no focus
    S.getState().syncTidalTree(payload('tab-x', 9, leaf('px', 'sx'), { isTornOff: true, workspaceId: null }));
    const tx = S.getState().tabs.find((t: any) => t.id === 'tab-x');
    expect(tx.workspaceId).toBe('A');
    expect(tx.config).toEqual({ host: 'h', port: 22, username: 'u' });
    expect(S.getState().activeTabId).toBe('a1');

    // tear-in while workspace B active: not activated
    W.setState({ activeWorkspaceId: 'B' });
    S.getState().setActiveTabId('b1');
    S.getState().syncTidalTree(payload('tab-x', 10, leaf('px', 'sx'), { isTornOff: false }));
    expect(S.getState().activeTabId).toBe('b1');
    // back in A, tear off then in: activated
    W.setState({ activeWorkspaceId: 'A' });
    S.getState().setActiveTabId('a1');
    S.getState().syncTidalTree(payload('tab-x', 11, leaf('px', 'sx'), { isTornOff: true }));
    S.getState().syncTidalTree(payload('tab-x', 12, leaf('px', 'sx'), { isTornOff: false }));
    expect(S.getState().activeTabId).toBe('tab-x');
    expect(S.getState().activePaneId).toBe('px');
    // active tab torn whole -> replacement
    S.getState().syncTidalTree(payload('tab-x', 13, leaf('px', 'sx'), { isTornOff: true }));
    expect(S.getState().activeTabId).toBe('a1');
  });

  it('closeTab disconnects only on tidal failure and never by tab id', async () => {
    W.setState({ activeWorkspaceId: 'A' });
    S.setState({ tabs: [
      { id: 'sA', title: 'a', config: null, workspaceId: 'A', paneTree: leaf('p2', 's2') },
      { id: 'a1', title: 'a', config: null, workspaceId: 'A', paneTree: leaf('pa1', 'sa1') },
    ], activeTabId: 'sA', activePaneId: 'p2' });
    calls.length = 0;
    closeTabResult = { success: true };
    S.getState().closeTab('sA');
    await new Promise(r => setTimeout(r, 0));
    expect(calls.filter(c => c[0] === 'sshDisconnect')).toEqual([]);
    expect(S.getState().activeTabId).toBe('a1');
    calls.length = 0;
    closeTabResult = { success: false, error: 'tidal_engine_unavailable' };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    S.getState().closeTab('a1');
    await new Promise(r => setTimeout(r, 0));
    expect(calls.filter(c => c[0] === 'sshDisconnect')).toEqual([['sshDisconnect', 'sa1']]);
    expect(S.getState().activeTabId).toBe(null);
    err.mockRestore();
  });

  it('sizes: local during drag, IPC on commit; plugin panel registers', async () => {
    S.setState({ tabs: [{ id: 't', title: 't', config: null, workspaceId: 'A', paneTree: split('sp', leaf('x'), leaf('y')) }], activeTabId: 't' });
    calls.length = 0;
    S.getState().patchTidalSizes('t', 'sp', [33.33, 66.67]);
    expect(calls.length).toBe(0);
    S.getState().patchTidalSizes('t', 'sp', [40, 60], true);
    expect(calls).toEqual([['tidalUpdateSizes', 'sp', [40, 60]]]);
    expect(S.getState().tabs[0].paneTree.sizes).toEqual([40, 60]);
    calls.length = 0;
    S.getState().registerPluginPanel('plug', 'panel', 'Panel', 'getssh-plugin://plug/p.html');
    S.getState().openPluginPanel('plug', 'panel');
    const reg = calls.find(c => c[0] === 'tidalRegisterTab');
    expect(reg.slice(1)).toEqual(['panel-A-plug-panel', 'panel-A-plug-panel-pane', '', 'plugin', JSON.stringify({ pluginUrl: 'getssh-plugin://plug/p.html' }), 'Panel', 'A']);
    expect(S.getState().activePaneId).toBe('panel-A-plug-panel-pane');
  });
});
