// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ workspaceId: 'main', sessions: [] as unknown[],
  setSessions: vi.fn(), setWorkspace: vi.fn(), setCryptoMode: vi.fn() }));
vi.mock('../store/sessionStore', () => ({ useSessionStore: { getState: () => ({ sessions: state.sessions, setSessions: state.setSessions }) } }));
vi.mock('../store/workspaceStore', () => ({ useWorkspaceStore: { getState: () => ({ activeWorkspaceId: state.workspaceId }), setState: state.setWorkspace } }));
vi.mock('../store/cryptoStore', () => ({ useCryptoStore: { getState: () => ({ setCryptoMode: state.setCryptoMode }) } }));
import { loadActiveWorkspace } from './workspaceUnlock';

beforeEach(() => { vi.clearAllMocks(); state.workspaceId = 'main'; state.sessions = []; });

describe('workspace profile load', () => {
  it('does not overwrite a list replaced by a later legacy import', async () => {
    let finish!: (profiles: unknown[]) => void;
    window.electronAPI = { unlockProfiles: vi.fn(() => new Promise(resolve => { finish = resolve; })) } as any;
    const loading = loadActiveWorkspace();
    state.sessions = [{ id: 'newly-imported' }];
    finish([{ id: 'old-snapshot' }]);
    expect(await loading).toBe(true);
    expect(state.setSessions).not.toHaveBeenCalled();
    expect(state.setWorkspace).not.toHaveBeenCalled();
  });

  it('does not put a previous workspace list into the new workspace', async () => {
    let finish!: (profiles: unknown[]) => void;
    window.electronAPI = { unlockProfiles: vi.fn(() => new Promise(resolve => { finish = resolve; })) } as any;
    const loading = loadActiveWorkspace();
    state.workspaceId = 'other';
    finish([{ id: 'old-workspace' }]);
    expect(await loading).toBe(true);
    expect(state.setSessions).not.toHaveBeenCalled();
  });

  it('applies the current list and still reports an actual unlock failure', async () => {
    window.electronAPI = { unlockProfiles: vi.fn().mockResolvedValue([{ id: 'current' }]) } as any;
    expect(await loadActiveWorkspace()).toBe(true);
    expect(state.setSessions).toHaveBeenCalledWith([{ id: 'current' }]);
    window.electronAPI.unlockProfiles = vi.fn().mockRejectedValue(new Error('locked'));
    expect(await loadActiveWorkspace()).toBe(false);
  });
});
