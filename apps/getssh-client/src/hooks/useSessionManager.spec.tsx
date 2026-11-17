// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: {} as any,
  workspace: { activeWorkspaceId: 'current' },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../store/sessionStore', () => ({
  useSessionStore: Object.assign((select: (state: any) => any) => select(mocks.session), { getState: () => mocks.session }),
  savedProfiles: (profiles: unknown[]) => profiles,
  callTidal: async (_action: string, call: Promise<unknown>) => call,
}));
vi.mock('../store/workspaceStore', () => ({ useWorkspaceStore: { getState: () => mocks.workspace } }));
vi.mock('../store/appStore', () => ({
  useAppStore: (select: (state: any) => any) => select({ appConfig: { keepalive: 30, defaultPort: 22 } }),
}));
vi.mock('../store/cryptoStore', () => ({ useCryptoStore: (select: (state: any) => any) => select({ setCryptoMode: vi.fn() }) }));
vi.mock('../lib/workspaceUnlock', () => ({ unlockActiveWorkspaceWithPassword: vi.fn() }));

import { useSessionManager } from './useSessionManager';

let root: Root;
let container: HTMLDivElement;
let manager: ReturnType<typeof useSessionManager>;
let connect: ReturnType<typeof vi.fn>;
let register: ReturnType<typeof vi.fn>;
const host = { id: 'host', host: 'host.example.test', username: 'user', password: 'test-secret', passphrase: 'test-passphrase' };
const Harness = () => { manager = useSessionManager(); return null; };

beforeEach(async () => {
  mocks.workspace.activeWorkspaceId = 'current';
  mocks.session = {
    sessions: [], tabs: [], connecting: false, error: null, selectedSessionIndex: null,
    activeTabId: null, activePaneId: null,
    setSessions: vi.fn((sessions: unknown[]) => { mocks.session.sessions = sessions; }),
    setTabs: vi.fn((tabs: unknown[]) => { mocks.session.tabs = tabs; }),
    setConnecting: vi.fn((value: boolean) => { mocks.session.connecting = value; }),
    setError: vi.fn((value: string | null) => { mocks.session.error = value; }),
    setSelectedSessionIndex: vi.fn((value: number | null) => { mocks.session.selectedSessionIndex = value; }),
    setActiveTabId: vi.fn((value: string | null) => { mocks.session.activeTabId = value; }),
    setActivePaneId: vi.fn((value: string | null) => { mocks.session.activePaneId = value; }),
  };
  connect = vi.fn();
  register = vi.fn().mockResolvedValue({ success: true });
  window.electronAPI = { sshConnect: connect, tidalRegisterTab: register } as unknown as Window['electronAPI'];
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('connection attempt lifecycle', () => {
  it('releases the pending state after an IPC rejection and allows retry', async () => {
    connect.mockRejectedValueOnce(new Error('Connection service unavailable'));
    await expect(manager.handleConnect(host)).resolves.toBeUndefined();
    expect(mocks.session.connecting).toBe(false);
    expect(mocks.session.error).toBe('Connection service unavailable');
    expect(mocks.session.tabs).toHaveLength(0);

    connect.mockResolvedValueOnce({ success: true, sessionId: 'retry-session' });
    await manager.handleConnect(host);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(mocks.session.error).toBeNull();
    expect(mocks.session.activeTabId).toBe('retry-session');
    expect(mocks.session.connecting).toBe(false);
    const paneConfig = mocks.session.tabs[0].paneTree.config;
    expect(paneConfig).not.toHaveProperty('password');
    expect(paneConfig).not.toHaveProperty('passphrase');
    expect(JSON.parse(register.mock.calls[0][4])).toEqual(paneConfig);
  });

  it('ignores rapid duplicate clicks while the first attempt is pending', async () => {
    let complete!: (result: unknown) => void;
    connect.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const first = manager.handleConnect(host);
    expect(mocks.session.connecting).toBe(true);
    const second = manager.handleConnect(host);
    expect(connect).toHaveBeenCalledTimes(1);
    complete({ success: false, error: 'Connection refused' });
    await Promise.all([first, second]);
    expect(mocks.session.connecting).toBe(false);
    expect(mocks.session.error).toBe('Connection refused');
  });

  it('keeps host verification failure readable and releases the pending state', async () => {
    connect.mockResolvedValue({ success: false, error: 'Host denied (verification failed)' });
    await manager.handleConnect(host);
    expect(mocks.session.error).toBe('connection.hostDenied');
    expect(mocks.session.connecting).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it('does not put a rejected old-workspace attempt into the new workspace error', async () => {
    let reject!: (reason: Error) => void;
    connect.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const attempt = manager.handleConnect(host);
    mocks.workspace.activeWorkspaceId = 'other';
    mocks.session.error = 'Current workspace error';
    reject(new Error('Old workspace failure'));
    await expect(attempt).resolves.toBeUndefined();
    expect(mocks.session.error).toBe('Current workspace error');
    expect(mocks.session.connecting).toBe(false);
  });

  it('keeps a completed old-workspace connection scoped without stealing current focus', async () => {
    let complete!: (result: unknown) => void;
    connect.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const attempt = manager.handleConnect(host);
    mocks.workspace.activeWorkspaceId = 'other';
    mocks.session.activeTabId = 'other-tab';
    mocks.session.activePaneId = 'other-pane';
    complete({ success: true, sessionId: 'old-session' });
    await attempt;
    expect(mocks.session.tabs[0].workspaceId).toBe('current');
    expect(mocks.session.activeTabId).toBe('other-tab');
    expect(mocks.session.activePaneId).toBe('other-pane');
    expect(mocks.session.connecting).toBe(false);
  });
});
