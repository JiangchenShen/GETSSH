// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './appStore';
import type { OceanSentinelStatus } from '../types/ipc';

const runtime: OceanSentinelStatus = {
  status: 'secure', daemonState: 'running', lastPing: 1760000000000,
  supervisorPid: 901, supervisedPid: 900,
  gateway: { mode: 'native', state: 'ready', lastSanitizedAt: 1760000000000, lastFailureAt: null },
  stats: { runtimeHits: 2, todayHits: 5, totalHits: 19, persistence: 'available', startedAt: 1760000000000,
    day: '2026-10-05', recordedSince: 1750000000000, lastFilteredAt: 1760000000000 },
};

beforeEach(() => {
  useAppStore.setState({ sentinelStatus: null, sentinelStatusError: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
const receive = async (status: unknown) => {
  window.electronAPI = { getSentinelStatus: vi.fn().mockResolvedValue(status) } as unknown as Window['electronAPI'];
  return useAppStore.getState().pollSentinelStatus();
};

describe('Ocean Sentinel runtime metadata validation', () => {
  it('retains confirmed counts and distinguishes unloaded persistent history from zero', async () => {
    expect(await receive(runtime)).toEqual(runtime);
    const unavailable = { ...runtime, supervisorPid: null,
      stats: { ...runtime.stats!, todayHits: null, totalHits: null, recordedSince: null, persistence: 'unavailable' } };
    expect(await receive(unavailable)).toEqual(unavailable);
    expect(useAppStore.getState().sentinelStatus?.stats?.totalHits).toBeNull();
  });

  it('accepts old daemon-only responses without inventing gateway metadata or zero counts', async () => {
    const old = { status: 'secure', lastPing: 0 };
    expect(await receive(old)).toEqual(old);
    expect(useAppStore.getState().sentinelStatus?.stats).toBeUndefined();
  });

  it.each([
    { supervisorPid: 0 }, { supervisorPid: '901' }, { supervisedPid: -1 },
    { gateway: null },
    { gateway: { ...runtime.gateway, mode: 'bypass' } },
    { gateway: { ...runtime.gateway, state: 'secure' } },
    { gateway: { ...runtime.gateway, lastSanitizedAt: 'now' } },
    { stats: null },
    { stats: { ...runtime.stats, runtimeHits: -1 } },
    { stats: { ...runtime.stats, runtimeHits: 1.5 } },
    { stats: { ...runtime.stats, todayHits: Number.NaN } },
    { stats: { ...runtime.stats, totalHits: '19' } },
    { stats: { ...runtime.stats, totalHits: 4 } },
    { stats: { ...runtime.stats, persistence: 'saved' } },
    { stats: { ...runtime.stats, day: 'today' } },
    { stats: { ...runtime.stats, lastFilteredAt: -1 } },
  ])('rejects malformed metadata and clears a stale healthy snapshot (%j)', async patch => {
    useAppStore.setState({ sentinelStatus: runtime });
    expect(await receive({ ...runtime, ...patch })).toBeNull();
    expect(useAppStore.getState().sentinelStatus).toBeNull();
    expect(useAppStore.getState().sentinelStatusError).toBe('Invalid Ocean Sentinel status response');
  });
});
