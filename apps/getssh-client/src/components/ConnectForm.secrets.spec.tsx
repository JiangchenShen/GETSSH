// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../store/appStore';
import { useAppLockStore } from '../store/appLockStore';
import { useSessionStore } from '../store/sessionStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string) => ({ 'connection.password': 'Password', 'connection.privateKey': 'Private key', 'common.cancel': 'Cancel' } as Record<string, string>)[key] ?? key,
  i18n: { language: 'en-US' },
}) }));
vi.mock('framer-motion', () => ({ motion: { button: ({ whileTap: _whileTap, children, ...props }: any) => <button {...props}>{children}</button> } }));
vi.mock('../store/appStore', () => ({ useAppStore: (select: (state: any) => any) => select({ isMac: true }) }));
vi.mock('../store/workspaceStore', async () => {
  const { create } = await import('zustand');
  return { useWorkspaceStore: create(() => ({ activeWorkspaceId: 'default', isSwitching: false, isVaultLocked: false })) };
});
import { useWorkspaceStore } from '../store/workspaceStore';
import { ConnectForm, type ConnectFormSession } from './ConnectForm';

let root: Root;
let container: HTMLDivElement;
const onUpdateSession = vi.fn();
const onSaveSession = vi.fn();
const onConnect = vi.fn();
const onCancel = vi.fn();
const appConfig = { defaultPort: 22, customThemes: {} } as AppConfig;
const saved: ConnectFormSession = { id: 'server', host: 'server.example', username: 'user', protocol: 'ssh', authType: 'password', hasPassword: true, hasPassphrase: true };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); onUpdateSession.mockReset(); onSaveSession.mockReset().mockResolvedValue(true); onConnect.mockReset(); onCancel.mockReset(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  useAppLockStore.setState({ state: { phase: 'ready', appProtected: false, presenceSupported: true, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false } });
  useWorkspaceStore.setState({ activeWorkspaceId: 'default', isSwitching: false, isVaultLocked: false });
  useSessionStore.setState({ profilesWorkspaceId: 'default' });
  window.electronAPI = {
    assetFolders: { list: vi.fn().mockResolvedValue({ success: true, folders: [] }) },
    security: { status: vi.fn().mockResolvedValue({ appProtected: false, scopes: [] }) },
    store: { reveal: { open: vi.fn().mockResolvedValue({ ok: true }), show: vi.fn().mockResolvedValue({ ok: true }), close: vi.fn().mockResolvedValue({ ok: true }) } },
  } as unknown as Window['electronAPI'];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); useAppLockStore.setState({ state: null }); });
