// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppLockStore } from '../../store/appLockStore';
import { DEFAULT_CONFIG, useAppStore } from '../../store/appStore';
import { useSessionStore, type SessionProfile } from '../../store/sessionStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { AppLockState } from '../../types/ipc';
import { LegacyV2Import } from './LegacyV2Import';
import { ConnectFormOverlay } from './ConnectFormOverlay';
import { useSessionManager } from '../../hooks/useSessionManager';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }) }));
vi.mock('framer-motion', () => ({ motion: { button: ({ whileTap: _whileTap, ...props }: any) => <button {...props} /> } }));

const appState: AppLockState = {
  phase: 'ready', appProtected: false, presenceSupported: false, presenceEnabled: false,
  recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false,
};
const profiles: SessionProfile[] = [{ id: 'imported', host: 'legacy.test', username: 'user', port: 2222, hasPassword: true }];
const imported = { ok: true, status: 'imported', imported: 1, skipped: 0, workspaceId: 'current', profiles };
const waiting = { ok: true, kind: 'encrypted', needsPassword: true, imported: null };
const noData = { ok: true, kind: 'none', needsPassword: false, imported: null };
const withMissingPort = {
  ok: true, kind: 'plain', needsPassword: false,
  imported: { at: 0, source: 'profiles', imported: 1, skipped: 0, changed: false, portDefaulted: 1 },
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
let root: Root;
let container: HTMLDivElement;
let status: ReturnType<typeof vi.fn>;
let importV2: ReturnType<typeof vi.fn>;
let applyDefaultPort: ReturnType<typeof vi.fn>;
let dismissV2: ReturnType<typeof vi.fn>;
let saveProfiles: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useAppLockStore.setState({ state: { ...appState } });
  useWorkspaceStore.setState({ activeWorkspaceId: 'current', isSwitching: false, isVaultLocked: false });
  useSessionStore.getState().setSessions([{ id: 'existing', host: 'existing.test', username: 'user' }]);
  useAppStore.setState({ appConfig: { ...DEFAULT_CONFIG, defaultPort: 2222 }, isConfigLoaded: true });
  status = vi.fn().mockResolvedValue(waiting);
  importV2 = vi.fn().mockResolvedValue(imported);
  applyDefaultPort = vi.fn().mockResolvedValue({ ok: true, status: 'applied', changed: 1, workspaceId: 'current', profiles });
  dismissV2 = vi.fn().mockResolvedValue({ ok: true, status: 'dismissed' });
  saveProfiles = vi.fn().mockResolvedValue(true);
  window.electronAPI = { saveProfiles, assetFolders: { list: vi.fn().mockResolvedValue({ success: true, folders: [] }) }, store: { legacyV2: { status, import: importV2, applyDefaultPort, dismiss: dismissV2 } } } as unknown as Window['electronAPI'];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const render = () => act(async () => root.render(<LegacyV2Import />));
const typePassword = (value: string) => act(async () => {
  const input = container.querySelector<HTMLInputElement>('[role="dialog"] input[type="password"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const submit = () => act(async () => container.querySelector('[role="dialog"] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const click = (label: string) => act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === label)!.click());
function EditingHarness() {
  const sessions = useSessionStore(state => state.sessions);
  const selectedSessionIndex = useSessionStore(state => state.selectedSessionIndex);
  const appConfig = useAppStore(state => state.appConfig);
  const { syncProfiles, handleConnect } = useSessionManager();
  return <><LegacyV2Import /><ConnectFormOverlay sessions={sessions} selectedSessionIndex={selectedSessionIndex} activeTabId={null}
    appConfig={appConfig} isDark connecting={false} error={null} onCancel={() => {}} handleConnect={handleConnect} syncProfiles={syncProfiles} /></>;
}

describe('GETSSH 2.0 import', () => {
  it('waits for ready, loaded configuration and mandatory master-password replacement, then checks once', async () => {
    useAppLockStore.setState({ state: { ...appState, phase: 'locked' } });
    useAppStore.setState({ isConfigLoaded: false });
    await render();
    expect(status).not.toHaveBeenCalled();
    await act(async () => useAppLockStore.setState({ state: { ...appState, masterPasswordMustChange: true } }));
    await act(async () => useAppStore.setState({ isConfigLoaded: true }));
    expect(status).not.toHaveBeenCalled();
    await act(async () => useAppLockStore.setState({ state: { ...appState } }));
    expect(status).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => useAppStore.setState({ appConfig: { ...DEFAULT_CONFIG, defaultPort: 2200 } }));
    await render();
    expect(status).toHaveBeenCalledTimes(1);
    await act(async () => useAppLockStore.setState({ state: { ...appState, phase: 'locked' } }));
    await act(async () => useAppLockStore.setState({ state: { ...appState } }));
    expect(status).toHaveBeenCalledTimes(2);
  });

  it('retries a wrong 2.0 password and replaces the complete active list without saving it again', async () => {
    const revision = useSessionStore.getState().sessionsRevision;
    importV2.mockImplementationOnce(async request => {
      expect(request).toEqual({ password: 'wrong', defaultPort: 2222 });
      return { ...imported, status: 'wrong_password', profiles: [] };
    }).mockImplementationOnce(async request => {
      expect(request).toEqual({ password: 'old-master', defaultPort: 2222 });
      return imported;
    });
    await render();
    await typePassword('wrong');
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('主密码不正确');
    expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('');
    await typePassword('old-master');
    await submit();
    expect(importV2.mock.calls.map(([request]) => request.defaultPort)).toEqual([2222, 2222]);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(useSessionStore.getState().sessions).toEqual(profiles);
    expect(useSessionStore.getState().sessionsRevision).toBe(revision + 1);
    expect(useSessionStore.getState().profilesWorkspaceId).toBe('current');
    expect(useSessionStore.getState().sessions[0].hasPassword).toBe(true);
    expect(useSessionStore.getState().sessions[0].password).toBeUndefined();
    expect(saveProfiles).not.toHaveBeenCalled();
  });

  it.each([22, 2222])('acknowledges defaulted ports using configured port %s and adopts profiles', async port => {
    const revision = useSessionStore.getState().sessionsRevision;
    status.mockResolvedValue(withMissingPort);
    useAppStore.setState({ appConfig: { ...DEFAULT_CONFIG, defaultPort: port } });
    await render();
    expect(applyDefaultPort).toHaveBeenCalledExactlyOnceWith({ port });
    expect(useSessionStore.getState().sessions).toEqual(profiles);
    expect(useSessionStore.getState().sessionsRevision).toBe(revision + 1);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(saveProfiles).not.toHaveBeenCalled();
  });

  it.each(['import', 'defaultPort'])('keeps the real draft editor on its stable ID after %s and does not autosave into another server 400ms later', async route => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const draft: SessionProfile = { id: 'draft', isDraft: true, alias: 'draft-before', host: 'draft.test', username: 'user' };
    const existing: SessionProfile = { id: 'existing', alias: 'existing-before', host: 'existing.test', username: 'user' };
    const quick: SessionProfile = { id: 'quick', isQuickConnect: true, host: 'quick.test', username: 'user' };
    const newlyImported: SessionProfile = { id: 'new-imported', alias: 'imported-before', host: 'legacy.test', username: 'user' };
    const saved = [newlyImported, existing];
    useSessionStore.getState().replaceSessions([draft, existing, quick], 'current');
    useSessionStore.getState().setSelectedSessionIndex(0);
    const pending = deferred<any>();
    if (route === 'import') importV2.mockReturnValueOnce(pending.promise);
    else { status.mockResolvedValue(withMissingPort); applyDefaultPort.mockReturnValueOnce(pending.promise); }
    await act(async () => root.render(<EditingHarness />));
    const alias = () => container.querySelector<HTMLInputElement>('input[placeholder="connection.placeholder.alias"]')!;
    expect(alias().value).toBe('draft-before');
    if (route === 'import') { await typePassword('old-master'); await submit(); }
    await act(async () => pending.resolve(route === 'import'
      ? { ...imported, profiles: saved }
      : { ok: true, status: 'applied', changed: 1, workspaceId: 'current', profiles: saved }));
    const state = useSessionStore.getState();
    expect(state.sessions).toEqual([newlyImported, existing, draft, quick]);
    expect(state.sessions[state.selectedSessionIndex!].id).toBe('draft');
    expect(state.selectedSessionIndex).toBe(2);
    expect(alias().value).toBe('draft-before');
    expect(saveProfiles).not.toHaveBeenCalled();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(alias(), 'draft-after');
      alias().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTime(399));
    expect(saveProfiles).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(useSessionStore.getState().sessions.find(profile => profile.id === 'draft')).toMatchObject({ isDraft: true, alias: 'draft-after' });
    expect(useSessionStore.getState().sessions.filter(profile => !profile.isDraft && !profile.isQuickConnect)).toEqual(saved);
    expect(useSessionStore.getState().sessions.find(profile => profile.id === 'quick')).toEqual(quick);
    expect(saveProfiles).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current', payload: saved });
  });

  it.each(['import', 'defaultPort'])('restores the selected saved server by ID after %s reorders the list', async route => {
    const existing: SessionProfile = { id: 'existing', host: 'existing.test', username: 'user' };
    const quick: SessionProfile = { id: 'quick', isQuickConnect: true, host: 'quick.test', username: 'user' };
    useSessionStore.getState().replaceSessions([existing, quick], 'current');
    useSessionStore.getState().setSelectedSessionIndex(0);
    if (route === 'import') importV2.mockResolvedValue({ ...imported, profiles: [...profiles, existing] });
    else {
      status.mockResolvedValue(withMissingPort);
      applyDefaultPort.mockResolvedValue({ ok: true, status: 'applied', changed: 1, workspaceId: 'current', profiles: [...profiles, existing] });
    }
    await render();
    if (route === 'import') { await typePassword('old-master'); await submit(); }
    expect(useSessionStore.getState().selectedSessionIndex).toBe(1);
    expect(useSessionStore.getState().sessions[1]).toEqual(existing);
    expect(useSessionStore.getState().sessions[2]).toEqual(quick);
    expect(saveProfiles).not.toHaveBeenCalled();
  });

  it.each(['import', 'defaultPort'])('keeps draft input typed before %s completes and lets its pending 400ms autosave update only that draft', async route => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const draft: SessionProfile = { id: 'draft', isDraft: true, alias: 'draft-before', host: 'draft.test', username: 'user' };
    const existing: SessionProfile = { id: 'existing', alias: 'existing-before', host: 'existing.test', username: 'user' };
    const quick: SessionProfile = { id: 'quick', isQuickConnect: true, host: 'quick.test', username: 'user' };
    const newlyImported: SessionProfile = { id: 'new-imported', alias: 'imported-before', host: 'legacy.test', username: 'user' };
    const saved = [newlyImported, existing];
    useSessionStore.getState().replaceSessions([draft, existing, quick], 'current');
    useSessionStore.getState().setSelectedSessionIndex(0);
    const pending = deferred<any>();
    if (route === 'import') importV2.mockReturnValueOnce(pending.promise);
    else { status.mockResolvedValue(withMissingPort); applyDefaultPort.mockReturnValueOnce(pending.promise); }
    await act(async () => root.render(<EditingHarness />));
    if (route === 'import') { await typePassword('old-master'); await submit(); }
    const alias = () => container.querySelector<HTMLInputElement>('input[placeholder="connection.placeholder.alias"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(alias(), 'draft-pending');
      alias().dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(alias().value).toBe('draft-pending');
    await act(async () => vi.advanceTimersByTime(399));
    expect(saveProfiles).not.toHaveBeenCalled();
    expect(useSessionStore.getState().sessions[0].alias).toBe('draft-before');
    await act(async () => pending.resolve(route === 'import'
      ? { ...imported, profiles: saved }
      : { ok: true, status: 'applied', changed: 1, workspaceId: 'current', profiles: saved }));
    const state = useSessionStore.getState();
    expect(state.selectedSessionIndex).toBe(2);
    expect(state.sessions[state.selectedSessionIndex!].id).toBe('draft');
    expect(alias().value).toBe('draft-pending');
    await act(async () => vi.advanceTimersByTime(1));
    expect(useSessionStore.getState().sessions.find(profile => profile.id === 'draft')).toMatchObject({ isDraft: true, alias: 'draft-pending' });
    expect(useSessionStore.getState().sessions.filter(profile => !profile.isDraft && !profile.isQuickConnect)).toEqual(saved);
    expect(useSessionStore.getState().sessions.find(profile => profile.id === 'quick')).toEqual(quick);
    expect(saveProfiles).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current', payload: saved });
  });

  it('waits for a workspace switch to finish before applying the missing default port', async () => {
    status.mockResolvedValue(withMissingPort);
    useWorkspaceStore.setState({ isSwitching: true });
    await render();
    expect(status).not.toHaveBeenCalled();
    expect(applyDefaultPort).not.toHaveBeenCalled();
    await act(async () => useWorkspaceStore.setState({ isSwitching: false }));
    expect(applyDefaultPort).toHaveBeenCalledTimes(1);
  });

  it.each(['encrypted', 'unreadable'] as const)('persists dismissal of an %s file, but asks again for a new fingerprint', async kind => {
    let fingerprint = 'old';
    let dismissedFingerprint: string | null = null;
    status.mockImplementation(async () => ({
      ...waiting, kind, needsPassword: kind === 'encrypted',
      imported: dismissedFingerprint === fingerprint ? { ...withMissingPort.imported, portDefaulted: 0, dismissed: true } : null,
    }));
    dismissV2.mockImplementation(async () => { dismissedFingerprint = fingerprint; return { ok: true, status: 'dismissed' }; });
    await render();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    if (kind === 'encrypted') await typePassword('not retained');
    await click('不再提示');
    expect(dismissV2).toHaveBeenCalledExactlyOnceWith();
    expect(importV2).not.toHaveBeenCalled();
    expect(container.querySelector('input')).toBeNull();
    await act(async () => useAppLockStore.setState({ state: { ...appState, phase: 'locked' } }));
    await act(async () => useAppLockStore.setState({ state: { ...appState } }));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    fingerprint = 'new';
    await act(async () => useAppLockStore.setState({ state: { ...appState, phase: 'locked' } }));
    await act(async () => useAppLockStore.setState({ state: { ...appState } }));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    if (kind === 'encrypted') expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('');
    else expect(container.querySelector('[role="alert"]')?.textContent).toContain('无法读取');
    expect(useSessionStore.getState().sessions[0].id).toBe('existing');
  });

  it.each(['encrypted', 'unreadable'] as const)('still applies missing ports before respecting dismissal of an %s file', async kind => {
    status.mockResolvedValue({ ...withMissingPort, kind, needsPassword: true, imported: { ...withMissingPort.imported, dismissed: true } });
    await render();
    expect(applyDefaultPort).toHaveBeenCalledExactlyOnceWith({ port: 2222 });
    expect(useSessionStore.getState().sessions).toEqual(profiles);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(dismissV2).not.toHaveBeenCalled();
  });

  it.each(['failure', 'transport'])('keeps the dismissal choice available after a %s error without retaining the password', async failure => {
    if (failure === 'failure') dismissV2.mockResolvedValueOnce({ ok: true, status: 'failed', error: 'private-file-details' });
    else dismissV2.mockRejectedValueOnce(new Error('private-file-details'));
    await render();
    await typePassword('not retained');
    await click('不再提示');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('未能保存');
    expect(container.textContent).not.toContain('private-file-details');
    expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('');
    await click('不再提示');
    expect(dismissV2).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each(['failed', 'unavailable', 'transport'])('explains that import succeeded when the default port %s, then retries only the port', async failure => {
    status.mockResolvedValue(withMissingPort);
    if (failure === 'failed') applyDefaultPort.mockResolvedValueOnce({ ok: true, status: 'failed', changed: 0, error: 'locked', workspaceId: 'current', profiles: [] });
    else if (failure === 'unavailable') applyDefaultPort.mockResolvedValueOnce({ ok: false, error: 'unavailable' });
    else applyDefaultPort.mockRejectedValueOnce(new Error('private-file-details'));
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('服务器已导入');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('默认端口未能设置');
    if (failure === 'failed') {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('解锁导入这些服务器的工作区');
      expect(container.querySelector('[role="alert"]')?.textContent).not.toContain('主工作区');
    }
    expect(container.textContent).not.toContain('未能导入');
    expect(container.textContent).not.toContain('private-file-details');
    expect(container.querySelector('input')).toBeNull();
    await click('重试');
    expect(applyDefaultPort.mock.calls.map(([request]) => request)).toEqual([{ port: 2222 }, { port: 2222 }]);
    expect(importV2).not.toHaveBeenCalled();
    expect(dismissV2).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().sessions).toEqual(profiles);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(saveProfiles).not.toHaveBeenCalled();
  });

  it('asks for the new legacy file only after retrying ports left by an earlier import', async () => {
    status.mockResolvedValue({ ...waiting, imported: withMissingPort.imported });
    applyDefaultPort.mockResolvedValueOnce({ ok: false, error: 'failed' });
    await render();
    expect(container.querySelector('input')).toBeNull();
    await click('重试');
    expect(container.querySelector<HTMLInputElement>('input')!.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('waits for vault unlock before checking status or taking focus from the workspace unlock UI', async () => {
    useWorkspaceStore.setState({ isVaultLocked: true });
    const outside = document.createElement('button'); document.body.append(outside); outside.focus();
    try {
      await render();
      expect(status).not.toHaveBeenCalled();
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(outside);
      await act(async () => useWorkspaceStore.setState({ isVaultLocked: false }));
      expect(status).toHaveBeenCalledTimes(1);
      expect(container.querySelector<HTMLInputElement>('input')!.disabled).toBe(false);
      expect(document.activeElement).toBe(container.querySelector('input'));
      await typePassword('not retained');
      await act(async () => useWorkspaceStore.setState({ isVaultLocked: true }));
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(outside);
      await act(async () => useWorkspaceStore.setState({ isVaultLocked: false }));
      expect(status).toHaveBeenCalledTimes(2);
      expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('');
    } finally { outside.remove(); }
  });

  it('drops status from before a vault lock/unlock round trip instead of resurfacing a stale prompt', async () => {
    const pending = deferred<typeof waiting>();
    status.mockReturnValueOnce(pending.promise).mockResolvedValue(noData);
    await render();
    await act(async () => useWorkspaceStore.setState({ isVaultLocked: true }));
    await act(async () => useWorkspaceStore.setState({ isVaultLocked: false }));
    expect(status).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(waiting));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it.each(['unreadable', 'failed'])('describes %s without echoing backend details, and allows skipping', async outcome => {
    importV2.mockResolvedValue({ ...imported, status: outcome, error: 'private-file-details', profiles: [] });
    await render();
    await typePassword('old-master');
    await submit();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain('private-file-details');
    await act(async () => container.querySelector<HTMLButtonElement>('button[type="button"]')!.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(useSessionStore.getState().sessions[0].id).toBe('existing');
  });

  it('lets the user skip without importing, retaining the existing list and dropping the password', async () => {
    await render();
    await typePassword('old-master');
    await act(async () => container.querySelector<HTMLButtonElement>('button[type="button"]')!.click());
    expect(importV2).not.toHaveBeenCalled();
    expect(container.querySelector('input')).toBeNull();
    expect(useSessionStore.getState().sessions[0].id).toBe('existing');
  });

  it.each(['password', 'unreadable', 'defaultPort'])('remembers skipping the %s prompt across workspace changes until the application locks', async prompt => {
    if (prompt === 'unreadable') status.mockResolvedValue({ ...noData, kind: 'unreadable' });
    else if (prompt === 'defaultPort') {
      status.mockResolvedValue(withMissingPort);
      applyDefaultPort.mockResolvedValue({ ok: false, error: 'locked' });
    }
    await render();
    if (prompt === 'password') await typePassword('not retained');
    await click('先跳过');
    await act(async () => useWorkspaceStore.setState({ isSwitching: true }));
    await act(async () => useWorkspaceStore.setState({ activeWorkspaceId: 'other', isSwitching: false }));
    await act(async () => useWorkspaceStore.setState({ isVaultLocked: true }));
    await act(async () => useWorkspaceStore.setState({ isVaultLocked: false }));
    await act(async () => useWorkspaceStore.setState({ activeWorkspaceId: 'current' }));
    await render();
    expect(status).toHaveBeenCalledTimes(1);
    if (prompt === 'defaultPort') expect(applyDefaultPort).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(importV2).not.toHaveBeenCalled();
    await act(async () => useAppLockStore.setState({ state: { ...appState, phase: 'locked' } }));
    await act(async () => useAppLockStore.setState({ state: { ...appState } }));
    expect(status).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    if (prompt === 'password') expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('');
  });

  it('keeps keyboard focus in the prompt and releases it when the app locks', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    try {
      await render();
      const input = container.querySelector<HTMLInputElement>('input')!;
      expect(document.activeElement).toBe(input);
      await typePassword('old-master');
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(container.querySelector('button[type="submit"]'));
      await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(input);
      await act(async () => outside.focus());
      expect(document.activeElement).toBe(input);
      await act(async () => useAppLockStore.setState({ state: { ...appState, phase: 'locked' } }));
      expect(container.querySelector('input')).toBeNull();
      expect(document.activeElement).toBe(outside);
      outside.focus();
      expect(document.activeElement).toBe(outside);
    } finally { outside.remove(); }
  });

  it('shows unreadable status with a skip action instead of asking for a password', async () => {
    status.mockResolvedValue({ ...noData, kind: 'unreadable' });
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('无法读取');
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('button')?.textContent).toContain('先跳过');
  });

  it('shows no prompt when there is no legacy file, and handles transport errors without crashing', async () => {
    status.mockResolvedValue(noData);
    await render();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => useAppLockStore.setState({ state: { ...appState, phase: 'locked' } }));
    status.mockRejectedValueOnce(new Error('sensitive transport details'));
    await act(async () => useAppLockStore.setState({ state: { ...appState } }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('现在不可用');
    expect(container.textContent).not.toContain('sensitive transport details');
  });

  it('reports rate limiting and treats a cancelled password import as a silent cancellation', async () => {
    importV2.mockResolvedValueOnce({ ok: false, error: 'rate_limited', retryAfterMs: 2500 });
    await render();
    await typePassword('old-master');
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('3 秒');
    importV2.mockResolvedValueOnce({ ok: false, error: 'cancelled' });
    await typePassword('old-master');
    await submit();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('');
  });

  it.each(['import', 'defaultPort'])('does not adopt the %s response for another active workspace', async route => {
    if (route === 'defaultPort') {
      status.mockResolvedValue(withMissingPort);
      applyDefaultPort.mockResolvedValue({ ok: true, status: 'applied', changed: 1, workspaceId: 'other', profiles });
    } else importV2.mockResolvedValue({ ...imported, workspaceId: 'other' });
    await render();
    if (route === 'import') { await typePassword('old-master'); await submit(); }
    expect(useSessionStore.getState().sessions[0].id).toBe('existing');
  });

  it('drops an in-flight import after switching away and back, and clears the typed password on switching', async () => {
    const pending = deferred<typeof imported>();
    importV2.mockReturnValue(pending.promise);
    await render();
    await typePassword('old-master');
    await submit();
    await act(async () => useWorkspaceStore.setState({ activeWorkspaceId: 'other' }));
    await act(async () => useWorkspaceStore.setState({ activeWorkspaceId: 'current' }));
    await act(async () => pending.resolve(imported));
    expect(useSessionStore.getState().sessions[0].id).toBe('existing');
    expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('');
  });

  it('drops default-port results that arrive after workspace locking', async () => {
    const pending = deferred<Awaited<ReturnType<Window['electronAPI']['store']['legacyV2']['applyDefaultPort']>>>();
    status.mockResolvedValue(withMissingPort);
    applyDefaultPort.mockReturnValue(pending.promise);
    await render();
    await act(async () => useWorkspaceStore.setState({ isVaultLocked: true }));
    await act(async () => pending.resolve({ ok: true, status: 'applied', changed: 1, workspaceId: 'current', profiles }));
    expect(useSessionStore.getState().sessions[0].id).toBe('existing');
  });

  it('drops late status after app locking and late import after unmount', async () => {
    const pendingStatus = deferred<typeof waiting>();
    status.mockReturnValueOnce(pendingStatus.promise);
    await render();
    await act(async () => useAppLockStore.setState({ state: { ...appState, phase: 'locked' } }));
    await act(async () => pendingStatus.resolve(waiting));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => useAppLockStore.setState({ state: { ...appState } }));
    const pendingImport = deferred<typeof imported>();
    importV2.mockReturnValueOnce(pendingImport.promise);
    await typePassword('old-master');
    await submit();
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => pendingImport.resolve(imported));
    expect(useSessionStore.getState().sessions[0].id).toBe('existing');
  });
});
