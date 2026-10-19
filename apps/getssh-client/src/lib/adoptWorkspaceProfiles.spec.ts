// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppLockStore } from '../store/appLockStore';
import { useSessionStore, type SessionProfile } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { adoptWorkspaceProfiles } from './adoptWorkspaceProfiles';

const profile = (id: string, rest: Partial<SessionProfile> = {}): SessionProfile => ({ id, host: id, username: 'root', port: 22, authType: 'key', ...rest });
const draft = profile('draft', { isDraft: true });
const quick = profile('quick', { isQuickConnect: true });
const saved = profile('server', { keyId: 'old-key' });

beforeEach(() => {
  useAppLockStore.setState({ state: { phase: 'ready', appProtected: false, presenceSupported: false, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false } });
  useWorkspaceStore.setState({ activeWorkspaceId: 'default', isSwitching: false, isVaultLocked: false });
  useSessionStore.setState({ sessions: [saved, draft, quick], selectedSessionIndex: 1, profilesWorkspaceId: 'default', sessionsRevision: 1 });
  window.electronAPI = { saveProfiles: vi.fn() } as unknown as Window['electronAPI'];
});

describe('adopting profiles saved by SSH key operations', () => {
  it('keeps drafts, quick connections and the selection without saving again', () => {
    const updated = profile('server', { keyId: null });
    expect(adoptWorkspaceProfiles({ workspaceId: 'default', profiles: [updated] })).toBe(true);
    expect(useSessionStore.getState().sessions).toEqual([updated, draft, quick]);
    expect(useSessionStore.getState().selectedSessionIndex).toBe(1);
    expect(window.electronAPI.saveProfiles).not.toHaveBeenCalled();
  });
  it('keeps the selected server when its position changes', () => {
    useSessionStore.setState({ selectedSessionIndex: 0 });
    expect(adoptWorkspaceProfiles({ workspaceId: 'default', profiles: [profile('another'), profile('server', { keyId: null })] })).toBe(true);
    expect(useSessionStore.getState().selectedSessionIndex).toBe(1);
  });
  it.each(['other-workspace', 'switching', 'workspace-locked', 'app-locked'] as const)('discards a result when %s', state => {
    if (state === 'switching') useWorkspaceStore.setState({ isSwitching: true });
    if (state === 'workspace-locked') useWorkspaceStore.setState({ isVaultLocked: true });
    if (state === 'app-locked') useAppLockStore.setState({ state: { ...useAppLockStore.getState().state!, phase: 'locked' } });
    const before = useSessionStore.getState();
    expect(adoptWorkspaceProfiles({ workspaceId: state === 'other-workspace' ? 'other' : 'default', profiles: [] })).toBe(false);
    expect(useSessionStore.getState().sessions).toBe(before.sessions);
    expect(useSessionStore.getState().selectedSessionIndex).toBe(before.selectedSessionIndex);
    expect(window.electronAPI.saveProfiles).not.toHaveBeenCalled();
  });
});
