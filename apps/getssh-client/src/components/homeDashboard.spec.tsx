// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../locales/en-US.json';
import zh from '../locales/zh-CN.json';
import type { OceanSentinelStatus, SecurityStatus } from '../types/ipc';
import type { PaneLeaf, PaneNode, SessionProfile, Tab } from '../store/sessionStore';

const mocks = vi.hoisted(() => ({
  workspaceId: 'current',
  sessions: [] as SessionProfile[],
  tabs: [] as Tab[],
  supervisor: null as OceanSentinelStatus | null,
  supervisorError: null as string | null,
  pollSentinelStatus: vi.fn(),
  setActiveTabId: vi.fn(),
  language: 'en-US',
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, options?: any) => translate(key, options),
  i18n: { language: mocks.language },
}) }));
vi.mock('../store/appStore', () => ({ useAppStore: (select: (state: any) => any) => select({
  isDark: true,
  isConfigLoaded: true,
  appConfig: { pluginSecurityMode: 'safe', privacyMode: false, autoLockTimeout: 0 },
  setIsCommandCenterOpen: vi.fn(),
  sentinelStatus: mocks.supervisor,
  sentinelStatusError: mocks.supervisorError,
  pollSentinelStatus: mocks.pollSentinelStatus,
}) }));
vi.mock('../store/workspaceStore', () => ({ useWorkspaceStore: (select: (state: any) => any) => select({
  activeWorkspaceId: mocks.workspaceId,
  isVaultLocked: false,
  isSwitching: false,
  workspaces: [
    { id: 'current', name: 'Current', themeColor: '#0ea5e9', isMain: true, hasPassword: false },
    { id: 'other', name: 'Other', themeColor: '#0ea5e9', isMain: false, hasPassword: false },
  ],
}) }));
vi.mock('../store/cryptoStore', () => ({ useCryptoStore: (select: (state: any) => any) => select({
  cryptoMode: 'idle', setCryptoMode: vi.fn(), workspaceUnprotected: true,
}) }));
vi.mock('../store/sessionStore', async importOriginal => ({
  ...await importOriginal<typeof import('../store/sessionStore')>(),
  useSessionStore: (select: (state: any) => any) => select({
    sessions: mocks.sessions, tabs: mocks.tabs, setActiveTabId: mocks.setActiveTabId,
  }),
}));
vi.mock('../lib/workspaceUnlock', () => ({ unlockActiveWorkspaceWithPassword: vi.fn(), unlockActiveWorkspaceWithPresence: vi.fn() }));
vi.mock('./CryptoModal', () => ({ CryptoModal: () => <div>Workspace locked</div> }));

import { TidalDashboard } from './TidalDashboard';

function translate(key: string, options?: any): any {
  const locale = mocks.language === 'zh-CN' ? zh.translation : en.translation;
  const value = key.split('.').reduce((object, part) => object?.[part], locale as any);
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return typeof options === 'string' ? options : key;
  return value.replace(/\{\{(\w+)\}\}/g, (placeholder, name) => String(options?.[name] ?? placeholder));
}
const metadata = (workspaceId = 'current', protectedValue = true, ownPassword = false): SecurityStatus => ({
  appProtected: protectedValue, recoveryConfigured: false, presenceSupported: false, deviceBackend: 'macos-keychain',
  scopes: [
    { id: 'app', workspaceId: null, protected: protectedValue, ownPassword: protectedValue, presence: false, unlocked: true, recovery: false, revealRemainingMs: null },
    { id: `ws:${workspaceId}`, workspaceId, protected: protectedValue, ownPassword, presence: false, unlocked: true, recovery: false, revealRemainingMs: null },
  ],
});
const terminal = (paneId: string, disconnected = false): PaneLeaf => ({
  type: 'leaf', paneId, paneType: 'terminal', sessionId: 'shared-transport-id',
  isDisconnected: disconnected, config: { host: 'host', username: 'user', port: 22, workspaceId: 'current' },
});
const tab = (id: string, workspaceId: string, paneTree: PaneNode, isTornOff = false): Tab => ({ id, title: id, workspaceId, paneTree, isTornOff, config: null });

