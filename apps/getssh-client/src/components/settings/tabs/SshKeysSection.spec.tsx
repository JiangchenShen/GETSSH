// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppLockState } from '../../../types/ipc';
import type { SshKey, StoreResult } from '../../../types/store';
import type { SessionProfile } from '../../../store/sessionStore';
import { useAppLockStore } from '../../../store/appLockStore';
import { useBackupRestartStore } from '../../../store/backupStore';

const mocks = vi.hoisted(() => ({ language: 'en-US', replace: vi.fn(), save: vi.fn(), copy: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: mocks.language } }) }));
vi.mock('../../../store/workspaceStore', async () => {
  const { create } = await import('zustand');
  return { useWorkspaceStore: create(() => ({
    activeWorkspaceId: 'current', isSwitching: false, isVaultLocked: false,
    workspaces: [{ id: 'current', name: 'Production' }, { id: 'other', name: 'Other' }],
  })) };
});
vi.mock('../../../store/sessionStore', async () => {
  const { create } = await import('zustand');
  return { useSessionStore: create((set: (value: any) => void) => ({
    sessions: [] as SessionProfile[], profilesWorkspaceId: 'current', selectedSessionIndex: null as number | null,
    replaceSessions: (sessions: SessionProfile[], workspaceId: string) => { mocks.replace(sessions, workspaceId); set({ sessions, profilesWorkspaceId: workspaceId }); },
    setSelectedSessionIndex: (selectedSessionIndex: number | null) => set({ selectedSessionIndex }),
  })) };
});
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { useSessionStore } from '../../../store/sessionStore';
import { SshKeysSection } from './SshKeysSection';

const ready = (): AppLockState => ({ phase: 'ready', appProtected: false, presenceSupported: false, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false });
const key = (id = 'key-1'): SshKey => ({ id, name: `Key ${id}`, algorithm: 'ed25519', fingerprint: `SHA256:${id}`, publicKey: `ssh-ed25519 AAAA${id} test`, hasPassphrase: false, created_at: new Date('2026-10-18T10:00:00Z').getTime() });
const saved = (id: string): SessionProfile => ({ id, host: `${id}.example`, username: 'ops', alias: `Server ${id}`, keyId: 'key-1', authType: 'key' });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
};
let root: Root;
let container: HTMLDivElement;
let api: { list: ReturnType<typeof vi.fn>; chooseFile: ReturnType<typeof vi.fn>; import: ReturnType<typeof vi.fn>; generate: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); mocks.language = 'en-US'; mocks.copy.mockResolvedValue(undefined);
  useAppLockStore.setState({ state: ready() });
  useBackupRestartStore.setState({ report: null });
  useWorkspaceStore.setState({ activeWorkspaceId: 'current', isSwitching: false, isVaultLocked: false });
  useSessionStore.setState({ sessions: [saved('one'), saved('two')], profilesWorkspaceId: 'current', selectedSessionIndex: 0 });
  api = {
    list: vi.fn().mockResolvedValue({ ok: true, keys: [key()] }),
    chooseFile: vi.fn().mockResolvedValue({ ok: true, fileId: 'file-token', fileName: 'id_ed25519', encrypted: false }),
    import: vi.fn().mockResolvedValue({ ok: true, key: key('imported') }),
    generate: vi.fn().mockResolvedValue({ ok: true, key: key('generated') }),
    delete: vi.fn().mockResolvedValue({ ok: true, workspaceId: 'current', profiles: [saved('two'), saved('one')].map(profile => ({ ...profile, keyId: null })) }),
  };
  window.electronAPI = { store: { sshKeys: api }, saveProfiles: mocks.save } as unknown as Window['electronAPI'];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.copy } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); useAppLockStore.setState({ state: null }); useBackupRestartStore.setState({ report: null });
});
const render = () => act(async () => root.render(<SshKeysSection />));
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
const field = (label: string) => [...container.querySelectorAll('label')].find(item => item.querySelector('span')?.textContent === label)!.querySelector<HTMLInputElement>('input')!;
const input = (label: string, value: string) => act(async () => {
  const element = field(label);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
});
const submit = () => act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

