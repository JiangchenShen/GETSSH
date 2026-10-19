// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppLockState, KeystoreResult, SecurityStatus } from '../../types/ipc';
import { useAppLockStore } from '../../store/appLockStore';
import { useBackupRestartStore } from '../../store/backupStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en-US' } }) }));
vi.mock('../../store/appStore', async () => {
  const { create } = await import('zustand');
  return { useAppStore: create(() => ({ isMac: true, isAppBlurred: false, appConfig: { privacyMode: false } })) };
});
vi.mock('../../store/workspaceStore', async () => {
  const { create } = await import('zustand');
  return { useWorkspaceStore: create(() => ({ activeWorkspaceId: 'one', isSwitching: false, isVaultLocked: false,
    workspaces: [{ id: 'main', name: 'Main', themeColor: '#000' }, { id: 'one', name: 'Production', themeColor: '#000' }, { id: 'two', name: 'Lab', themeColor: '#000' }] })) };
});
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useAppStore } from '../../store/appStore';
import { MigrationPresenceNotice } from './MigrationPresenceNotice';

const ready = (): AppLockState => ({ phase: 'ready', appProtected: true, recoveryConfigured: false, presenceSupported: true, presenceEnabled: false, deviceKeyLost: false, masterPasswordMustChange: false,
  migration: { migratedWorkspaces: ['one', 'two'], deferredWorkspaces: [], presenceToReenable: ['one', 'two'], failedWorkspaces: [] } });
// The store's rule (store.rs set_presence, store.fake.js): one switch, and only an unlocked scope
// changes. Only the active workspace is unlocked here, and a locked one stays as it is with ok.
let presence: Record<string, boolean>;
const status = (): SecurityStatus => {
  const { activeWorkspaceId, isVaultLocked } = useWorkspaceStore.getState();
  return { appProtected: true, recoveryConfigured: false, presenceSupported: true, deviceBackend: null, scopes: [
    { id: 'app', workspaceId: null, protected: true, ownPassword: true, presence: !!presence.app, unlocked: true, recovery: false, revealRemainingMs: null },
    ...['one', 'two'].map(id => ({ id: `ws:${id}`, workspaceId: id, protected: true, ownPassword: true, presence: !!presence[id], unlocked: id === activeWorkspaceId && !isVaultLocked, recovery: false, revealRemainingMs: null })),
  ] };
};
const turnOn = (): KeystoreResult => {
  const { activeWorkspaceId, isVaultLocked } = useWorkspaceStore.getState();
  presence.app = true;
  if (!isVaultLocked) presence[activeWorkspaceId] = true;
  return { ok: true };
};
let root: Root;
let container: HTMLDivElement;
let setPresence: ReturnType<typeof vi.fn>;
let statusCall: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  presence = {};
  useAppStore.setState({ isAppBlurred: false, appConfig: { ...useAppStore.getState().appConfig, privacyMode: false } });
  useAppLockStore.setState({ state: ready() }); useBackupRestartStore.setState({ report: null });
  useWorkspaceStore.setState({ activeWorkspaceId: 'one', isSwitching: false, isVaultLocked: false });
  setPresence = vi.fn(async () => turnOn());
  statusCall = vi.fn(async () => status());
  window.electronAPI = { security: { setPresence, status: statusCall } } as unknown as Window['electronAPI'];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); useAppLockStore.setState({ state: null }); useBackupRestartStore.setState({ report: null }); });
