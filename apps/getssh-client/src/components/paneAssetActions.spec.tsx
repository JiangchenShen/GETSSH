// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: {} as any, workspace: {} as any, toast: vi.fn(), paneContext: {} as any }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('../store/sessionStore', async importOriginal => ({
  ...await importOriginal<typeof import('../store/sessionStore')>(),
  useSessionStore: Object.assign((select: (state: any) => any) => select(mocks.session), { getState: () => mocks.session }),
}));
vi.mock('../store/workspaceStore', () => ({ useWorkspaceStore: Object.assign(
  (select: (state: any) => any) => select(mocks.workspace),
  { getState: () => mocks.workspace, setState: (update: any) => Object.assign(mocks.workspace, update) },
) }));
vi.mock('../store/appStore', () => ({ useAppStore: Object.assign(
  (select: (state: any) => any) => select({}), { getState: () => ({ addToast: mocks.toast }) },
) }));
vi.mock('../store/panelStore', () => ({ usePanelStore: (select: (state: any) => any) => select({ activePanelId: null }) }));
vi.mock('./SplitPane', () => ({ isSftpCapable: () => false }));
vi.mock('./SFTPManager', () => ({ SFTP_PANEL_ID: 'sftp' }));
vi.mock('../registry/paneRegistry', () => ({ paneRegistry: { render: (context: any) => { mocks.paneContext = context; return null; } } }));

import { LeafPane } from './LeafPane';
import { AssetBridgeTab } from './workspace-center/AssetBridgeTab';

let root: Root;
let container: HTMLDivElement;
const leaf = { type: 'leaf', paneId: 'pane', paneType: 'center', sessionId: null, config: null } as const;
const sourceProfile = { id: 'imported', host: 'sample.invalid', username: 'test', groupName: 'Imported', autoStart: 0 };
const sourceRunbook = { id: 'runbook', title: 'Check files', script: 'ls', riskLevel: 'LOW' };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  mocks.session = {
    activePaneId: 'pane', setActivePaneId: vi.fn(),
    tabs: [{ id: 'tab', title: 'Settings', workspaceId: 'target', paneTree: leaf }],
    sessions: [{ id: 'existing', host: 'existing.invalid', username: 'test' }, { id: 'draft', isDraft: true, host: '', username: 'editing' }, { id: 'quick', isQuickConnect: true, host: 'temporary.invalid', username: 'test' }],
    selectedSessionIndex: 1,
    setSessions: vi.fn((sessions: any[]) => { mocks.session.sessions = sessions; }),
    setSelectedSessionIndex: vi.fn((index: number | null) => { mocks.session.selectedSessionIndex = index; }),
  };
  mocks.workspace = {
    activeWorkspaceId: 'target', isSwitching: false, isVaultLocked: false, runbooks: [],
    workspaces: [{ id: 'target', name: 'Target' }, { id: 'source', name: 'Source' }],
    initWorkspaces: vi.fn().mockResolvedValue(undefined),
  };
  window.electronAPI = {
    tidalToggleZoom: vi.fn().mockResolvedValue({ success: true }),
    tidalClosePane: vi.fn().mockResolvedValue({ success: true }),
    bridgeFetchProfiles: vi.fn(async (id: string) => ({ success: true, profiles: id === 'source' ? [sourceProfile] : [], runbooks: [sourceRunbook] })),
    bridgeImportProfiles: vi.fn().mockResolvedValue({ success: true }),
    unlockProfiles: vi.fn().mockResolvedValue([{ id: 'existing', host: 'existing.invalid', username: 'test' }, { id: 'imported', host: 'sample.invalid', username: 'test', group: 'Imported', autoStart: false }]),
    saveProfiles: vi.fn(),
  } as unknown as Window['electronAPI'];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const click = (element: HTMLElement) => act(async () => element.click());
