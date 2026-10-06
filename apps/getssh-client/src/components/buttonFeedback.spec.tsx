// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appConfig: {} as Record<string, any>,
  workspaceUnprotected: false,
  setPlugins: vi.fn(),
  updateConfig: vi.fn(),
  addToast: vi.fn(),
  pollSentinelStatus: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, fallback?: string) => ({
    'security.privacyTitle': 'Privacy',
    'settings.pluginSecurityMode': 'Plugin permissions',
    'common.cancel': 'Cancel',
  } as Record<string, string>)[key] || fallback || key,
  i18n: { language: 'en-US' },
}) }));
vi.mock('../store/appStore', () => ({ useAppStore: (select: (state: any) => any) => select({
  appConfig: mocks.appConfig,
  isConfigLoaded: true,
  updateConfig: mocks.updateConfig,
  addToast: mocks.addToast,
  pollSentinelStatus: mocks.pollSentinelStatus,
  sentinelStatus: { status: 'secure', daemonState: 'running', lastPing: 1728000000000 },
}) }));
vi.mock('../store/cryptoStore', () => ({ useCryptoStore: (select: (state: any) => any) => select({ workspaceUnprotected: mocks.workspaceUnprotected }) }));
vi.mock('../store/workspaceStore', () => ({ useWorkspaceStore: (select: (state: any) => any) => select({
  activeWorkspaceId: 'default',
  workspaces: [{ id: 'default', name: 'Default', isMain: true }],
}) }));
vi.mock('../store/pluginStore', () => ({ usePluginStore: () => ({ installedPlugins: [], setPlugins: mocks.setPlugins }) }));
vi.mock('./secure-center/tabs/SafeStorageTab', () => ({ SafeStorageTab: () => <div>Password settings</div> }));
vi.mock('./secure-center/tabs/KnownHostsTab', () => ({ KnownHostsTab: () => <div>Known hosts</div> }));

import { SecurityTab } from './settings/tabs/SecurityTab';
import { PluginSettings } from './PluginSettings';

let root: Root;
let container: HTMLDivElement;
let scrollIntoView: ReturnType<typeof vi.fn>;
let updateBackendConfig: ReturnType<typeof vi.fn>;
let abortPluginInstall: ReturnType<typeof vi.fn>;
let commitPluginInstall: ReturnType<typeof vi.fn>;
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
const preview = { success: true, manifest: { name: 'sample', version: '1.0.0' }, tempDir: '/private/tmp/mock-plugin-preview', sourceDir: '/private/tmp/mock-plugin-preview/source' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appConfig = { pluginSecurityMode: 'safe', privacyMode: false, autoLockTimeout: 0 };
  mocks.workspaceUnprotected = false;
  mocks.updateConfig.mockImplementation((key, value) => { mocks.appConfig[key] = value; });
  scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  updateBackendConfig = vi.fn().mockResolvedValue({ success: true });
  abortPluginInstall = vi.fn().mockResolvedValue({ success: true });
  commitPluginInstall = vi.fn().mockResolvedValue({ success: true });
  window.electronAPI = {
    security: { status: vi.fn(async () => ({
      appProtected: !mocks.workspaceUnprotected,
      recoveryConfigured: !mocks.workspaceUnprotected,
      presenceSupported: false,
      deviceBackend: 'test',
      scopes: [{ id: 'workspace/default', workspaceId: 'default', protected: !mocks.workspaceUnprotected, ownPassword: false, presence: false, unlocked: true, recovery: false, revealRemainingMs: null }],
    })) },
    getKnownHosts: vi.fn().mockResolvedValue([]),
    updateBackendConfig,
    reloadPlugins: vi.fn().mockResolvedValue({ success: true }),
    getPluginsList: vi.fn().mockResolvedValue([]),
    getPathForFile: vi.fn().mockReturnValue('/private/tmp/mock-plugin.zip'),
    previewPlugin: vi.fn().mockResolvedValue(preview),
    abortPluginInstall,
    commitPluginInstall,
  } as unknown as Window['electronAPI'];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
  else delete (HTMLElement.prototype as any).scrollIntoView;
});