const render = (suppressed = false) => act(async () => root.render(<MigrationPresenceNotice suppressed={suppressed} />));
const button = (label: string) => Array.from(container.querySelectorAll('button')).find(item => item.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
const switchTo = (workspaceId: string) => act(async () => useWorkspaceStore.setState({ activeWorkspaceId: workspaceId }));

describe('migration system-verification reminder', () => {
  it('keeps the notice below z-50 modal dialogs', async () => {
    await render();
    const layer = container.querySelector('aside')!.className.match(/\bz-(?:\[(\d+)\]|(\d+))(?:\s|$)/);
    expect(layer).not.toBeNull();
    expect(Number(layer![1] ?? layer![2])).toBeLessThan(50);
  });

  it('hides workspace names only while privacy mode blurs an unfocused app', async () => {
    await render();
    await act(async () => useAppStore.setState({ isAppBlurred: true }));
    expect(container.textContent).toContain('Production');
    await act(async () => useAppStore.setState({ appConfig: { ...useAppStore.getState().appConfig, privacyMode: true } }));
    expect(container.querySelector('aside')).toBeNull();
    expect(container.textContent).not.toContain('Production');
    await act(async () => useAppStore.setState({ isAppBlurred: false }));
    expect(container.textContent).toContain('Production');
    expect(setPresence).not.toHaveBeenCalled();
  });

  it('announces the migration explanation as a status', async () => {
    await render();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('These workspaces have their own passwords');
  });

  it('shows workspace names after unlocking and never asks for verification on its own', async () => {
    useAppLockStore.setState({ state: { ...ready(), phase: 'locked' } }); await render(); expect(container.textContent).toBe('');
    await act(async () => useAppLockStore.setState({ state: ready() }));
    expect(container.textContent).toContain('Production'); expect(container.textContent).toContain('Lab'); expect(setPresence).not.toHaveBeenCalled();
  });

  // R37: the call is one switch that returns ok for a locked workspace without changing it.
  it('turns on the active workspace only, and counts as done what security.status reports', async () => {
    await render(); await click('Enable Touch ID');
    expect(setPresence).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'one', enabled: true });
    expect(container.textContent).not.toContain('Production');
    expect(container.textContent).toContain('Lab'); expect(container.textContent).toContain('Switch to it and unlock it first');
    expect(button('Enable Touch ID').disabled).toBe(true);
  });

  it('says so when the call returns ok but the workspace is still off', async () => {
    setPresence.mockResolvedValueOnce({ ok: true }); await render(); await click('Enable Touch ID');
    expect(container.textContent).toContain('Production'); expect(container.querySelector('[role="alert"]')!.textContent).toContain('was not turned on');
    await click('Enable Touch ID'); expect(container.textContent).not.toContain('Production');
  });

  it('lets each workspace be turned on after switching to it, then goes away', async () => {
    await render(); await click('Enable Touch ID'); await switchTo('two');
    expect(button('Enable Touch ID').disabled).toBe(false);
    await click('Enable Touch ID'); expect(setPresence).toHaveBeenLastCalledWith({ workspaceId: 'two', enabled: true });
    expect(container.querySelector('aside')).toBeNull();
  });

  it('cannot turn anything on from a workspace that is not listed', async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: 'main' }); await render();
    expect(button('Enable Touch ID').disabled).toBe(true); await click('Enable Touch ID'); expect(setPresence).not.toHaveBeenCalled();
  });

  it('leaves out a workspace already turned on elsewhere', async () => {
    presence.two = true; await render();
    expect(container.textContent).toContain('Production'); expect(container.textContent).not.toContain('Lab');
  });

  it('drops a workspace turned on in Settings while the notice is on screen', async () => {
    await render(); expect(container.textContent).toContain('Production');
    presence.one = true;
    await act(async () => useAppLockStore.setState({ state: { ...ready(), presenceEnabled: true } }));
    expect(container.textContent).not.toContain('Production'); expect(setPresence).not.toHaveBeenCalled();
  });

  it('says that the master password unlock changes too, only when there is one', async () => {
    await render(); expect(container.textContent).toContain('Unlocking with the master password will use Touch ID too');
    await act(async () => useAppLockStore.setState({ state: { ...ready(), appProtected: false } }));
    expect(container.textContent).not.toContain('master password');
  });

  it('keeps dismissal for this app run across workspace changes and an app lock', async () => {
    await render(); await click('Dismiss for this run');
    await act(async () => {
      useWorkspaceStore.setState({ activeWorkspaceId: 'two' });
      useAppLockStore.setState({ state: { ...ready(), phase: 'locked' } }); useAppLockStore.setState({ state: ready() });
    });
    expect(container.querySelector('aside')).toBeNull(); expect(setPresence).not.toHaveBeenCalled();
  });

  it('treats cancellation quietly and permits a retry', async () => {
    setPresence.mockResolvedValueOnce({ ok: false, error: 'cancelled' }); await render(); await click('Enable Touch ID');
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.textContent).toContain('Production');
    await click('Enable Touch ID'); expect(setPresence).toHaveBeenCalledTimes(2); expect(container.textContent).not.toContain('Production');
  });

  it('shows a refused call', async () => {
    setPresence.mockResolvedValueOnce({ ok: false, error: 'locked' }); await render(); await click('Enable Touch ID');
    expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(container.textContent).toContain('Production');
  });

  it.each(['lock', 'lock-unlock', 'workspace-return', 'vault-lock-unlock'])('ignores a stale answer across %s', async transition => {
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
    expect(setPresence).toHaveBeenCalledTimes(1); expect(container.querySelector('[role="alert"]')).toBeNull();
    if (transition !== 'lock') { expect(container.textContent).toContain('Production'); expect(container.textContent).toContain('Lab'); }
  });

  it('stops a pending request after the notice is dismissed', async () => {
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
