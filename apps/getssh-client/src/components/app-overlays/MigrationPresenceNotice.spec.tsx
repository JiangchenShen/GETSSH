// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppLockState, KeystoreResult } from '../../types/ipc';
import { useAppLockStore } from '../../store/appLockStore';
import { useBackupRestartStore } from '../../store/backupStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en-US' } }) }));
vi.mock('../../store/appStore', () => ({ useAppStore: (select: (state: any) => any) => select({ isMac: true }) }));
vi.mock('../../store/workspaceStore', async () => {
  const { create } = await import('zustand');
  return { useWorkspaceStore: create(() => ({ activeWorkspaceId: 'one', isSwitching: false, isVaultLocked: false,
    workspaces: [{ id: 'one', name: 'Production', themeColor: '#000' }, { id: 'two', name: 'Lab', themeColor: '#000' }] })) };
});
import { useWorkspaceStore } from '../../store/workspaceStore';
import { MigrationPresenceNotice } from './MigrationPresenceNotice';

const ready = (): AppLockState => ({ phase: 'ready', appProtected: true, recoveryConfigured: false, presenceSupported: true, presenceEnabled: false, deviceKeyLost: false, masterPasswordMustChange: false,
  migration: { migratedWorkspaces: ['one', 'two'], deferredWorkspaces: [], presenceToReenable: ['one', 'two'], failedWorkspaces: [] } });
let root: Root;
let container: HTMLDivElement;
let setPresence: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useAppLockStore.setState({ state: ready() }); useBackupRestartStore.setState({ report: null });
  useWorkspaceStore.setState({ activeWorkspaceId: 'one', isSwitching: false, isVaultLocked: false });
  setPresence = vi.fn().mockResolvedValue({ ok: true });
  window.electronAPI = { security: { setPresence } } as unknown as Window['electronAPI'];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); useAppLockStore.setState({ state: null }); useBackupRestartStore.setState({ report: null }); });
const render = (suppressed = false) => act(async () => root.render(<MigrationPresenceNotice suppressed={suppressed} />));
const click = (label: string) => act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === label)!.click());

describe('migration system-verification reminder', () => {
  it('shows workspace names after unlocking and only enables them after the user chooses to', async () => {
    useAppLockStore.setState({ state: { ...ready(), phase: 'locked' } }); await render(); expect(container.textContent).toBe('');
    await act(async () => useAppLockStore.setState({ state: ready() }));
    expect(container.textContent).toContain('Production'); expect(container.textContent).toContain('Lab'); expect(setPresence).not.toHaveBeenCalled();
    await click('Enable Touch ID');
    expect(setPresence.mock.calls).toEqual([[{ workspaceId: 'one', enabled: true }], [{ workspaceId: 'two', enabled: true }]]);
    expect(container.querySelector('aside')).toBeNull();
  });

  it('waits for the previous workspace before requesting the next verification', async () => {
    let complete!: (value: KeystoreResult) => void;
    setPresence.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await render(); await click('Enable Touch ID'); expect(setPresence).toHaveBeenCalledTimes(1);
    await act(async () => complete({ ok: true }));
    expect(setPresence).toHaveBeenCalledTimes(2); expect(setPresence).toHaveBeenLastCalledWith({ workspaceId: 'two', enabled: true });
  });

  it('keeps dismissal for this app run across workspace changes and an app lock', async () => {
    await render(); await click('Dismiss for this run');
    await act(async () => {
      useWorkspaceStore.setState({ activeWorkspaceId: 'two' });
      useAppLockStore.setState({ state: { ...ready(), phase: 'locked' } }); useAppLockStore.setState({ state: ready() });
    });
    expect(container.querySelector('aside')).toBeNull(); expect(setPresence).not.toHaveBeenCalled();
  });

  it('treats cancellation quietly, stops the batch, and permits a manual retry', async () => {
    setPresence.mockResolvedValueOnce({ ok: false, error: 'cancelled' }); await render(); await click('Enable Touch ID');
    expect(setPresence).toHaveBeenCalledTimes(1); expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.textContent).toContain('Lab');
    await click('Enable Touch ID'); expect(setPresence).toHaveBeenCalledTimes(3); expect(container.querySelector('aside')).toBeNull();
  });

  it('retries a failed workspace without repeating a successful one', async () => {
    setPresence.mockResolvedValueOnce({ ok: false, error: 'locked' }); await render(); await click('Enable Touch ID');
    expect(container.textContent).toContain('Production'); expect(container.textContent).not.toContain('Lab');
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Unlock first');
    await click('Enable Touch ID'); expect(setPresence).toHaveBeenCalledTimes(3); expect(setPresence).toHaveBeenLastCalledWith({ workspaceId: 'one', enabled: true });
    expect(container.querySelector('aside')).toBeNull();
  });

  it.each(['lock', 'lock-unlock', 'workspace-return', 'vault-lock-unlock'])('does not continue a stale batch across %s', async transition => {
    let complete!: (value: KeystoreResult) => void;
    setPresence.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await render(); await click('Enable Touch ID');
    await act(async () => {
      if (transition.startsWith('lock')) {
        useAppLockStore.setState({ state: { ...ready(), phase: 'locked' } });
        if (transition === 'lock-unlock') useAppLockStore.setState({ state: ready() });
      } else if (transition === 'workspace-return') {
        useWorkspaceStore.setState({ activeWorkspaceId: 'two' }); useWorkspaceStore.setState({ activeWorkspaceId: 'one' });
      } else {
        useWorkspaceStore.setState({ isVaultLocked: true }); useWorkspaceStore.setState({ isVaultLocked: false });
      }
    });
    await act(async () => complete({ ok: true }));
    expect(setPresence).toHaveBeenCalledTimes(1);
    if (transition !== 'lock') { expect(container.textContent).toContain('Production'); expect(container.textContent).toContain('Lab'); }
  });

  it('stops pending requests after the notice is dismissed', async () => {
    let complete!: (value: KeystoreResult) => void;
    setPresence.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await render(); await click('Enable Touch ID'); await click('Dismiss for this run');
    await act(async () => complete({ ok: true })); expect(setPresence).toHaveBeenCalledTimes(1); expect(container.querySelector('aside')).toBeNull();
  });

  it('does not start verification without migration workspaces or on an unsupported device', async () => {
    useAppLockStore.setState({ state: { ...ready(), migration: undefined } }); await render(); expect(container.querySelector('aside')).toBeNull();
    await act(async () => useAppLockStore.setState({ state: { ...ready(), presenceSupported: false } }));
    expect(container.textContent).toContain('This device does not support Touch ID'); await click('Enable Touch ID'); expect(setPresence).not.toHaveBeenCalled();
  });

  it('stays hidden under the mandatory password dialog and never prompts automatically on return', async () => {
    await render(true); expect(container.querySelector('aside')).toBeNull(); await render(false);
    expect(container.textContent).toContain('Production'); expect(setPresence).not.toHaveBeenCalled();
  });
});
