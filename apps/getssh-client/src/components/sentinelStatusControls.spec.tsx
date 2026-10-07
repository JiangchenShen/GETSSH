// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import type { OceanSentinelStatus } from '../types/ipc';
import enUS from '../locales/en-US.json';
import zhCN from '../locales/zh-CN.json';

vi.mock('../store/cryptoStore', () => ({ useCryptoStore: (select: (state: any) => any) => select({ workspaceUnprotected: false }) }));
vi.mock('../store/workspaceStore', () => ({ useWorkspaceStore: (select: (state: any) => any) => select({ activeWorkspaceId: 'test', workspaces: [{ id: 'test', name: 'Test workspace' }] }) }));
vi.mock('./secure-center/tabs/SafeStorageTab', () => ({ SafeStorageTab: () => null }));
vi.mock('./secure-center/tabs/KnownHostsTab', () => ({ KnownHostsTab: () => null }));

import { useAppStore } from '../store/appStore';
import { SecurityTab } from './settings/tabs/SecurityTab';

const healthy: OceanSentinelStatus = { status: 'secure', lastPing: 1728000000000, daemonState: 'running' };
let root: Root;
let container: HTMLDivElement;
let query: ReturnType<typeof vi.fn>;
let pending: Array<(value: OceanSentinelStatus) => void>;
const translations = i18next.createInstance();
const deferred = () => {
  let resolve!: (value: OceanSentinelStatus) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<OceanSentinelStatus>((done, fail) => { resolve = done; reject = fail; });
  pending.push(resolve);
  return { promise, resolve, reject };
};

beforeAll(async () => {
  await translations.use(initReactI18next).init({ resources: { 'en-US': enUS, 'zh-CN': zhCN }, lng: 'en-US', fallbackLng: 'en-US', interpolation: { escapeValue: false } });
});
beforeEach(async () => {
  await translations.changeLanguage('en-US');
  pending = [];
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  query = vi.fn().mockResolvedValue(healthy);
  window.electronAPI = {
    getSentinelStatus: query,
    getKnownHosts: vi.fn().mockResolvedValue([]),
    security: { status: vi.fn().mockResolvedValue({
      appProtected: true, recoveryConfigured: true, presenceSupported: false, deviceBackend: 'test',
      scopes: [{ id: 'workspace/test', workspaceId: 'test', protected: true, ownPassword: false, presence: false, unlocked: true, recovery: false, revealRemainingMs: null }],
    }) },
  } as unknown as Window['electronAPI'];
  useAppStore.setState({ sentinelStatus: null, sentinelStatusError: null, isConfigLoaded: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    for (const finish of pending) finish(healthy);
    await Promise.resolve();
  });
  container.remove();
  vi.restoreAllMocks();
});

const click = (element: HTMLElement) => act(async () => element.click());
const openSentinel = async () => {
  await act(async () => root.render(<I18nextProvider i18n={translations}><SecurityTab /></I18nextProvider>));
  const brand = translations.language.startsWith('zh') ? '海洋守护中心' : 'Ocean Sentinel';
  const details = translations.language.startsWith('zh') ? '查看进程监护详情' : 'View supervisor details';
  await click(container.querySelector<HTMLButtonElement>(`button[aria-label="${details}"]`)!);
  return container.querySelector<HTMLElement>(`section[aria-label="${brand}"]`)!;
};
const refresh = (detail: HTMLElement) => Array.from(detail.querySelectorAll<HTMLButtonElement>('button')).find(button => /Refresh status|Refreshing…|刷新状态|正在刷新…/.test(button.textContent || ''))!;

describe('Ocean Sentinel polling store', () => {
  it('clears stale secure state when the IPC API is absent', async () => {
    useAppStore.setState({ sentinelStatus: healthy });
    window.electronAPI = {} as Window['electronAPI'];
    expect(await useAppStore.getState().pollSentinelStatus()).toBeNull();
    expect(useAppStore.getState().sentinelStatus).toBeNull();
    expect(useAppStore.getState().sentinelStatusError).toEqual(expect.any(String));
  });

  it('clears stale secure state on rejection and clears the error after retry', async () => {
    useAppStore.setState({ sentinelStatus: healthy });
    query.mockRejectedValueOnce(new Error('No status handler registered'));
    expect(await useAppStore.getState().pollSentinelStatus()).toBeNull();
    expect(useAppStore.getState().sentinelStatus).toBeNull();
    expect(useAppStore.getState().sentinelStatusError).toContain('No status handler registered');
    expect(await useAppStore.getState().pollSentinelStatus()).toEqual(healthy);
    expect(useAppStore.getState().sentinelStatus).toEqual(healthy);
    expect(useAppStore.getState().sentinelStatusError).toBeNull();
  });

  it.each([
    null,
    { success: false, error: 'not available' },
    { status: 'unknown', lastPing: 1 },
    { status: 'secure', lastPing: 'invalid' },
    { status: 'secure', lastPing: Number.NaN },
    { status: 'secure', lastPing: 1, daemonState: 'paused' },
  ])('does not preserve healthy state for invalid responses (%j)', async value => {
    useAppStore.setState({ sentinelStatus: healthy });
    query.mockResolvedValueOnce(value);
    expect(await useAppStore.getState().pollSentinelStatus()).toBeNull();
    expect(useAppStore.getState().sentinelStatus).toBeNull();
    expect(useAppStore.getState().sentinelStatusError).toEqual(expect.any(String));
  });

  it('shares one pending request between automatic and manual callers', async () => {
    const request = deferred();
    query.mockReturnValueOnce(request.promise);
    const automatic = useAppStore.getState().pollSentinelStatus();
    const manual = useAppStore.getState().pollSentinelStatus();
    expect(query).toHaveBeenCalledTimes(1);
    request.resolve(healthy);
    expect(await Promise.all([automatic, manual])).toEqual([healthy, healthy]);
  });
});

