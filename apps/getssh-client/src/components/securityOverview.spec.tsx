// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecurityStatus } from '../types/ipc';

const mocks = vi.hoisted(() => ({
  isConfigLoaded: true,
  workspaceUnprotected: true,
  pollSentinelStatus: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, fallback?: string) => ({
    'security.knownHostsTitle': 'Known hosts',
    'security.privacyTitle': 'Privacy',
    'settings.pluginSecurityMode': 'Plugin permissions',
  } as Record<string, string>)[key] || fallback || key,
  i18n: { language: 'en-US' },
}) }));
vi.mock('../store/appStore', () => ({ useAppStore: (select: (state: any) => any) => select({
  appConfig: { pluginSecurityMode: 'safe', privacyMode: false, autoLockTimeout: 0 },
  isConfigLoaded: mocks.isConfigLoaded,
  updateConfig: vi.fn(),
  addToast: mocks.addToast,
  pollSentinelStatus: mocks.pollSentinelStatus,
  sentinelStatus: { status: 'secure', daemonState: 'running', sentinelDisabled: false },
  sentinelStatusError: null,
}) }));
vi.mock('../store/cryptoStore', () => ({ useCryptoStore: (select: (state: any) => any) => select({ workspaceUnprotected: mocks.workspaceUnprotected }) }));
vi.mock('../store/workspaceStore', () => ({ useWorkspaceStore: (select: (state: any) => any) => select({
  activeWorkspaceId: 'current',
  workspaces: [{ id: 'current', name: 'Current', isMain: false, hasPassword: false }],
}) }));
vi.mock('./secure-center/tabs/SafeStorageTab', () => ({ SafeStorageTab: () => <div>Password settings</div> }));
vi.mock('./secure-center/tabs/KnownHostsTab', () => ({ KnownHostsTab: () => <div>Known hosts detail</div> }));

import { SecurityTab } from './settings/tabs/SecurityTab';

const protectedStatus = (): SecurityStatus => ({
  appProtected: true,
  recoveryConfigured: false,
  presenceSupported: true,
  deviceBackend: 'macos-keychain',
  scopes: [
    { id: 'app', workspaceId: null, protected: true, ownPassword: true, presence: false, unlocked: true, recovery: false, revealRemainingMs: null },
    { id: 'ws:other', workspaceId: 'other', protected: false, ownPassword: false, presence: false, unlocked: true, recovery: false, revealRemainingMs: null },
    { id: 'ws:current', workspaceId: 'current', protected: true, ownPassword: false, presence: false, unlocked: true, recovery: false, revealRemainingMs: null },
  ],
});

let root: Root;
let container: HTMLDivElement;
let status: ReturnType<typeof vi.fn>;
let getKnownHosts: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isConfigLoaded = true;
  mocks.workspaceUnprotected = true;
  status = vi.fn().mockResolvedValue(protectedStatus());
  getKnownHosts = vi.fn().mockResolvedValue([]);
  window.electronAPI = { security: { status }, getKnownHosts } as unknown as Window['electronAPI'];
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = () => act(async () => root.render(<SecurityTab />));
const summaryState = (label: string) => {
  const row = Array.from(container.querySelectorAll('.security-protection-row')).find(item => item.querySelector('h3')?.textContent === label);
  expect(row, `Missing security summary row: ${label}`).toBeDefined();
  const state = row!.querySelector('.security-protection-state');
  expect(state, `Missing state for security summary row: ${label}`).not.toBeNull();
  return state!.textContent!.trim();
};
const expectNoPasswordWarning = () => expect(container.textContent).not.toContain('This workspace has no password');

describe('security dashboard metadata', () => {
  it('uses the current scope protection even when it has no own password and the legacy store says unprotected', async () => {
    await render();
    expect(status).toHaveBeenCalledTimes(1);
    expect(summaryState('Workspace password')).toBe('Master password');
    expectNoPasswordWarning();
  });

  it('warns only after the current scope explicitly reports no protection', async () => {
    const metadata = protectedStatus();
    metadata.appProtected = false;
    metadata.scopes.find(scope => scope.workspaceId === 'current')!.protected = false;
    status.mockResolvedValue(metadata);
    await render();
    expect(summaryState('Workspace password')).toBe('Not set');
    expect(container.textContent).toContain('This workspace has no password');
  });

  it.each(['null', 'rejected'])('keeps protection unconfirmed after %s metadata instead of treating it as disabled', async failure => {
    if (failure === 'null') status.mockResolvedValue(null);
    else status.mockRejectedValue(new Error('Metadata unavailable'));
    await render();
    expect(summaryState('Master password & recovery')).toBe('Not confirmed');
    expect(summaryState('Workspace password')).toBe('Not confirmed');
    expectNoPasswordWarning();
  });

  it('does not fabricate a zero host count while loading, but shows the confirmed empty result', async () => {
    let resolveHosts!: (hosts: []) => void;
    getKnownHosts.mockImplementation(() => new Promise(resolve => { resolveHosts = resolve; }));
    await render();
    expect(summaryState('Known hosts')).toBe('Not confirmed');
    await act(async () => resolveHosts([]));
    expect(summaryState('Known hosts')).toBe('0 records');
  });

  it('keeps a failed host lookup unconfirmed instead of displaying zero records', async () => {
    getKnownHosts.mockRejectedValue(new Error('Hosts unavailable'));
    await render();
    expect(summaryState('Known hosts')).toBe('Not confirmed');
  });

  it('does not present the default plugin mode as loaded configuration', async () => {
    mocks.isConfigLoaded = false;
    await render();
    expect(summaryState('Plugin permissions')).toBe('Not confirmed');
    mocks.isConfigLoaded = true;
    await render();
    expect(summaryState('Plugin permissions')).toBe('Safe mode');
  });
});
