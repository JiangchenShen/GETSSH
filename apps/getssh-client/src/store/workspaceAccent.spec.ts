// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from './sessionStore';
import { useWorkspaceStore } from './workspaceStore';

const originalApi = window.electronAPI;
beforeEach(() => {
  vi.useFakeTimers();
  useSessionStore.setState({ tabs: [], sessions: [] });
  useWorkspaceStore.setState({ activeWorkspaceId: 'before', isSwitching: false });
  document.documentElement.style.setProperty('--primary-color', '0 212 255');
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  window.electronAPI = originalApi;
  document.documentElement.style.removeProperty('--primary-color');
});

describe.each(['workspace', 'session'] as const)('%s workspace accent', entry => {
  it.each([
    ['#f43f5e', '244 63 94'],
    ['#AbC', '170 187 204'],
    ['14 165 233', '14 165 233'],
    ['invalid', '0 212 255'],
    ['999 0 0', '0 212 255'],
  ])('keeps a valid RGB channel value after switching to %s', async (themeColor, expected) => {
    window.electronAPI = { workspace: { switchWorkspace: vi.fn().mockResolvedValue({ success: true, visualMeta: { themeColor }, profiles: [] }) } } as any;
    useWorkspaceStore.setState({ workspaces: [{ id: 'after', name: 'After', themeColor, hasPassword: false }] });
    const switched = entry === 'workspace'
      ? await useWorkspaceStore.getState().switchWorkspace('after')
      : await useSessionStore.getState().switchWorkspace('after');
    expect(switched).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--primary-color')).toBe(expected);
  });
});
