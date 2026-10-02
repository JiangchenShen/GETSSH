import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  app,
  clipboard,
  dialog,
  type IpcMain,
  type IpcMainInvokeEvent,
  type MessageBoxOptions,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import type { ProfileInput } from '../../../../../rust-core/getssh-store/store';
import { appLock } from '../security/appLock';
import { getStore, toStoreError } from '../services/getsshStore';
import { isValidWorkspaceId } from '../utils/workspaceId';
import { getMainWindow, isMainWebContents } from '../windowRegistry';

/**
 * getssh-store features that have no older channel: the profile editor without secrets, the
 * reveal window, SSH keys kept in the store, and encrypted export / import
 * (docs/GETSSH_STORE_DESIGN_CN.md §5, §6). Renderer types: src/types/store.ts.
 *
 * Only the top frame of the main window may call these, and only while the app is unlocked.
 * Nothing returned here contains a password, passphrase or private key, and the renderer cannot
 * put one on the clipboard either (it could read it straight back): a revealed secret is shown in
 * a system dialog, and only that dialog's Copy button copies it.
 */

type Failure = { ok: false; error: string; retryAfterMs?: number };
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Result<T extends object = {}> = ({ ok: true } & T) | Failure;
type Request = Record<string, unknown>;

const UNAUTHORIZED: Failure = { ok: false, error: 'unauthorized' };
const INVALID: Failure = { ok: false, error: 'invalid_argument' };
const CANCELLED: Failure = { ok: false, error: 'cancelled' };

const MAX_SSH_KEY_BYTES = 64 * 1024;
const MAX_PROFILES = 5000;
const CLIPBOARD_CLEAR_MS = 30_000;
const BACKUP_EXTENSION = 'getssh-backup';
const MIN_EXPORT_PASSWORD = 12;
// Fixed here, so a renderer cannot put its own words into a Touch ID / Windows Hello prompt.
const REVEAL_REASON = 'show a saved password';
const EXPORT_UNLOCK_REASON = 'unlock the workspaces you are exporting';

// The reveal dialog's words live here, not in the renderer, so a renderer cannot relabel the
// Copy button or add instructions of its own; it only picks the language.
const REVEAL_TEXT = {
  'en-US': { password: 'Saved password', passphrase: 'Saved key passphrase', copy: 'Copy', close: 'Close' },
  'zh-CN': { password: '已保存的密码', passphrase: '已保存的私钥口令', copy: '复制', close: '关闭' },
} as const;

function failure(error: unknown): Failure {
  const storeError = toStoreError(error);
  if (storeError.code === 'internal') console.error('[Store IPC]', error);
  return { ok: false, error: storeError.code, retryAfterMs: storeError.retryAfterMs };
}

function fromMainWindow(event: IpcMainInvokeEvent): boolean {
  return isMainWebContents(event.sender) && event.senderFrame?.parent === null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0') ? value : null;
}

const password = (value: unknown) => text(value, 4096);
/** Profile and SSH key ids. */
const recordId = (value: unknown) => text(value, 128);
const workspaceId = (value: unknown) => (isValidWorkspaceId(value) ? value : null);

function list(value: unknown, item: (entry: unknown) => string | null, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const items = value.map(item);
  return items.every((entry): entry is string => entry !== null) ? items : null;
}

function secretField(value: unknown): 'password' | 'passphrase' | null {
  return value === 'password' || value === 'passphrase' ? value : null;
}

const PROTOCOLS = new Set(['ssh', 'local', 'telnet', 'auto']);
const AUTH_TYPES = new Set(['password', 'key', 'agent']);
const OPTIONAL_TEXT = [
  'alias', 'osType', 'groupName', 'proxyJump', 'initialDirectory', 'postConnectScript', 'themeOverride', 'keyId', 'privateKeyPath',
] as const;
const FLAGS = ['autoStart', 'useKeepAlive', 'strictHostKeyChecking'] as const;
const SECRETS = ['password', 'passphrase'] as const;

/**
 * Rebuilds one profile from the fields the store knows; anything else is dropped. A secret
 * field that is absent keeps the stored value, null clears it, a string replaces it.
 */