let root: Root;
let container: HTMLDivElement;
let status: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspaceId = 'current';
  mocks.language = 'en-US';
  mocks.sessions = [];
  mocks.tabs = [];
  mocks.supervisor = { status: 'secure', daemonState: 'running', sentinelDisabled: false, lastPing: 100 };
  mocks.supervisorError = null;
  mocks.pollSentinelStatus.mockResolvedValue(mocks.supervisor);
  status = vi.fn().mockResolvedValue(metadata());
  window.electronAPI = { security: { status } } as unknown as Window['electronAPI'];
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const render = (resumeTabId?: string) => act(async () => root.render(<TidalDashboard resumeTabId={resumeTabId} />));
const text = (testId: string) => {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  expect(element, `Missing home summary: ${testId}`).not.toBeNull();
  return element!.textContent!.trim();
};
const tone = (testId: string) => container.querySelector(`[data-testid="${testId}"]`)!.getAttribute('data-tone');

describe('time-based home greetings', () => {
  it('keeps all four existing phrases available in both languages', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 10));
    const random = vi.spyOn(Math, 'random');
    for (const language of ['en-US', 'zh-CN']) {
      mocks.language = language;
      const greetings = (language === 'zh-CN' ? zh : en).translation.welcome.greeting.forenoon;
      for (let index = 0; index < greetings.length; index++) {
        random.mockReturnValue((index + 0.5) / greetings.length);
        await render();
        expect(container.querySelector('.home-greeting')?.textContent).toBe(greetings[index]);
        await act(async () => root.unmount());
        root = createRoot(container);
      }
    }
  });

  it('uses the correct local-time group across every period boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 0));
    vi.spyOn(Math, 'random').mockReturnValue(0.6);
    mocks.language = 'zh-CN';
    await render();
    const cases = [
      [0, 'midnight'], [4, 'midnight'], [5, 'morning'], [8, 'morning'],
      [9, 'forenoon'], [11, 'forenoon'], [12, 'noon'], [13, 'noon'],
      [14, 'afternoon'], [17, 'afternoon'], [18, 'evening'], [21, 'evening'],
      [22, 'lateNight'], [23, 'lateNight'],
    ] as const;
    for (const [hour, period] of cases) {
      vi.setSystemTime(new Date(2026, 9, 5, hour));
      await act(async () => vi.advanceTimersByTime(30_000));
      expect(container.querySelector('.home-greeting')?.textContent).toBe(zh.translation.welcome.greeting[period][2]);
    }
  });

  it('keeps the selection through refreshes and language changes, and chooses again on a new visit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 10));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.3);
    await render();
    expect(container.querySelector('.home-greeting')?.textContent).toBe(en.translation.welcome.greeting.forenoon[1]);
    random.mockReturnValue(0.99);
    mocks.supervisorError = 'IPC unavailable';
    await render();
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(container.querySelector('.home-greeting')?.textContent).toBe(en.translation.welcome.greeting.forenoon[1]);
    mocks.language = 'zh-CN';
    await render();
    expect(container.querySelector('.home-greeting')?.textContent).toBe(zh.translation.welcome.greeting.forenoon[1]);
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.querySelector('.home-greeting')?.textContent).toBe(zh.translation.welcome.greeting.forenoon[3]);
  });
});
describe('home dashboard data boundaries', () => {
  it('counts saved profiles and current-window terminal panes, independently of session IDs', async () => {
    mocks.sessions = [
      { id: 'saved', host: 'host', username: 'user' },
      { id: 'local', host: '', username: '', protocol: 'local' },
      { id: 'draft', host: 'draft', username: 'user', isDraft: true },
      { id: 'quick', host: 'quick', username: 'user', isQuickConnect: true },
      { id: 'empty', host: '   ', username: 'user' },
    ];
    mocks.tabs = [
      tab('current-tab', 'current', { type: 'vsplit', paneId: 'root', sizes: [50, 50], children: [
        { type: 'hsplit', paneId: 'terminals', sizes: [50, 50], children: [terminal('one'), terminal('two', true)] },
        { type: 'hsplit', paneId: 'non-terminals', sizes: [50, 50], children: [
          { type: 'leaf', paneId: 'center', paneType: 'center', sessionId: 'not-a-terminal', config: { centerType: 'settings' } },
          { type: 'leaf', paneId: 'welcome', paneType: 'welcome', sessionId: null, config: null },
        ] },
      ] }),
      tab('foreign-tab', 'other', terminal('foreign')),
      tab('torn-tab', 'current', terminal('torn'), true),
    ];
    await render();
    expect(text('home-saved-count')).toBe('2');
    expect(text('home-terminal-count')).toBe('2');
    expect(text('home-disconnected-count')).toBe('1');
    expect(text('home-workspace-count')).toBe('2');
  });

  it('offers resume only for a tab in the current workspace and main window', async () => {
    mocks.tabs = [tab('current-tab', 'current', terminal('current')), tab('foreign-tab', 'other', terminal('foreign')), tab('torn-tab', 'current', terminal('torn'), true)];
    await render('foreign-tab');
    expect(container.querySelector('.home-resume')).toBeNull();
    await render('torn-tab');
    expect(container.querySelector('.home-resume')).toBeNull();
    await render('current-tab');
    const resume = container.querySelector<HTMLButtonElement>('.home-resume');
    expect(resume).not.toBeNull();
    await act(async () => resume!.click());
    expect(mocks.setActiveTabId).toHaveBeenCalledWith('current-tab');
  });

  it.each([
    [true, false, 'Master password'],
    [true, true, 'Own password'],
    [false, false, 'Not set'],
  ] as [boolean, boolean, string][])('shows real scope protection (protected=%s, ownPassword=%s)', async (protectedValue, ownPassword, expected) => {
    status.mockResolvedValue(metadata('current', protectedValue, ownPassword));
    await render();
    expect(text('home-protection-state')).toBe(expected);
    expect(tone('home-protection-state')).toBe(protectedValue ? 'ok' : 'warn');
  });

  it.each(['null', 'rejected'])('keeps %s protection metadata unknown instead of showing an unprotected warning', async failure => {
    if (failure === 'null') status.mockResolvedValue(null);
    else status.mockRejectedValue(new Error('Metadata unavailable'));
    await render();
    expect(text('home-protection-state')).toBe('Not confirmed');
    expect(tone('home-protection-state')).toBe('neutral');
  });

  it('discards the old workspace metadata response after switching workspaces', async () => {
    let resolveOld!: (value: SecurityStatus) => void;
    status.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(metadata('other', true, true));
    await render();
    mocks.workspaceId = 'other';
    await render();
    expect(status).toHaveBeenCalledTimes(2);
    expect(text('home-protection-state')).toBe('Own password');
    await act(async () => resolveOld(metadata('current', false)));
    expect(text('home-protection-state')).toBe('Own password');
    expect(tone('home-protection-state')).toBe('ok');
  });

  it.each([
    [{ status: 'secure', daemonState: 'running', sentinelDisabled: false, lastPing: 100 }, null, 'Running normally'],
    [{ status: 'warning', daemonState: 'running', sentinelDisabled: false, lastPing: 100 }, null, 'Needs attention'],
    [{ status: 'secure', daemonState: 'running', sentinelDisabled: true, lastPing: 100 }, null, 'Disabled'],
    [{ status: 'secure', daemonState: 'starting', sentinelDisabled: false, lastPing: 0 }, null, 'Connecting'],
    [{ status: 'secure', daemonState: 'unavailable', sentinelDisabled: false, lastPing: 100 }, null, 'Unavailable'],
    [{ status: 'secure', sentinelDisabled: false, lastPing: 100 }, null, 'Not confirmed'],
    [null, 'IPC unavailable', 'Unavailable'],
    [{ status: 'secure', daemonState: 'running', sentinelDisabled: false, lastPing: 100 }, 'IPC unavailable', 'Unavailable'],
  ] as [OceanSentinelStatus | null, string | null, string][])('uses actual supervisor availability: %s', async (supervisor, error, expected) => {
    mocks.supervisor = supervisor;
    mocks.supervisorError = error;
    await render();
    expect(text('home-supervisor-state')).toBe(expected);
    if (expected === 'Running normally') expect(tone('home-supervisor-state')).toBe('ok');
    else expect(tone('home-supervisor-state')).not.toBe('ok');
  });

  it('keeps quick connect as a trimmed configuration event', async () => {
    const event = vi.fn();
    window.addEventListener('app:create-session', event);
    try {
      await render();
      const input = container.querySelector<HTMLInputElement>('.home-connect-input')!;
      const submit = container.querySelector<HTMLButtonElement>('.home-connect-submit')!;
      expect(submit.disabled).toBe(true);
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '  ssh://user@host:22  ');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(submit.disabled).toBe(false);
      await act(async () => submit.click());
      expect(event).toHaveBeenCalledTimes(1);
      expect((event.mock.calls[0][0] as CustomEvent).detail).toBe('ssh://user@host:22');
    } finally { window.removeEventListener('app:create-session', event); }
  });
});
