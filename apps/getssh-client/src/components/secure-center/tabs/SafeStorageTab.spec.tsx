// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecurityStatus } from '../../../types/ipc';
import { useAppLockStore } from '../../../store/appLockStore';
import { useBackupRestartStore } from '../../../store/backupStore';

const mocks = vi.hoisted(() => ({ isMain: false, language: 'en-US', initWorkspaces: vi.fn(), addToast: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: mocks.language } }) }));
vi.mock('../../../store/appStore', () => ({ useAppStore: (select: (state: any) => any) => select({ isMac: true, addToast: mocks.addToast }) }));
vi.mock('../../../store/cryptoStore', () => ({ useCryptoStore: Object.assign((select: (state: any) => any) => select({}), { getState: () => ({ setWorkspaceUnprotected: vi.fn() }) }) }));
vi.mock('../../../store/workspaceStore', async () => {
  const { create } = await import('zustand');
  return { useWorkspaceStore: create(() => ({ activeWorkspaceId: 'current', isSwitching: false, isVaultLocked: false, workspaces: [{ id: 'current', name: 'Current', themeColor: '#000', isMain: false }], initWorkspaces: mocks.initWorkspaces })) };
});
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { SafeStorageTab } from './SafeStorageTab';

const metadata = (appProtected: boolean, ownPassword = false): SecurityStatus => ({ appProtected, recoveryConfigured: false, presenceSupported: false, deviceBackend: null, scopes: [{ id: 'ws:current', workspaceId: 'current', protected: appProtected || ownPassword, ownPassword, presence: false, unlocked: true, recovery: false, revealRemainingMs: null }] });
let root: Root;
let container: HTMLDivElement;
let status: ReturnType<typeof vi.fn>;
let setPassword: ReturnType<typeof vi.fn>;
let setMasterPassword: ReturnType<typeof vi.fn>;
let setupRecovery: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.isMain = false; mocks.language = 'en-US'; vi.clearAllMocks();
  status = vi.fn().mockResolvedValue(metadata(false));
  setPassword = vi.fn().mockResolvedValue({ ok: true });
  setMasterPassword = vi.fn().mockResolvedValue({ ok: true, recoveryReset: false });
  setupRecovery = vi.fn().mockResolvedValue({ ok: true, code: 'NEW-RECOVERY-CODE' });
  useAppLockStore.setState({ state: { phase: 'ready', appProtected: false, presenceSupported: false, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false } });
  useWorkspaceStore.setState({ activeWorkspaceId: 'current', isSwitching: false, isVaultLocked: false, workspaces: [{ id: 'current', name: 'Current', themeColor: '#000', isMain: false }] });
  useBackupRestartStore.setState({ report: null });
  window.electronAPI = { security: { status, setMasterPassword, setupRecovery }, workspace: { setPassword } } as unknown as Window['electronAPI'];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); useAppLockStore.setState({ state: null }); });
const render = async (section: 'app' | 'vault' | 'both' = 'vault', props: { recoveryRequest?: number; onStatusChange?: (status: SecurityStatus | null) => void } = {}) => act(async () => {
  useWorkspaceStore.setState({ workspaces: [{ id: 'current', name: 'Current', themeColor: '#000', isMain: mocks.isMain }] });
  root.render(<SafeStorageTab section={section} {...props} />);
});
const buttons = () => Array.from(container.querySelectorAll('button')).map(button => button.textContent);
const click = async (text: string) => act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === text)!.click());
const input = async (index: number, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(container.querySelectorAll('input')[index], value);
  container.querySelectorAll('input')[index].dispatchEvent(new Event('input', { bubbles: true }));
});