function profileInput(value: unknown): ProfileInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Request;
  const id = recordId(raw.id);
  const host = typeof raw.host === 'string' && raw.host.length <= 4096 ? raw.host : null;
  const username = typeof raw.username === 'string' && raw.username.length <= 4096 ? raw.username : null;
  if (id === null || host === null || username === null) return null;
  if (!Number.isInteger(raw.port) || !PROTOCOLS.has(raw.protocol as string) || !AUTH_TYPES.has(raw.authType as string)) return null;
  const input: Request = { id, host, username, port: raw.port, protocol: raw.protocol, authType: raw.authType };
  for (const key of OPTIONAL_TEXT) {
    const field = raw[key];
    if (field === undefined || field === null) input[key] = null;
    else if (typeof field === 'string' && field.length <= 65536) input[key] = field;
    else return null;
  }
  // No defaults: a missing strictHostKeyChecking must not quietly turn host key checks off.
  for (const key of FLAGS) {
    if (typeof raw[key] !== 'boolean') return null;
    input[key] = raw[key];
  }
  for (const key of SECRETS) {
    const field = raw[key];
    if (field === undefined) continue;
    if (field === null || (typeof field === 'string' && field.length <= 4096)) input[key] = field;
    else return null;
  }
  return input as unknown as ProfileInput;
}

function profileInputs(value: unknown): ProfileInput[] | null {
  if (!Array.isArray(value) || value.length > MAX_PROFILES) return null;
  const inputs = value.map(profileInput);
  return inputs.every((input): input is ProfileInput => input !== null) ? inputs : null;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Digests of secrets copied in the last 30 seconds, so quitting early can still clear them.
const copiedSecrets = new Set<string>();

/** Copies a secret and clears the clipboard after 30 seconds unless something else was copied. */
async function copySecret(value: string): Promise<void> {
  await clipboard.writeText(value);
  const digest = sha256(value);
  copiedSecrets.add(digest);
  const timer = setTimeout(() => {
    copiedSecrets.delete(digest);
    clipboard.readText()
      .then(current => {
        if (sha256(current) === digest) clipboard.clear();
      })
      .catch(error => console.warn('[Store IPC] Could not clear the clipboard:', error));
  }, CLIPBOARD_CLEAR_MS);
  timer.unref?.();
}

/** For quit and relaunch: clears the clipboard if it still holds a secret copied less than 30 s ago. */
export async function clearCopiedSecret(): Promise<void> {
  if (copiedSecrets.size === 0) return;
  try {
    if (copiedSecrets.has(sha256(await clipboard.readText()))) clipboard.clear();
  } catch (error) {
    console.warn('[Store IPC] Could not clear the clipboard:', error);
  } finally {
    copiedSecrets.clear();
  }
}

function openDialog(options: OpenDialogOptions) {
  const window = getMainWindow();
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
}

function saveDialog(options: SaveDialogOptions) {
  const window = getMainWindow();
  return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options);
}

function messageBox(options: MessageBoxOptions) {
  const window = getMainWindow();
  return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
}

