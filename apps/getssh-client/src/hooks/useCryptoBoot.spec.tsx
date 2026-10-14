// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCryptoBoot } from './useCryptoBoot';
import { useSessionManager } from './useSessionManager';
import { useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAppLockStore } from '../store/appLockStore';
import type { SessionProfile } from '../store/sessionStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let root: Root;
let container: HTMLDivElement;
let manager!: ReturnType<typeof useSessionManager>;
const draft: SessionProfile = { id: 'draft', host: 'new.example', username: 'operator', isDraft: true };
const saved: SessionProfile[] = [{ id: 'saved', host: 'saved.example', username: 'operator' }];
function Harness() { useCryptoBoot(); manager = useSessionManager(); return null; }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useAppLockStore.setState({ state: { phase: 'ready', appProtected: false, presenceSupported: true, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false } });
  useWorkspaceStore.setState({ activeWorkspaceId: 'default', isSwitching: false, isVaultLocked: false });
  useSessionStore.setState({ sessions: [draft], sessionsRevision: 0, profilesWorkspaceId: null });
  window.electronAPI = {
    checkProfiles: vi.fn().mockResolvedValue({ status: 'none', hasPassword: false, biometricEnabled: false }),
    unlockProfiles: vi.fn().mockResolvedValue(saved), saveProfiles: vi.fn().mockResolvedValue(true),
    promptBiometricUnlock: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as Window['electronAPI'];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = () => act(async () => root.render(<Harness />));

describe('startup protection metadata', () => {
  it('leaves none unhydrated and refuses saving the draft-only list even after unlocking', async () => {
    useAppLockStore.setState({ state: { ...useAppLockStore.getState().state!, phase: 'starting' } });
    await render();
    expect(useSessionStore.getState()).toMatchObject({ profilesWorkspaceId: null, sessionsRevision: 0, sessions: [draft] });
    await act(async () => useAppLockStore.setState({ state: { ...useAppLockStore.getState().state!, phase: 'ready' } }));
    await act(async () => manager.syncProfiles(useSessionStore.getState().sessions));
    expect(window.electronAPI.saveProfiles).not.toHaveBeenCalled();
    expect(window.electronAPI.unlockProfiles).not.toHaveBeenCalled();
  });
  it('does not treat none as an empty complete list even when the app is ready', async () => {
    await render(); await act(async () => manager.syncProfiles(useSessionStore.getState().sessions));
    expect(useSessionStore.getState().profilesWorkspaceId).toBeNull();
    expect(window.electronAPI.saveProfiles).not.toHaveBeenCalled();
  });
  it('still verifies presence after an unhydrated replacement during the check', async () => {
    let finish!: (value: Awaited<ReturnType<Window['electronAPI']['checkProfiles']>>) => void;
    vi.mocked(window.electronAPI.checkProfiles).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await render();
    await act(async () => useSessionStore.getState().replaceSessions([draft], null));
    await act(async () => finish({ status: 'encrypted', hasPassword: true, biometricEnabled: true }));
    expect(window.electronAPI.promptBiometricUnlock).toHaveBeenCalledOnce();
    expect(window.electronAPI.unlockProfiles).toHaveBeenCalledWith('');
    expect(useSessionStore.getState().sessions).toEqual([...saved, draft]);
    expect(useWorkspaceStore.getState().isVaultLocked).toBe(false);
  });
  it.each([false, true])('keeps a newer complete list unlocked when an older encrypted check finishes (presence: %s)', async biometricEnabled => {
    let finish!: (value: Awaited<ReturnType<Window['electronAPI']['checkProfiles']>>) => void;
    vi.mocked(window.electronAPI.checkProfiles).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await render();
    await act(async () => {
      useSessionStore.getState().replaceSessions(saved, 'default');
      useWorkspaceStore.setState({ isVaultLocked: true });
    });
    await act(async () => finish({ status: 'encrypted', hasPassword: true, biometricEnabled }));
    expect(useSessionStore.getState().sessions).toEqual(saved);
    expect(useSessionStore.getState().profilesWorkspaceId).toBe('default');
    expect(useWorkspaceStore.getState().isVaultLocked).toBe(false);
    expect(window.electronAPI.promptBiometricUnlock).not.toHaveBeenCalled();
    expect(window.electronAPI.unlockProfiles).not.toHaveBeenCalled();
  });
  it('still unlocks an encrypted workspace when the list has not been replaced during the check', async () => {
    useSessionStore.getState().replaceSessions(saved, 'default');
    vi.mocked(window.electronAPI.checkProfiles).mockResolvedValue({ status: 'encrypted', hasPassword: true, biometricEnabled: true });
    await render();
    expect(window.electronAPI.promptBiometricUnlock).toHaveBeenCalledOnce();
    expect(window.electronAPI.unlockProfiles).toHaveBeenCalledWith('');
    expect(useSessionStore.getState().sessions).toEqual(saved);
    expect(useWorkspaceStore.getState().isVaultLocked).toBe(false);
  });
  it('preserves a newer complete list when an older plain check finishes', async () => {
    let finish!: (value: Awaited<ReturnType<Window['electronAPI']['checkProfiles']>>) => void;
    vi.mocked(window.electronAPI.checkProfiles).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await render(); await act(async () => useSessionStore.getState().replaceSessions(saved, 'default'));
    await act(async () => finish({ status: 'plain', hasPassword: false, biometricEnabled: false }));
    expect(useSessionStore.getState().sessions).toEqual(saved);
    expect(window.electronAPI.unlockProfiles).not.toHaveBeenCalled();
  });
});