const openLeaf = () => act(async () => root.render(<LeafPane node={leaf} tabId="tab" appConfig={{}} isDark isTabActive onSplit={() => {}} />));
const prepareImport = async () => {
  await act(async () => root.render(<AssetBridgeTab />));
  await act(async () => {
    const select = container.querySelector('select')!;
    select.value = 'source';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click(Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('sample.invalid'))!);
  await click(Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Check files'))!);
};
const importButton = () => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Import selected'))!;

describe('pane toolbar actions', () => {
  it.each([['Zen Mode', 'tidalToggleZoom'], ['Close Pane', 'tidalClosePane']] as const)('shows resolved refusals and IPC rejections for %s', async (title, method) => {
    const action = vi.mocked(window.electronAPI[method]);
    action.mockResolvedValueOnce({ success: false, error: 'tidal_engine_unavailable' }).mockRejectedValueOnce(new Error('handler missing'));
    await openLeaf();
    const button = container.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!;
    await click(button);
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.stringContaining('tidal_engine_unavailable'), 'error');
    await click(button);
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.stringContaining('handler missing'), 'error');
  });

  it('ignores naturally removed panes during terminal cleanup but reports other failures', async () => {
    vi.mocked(window.electronAPI.tidalClosePane).mockResolvedValueOnce({ success: false, error: 'not_found' }).mockResolvedValueOnce({ success: false, error: 'tidal_engine_unavailable' });
    await openLeaf();
    await act(async () => mocks.paneContext.onClosePane());
    expect(mocks.toast).not.toHaveBeenCalled();
    await act(async () => mocks.paneContext.onClosePane());
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('tidal_engine_unavailable'), 'error');
  });
});

describe('asset bridge import', () => {
  it('refreshes normalized hosts and runbooks immediately without saving over drafts or quick connections', async () => {
    const draft = mocks.session.sessions[1];
    const quick = mocks.session.sessions[2];
    await prepareImport();
    await click(importButton());
    expect(window.electronAPI.bridgeImportProfiles).toHaveBeenCalledWith('target', [sourceProfile], [sourceRunbook]);
    expect(mocks.session.sessions.map((profile: any) => profile.id)).toEqual(['existing', 'imported', 'draft', 'quick']);
    expect(mocks.session.sessions[1]).toMatchObject({ group: 'Imported', autoStart: false });
    expect(mocks.session.sessions[2]).toBe(draft);
    expect(mocks.session.sessions[3]).toBe(quick);
    expect(mocks.session.selectedSessionIndex).toBe(2);
    expect(mocks.workspace.runbooks).toEqual([expect.objectContaining({ id: 'runbook', name: 'Check files', command: 'ls', dangerLevel: 'low' })]);
    expect(window.electronAPI.saveProfiles).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Assets imported.');
  });

  it('does not refresh the newly active workspace when import completes after a switch', async () => {
    const importing = deferred<{ success: boolean }>();
    vi.mocked(window.electronAPI.bridgeImportProfiles).mockReturnValue(importing.promise);
    await prepareImport();
    await click(importButton());
    mocks.workspace.activeWorkspaceId = 'source';
    await act(async () => importing.resolve({ success: true }));
    expect(window.electronAPI.unlockProfiles).not.toHaveBeenCalled();
    expect(mocks.session.setSessions).not.toHaveBeenCalled();
    expect(mocks.workspace.runbooks).toEqual([]);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it.each(['requireMfa', 'requiresApproval', 'forceMFAVerification'])('preserves high risk and approval requirements from %s', async approvalFlag => {
    vi.mocked(window.electronAPI.bridgeFetchProfiles).mockImplementation(async (id: string) => ({
      success: true,
      profiles: id === 'source' ? [sourceProfile] : [],
      runbooks: [{ ...sourceRunbook, riskLevel: 'HIGH', [approvalFlag]: true }],
    }));
    await prepareImport();
    await click(importButton());
    expect(mocks.workspace.runbooks).toEqual([expect.objectContaining({ name: 'Check files', command: 'ls', dangerLevel: 'high', requireMfa: true })]);
  });

  it.each(['switch', 'lock'])('does not expose refresh results if the workspace changes or locks while loading (%s)', async change => {
    const loading = deferred<any[]>();
    vi.mocked(window.electronAPI.unlockProfiles).mockReturnValue(loading.promise);
    await prepareImport();
    await click(importButton());
    expect(window.electronAPI.unlockProfiles).toHaveBeenCalled();
    if (change === 'switch') mocks.workspace.activeWorkspaceId = 'source';
    else mocks.workspace.isVaultLocked = true;
    await act(async () => loading.resolve([{ id: 'imported', host: 'sample.invalid', username: 'test' }]));
    expect(mocks.session.setSessions).not.toHaveBeenCalled();
    expect(mocks.workspace.runbooks).toEqual([]);
  });
});
