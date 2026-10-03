import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { IpcMain } from 'electron';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Runs the store IPC channels against rust-core/getssh-store/store.fake.js, with a temporary HOME.

const mocks = vi.hoisted(() => {
  let clipboardText = '';
  return {
    clipboard: {
      writeText: vi.fn(async (value: string) => {
        clipboardText = value;
      }),
      readText: vi.fn(async () => clipboardText),
      clear: vi.fn(() => {
        clipboardText = '';
      }),
      current: () => clipboardText,
      set: (value: string) => {
        clipboardText = value;
      },
    },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
    app: {
      isPackaged: false,
      getAppPath: () => process.cwd(),
      getVersion: () => '3.0.0-test',
      getPath: vi.fn(() => os.tmpdir()),
      relaunch: vi.fn(),
      exit: vi.fn(),
    },
    ready: { value: true },
    notifyChanged: vi.fn(),
    lockListeners: [] as Array<() => void>,
  };
});

vi.mock('electron', () => ({ app: mocks.app, clipboard: mocks.clipboard, dialog: mocks.dialog }));
vi.mock('../security/appLock', () => ({
  appLock: {
    isReady: () => mocks.ready.value,
    notifyChanged: mocks.notifyChanged,
    onLock: (listener: () => void) => mocks.lockListeners.push(listener),
  },
}));
vi.mock('../windowRegistry', () => ({
  getMainWindow: () => null,
  isMainWebContents: (webContents: { id: number } | null | undefined) => webContents?.id === 1,
}));

import { configureStore, resetStoreForTest } from '../services/getsshStore';
import { clearCopiedSecret, registerStoreHandlers, resetStoreHandlersForTest } from './storeHandler';

const fake = createRequire(import.meta.url)(path.resolve(process.cwd(), '../../rust-core/getssh-store/store.fake.js'));

const PROFILE_PASSWORD = 'profile-password-7f3a';
const PROFILE_PASSPHRASE = 'profile-passphrase-91c2';
const WORKSPACE_PASSWORD = 'workspace-password-55';
const EXPORT_PASSWORD = 'export-password-1234';

type Handler = (event: unknown, request?: unknown) => Promise<any>;
const handlers = new Map<string, Handler>();
const ipcMain = { handle: (channel: string, run: Handler) => handlers.set(channel, run) } as unknown as IpcMain;
const MAIN = { sender: { id: 1 }, senderFrame: { parent: null } };

function call(channel: string, request?: unknown, event: unknown = MAIN): Promise<any> {
  const run = handlers.get(channel);
  if (!run) throw new Error(`no handler for ${channel}`);
  return run(event, request);
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'web', host: 'example.com', username: 'root', port: 22, protocol: 'ssh', authType: 'password',
    alias: 'web', osType: null, groupName: null, autoStart: false, useKeepAlive: true, strictHostKeyChecking: true,
    proxyJump: null, initialDirectory: null, postConnectScript: null, themeOverride: null, keyId: null, privateKeyPath: null,
    ...overrides,
  };
}

let home: string;
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, GETSSH_FAKE_STORE: process.env.GETSSH_FAKE_STORE };

async function boot(seed: Record<string, unknown> = {}) {
  fake.__fake.reset();
  resetStoreForTest();
  resetStoreHandlersForTest();
  mocks.ready.value = true;
  fake.configure(path.join(home, '.getssh'), '3.0.0-test');
  fake.__fake.seed({
    workspaces: [
      { id: 'main', name: 'Main', is_main: true },
      { id: 'locked', name: 'Locked', password: WORKSPACE_PASSWORD },
    ],
    profiles: { main: [profile({ password: PROFILE_PASSWORD, passphrase: PROFILE_PASSPHRASE })] },
    ...seed,
  });
  await configureStore().start();
}

