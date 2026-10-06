// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OceanSentinelStatus } from '../../../types/ipc';

const mocks = vi.hoisted(() => ({
  language: 'en-US',
  status: null as OceanSentinelStatus | null,
  error: null as string | null,
  poll: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: mocks.language } }) }));
vi.mock('../../../store/appStore', () => ({ useAppStore: (select: (state: any) => any) => select({
  sentinelStatus: mocks.status, sentinelStatusError: mocks.error, pollSentinelStatus: mocks.poll,
}) }));

import { OceanSentinelRuntime } from './OceanSentinelRuntime';

const healthy = (): OceanSentinelStatus => ({
  status: 'secure', daemonState: 'running', lastPing: 1_759_680_000_000,
  supervisorPid: 123, supervisedPid: 456,
  gateway: { mode: 'native', state: 'ready', lastSanitizedAt: null, lastFailureAt: null },
  stats: { runtimeHits: 0, todayHits: 0, totalHits: 12, persistence: 'available', startedAt: 1_759_680_000_000, day: '2025-10-05', recordedSince: 1_759_593_600_000, lastFilteredAt: null },
});
let root: Root;
let container: HTMLDivElement;
let onBack = vi.fn<() => void>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 5, 10));
  mocks.language = 'en-US';
  mocks.status = healthy();
  mocks.error = null;
  mocks.poll.mockImplementation(async () => mocks.status);
  onBack = vi.fn<() => void>();
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

const render = () => act(async () => root.render(<OceanSentinelRuntime onBack={onBack} />));
const text = (id: string) => container.querySelector(`[data-testid="${id}"]`)?.textContent;
const refreshButton = () => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => /Refresh|刷新/.test(button.textContent!))!;

