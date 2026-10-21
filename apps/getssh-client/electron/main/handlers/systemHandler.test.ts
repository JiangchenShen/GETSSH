import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The update checks in registerSystemHandlers. Electron's net.fetch is mocked: no test here sends
// a request to GitHub.
const fetch = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ net: { fetch }, globalShortcut: { unregisterAll: vi.fn(), register: vi.fn() } }));
vi.mock('../utils/rustCorePath', () => ({ getRustCorePath: () => '/nonexistent/getssh-sysprobe' }));
vi.mock('../windowRegistry', () => ({ isMainWebContents: () => true }));

import { registerSystemHandlers } from './systemHandler';

const API = 'https://api.github.com/repos/JiangchenShen/GETSSH/releases/latest';
const PAGE = 'https://github.com/JiangchenShen/GETSSH/releases/tag/v3.0.0';
const TWELVE_HOURS = 12 * 60 * 60 * 1000;
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

function reply(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function register() {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const send = vi.fn();
  const win = { isDestroyed: () => false, webContents: { send } } as unknown as Electron.BrowserWindow;
  registerSystemHandlers(
    { handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) } as unknown as Electron.IpcMain,
    { getVersion: () => '3.0.0-preview', on: vi.fn() } as unknown as Electron.App,
    () => win,
  );
  return { handlers, send };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetch.mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  warn.mockRestore();
  Object.defineProperty(process, 'platform', platform);
});

describe('the background update check', () => {
  // electron-updater used to take over everywhere but macOS, and found nothing: the releases
  // carry no latest.yml.
  it.each(['darwin', 'win32'])('asks GitHub at launch and every 12 hours on %s', async (os) => {
    Object.defineProperty(process, 'platform', { configurable: true, value: os });
    fetch.mockResolvedValue(reply({ tag_name: 'v3.0.0', html_url: PAGE, draft: false, prerelease: false }));
    const { send } = register();

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe(API);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith('update-available', { version: 'v3.0.0', url: PAGE });

    vi.advanceTimersByTime(TWELVE_HOURS - 1000);
    expect(fetch).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe(API);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  });

  it.each(['darwin', 'win32'])('stays quiet on %s when the check fails', async (os) => {
    Object.defineProperty(process, 'platform', { configurable: true, value: os });
    fetch.mockRejectedValue(new TypeError('net::ERR_INTERNET_DISCONNECTED'));
    const { send } = register();

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[Update] Update check failed:', expect.any(TypeError)));
    expect(send).not.toHaveBeenCalled();
  });
});

describe('check-for-updates (Settings → About)', () => {
  it('returns a newer release and tells the window', async () => {
    fetch.mockResolvedValue(reply({ tag_name: 'v3.0.0', html_url: PAGE }));
    const { handlers, send } = register();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    await expect(handlers.get('check-for-updates')!()).resolves.toEqual({ hasUpdate: true, version: 'v3.0.0', url: PAGE });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('returns no update for the running version', async () => {
    fetch.mockResolvedValue(reply({ tag_name: 'v3.0.0-preview', html_url: PAGE }));
    const { handlers, send } = register();

    await expect(handlers.get('check-for-updates')!()).resolves.toEqual({ hasUpdate: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('reports why the check failed', async () => {
    fetch.mockResolvedValue(reply({ message: 'API rate limit exceeded' }, 403));
    const { handlers } = register();

    await expect(handlers.get('check-for-updates')!()).resolves.toEqual({ hasUpdate: false, error: 'GitHub answered HTTP 403' });
  });
});
