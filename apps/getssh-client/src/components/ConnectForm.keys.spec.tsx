// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, useAppStore } from '../store/appStore';
import { useAppLockStore } from '../store/appLockStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useSessionStore, type SessionProfile } from '../store/sessionStore';
import { useSessionManager } from '../hooks/useSessionManager';
import type { AppLockState } from '../types/ipc';
import type { SshKey } from '../types/store';
import { ConnectForm, type ConnectFormSession } from './ConnectForm';
import { ConnectFormOverlay } from './app-overlays/ConnectFormOverlay';

const copy = vi.hoisted(() => ({ language: 'en-US' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: copy.language } }) }));
vi.mock('framer-motion', () => ({ motion: { button: ({ whileTap: _whileTap, ...props }: any) => <button {...props} /> } }));
const ready: AppLockState = { phase: 'ready', appProtected: false, presenceSupported: false, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false };
const key: SshKey = { id: 'key-one', name: 'Deployment', algorithm: 'ed25519', fingerprint: 'SHA256:test', publicKey: 'ssh-ed25519 AAAA test', hasPassphrase: true, created_at: 1 };
const server: SessionProfile = { id: 'server', host: 'server.test', username: 'user', authType: 'key', privateKeyPath: '/temporary/key' };
const converted: SessionProfile = { id: 'server', host: 'server.test', username: 'user', authType: 'key', keyId: key.id };
const imported = { ok: true, workspaceId: 'current', key, profiles: [converted], trashed: false };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
let root: Root;
let container: HTMLDivElement;
let list: ReturnType<typeof vi.fn>;
let importFile: ReturnType<typeof vi.fn>;
let saveProfiles: ReturnType<typeof vi.fn>;
let sshConnect: ReturnType<typeof vi.fn>;
const onUpdate = vi.fn();
const onSave = vi.fn();
const onConnect = vi.fn();
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  copy.language = 'en-US'; onUpdate.mockReset(); onSave.mockReset().mockResolvedValue(true); onConnect.mockReset();
  useAppLockStore.setState({ state: ready });
  useWorkspaceStore.setState({ activeWorkspaceId: 'current', isSwitching: false, isVaultLocked: false });
  useAppStore.setState({ appConfig: { ...DEFAULT_CONFIG, language: 'en-US' } });
  useSessionStore.getState().replaceSessions([server], 'current');
  useSessionStore.getState().setSelectedSessionIndex(0);
  list = vi.fn().mockResolvedValue({ ok: true, keys: [key] });
  importFile = vi.fn().mockResolvedValue(imported);
  saveProfiles = vi.fn().mockResolvedValue(true);
  sshConnect = vi.fn().mockResolvedValue({ success: false, error: 'Mock stops before networking' });
  window.electronAPI = {
    saveProfiles, sshConnect, selectFile: vi.fn().mockResolvedValue('/temporary/other-key'),
    assetFolders: { list: vi.fn().mockResolvedValue({ success: true, folders: [] }) },
    store: { sshKeys: { list, importProfileFile: importFile } },
  } as unknown as Window['electronAPI'];
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
const render = (session: ConnectFormSession = server) => act(async () => root.render(<ConnectForm session={session} index={0} appConfig={DEFAULT_CONFIG} isDark connecting={false} error={null} onCancel={() => {}} onConnect={onConnect} onUpdateSession={onUpdate} onSaveSession={onSave} />));
function Harness() {
  const sessions = useSessionStore(state => state.sessions);
  const selected = useSessionStore(state => state.selectedSessionIndex);
  const { syncProfiles, handleConnect } = useSessionManager();
  return <ConnectFormOverlay sessions={sessions} selectedSessionIndex={selected} activeTabId={null} appConfig={DEFAULT_CONFIG} isDark connecting={false} error={null} onCancel={() => {}} syncProfiles={syncProfiles} handleConnect={handleConnect} />;
}
const click = (text: string) => act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === text)!.click());
const chooseSource = (value: string) => act(async () => {
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="Key source"]')!;
  select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }));
});
const submitDialog = () => act(async () => document.querySelector('[role="dialog"] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const typePassphrase = (value: string) => act(async () => {
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="password"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('stored keys in the connection form', () => {
  it('selects the stored key, clears old file credentials and hides the passphrase field', async () => {
    await render({ ...server, passphrase: 'old typed passphrase', password: 'old typed password' });
    await chooseSource(key.id);
    expect(container.querySelector('input[placeholder="~/.ssh/id_ed25519"]')).toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    await act(async () => vi.advanceTimersByTime(400));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(0, expect.objectContaining({ authType: 'key', keyId: key.id, privateKeyPath: null, passphrase: null, password: undefined }));
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onSave).toHaveBeenCalledWith(0, expect.objectContaining({ authType: 'key', keyId: key.id, privateKeyPath: null, passphrase: null }));
    expect(onConnect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ keyId: key.id, password: undefined, passphrase: undefined }));
  });

  it('waits for a real save acknowledgement before useSessionManager connects by profile ID', async () => {
    useSessionStore.getState().setSessions([{ ...server, password: 'typed password', passphrase: 'typed passphrase' }]);
    const pending = deferred<boolean>(); saveProfiles.mockReturnValueOnce(pending.promise);
    await act(async () => root.render(<Harness />)); await chooseSource(key.id);
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(saveProfiles).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current', payload: [expect.objectContaining({ id: 'server', keyId: key.id, authType: 'key', privateKeyPath: null, passphrase: null, password: undefined })] });
    expect(sshConnect).not.toHaveBeenCalled();
    await act(async () => pending.resolve(true));
    expect(sshConnect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspaceId: 'current', profileId: 'server', password: undefined, passphrase: undefined }));
  });

  it('keeps file mode available and explicitly clears the stored key ID', async () => {
    await render({ ...server, keyId: key.id }); await chooseSource('');
    expect(container.querySelector('input[placeholder="~/.ssh/id_ed25519"]')).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(400));
    expect(onUpdate).toHaveBeenCalledWith(0, expect.objectContaining({ authType: 'key', keyId: null }));
  });

  it.each([true, false])('waits for saving file mode before connecting after a stored key (ack: %s)', async acknowledged => {
    useSessionStore.getState().setSessions([{ ...server, keyId: key.id, privateKeyPath: null }]);
    const pending = deferred<boolean>(); saveProfiles.mockReturnValueOnce(pending.promise);
    await act(async () => root.render(<Harness />)); await chooseSource('');
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('input[placeholder="~/.ssh/id_ed25519"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '/temporary/new-file-key');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(saveProfiles).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current', payload: [expect.objectContaining({ id: 'server', keyId: null, authType: 'key', privateKeyPath: '/temporary/new-file-key' })] });
    expect(sshConnect).not.toHaveBeenCalled();
    await act(async () => pending.resolve(acknowledged));
    if (acknowledged) expect(sshConnect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ profileId: 'server', workspaceId: 'current', privateKeyPath: '/temporary/new-file-key' }));
    else {
      expect(sshConnect).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not save');
    }
  });

  it.each([{ isDraft: true }, { isQuickConnect: true }])('does not offer file migration for an unsaved connection: %o', async flags => {
    await render({ ...server, ...flags });
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Import into GETSSH')).toBe(false);
    if ('isQuickConnect' in flags) {
      expect(container.textContent).toContain('Save this connection before using a saved key');
      expect(container.querySelector<HTMLOptionElement>(`option[value="${key.id}"]`)!.disabled).toBe(true);
    }
  });

  it.each(['workspace', 'app lock'])('ignores a late file-picker answer after a %s round trip', async transition => {
    const pending = deferred<string>(); vi.mocked(window.electronAPI.selectFile).mockReturnValueOnce(pending.promise);
    await render(); await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="common.selectFile"]')!.click());
    await act(async () => {
      if (transition === 'workspace') { useWorkspaceStore.setState({ activeWorkspaceId: 'other' }); useWorkspaceStore.setState({ activeWorkspaceId: 'current' }); }
      else { useAppLockStore.setState({ state: { ...ready, phase: 'locked' } }); useAppLockStore.setState({ state: ready }); }
    });
    await act(async () => pending.resolve('/temporary/stale-key'));
    await act(async () => vi.advanceTimersByTime(400));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('input[placeholder="~/.ssh/id_ed25519"]')!.value).toBe(server.privateKeyPath);
  });
});

