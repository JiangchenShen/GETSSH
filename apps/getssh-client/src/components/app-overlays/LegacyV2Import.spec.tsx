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

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));

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
  saveProfiles = vi.fn();
  window.electronAPI = { saveProfiles, store: { legacyV2: { status, import: importV2, applyDefaultPort } } } as unknown as Window['electronAPI'];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
const render = () => act(async () => root.render(<LegacyV2Import />));
const typePassword = (value: string) => act(async () => {
  const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const submit = () => act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

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
    expect(useSessionStore.getState().sessions[0].hasPassword).toBe(true);
    expect(useSessionStore.getState().sessions[0].password).toBeUndefined();
    expect(saveProfiles).not.toHaveBeenCalled();
  });

  it.each([22, 2222])('acknowledges defaulted ports using configured port %s and adopts profiles', async port => {
    status.mockResolvedValue(withMissingPort);
    useAppStore.setState({ appConfig: { ...DEFAULT_CONFIG, defaultPort: port } });
    await render();
    expect(applyDefaultPort).toHaveBeenCalledExactlyOnceWith({ port });
    expect(useSessionStore.getState().sessions).toEqual(profiles);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(saveProfiles).not.toHaveBeenCalled();
  });

  it('waits for a workspace switch to finish before applying the missing default port', async () => {
    status.mockResolvedValue(withMissingPort);
    useWorkspaceStore.setState({ isSwitching: true });
    await render();
    expect(applyDefaultPort).not.toHaveBeenCalled();
    await act(async () => useWorkspaceStore.setState({ isSwitching: false }));
    expect(applyDefaultPort).toHaveBeenCalledTimes(1);
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
