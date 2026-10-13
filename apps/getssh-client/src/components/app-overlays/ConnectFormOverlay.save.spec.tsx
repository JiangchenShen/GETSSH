// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore, type SessionProfile } from '../../store/sessionStore';
import { useAppLockStore } from '../../store/appLockStore';
const mocks = vi.hoisted(() => ({ props: null as any }));
vi.mock('../ConnectForm', () => ({ ConnectForm: (props: any) => { mocks.props = props; return null; } }));
vi.mock('../../store/workspaceStore', async () => {
  const { create } = await import('zustand');
  return { useWorkspaceStore: create(() => ({ activeWorkspaceId: 'current', isSwitching: false, isVaultLocked: false })) };
});
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ConnectFormOverlay } from './ConnectFormOverlay';

const profile = (): SessionProfile => ({ id: 'server', host: 'server.example', username: 'user', hasPassword: true });
let root: Root;
let container: HTMLDivElement;
let saveProfiles: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); mocks.props = null;
  useWorkspaceStore.setState({ activeWorkspaceId: 'current', isSwitching: false, isVaultLocked: false });
  useSessionStore.setState({ sessions: [profile()], profilesWorkspaceId: 'current', sessionsRevision: 0 });
  useAppLockStore.setState({ state: { phase: 'ready', appProtected: false, presenceSupported: false, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false } });
  saveProfiles = vi.fn().mockResolvedValue(true); window.electronAPI = { saveProfiles } as unknown as Window['electronAPI'];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async () => act(async () => root.render(<ConnectFormOverlay sessions={useSessionStore.getState().sessions} selectedSessionIndex={0} activeTabId={null} appConfig={{}} isDark={true} connecting={false} error={null} onCancel={() => {}} handleConnect={async () => {}} syncProfiles={() => {}} />));
const clear = () => mocks.props.onSaveSession(0, { ...profile(), password: '', hasPassword: false, isDraft: false }) as Promise<boolean>;

describe('explicit connection save acknowledgement', () => {
  it('updates saved flags only after a true acknowledgement and includes saved drafts in the payload', async () => {
    useSessionStore.setState({ sessions: [{ ...profile(), isDraft: true }] });
    let finish!: (value: boolean) => void; saveProfiles.mockImplementation(() => new Promise(resolve => { finish = resolve; })); await render();
    let pending!: Promise<boolean>; await act(async () => { pending = clear(); });
    expect(saveProfiles).toHaveBeenCalledWith({ workspaceId: 'current', payload: [expect.objectContaining({ id: 'server', isDraft: false, password: '', hasPassword: false })] });
    expect(useSessionStore.getState().sessions[0]).toMatchObject({ isDraft: true, hasPassword: true });
    await act(async () => { finish(true); expect(await pending).toBe(true); });
    expect(useSessionStore.getState().sessions[0]).toMatchObject({ isDraft: false, hasPassword: false, password: undefined });
  });

  it('keeps saved flags unchanged when storage does not acknowledge the save', async () => {
    saveProfiles.mockResolvedValue(false); await render(); await act(async () => expect(await clear()).toBe(false));
    expect(useSessionStore.getState().sessions[0]).toEqual(profile());
  });

  it('does not write an unhydrated profile list', async () => {
    useSessionStore.setState({ profilesWorkspaceId: null }); await render(); await act(async () => expect(await clear()).toBe(false)); expect(saveProfiles).not.toHaveBeenCalled();
  });

  it('merges acknowledgement by ID into the current list without dropping new drafts or other edits', async () => {
    let finish!: (value: boolean) => void; saveProfiles.mockImplementation(() => new Promise(resolve => { finish = resolve; })); await render();
    let pending!: Promise<boolean>; await act(async () => { pending = clear(); });
    const draft: SessionProfile = { id: 'new-draft', isDraft: true, host: 'new.example', username: 'other' };
    useSessionStore.getState().setSessions([draft, { ...profile(), alias: 'edited while saving' }]);
    await act(async () => { finish(true); expect(await pending).toBe(true); });
    expect(useSessionStore.getState().sessions).toEqual([draft, { ...profile(), alias: 'edited while saving', isDraft: false, hasPassword: false, password: undefined }]);
    expect(saveProfiles).toHaveBeenCalledTimes(1);
  });

  it.each(['replacement', 'lock-cycle', 'workspace-cycle', 'unmount'])('discards a late acknowledgement after %s without another save', async transition => {
    let finish!: (value: boolean) => void; saveProfiles.mockImplementation(() => new Promise(resolve => { finish = resolve; })); await render();
    let pending!: Promise<boolean>; await act(async () => { pending = clear(); });
    if (transition === 'replacement') useSessionStore.getState().replaceSessions([{ ...profile(), alias: 'imported' }], 'current');
    else if (transition === 'lock-cycle') {
      const state = useAppLockStore.getState().state!; useAppLockStore.setState({ state: { ...state, phase: 'locked' } }); useAppLockStore.setState({ state });
    } else if (transition === 'workspace-cycle') { useWorkspaceStore.setState({ activeWorkspaceId: 'other' }); useWorkspaceStore.setState({ activeWorkspaceId: 'current' }); }
    else await act(async () => root.render(null));
    const current = useSessionStore.getState().sessions;
    await act(async () => { finish(true); expect(await pending).toBe(false); });
    expect(useSessionStore.getState().sessions).toEqual(current); expect(saveProfiles).toHaveBeenCalledTimes(1);
  });
});