const click = async (element: HTMLElement) => act(async () => element.click());
const button = (text: string) => Array.from(container.querySelectorAll('button')).find(item => item.textContent === text)!;
const pluginManage = () => Array.from(container.querySelectorAll('.settings-row')).find(row => row.textContent?.includes('Plugin permissions'))!.querySelector<HTMLButtonElement>('button')!;
const changeMode = async () => act(async () => {
  const select = container.querySelector<HTMLSelectElement>('select')!;
  select.value = 'normal';
  select.dispatchEvent(new Event('change', { bubbles: true }));
});
const enterPassword = async (value: string) => act(async () => {
  const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const openPreview = async () => {
  await act(async () => root.render(<PluginSettings />));
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['mock'], 'mock-plugin.zip')] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
};

describe('button feedback', () => {
  it('reveals and focuses security details, including repeated opens, then restores the invoking button', async () => {
    await act(async () => root.render(<SecurityTab />));
    const configure = button('Configure');
    await click(configure);
    const details = container.querySelector<HTMLElement>('section[aria-label="Privacy & auto-lock"]')!;
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(details);
    expect(document.activeElement).toBe(details);
    await click(configure);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    await click(container.querySelector<HTMLElement>('[aria-label="Close details"]')!);
    expect(container.querySelector('section[aria-label="Privacy & auto-lock"]')).toBeNull();
    expect(document.activeElement).toBe(configure);
  });

  it('also reveals password settings opened from the unprotected-workspace notice', async () => {
    mocks.workspaceUnprotected = true;
    await act(async () => root.render(<SecurityTab />));
    const warningAction = button('Set a master password');
    await click(warningAction);
    const details = container.querySelector('section[aria-label="Master password & recovery"]')!;
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(details);
    expect(document.activeElement).toBe(details);
    await click(container.querySelector<HTMLElement>('[aria-label="Close details"]')!);
    expect(document.activeElement).toBe(warningAction);
  });

  it('verifies a requested plugin mode inline; failures preserve the form and only success changes permissions', async () => {
    updateBackendConfig
      .mockResolvedValueOnce({ success: false, verification: 'password_required' })
      .mockResolvedValueOnce({ success: false, verification: 'denied', error: 'Verification failed' })
      .mockResolvedValueOnce({ success: true });
    await act(async () => root.render(<SecurityTab />));
    await click(pluginManage());
    await changeMode();
    expect(document.activeElement).toBe(container.querySelector('input[type="password"]'));
    expect(container.querySelector<HTMLSelectElement>('select')!.value).toBe('safe');
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    await enterPassword('wrong password');
    await click(button('Verify'));
    expect(updateBackendConfig).toHaveBeenLastCalledWith({ pluginSecurityMode: 'normal' }, 'wrong password');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Verification failed');
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    await enterPassword('correct password');
    await click(button('Verify'));
    expect(updateBackendConfig).toHaveBeenLastCalledWith({ pluginSecurityMode: 'normal' }, 'correct password');
    expect(mocks.updateConfig).toHaveBeenCalledWith('pluginSecurityMode', 'normal');
    expect(window.electronAPI.reloadPlugins).toHaveBeenCalledTimes(1);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.querySelector<HTMLSelectElement>('select')!.value).toBe('normal');
  });

  it('cancels plugin verification without changing permissions and clears the typed password', async () => {
    updateBackendConfig.mockResolvedValue({ success: false, verification: 'password_required' });
    await act(async () => root.render(<SecurityTab />));
    await click(pluginManage());
    await changeMode();
    await enterPassword('discard this secret');
    await click(button('Cancel'));
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(updateBackendConfig).toHaveBeenCalledTimes(1);
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    await changeMode();
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('');
  });

  it('keeps a failed install review open and displays the failure inside its dialog', async () => {
    commitPluginInstall.mockResolvedValue({ success: false, error: 'Install rejected' });
    await openPreview();
    await click(button('Accept & install'));
    expect(container.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe('Install rejected');
    expect(commitPluginInstall).toHaveBeenCalledWith({ manifest: preview.manifest, tempDir: preview.tempDir, sourceDir: preview.sourceDir });
    expect(abortPluginInstall).not.toHaveBeenCalled();
  });

  it.each(['refused', 'rejected'])('closes plugin review and displays cleanup failure when cancellation is %s', async failure => {
    if (failure === 'refused') abortPluginInstall.mockResolvedValue({ success: false, error: 'Cleanup failed' });
    else abortPluginInstall.mockRejectedValue(new Error('Cleanup failed'));
    await openPreview();
    await click(button('Cancel'));
    expect(abortPluginInstall).toHaveBeenCalledWith(preview.tempDir);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Cleanup failed');
    expect(button('Install local ZIP').disabled).toBe(false);
  });
});
