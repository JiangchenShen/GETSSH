// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppLockState } from '../../types/ipc';
import { useAppLockStore } from '../../store/appLockStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en-US' } }) }));
import { ForceMasterPasswordChange } from './ForceMasterPasswordChange';

const ready = (mustChange = true): AppLockState => ({ phase: 'ready', appProtected: true, presenceSupported: false, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: mustChange });
let root: Root;
let container: HTMLDivElement;
let setMasterPassword: ReturnType<typeof vi.fn>;
let getState: ReturnType<typeof vi.fn>;
let setupRecovery: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  setMasterPassword = vi.fn().mockResolvedValue({ ok: true, recoveryReset: false });
  setupRecovery = vi.fn().mockResolvedValue({ ok: true, code: 'NEW-RECOVERY-CODE' });
  getState = vi.fn().mockResolvedValue(ready(false));
  window.electronAPI = { security: { setMasterPassword, setupRecovery }, appLock: { getState } } as unknown as Window['electronAPI'];
  useAppLockStore.setState({ state: ready() });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); useAppLockStore.setState({ state: null }); });
const render = async () => act(async () => root.render(<StrictMode><ForceMasterPasswordChange /></StrictMode>));
const input = async (index: number, value: string) => act(async () => {
  const field = container.querySelectorAll('input')[index];
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
});
const submit = async () => act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const fill = async (password = 'new secure master') => { await input(0, 'elevenchars'); await input(1, password); await input(2, password); };