describe('current workspace private keys', () => {
  it('shows actual metadata and counts saved servers, excluding drafts and quick connections', async () => {
    useSessionStore.setState({ sessions: [saved('one'), saved('two'), { ...saved('draft'), isDraft: true }, { ...saved('quick'), isQuickConnect: true }] });
    await render();
    expect(api.list).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current' });
    expect(container.textContent).toContain('Private keys · Current workspace');
    expect(container.textContent).toContain('Production');
    expect(container.textContent).toContain('ed25519');
    expect(container.querySelector('[title="SHA256:key-1"]')?.textContent).toBe('SHA256:key-1');
    expect(container.textContent).toContain(new Date(key().created_at).toLocaleString('en-US'));
    expect(container.textContent).toContain('Used by 2 servers');
  });

  it('requests a missing passphrase, retains the file after a wrong attempt, then imports successfully', async () => {
    api.import.mockResolvedValueOnce({ ok: false, error: 'needs_password' }).mockResolvedValueOnce({ ok: false, error: 'wrong_password' }).mockResolvedValue({ ok: true, key: key('imported') });
    await render(); await click('Import private key'); await input('Name', 'Production key'); await submit();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(field('Private key passphrase')).toBe(document.activeElement);
    expect(container.textContent).toContain('Enter the private key passphrase');
    await input('Private key passphrase', 'wrong phrase'); await submit();
    expect(field('Name').value).toBe('Production key');
    expect(field('Private key passphrase').value).toBe('');
    expect(container.textContent).toContain('Incorrect passphrase');
    await input('Private key passphrase', 'correct phrase'); await submit();
    expect(api.import).toHaveBeenLastCalledWith({ workspaceId: 'current', fileId: 'file-token', name: 'Production key', passphrase: 'correct phrase' });
    expect(api.chooseFile).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('Private key imported.');
    expect(container.textContent).not.toContain('correct phrase');
  });

  it('asks for the passphrase of an encrypted file before sending an import request', async () => {
    api.chooseFile.mockResolvedValue({ ok: true, fileId: 'encrypted-token', fileName: 'protected.ppk', encrypted: true });
    await render(); await click('Import private key');
    expect(api.import).not.toHaveBeenCalled();
    expect(field('Private key passphrase')).toBe(document.activeElement);
    expect(button('Import').disabled).toBe(true);
    await input('Private key passphrase', 'typed only'); await submit();
    expect(api.import).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current', fileId: 'encrypted-token', name: 'protected.ppk', passphrase: 'typed only' });
  });

  it('requires a new file token after expiration', async () => {
    api.import.mockResolvedValueOnce({ ok: false, error: 'not_found' }).mockResolvedValue({ ok: true, key: key('imported') });
    await render(); await click('Import private key'); await submit();
    expect(container.textContent).toContain('The selected file has expired');
    expect(button('Import').disabled).toBe(true);
    api.chooseFile.mockResolvedValue({ ok: true, fileId: 'new-token', fileName: 'new.pem', encrypted: false });
    await click('Choose file again'); await submit();
    expect(api.import).toHaveBeenLastCalledWith({ workspaceId: 'current', fileId: 'new-token', name: 'new.pem', passphrase: undefined });
  });

  it('handles file cancellation quietly and explains unsupported formats including DSA', async () => {
    api.chooseFile.mockResolvedValueOnce({ ok: false, error: 'cancelled' }).mockResolvedValue({ ok: false, error: 'unsupported_key' });
    await render(); await click('Import private key');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await click('Import private key');
    expect(container.textContent).toContain('DSA is not supported');
    expect(container.textContent).toContain('OpenSSH, PEM or PPK v2/v3');
    expect(api.import).not.toHaveBeenCalled();
  });

  it('generates Ed25519 through the API and shows a copyable public line with server instructions', async () => {
    await render(); await click('Generate private key'); await input('Name', 'New operations key'); await submit();
    expect(api.generate).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current', name: 'New operations key' });
    expect(container.querySelector('textarea')?.value).toBe(key('generated').publicKey);
    expect(container.textContent).toContain('~/.ssh/authorized_keys');
    const publicCopy = container.querySelector('[role="dialog"] button') as HTMLButtonElement;
    await act(async () => publicCopy.click());
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(key('generated').publicKey);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Public key copied.');
  });

  it('copies the selected key public metadata and reports clipboard errors', async () => {
    api.list.mockResolvedValue({ ok: true, keys: [key(), key('second')] });
    await render(); await click('Copy public key for Key second');
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(key('second').publicKey);
    mocks.copy.mockRejectedValueOnce(new Error('clipboard unavailable'));
    await click('Copy public key for Key key-1');
    expect(container.textContent).toContain('Could not copy the public key');
    expect(container.textContent).not.toContain('clipboard unavailable');
  });

  it.each(['draft', 'quick', 'two'])('adopts deletion profiles once, preserving %s and other temporary profiles', async selected => {
    const draft = { ...saved('draft'), isDraft: true };
    const quick = { ...saved('quick'), isQuickConnect: true };
    const profiles = [saved('one'), saved('two'), draft, quick];
    useSessionStore.setState({ sessions: profiles, selectedSessionIndex: profiles.findIndex(profile => profile.id === selected) });
    const returned = [saved('two'), saved('one'), saved('new')].map(profile => ({ ...profile, keyId: null }));
    api.list.mockResolvedValueOnce({ ok: true, keys: [key()] }).mockResolvedValue({ ok: true, keys: [] });
    api.delete.mockResolvedValue({ ok: true, workspaceId: 'current', profiles: returned });
    await render(); await click('Delete private key Key key-1');
    const confirmation = container.querySelector('[role="dialog"]')!;
    expect(confirmation.textContent).toContain('Server one'); expect(confirmation.textContent).toContain('Server two');
    expect(confirmation.textContent).not.toContain('Server draft'); expect(confirmation.textContent).not.toContain('Server quick');
    await submit();
    const state = useSessionStore.getState();
    expect(state.sessions).toEqual([...returned, draft, quick]);
    expect(state.sessions[state.selectedSessionIndex!].id).toBe(selected);
    expect(state.sessions).toContain(draft); expect(state.sessions).toContain(quick);
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith([...returned, draft, quick], 'current');
    expect(mocks.save).not.toHaveBeenCalled();
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('No private keys saved in this workspace yet.');
    expect(container.textContent).not.toContain('SHA256:key-1');
  });

  it('discards a deletion list returned for another workspace', async () => {
    api.delete.mockResolvedValue({ ok: true, workspaceId: 'other', profiles: [saved('foreign')] });
    await render(); await click('Delete private key Key key-1'); await submit();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(useSessionStore.getState().sessions.map(profile => profile.id)).toEqual(['one', 'two']);
    expect(container.textContent).not.toContain('Private key deleted.');
  });

  it('does not report zero references or allow deletion before the current profile list is known', async () => {
    useSessionStore.setState({ profilesWorkspaceId: null });
    await render();
    expect(container.textContent).toContain('References not loaded');
    expect(container.textContent).not.toContain('Used by 0 servers');
    expect(button('Delete private key Key key-1').disabled).toBe(true);
  });

  it('blocks mutations after a locked response until a fresh list confirms access', async () => {
    api.list.mockResolvedValueOnce({ ok: false, error: 'locked' }).mockResolvedValue({ ok: true, keys: [key()] });
    await render();
    expect(button('Generate private key').disabled).toBe(true);
    expect(button('Import private key').disabled).toBe(true);
    await click('Refresh keys');
    expect(button('Generate private key').disabled).toBe(false);
    expect(container.textContent).toContain('SHA256:key-1');
  });

  it('discards an old list even when switching away and back happens before React renders', async () => {
    const old = deferred<StoreResult<{ keys: SshKey[] }>>();
    api.list.mockReturnValueOnce(old.promise).mockResolvedValue({ ok: true, keys: [key('fresh')] });
    await render();
    await act(async () => { useWorkspaceStore.setState({ activeWorkspaceId: 'other' }); useWorkspaceStore.setState({ activeWorkspaceId: 'current' }); });
    await act(async () => old.resolve({ ok: true, keys: [key('old')] }));
    expect(api.list.mock.calls.map(([request]) => request.workspaceId)).toEqual(['current', 'other', 'current']);
    expect(container.textContent).toContain('Key fresh'); expect(container.textContent).not.toContain('Key old');
  });

  it('discards a late file choice after changing workspaces', async () => {
    const choice = deferred<StoreResult<{ fileId: string; fileName: string; encrypted: boolean }>>();
    api.chooseFile.mockReturnValue(choice.promise);
    await render(); await click('Import private key');
    await act(async () => useWorkspaceStore.setState({ activeWorkspaceId: 'other' }));
    await act(async () => choice.resolve({ ok: true, fileId: 'stale', fileName: 'stale-secret-name', encrypted: true }));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).not.toContain('stale-secret-name'); expect(api.import).not.toHaveBeenCalled();
  });

  it.each(['app', 'workspace', 'switching', 'backup'])('clears a pending passphrase on %s protection changes and ignores its late result', async change => {
    const result = deferred<StoreResult<{ key: SshKey }>>();
    api.chooseFile.mockResolvedValue({ ok: true, fileId: 'encrypted', fileName: 'protected', encrypted: true });
    api.import.mockReturnValue(result.promise);
    await render(); await click('Import private key'); await input('Private key passphrase', 'temporary passphrase'); await submit();
    await act(async () => {
      if (change === 'app') useAppLockStore.setState({ state: { ...ready(), phase: 'locked' } });
      else if (change === 'workspace') useWorkspaceStore.setState({ isVaultLocked: true });
      else if (change === 'switching') useWorkspaceStore.setState({ isSwitching: true });
      else useBackupRestartStore.setState({ report: { workspaceIds: ['current'], backupPath: '/tmp/old-test-data' } });
    });
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).not.toContain('SHA256:key-1');
    expect(button('Generate private key').disabled).toBe(true);
    await act(async () => result.resolve({ ok: true, key: key('late') }));
    expect(container.textContent).not.toContain('Private key imported.');
    expect(container.textContent).not.toContain('temporary passphrase');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('ignores a late deletion result after leaving and returning to the same workspace', async () => {
    const result = deferred<StoreResult<{ workspaceId: string; profiles: SessionProfile[] }>>();
    api.delete.mockReturnValue(result.promise);
    await render(); await click('Delete private key Key key-1'); await submit();
    await act(async () => { useWorkspaceStore.setState({ activeWorkspaceId: 'other' }); useWorkspaceStore.setState({ activeWorkspaceId: 'current' }); });
    await act(async () => result.resolve({ ok: true, workspaceId: 'current', profiles: [] }));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(useSessionStore.getState().sessions).toHaveLength(2);
  });

  it('uses Chinese instructions and keeps modal keyboard focus contained', async () => {
    mocks.language = 'zh-CN';
    await render(); button('生成私钥').focus(); await click('生成私钥');
    expect(container.textContent).toContain('私钥 · 当前工作区');
    expect(field('名称')).toBe(document.activeElement);
    await input('名称', '开发密钥');
    const confirm = button('生成'); confirm.focus();
    await act(async () => confirm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(field('名称')).toBe(document.activeElement);
    await act(async () => field('名称').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(button('生成私钥')).toBe(document.activeElement);
  });
});
