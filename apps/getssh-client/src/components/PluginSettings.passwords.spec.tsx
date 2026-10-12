// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginSettingsSchema } from '../types/plugin';

const mocks = vi.hoisted(() => ({ schema: [] as PluginSettingsSchema[], setPlugins: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }) }));
vi.mock('../store/pluginStore', () => ({ usePluginStore: (select?: (state: any) => any) => {
  const state = { installedPlugins: [{ name: 'sample', displayName: 'Sample', version: '1.0' }], setPlugins: mocks.setPlugins, settingsSchemas: { sample: mocks.schema } };
  return select ? select(state) : state;
} }));
import { PluginSettings } from './PluginSettings';

let root: Root;
let container: HTMLDivElement;
let storageGet: ReturnType<typeof vi.fn>;
let storageSet: ReturnType<typeof vi.fn>;
let savedPasswords: ReturnType<typeof vi.fn>;
let reloadPlugin: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks();
  mocks.schema = [{ id: 'token', label: 'Token', type: 'password' }];
  storageGet = vi.fn().mockResolvedValue('original endpoint'); storageSet = vi.fn().mockResolvedValue({ success: true }); savedPasswords = vi.fn().mockResolvedValue(['token']); reloadPlugin = vi.fn().mockResolvedValue({ success: true });
  window.electronAPI = { getPluginsList: vi.fn().mockResolvedValue([]), pluginStorageGet: storageGet, pluginStorageSet: storageSet, pluginSavedPasswords: savedPasswords, reloadPlugin } as unknown as Window['electronAPI'];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const button = (text: string) => Array.from(container.querySelectorAll('button')).find(item => item.textContent === text)!;
const click = async (text: string) => act(async () => button(text).click());
const open = async () => { await act(async () => root.render(<PluginSettings />)); await click('Configure plugin'); };
const input = () => container.querySelector<HTMLInputElement>('input[type="password"]')!;
const type = async (value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value); input().dispatchEvent(new Event('input', { bubbles: true }));
});