describe('recovery setup state', () => {
  it('reports an unconfigured recovery code when automatic creation after a first master password fails', async () => {
    const changed = vi.fn();
    status.mockResolvedValueOnce(metadata(false)).mockResolvedValue(metadata(true));
    setMasterPassword.mockResolvedValue({ ok: true, recoveryReset: true });
    setupRecovery.mockResolvedValue({ ok: false, error: 'io' });
    await render('both', { onStatusChange: changed }); await click('Set master password');
    await input(0, 'new secure master'); await input(1, 'new secure master'); await submit();
    expect(setupRecovery).toHaveBeenCalledExactlyOnceWith({ currentPassword: 'new secure master' });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ appProtected: true, recoveryConfigured: false }));
    expect(container.textContent).toContain('Not created'); expect(container.textContent).toContain('Cannot read or write');
    expect(container.textContent).not.toContain('Your recovery code'); expect(container.querySelector('input')).toBeNull();
  });

  it('opens the requested recovery form and reports confirmed recovery creation', async () => {
    const changed = vi.fn(); let current = metadata(true);
    status.mockImplementation(async () => current);
    setupRecovery.mockImplementation(async () => { current = { ...current, recoveryConfigured: true }; return { ok: true, code: 'NEW-RECOVERY-CODE' }; });
    await render('app', { recoveryRequest: 1, onStatusChange: changed });
    expect(container.querySelector('form')).not.toBeNull(); expect(setupRecovery).not.toHaveBeenCalled();
    await input(0, 'typed master password'); await submit();
    expect(setupRecovery).toHaveBeenCalledExactlyOnceWith({ currentPassword: 'typed master password' });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ recoveryConfigured: true }));
    expect(container.textContent).toContain('NEW-RECOVERY-CODE');
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Done')!.disabled).toBe(true);
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await click('Done'); expect(container.textContent).not.toContain('NEW-RECOVERY-CODE'); expect(container.textContent).toContain('Created; it opens all data.');
  });

  it('allows app recovery setup while the current workspace is locked', async () => {
    useWorkspaceStore.setState({ isVaultLocked: true }); status.mockResolvedValue(metadata(true));
    await render('app', { recoveryRequest: 1 }); await input(0, 'typed master password'); await submit();
    expect(setupRecovery).toHaveBeenCalledExactlyOnceWith({ currentPassword: 'typed master password' });
    expect(container.textContent).toContain('NEW-RECOVERY-CODE'); expect(setPassword).not.toHaveBeenCalled();
  });

  it('keeps recovery unconfigured after closing the first-master flow before its late success', async () => {
    let complete!: (value: { ok: true; recoveryReset: true }) => void;
    setMasterPassword.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await render('both'); await click('Set master password'); await input(0, 'new secure master'); await input(1, 'new secure master'); await submit();
    await act(async () => root.render(null)); await act(async () => complete({ ok: true, recoveryReset: true }));
    expect(setupRecovery).not.toHaveBeenCalled(); expect(mocks.addToast).not.toHaveBeenCalled();
    status.mockResolvedValue(metadata(true)); await render('app');
    expect(container.textContent).toContain('Not created'); expect(container.textContent).not.toContain('Your recovery code');
  });

  it.each(['lock-unlock', 'workspace-return'])('discards a late recovery code after %s and clears the verification draft', async transition => {
    let complete!: (value: { ok: true; code: string }) => void;
    status.mockResolvedValue(metadata(true)); setupRecovery.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await render('app', { recoveryRequest: 1 }); await input(0, 'private verification draft'); await submit();
    await act(async () => {
      if (transition === 'lock-unlock') {
        const state = useAppLockStore.getState().state!;
        useAppLockStore.setState({ state: { ...state, phase: 'locked' } }); useAppLockStore.setState({ state });
      } else {
        useWorkspaceStore.setState({ activeWorkspaceId: 'other' }); useWorkspaceStore.setState({ activeWorkspaceId: 'current' });
      }
    });
    await act(async () => complete({ ok: true, code: 'LATE-RECOVERY-CODE' }));
    expect(container.textContent).not.toContain('LATE-RECOVERY-CODE'); expect(container.querySelector('input')).toBeNull();
    await click('Create'); expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('');
  });

  it('clears the displayed recovery code on app lock without pretending it was deleted', async () => {
    let current = metadata(true); status.mockImplementation(async () => current);
    setupRecovery.mockImplementation(async () => { current = { ...current, recoveryConfigured: true }; return { ok: true, code: 'NEW-RECOVERY-CODE' }; });
    await render('app', { recoveryRequest: 1 }); await input(0, 'typed master password'); await submit();
    const state = useAppLockStore.getState().state!;
    await act(async () => useAppLockStore.setState({ state: { ...state, phase: 'locked' } }));
    expect(container.textContent).not.toContain('NEW-RECOVERY-CODE');
    await act(async () => useAppLockStore.setState({ state }));
    expect(container.textContent).not.toContain('NEW-RECOVERY-CODE'); expect(container.textContent).toContain('Created; it opens all data.');
  });
});
const submit = async () => act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

describe('workspace password controls', () => {
  it.each([false, true])('hides set password under a master password (main=%s)', async isMain => {
    mocks.isMain = isMain; status.mockResolvedValue(metadata(true)); await render();
    expect(buttons()).not.toContain('Set password'); expect(container.textContent).toContain('Protected by the master password');
  });
  it('shows set password only for a non-main workspace without a master password', async () => {
    await render(); expect(buttons()).toContain('Set password');
  });
  it('never offers an individual password for the main workspace', async () => {
    mocks.isMain = true; await render(); expect(buttons()).not.toContain('Set password');
  });
  it('hides change under the master password but preserves remove for an existing own password', async () => {
    status.mockResolvedValue(metadata(true, true)); await render();
    expect(buttons()).not.toContain('Change'); expect(buttons()).toContain('Remove');
  });
  it('keeps change and remove for an independently protected workspace', async () => {
    status.mockResolvedValue(metadata(false, true)); await render(); expect(buttons()).toContain('Change'); expect(buttons()).toContain('Remove');
  });
  it('does not offer a password action while protection metadata is still loading', async () => {
    status.mockReturnValue(new Promise(() => {})); await render(); expect(buttons()).not.toContain('Set password');
  });
  it('removes the workspace setup action after setting the master password', async () => {
    status.mockResolvedValueOnce(metadata(false)).mockResolvedValue(metadata(true)); await render('both');
    expect(buttons()).toContain('Set password'); await click('Set master password'); await input(0, 'new secure master'); await input(1, 'new secure master'); await submit();
    expect(setMasterPassword).toHaveBeenCalledWith({ password: 'new secure master', currentPassword: undefined });
    expect(buttons()).not.toContain('Set password');
  });
  it.each(['en-US', 'zh-CN'])('explains a master-password policy race in %s without exposing the code', async language => {
    mocks.language = language; setPassword.mockResolvedValue({ ok: false, error: 'master_password_protects_workspaces' });
    await render(); await click(language === 'en-US' ? 'Set password' : '设置密码'); await input(0, 'workspace password'); await input(1, 'workspace password'); await submit();
    expect(container.textContent).toContain(language === 'en-US' ? 'already protects this workspace' : '已由主密码保护');
    expect(container.textContent).not.toContain('master_password_protects_workspaces');
  });
});