const render = async (session: ConnectFormSession = saved, index = 0) => act(async () => root.render(<ConnectForm session={session} index={index} appConfig={appConfig} isDark={true} connecting={false} error={null} onCancel={onCancel} onConnect={onConnect} onUpdateSession={onUpdateSession} onSaveSession={onSaveSession} />));
const click = async (text: string) => act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === text)!.click());
const typeSecret = async (value: string) => act(async () => {
  const field = container.querySelector('input[type="password"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true }));
});
const saveDebounced = async () => act(async () => vi.advanceTimersByTime(400));
const typeAlias = async (value: string) => act(async () => {
  const input = container.querySelector<HTMLInputElement>('input[placeholder="connection.placeholder.alias"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('saved credential editing', () => {
  it('keeps an existing password when typing and deleting without explicit clearing', async () => {
    await render(); await typeSecret('temporary edit'); await typeSecret(''); await saveDebounced();
    expect(onUpdateSession).toHaveBeenLastCalledWith(0, expect.objectContaining({ password: undefined, hasPassword: true }));
    expect(container.querySelector('input[type="password"]')?.getAttribute('placeholder')).toBe('Saved. Leave empty to keep it');
  });

  it('keeps a password clear pending through empty edits and commits only explicit Save before reconnecting', async () => {
    await render(); await click('Clear saved password'); await typeSecret('new edit'); await typeSecret('');
    expect(onUpdateSession).not.toHaveBeenCalled(); expect(onSaveSession).not.toHaveBeenCalled(); expect(container.textContent).toContain('Will clear on save');
    await saveDebounced(); expect(onUpdateSession).toHaveBeenCalledWith(0, expect.objectContaining({ password: undefined, hasPassword: true }));
    await click('Save changes'); const updated = onSaveSession.mock.calls.at(-1)![1]; expect(updated.password).toBe(''); expect(updated.hasPassword).toBe(false);
    expect(container.textContent).not.toContain('View password'); expect(container.querySelector('input[type="password"]')?.getAttribute('placeholder')).not.toBe('Saved. Leave empty to keep it');
    await act(async () => root.render(null)); await render({ ...updated, password: undefined });
    expect(container.textContent).not.toContain('Clear saved password');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ password: undefined, hasPassword: false }));
  });

  it('clears a saved passphrase without changing a saved password', async () => {
    await render({ ...saved, authType: 'key' }); await click('Clear saved passphrase'); await typeSecret('new edit'); await typeSecret(''); await saveDebounced();
    expect(onUpdateSession).toHaveBeenLastCalledWith(0, expect.objectContaining({ passphrase: undefined, hasPassphrase: true, hasPassword: true }));
    await click('Save changes'); expect(onSaveSession).toHaveBeenCalledWith(0, expect.objectContaining({ passphrase: '', hasPassphrase: false, hasPassword: true }));
    expect(container.textContent).not.toContain('View passphrase');
  });

  it('does not offer saved-secret controls for an unsaved credential', async () => {
    await render({ ...saved, hasPassword: false, hasPassphrase: false });
    expect(container.textContent).not.toContain('View password'); expect(container.textContent).not.toContain('Clear saved password');
  });

  it('does not sneak a pending deletion into an unrelated field autosave, and Undo keeps the stored secret', async () => {
    await render(); await click('Clear saved password'); await typeAlias('new alias'); await saveDebounced();
    expect(onUpdateSession).toHaveBeenCalledWith(0, expect.objectContaining({ alias: 'new alias', password: undefined, hasPassword: true }));
    expect(onSaveSession).not.toHaveBeenCalled(); await click('Undo'); await saveDebounced();
    expect(container.textContent).not.toContain('Will clear on save'); expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.placeholder).toBe('Saved. Leave empty to keep it');
    expect(onUpdateSession).toHaveBeenLastCalledWith(0, expect.objectContaining({ password: undefined, hasPassword: true }));
  });

  it('masks a replacement typed after pending clear until explicit Save', async () => {
    await render(); await click('Clear saved password'); await typeSecret('replacement'); await saveDebounced();
    expect(container.textContent).toContain('Will replace on save'); expect(onUpdateSession).toHaveBeenCalledWith(0, expect.objectContaining({ password: undefined, hasPassword: true }));
    await click('Save changes'); expect(onSaveSession).toHaveBeenCalledWith(0, expect.objectContaining({ password: 'replacement', hasPassword: true }));
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe(''); expect(container.textContent).not.toContain('Will replace on save');
  });

  it('Undo restores only the user-typed draft that existed before clearing', async () => {
    await render(); await typeSecret('own draft'); await click('Clear saved password'); await typeSecret('discard this replacement'); await click('Undo');
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('own draft');
    await saveDebounced(); expect(onUpdateSession).toHaveBeenCalledWith(0, expect.objectContaining({ password: 'own draft', hasPassword: true })); expect(onSaveSession).not.toHaveBeenCalled();
  });

  it.each(['false', 'rejected'])('retains pending intent and does not connect after a %s save, then retries', async failure => {
    if (failure === 'false') onSaveSession.mockResolvedValueOnce(false); else onSaveSession.mockRejectedValueOnce(new Error('save failed'));
    await render(); await click('Clear saved password');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onConnect).not.toHaveBeenCalled(); expect(container.textContent).toContain('Will clear on save'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not save changes');
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Undo')?.disabled).toBe(false);
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onConnect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ hasPassword: false, password: undefined, isDraft: false }));
    expect(onUpdateSession).not.toHaveBeenCalled();
  });

  it('waits for true acknowledgement before connecting and disables edits while saving', async () => {
    let finish!: (value: boolean) => void; onSaveSession.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render(); await click('Clear saved password');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onConnect).not.toHaveBeenCalled(); expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.disabled).toBe(true);
    expect(container.querySelector('fieldset')!.disabled).toBe(true);
    await act(async () => finish(true)); expect(onConnect).toHaveBeenCalledTimes(1); expect(container.textContent).not.toContain('Will clear on save');
  });

  it.each(['lock-cycle', 'workspace-cycle'])('drops a late save UI reply across %s without connecting', async transition => {
    let finish!: (value: boolean) => void; onSaveSession.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render(); await click('Clear saved password');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => {
      if (transition === 'workspace-cycle') { useWorkspaceStore.setState({ activeWorkspaceId: 'other' }); useWorkspaceStore.setState({ activeWorkspaceId: 'default' }); }
      else { const state = useAppLockStore.getState().state!; useAppLockStore.setState({ state: { ...state, phase: 'locked' } }); useAppLockStore.setState({ state }); }
    });
    await act(async () => finish(true)); expect(onConnect).not.toHaveBeenCalled(); expect(onSaveSession).toHaveBeenCalledTimes(1); expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('discards typed and pending drafts on Cancel instead of writing them later', async () => {
    await render(); await typeSecret('own secret draft'); await click('Clear saved password'); await typeSecret('replacement secret'); await click('Cancel');
    expect(onCancel).toHaveBeenCalled(); expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe(''); expect(container.textContent).not.toContain('Will clear on save');
    await saveDebounced(); expect(onSaveSession).not.toHaveBeenCalled(); expect(onUpdateSession).not.toHaveBeenCalled();
  });

  it('persists both clears through the fake store restart, without reintroducing saved hints', async () => {
    const store = createRequire(import.meta.url)('../../../../rust-core/getssh-store/store.fake.js');
    const home = mkdtempSync(join(tmpdir(), 'getssh-u8-'));
    try {
      store.__fake.reset(); store.configure(join(home, 'store')); store.__fake.seed({ profiles: { default: [{ id: 'server', host: 'server.example', username: 'user', password: 'stored password', passphrase: 'stored passphrase' }] } }); await store.start();
      window.electronAPI.saveProfiles = vi.fn().mockImplementation(async ({ payload, workspaceId }) => { store.saveProfiles(workspaceId, payload); return true; });
      onUpdateSession.mockImplementation((_index, updated) => { void window.electronAPI.saveProfiles({ workspaceId: 'default', payload: [updated] }); });
      onSaveSession.mockImplementation((_index, updated) => window.electronAPI.saveProfiles({ workspaceId: 'default', payload: [updated] }));
      await render(saved); await click('Clear saved password'); await click('Private key'); await click('Clear saved passphrase'); await saveDebounced();
      expect(onSaveSession).not.toHaveBeenCalled();
      expect(store.listProfiles('default')[0]).toMatchObject({ hasPassword: true, hasPassphrase: true });
      await click('Save changes');
      expect(window.electronAPI.saveProfiles).toHaveBeenCalledWith({ workspaceId: 'default', payload: [expect.objectContaining({ password: '', passphrase: '', hasPassword: false, hasPassphrase: false })] });
      store.__fake.restart(); await store.start();
      const profile = store.listProfiles('default')[0]; expect(profile.hasPassword).toBe(false); expect(profile.hasPassphrase).toBe(false);
      await act(async () => root.render(null)); await render(profile);
      expect(container.textContent).not.toContain('View passphrase'); expect(container.textContent).not.toContain('Clear saved passphrase');
      expect(container.querySelector('input[type="password"]')?.getAttribute('placeholder')).not.toBe('Saved. Leave empty to keep it');
    } finally { store.__fake.reset(); rmSync(home, { recursive: true, force: true }); }
  });

  it.each([
    { field: 'password', transition: 'leave' }, { field: 'password', transition: 'switch' },
    { field: 'passphrase', transition: 'leave' }, { field: 'passphrase', transition: 'switch' },
  ] as const)('discards an unconfirmed $field clear on $transition and keeps credentials after restart', async ({ field, transition }) => {
    const store = createRequire(import.meta.url)('../../../../rust-core/getssh-store/store.fake.js');
    const home = mkdtempSync(join(tmpdir(), 'getssh-u8-immediate-'));
    const other: ConnectFormSession = { ...saved, id: 'other', host: 'other.example', hasPassword: false, hasPassphrase: false };
    try {
      store.__fake.reset(); store.configure(join(home, 'store'));
      store.__fake.seed({ profiles: { default: [
        { id: 'server', host: 'server.example', username: 'user', password: 'stored password', passphrase: 'stored passphrase' },
        { id: 'other', host: 'other.example', username: 'user' },
      ] } }); await store.start();
      window.electronAPI.saveProfiles = vi.fn().mockImplementation(async ({ payload, workspaceId }) => { store.saveProfiles(workspaceId, payload); return true; });
      onUpdateSession.mockImplementation((_index, updated) => { void window.electronAPI.saveProfiles({ workspaceId: 'default', payload: [updated, other] }); });
      onSaveSession.mockImplementation((_index, updated) => window.electronAPI.saveProfiles({ workspaceId: 'default', payload: [updated, other] }));
      await render({ ...saved, authType: field === 'password' ? 'password' : 'key' });
      await typeSecret('pending edit'); await click(field === 'password' ? 'Clear saved password' : 'Clear saved passphrase');
      expect(onUpdateSession).not.toHaveBeenCalled(); expect(onSaveSession).not.toHaveBeenCalled();
      await typeSecret('replacement draft'); await typeSecret('');
      if (transition === 'leave') await act(async () => root.render(null));
      else await render(other);
      store.__fake.restart(); await store.start();
      const profiles = store.listProfiles('default');
      expect(profiles).toHaveLength(2);
      const restored = profiles.find((profile: { id: string }) => profile.id === 'server');
      expect(restored[field === 'password' ? 'hasPassword' : 'hasPassphrase']).toBe(true);
      await saveDebounced(); expect(onUpdateSession).not.toHaveBeenCalled(); expect(onSaveSession).not.toHaveBeenCalled();
    } finally { store.__fake.reset(); rmSync(home, { recursive: true, force: true }); }
  });
});
