// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneLeaf, PaneNode, Tab } from '../store/sessionStore';

const mocks = vi.hoisted(() => ({
  session: {} as any,
  workspace: { activeWorkspaceId: 'current' },
  buffer: vi.fn(),
  callTidal: vi.fn(async (_action: string, call: Promise<unknown>) => call),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../store/sessionStore', () => ({ useSessionStore: { getState: () => mocks.session }, callTidal: mocks.callTidal }));
vi.mock('../store/workspaceStore', () => ({ useWorkspaceStore: { getState: () => mocks.workspace } }));
vi.mock('../store/appStore', () => ({ useAppStore: { getState: () => ({ addToast: vi.fn() }) } }));
vi.mock('../store/aiChatStore', () => ({ useAiChatStore: { getState: () => ({}) } }));
vi.mock('../components/Terminal', () => ({ getTerminalBuffer: mocks.buffer }));

import { useCoreAppEvents } from './useCoreAppEvents';
import { ContextService } from '../services/contextService';

let container: HTMLDivElement;
let root: Root;
let registerTab: ReturnType<typeof vi.fn>;
let replacePane: ReturnType<typeof vi.fn>;
let toggleZoom: ReturnType<typeof vi.fn>;

const terminal = (paneId: string, sessionId: string | null, extra: Partial<PaneLeaf> = {}): PaneLeaf => ({
  type: 'leaf', paneId, paneType: 'terminal', sessionId,
  config: { host: 'example.test', username: 'user', port: 22, alias: sessionId || 'No session' },
  ...extra,
});
const center = (paneId: string, centerType: 'ai' | 'settings' | 'secure'): PaneLeaf => ({
  type: 'leaf', paneId, paneType: 'center', sessionId: null, config: { centerType },
});
const split = (left: PaneNode, right: PaneNode): PaneNode => ({ type: 'hsplit', paneId: 'split', children: [left, right], sizes: [50, 50] });
const tab = (id: string, paneTree: PaneNode, extra: Partial<Tab> = {}): Tab => ({
  id, title: id, workspaceId: 'current', config: paneTree.type === 'leaf' ? paneTree.config : null, paneTree, ...extra,
});
const EventsHarness = () => {
  useCoreAppEvents(vi.fn(), vi.fn(), vi.fn());
  return null;
};
const openCenter = async (detail: { type: 'ai' | 'settings' | 'secure'; title?: string; settingsTab?: string }) => {
  await act(async () => window.dispatchEvent(new CustomEvent('app:open-center', { detail: { title: 'Center', ...detail } })));
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.activeWorkspaceId = 'current';
  mocks.buffer.mockImplementation((id: string) => `buffer:${id}`);
  mocks.session = {
    tabs: [] as Tab[], activeTabId: null, activePaneId: null, selectedSessionIndex: 0,
    setTabs: vi.fn((tabs: Tab[]) => { mocks.session.tabs = tabs; }),
    setActiveTabId: vi.fn((id: string) => { mocks.session.activeTabId = id; }),
    setActivePaneId: vi.fn((id: string) => { mocks.session.activePaneId = id; }),
    setSelectedSessionIndex: vi.fn((index: number | null) => { mocks.session.selectedSessionIndex = index; }),
  };
  registerTab = vi.fn().mockResolvedValue({ success: true });
  replacePane = vi.fn().mockResolvedValue({ success: true });
  toggleZoom = vi.fn().mockResolvedValue({ success: true });
  window.electronAPI = {
    tidalRegisterTab: registerTab, tidalReplacePane: replacePane, tidalToggleZoom: toggleZoom,
  } as unknown as Window['electronAPI'];
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('center destinations', () => {
  it('does not reuse stale tab config or a center in another workspace', async () => {
    const stale = tab('former-ai', terminal('terminal', 'session'), { config: { centerType: 'ai' } });
    mocks.session.tabs = [stale, tab('foreign-ai', center('foreign-pane', 'ai'), { workspaceId: 'foreign' })];
    mocks.session.activeTabId = 'former-ai';
    mocks.session.activePaneId = 'terminal';
    await act(async () => root.render(<EventsHarness />));
    await openCenter({ type: 'ai' });
    expect(mocks.session.tabs).toHaveLength(3);
    expect(mocks.session.tabs[0]).toEqual(stale);
    expect(mocks.session.activeTabId).not.toBe('former-ai');
    expect(mocks.session.activeTabId).not.toBe('foreign-ai');
    expect(registerTab).toHaveBeenCalledTimes(1);
    expect(registerTab.mock.calls[0].slice(3)).toEqual(['center', JSON.stringify({ centerType: 'ai' }), 'Center', 'current']);
    await openCenter({ type: 'ai' });
    expect(mocks.session.tabs).toHaveLength(3);
    expect(registerTab).toHaveBeenCalledTimes(1);
  });

  it('reuses and focuses a split center while exiting a different pane zoom', async () => {
    mocks.session.tabs = [tab('work', split(terminal('zoomed-terminal', 'session', { isZoomed: true }), center('ai-pane', 'ai')))];
    mocks.session.activeTabId = 'work';
    mocks.session.activePaneId = 'zoomed-terminal';
    await act(async () => root.render(<EventsHarness />));
    await openCenter({ type: 'ai' });
    expect(mocks.session.tabs).toHaveLength(1);
    expect(mocks.session.activeTabId).toBe('work');
    expect(mocks.session.activePaneId).toBe('ai-pane');
    expect(mocks.session.tabs[0].paneTree.children[0].isZoomed).toBe(false);
    expect(toggleZoom).toHaveBeenCalledExactlyOnceWith('zoomed-terminal');
    expect(registerTab).not.toHaveBeenCalled();
    expect(replacePane).not.toHaveBeenCalled();
    await openCenter({ type: 'ai' });
    expect(toggleZoom).toHaveBeenCalledTimes(1);
  });

  it.each(['secure', 'settings'] as const)('routes %s security links into an existing Settings pane', async type => {
    mocks.session.tabs = [tab('old-security', center('security-pane', 'secure'))];
    const selectSettings = vi.fn();
    window.addEventListener('app:settings-tab', selectSettings, { once: true });
    await act(async () => root.render(<EventsHarness />));
    await openCenter({ type, settingsTab: 'Security' });
    expect(mocks.session.tabs).toHaveLength(1);
    expect(mocks.session.tabs[0].config).toEqual({ centerType: 'settings', settingsTab: 'Security' });
    expect(mocks.session.tabs[0].paneTree.config).toEqual({ centerType: 'settings', settingsTab: 'Security' });
    expect(mocks.session.activePaneId).toBe('security-pane');
    expect(mocks.session.selectedSessionIndex).toBeNull();
    expect(replacePane).toHaveBeenCalledExactlyOnceWith('security-pane', 'center', null, JSON.stringify({ centerType: 'settings', settingsTab: 'Security' }));
    expect((selectSettings.mock.calls[0][0] as CustomEvent).detail).toBe('Security');
    expect(registerTab).not.toHaveBeenCalled();
  });
});

describe('explicit AI terminal context', () => {
  beforeEach(() => {
    mocks.session.tabs = [
      tab('ai', center('ai-pane', 'ai')),
      tab('connected', terminal('connected-pane', 'connected-session')),
      tab('other-workspace', terminal('foreign-pane', 'foreign-session'), { workspaceId: 'foreign' }),
      tab('disconnected', terminal('disconnected-pane', 'disconnected-session', { isDisconnected: true })),
      tab('torn-off', terminal('torn-pane', 'torn-session'), { isTornOff: true }),
      tab('no-session', terminal('empty-pane', null)),
    ];
    mocks.session.activeTabId = 'ai';
    mocks.session.activePaneId = 'ai-pane';
  });

  it('lists only current-workspace connected terminals without choosing a background terminal', () => {
    expect(ContextService.getTerminalSessionContext(true)).toEqual({
      activeSession: null, allSessions: [{ id: 'connected-session', name: 'connected-session' }],
    });
    expect(ContextService.getTerminalSessionContext()).toEqual({ activeSession: null, allSessions: [] });
    expect(ContextService.getActiveTerminalSnapshot()).toBeNull();
    expect(mocks.buffer).not.toHaveBeenCalled();
  });

  it('reads only the explicitly chosen connected terminal buffer', () => {
    expect(ContextService.getActiveTerminalSnapshot('connected-session')).toEqual({
      sessionId: 'connected-session', name: 'connected-session', buffer: 'buffer:connected-session',
    });
    expect(mocks.buffer).toHaveBeenCalledExactlyOnceWith('connected-session');
  });

  it.each(['foreign-session', 'disconnected-session', 'torn-session', 'unknown-session'])('rejects unavailable target %s before reading its buffer', sessionId => {
    expect(ContextService.getActiveTerminalSnapshot(sessionId)).toBeNull();
    expect(mocks.buffer).not.toHaveBeenCalled();
  });

  it('retains the active-tab fallback for the floating AI companion', () => {
    mocks.session.activeTabId = 'connected';
    mocks.session.activePaneId = null;
    expect(ContextService.getActiveTerminalSnapshot()).toEqual({
      sessionId: 'connected-session', name: 'connected-session', buffer: 'buffer:connected-session',
    });
  });
});