describe('mandatory master password update', () => {
  it('opens after password unlock, traps focus, and ignores Escape and backdrop clicks', async () => {
    useAppLockStore.setState({ state: { ...ready(false), phase: 'locked' } });
    await render(); expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => useAppLockStore.setState({ state: ready() }));
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull(); expect(document.activeElement).toBe(container.querySelector('input'));
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => document.dispatchEvent(escape)); expect(escape.defaultPrevented).toBe(true);
    await act(async () => dialog.parentElement!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    const last = container.querySelector('button')!;
    await act(async () => { last.focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(container.querySelector('input'));
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(last);
    expect(Array.from(container.querySelectorAll('button')).some(button => /cancel|close/i.test(button.textContent!))).toBe(false);
  });

  it('validates length and repeat input before calling the API', async () => {
    await render(); await fill('too short'); await submit(); expect(setMasterPassword).not.toHaveBeenCalled();
    expect(container.textContent).toContain('at least 12 characters');
    await input(1, 'new secure master'); await input(2, 'different secure'); await submit();
    expect(setMasterPassword).not.toHaveBeenCalled(); expect(container.textContent).toContain('do not match');
  });

  it('keeps the form open after a wrong password and refreshes state after success', async () => {
    setMasterPassword.mockResolvedValueOnce({ ok: false, error: 'wrong_password' });
    await render(); await fill(); await submit(); expect(container.textContent).toContain('Incorrect password');
    expect(getState).not.toHaveBeenCalled(); await submit();
    expect(setMasterPassword).toHaveBeenLastCalledWith({ currentPassword: 'elevenchars', password: 'new secure master' });
    expect(getState).toHaveBeenCalledTimes(1); expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(useAppLockStore.getState().state?.masterPasswordMustChange).toBe(false);
  });

  it('retains the invalidated-code notice when an early broadcast clears the flag, then saves a new code', async () => {
    setMasterPassword.mockImplementation(async () => {
      useAppLockStore.setState({ state: ready(false) });
      return { ok: true, recoveryReset: true };
    });
    await render(); await fill(); await submit();
    expect(container.textContent).toContain('old recovery code no longer works');
    expect(container.querySelector('input')?.value).toBe('');
    await input(0, 'new secure master'); await submit();
    expect(setupRecovery).toHaveBeenCalledWith({ currentPassword: 'new secure master' });
    expect(container.textContent).toContain('NEW-RECOVERY-CODE');
    const done = container.querySelector('button')!; expect(done.disabled).toBe(true);
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await act(async () => done.click()); expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('allows an explicit recovery-code deferral only after the password was changed', async () => {
    setMasterPassword.mockResolvedValue({ ok: true, recoveryReset: true });
    await render(); expect(container.textContent).not.toContain('Create later');
    await fill(); await submit();
    const later = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Create later')!;
    await act(async () => later.click()); expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(setupRecovery).not.toHaveBeenCalled();
  });

  it('keeps the recovery notice and generated code if a state refresh returns null', async () => {
    setMasterPassword.mockResolvedValue({ ok: true, recoveryReset: true }); getState.mockResolvedValue(null);
    await render(); await fill(); await submit();
    expect(container.textContent).toContain('old recovery code no longer works');
    expect(useAppLockStore.getState().state).not.toBeNull();
    await input(0, 'new secure master'); await submit();
    expect(container.textContent).toContain('NEW-RECOVERY-CODE'); expect(container.textContent).toContain('save it now');
    expect(useAppLockStore.getState().state).not.toBeNull();
  });

  it('retries only the state read if the password update succeeded but refreshing failed', async () => {
    getState.mockRejectedValueOnce(new Error('Unavailable'));
    await render(); await fill(); await submit(); expect(container.textContent).toContain('Master password updated');
    await act(async () => container.querySelector('button')!.click());
    expect(setMasterPassword).toHaveBeenCalledTimes(1); expect(getState).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each([false, true])('ignores a late password-change reply after a lock transition (unlock again=%s)', async unlockAgain => {
    let resolve!: (value: { ok: true; recoveryReset: boolean }) => void;
    setMasterPassword.mockImplementation(() => new Promise(result => { resolve = result; }));
    await render(); await fill(); await submit();
    const newer: AppLockState = unlockAgain ? { ...ready(), recoveryConfigured: true } : { ...ready(false), phase: 'locked' };
    await act(async () => {
      useAppLockStore.setState({ state: { ...ready(false), phase: 'locked' } });
      if (unlockAgain) useAppLockStore.setState({ state: newer });
    });
    await act(async () => resolve({ ok: true, recoveryReset: true }));
    expect(useAppLockStore.getState().state).toEqual(newer); expect(getState).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('old recovery code no longer works');
    if (unlockAgain) expect(Array.from(container.querySelectorAll('input')).every(field => field.value === '')).toBe(true);
  });

  it.each([
    { recoveryReset: false, unlockAgain: false }, { recoveryReset: false, unlockAgain: true },
    { recoveryReset: true, unlockAgain: false }, { recoveryReset: true, unlockAgain: true },
  ])('ignores stale ready state after password change ($recoveryReset recoveryReset, $unlockAgain unlock again)', async ({ recoveryReset, unlockAgain }) => {
    let resolve!: (value: AppLockState) => void;
    setMasterPassword.mockResolvedValue({ ok: true, recoveryReset });
    getState.mockImplementation(() => new Promise(result => { resolve = result; }));
    await render(); await fill(); await submit(); expect(getState).toHaveBeenCalledTimes(1);
    const newer: AppLockState = unlockAgain ? { ...ready(), recoveryConfigured: true } : { ...ready(false), phase: 'locked' };
    await act(async () => {
      useAppLockStore.setState({ state: { ...ready(false), phase: 'locked' } });
      if (unlockAgain) useAppLockStore.setState({ state: newer });
    });
    await act(async () => resolve(ready(false)));
    expect(useAppLockStore.getState().state).toEqual(newer);
    if (unlockAgain) expect(container.textContent).toContain('Change your master password');
    else expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each([false, true])('ignores a late recovery-code reply after a lock transition (unlock again=%s)', async unlockAgain => {
    let resolve!: (value: { ok: true; code: string }) => void;
    setMasterPassword.mockResolvedValue({ ok: true, recoveryReset: true });
    setupRecovery.mockImplementation(() => new Promise(result => { resolve = result; }));
    await render(); await fill(); await submit(); await input(0, 'new secure master'); await submit();
    const newer: AppLockState = unlockAgain ? { ...ready(), recoveryConfigured: true } : { ...ready(false), phase: 'locked' };
    await act(async () => {
      useAppLockStore.setState({ state: { ...ready(false), phase: 'locked' } });
      if (unlockAgain) useAppLockStore.setState({ state: newer });
    });
    await act(async () => resolve({ ok: true, code: 'STALE-RECOVERY-CODE' }));
    expect(useAppLockStore.getState().state).toEqual(newer); expect(getState).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('STALE-RECOVERY-CODE');
  });

  it.each([false, true])('ignores a late state refresh after recovery-code generation (unlock again=%s)', async unlockAgain => {
    let resolve!: (value: AppLockState) => void;
    setMasterPassword.mockResolvedValue({ ok: true, recoveryReset: true });
    getState.mockResolvedValueOnce(ready(false)).mockImplementation(() => new Promise(result => { resolve = result; }));
    await render(); await fill(); await submit(); await input(0, 'new secure master'); await submit();
    expect(container.textContent).toContain('NEW-RECOVERY-CODE');
    const newer: AppLockState = unlockAgain ? { ...ready(), recoveryConfigured: true } : { ...ready(false), phase: 'locked' };
    await act(async () => {
      useAppLockStore.setState({ state: { ...ready(false), phase: 'locked' } });
      if (unlockAgain) useAppLockStore.setState({ state: newer });
    });
    await act(async () => resolve(ready(false)));
    expect(useAppLockStore.getState().state).toEqual(newer); expect(container.textContent).not.toContain('NEW-RECOVERY-CODE');
  });

  it('changes a fake 11-character master password and unblocks encrypted export', async () => {
    const store = createRequire(import.meta.url)('../../../../../rust-core/getssh-store/store.fake.js');
    const home = mkdtempSync(join(tmpdir(), 'getssh-u3-'));
    try {
      store.__fake.reset(); store.configure(join(home, 'store')); store.__fake.seed({ masterPassword: 'elevenchars' }); store.__fake.setPresence('unsupported'); await store.start();
      await store.unlockApp({ password: 'elevenchars' });
      const appState = (): AppLockState => ({ ...ready(), ...store.appState(), appProtected: true });
      useAppLockStore.setState({ state: appState() });
      await expect(store.exportBundle(join(home, 'backup.getssh-backup'), 'backup secure password', ['default'])).rejects.toThrow('must_change_master_password');
      setMasterPassword.mockImplementation(async ({ password, currentPassword }) => ({ ok: true, ...await store.setMasterPassword(password, currentPassword) }));
      getState.mockImplementation(async () => appState());
      await render(); await fill(); await submit(); expect(container.querySelector('[role="dialog"]')).toBeNull();
      const result = await store.exportBundle(join(home, 'backup.getssh-backup'), 'backup secure password', ['default']);
      expect(result.path).toBe(join(home, 'backup.getssh-backup'));
    } finally { store.__fake.reset(); rmSync(home, { recursive: true, force: true }); }
  });
});