/** No IPC result may carry a secret, whatever the channel. */
function expectNoSecrets(result: unknown) {
  const json = JSON.stringify(result);
  for (const secret of [PROFILE_PASSWORD, PROFILE_PASSPHRASE, WORKSPACE_PASSWORD, EXPORT_PASSWORD, 'PRIVATE KEY']) {
    expect(json).not.toContain(secret);
  }
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-store-ipc-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.GETSSH_FAKE_STORE = '1';
  registerStoreHandlers(ipcMain);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.clipboard.set('');
});

/** Answers the next reveal dialog by clicking Copy (0) or Close (1). */
function answerDialog(response: number) {
  mocks.dialog.showMessageBox.mockResolvedValueOnce({ response, checkboxChecked: false });
}

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(home, { recursive: true, force: true });
});

describe('access', () => {
  it('answers not_configured before the store has started, before any dialog opens', async () => {
    resetStoreForTest();
    {
      const requests: Array<[string, unknown]> = [
        ['store:profiles:list', { workspaceId: 'main' }],
        ['store:reveal:show', { workspaceId: 'main', profileId: 'web', field: 'password' }],
        ['store:ssh-keys:import', { workspaceId: 'main' }],
        ['store:backup:candidates', {}],
        ['store:backup:export', { workspaceIds: ['main'], password: EXPORT_PASSWORD }],
        ['store:backup:choose-import-file', {}],
        ['store:backup:relaunch', {}],
      ];
      for (const [channel, request] of requests) {
        expect(await call(channel, request), channel).toMatchObject({ ok: false, error: 'not_configured' });
      }
      expect(mocks.dialog.showOpenDialog).not.toHaveBeenCalled();
      expect(mocks.dialog.showSaveDialog).not.toHaveBeenCalled();
      expect(mocks.dialog.showMessageBox).not.toHaveBeenCalled();
      expect(mocks.app.relaunch).not.toHaveBeenCalled();
    }
  });

  it('refuses other windows, subframes and a locked app', async () => {
    await boot();
    const unauthorized = { ok: false, error: 'unauthorized' };
    expect(await call('store:profiles:list', { workspaceId: 'main' }, { sender: { id: 2 }, senderFrame: { parent: null } })).toEqual(unauthorized);
    expect(await call('store:profiles:list', { workspaceId: 'main' }, { sender: { id: 1 }, senderFrame: { parent: {} } })).toEqual(unauthorized);
    expect(await call('store:profiles:list', { workspaceId: 'main' }, { sender: { id: 1 }, senderFrame: null })).toEqual(unauthorized);
    mocks.ready.value = false;
    expect(await call('store:profiles:list', { workspaceId: 'main' })).toEqual(unauthorized);
  });

  it('rejects malformed requests', async () => {
    await boot();
    expect(await call('store:profiles:list', { workspaceId: '../..' })).toMatchObject({ ok: false, error: 'invalid_argument' });
    expect(await call('store:profiles:list', ['main'])).toMatchObject({ ok: false, error: 'invalid_argument' });
    expect(await call('store:reveal:show', { workspaceId: 'main', profileId: 'web', field: 'privateKey' })).toMatchObject({ ok: false, error: 'invalid_argument' });
    expect(handlers.has('store:reveal:copy')).toBe(false);
  });
});