describe('Ocean Sentinel status controls', () => {
  it.each([
    ['en-US', 'Refreshing…', 'Status updated · ', 'Ocean Sentinel'],
    ['zh-CN', '正在刷新…', '状态已更新 · ', '海洋守护中心'],
  ])('shows pending and completed refresh feedback in %s', async (locale, loading, updated, brand) => {
    await translations.changeLanguage(locale);
    const detail = await openSentinel();
    expect(detail).not.toBeNull();
    expect(detail.getAttribute('aria-label')).toBe(brand);
    const request = deferred();
    query.mockReturnValueOnce(request.promise);
    await click(refresh(detail));
    const button = refresh(detail);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe(loading);
    await click(button);
    expect(query).toHaveBeenCalledTimes(3); // overview poll, detail-page poll, then the user's one request
    await act(async () => request.resolve(healthy));
    expect(refresh(detail).disabled).toBe(false);
    const status = Array.from(detail.querySelectorAll('[role="status"]')).find(element => element.textContent?.startsWith(updated));
    expect(status?.textContent?.length).toBeGreaterThan(updated.length);
    expect(detail.querySelector('[role="alert"]')).toBeNull();
  });

  it('replaces old healthy text with a visible error and lets the user retry', async () => {
    const detail = await openSentinel();
    expect(detail.textContent).toContain('Healthy');
    query.mockRejectedValueOnce(new Error('Supervisor IPC failed'));
    await click(refresh(detail));
    expect(useAppStore.getState().sentinelStatus).toBeNull();
    expect(detail.textContent).not.toContain('Healthy');
    expect(detail.querySelector('[role="alert"]')?.textContent).toContain('Supervisor IPC failed');
    expect(refresh(detail).disabled).toBe(false);
    await click(refresh(detail));
    expect(detail.querySelector('[role="alert"]')).toBeNull();
    expect(detail.textContent).toContain('Healthy');
    expect(detail.querySelector('[role="status"]')?.textContent).toContain('Status updated · ');
  });

  it.each([
    ['unavailable', { status: 'warning', lastPing: 0, daemonState: 'unavailable' }, 'Unavailable'],
    ['disabled daemon', { status: 'secure', lastPing: 0, daemonState: 'disabled' }, 'Disabled'],
    ['disabled flag', { status: 'secure', lastPing: 0, daemonState: 'running', sentinelDisabled: true }, 'Disabled'],
    ['starting', { status: 'secure', lastPing: 0, daemonState: 'starting' }, 'Connecting to supervisor'],
    ['unknown daemon', { status: 'secure', lastPing: 0 }, ''],
  ])('does not claim healthy when the supervisor is %s', async (_case, value, label) => {
    query.mockResolvedValue(value);
    const detail = await openSentinel();
    expect(detail.textContent).not.toContain('Healthy');
    expect(container.textContent).not.toContain('Healthy');
    if (label) expect(detail.textContent).toContain(label);
  });

  it('names an unavailable supervisor in Chinese', async () => {
    await translations.changeLanguage('zh-CN');
    query.mockResolvedValue({ status: 'warning', lastPing: 0, daemonState: 'unavailable' });
    const detail = await openSentinel();
    expect(detail.getAttribute('aria-label')).toBe('海洋守护中心');
    expect(detail.textContent).toContain('不可用');
    expect(detail.textContent).not.toContain('正常');
  });

  it('opens a distinct runtime page and returns focus to the remounted overview entry', async () => {
    vi.mocked(HTMLElement.prototype.focus).mockRestore();
    await act(async () => root.render(<I18nextProvider i18n={translations}><SecurityTab /></I18nextProvider>));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="View supervisor details"]')!;
    trigger.focus();
    await click(trigger);
    expect(container.querySelector('[role="region"][aria-label="Security overview"]')).toBeNull();
    const heading = Array.from(container.querySelectorAll('h2')).find(element => element.textContent === 'Runtime details');
    expect(document.activeElement).toBe(heading);
    const back = Array.from(container.querySelectorAll('button')).find(element => element.textContent?.includes('Back to security overview'))!;
    await click(back);
    expect(container.querySelector('[role="region"][aria-label="Security overview"]')).not.toBeNull();
    expect(document.activeElement).toBe(container.querySelector('button[aria-label="View supervisor details"]'));
    expect(trigger.isConnected).toBe(false);
  });
});
