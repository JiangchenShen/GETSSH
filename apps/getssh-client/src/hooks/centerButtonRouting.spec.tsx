// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneLeaf, PaneNode, SessionProfile, Tab } from '../store/sessionStore';

const mocks = vi.hoisted(() => ({
  session: {} as any,
  pendingRunbook: vi.fn(),
  syncProfiles: vi.fn(),
  connect: vi.fn(),
  callTidal: vi.fn(async (_action: string, call: Promise<unknown>) => call),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../store/sessionStore', () => ({ useSessionStore: { getState: () => mocks.session }, callTidal: mocks.callTidal }));
vi.mock('../store/workspaceStore', () => ({ useWorkspaceStore: { getState: () => ({ activeWorkspaceId: 'current' }) } }));
vi.mock('../store/appStore', () => ({ useAppStore: { getState: () => ({ addToast: vi.fn() }) } }));
vi.mock('../store/aiChatStore', () => ({ useAiChatStore: { getState: () => ({}) } }));

import { useCoreAppEvents } from './useCoreAppEvents';

let container: HTMLDivElement;
let root: Root;
let registerTab: ReturnType<typeof vi.fn>;
let replacePane: ReturnType<typeof vi.fn>;
let toggleZoom: ReturnType<typeof vi.fn>;
const Harness = () => {
  useCoreAppEvents(mocks.pendingRunbook, mocks.syncProfiles, mocks.connect);
  return null;
};
const tab = (id: string, paneTree: PaneNode, extra: Partial<Tab> = {}): Tab => ({
  id, title: id, workspaceId: 'current', config: null, paneTree, ...extra,
});
const draft = (id: string, isQuickConnect = false): SessionProfile => ({
  id, isDraft: true, isQuickConnect, host: 'unsaved.test', username: 'original',
  port: 2200, password: 'draft-only-test-value', privateKeyPath: '/not-a-real-key', alias: 'Unsaved draft',
});
const dispatch = async (type: string, detail?: unknown) => {
  await act(async () => window.dispatchEvent(new CustomEvent(type, { detail })));
};

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.session = {
    sessions: [] as SessionProfile[], tabs: [] as Tab[], activeTabId: null, activePaneId: null, selectedSessionIndex: null,
    setSessions: vi.fn((sessions: SessionProfile[]) => { mocks.session.sessions = sessions; }),
    setTabs: vi.fn((tabs: Tab[]) => { mocks.session.tabs = tabs; }),
    setActiveTabId: vi.fn((id: string | null) => { mocks.session.activeTabId = id; }),
    setActivePaneId: vi.fn((id: string | null) => { mocks.session.activePaneId = id; }),
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
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('center buttons', () => {
  it.each(['settings', 'ai', 'plugin'] as const)('reveals a first %s center in a hidden welcome pane without replacing its terminal sibling', async centerType => {
    const terminal: PaneLeaf = {
      type: 'leaf', paneId: 'terminal', paneType: 'terminal', sessionId: 'running-session', isZoomed: true,
      config: { host: 'connected.test', username: 'user', port: 22 },
    };
    mocks.session.tabs = [tab('work', {
      type: 'hsplit', paneId: 'split', sizes: [50, 50], children: [terminal, {
        type: 'leaf', paneId: 'welcome', paneType: 'welcome', sessionId: null, config: null,
      }],
    })];
    mocks.session.activeTabId = 'work';
    mocks.session.activePaneId = 'terminal';
    mocks.session.selectedSessionIndex = 0;

    await dispatch('app:open-center', { type: centerType, title: 'Center' });

    expect(mocks.session.tabs).toHaveLength(1);
    expect(mocks.session.tabs[0].paneTree.children[0]).toEqual({ ...terminal, isZoomed: false });
    expect(terminal.isZoomed).toBe(true);
    expect(mocks.session.tabs[0].paneTree.children[1]).toMatchObject({
      paneId: 'welcome', paneType: 'center', sessionId: null, config: { centerType },
    });
    expect(mocks.session.activeTabId).toBe('work');
    expect(mocks.session.activePaneId).toBe('welcome');
    expect(mocks.session.selectedSessionIndex).toBeNull();
    expect(replacePane).toHaveBeenCalledExactlyOnceWith('welcome', 'center', null, JSON.stringify({ centerType }));
    expect(toggleZoom).toHaveBeenCalledExactlyOnceWith('terminal');
    expect(registerTab).not.toHaveBeenCalled();

    await dispatch('app:open-center', { type: centerType, title: 'Center' });
    expect(replacePane).toHaveBeenCalledTimes(1);
    expect(toggleZoom).toHaveBeenCalledTimes(1);
    expect(mocks.session.tabs).toHaveLength(1);
  });

  it('opens a visible center instead of selecting a torn-off tab excluded from the main window', async () => {
    const torn = tab('torn-settings', {
      type: 'leaf', paneId: 'torn-pane', paneType: 'center', sessionId: null, config: { centerType: 'settings' },
    }, { isTornOff: true });
    mocks.session.tabs = [torn];
    mocks.session.activeTabId = torn.id;
    await dispatch('app:open-center', { type: 'settings', title: 'Settings' });
    expect(mocks.session.tabs).toHaveLength(2);
    expect(mocks.session.tabs[0]).toBe(torn);
    expect(mocks.session.activeTabId).toBe(mocks.session.tabs[1].id);
    expect(registerTab).toHaveBeenCalledTimes(1);
    expect(replacePane).not.toHaveBeenCalled();
    expect(toggleZoom).not.toHaveBeenCalled();
  });
});

describe('connection buttons', () => {
  it('applies a quick address while preserving an existing ordinary unsaved draft', async () => {
    const ordinary = draft('ordinary');
    mocks.session.sessions = [ordinary];
    await dispatch('app:create-session', '  ssh://admin@server.test:2222  ');
    expect(mocks.session.sessions).toHaveLength(2);
    expect(mocks.session.sessions[0]).toBe(ordinary);
    expect(mocks.session.sessions[1]).toMatchObject({
      isDraft: true, isQuickConnect: true, host: 'server.test', username: 'admin', port: 2222, protocol: 'ssh',
    });
    expect(mocks.session.selectedSessionIndex).toBe(1);
    expect(mocks.session.activeTabId).toBeNull();
    expect(mocks.syncProfiles).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('resets the matching quick draft and its form identity when another address is requested', async () => {
    const ordinary = draft('ordinary');
    const quick = draft('quick', true);
    mocks.session.sessions = [ordinary, quick];
    await dispatch('app:create-session', 'next@next.test:2223');
    expect(mocks.session.sessions).toHaveLength(2);
    expect(mocks.session.sessions[0]).toBe(ordinary);
    expect(mocks.session.sessions[1]).toMatchObject({
      isDraft: true, isQuickConnect: true, host: 'next.test', username: 'next', port: 2223,
      password: '', privateKeyPath: '', protocol: 'ssh',
    });
    // The form's local fields reset on id change; keeping this id would leave the old address displayed.
    expect(mocks.session.sessions[1].id).not.toBe(quick.id);
    expect(mocks.session.selectedSessionIndex).toBe(1);
    expect(mocks.syncProfiles).not.toHaveBeenCalled();
  });

  it('reuses the ordinary draft for New Connection even when a quick draft comes first', async () => {
    const quick = draft('quick', true);
    const ordinary = draft('ordinary');
    mocks.session.sessions = [quick, ordinary];
    await dispatch('app:create-session', '');
    expect(mocks.session.selectedSessionIndex).toBe(1);
    expect(mocks.session.sessions).toEqual([quick, ordinary]);
    expect(mocks.session.setSessions).not.toHaveBeenCalled();
  });

  it('creates an ordinary draft for New Connection without resetting an existing quick draft', async () => {
    const quick = draft('quick', true);
    mocks.session.sessions = [quick];
    await dispatch('app:create-session');
    expect(mocks.session.sessions).toHaveLength(2);
    expect(mocks.session.sessions[0]).toBe(quick);
    expect(mocks.session.sessions[1]).toMatchObject({ isDraft: true, isQuickConnect: false, host: '', username: '', protocol: 'auto' });
    expect(mocks.session.selectedSessionIndex).toBe(1);
    expect(mocks.syncProfiles).not.toHaveBeenCalled();
  });
});