describe('profiles', () => {
  it('lists profiles without secrets', async () => {
    await boot();
    const result = await call('store:profiles:list', { workspaceId: 'main' });
    expect(result.ok).toBe(true);
    expect(result.profiles[0]).toMatchObject({ id: 'web', hasPassword: true, hasPassphrase: true });
    expect(result.profiles[0]).not.toHaveProperty('password');
    expectNoSecrets(result);
  });

  it('keeps, clears or replaces a secret as asked and drops unknown fields', async () => {
    await boot();
    const kept = await call('store:profiles:save', { workspaceId: 'main', profiles: [profile({ alias: 'renamed', injected: 'x' })] });
    expect(kept.ok).toBe(true);
    expect(kept.profiles[0]).toMatchObject({ alias: 'renamed', hasPassword: true });
    expect(kept.profiles[0]).not.toHaveProperty('injected');
    expect(fake.__fake.secretsFor('main').profiles.web.password).toBe(PROFILE_PASSWORD);
    expectNoSecrets(kept);

    await call('store:profiles:save', { workspaceId: 'main', profiles: [profile({ password: null })] });
    expect(fake.__fake.secretsFor('main').profiles.web.password ?? null).toBeNull();

    await call('store:profiles:save', { workspaceId: 'main', profiles: [profile({ password: 'replaced-secret' })] });
    expect(fake.__fake.secretsFor('main').profiles.web.password).toBe('replaced-secret');
  });

  it('refuses a profile without explicit flags instead of guessing', async () => {
    await boot();
    const { strictHostKeyChecking: _dropped, ...partial } = profile();
    expect(await call('store:profiles:save', { workspaceId: 'main', profiles: [partial] })).toMatchObject({ ok: false, error: 'invalid_argument' });
    expect(fake.__fake.secretsFor('main').profiles.web.password).toBe(PROFILE_PASSWORD);
  });

  it('deletes profiles', async () => {
    await boot();
    expect(await call('store:profiles:delete', { workspaceId: 'main', ids: ['web'] })).toEqual({ ok: true });
    expect((await call('store:profiles:list', { workspaceId: 'main' })).profiles).toEqual([]);
  });
});

