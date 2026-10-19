// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecurityStatus } from '../types/ipc';
import { useAppLockStore } from '../store/appLockStore';
import { useRecoveryReminderStore } from '../store/recoveryReminderStore';

const mocks = vi.hoisted(() => ({
  isConfigLoaded: true,
  workspaceUnprotected: true,
  pollSentinelStatus: vi.fn(),
  addToast: vi.fn(),
  realStorage: false,
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
vi.mock('../store/workspaceStore', async () => {
  const { create } = await import('zustand');
  return { useWorkspaceStore: create(() => ({ activeWorkspaceId: 'current', isSwitching: false, isVaultLocked: false,
    workspaces: [{ id: 'current', name: 'Current', themeColor: '#000', isMain: false, hasPassword: false }] })) };
});
import { useWorkspaceStore } from '../store/workspaceStore';
vi.mock('./secure-center/tabs/SafeStorageTab', async importOriginal => {
  const { SafeStorageTab: ActualSafeStorageTab } = await importOriginal<typeof import('./secure-center/tabs/SafeStorageTab')>();
  return { SafeStorageTab: (props: any) => mocks.realStorage ? <ActualSafeStorageTab {...props} /> : <div data-section={props.section} data-recovery-request={props.recoveryRequest}>Password settings<button type="button" onClick={() => props.onStatusChange({ ...protectedStatus(), recoveryConfigured: true })}>Confirm recovery setup</button></div> };
});
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
  mocks.realStorage = false;
  useAppLockStore.setState({ state: { phase: 'ready', appProtected: true, recoveryConfigured: false, presenceSupported: true, presenceEnabled: false, deviceKeyLost: false, masterPasswordMustChange: false } });
  useWorkspaceStore.setState({ activeWorkspaceId: 'current', isSwitching: false, isVaultLocked: false });
  useRecoveryReminderStore.setState({ unconfirmed: false, visible: false });
  status = vi.fn().mockResolvedValue(protectedStatus());
  getKnownHosts = vi.fn().mockResolvedValue([]);
  window.electronAPI = { security: { status }, getKnownHosts } as unknown as Window['electronAPI'];
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useAppLockStore.setState({ state: null });
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
  it('links missing recovery to its form and removes the reminder after confirmed setup', async () => {
    await render();
    expect(container.querySelector('section[aria-label="Needs attention"]')!.textContent).toContain('No recovery code yet');
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Generate recovery code')!.click());
    expect(container.querySelector('[data-section="app"]')?.getAttribute('data-recovery-request')).toBe('1');
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Confirm recovery setup')!.click());
    expect(container.textContent).not.toContain('No recovery code yet'); expect(container.textContent).toContain('Recovery code created.');
  });

  // R36: a code shown once and never confirmed (detail closed, Settings left, app locked) is lost.
  it('reminds about a recovery code that was shown but never confirmed, except while it is on screen', async () => {
    status.mockResolvedValue({ ...protectedStatus(), recoveryConfigured: true });
    await act(async () => useRecoveryReminderStore.setState({ unconfirmed: true, visible: true })); await render();
    expect(container.textContent).not.toContain('Recovery code not confirmed');
    await act(async () => useRecoveryReminderStore.setState({ visible: false }));
    expect(container.querySelector('section[aria-label="Needs attention"]')!.textContent).toContain('Recovery code not confirmed');
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Generate a new code')!.click());
    expect(container.querySelector('[data-section="app"]')?.getAttribute('data-recovery-request')).toBe('1');
    await act(async () => useRecoveryReminderStore.setState({ unconfirmed: false }));
    expect(container.textContent).not.toContain('Recovery code not confirmed');
  });

  it('reminds about an unconfirmed recovery code without a master password', async () => {
    status.mockResolvedValue({ ...protectedStatus(), appProtected: false, recoveryConfigured: true });
    useRecoveryReminderStore.setState({ unconfirmed: true }); await render();
    expect(container.querySelector('section[aria-label="Needs attention"]')!.textContent).toContain('Recovery code not confirmed');
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Generate a new code')).toBe(true);
  });

  it.each(['Generate recovery code', 'Generate a new code'])('consumes %s once, so reopening details after removing the master password does not reopen its form', async entry => {
    mocks.realStorage = true;
    let current = { ...protectedStatus(), recoveryConfigured: entry === 'Generate a new code' };
    status.mockImplementation(async () => current);
    useRecoveryReminderStore.setState({ unconfirmed: entry === 'Generate a new code' });
    await render();
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === entry)!.click());
    expect(container.querySelector('form')).not.toBeNull();
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Cancel')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Close details"]')!.click());
    current = { ...current, appProtected: false };
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Master password & recovery · Manage"]')!.click());
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    if (entry === 'Generate a new code') {
      await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === entry)!.click());
      expect(container.querySelector('form')).not.toBeNull();
      expect(container.querySelector('input[type="password"]')).toBeNull();
    }
  });

  it.each(['no-master', 'configured'])('does not warn about missing recovery when %s', async state => {
    const metadata = protectedStatus();
    if (state === 'no-master') metadata.appProtected = false; else metadata.recoveryConfigured = true;
    status.mockResolvedValue(metadata); await render(); expect(container.textContent).not.toContain('No recovery code yet');
  });

  it('keeps the app recovery reminder available when only the workspace is locked', async () => {
    useWorkspaceStore.setState({ isVaultLocked: true }); await render(); expect(container.textContent).toContain('No recovery code yet');
  });

  it('does not overwrite confirmed recovery with a late overview lookup', async () => {
    let complete!: (value: SecurityStatus) => void;
    status.mockResolvedValueOnce(protectedStatus()).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await render();
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Generate recovery code')!.click());
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Confirm recovery setup')!.click());
    await act(async () => complete(protectedStatus()));
    expect(container.textContent).not.toContain('No recovery code yet'); expect(container.textContent).toContain('Recovery code created.');
  });

  it('rejects an older recovery state after an app lock and unlock cycle', async () => {
    let complete!: (value: SecurityStatus) => void;
    status.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValue({ ...protectedStatus(), recoveryConfigured: true });
    await render();
    await act(async () => {
      const state = useAppLockStore.getState().state!;
      useAppLockStore.setState({ state: { ...state, phase: 'locked' } }); useAppLockStore.setState({ state });
    });
    await act(async () => complete(protectedStatus()));
    expect(container.textContent).not.toContain('No recovery code yet'); expect(container.textContent).toContain('Recovery code created.');
  });
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
