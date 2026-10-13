// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcManager } from './IpcManager';
import { useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAppLockStore } from '../store/appLockStore';

let root: Root;
let container: HTMLDivElement;
let fingerprint!: (payload: { host: string; username: string; osType: string }) => void;
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  useAppLockStore.setState({ state: { phase: 'ready', appProtected: false, presenceSupported: false, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false } });
  useWorkspaceStore.setState({ activeWorkspaceId: 'default', isSwitching: false, isVaultLocked: false });
  useSessionStore.setState({ sessions: [
    { id: 'one', host: 'one.example', username: 'operator' },
    { id: 'two', host: 'two.example', username: 'operator' },
    { id: 'draft', host: 'new.example', username: 'operator', isDraft: true },
  ], profilesWorkspaceId: 'default' });
  window.electronAPI = {
    onOsFingerprint: vi.fn(callback => { fingerprint = callback; return () => {}; }),
    saveProfiles: vi.fn().mockResolvedValue(true),
  } as unknown as Window['electronAPI'];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<IpcManager />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
const detect = () => act(async () => fingerprint({ host: 'one.example', username: 'operator', osType: 'ubuntu' }));
const persist = () => act(async () => vi.advanceTimersByTime(50));

describe('detected OS whole-list persistence', () => {
  it('saves the complete hydrated list with detected OS metadata and excludes drafts', async () => {
    await detect(); expect(window.electronAPI.saveProfiles).not.toHaveBeenCalled();
    await persist();
    expect(window.electronAPI.saveProfiles).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'default', payload: [
      expect.objectContaining({ id: 'one', osType: 'ubuntu' }), expect.objectContaining({ id: 'two' }),
    ] });
  });
  it('does not save an emptied list if switching starts during the 50ms delay before the ID changes', async () => {
    await detect();
    await act(async () => {
      vi.advanceTimersByTime(25);
      useWorkspaceStore.setState({ isSwitching: true });
      useSessionStore.getState().replaceSessions([], null);
    });
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('default');
    await persist(); expect(window.electronAPI.saveProfiles).not.toHaveBeenCalled();
  });
  it.each(['unhydrated', 'workspace-locked', 'app-locked', 'another-workspace'] as const)('refuses a delayed write when %s', async reason => {
    await detect();
    await act(async () => {
      if (reason === 'unhydrated') useSessionStore.setState({ profilesWorkspaceId: null });
      if (reason === 'workspace-locked') useWorkspaceStore.setState({ isVaultLocked: true });
      if (reason === 'app-locked') useAppLockStore.setState({ state: { ...useAppLockStore.getState().state!, phase: 'locked' } });
      if (reason === 'another-workspace') useWorkspaceStore.setState({ activeWorkspaceId: 'other' });
    });
    await persist(); expect(window.electronAPI.saveProfiles).not.toHaveBeenCalled();
  });
});