describe('importing a saved profile key file', () => {
  it('keeps its passphrase retry flow, adopts complete profiles with drafts and quick connections, and never saves the response again', async () => {
    const draft: SessionProfile = { id: 'draft', isDraft: true, host: '', username: '' };
    const quick: SessionProfile = { id: 'quick', isQuickConnect: true, host: 'quick.test', username: 'user' };
    useSessionStore.getState().setSessions([draft, server, quick]); useSessionStore.getState().setSelectedSessionIndex(1);
    importFile.mockResolvedValueOnce({ ok: false, error: 'needs_password' }).mockResolvedValueOnce({ ok: false, error: 'wrong_password' });
    await act(async () => root.render(<Harness />)); await click('Import into GETSSH');
    expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.checked).toBe(false);
    await submitDialog();
    expect(importFile).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 'current', profileId: 'server', trashOriginal: false, language: 'en-US' }));
    await typePassphrase('wrong'); await submitDialog();
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('incorrect');
    expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="password"]')!.value).toBe('');
    await typePassphrase('correct'); await submitDialog();
    expect(importFile).toHaveBeenCalledTimes(3);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(useSessionStore.getState().sessions).toEqual([converted, draft, quick]);
    expect(useSessionStore.getState().selectedSessionIndex).toBe(0);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('original file was kept');
    expect(saveProfiles).not.toHaveBeenCalled(); expect(window.confirm).not.toHaveBeenCalled();
  });

  it.each([
    { trashed: true, text: 'moved to the Trash' },
    { kept: 'used_elsewhere', text: 'other connections or GETSSH 2.0' },
    { kept: 'workspaces_locked', text: 'Some workspaces are locked' },
    { kept: 'declined', text: 'kept as requested' },
    { kept: 'trash_failed', text: 'could not be moved to the Trash' },
  ])('explains the original-file outcome: $text', async outcome => {
    importFile.mockResolvedValue({ ...imported, ...outcome });
    await render(); await click('Import into GETSSH');
    await act(async () => document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.click());
    await submitDialog();
    expect(importFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ trashOriginal: true, language: 'en-US' }));
    expect(container.querySelector('[role="status"]')?.textContent).toContain(outcome.text);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('passes Chinese to the native Trash confirmation', async () => {
    copy.language = 'zh-CN'; await render(); await click('导入到 GETSSH'); await submitDialog();
    expect(importFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ language: 'zh-CN', trashOriginal: false }));
  });

  it('drops an entered passphrase on Cancel and starts a new import without retaining it', async () => {
    importFile.mockResolvedValue({ ok: false, error: 'needs_password' });
    await render(); await click('Import into GETSSH'); await submitDialog();
    await typePassphrase('discard this passphrase'); await click('Cancel');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click('Import into GETSSH'); await submitDialog();
    expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="password"]')!.value).toBe('');
    expect(importFile).toHaveBeenCalledTimes(2);
    expect(importFile.mock.calls.every(([request]) => request.passphrase === undefined)).toBe(true);
  });

  it.each(['unsupported_key', 'io', 'not_found', 'cancelled'])('handles %s without echoing file details or saving profiles', async error => {
    importFile.mockResolvedValue({ ok: false, error }); await render(); await click('Import into GETSSH'); await submitDialog();
    if (error === 'cancelled') expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
    else expect(document.querySelector('[role="dialog"] [role="alert"]')).not.toBeNull();
    expect(saveProfiles).not.toHaveBeenCalled(); expect(useSessionStore.getState().sessions).toEqual([server]);
  });

  it.each(['workspace cycle', 'app lock cycle', 'vault lock cycle', 'unmount', 'other response workspace'])('drops late imported profiles after %s', async transition => {
    const pending = deferred<typeof imported>(); importFile.mockReturnValueOnce(pending.promise);
    await render(); await click('Import into GETSSH'); await submitDialog();
    await act(async () => {
      if (transition === 'workspace cycle') { useWorkspaceStore.setState({ activeWorkspaceId: 'other' }); useWorkspaceStore.setState({ activeWorkspaceId: 'current' }); }
      else if (transition === 'app lock cycle') { useAppLockStore.setState({ state: { ...ready, phase: 'locked' } }); useAppLockStore.setState({ state: ready }); }
      else if (transition === 'vault lock cycle') { useWorkspaceStore.setState({ isVaultLocked: true }); useWorkspaceStore.setState({ isVaultLocked: false }); }
      else if (transition === 'unmount') root.render(null);
    });
    await act(async () => pending.resolve({ ...imported, ...(transition === 'other response workspace' ? { workspaceId: 'other' } : {}) }));
    expect(useSessionStore.getState().sessions).toEqual([server]); expect(saveProfiles).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
