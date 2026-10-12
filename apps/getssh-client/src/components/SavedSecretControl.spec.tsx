// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppLockState, SecurityStatus } from '../types/ipc';
import { useAppLockStore } from '../store/appLockStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en-US' } }) }));
vi.mock('../store/appStore', () => ({ useAppStore: (select: (state: any) => any) => select({ isMac: true }) }));
vi.mock('../store/workspaceStore', async () => {
  const { create } = await import('zustand');
  return { useWorkspaceStore: create(() => ({ activeWorkspaceId: 'current', isSwitching: false, isVaultLocked: false })) };
});
import { useWorkspaceStore } from '../store/workspaceStore';
import { SavedSecretControl } from './SavedSecretControl';

const ready = (): AppLockState => ({ phase: 'ready', appProtected: false, presenceSupported: true, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false });
const metadata = (appProtected = false, ownPassword = false): SecurityStatus => ({ appProtected, recoveryConfigured: false, presenceSupported: true, deviceBackend: null, scopes: [{ id: 'ws:current', workspaceId: 'current', ownPassword, protected: appProtected || ownPassword, presence: true, unlocked: true, recovery: false, revealRemainingMs: null }] });
let root: Root;
let container: HTMLDivElement;
let open: ReturnType<typeof vi.fn>;
let show: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;
let status: ReturnType<typeof vi.fn>;
const onClear = vi.fn();
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks();
  open = vi.fn().mockResolvedValue({ ok: true }); show = vi.fn().mockResolvedValue({ ok: true }); close = vi.fn().mockResolvedValue({ ok: true }); status = vi.fn().mockResolvedValue(metadata());
  useAppLockStore.setState({ state: ready() }); useWorkspaceStore.setState({ activeWorkspaceId: 'current', isSwitching: false, isVaultLocked: false });
  window.electronAPI = { store: { reveal: { open, show, close } }, security: { status } } as unknown as Window['electronAPI'];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); useAppLockStore.setState({ state: null }); });