describe('reveal', () => {
  it('needs an open reveal window', async () => {
    await boot();
    expect(await call('store:reveal:show', { workspaceId: 'main', profileId: 'web', field: 'password' })).toMatchObject({ ok: false, error: 'locked' });
    expect(mocks.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('opens with Touch ID / Hello, or with the workspace password', async () => {
    await boot();
    expect(await call('store:reveal:open', { workspaceId: 'main', method: 'presence' })).toEqual({ ok: true });
    // In the app, workspace.unlock opens a password workspace first.
    await fake.unlockWorkspace('locked', { password: WORKSPACE_PASSWORD });
    expect(await call('store:reveal:open', { workspaceId: 'locked', method: 'password', password: 'not-the-password' })).toMatchObject({ ok: false, error: 'wrong_password' });
    expect(await call('store:reveal:open', { workspaceId: 'locked', method: 'password', password: WORKSPACE_PASSWORD })).toEqual({ ok: true });
    expect(await call('store:reveal:open', { workspaceId: 'main', method: 'password' })).toMatchObject({ ok: false, error: 'invalid_argument' });
  });

  it('shows a secret in a system dialog with fixed words and never returns it', async () => {
    await boot();
    await call('store:reveal:open', { workspaceId: 'main', method: 'presence' });
    answerDialog(1);
    const result = await call('store:reveal:show', { workspaceId: 'main', profileId: 'web', field: 'password', language: 'zh-CN', labels: { copy: 'Close' } });
    expect(result).toEqual({ ok: true });
    expect(mocks.dialog.showMessageBox.mock.calls[0][0]).toMatchObject({ message: '已保存的密码', detail: PROFILE_PASSWORD, buttons: ['复制', '关闭'] });
    expect(mocks.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('copies only through the dialog and clears the clipboard 30 seconds later', async () => {
    await boot();
    await call('store:reveal:open', { workspaceId: 'main', method: 'presence' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    answerDialog(0);
    const result = await call('store:reveal:show', { workspaceId: 'main', profileId: 'web', field: 'password' });
    expect(result).toEqual({ ok: true });
    expect(mocks.clipboard.current()).toBe(PROFILE_PASSWORD);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(mocks.clipboard.clear).toHaveBeenCalled());
    expect(mocks.clipboard.current()).toBe('');
  });

  it('leaves the clipboard alone when something else was copied since', async () => {
    await boot();
    await call('store:reveal:open', { workspaceId: 'main', method: 'presence' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    answerDialog(0);
    await call('store:reveal:show', { workspaceId: 'main', profileId: 'web', field: 'passphrase' });
    mocks.clipboard.set('something the user copied');
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(mocks.clipboard.readText).toHaveBeenCalled());
    expect(mocks.clipboard.clear).not.toHaveBeenCalled();
    expect(mocks.clipboard.current()).toBe('something the user copied');
  });

  it('clears a freshly copied secret when the app quits early', async () => {
    await boot();
    await call('store:reveal:open', { workspaceId: 'main', method: 'presence' });
    answerDialog(0);
    await call('store:reveal:show', { workspaceId: 'main', profileId: 'web', field: 'password' });
    await clearCopiedSecret();
    expect(mocks.clipboard.current()).toBe('');
  });

  it('closes the dialog and refuses to copy when the app locks', async () => {
    await boot();
    await call('store:reveal:open', { workspaceId: 'main', method: 'presence' });
    mocks.dialog.showMessageBox.mockImplementationOnce(
      (options: { signal: AbortSignal }) =>
        new Promise(resolve => options.signal.addEventListener('abort', () => resolve({ response: 0, checkboxChecked: false }))),
    );
    const pending = call('store:reveal:show', { workspaceId: 'main', profileId: 'web', field: 'password' });
    await vi.waitFor(() => expect(mocks.dialog.showMessageBox).toHaveBeenCalled());
    for (const listener of mocks.lockListeners) listener();
    expect(await pending).toEqual({ ok: false, error: 'locked' });
    expect(mocks.dialog.showMessageBox.mock.calls[0][0].signal.aborted).toBe(true);
    expect(mocks.clipboard.writeText).not.toHaveBeenCalled();
    // The lock also closed the reveal window.
    expect(await call('store:reveal:show', { workspaceId: 'main', profileId: 'web', field: 'password' })).toMatchObject({ ok: false, error: 'locked' });
  });

  it('closes the reveal window on request', async () => {
    await boot();
    await call('store:reveal:open', { workspaceId: 'main', method: 'presence' });
    expect(await call('store:reveal:close', { workspaceId: 'main' })).toEqual({ ok: true });
    expect(await call('store:reveal:show', { workspaceId: 'main', profileId: 'web', field: 'password' })).toMatchObject({ ok: false, error: 'locked' });
  });
});

describe('ssh keys', () => {
  it('generates a key and returns only its public half', async () => {
    await boot();
    const result = await call('store:ssh-keys:generate', { workspaceId: 'main', name: 'laptop' });
    expect(result.ok).toBe(true);
    expect(result.key.publicKey).toMatch(/^ssh-ed25519 /);
    expectNoSecrets(result);
    const listed = await call('store:ssh-keys:list', { workspaceId: 'main' });
    expect(listed.ok).toBe(true);
    expect(listed.keys.map((key: { id: string }) => key.id)).toEqual([result.key.id]);
    expectNoSecrets(listed);
  });

  it('deletes a key and clears it from the profiles that used it', async () => {
    await boot();
    const { key } = await call('store:ssh-keys:generate', { workspaceId: 'main', name: 'laptop' });
    await call('store:profiles:save', { workspaceId: 'main', profiles: [profile({ authType: 'key', keyId: key.id })] });
    expect(await call('store:ssh-keys:delete', { workspaceId: 'main', id: key.id })).toEqual({ ok: true });
    expect((await call('store:ssh-keys:list', { workspaceId: 'main' })).keys).toEqual([]);
    expect((await call('store:profiles:list', { workspaceId: 'main' })).profiles[0].keyId).toBeNull();
  });

  it('imports the key file the user picks, and refuses oversized files', async () => {
    await boot();
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const file = path.join(home, 'id_test');
    fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    mocks.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [file] });
    // Empty form fields mean "use the file name" and "no passphrase".
    const imported = await call('store:ssh-keys:import', { workspaceId: 'main', name: '', passphrase: '' });
    expect(imported).toMatchObject({ ok: true, key: { name: 'id_test' } });
    expect(imported.key.fingerprint).toMatch(/^SHA256:/);
    expectNoSecrets(imported);
    expect(fs.existsSync(file)).toBe(true);

    mocks.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await call('store:ssh-keys:import', { workspaceId: 'main' })).toEqual({ ok: false, error: 'cancelled' });

    const large = path.join(home, 'large_key');
    fs.writeFileSync(large, Buffer.alloc(65 * 1024, 'a'));
    mocks.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [large] });
    expect(await call('store:ssh-keys:import', { workspaceId: 'main' })).toEqual({ ok: false, error: 'file_too_large' });
  });
});

describe('backup', () => {
  it('exports to the file the user picks and imports it back', async () => {
    await boot();
    const candidates = await call('store:backup:candidates');
    expect(candidates.candidates.map((entry: { id: string }) => entry.id).sort()).toEqual(['locked', 'main']);

    expect(await call('store:backup:export', { workspaceIds: ['main'], password: 'too-short' })).toMatchObject({ ok: false, error: 'invalid_argument' });
    expect(mocks.dialog.showSaveDialog).not.toHaveBeenCalled();

    mocks.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: path.join(home, 'backup') });
    const exported = await call('store:backup:export', { workspaceIds: ['main'], password: EXPORT_PASSWORD });
    expect(exported.ok).toBe(true);
    expect(exported.report.path).toBe(path.join(home, 'backup.getssh-backup'));
    expect(fs.existsSync(exported.report.path)).toBe(true);
    expectNoSecrets(exported);

    expect(await call('store:backup:relaunch')).toMatchObject({ ok: false, error: 'invalid_argument' });

    mocks.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [exported.report.path] });
    const chosen = await call('store:backup:choose-import-file');
    expect(chosen).toMatchObject({ ok: true, fileName: 'backup.getssh-backup' });
    expect(await call('store:backup:inspect', { fileId: 'another-id', password: EXPORT_PASSWORD })).toMatchObject({ ok: false, error: 'invalid_argument' });
    expect(await call('store:backup:inspect', { fileId: chosen.fileId, password: 'wrong-password-123' })).toMatchObject({ ok: false, error: 'wrong_password' });
    const inspected = await call('store:backup:inspect', { fileId: chosen.fileId, password: EXPORT_PASSWORD });
    expect(inspected.info.workspaces.map((entry: { id: string }) => entry.id)).toContain('main');

    const imported = await call('store:backup:import', { fileId: chosen.fileId, password: EXPORT_PASSWORD });
    expect(imported.ok).toBe(true);
    expectNoSecrets(imported);
    expect(await call('store:profiles:list', { workspaceId: 'main' })).toMatchObject({ ok: false, error: 'unavailable' });
    mocks.dialog.showSaveDialog.mockClear();
    expect(await call('store:backup:export', { workspaceIds: ['main'], password: EXPORT_PASSWORD })).toMatchObject({ ok: false, error: 'unavailable' });
    expect(mocks.dialog.showSaveDialog).not.toHaveBeenCalled();

    expect(await call('store:backup:relaunch')).toEqual({ ok: true });
    expect(mocks.app.relaunch).toHaveBeenCalledOnce();
    expect(mocks.app.exit).toHaveBeenCalledWith(0);
  });

  it('reports workspaces that need their own password before an export', async () => {
    await boot();
    const result = await call('store:backup:unlock-for-export', { workspaceIds: ['main', 'locked'] });
    expect(result.ok).toBe(true);
    expect(result.unlocked).toContain('main');
    expect(result.failed.map((entry: { id: string }) => entry.id)).toEqual(['locked']);
    expect(mocks.notifyChanged).toHaveBeenCalled();
  });

  it('refuses to export until a short master password is changed', async () => {
    // A master password covers every workspace, so none may keep its own.
    await boot({ masterPassword: 'short-pw1', workspaces: [{ id: 'main', name: 'Main', is_main: true }] });
    await fake.unlockApp({ password: 'short-pw1' });
    expect(await call('store:backup:export', { workspaceIds: ['main'], password: EXPORT_PASSWORD })).toEqual({ ok: false, error: 'must_change_master_password' });
    expect(mocks.dialog.showSaveDialog).not.toHaveBeenCalled();
  });
});
