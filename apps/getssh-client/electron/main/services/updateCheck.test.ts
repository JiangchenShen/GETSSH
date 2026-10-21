import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Electron's net.fetch is mocked: no test here sends a request to GitHub.
const fetch = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ net: { fetch } }));

import { checkForUpdates, fetchLatestRelease } from './updateCheck';

const API = 'https://api.github.com/repos/JiangchenShen/GETSSH/releases/latest';
const page = (tag: string) => `https://github.com/JiangchenShen/GETSSH/releases/tag/${tag}`;
const release = (tag: string, fields: Record<string, unknown> = {}) =>
  ({ tag_name: tag, html_url: page(tag), draft: false, prerelease: false, ...fields });

function reply(body: unknown, status = 200) {
  fetch.mockResolvedValueOnce(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
}

function fakeWindow(destroyed = false) {
  const send = vi.fn();
  return { send, win: { isDestroyed: () => destroyed, webContents: { send } } as unknown as Electron.BrowserWindow };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetch.mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('fetchLatestRelease', () => {
  it('asks GitHub for the latest release', async () => {
    reply(release('v3.0.1'));
    await fetchLatestRelease('3.0.0');
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(API);
    expect(init.headers).toMatchObject({ 'User-Agent': 'GETSSH-Updater' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns a newer release with its page', async () => {
    reply(release('v3.0.1'));
    await expect(fetchLatestRelease('3.0.0')).resolves.toEqual({ version: 'v3.0.1', url: page('v3.0.1') });
  });

  it('returns nothing for the same or an older release', async () => {
    reply(release('v3.0.0'));
    await expect(fetchLatestRelease('3.0.0')).resolves.toBeNull();
    reply(release('v2.0.0_R7K4S'));
    await expect(fetchLatestRelease('3.0.0')).resolves.toBeNull();
    reply(release('v3.0.0-preview'));
    await expect(fetchLatestRelease('3.0.0-preview')).resolves.toBeNull();
  });

  it('orders a pre-release before its release', async () => {
    reply(release('v3.0.0'));
    await expect(fetchLatestRelease('3.0.0-preview')).resolves.toEqual({ version: 'v3.0.0', url: page('v3.0.0') });
    reply(release('v3.0.0-preview'));
    await expect(fetchLatestRelease('3.0.0')).resolves.toBeNull();
    reply(release('v3.0.0-preview.2'));
    await expect(fetchLatestRelease('3.0.0-preview')).resolves.toEqual({ version: 'v3.0.0-preview.2', url: page('v3.0.0-preview.2') });
  });

  it('ignores a release GitHub marks as a draft or a pre-release', async () => {
    reply(release('v3.0.1', { draft: true }));
    await expect(fetchLatestRelease('3.0.0')).resolves.toBeNull();
    reply(release('v3.0.1', { prerelease: true }));
    await expect(fetchLatestRelease('3.0.0')).resolves.toBeNull();
  });

  it('links to the releases page when the reply names another page', async () => {
    const latest = 'https://github.com/JiangchenShen/GETSSH/releases/latest';
    for (const html_url of ['https://example.com/GETSSH-Setup.exe', 'javascript:alert(1)', 42, undefined]) {
      reply(release('v3.0.1', { html_url }));
      await expect(fetchLatestRelease('3.0.0')).resolves.toEqual({ version: 'v3.0.1', url: latest });
    }
  });

  it('fails on a reply that is not a release', async () => {
    for (const body of ['<html>not json</html>', 'null', '[]', { message: 'Not Found' }, { tag_name: 301 }]) {
      reply(body);
      await expect(fetchLatestRelease('3.0.0')).rejects.toThrow();
    }
  });

  it('fails on an HTTP error', async () => {
    reply({ message: 'API rate limit exceeded' }, 403);
    await expect(fetchLatestRelease('3.0.0')).rejects.toThrow('GitHub answered HTTP 403');
    reply('', 500);
    await expect(fetchLatestRelease('3.0.0')).rejects.toThrow('GitHub answered HTTP 500');
  });
});

describe('checkForUpdates', () => {
  it('tells the window about a newer release', async () => {
    const { send, win } = fakeWindow();
    reply(release('v3.0.1'));
    await expect(checkForUpdates('3.0.0', () => win)).resolves.toEqual({ version: 'v3.0.1', url: page('v3.0.1') });
    expect(send).toHaveBeenCalledExactlyOnceWith('update-available', { version: 'v3.0.1', url: page('v3.0.1') });
  });

  it('says nothing when there is no newer release', async () => {
    const { send, win } = fakeWindow();
    reply(release('v3.0.0'));
    await expect(checkForUpdates('3.0.0', () => win)).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('skips a closed window', async () => {
    const { send, win } = fakeWindow(true);
    reply(release('v3.0.1'));
    await checkForUpdates('3.0.0', () => win);
    reply(release('v3.0.1'));
    await checkForUpdates('3.0.0', () => null);
    expect(send).not.toHaveBeenCalled();
  });

  it('only logs a network error, an HTTP error or a malformed reply', async () => {
    const { send, win } = fakeWindow();
    fetch.mockRejectedValueOnce(new TypeError('net::ERR_INTERNET_DISCONNECTED'));
    reply({ message: 'API rate limit exceeded' }, 403);
    reply('<html>not json</html>');
    for (let i = 0; i < 3; i++) await expect(checkForUpdates('3.0.0', () => win)).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