function dateStamp(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

// The import flow: the file the user picked in the main process's dialog, and whether an import
// went through (the store then refuses every call until the app relaunches).
let pendingImport: { fileId: string; path: string } | null = null;
let importFinished = false;

// Reveal dialogs on screen and workspaces with a reveal window, closed whenever the app locks.
const openRevealDialogs = new Set<AbortController>();
const revealedWorkspaces = new Set<string>();

function closeRevealsOnLock(): void {
  for (const controller of openRevealDialogs) controller.abort();
  openRevealDialogs.clear();
  for (const id of revealedWorkspaces) {
    try {
      getStore().closeReveal(id);
    } catch {
      // The store is gone or the workspace was deleted; nothing is left to close.
    }
  }
  revealedWorkspaces.clear();
}

function importPath(fileId: unknown): string | null {
  return pendingImport && fileId === pendingImport.fileId ? pendingImport.path : null;
}

/** Tests only. */
export function resetStoreHandlersForTest(): void {
  pendingImport = null;
  importFinished = false;
  openRevealDialogs.clear();
  revealedWorkspaces.clear();
  copiedSecrets.clear();
}

export function registerStoreHandlers(ipcMain: IpcMain) {
  appLock.onLock(closeRevealsOnLock);

  /** Every channel here: main window only, unlocked app only, one object argument, errors as codes. */
  const handle = (channel: string, run: (request: Request) => Result | Promise<Result>) => {
    ipcMain.handle(channel, async (event, request: unknown): Promise<Result> => {
      if (!fromMainWindow(event) || !appLock.isReady()) return UNAUTHORIZED;
      // After an import the store refuses everything until the relaunch; say so before any dialog opens.
      if (importFinished) return { ok: false, error: 'unavailable' };
      const body = request && typeof request === 'object' && !Array.isArray(request) ? (request as Request) : {};
      try {
        return await run(body);
      } catch (error) {
        return failure(error);
      }
    });
  };

  // ── profiles, without secrets ──

  handle('store:profiles:list', ({ workspaceId: ws }) => {
    const id = workspaceId(ws);
    if (!id) return INVALID;
    return { ok: true, profiles: getStore().listProfiles(id) };
  });

  /** Whole-list semantics: profiles missing from `profiles` are deleted. */
  handle('store:profiles:save', ({ workspaceId: ws, profiles }) => {
    const id = workspaceId(ws);
    const inputs = profileInputs(profiles);
    if (!id || !inputs) return INVALID;
    return { ok: true, profiles: getStore().saveProfiles(id, inputs) };
  });

  handle('store:profiles:delete', ({ workspaceId: ws, ids }) => {
    const id = workspaceId(ws);
    const profileIds = list(ids, recordId, MAX_PROFILES);
    if (!id || !profileIds) return INVALID;
    getStore().deleteProfiles(id, profileIds);
    return { ok: true };
  });

  // ── reveal window ──

  handle('store:reveal:open', async ({ workspaceId: ws, method, password: typed }) => {
    const id = workspaceId(ws);
    if (!id) return INVALID;
    if (method === 'presence') {
      await getStore().openReveal(id, { presence: REVEAL_REASON });
    } else if (method === 'password' && password(typed)) {
      await getStore().openReveal(id, { password: typed as string });
    } else {
      return INVALID;
    }
    revealedWorkspaces.add(id);
    return { ok: true };
  });

  /**
   * Shows one secret in a system dialog. Its Copy button is the only way a secret reaches the
   * clipboard. Locking the app closes the dialog, and Copy re-checks the lock and the reveal window.
   */
  handle('store:reveal:show', async ({ workspaceId: ws, profileId, field, language }) => {
    const id = workspaceId(ws);
    const profile = recordId(profileId);
    const which = secretField(field);
    if (!id || !profile || !which) return INVALID;
    const words = REVEAL_TEXT[language === 'zh-CN' ? 'zh-CN' : 'en-US'];
    const store = getStore();
    const controller = new AbortController();
    openRevealDialogs.add(controller);
    let response: number;
    try {
      ({ response } = await messageBox({
        type: 'none',
        title: 'GETSSH',
        message: words[which],
        detail: store.revealSecret(id, profile, which),
        buttons: [words.copy, words.close],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        signal: controller.signal,
      }));
    } finally {
      openRevealDialogs.delete(controller);
    }
    if (controller.signal.aborted) return { ok: false, error: 'locked' };
    if (response !== 0) return { ok: true };
    if (!appLock.isReady()) return { ok: false, error: 'locked' };
    await copySecret(store.revealSecret(id, profile, which));
    return { ok: true };
  });

  handle('store:reveal:close', ({ workspaceId: ws }) => {
    const id = workspaceId(ws);
    if (!id) return INVALID;
    getStore().closeReveal(id);
    revealedWorkspaces.delete(id);
    return { ok: true };
  });

  // ── SSH keys kept in the store ──

  handle('store:ssh-keys:list', ({ workspaceId: ws }) => {
    const id = workspaceId(ws);
    if (!id) return INVALID;
    return { ok: true, keys: getStore().listSshKeys(id) };
  });

  /** The user picks the file in a system dialog; the file itself is left alone. */
  handle('store:ssh-keys:import', async ({ workspaceId: ws, name, passphrase }) => {
    const id = workspaceId(ws);
    // Empty inputs mean "not given": the file name, and no passphrase.
    const keyName = name === undefined || name === null || name === '' ? undefined : text(name, 200);
    const keyPassphrase = passphrase === undefined || passphrase === null || passphrase === '' ? undefined : password(passphrase);
    if (!id || keyName === null || keyPassphrase === null) return INVALID;
    const store = getStore();
    const picked = await openDialog({
      properties: ['openFile', 'showHiddenFiles'],
      defaultPath: path.join(os.homedir(), '.ssh'),
    });
    const file = picked.canceled ? undefined : picked.filePaths[0];
    if (!file) return CANCELLED;
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) return INVALID;
    if (stat.size > MAX_SSH_KEY_BYTES) return { ok: false, error: 'file_too_large' };
    const data = await fs.promises.readFile(file);
    try {
      const key = store.importSshKey(id, { name: keyName ?? path.basename(file), data, passphrase: keyPassphrase });
      return { ok: true, key };
    } finally {
      data.fill(0);
    }
  });

  handle('store:ssh-keys:generate', ({ workspaceId: ws, name }) => {
    const id = workspaceId(ws);
    const keyName = text(name, 200);
    if (!id || !keyName) return INVALID;
    return { ok: true, key: getStore().generateSshKey(id, { name: keyName, algorithm: 'ed25519' }) };
  });

  handle('store:ssh-keys:delete', ({ workspaceId: ws, id: keyId }) => {
    const id = workspaceId(ws);
    const key = recordId(keyId);
    if (!id || !key) return INVALID;
    getStore().deleteSshKey(id, key);
    return { ok: true };
  });

  // ── encrypted export ──

  handle('store:backup:candidates', () => ({ ok: true, candidates: getStore().exportCandidates() }));

  /** One Touch ID / Windows Hello prompt for every chosen workspace; `failed` ones need their password. */
  handle('store:backup:unlock-for-export', async ({ workspaceIds }) => {
    const ids = list(workspaceIds, workspaceId, 1000);
    if (!ids || ids.length === 0) return INVALID;
    const outcome = await getStore().unlockWorkspaces(ids, EXPORT_UNLOCK_REASON);
    appLock.notifyChanged();
    return { ok: true, ...outcome };
  });

  /** Asks where to save after the cheap checks, so the user does not pick a file for nothing. */
  handle('store:backup:export', async ({ workspaceIds, password: typed }) => {
    const ids = list(workspaceIds, workspaceId, 1000);
    const exportPassword = password(typed);
    if (!ids || ids.length === 0 || !exportPassword || exportPassword.length < MIN_EXPORT_PASSWORD) return INVALID;
    const store = getStore();
    if (store.appState().masterPasswordMustChange) return { ok: false, error: 'must_change_master_password' };
    const picked = await saveDialog({
      defaultPath: path.join(app.getPath('documents'), `GETSSH-${dateStamp()}.${BACKUP_EXTENSION}`),
      filters: [{ name: 'GETSSH backup', extensions: [BACKUP_EXTENSION] }],
    });
    if (picked.canceled || !picked.filePath) return CANCELLED;
    const target = picked.filePath.endsWith(`.${BACKUP_EXTENSION}`) ? picked.filePath : `${picked.filePath}.${BACKUP_EXTENSION}`;
    return { ok: true, report: await store.exportBundle(target, exportPassword, ids) };
  });

  // ── import (replace only) ──

  handle('store:backup:choose-import-file', async () => {
    getStore();
    const picked = await openDialog({
      properties: ['openFile'],
      filters: [{ name: 'GETSSH backup', extensions: [BACKUP_EXTENSION] }],
    });
    const file = picked.canceled ? undefined : picked.filePaths[0];
    if (!file) return CANCELLED;
    pendingImport = { fileId: crypto.randomUUID(), path: file };
    return { ok: true, fileId: pendingImport.fileId, fileName: path.basename(file) };
  });

  /** Checks the password and reads the workspace list; changes nothing. */
  handle('store:backup:inspect', async ({ fileId, password: typed }) => {
    const file = importPath(fileId);
    const bundlePassword = password(typed);
    if (!file || !bundlePassword) return INVALID;
    return { ok: true, info: await getStore().inspectBundle(file, bundlePassword) };
  });

  /** Replaces all data (the old folder is kept as a backup); call `relaunch` afterwards. */
  handle('store:backup:import', async ({ fileId, password: typed }) => {
    const file = importPath(fileId);
    const bundlePassword = password(typed);
    if (!file || !bundlePassword) return INVALID;
    const report = await getStore().importBundle(file, bundlePassword, 'replace');
    pendingImport = null;
    importFinished = true;
    return { ok: true, report };
  });

  // Not behind the unlocked-app check: after an import the old data is gone and only a relaunch helps.
  ipcMain.handle('store:backup:relaunch', async (event): Promise<Result> => {
    if (!fromMainWindow(event)) return UNAUTHORIZED;
    try {
      getStore();
    } catch (error) {
      return failure(error);
    }
    if (!importFinished) return INVALID;
    // app.exit() skips 'will-quit', so the clipboard is cleared here.
    await clearCopiedSecret();
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });
}
