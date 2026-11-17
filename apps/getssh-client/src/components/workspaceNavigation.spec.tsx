// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setIsCommandCenterOpen: vi.fn(),
  pollSentinelStatus: vi.fn(),
  sentinelStatusError: null as string | null,
  phase: 'ready',
  isVaultLocked: false,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string) => ({
    'statusBar.commandCenter': '指令中心',
    'statusBar.ai': 'AI',
    'statusBar.workspace': '工作区',
    'statusBar.plugins': '插件',
    'statusBar.settings': '设置',
    'statusBar.secure': '海洋守护中心',
    'welcome.home.supervisorRunning': '运行正常',
    'welcome.home.supervisorUnavailable': '无法连接',
    'welcome.home.unconfirmed': '尚未确认',
  } as Record<string, string>)[key] || key,
}) }));
vi.mock('../store/appStore', () => ({ useAppStore: (select: (state: any) => any) => select({
  isMac: true,
  setIsCommandCenterOpen: mocks.setIsCommandCenterOpen,
  sentinelStatus: { status: 'secure', daemonState: 'running', sentinelDisabled: false },
  sentinelStatusError: mocks.sentinelStatusError,
  pollSentinelStatus: mocks.pollSentinelStatus,
}) }));
vi.mock('../store/appLockStore', () => ({ useAppLockStore: (select: (state: any) => any) => select({
  state: { phase: mocks.phase },
}) }));
vi.mock('../store/workspaceStore', () => ({ useWorkspaceStore: (select: (state: any) => any) => select({
  workspaces: [],
  activeWorkspaceId: 'default',
  isVaultLocked: mocks.isVaultLocked,
}) }));

import { StatusBar } from './StatusBar';

let root: Root;
let container: HTMLDivElement;
const destination = vi.fn();
const receiveDestination = (event: Event) => destination((event as CustomEvent).detail);
const button = (label: string) => Array.from(container.querySelectorAll('button')).find(item => item.title === label)!;
const click = async (element: HTMLElement) => act(async () => element.click());

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.sentinelStatusError = null;
  mocks.phase = 'ready';
  mocks.isVaultLocked = false;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.addEventListener('app:open-center', receiveDestination);
  await act(async () => root.render(<StatusBar />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  window.removeEventListener('app:open-center', receiveDestination);
  container.remove();
});

describe('status bar workspace navigation', () => {
  it('keeps a visible, focusable workspace button that opens the dedicated overview', async () => {
    const control = button('工作区');
    expect(control).toBeDefined();
    expect(control.textContent).toBe('工作区');
    expect(control.type).toBe('button');
    expect(control.closest('.opacity-0, .hidden')).toBeNull();
    control.focus();
    expect(document.activeElement).toBe(control);
    await click(control);
    expect(destination).toHaveBeenCalledExactlyOnceWith({ type: 'workspace', title: '工作区', workspacePage: 'all' });
  });

  it('retains the command center action', async () => {
    await click(button('指令中心'));
    expect(mocks.setIsCommandCenterOpen).toHaveBeenCalledExactlyOnceWith(true);
    expect(destination).not.toHaveBeenCalled();
  });

  it.each([
    ['AI', 'ai'],
    ['插件', 'plugin'],
    ['设置', 'settings'],
  ])('retains the %s destination', async (label, type) => {
    await click(button(label));
    expect(destination).toHaveBeenCalledExactlyOnceWith({ type, title: label });
    expect(mocks.setIsCommandCenterOpen).not.toHaveBeenCalled();
  });

  it('routes Ocean Sentinel to security settings', async () => {
    const control = () => container.querySelector<HTMLButtonElement>('.workspace-rail-sentinel')!;
    expect(control().getAttribute('aria-label')).toBe('海洋守护中心 · 运行正常');
    expect(control().dataset.tone).toBe('ok');
    expect(mocks.pollSentinelStatus).toHaveBeenCalledTimes(1);
    await click(control());
    expect(destination).toHaveBeenCalledExactlyOnceWith({ type: 'settings', title: '设置', settingsTab: 'Security' });
  });

  it('replaces a stale healthy shield when status fails or the workspace locks', async () => {
    mocks.sentinelStatusError = 'Unavailable';
    await act(async () => root.render(<StatusBar />));
    const control = container.querySelector<HTMLButtonElement>('.workspace-rail-sentinel')!;
    expect(control.dataset.tone).toBe('warn');
    expect(control.getAttribute('aria-label')).toBe('海洋守护中心 · 无法连接');

    mocks.isVaultLocked = true;
    await act(async () => root.render(<StatusBar />));
    expect(control.dataset.tone).toBe('neutral');
    expect(control.getAttribute('aria-label')).toBe('海洋守护中心 · 尚未确认');
    expect(mocks.pollSentinelStatus).toHaveBeenCalledTimes(1);
  });
});