describe('plugin saved-password edits', () => {
  it('keeps an existing secret when an empty field is saved, without reading its value', async () => {
    await open(); expect(input().value).toBe(''); expect(input().placeholder).toBe('Saved. Leave empty to keep it');
    expect(storageGet).not.toHaveBeenCalled(); await click('Save & reload plugin');
    expect(storageSet).not.toHaveBeenCalled(); expect(reloadPlugin).toHaveBeenCalledWith('sample');
  });

  it.each(['', 'draft typed by the user'])('makes clearing pending and restores only the prior draft on Undo (%s)', async draft => {
    await open(); if (draft) await type(draft); await click('Clear saved value');
    expect(container.textContent).toContain('Will clear on save'); expect(input().value).toBe(''); expect(input().placeholder).toBe('');
    expect(storageSet).not.toHaveBeenCalled(); expect(reloadPlugin).not.toHaveBeenCalled();
    await click('Undo'); expect(container.textContent).not.toContain('Will clear on save'); expect(input().value).toBe(draft);
    expect(input().placeholder).toBe('Saved. Leave empty to keep it'); expect(storageGet).not.toHaveBeenCalled();
    await click('Save & reload plugin');
    if (draft) expect(storageSet).toHaveBeenCalledWith('sample', 'token', draft); else expect(storageSet).not.toHaveBeenCalled();
  });

  it('commits a clear only when Save is pressed', async () => {
    await open(); await click('Clear saved value'); expect(storageSet).not.toHaveBeenCalled();
    await click('Save & reload plugin'); expect(storageSet).toHaveBeenCalledExactlyOnceWith('sample', 'token', '');
    expect(reloadPlugin).toHaveBeenCalledTimes(1); expect(input()).toBeNull();
  });

  it('keeps clear intent after typing a replacement and deleting it again', async () => {
    await open(); await click('Clear saved value'); await type('replacement'); expect(container.textContent).toContain('Will replace on save');
    await type(''); expect(container.textContent).toContain('Will clear on save'); await click('Save & reload plugin');
    expect(storageSet).toHaveBeenCalledWith('sample', 'token', '');
  });

  it('replaces a pending clear with the value the user types when saved', async () => {
    await open(); await click('Clear saved value'); await type('new token'); await click('Save & reload plugin');
    expect(storageSet).toHaveBeenCalledExactlyOnceWith('sample', 'token', 'new token');
  });

  it('retains pending clear and Undo after a failed write, and succeeds on retry', async () => {
    storageSet.mockResolvedValueOnce({ success: false, error: 'storage unavailable' });
    await open(); await click('Clear saved value'); await click('Save & reload plugin');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('storage unavailable');
    expect(container.textContent).toContain('Will clear on save'); expect(button('Undo').disabled).toBe(false); expect(reloadPlugin).not.toHaveBeenCalled();
    await click('Save & reload plugin'); expect(storageSet).toHaveBeenCalledTimes(2); expect(input()).toBeNull();
  });

  it('does not offer Undo for an acknowledged clear when only plugin reload failed', async () => {
    reloadPlugin.mockResolvedValueOnce({ success: false, error: 'reload failed' });
    await open(); await click('Clear saved value'); await click('Save & reload plugin');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('reload failed'); expect(input().placeholder).toBe('');
    expect(button('Undo')).toBeUndefined(); expect(button('Clear saved value')).toBeUndefined(); expect(container.textContent).not.toContain('Will clear on save');
    await click('Save & reload plugin'); expect(storageSet).toHaveBeenCalledTimes(1); expect(reloadPlugin).toHaveBeenCalledTimes(2);
  });

  it('disables editing and Undo while a pending clear is being written', async () => {
    let finish!: (value: { success: false; error: string }) => void;
    storageSet.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await open(); await click('Clear saved value'); await click('Save & reload plugin');
    expect(input().disabled).toBe(true); expect(button('Undo').disabled).toBe(true); expect(button('Configure plugin').disabled).toBe(true);
    await act(async () => finish({ success: false, error: 'write failed' }));
    expect(input().disabled).toBe(false); expect(button('Undo').disabled).toBe(false);
  });

  it('keeps successful secret writes truthful when another setting failed', async () => {
    mocks.schema = [{ id: 'token', label: 'Token', type: 'password' }, { id: 'endpoint', label: 'Endpoint', type: 'string' }];
    storageSet.mockImplementation(async (_pluginId, key) => key === 'token' ? { success: true } : { success: false, error: 'endpoint failed' });
    await open(); await click('Clear saved value'); await click('Save & reload plugin');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('endpoint failed'); expect(reloadPlugin).not.toHaveBeenCalled();
    expect(input().placeholder).toBe(''); expect(button('Undo')).toBeUndefined(); expect(container.textContent).not.toContain('Will clear on save');
    expect(storageGet).toHaveBeenCalledExactlyOnceWith('sample', 'endpoint');
  });

  it('keeps an acknowledged secret clear truthful when another write rejects', async () => {
    mocks.schema = [{ id: 'token', label: 'Token', type: 'password' }, { id: 'endpoint', label: 'Endpoint', type: 'string' }];
    storageSet.mockImplementation(async (_pluginId, key) => {
      if (key === 'token') return { success: true };
      throw new Error('endpoint unavailable');
    });
    await open(); await click('Clear saved value'); await click('Save & reload plugin');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('endpoint unavailable');
    expect(input().placeholder).toBe(''); expect(button('Undo')).toBeUndefined(); expect(button('Clear saved value')).toBeUndefined();
    expect(container.textContent).not.toContain('Will clear on save'); expect(reloadPlugin).not.toHaveBeenCalled();
  });

  it('discards stale saved-password metadata after closing and reopening the panel', async () => {
    let finishOld!: (value: string[]) => void;
    savedPasswords.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockResolvedValue([]);
    await open(); expect(input().disabled).toBe(true); await click('Configure plugin'); await click('Configure plugin');
    expect(input().placeholder).toBe(''); await act(async () => finishOld(['token']));
    expect(input().placeholder).toBe(''); expect(button('Clear saved value')).toBeUndefined();
  });
});
