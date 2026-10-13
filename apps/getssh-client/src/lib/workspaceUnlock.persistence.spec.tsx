// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadActiveWorkspace } from './workspaceUnlock';
import { useSessionManager } from '../hooks/useSessionManager';
import { useSessionStore, type SessionProfile } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAppLockStore } from '../store/appLockStore';
import { useCryptoStore } from '../store/cryptoStore';
import { useAppStore } from '../store/appStore';
import { ConnectFormOverlay } from '../components/app-overlays/ConnectFormOverlay';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }) }));
vi.mock('framer-motion', () => ({ motion: { button: ({ whileTap: _whileTap, children, ...props }: any) => <button {...props}>{children}</button> } }));

let root: Root;
let element: HTMLDivElement;
let manager: ReturnType<typeof useSessionManager>;
const connect = vi.fn();
const original: SessionProfile[] = [
  { id: 'saved-one', host: 'one.example', username: 'operator' },
  { id: 'saved-two', host: 'two.example', username: 'operator' },
];
const draft: SessionProfile = { id: 'draft', host: 'new.example', username: 'operator', isDraft: true, protocol: 'ssh' };
function Harness() {
  manager = useSessionManager();
  const sessions = useSessionStore(state => state.sessions);
  const selectedSessionIndex = useSessionStore(state => state.selectedSessionIndex);
  return <ConnectFormOverlay isDark selectedSessionIndex={selectedSessionIndex} sessions={sessions} activeTabId={null}
    appConfig={useAppStore.getState().appConfig} connecting={false} error={null} handleConnect={connect}
    syncProfiles={manager.syncProfiles} onCancel={() => {}} />;
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  useSessionStore.setState({ sessions: [], sessionsRevision: 0, profilesWorkspaceId: null, selectedSessionIndex: null, tabs: [], activeTabId: null });
  useWorkspaceStore.setState({ activeWorkspaceId: 'default', isVaultLocked: false, isSwitching: false, isUnlockModalOpen: false });
  useAppLockStore.setState({ state: { phase: 'ready', appProtected: false, presenceSupported: false, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false } });
  window.electronAPI = { unlockProfiles: vi.fn().mockResolvedValue(original), saveProfiles: vi.fn().mockResolvedValue(true), assetFolders: { list: vi.fn().mockResolvedValue({ success: true, folders: [] }) } } as unknown as Window['electronAPI'];
  element = document.createElement('div'); document.body.append(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.useRealTimers(); });
const render = async () => act(async () => root.render(<Harness />));
const addDraft = async () => act(async () => { useSessionStore.getState().setSessions([{ ...draft }]); useSessionStore.getState().setSelectedSessionIndex(0); });

describe('workspace loading and complete-list saves', () => {
  it('retains saved hosts and a draft added while loading, then saves the complete list', async () => {
    let finish!: (profiles: SessionProfile[]) => void;
    vi.mocked(window.electronAPI.unlockProfiles).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const loading = loadActiveWorkspace();
    await addDraft(); await render();
    const username = element.querySelector('input[autocomplete="username"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(username, 'edited-user');
      username.dispatchEvent(new Event('input', { bubbles: true })); vi.advanceTimersByTime(400);
    });
    expect(window.electronAPI.saveProfiles).not.toHaveBeenCalled();
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await act(async () => element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(connect).not.toHaveBeenCalled();
    await act(async () => finish(original)); expect(await loading).toBe(true);
    expect(useSessionStore.getState().sessions.map(profile => profile.id)).toEqual(['saved-one', 'saved-two', 'draft']);
    expect(useSessionStore.getState().sessions[2].username).toBe('edited-user');
    expect(useSessionStore.getState().selectedSessionIndex).toBe(2);
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    await act(async () => element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(connect).toHaveBeenCalledOnce();
    expect(window.electronAPI.saveProfiles).toHaveBeenCalledWith({ workspaceId: 'default', payload: expect.arrayContaining(original) });
    expect(vi.mocked(window.electronAPI.saveProfiles).mock.calls.at(-1)![0].payload.map(profile => profile.id)).toEqual(['saved-one', 'saved-two', 'draft']);
  });

  it('does not save a draft during the earlier checkProfiles startup window', async () => {
    await addDraft(); await render();
    await act(async () => manager.syncProfiles(useSessionStore.getState().sessions));
    expect(window.electronAPI.saveProfiles).not.toHaveBeenCalled();
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });

  it('merges a quick connection without including it in the saved list', async () => {
    let finish!: (profiles: SessionProfile[]) => void;
    vi.mocked(window.electronAPI.unlockProfiles).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const loading = loadActiveWorkspace();
    useSessionStore.getState().setSessions([{ ...draft, isQuickConnect: true }]);
    finish(original); await loading; await render();
    expect(useSessionStore.getState().sessions).toHaveLength(3);
    await act(async () => manager.syncProfiles(useSessionStore.getState().sessions));
    expect(window.electronAPI.saveProfiles).toHaveBeenCalledWith({ workspaceId: 'default', payload: original });
  });

  it('preserves a complete imported replacement but clears the current unlock state', async () => {
    let finish!: (profiles: SessionProfile[]) => void;
    vi.mocked(window.electronAPI.unlockProfiles).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    useWorkspaceStore.setState({ isVaultLocked: true, isUnlockModalOpen: true });
    useCryptoStore.getState().setCryptoMode('locked');
    const loading = loadActiveWorkspace();
    const imported = [{ id: 'imported', host: 'imported.example', username: 'operator' }];
    useSessionStore.getState().replaceSessions(imported, 'default');
    finish(original); await loading;
    expect(useSessionStore.getState().sessions).toEqual(imported);
    expect(useWorkspaceStore.getState()).toMatchObject({ isVaultLocked: false, isUnlockModalOpen: false });
    expect(useCryptoStore.getState().cryptoMode).toBe('idle');
  });

  it('does not unlock a later workspace or replay data after a lock/unlock cycle', async () => {
    let finish!: (profiles: SessionProfile[]) => void;
    vi.mocked(window.electronAPI.unlockProfiles).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const loading = loadActiveWorkspace();
    useWorkspaceStore.setState({ activeWorkspaceId: 'other', isVaultLocked: true });
    finish(original); await loading;
    expect(useSessionStore.getState().sessions).toEqual([]); expect(useWorkspaceStore.getState().isVaultLocked).toBe(true);
    useWorkspaceStore.setState({ activeWorkspaceId: 'default', isVaultLocked: false });
    const stale = loadActiveWorkspace();
    const ready = useAppLockStore.getState().state!;
    useAppLockStore.setState({ state: { ...ready, phase: 'locked' } });
    useAppLockStore.setState({ state: ready }); finish(original); await stale;
    expect(useSessionStore.getState().sessions).toEqual([]); expect(useSessionStore.getState().profilesWorkspaceId).toBeNull();
  });

  it('keeps a complete import when an older load fails afterwards', async () => {
    let fail!: (error: Error) => void;
    vi.mocked(window.electronAPI.unlockProfiles).mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    useWorkspaceStore.setState({ isVaultLocked: true });
    const loading = loadActiveWorkspace();
    useSessionStore.getState().replaceSessions(original, 'default'); fail(new Error('old load failed'));
    expect(await loading).toBe(true); expect(useSessionStore.getState().sessions).toEqual(original);
    expect(useWorkspaceStore.getState().isVaultLocked).toBe(false);
  });
});
