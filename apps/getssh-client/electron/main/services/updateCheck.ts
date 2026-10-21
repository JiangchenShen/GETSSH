import { net, type BrowserWindow } from 'electron';
import { compareVersions } from '../utils/compareVersions';

// GitHub leaves drafts and pre-releases out of releases/latest.
const LATEST_RELEASE_API = 'https://api.github.com/repos/JiangchenShen/GETSSH/releases/latest';
const RELEASES_PAGE = 'https://github.com/JiangchenShen/GETSSH/releases/';
const TIMEOUT_MS = 15_000;

export type AvailableUpdate = { version: string; url: string };

/**
 * The latest GETSSH release when it is newer than `currentVersion`, else null. macOS and Windows
 * both ask GitHub: the installers are unsigned and the releases carry no electron-updater
 * metadata, so the user downloads the new version from its release page. Throws when the request
 * fails, GitHub answers with an error, or the reply is not a release.
 */
export async function fetchLatestRelease(currentVersion: string): Promise<AvailableUpdate | null> {
  const res = await net.fetch(LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'GETSSH-Updater' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
  const release = (await res.json()) as Record<string, unknown> | null;
  const version = release?.tag_name;
  if (typeof version !== 'string') throw new Error('GitHub did not send a release');
  if (release!.draft === true || release!.prerelease === true) return null;
  if (compareVersions(version, currentVersion) <= 0) return null;
  // The renderer opens this page in the browser: only a page of this repository's releases.
  const page = release!.html_url;
  const url = typeof page === 'string' && page.startsWith(RELEASES_PAGE) ? page : `${RELEASES_PAGE}latest`;
  return { version, url };
}

/**
 * The background check, at launch and every 12 hours: tells the main window when a newer
 * release is out. A failed check only leaves a log line.
 */
export async function checkForUpdates(currentVersion: string, getWin: () => BrowserWindow | null): Promise<AvailableUpdate | null> {
  try {
    const update = await fetchLatestRelease(currentVersion);
    if (update) notifyWindow(update, getWin);
    return update;
  } catch (e) {
    console.warn('[Update] Update check failed:', e);
    return null;
  }
}

export function notifyWindow(update: AvailableUpdate, getWin: () => BrowserWindow | null): void {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('update-available', update);
}
