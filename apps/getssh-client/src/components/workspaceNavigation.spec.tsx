// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ setIsCommandCenterOpen: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string) => ({
    'statusBar.commandCenter': '指令中心',
    'statusBar.ai': 'AI',
    'statusBar.workspace': '工作区',
    'statusBar.plugins': '插件',
    'statusBar.settings': '设置',
    'statusBar.secure': '安全',
    'statusBar.sentinelOk': 'Ocean Sentinel 正常',
  } as Record<string, string>)[key] || key,
}) }));
vi.mock('../store/appStore', () => ({ useAppStore: (select: (state: any) => any) => select({
  isMac: true,
  setIsCommandCenterOpen: mocks.setIsCommandCenterOpen,
  sentinelStatus: { status: 'secure', daemonState: 'running', sentinelDisabled: false },
}) }));

import { StatusBar } from './StatusBar';

let root: Root;
let container: HTMLDivElement;
const destination = vi.fn();
const receiveDestination = (event: Event) => destination((event as CustomEvent).detail);
const button = (label: string) => Array.from(container.querySelectorAll('button')).find(item => item.title === label)!;
const click = async (element: HTMLElement) => act(async () => element.click());

beforeEach(async () => {
  vi.clearAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.addEventListener('app:open-center', receiveDestination);
  await act(async () => root.render(<StatusBar />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  window.removeEventListener('app:open-center', receiveDestination);
  container.remove();
});

describe('status bar workspace navigation', () => {
  it('keeps a visible, focusable workspace button that opens the dedicated overview', async () => {
    const control = button('工作区');
    expect(control).toBeDefined();
    expect(control.textContent).toBe('工作区');
    expect(control.type).toBe('button');
    expect(control.closest('.opacity-0, .hidden')).toBeNull();
    control.focus();
    expect(document.activeElement).toBe(control);
    await click(control);
    expect(destination).toHaveBeenCalledExactlyOnceWith({ type: 'workspace', title: '工作区', workspacePage: 'all' });
  });

  it('retains the command center action', async () => {
    await click(button('指令中心'));
    expect(mocks.setIsCommandCenterOpen).toHaveBeenCalledExactlyOnceWith(true);
    expect(destination).not.toHaveBeenCalled();
  });

  it.each([
    ['AI', 'ai'],
    ['插件', 'plugin'],
    ['设置', 'settings'],
  ])('retains the %s destination', async (label, type) => {
    await click(button(label));
    expect(destination).toHaveBeenCalledExactlyOnceWith({ type, title: label });
    expect(mocks.setIsCommandCenterOpen).not.toHaveBeenCalled();
  });

  it('routes Ocean Sentinel to security settings', async () => {
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="安全 · Ocean Sentinel 正常"]')!);
    expect(destination).toHaveBeenCalledExactlyOnceWith({ type: 'settings', title: '设置', settingsTab: 'Security' });
  });
});
