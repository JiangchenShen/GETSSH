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
const server: SessionProfile = { id: 'server', host: 'server.test', username: 'user', authType: 'key', keyId: null, privateKeyPath: '/temporary/key' };
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
  useAppStore.setState({ appConfig: { ...DEFAULT_CONFIG, language: 'en-US' }, isMac: true });
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
    security: { status: vi.fn().mockResolvedValue(null) },
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
const typeConnectionField = (selector: string, value: string) => act(async () => {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const submitConnection = () => act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

describe('stored keys in the connection form', () => {
  it.each(['file', 'saved key'])('R51 saves a new server using a %s after its debounce and waits before connecting', async source => {
    useSessionStore.getState().setSessions([{ ...server, isDraft: true, privateKeyPath: undefined }]);
    await act(async () => root.render(<Harness />));
    if (source === 'file') await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="common.selectFile"]')!.click());
    else await chooseSource(key.id);
    await act(async () => vi.advanceTimersByTime(400));
    expect(useSessionStore.getState().sessions[0].isDraft).toBe(true);
    const pending = deferred<boolean>(); saveProfiles.mockClear(); saveProfiles.mockReturnValueOnce(pending.promise);
    await submitConnection();
    expect(saveProfiles).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current', payload: [expect.objectContaining({
      id: 'server', isDraft: false, authType: 'key', keyId: source === 'file' ? null : key.id,
      privateKeyPath: source === 'file' ? '/temporary/other-key' : null,
    })] });
    expect(sshConnect).not.toHaveBeenCalled();
    await act(async () => pending.resolve(true));
    expect(useSessionStore.getState().sessions[0]).toMatchObject({ isDraft: false });
    expect(sshConnect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspaceId: 'current', profileId: 'server' }));
  });

  it('R51 waits for the current username to save when connecting before the debounce', async () => {
    const pending = deferred<boolean>(); saveProfiles.mockReturnValueOnce(pending.promise);
    await act(async () => root.render(<Harness />));
    await typeConnectionField('input[autocomplete="username"]', 'changed-user');
    await submitConnection();
    expect(saveProfiles).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current', payload: [expect.objectContaining({ id: 'server', username: 'changed-user', keyId: null })] });
    expect(sshConnect).not.toHaveBeenCalled();
    await act(async () => pending.resolve(true));
    expect(sshConnect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ profileId: 'server', username: 'changed-user' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(saveProfiles).toHaveBeenCalledTimes(1);
  });

  it('R51 connects an unchanged saved server with an omitted keyId without saving', async () => {
    // Connections created in this run can omit keyId; persisted ones have keyId: null.
    useSessionStore.getState().setSessions([{ ...server, keyId: undefined }]);
    saveProfiles.mockResolvedValue(false);
    await act(async () => root.render(<Harness />)); await submitConnection();
    expect(saveProfiles).not.toHaveBeenCalled();
    expect(sshConnect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ profileId: 'server' }));
  });

  it('R51 keeps a quick connection with pending edits temporary and never saves it', async () => {
    useSessionStore.getState().setSessions([{ ...server, isDraft: true, isQuickConnect: true }]);
    await act(async () => root.render(<Harness />));
    await typeConnectionField('input[autocomplete="username"]', 'quick-user');
    await submitConnection();
    expect(saveProfiles).not.toHaveBeenCalled();
    expect(useSessionStore.getState().sessions[0]).toMatchObject({ username: 'quick-user', isQuickConnect: true });
    expect(sshConnect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ username: 'quick-user', profileId: undefined }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(saveProfiles).not.toHaveBeenCalled();
  });

  it('R54 exposes protocol help as a modal dialog', async () => {
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="connection.protocol.label"]')!.click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBe('connection.protocol.label');
  });

  it.each([null, key.id])('connects an unchanged saved key selection (%s) without a whole-list save', async keyId => {
    useSessionStore.getState().setSessions([{ ...server, keyId }]);
    saveProfiles.mockResolvedValue(false);
    await act(async () => root.render(<Harness />)); await submitConnection();
    expect(saveProfiles).not.toHaveBeenCalled();
    expect(sshConnect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspaceId: 'current', profileId: 'server' }));
  });

  it('flushes unfinished debounced profile edits when connecting without changing keys', async () => {
    await act(async () => root.render(<Harness />));
    await typeConnectionField('input[placeholder="connection.placeholder.alias"]', 'Updated host');
    await submitConnection();
    expect(saveProfiles).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current', payload: [expect.objectContaining({ keyId: null, alias: 'Updated host' })] });
    expect(sshConnect).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(400));
    expect(saveProfiles).toHaveBeenCalledTimes(1);
  });

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

  // R33: a keyId left on a password server made the connection try only the stored key.
  it('drops the stored key when the server switches back to password login', async () => {
    useSessionStore.getState().setSessions([{ ...server, keyId: key.id, privateKeyPath: null }]);
    await act(async () => root.render(<Harness />));
    await click('connection.password');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(saveProfiles).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current', payload: [expect.objectContaining({ id: 'server', authType: 'password', keyId: null })] });
  });

  // R34: undefined means "keep", so choosing a key must not turn a pending clear back into a keep.
  it('keeps a pending "clear saved password" when a stored key is chosen', async () => {
    useSessionStore.getState().setSessions([{ id: 'server', host: 'server.test', username: 'user', authType: 'password', hasPassword: true, keyId: null }]);
    await act(async () => root.render(<Harness />));
    await click('Clear saved password'); await click('connection.privateKey'); await chooseSource(key.id);
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(saveProfiles).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current', payload: [expect.objectContaining({ id: 'server', authType: 'key', keyId: key.id, password: '', hasPassword: false })] });
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
  it('R52 blocks key import while a typed passphrase waits for the autosave debounce', async () => {
    await render();
    const importButton = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Import into GETSSH')!;
    expect(importButton().disabled).toBe(false);
    await typeConnectionField('input[type="password"]', 'new passphrase');
    expect(importButton().disabled).toBe(true);
    await click('Import into GETSSH');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => vi.advanceTimersByTime(399));
    expect(importButton().disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(1));
    expect(onUpdate).toHaveBeenCalledWith(0, expect.objectContaining({ keyId: null, passphrase: 'new passphrase' }));
    expect(importButton().disabled).toBe(false);
    await click('Import into GETSSH');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('allows importing after a failed connection leaves a typed passphrase', async () => {
    await render(); await typeConnectionField('input[type="password"]', 'retry passphrase');
    await act(async () => vi.advanceTimersByTime(400)); await submitConnection();
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ keyId: null, passphrase: 'retry passphrase' }));
    // Authentication failed; the parent still supplies its saved, secret-free metadata.
    await act(async () => root.render(<ConnectForm session={server} index={0} appConfig={DEFAULT_CONFIG} isDark connecting={false} error="Authentication failed" onCancel={() => {}} onConnect={onConnect} onUpdateSession={onUpdate} onSaveSession={onSave} />));
    expect(container.textContent).toContain('Authentication failed');
    expect(container.textContent).not.toContain('Wait for connection changes');
    await click('Import into GETSSH'); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await submitDialog(); expect(importFile).toHaveBeenCalledTimes(1);
  });

  it('asks to save a pending passphrase clear, then allows import after the explicit save', async () => {
    useSessionStore.getState().setSessions([{ ...server, hasPassphrase: true }]);
    await act(async () => root.render(<Harness />)); await click('Clear saved passphrase');
    const importButton = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Import into GETSSH')!;
    expect(importButton().disabled).toBe(true);
    expect(container.textContent).toContain('Click “Save changes” before importing the key.');
    expect(container.textContent).not.toContain('Wait for connection changes');
    await act(async () => vi.advanceTimersByTime(400));
    expect(saveProfiles).not.toHaveBeenCalled();
    await click('Save changes');
    expect(saveProfiles).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current', payload: [expect.objectContaining({ keyId: null, passphrase: '', hasPassphrase: false })] });
    expect(importButton().disabled).toBe(false);
    expect(container.textContent).not.toContain('marked for clearing');
    await click('Import into GETSSH'); await submitDialog(); expect(importFile).toHaveBeenCalledTimes(1);
  });

  it('waits for actual connection edits to be saved before importing a key file', async () => {
    await act(async () => root.render(<Harness />));
    await typeConnectionField('input[placeholder="connection.placeholder.alias"]', 'New alias');
    const importButton = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Import into GETSSH')!;
    expect(importButton().disabled).toBe(true); expect(container.textContent).toContain('Wait for connection changes');
    await act(async () => vi.advanceTimersByTime(400));
    expect(saveProfiles).toHaveBeenCalledTimes(1); expect(importButton().disabled).toBe(false);
  });

  it('keeps its passphrase retry flow, adopts complete profiles with drafts and quick connections, and never saves the response again', async () => {
    const draft: SessionProfile = { id: 'draft', isDraft: true, host: '', username: '', keyId: null };
    const quick: SessionProfile = { id: 'quick', isQuickConnect: true, host: 'quick.test', username: 'user', keyId: null };
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
    { kept: 'used_elsewhere', text: 'GETSSH 2.0 server list is still present' },
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

  it.each([
    { language: 'en-US', isMac: false, name: 'Recycle Bin' },
    { language: 'en-US', isMac: true, name: 'Trash' },
    { language: 'zh-CN', isMac: false, name: '回收站' },
    { language: 'zh-CN', isMac: true, name: '废纸篓' },
  ])('uses $name for the import option and success/failure outcomes ($language)', async ({ language, isMac, name }) => {
    copy.language = language; useAppStore.setState({ isMac });
    await render(); await click(language.startsWith('zh') ? '导入到 GETSSH' : 'Import into GETSSH');
    expect(document.querySelector('[role="dialog"] label')?.textContent).toContain(name);
    importFile.mockResolvedValueOnce({ ...imported, trashed: false, kept: 'trash_failed' });
    await submitDialog(); expect(container.querySelector('[role="status"]')?.textContent).toContain(name);
    importFile.mockResolvedValueOnce({ ...imported, trashed: true });
    await click(language.startsWith('zh') ? '导入到 GETSSH' : 'Import into GETSSH'); await submitDialog();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(name);
  });

  it.each([
    { language: 'zh-CN', text: 'GETSSH 里还有服务器在用这个文件，或者 GETSSH 2.0 的服务器列表还在，原文件已保留。' },
    { language: 'en-US', text: 'A server in GETSSH still uses this file, or the GETSSH 2.0 server list is still present. The original file was kept.' },
  ])('explains that an existing GETSSH 2.0 server list alone keeps the original ($language)', async ({ language, text }) => {
    copy.language = language; importFile.mockResolvedValue({ ...imported, kept: 'used_elsewhere' });
    await render(); await click(language.startsWith('zh') ? '导入到 GETSSH' : 'Import into GETSSH'); await submitDialog();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(text);
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

  // R35: main has already saved the list. Dropping it would leave keyId null and the old path in
  // the window, and its next whole-list save would put the server back on the (maybe trashed) file.
  it.each(['workspace cycle', 'app lock cycle', 'vault lock cycle', 'unmount', 'another save'])('still takes the saved profiles of a late import after %s, without its notice', async transition => {
    const pending = deferred<typeof imported>(); importFile.mockReturnValueOnce(pending.promise);
    await render(); await click('Import into GETSSH'); await submitDialog();
    await act(async () => {
      if (transition === 'workspace cycle') { useWorkspaceStore.setState({ activeWorkspaceId: 'other' }); useWorkspaceStore.setState({ activeWorkspaceId: 'current' }); }
      else if (transition === 'app lock cycle') { useAppLockStore.setState({ state: { ...ready, phase: 'locked' } }); useAppLockStore.setState({ state: ready }); }
      else if (transition === 'vault lock cycle') { useWorkspaceStore.setState({ isVaultLocked: true }); useWorkspaceStore.setState({ isVaultLocked: false }); }
      else if (transition === 'unmount') root.render(null);
      else useSessionStore.getState().replaceSessions([{ ...server }], 'current');
    });
    await act(async () => pending.resolve(imported));
    expect(useSessionStore.getState().sessions).toEqual([converted]); expect(saveProfiles).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it.each(['other response workspace', 'still locked', 'still switching'])('drops a late import for %s', async transition => {
    const pending = deferred<typeof imported>(); importFile.mockReturnValueOnce(pending.promise);
    await render(); await click('Import into GETSSH'); await submitDialog();
    await act(async () => {
      if (transition === 'still locked') useAppLockStore.setState({ state: { ...ready, phase: 'locked' } });
      else if (transition === 'still switching') useWorkspaceStore.setState({ isSwitching: true });
    });
    await act(async () => pending.resolve({ ...imported, ...(transition === 'other response workspace' ? { workspaceId: 'other' } : {}) }));
    expect(useSessionStore.getState().sessions).toEqual([server]); expect(saveProfiles).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
