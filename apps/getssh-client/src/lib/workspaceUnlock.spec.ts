// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ workspaceId: 'main', sessions: [] as unknown[], revision: 0,
  replaceSessions: vi.fn(), setSelectedSessionIndex: vi.fn(), setWorkspace: vi.fn(), setCryptoMode: vi.fn() }));
vi.mock('../store/sessionStore', () => ({ useSessionStore: { getState: () => ({ sessions: state.sessions, sessionsRevision: state.revision, replaceSessions: state.replaceSessions, setSelectedSessionIndex: state.setSelectedSessionIndex }) } }));
vi.mock('../store/workspaceStore', () => ({ useWorkspaceStore: { getState: () => ({ activeWorkspaceId: state.workspaceId }), setState: state.setWorkspace, subscribe: () => () => {} } }));
vi.mock('../store/cryptoStore', () => ({ useCryptoStore: { getState: () => ({ setCryptoMode: state.setCryptoMode }) } }));
import { loadActiveWorkspace } from './workspaceUnlock';

beforeEach(() => { vi.clearAllMocks(); state.workspaceId = 'main'; state.sessions = []; state.revision = 0; });

describe('workspace profile load', () => {
  it('does not overwrite a list replaced by a later legacy import', async () => {
    let finish!: (profiles: unknown[]) => void;
    window.electronAPI = { unlockProfiles: vi.fn(() => new Promise(resolve => { finish = resolve; })) } as any;
    const loading = loadActiveWorkspace();
    state.sessions = [{ id: 'newly-imported' }];
    state.revision++;
    finish([{ id: 'old-snapshot' }]);
    expect(await loading).toBe(true);
    expect(state.replaceSessions).not.toHaveBeenCalled();
    expect(state.setWorkspace).toHaveBeenCalledWith({ isVaultLocked: false, isUnlockModalOpen: false });
    expect(state.setCryptoMode).toHaveBeenCalledWith('idle');
  });

  it('does not put a previous workspace list into the new workspace', async () => {
    let finish!: (profiles: unknown[]) => void;
    window.electronAPI = { unlockProfiles: vi.fn(() => new Promise(resolve => { finish = resolve; })) } as any;
    const loading = loadActiveWorkspace();
    state.workspaceId = 'other';
    finish([{ id: 'old-workspace' }]);
    expect(await loading).toBe(true);
    expect(state.replaceSessions).not.toHaveBeenCalled();
    expect(state.setWorkspace).not.toHaveBeenCalled();
  });

  it('applies the current list and still reports an actual unlock failure', async () => {
    window.electronAPI = { unlockProfiles: vi.fn().mockResolvedValue([{ id: 'current' }]) } as any;
    expect(await loadActiveWorkspace()).toBe(true);
    expect(state.replaceSessions).toHaveBeenCalledWith([{ id: 'current' }], 'main');
    window.electronAPI.unlockProfiles = vi.fn().mockRejectedValue(new Error('locked'));
    expect(await loadActiveWorkspace()).toBe(false);
  });
});
