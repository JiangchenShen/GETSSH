// @vitest-environment jsdom
import { act } from 'react';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportTab } from './ExportTab';
import { useAppLockStore } from '../../../store/appLockStore';
import { useBackupRestartStore } from '../../../store/backupStore';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { storeFailureMessage } from '../../../utils/storeFeedback';

const translations: Record<string, string> = {
  'settings.exportJson': 'Export JSON', 'settings.importJson': 'Import JSON',
  'settings.importTitle': 'Import host profiles', 'settings.importCancel': 'Cancel',
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  i18n: { language: 'en-US' }, t: (key: string) => translations[key] ?? key,
}) }));

let root: Root;
let container: HTMLDivElement;
let backup: Record<string, ReturnType<typeof vi.fn>>;
let unlock: ReturnType<typeof vi.fn>;
const require = createRequire(import.meta.url);
const store = require('../../../../../../rust-core/getssh-store/store.fake.js');
let testDirectory: string | undefined;
const candidates = [
  { id: 'main', name: 'Main hosts', is_main: true, state: 'open', profileCount: 3, unlockWith: [] },
  { id: 'private', name: 'Private hosts', is_main: false, state: 'locked', profileCount: 0, unlockWith: ['password'] },
];
const manifest = { formatVersion: 1, createdAt: 1728000000000, appVersion: '3.0.0-rc.1', workspaces: [{ id: 'main', name: 'Backup hosts', hasPassword: false }] };

beforeEach(() => {
  vi.clearAllMocks();
  useAppLockStore.setState({ state: null }); useBackupRestartStore.setState({ report: null });
  useWorkspaceStore.setState({ activeWorkspaceId: 'main', isVaultLocked: false, isSwitching: false });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  backup = {
    candidates: vi.fn().mockResolvedValue({ ok: true, candidates }),
    unlockForExport: vi.fn().mockResolvedValue({ ok: true, unlocked: ['main'], failed: [{ id: 'private', code: 'needs_password' }] }),
    export: vi.fn().mockResolvedValue({ ok: true, report: { path: '/tmp/my.getssh-backup', workspaceIds: ['main', 'private'], bytes: 500 } }),
    chooseImportFile: vi.fn().mockResolvedValue({ ok: true, fileId: 'opaque-file', fileName: 'my.getssh-backup' }),
    inspect: vi.fn().mockResolvedValue({ ok: true, info: manifest }),
    import: vi.fn().mockResolvedValue({ ok: true, report: { workspaceIds: ['main'], backupPath: '/tmp/previous-data' } }),
    relaunch: vi.fn().mockResolvedValue({ ok: true }),
  };
  unlock = vi.fn().mockResolvedValue({ ok: true });
  window.electronAPI = {
    store: { backup }, workspace: { unlock }, exportProfiles: vi.fn().mockResolvedValue({ success: true, count: 2 }),
  } as unknown as Window['electronAPI'];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks();
  if (testDirectory) { store.__fake.reset(); rmSync(testDirectory, { recursive: true, force: true }); testDirectory = undefined; }
});

const render = () => act(async () => root.render(<ExportTab />));
function button(label: string) {
  const match = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label);
  expect(match, `Missing button: ${label}`).toBeDefined();
  return match!;
}
const click = (label: string) => act(async () => button(label).click());
const fill = (label: string, value: string) => act(async () => {
  const input = [...container.querySelectorAll('label')].find(item => item.firstChild?.textContent === label)?.querySelector('input');
  expect(input, `Missing input: ${label}`).toBeDefined();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input!.dispatchEvent(new Event('input', { bubbles: true }));
});
async function passwordStep() {
  await click('Choose workspaces'); await click('Verify and continue');
  await fill('Workspace password', 'workspace-password'); await click('Unlock and continue');
}
async function reviewImport() {
  await click('Choose backup file'); await fill('Backup password', 'backup-password'); await click('Review backup');
}

