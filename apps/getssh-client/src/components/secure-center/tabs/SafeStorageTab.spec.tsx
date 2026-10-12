// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecurityStatus } from '../../../types/ipc';

const mocks = vi.hoisted(() => ({ isMain: false, language: 'en-US', initWorkspaces: vi.fn(), addToast: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: mocks.language } }) }));
vi.mock('../../../store/appStore', () => ({ useAppStore: (select: (state: any) => any) => select({ isMac: true, addToast: mocks.addToast }) }));
vi.mock('../../../store/cryptoStore', () => ({ useCryptoStore: Object.assign((select: (state: any) => any) => select({}), { getState: () => ({ setWorkspaceUnprotected: vi.fn() }) }) }));
vi.mock('../../../store/workspaceStore', () => ({ useWorkspaceStore: Object.assign((select: (state: any) => any) => select({ activeWorkspaceId: 'current', workspaces: [{ id: 'current', name: 'Current', isMain: mocks.isMain }] }), { getState: () => ({ initWorkspaces: mocks.initWorkspaces }) }) }));
import { SafeStorageTab } from './SafeStorageTab';

const metadata = (appProtected: boolean, ownPassword = false): SecurityStatus => ({ appProtected, recoveryConfigured: false, presenceSupported: false, deviceBackend: null, scopes: [{ id: 'ws:current', workspaceId: 'current', protected: appProtected || ownPassword, ownPassword, presence: false, unlocked: true, recovery: false, revealRemainingMs: null }] });
let root: Root;
let container: HTMLDivElement;
let status: ReturnType<typeof vi.fn>;
let setPassword: ReturnType<typeof vi.fn>;
let setMasterPassword: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.isMain = false; mocks.language = 'en-US'; vi.clearAllMocks();
  status = vi.fn().mockResolvedValue(metadata(false));
  setPassword = vi.fn().mockResolvedValue({ ok: true });
  setMasterPassword = vi.fn().mockResolvedValue({ ok: true, recoveryReset: false });
  window.electronAPI = { security: { status, setMasterPassword }, workspace: { setPassword } } as unknown as Window['electronAPI'];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async (section: 'vault' | 'both' = 'vault') => act(async () => root.render(<SafeStorageTab section={section} />));
const buttons = () => Array.from(container.querySelectorAll('button')).map(button => button.textContent);
const click = async (text: string) => act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === text)!.click());
const input = async (index: number, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(container.querySelectorAll('input')[index], value);
  container.querySelectorAll('input')[index].dispatchEvent(new Event('input', { bubbles: true }));
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