describe('Ocean Sentinel runtime details', () => {
  it('shows native supervision, actual zeroes, PIDs and count scope without inventing heartbeats', async () => {
    await render();
    expect(document.activeElement).toBe(container.querySelector('h2'));
    expect(text('runtime-daemon-state')).toBe('Healthy');
    expect(text('runtime-supervisor-pid')).toBe('123');
    expect(text('runtime-supervised-pid')).toBe('456');
    expect(text('sentinel-gateway-state')).toBe('Native redaction');
    expect(text('sentinel-today-hits')).toBe('0');
    expect(text('sentinel-runtime-hits')).toBe('0');
    expect(text('sentinel-total-hits')).toBe('12');
    expect(container.textContent).toContain('receipt by the supervisor is not confirmed');
    expect(container.textContent).toContain('All workspaces');
    expect(container.textContent).toContain('repeated processing counts again');
    expect(container.querySelector('dl')).toBe(container.querySelector('.security-runtime-metrics'));
    expect(container.textContent).toContain('Last hit this run');
    expect(container.textContent).toContain('Recorded since');
    expect(container.textContent).not.toContain('1970');
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('distinguishes irreversible fallback from a fault that refused unsanitized text', async () => {
    mocks.status!.gateway = { mode: 'fallback', state: 'ready', lastSanitizedAt: null, lastFailureAt: null };
    await render();
    expect(text('sentinel-gateway-state')).toBe('JS redaction fallback');
    expect(container.textContent).toContain('Irreversible JS redaction remains available');
    mocks.status = { ...mocks.status!, gateway: { ...mocks.status!.gateway!, state: 'faulted', lastFailureAt: 1_759_680_000_000 } };
    await render();
    expect(text('sentinel-gateway-state')).toBe('Sanitization failed');
    expect(container.textContent).toContain('sending unsanitized text was refused');
  });

  it('keeps unknown optional details distinct from zero and treats a zero PING timestamp as no record', async () => {
    mocks.status = { status: 'secure', lastPing: 0 };
    await render();
    expect(text('runtime-daemon-state')).toBe('Not confirmed');
    expect(text('sentinel-gateway-state')).toBe('Not confirmed');
    expect(text('runtime-supervisor-pid')).toBe('—');
    expect(text('runtime-last-ping')).toBe('No record yet');
    expect(text('sentinel-today-hits')).toBe('—');
    expect(text('sentinel-total-hits')).toBe('—');
    expect(text('sentinel-runtime-hits')).toBe('—');
    expect(container.textContent).not.toContain('1970');
  });

  it('does not turn a persistence failure into saved zeroes while retaining runtime counts', async () => {
    mocks.status!.stats = { ...mocks.status!.stats!, persistence: 'unavailable', todayHits: null, totalHits: null, runtimeHits: 7 };
    await render();
    expect(text('sentinel-today-hits')).toBe('—');
    expect(text('sentinel-total-hits')).toBe('—');
    expect(text('sentinel-runtime-hits')).toBe('7');
    expect(container.textContent!.match(/Not saved yet/g)).toHaveLength(2);
  });

  it('retains known pending counts with an unsaved notice when persistence is unavailable', async () => {
    mocks.status!.stats = { ...mocks.status!.stats!, persistence: 'unavailable', todayHits: 4, totalHits: 16, runtimeHits: 4 };
    await render();
    expect(text('sentinel-today-hits')).toBe('4');
    expect(text('sentinel-total-hits')).toBe('16');
    expect(container.textContent!.match(/Not saved yet/g)).toHaveLength(2);
  });

  it('reveals the page header when opened from a scrolled security overview', async () => {
    const main = document.createElement('main');
    main.scrollTop = 250;
    main.append(container);
    document.body.append(main);
    await render();
    expect(main.scrollTop).toBe(0);
    expect(document.activeElement).toBe(container.querySelector('h2'));
    main.remove();
  });

  it('shows busy and completed feedback for a manual refresh, without moving focus', async () => {
    let resolve!: (status: OceanSentinelStatus) => void;
    await render();
    mocks.poll.mockImplementationOnce(() => new Promise<OceanSentinelStatus>(done => { resolve = done; }));
    await act(async () => { refreshButton().focus(); refreshButton().click(); });
    expect(refreshButton().disabled).toBe(true);
    expect(refreshButton().getAttribute('aria-busy')).toBe('true');
    expect(refreshButton().textContent).toBe('Refreshing…');
    await act(async () => resolve(mocks.status!));
    expect(refreshButton().disabled).toBe(false);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Status updated');
    expect(document.activeElement).toBe(refreshButton());
  });

  it('reports failed reads and never renders previous status as fresh data', async () => {
    await render();
    mocks.error = 'No status handler registered';
    mocks.poll.mockResolvedValueOnce(null);
    await act(async () => refreshButton().click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No status handler registered');
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(text('runtime-daemon-state')).toBe('Unavailable');
    expect(text('sentinel-today-hits')).toBe('—');
    expect(refreshButton().disabled).toBe(false);
  });

  it('polls every three seconds and releases the timer on leaving the detail page', async () => {
    await render();
    expect(mocks.poll).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(6_000));
    expect(mocks.poll).toHaveBeenCalledTimes(3);
    await act(async () => root.unmount());
    await act(async () => vi.advanceTimersByTime(6_000));
    expect(mocks.poll).toHaveBeenCalledTimes(3);
    root = createRoot(container);
  });

  it('keeps the same status distinctions and actions in Chinese', async () => {
    mocks.language = 'zh-CN';
    mocks.status!.gateway = { mode: 'fallback', state: 'ready', lastSanitizedAt: null, lastFailureAt: null };
    await render();
    expect(container.querySelector('h2')?.textContent).toBe('运行详情');
    expect(text('runtime-daemon-state')).toBe('运行正常');
    expect(text('sentinel-gateway-state')).toBe('JS 脱敏兜底');
    expect(container.textContent).toContain('不可逆 JS 脱敏');
    expect(container.textContent).toContain('重复处理会再次累计');
    expect(container.querySelector('button')?.textContent).toContain('返回安全总览');
  });
});