describe('Encrypted backup interface', () => {
  it('shows actual candidate metadata, supports choosing only one workspace, and opens it before export', async () => {
    await render(); await click('Choose workspaces');
    expect(container.textContent).toContain('Main hosts · Main workspace');
    expect(container.textContent).toContain('Unlocked · 3 profiles');
    expect(container.textContent).toContain('Locked · 0 profiles');
    expect(container.textContent).toContain('Workspace password');
    await act(async () => (container.querySelector('input[type=checkbox]') as HTMLInputElement).click());
    await click('Verify and continue');
    expect(backup.unlockForExport).toHaveBeenCalledWith({ workspaceIds: ['private'] });
    await fill('Workspace password', 'private-password'); await click('Unlock and continue');
    expect(unlock).toHaveBeenCalledWith({ workspaceId: 'private', method: 'password', password: 'private-password' });
    await fill('Backup password', 'long-backup-password'); await fill('Repeat the backup password', 'long-backup-password'); await click('Save backup');
    expect(backup.export).toHaveBeenCalledWith({ workspaceIds: ['private'], password: 'long-backup-password' });
    expect(container.querySelector('[role=status]')?.textContent).toContain('/tmp/my.getssh-backup');
    expect(container.querySelector('input[type=password]')).toBeNull();
  });

  it.each([
    { ok: true, unlocked: ['main'], failed: [{ id: 'private', code: 'cancelled' }] },
    { ok: true, unlocked: ['main'], failed: [{ id: 'private', code: 'cancelled' }, { id: 'password-only', code: 'needs_password' }] },
  ])('keeps system verification cancellation quiet (%j)', async outcome => {
    backup.candidates.mockResolvedValue({ ok: true, candidates: [
      candidates[0], { ...candidates[1], unlockWith: ['presence', 'password'] },
      { id: 'password-only', name: 'Password hosts', is_main: false, state: 'locked', profileCount: 0, unlockWith: ['password'] },
    ].filter(candidate => candidate.id !== 'password-only' || outcome.failed.length > 1) });
    backup.unlockForExport.mockResolvedValue(outcome);
    await render(); await click('Choose workspaces'); await click('Verify and continue');
    expect(container.querySelector('[role=alert]')).toBeNull();
    expect(backup.export).not.toHaveBeenCalled();
  });

  it('only requests eligible workspace passwords after cancelled mixed-workspace verification with the actual fake store API', async () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'getssh-ui-backup-cancel-'));
    store.__fake.reset(); store.configure(join(testDirectory, 'data'), '3.0.0-rc.1');
    store.__fake.seed({ workspaces: [
      { id: 'touch', name: 'Touch ID hosts', password: 'touch-password', presenceEnabled: true },
      { id: 'plain', name: 'Unprotected hosts' },
      { id: 'password', name: 'Password hosts', password: 'workspace-password' },
      { id: 'touch-later', name: 'Later Touch ID hosts', password: 'later-password', presenceEnabled: true },
      { id: 'main', name: 'Main hosts', is_main: true },
    ] });
    await store.start(); store.lockWorkspace('plain'); store.__fake.setPresence('cancelled');
    backup.candidates.mockImplementation(async () => ({ ok: true, candidates: store.exportCandidates() }));
    let verification: unknown;
    backup.unlockForExport.mockImplementation(async ({ workspaceIds }) => {
      verification = await store.unlockWorkspaces(workspaceIds, 'Export selected workspaces');
      return { ok: true, ...verification as object };
    });
    unlock.mockImplementation(async ({ workspaceId, password }) => {
      await store.unlockWorkspace(workspaceId, { password }); return { ok: true };
    });

    await render(); await click('Choose workspaces'); await click('Verify and continue');
    expect(verification).toEqual({
      unlocked: ['plain', 'main'],
      failed: [{ id: 'touch', code: 'cancelled' }, { id: 'password', code: 'needs_password' }, { id: 'touch-later', code: 'cancelled' }],
    });
    expect(store.__fake.snapshot().presencePrompts).toBe(1);
    expect(container.querySelector('[role=alert]')).toBeNull();
    expect(container.textContent).toContain('Unlock workspace: Touch ID hosts');
    await fill('Workspace password', 'touch-password'); await click('Unlock and continue');
    expect(container.textContent).toContain('Unlock workspace: Password hosts');
    await fill('Workspace password', 'workspace-password'); await click('Unlock and continue');
    expect(container.textContent).toContain('Unlock workspace: Later Touch ID hosts');
    await fill('Workspace password', 'later-password'); await click('Unlock and continue');
    expect(container.textContent).toContain('Set a backup password');
    expect(unlock.mock.calls.map(([request]) => request.workspaceId)).toEqual(['touch', 'password', 'touch-later']);
    await expect(store.openWorkspace('plain')).resolves.toBe('open');
  });

  it('refreshes changed workspace metadata after cancellation instead of silently skipping its missing password route', async () => {
    const opened = { id: 'private', name: 'Private hosts', is_main: false, state: 'open', profileCount: 2, unlockWith: [] };
    backup.candidates.mockResolvedValueOnce({ ok: true, candidates: [opened] }).mockResolvedValue({ ok: true, candidates: [{ ...opened, state: 'locked', profileCount: 0, unlockWith: ['presence', 'password'] }] });
    backup.unlockForExport.mockResolvedValue({ ok: true, unlocked: [], failed: [{ id: 'private', code: 'cancelled' }] });
    await render(); await click('Choose workspaces'); await click('Verify and continue');
    expect(container.querySelector('input[type=password]')).toBeNull();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('have not been verified: Private hosts');
    expect(backup.candidates).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Locked · 0 profiles');
    expect((container.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(true);
    expect(button('Verify and continue').disabled).toBe(false);
    expect(unlock).not.toHaveBeenCalled(); expect(backup.export).not.toHaveBeenCalled();
    await click('Verify and continue');
    expect(container.querySelector('[role=alert]')).toBeNull();
    expect(container.textContent).toContain('Unlock workspace: Private hosts');
  });

  it('preserves the chosen workspaces and verifies all mixed failures again when a selected open workspace locks', async () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'getssh-ui-backup-metadata-'));
    store.__fake.reset(); store.configure(join(testDirectory, 'data'), '3.0.0-rc.1');
    store.__fake.seed({ workspaces: [
      { id: 'main', name: 'Main hosts', is_main: true },
      { id: 'newly-locked', name: 'Recently locked hosts', password: 'workspace-password' },
      { id: 'touch', name: 'Touch ID hosts', password: 'touch-password', presenceEnabled: true },
    ] });
    await store.start(); await store.unlockWorkspace('newly-locked', { password: 'workspace-password' });
    store.__fake.setPresence('cancelled');
    backup.candidates.mockImplementation(async () => ({ ok: true, candidates: store.exportCandidates() }));
    backup.unlockForExport.mockImplementation(async ({ workspaceIds }) => ({ ok: true, ...await store.unlockWorkspaces(workspaceIds, 'Export selected workspaces') }));
    unlock.mockImplementation(async ({ workspaceId, password }) => {
      await store.unlockWorkspace(workspaceId, { password }); return { ok: true };
    });
    await render(); await click('Choose workspaces');
    await act(async () => (container.querySelector('input[type=checkbox]') as HTMLInputElement).click());
    store.lockWorkspace('newly-locked');
    await click('Verify and continue');
    expect(await backup.unlockForExport.mock.results[0].value).toEqual({ ok: true, unlocked: [], failed: [
      { id: 'newly-locked', code: 'needs_password' }, { id: 'touch', code: 'cancelled' },
    ] });
    expect(container.querySelector('[role=alert]')?.textContent).toContain('have not been verified: Recently locked hosts');
    expect(backup.candidates).toHaveBeenCalledTimes(2);
    expect([...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map(input => input.checked)).toEqual([false, true, true]);
    expect(container.querySelector('input[type=password]')).toBeNull();
    expect(unlock).not.toHaveBeenCalled(); expect(backup.export).not.toHaveBeenCalled();
    await click('Verify and continue');
    expect(backup.unlockForExport).toHaveBeenNthCalledWith(2, { workspaceIds: ['newly-locked', 'touch'] });
    await fill('Workspace password', 'workspace-password'); await click('Unlock and continue');
    await fill('Workspace password', 'touch-password'); await click('Unlock and continue');
    await fill('Backup password', 'long-backup-password'); await fill('Repeat the backup password', 'long-backup-password'); await click('Save backup');
    expect(unlock.mock.calls.map(([request]) => request.workspaceId)).toEqual(['newly-locked', 'touch']);
    expect(backup.export).toHaveBeenCalledExactlyOnceWith({ workspaceIds: ['newly-locked', 'touch'], password: 'long-backup-password' });
  });

  it.each(['failure', 'transport'])('keeps an unverified workspace selected and retryable after candidate refresh %s', async outcome => {
    const opened = { id: 'private', name: 'Private hosts', is_main: false, state: 'open', profileCount: 2, unlockWith: [] };
    backup.candidates.mockResolvedValueOnce({ ok: true, candidates: [opened] });
    if (outcome === 'failure') backup.candidates.mockResolvedValueOnce({ ok: false, error: 'io' });
    else backup.candidates.mockRejectedValueOnce(new Error('SECRET backend details'));
    backup.candidates.mockResolvedValue({ ok: true, candidates: [{ ...opened, state: 'locked', profileCount: 0, unlockWith: ['password'] }] });
    backup.unlockForExport.mockResolvedValue({ ok: true, unlocked: [], failed: [{ id: 'private', code: 'needs_password' }] });
    await render(); await click('Choose workspaces'); await click('Verify and continue');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('have not been verified: Private hosts');
    expect(container.textContent).not.toContain('SECRET');
    expect((container.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(true);
    expect(button('Verify and continue').disabled).toBe(false);
    expect(backup.export).not.toHaveBeenCalled();
    await click('Verify and continue');
    expect(backup.candidates).toHaveBeenCalledTimes(3);
    expect(container.querySelector('input[type=password]')).toBeNull();
    await click('Verify and continue');
    expect(container.textContent).toContain('Unlock workspace: Private hosts');
  });

  it('removes a deleted workspace from the refreshed selection explicitly and preserves every remaining checkbox choice', async () => {
    const a = { id: 'a', name: 'Deleted hosts', is_main: false, state: 'open', profileCount: 1, unlockWith: [] };
    const b = { id: 'b', name: 'Chosen hosts', is_main: false, state: 'open', profileCount: 2, unlockWith: [] };
    const c = { id: 'c', name: 'Excluded hosts', is_main: true, state: 'open', profileCount: 3, unlockWith: [] };
    backup.candidates.mockResolvedValueOnce({ ok: true, candidates: [a, b, c] }).mockResolvedValue({ ok: true, candidates: [b, c] });
    backup.unlockForExport.mockResolvedValueOnce({ ok: true, unlocked: ['b'], failed: [{ id: 'a', code: 'not_found' }] })
      .mockResolvedValue({ ok: true, unlocked: ['b'], failed: [] });
    await render(); await click('Choose workspaces');
    await act(async () => container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[2].click());
    await click('Verify and continue');
    expect(backup.unlockForExport).toHaveBeenNthCalledWith(1, { workspaceIds: ['a', 'b'] });
    expect(container.querySelector('[role=alert]')?.textContent).toContain('have not been verified: Deleted hosts');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('no longer exist and were removed from the selection: Deleted hosts');
    expect([...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map(input => input.checked)).toEqual([true, false]);
    expect(backup.export).not.toHaveBeenCalled();
    expect(container.querySelector('input[type=password]')).toBeNull();
    await click('Verify and continue');
    expect(backup.unlockForExport).toHaveBeenNthCalledWith(2, { workspaceIds: ['b'] });
    await fill('Backup password', 'long-backup-password'); await fill('Repeat the backup password', 'long-backup-password'); await click('Save backup');
    expect(backup.export).toHaveBeenCalledExactlyOnceWith({ workspaceIds: ['b'], password: 'long-backup-password' });
  });

  it('exports selected workspaces while the current workspace remains locked and only disables for an app lock', async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: 'private', isVaultLocked: true });
    await render();
    for (const label of ['Choose workspaces', 'Choose backup file', 'Export JSON', 'Import JSON']) expect(button(label).disabled).toBe(false);
    await passwordStep();
    await fill('Backup password', 'long-backup-password'); await fill('Repeat the backup password', 'long-backup-password'); await click('Save backup');
    expect(backup.export).toHaveBeenCalledExactlyOnceWith({ workspaceIds: ['main', 'private'], password: 'long-backup-password' });
    expect(useWorkspaceStore.getState().isVaultLocked).toBe(true);
    await act(async () => useAppLockStore.setState({ state: {
      phase: 'locked', appProtected: true, presenceSupported: false, presenceEnabled: false,
      recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false,
    } }));
    for (const label of ['Choose workspaces', 'Choose backup file', 'Export JSON', 'Import JSON']) expect(button(label).disabled).toBe(true);
  });

  it('chooses, reviews and imports a backup while the current workspace remains locked', async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: 'private', isVaultLocked: true });
    await render(); await reviewImport();
    expect(container.querySelector('[role=alertdialog]')).not.toBeNull();
    await click('Replace all data and import');
    expect(backup.import).toHaveBeenCalledExactlyOnceWith({ fileId: 'opaque-file', password: 'backup-password' });
    expect(useWorkspaceStore.getState().isVaultLocked).toBe(true);
    expect(useBackupRestartStore.getState().report).toEqual({ workspaceIds: ['main'], backupPath: '/tmp/previous-data' });
  });

  it('allows retry after a wrong workspace password and displays the rate-limit wait', async () => {
    unlock.mockResolvedValueOnce({ ok: false, error: 'wrong_password' }).mockResolvedValueOnce({ ok: false, error: 'rate_limited', retryAfterMs: 2301 });
    await render(); await click('Choose workspaces'); await click('Verify and continue');
    await fill('Workspace password', 'wrong'); await click('Unlock and continue');
    expect(container.querySelector('[role=alert]')?.textContent).toBe('Incorrect password. Try again');
    await fill('Workspace password', 'wrong-again'); await click('Unlock and continue');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('3 seconds');
    await fill('Workspace password', 'correct'); await click('Unlock and continue');
    expect(container.textContent).toContain('Set a backup password');
  });

  it('requires 12 characters and matching confirmation before asking to save', async () => {
    await render(); await passwordStep();
    await fill('Backup password', 'short'); await fill('Repeat the backup password', 'short'); await click('Save backup');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('12 characters');
    expect(backup.export).not.toHaveBeenCalled();
    await fill('Backup password', 'long-backup-password'); await fill('Repeat the backup password', 'different'); await click('Save backup');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('do not match');
    expect(backup.export).not.toHaveBeenCalled();
  });

  it('counts backup password characters after NFC normalization', async () => {
    await render(); await passwordStep();
    const sixCharacters = 'e\u0301'.repeat(6);
    await fill('Backup password', sixCharacters); await fill('Repeat the backup password', sixCharacters); await click('Save backup');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('12 characters');
    expect(backup.export).not.toHaveBeenCalled();
  });

  it('does not invent a retry duration when a rate-limit response omits it', () => {
    expect(storeFailureMessage('rate_limited', false)).toBe('Too many attempts. Try again later');
    expect(storeFailureMessage('rate_limited', true)).toBe('尝试次数过多，请稍后再试');
    expect(storeFailureMessage('rate_limited', false, 0)).toContain('1 seconds');
    expect(storeFailureMessage('rate_limited', false, 1001)).toContain('2 seconds');
  });

  it('keeps save-dialog cancellation quiet and describes mandatory master-password changes', async () => {
    backup.export.mockResolvedValueOnce({ ok: false, error: 'cancelled' }).mockResolvedValueOnce({ ok: false, error: 'must_change_master_password' });
    await render(); await passwordStep(); await fill('Backup password', 'long-backup-password'); await fill('Repeat the backup password', 'long-backup-password'); await click('Save backup');
    expect(container.querySelector('[role=alert]')).toBeNull();
    expect([...container.querySelectorAll<HTMLInputElement>('input[type=password]')].map(input => input.value)).toEqual(['', '']);
    await fill('Backup password', 'long-backup-password'); await fill('Repeat the backup password', 'long-backup-password');
    await click('Save backup');
    expect(container.querySelector('[role=alert]')?.textContent).toBe('Change the master password before exporting a backup');
  });

  it.each(['io', 'unavailable', 'rejected'])('clears both backup passwords after export fails (%s)', async code => {
    if (code === 'rejected') backup.export.mockRejectedValue(new Error('SECRET backend exception'));
    else backup.export.mockResolvedValue({ ok: false, error: code });
    await render(); await passwordStep();
    await fill('Backup password', 'transient-backup-password'); await fill('Repeat the backup password', 'transient-backup-password');
    await click('Save backup');
    expect([...container.querySelectorAll<HTMLInputElement>('input[type=password]')].map(input => input.value)).toEqual(['', '']);
    expect(container.querySelector('[role=alert]')?.textContent).toBe(code === 'rejected'
      ? 'The operation could not be completed. Try again' : storeFailureMessage(code, false));
    expect(container.textContent).not.toContain('SECRET');
    await click('Save backup');
    expect(backup.export).toHaveBeenCalledOnce();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('12 characters');
  });

  it.each(['workspace lock', 'workspace change', 'app lock'])('clears passwords and discards a late export failure after %s', async scope => {
    let finish!: (value: unknown) => void;
    backup.export.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    useAppLockStore.setState({ state: {
      phase: 'ready', appProtected: false, presenceSupported: false, presenceEnabled: false,
      recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false,
    } });
    await render(); await passwordStep();
    await fill('Backup password', 'transient-backup-password'); await fill('Repeat the backup password', 'transient-backup-password');
    await click('Save backup');
    await act(async () => {
      if (scope === 'workspace lock') useWorkspaceStore.setState({ isVaultLocked: true });
      else if (scope === 'workspace change') useWorkspaceStore.setState({ activeWorkspaceId: 'other' });
      else useAppLockStore.setState({ state: { ...useAppLockStore.getState().state!, phase: 'locked' } });
    });
    expect(container.querySelector('input[type=password]')).toBeNull();
    if (scope !== 'workspace change') expect(button('Choose workspaces').disabled).toBe(true);
    await act(async () => {
      useWorkspaceStore.setState({ activeWorkspaceId: 'main', isVaultLocked: false });
      useAppLockStore.setState({ state: { ...useAppLockStore.getState().state!, phase: 'ready' } });
    });
    await act(async () => finish({ ok: false, error: 'io' }));
    expect(container.querySelector('[role=alert]')).toBeNull();
    expect(container.querySelector('[role=status]')).toBeNull();
    await passwordStep();
    expect([...container.querySelectorAll<HTMLInputElement>('input[type=password]')].map(input => input.value)).toEqual(['', '']);
  });

  it('clears workspace and import passwords when an unprotected app locks its current workspace', async () => {
    await render(); await click('Choose workspaces'); await click('Verify and continue');
    await fill('Workspace password', 'transient-workspace-password');
    await act(async () => useWorkspaceStore.setState({ isVaultLocked: true }));
    expect(container.querySelector('input[type=password]')).toBeNull();
    expect(unlock).not.toHaveBeenCalled();
    await act(async () => useWorkspaceStore.setState({ isVaultLocked: false }));
    await click('Choose backup file'); await fill('Backup password', 'transient-import-password');
    await act(async () => useWorkspaceStore.setState({ isVaultLocked: true }));
    expect(container.querySelector('input[type=password]')).toBeNull();
    expect(button('Choose backup file').disabled).toBe(false);
    await act(async () => useWorkspaceStore.setState({ isVaultLocked: false }));
    await click('Choose backup file');
    expect((container.querySelector('input[type=password]') as HTMLInputElement).value).toBe('');
    expect(backup.inspect).not.toHaveBeenCalled();
  });

  it('discards late backup inspection after the current workspace locks without an app password', async () => {
    let finish!: (value: unknown) => void;
    backup.inspect.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render(); await click('Choose backup file'); await fill('Backup password', 'transient-import-password'); await click('Review backup');
    await act(async () => useWorkspaceStore.setState({ isVaultLocked: true }));
    await act(async () => useWorkspaceStore.setState({ isVaultLocked: false }));
    await act(async () => finish({ ok: true, info: manifest }));
    expect(container.querySelector('[role=alertdialog]')).toBeNull();
    expect(container.querySelector('input[type=password]')).toBeNull();
    expect(backup.import).not.toHaveBeenCalled();
  });

  it.each(['workspace lock', 'workspace change', 'unmount'])('retains a successful import restart report after %s', async scope => {
    let finish!: (value: unknown) => void;
    backup.import.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render(); await reviewImport(); await click('Replace all data and import');
    await act(async () => {
      if (scope === 'workspace lock') useWorkspaceStore.setState({ isVaultLocked: true });
      else if (scope === 'workspace change') useWorkspaceStore.setState({ activeWorkspaceId: 'other' });
      else root.render(null);
    });
    const report = { workspaceIds: ['main'], backupPath: '/tmp/previous-data' };
    await act(async () => finish({ ok: true, report }));
    expect(useBackupRestartStore.getState().report).toEqual(report);
    expect(container.querySelector('[role=alertdialog]')).toBeNull();
    expect(container.querySelector('input[type=password]')).toBeNull();
  });

  it('retries the backup password, shows its manifest, and cancels without importing', async () => {
    backup.inspect.mockResolvedValueOnce({ ok: false, error: 'wrong_password' }).mockResolvedValueOnce({ ok: true, info: manifest });
    await render(); await click('Choose backup file'); await fill('Backup password', 'wrong'); await click('Review backup');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('Incorrect password');
    expect((container.querySelector('input[type=password]') as HTMLInputElement).value).toBe('');
    await fill('Backup password', 'correct-password'); await click('Review backup');
    expect(backup.inspect).toHaveBeenLastCalledWith({ fileId: 'opaque-file', password: 'correct-password' });
    const dialog = container.querySelector('[role=alertdialog]')!;
    expect(dialog.textContent).toContain('3.0.0-rc.1'); expect(dialog.textContent).toContain('Backup hosts');
    expect(dialog.textContent).toContain('This replaces all current data'); expect(dialog.textContent).toContain('Created:');
    await click('Cancel'); expect(backup.import).not.toHaveBeenCalled();
    expect(container.querySelector('input[type=password]')).toBeNull();
  });

  it('requires replace-all confirmation, shows retained data, pauses every data action, and restarts', async () => {
    await render(); await reviewImport();
    expect(backup.import).not.toHaveBeenCalled();
    await click('Replace all data and import');
    expect(backup.import).toHaveBeenCalledWith({ fileId: 'opaque-file', password: 'backup-password' });
    expect(container.textContent).toContain('Restart required'); expect(container.textContent).toContain('/tmp/previous-data');
    for (const label of ['Choose workspaces', 'Choose backup file', 'Export JSON', 'Import JSON']) expect(button(label).disabled).toBe(true);
    expect(container.querySelector('[role=alert]')).toBeNull();
    await click('Restart GETSSH'); expect(backup.relaunch).toHaveBeenCalledOnce();
    expect(container.querySelector('[role=alert]')).toBeNull();
  });

  it.each(['unauthorized', 'invalid_argument'])('reports an actual relaunch failure (%s) and allows retry', async error => {
    await render(); await reviewImport(); await click('Replace all data and import');
    backup.relaunch.mockResolvedValueOnce({ ok: false, error }).mockResolvedValueOnce({ ok: true });
    await click('Restart GETSSH');
    expect(container.querySelector('[role=alert]')?.textContent).toBe(storeFailureMessage(error, false));
    expect(container.textContent).toContain('/tmp/previous-data');
    expect(button('Restart GETSSH').disabled).toBe(false);
    await click('Restart GETSSH'); expect(backup.relaunch).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role=alert]')).toBeNull();
  });

  it('keeps the restart state after leaving and reopening the page', async () => {
    await render(); await reviewImport(); await click('Replace all data and import');
    await act(async () => root.render(null)); await render();
    expect(container.textContent).toContain('Restart required');
    expect(container.textContent).toContain('/tmp/previous-data');
    expect(button('Export JSON').disabled).toBe(true);
    expect(button('Choose workspaces').disabled).toBe(true);
    await click('Restart GETSSH'); expect(backup.relaunch).toHaveBeenCalledOnce();
  });

  it('contains confirmation keyboard focus and restores it after cancellation', async () => {
    await render(); await reviewImport();
    expect(document.activeElement).toBe(button('Cancel'));
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })));
    expect(document.activeElement).toBe(button('Replace all data and import'));
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    expect(document.activeElement).toBe(button('Cancel'));
    await click('Cancel'); expect(document.activeElement).toBe(button('Choose backup file'));
  });

  it('keeps busy confirmation focus inside and blocks Escape and underlying page shortcuts', async () => {
    let complete!: (value: unknown) => void;
    backup.import.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await render(); await reviewImport(); await click('Replace all data and import');
    const dialog = container.querySelector('[role=alertdialog]')!;
    expect(document.activeElement).toBe(dialog);
    const shortcut = vi.fn(); document.addEventListener('keydown', shortcut);
    try {
      await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(dialog);
      await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
      expect(container.querySelector('[role=alertdialog]')).toBe(dialog);
      expect(shortcut).not.toHaveBeenCalled();
      const outside = document.createElement('button'); document.body.append(outside);
      await act(async () => outside.focus());
      expect(document.activeElement).toBe(dialog); outside.remove();
      await act(async () => complete({ ok: true, report: { workspaceIds: ['main'], backupPath: '/tmp/previous-data' } }));
    } finally { document.removeEventListener('keydown', shortcut); }
  });

  it('clears entered passwords on lock and does not revive a late inspection', async () => {
    let complete!: (value: unknown) => void;
    backup.inspect.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await render(); await click('Choose backup file'); await fill('Backup password', 'transient-password'); await click('Review backup');
    await act(async () => useAppLockStore.setState({ state: {
      phase: 'locked', appProtected: true, presenceSupported: false, presenceEnabled: false,
      recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false,
    } }));
    expect(container.querySelector('input[type=password]')).toBeNull();
    await act(async () => complete({ ok: true, info: manifest }));
    expect(container.querySelector('[role=alertdialog]')).toBeNull();
    expect(backup.import).not.toHaveBeenCalled();
  });

  it('handles native file cancellation silently and does not expose backend exception details', async () => {
    backup.chooseImportFile.mockResolvedValueOnce({ ok: false, error: 'cancelled' }).mockRejectedValueOnce(new Error('SECRET debug payload'));
    await render(); await click('Choose backup file'); expect(container.querySelector('[role=alert]')).toBeNull();
    await click('Choose backup file'); expect(container.querySelector('[role=alert]')?.textContent).toContain('Try again');
    expect(container.textContent).not.toContain('SECRET');
  });

  it('prevents duplicate pending requests and ignores candidate results after unmount', async () => {
    let complete!: (value: unknown) => void;
    backup.candidates.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await render(); const choose = button('Choose workspaces');
    await act(async () => { choose.click(); choose.click(); });
    expect(backup.candidates).toHaveBeenCalledOnce(); expect(choose.disabled).toBe(true);
    await act(async () => root.render(null));
    await act(async () => complete({ ok: true, candidates }));
    expect(backup.unlockForExport).not.toHaveBeenCalled();
  });

  it('preserves sanitized JSON template export', async () => {
    await render(); await click('Export JSON');
    expect(window.electronAPI.exportProfiles).toHaveBeenCalledOnce();
    expect(container.querySelector('[role=status]')?.textContent).toContain('2 sanitized host profiles');
  });
});
