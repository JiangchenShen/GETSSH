// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../locales/en-US.json';
import zh from '../locales/zh-CN.json';
import type { SecurityStatus } from '../types/ipc';
import type { PaneLeaf, PaneNode, SessionProfile, Tab } from '../store/sessionStore';

const mocks = vi.hoisted(() => ({
  workspaceId: 'current',
  profilesWorkspaceId: 'current' as string | null,
  sessions: [] as SessionProfile[],
  tabs: [] as Tab[],
  connecting: false,
  error: null as string | null,
  setActiveTabId: vi.fn(),
  setActivePaneId: vi.fn(),
  setTabs: vi.fn(),
  onConnect: vi.fn(),
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
    sessions: mocks.sessions, profilesWorkspaceId: mocks.profilesWorkspaceId, tabs: mocks.tabs,
    connecting: mocks.connecting, error: mocks.error,
    setActiveTabId: mocks.setActiveTabId, setActivePaneId: mocks.setActivePaneId, setTabs: mocks.setTabs,
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
let toggleZoom: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspaceId = 'current';
  mocks.profilesWorkspaceId = 'current';
  mocks.language = 'en-US';
  mocks.sessions = [];
  mocks.tabs = [];
  mocks.connecting = false;
  mocks.error = null;
  status = vi.fn().mockResolvedValue(metadata());
  toggleZoom = vi.fn().mockResolvedValue({ success: true });
  window.electronAPI = { security: { status }, tidalToggleZoom: toggleZoom } as unknown as Window['electronAPI'];
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

const render = () => act(async () => root.render(<TidalDashboard onConnect={mocks.onConnect} />));
const text = (testId: string) => {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  expect(element, `Missing home state: ${testId}`).not.toBeNull();
  return element!.textContent!.trim();
};
const tone = (testId: string) => container.querySelector(`[data-testid="${testId}"]`)!.getAttribute('data-tone');

describe('home dashboard data boundaries', () => {
  it('hides the old workspace inventory while the new workspace profiles load', async () => {
    mocks.sessions = [{ id: 'old-host', host: 'old.example', username: 'user', alias: 'Previous workspace host' }];
    await render();
    expect(container.querySelector('.home-host-row')?.textContent).toContain('Previous workspace host');

    mocks.workspaceId = 'other';
    await render();
    expect(container.querySelector('.home-workspace')?.textContent).toBe('Other');
    expect(container.querySelector('.home-host-row')).toBeNull();
    expect(container.querySelector('.home-host-map')?.getAttribute('aria-busy')).toBe('true');
  });

  it('counts only saved profiles, excluding drafts, temporary connections, and blank addresses', async () => {
    mocks.sessions = [
      { id: 'saved', host: 'host', username: 'user' },
      { id: 'local', host: '', username: '', protocol: 'local' },
      { id: 'draft', host: 'draft', username: 'user', isDraft: true },
      { id: 'quick', host: 'quick', username: 'user', isQuickConnect: true },
      { id: 'empty', host: '   ', username: 'user' },
    ];
    await render();
    expect(text('home-saved-count')).toBe('2');
    expect(container.querySelectorAll('.home-host-row')).toHaveLength(2);
  });

  it('switches an already-open host only to a tab in the current workspace and main window', async () => {
    const profile = { id: 'saved', host: 'host', username: 'user' };
    const pane = { ...terminal('current'), config: { host: 'host', username: 'user', port: 22, profileId: 'saved', workspaceId: 'current' } };
    mocks.sessions = [profile];
    mocks.tabs = [tab('foreign-tab', 'other', pane), tab('torn-tab', 'current', pane, true)];
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('.home-host-open')!.click());
    expect(mocks.onConnect).toHaveBeenCalledWith(profile);
    expect(mocks.setActiveTabId).not.toHaveBeenCalled();

    mocks.onConnect.mockClear();
    const split: PaneNode = {
      type: 'hsplit', paneId: 'split', sizes: [50, 50],
      children: [{ ...terminal('other-pane'), isZoomed: true }, pane],
    };
    mocks.tabs.push(tab('current-tab', 'current', split));
    await render();
    expect(container.querySelector('.home-host-open')?.textContent).toContain('Switch tab');
    await act(async () => container.querySelector<HTMLButtonElement>('.home-host-open')!.click());
    expect(mocks.setActiveTabId).toHaveBeenCalledWith('current-tab');
    expect(mocks.setActivePaneId).toHaveBeenCalledWith('current');
    expect(toggleZoom).toHaveBeenCalledWith('other-pane');
    expect(mocks.setTabs.mock.lastCall?.[0].at(-1).paneTree.children[0].isZoomed).toBe(false);
    expect(mocks.onConnect).not.toHaveBeenCalled();
  });

  it('shows a pending state and retryable connection error for the attempted host', async () => {
    const profile = { id: 'alpha', alias: 'Alpha', host: 'alpha.example', username: 'deploy' };
    mocks.sessions = [profile, { id: 'beta', alias: 'Beta', host: 'beta.example', username: 'ops' }];
    await render();
    const buttons = container.querySelectorAll<HTMLButtonElement>('.home-host-open');
    await act(async () => buttons[0].click());
    expect(mocks.onConnect).toHaveBeenCalledWith(profile);

    mocks.connecting = true;
    await render();
    expect(buttons[0].textContent).toContain(en.translation.connection.connecting);
    expect(buttons[1].textContent).not.toContain(en.translation.connection.connecting);
    expect([...buttons].every(button => button.disabled)).toBe(true);

    mocks.connecting = false;
    mocks.error = 'Host is unreachable';
    await render();
    const message = container.querySelector('.home-connect-error[role="alert"]');
    expect(message?.textContent).toContain('Alpha');
    expect(message?.textContent).toContain(mocks.error);
    expect(buttons[0].disabled).toBe(false);
  });

  it('offers only current workspace tabs in the workspace menu', async () => {
    mocks.tabs = [
      tab('temporary-session', 'current', terminal('temporary-pane')),
      tab('other-workspace', 'other', terminal('other-pane')),
      tab('torn-off', 'current', terminal('torn-pane'), true),
    ];
    await render();
    expect(container.querySelector('.home-workspace-menu')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('.home-workspace')!.click());
    const tabs = container.querySelectorAll<HTMLButtonElement>('.home-workspace-menu .home-open-tabs button');
    expect([...tabs].map(button => button.textContent)).toEqual(['temporary-session']);
    await act(async () => tabs[0].click());
    expect(mocks.setActiveTabId).toHaveBeenCalledWith('temporary-session');
  });

  it('searches real host names and addresses without opening a connection', async () => {
    mocks.sessions = [
      { id: 'alpha', alias: 'Alpha', host: 'alpha.example', username: 'deploy' },
      { id: 'beta', alias: 'Beta', host: 'beta.example', username: 'ops' },
    ];
    await render();
    const input = container.querySelector<HTMLInputElement>('.home-search input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'ops@beta');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelectorAll('.home-host-row')).toHaveLength(1);
    expect(container.querySelector('.home-host-row')?.textContent).toContain('Beta');
    expect(mocks.onConnect).not.toHaveBeenCalled();
    expect(text('home-saved-count')).toBe('2');
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

  it('opens a new host configuration without starting a connection', async () => {
    const event = vi.fn();
    window.addEventListener('app:create-session', event);
    try {
      await render();
      await act(async () => container.querySelector<HTMLButtonElement>('.home-new')!.click());
      expect(event).toHaveBeenCalledTimes(1);
      expect((event.mock.calls[0][0] as CustomEvent).detail).toBe('');
      expect(mocks.onConnect).not.toHaveBeenCalled();
    } finally { window.removeEventListener('app:create-session', event); }
  });
});