const render = async (profileId = 'server', field: 'password' | 'passphrase' = 'password') => act(async () => root.render(<SavedSecretControl workspaceId="current" profileId={profileId} field={field} onClear={onClear} />));
const click = async (text: string) => act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === text)!.click());
const input = async (value: string) => act(async () => {
  const field = container.querySelector('input')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('saved-secret system viewing', () => {
  it('opens with presence before showing the password in the system dialog and closes on leaving', async () => {
    await render(); await click('View password');
    expect(open).toHaveBeenCalledWith({ workspaceId: 'current', method: 'presence' });
    expect(show).toHaveBeenCalledWith({ workspaceId: 'current', profileId: 'server', field: 'password', language: 'en-US' });
    expect(open.mock.invocationCallOrder[0]).toBeLessThan(show.mock.invocationCallOrder[0]);
    await act(async () => root.render(null)); expect(close).toHaveBeenCalledWith({ workspaceId: 'current' });
  });

  it.each([{ appProtected: true, ownPassword: false, label: 'Master password' }, { appProtected: false, ownPassword: true, label: 'Workspace password' }])('falls back to $label and supports retrying a wrong password', async ({ appProtected, ownPassword, label }) => {
    status.mockResolvedValue(metadata(appProtected, ownPassword));
    open.mockResolvedValueOnce({ ok: false, error: 'unavailable' }).mockResolvedValueOnce({ ok: false, error: 'wrong_password' }).mockResolvedValue({ ok: true });
    await render(); await click('View password'); expect(container.textContent).toContain(label);
    await input('wrong typed verification'); await click('Verify & view'); expect(container.textContent).toContain('Incorrect password'); expect(show).not.toHaveBeenCalled();
    await input('typed verification only'); await click('Verify & view');
    expect(open).toHaveBeenLastCalledWith({ workspaceId: 'current', method: 'password', password: 'typed verification only' });
    expect(show).toHaveBeenCalledTimes(1); expect(container.querySelector('input')).toBeNull();
  });

  it('offers an explicit password route without starting a presence prompt', async () => {
    status.mockResolvedValue(metadata(true)); await render(); await click('Verify with a password');
    expect(open).not.toHaveBeenCalled(); expect(container.textContent).toContain('Master password');
    await input('typed verification only'); await click('Verify & view');
    expect(open).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current', method: 'password', password: 'typed verification only' });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('never offers password input for a workspace with neither a master nor an own password', async () => {
    open.mockResolvedValue({ ok: false, error: 'unavailable' }); await render(); await click('View password');
    expect(container.querySelector('input')).toBeNull(); expect(container.textContent).not.toContain('Verify with a password'); expect(container.textContent).toContain('Touch ID');
  });

  it('treats cancelled presence as quiet and still offers confirmed password verification', async () => {
    status.mockResolvedValue(metadata(true)); open.mockResolvedValue({ ok: false, error: 'cancelled' });
    await render(); await click('View password'); expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.querySelector('input')).not.toBeNull();
  });

  it('shows a readable rate limit and does not expose the raw code', async () => {
    open.mockResolvedValue({ ok: false, error: 'rate_limited', retryAfterMs: 2500 }); await render(); await click('View password');
    expect(container.textContent).toContain('3 seconds'); expect(container.textContent).not.toContain('rate_limited'); expect(show).not.toHaveBeenCalled();
  });

  it('reopens an expired reveal window once, then shows the selected profile again', async () => {
    show.mockResolvedValueOnce({ ok: false, error: 'locked' }).mockResolvedValue({ ok: true });
    await render(); await click('View password'); expect(open).toHaveBeenCalledTimes(2); expect(show).toHaveBeenCalledTimes(2);
    show.mockResolvedValue({ ok: false, error: 'locked' }); await click('View password');
    expect(open).toHaveBeenCalledTimes(4); expect(show).toHaveBeenCalledTimes(4);
  });

  it('stops quietly when the show call reports unauthorized', async () => {
    show.mockResolvedValue({ ok: false, error: 'unauthorized' }); await render(); await click('View password');
    expect(open).toHaveBeenCalledTimes(1); expect(show).toHaveBeenCalledTimes(1); expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('removes the password option when its route is no longer valid', async () => {
    status.mockResolvedValue(metadata(true)); open.mockResolvedValueOnce({ ok: false, error: 'unavailable' }).mockResolvedValue({ ok: false, error: 'invalid_argument' });
    await render(); await click('View password'); await input('typed verification'); await click('Verify & view');
    expect(container.querySelector('input')).toBeNull(); expect(container.textContent).toContain('no password for verification'); expect(container.textContent).not.toContain('invalid_argument');
  });

  it('uses passphrase field and routes clear through the form callback', async () => {
    await render('key-server', 'passphrase'); await click('View passphrase');
    expect(show).toHaveBeenCalledWith({ workspaceId: 'current', profileId: 'key-server', field: 'passphrase', language: 'en-US' });
    await click('Clear saved passphrase'); expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale open after profile selection changed and closes its late grant', async () => {
    let resolve!: (value: { ok: true }) => void; open.mockImplementation(() => new Promise(result => { resolve = result; }));
    await render(); await click('View password'); await render('other-server'); await act(async () => resolve({ ok: true }));
    expect(show).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledWith({ workspaceId: 'current' });
  });

  it.each(['lock', 'lock-unlock', 'workspace', 'workspace-return'])('rejects stale authentication across %s', async transition => {
    let resolve!: (value: { ok: true }) => void; open.mockImplementation(() => new Promise(result => { resolve = result; }));
    await render(); await click('View password');
    await act(async () => {
      if (transition.startsWith('lock')) {
        useAppLockStore.setState({ state: { ...ready(), phase: 'locked' } }); if (transition === 'lock-unlock') useAppLockStore.setState({ state: ready() });
      } else {
        useWorkspaceStore.setState({ activeWorkspaceId: 'other' }); if (transition === 'workspace-return') useWorkspaceStore.setState({ activeWorkspaceId: 'current' });
      }
    });
    await act(async () => resolve({ ok: true })); expect(show).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledWith({ workspaceId: 'current' });
  });

  it('closes a late grant after leaving the page and never shows a secret', async () => {
    let resolve!: (value: { ok: true }) => void; open.mockImplementation(() => new Promise(result => { resolve = result; }));
    await render(); await click('View password'); await act(async () => root.render(null)); await act(async () => resolve({ ok: true }));
    expect(show).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(2);
  });

  it('does not reopen a stale system dialog after changing profiles', async () => {
    let resolve!: (value: { ok: false; error: 'locked' }) => void;
    show.mockImplementation(() => new Promise(result => { resolve = result; }));
    await render(); await click('View password'); await render('other-server');
    await act(async () => resolve({ ok: false, error: 'locked' }));
    expect(open).toHaveBeenCalledTimes(1); expect(show).toHaveBeenCalledTimes(1); expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('serializes a late old grant and cleanup before a new profile can open its shared grant', async () => {
    let finishOld!: (value: { ok: true }) => void;
    let finishNew!: () => void;
    let granted = false;
    const events: string[] = [];
    open.mockImplementationOnce(() => { events.push('open:old'); return new Promise(result => { finishOld = result; }); });
    open.mockImplementation(async () => { granted = true; events.push('open:new'); return { ok: true }; });
    close.mockImplementation(async () => { granted = false; events.push('close'); return { ok: true }; });
    show.mockImplementation(() => {
      events.push('show:new');
      return new Promise(result => { finishNew = () => result(granted ? { ok: true } : { ok: false, error: 'locked' }); });
    });
    await render(); await click('View password'); await render('other-server'); await click('View password');
    expect(open).toHaveBeenCalledTimes(1); expect(show).not.toHaveBeenCalled();
    await act(async () => { granted = true; finishOld({ ok: true }); });
    expect(events).toEqual(['open:old', 'close', 'close', 'open:new', 'show:new']);
    expect(show).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current', profileId: 'other-server', field: 'password', language: 'en-US' });
    await act(async () => finishNew());
    expect(open).toHaveBeenCalledTimes(2); expect(show).toHaveBeenCalledTimes(1); expect(events.at(-1)).toBe('close');
  });
});
