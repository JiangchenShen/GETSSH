import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { IpcMain } from 'electron';
import { utils as sshUtils } from 'ssh2';
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
    shell: { trashItem: vi.fn(async () => undefined) },
    app: {
      isPackaged: false,
      getAppPath: () => process.cwd(),
      getVersion: () => '3.0.0-test',
      getPath: vi.fn((_name: string) => os.tmpdir()),
      relaunch: vi.fn(),
      exit: vi.fn(),
    },
    ready: { value: true },
    notifyChanged: vi.fn(),
    lockListeners: [] as Array<() => void>,
  };
});

vi.mock('electron', () => ({ app: mocks.app, clipboard: mocks.clipboard, dialog: mocks.dialog, shell: mocks.shell }));
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
import { clearCopiedSecret, clipboardTextForPlugin, registerStoreHandlers, resetStoreHandlersForTest } from './storeHandler';

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
        ['store:ssh-keys:choose-file', {}],
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

  it('gives plugins an empty clipboard for a secret just copied, without telling them why', async () => {
    mocks.clipboard.set('copied by the user');
    expect(await clipboardTextForPlugin()).toBe('copied by the user');
    await boot();
    await call('store:reveal:open', { workspaceId: 'main', method: 'presence' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    answerDialog(0);
    await call('store:reveal:show', { workspaceId: 'main', profileId: 'web', field: 'password' });
    expect(await clipboardTextForPlugin()).toBe('');
    // What the plugin wrote itself comes back as written: writing a guess first tests nothing.
    expect(await clipboardTextForPlugin(PROFILE_PASSWORD)).toBe(PROFILE_PASSWORD);
    expect(await clipboardTextForPlugin('a guess')).toBe('');
    mocks.clipboard.set('copied by the user');
    expect(await clipboardTextForPlugin()).toBe('copied by the user');
  });

  it('keeps hiding a copied secret while the 30-second clear fails, and forgets it once it is cleared', async () => {
    await boot();
    await call('store:reveal:open', { workspaceId: 'main', method: 'presence' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    answerDialog(0);
    await call('store:reveal:show', { workspaceId: 'main', profileId: 'web', field: 'password' });
    mocks.clipboard.clear.mockImplementationOnce(() => { throw new Error('clipboard busy'); });
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(mocks.clipboard.clear).toHaveBeenCalled());
    expect(mocks.clipboard.current()).toBe(PROFILE_PASSWORD);
    expect(await clipboardTextForPlugin()).toBe('');

    answerDialog(0);
    await call('store:reveal:show', { workspaceId: 'main', profileId: 'web', field: 'password' });
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(mocks.clipboard.current()).toBe(''));
    // An hour later the user copies the same password from another app: it is theirs now.
    mocks.clipboard.set(PROFILE_PASSWORD);
    expect(await clipboardTextForPlugin()).toBe(PROFILE_PASSWORD);
    await clearCopiedSecret();
    expect(mocks.clipboard.current()).toBe(PROFILE_PASSWORD);
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
  /** What the store keeps for a key (the fake only): the private key ssh2 gets, and its passphrase. */
  const storedKey = (id: string, workspace = 'main') => fake.__fake.secretsFor(workspace).sshKeys[id] as { privateKey: string; passphrase: string | null };
  const publicBase64 = (privateKey: string, passphrase?: string) => {
    const parsed = sshUtils.parseKey(Buffer.from(privateKey), passphrase);
    if (parsed instanceof Error) throw parsed;
    return (Array.isArray(parsed) ? parsed[0] : parsed).getPublicSSH().toString('base64');
  };
  /** An RSA key file as `ssh-keygen -m PEM` writes it, encrypted with `passphrase`. */
  const rsaPem = (passphrase: string) => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    .export({ type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase }) as string;
  const pick = (file: string) => mocks.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [file] });

  it('generates an Ed25519 key in the main process; only its public half comes back', async () => {
    await boot();
    const result = await call('store:ssh-keys:generate', { workspaceId: 'main', name: 'laptop' });
    expect(result).toMatchObject({ ok: true, key: { name: 'laptop', algorithm: 'ed25519', hasPassphrase: false } });
    expect(result.key.publicKey).toMatch(/^ssh-ed25519 \S+ laptop$/);
    expectNoSecrets(result);
    // What ssh2 will read at connect has the public key the window shows.
    expect(publicBase64(storedKey(result.key.id).privateKey)).toBe(result.key.publicKey.split(' ')[1]);
    const listed = await call('store:ssh-keys:list', { workspaceId: 'main' });
    expect(listed.keys.map((key: { id: string }) => key.id)).toEqual([result.key.id]);
    expectNoSecrets(listed);
    expect(await call('store:ssh-keys:generate', { workspaceId: 'main', name: 'x'.repeat(129) })).toEqual({ ok: false, error: 'invalid_argument' });
  });

  it('imports in two steps: the passphrase is asked after the file is chosen, and the file is not picked again', async () => {
    await boot();
    const file = path.join(home, 'id_rsa_test');
    fs.writeFileSync(file, rsaPem('key-passphrase'));
    pick(file);
    const chosen = await call('store:ssh-keys:choose-file', {});
    expect(chosen).toMatchObject({ ok: true, fileName: 'id_rsa_test', encrypted: true });
    const request = { workspaceId: 'main', fileId: chosen.fileId };
    expect(await call('store:ssh-keys:import', request)).toEqual({ ok: false, error: 'needs_password' });
    expect(await call('store:ssh-keys:import', { ...request, passphrase: 'wrong' })).toEqual({ ok: false, error: 'wrong_password' });
    const imported = await call('store:ssh-keys:import', { ...request, name: '', passphrase: 'key-passphrase' });
    expect(imported).toMatchObject({ ok: true, key: { name: 'id_rsa_test', algorithm: 'rsa-2048', hasPassphrase: true } });
    expectNoSecrets(imported);
    expect(storedKey(imported.key.id).passphrase).toBe('key-passphrase');
    expect(publicBase64(storedKey(imported.key.id).privateKey, 'key-passphrase')).toBe(imported.key.publicKey.split(' ')[1]);
    expect(mocks.dialog.showOpenDialog).toHaveBeenCalledTimes(1);
    expect(await call('store:ssh-keys:import', request), 'a used fileId is gone').toEqual({ ok: false, error: 'not_found' });
    expect(fs.existsSync(file)).toBe(true);
  });

  it('converts a PKCS#8 key, which ssh2 cannot read, and stores it without a passphrase', async () => {
    await boot();
    const file = path.join(home, 'id_pkcs8');
    fs.writeFileSync(file, crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'p8-pass' }));
    pick(file);
    const chosen = await call('store:ssh-keys:choose-file', {});
    expect(chosen.encrypted).toBe(true);
    const imported = await call('store:ssh-keys:import', { workspaceId: 'main', fileId: chosen.fileId, name: 'converted', passphrase: 'p8-pass' });
    expect(imported).toMatchObject({ ok: true, key: { name: 'converted', algorithm: 'ed25519', hasPassphrase: false } });
    const stored = storedKey(imported.key.id);
    expect(stored.passphrase).toBeNull();
    expect(stored.privateKey).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----/);
    expect(publicBase64(stored.privateKey)).toBe(imported.key.publicKey.split(' ')[1]);
  });

  it('refuses at choose-file what cannot be imported, and forgets the file on lock or after 10 minutes', async () => {
    await boot();
    mocks.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await call('store:ssh-keys:choose-file', {})).toEqual({ ok: false, error: 'cancelled' });
    const large = path.join(home, 'large_key');
    fs.writeFileSync(large, Buffer.alloc(65 * 1024, 'a'));
    pick(large);
    expect(await call('store:ssh-keys:choose-file', {})).toEqual({ ok: false, error: 'file_too_large' });
    for (const [name, content] of [['notes.txt', 'hello'], ['id_test.pub', `ssh-ed25519 ${Buffer.alloc(51).toString('base64')} x`]]) {
      const file = path.join(home, name);
      fs.writeFileSync(file, content);
      pick(file);
      expect(await call('store:ssh-keys:choose-file', {}), name).toEqual({ ok: false, error: 'unsupported_key' });
    }

    const file = path.join(home, 'id_rsa_lock');
    fs.writeFileSync(file, rsaPem('pp'));
    pick(file);
    const chosen = await call('store:ssh-keys:choose-file', {});
    for (const listener of mocks.lockListeners) listener();
    expect(await call('store:ssh-keys:import', { workspaceId: 'main', fileId: chosen.fileId, passphrase: 'pp' })).toEqual({ ok: false, error: 'not_found' });

    vi.useFakeTimers({ toFake: ['Date'] });
    pick(file);
    const later = await call('store:ssh-keys:choose-file', {});
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    expect(await call('store:ssh-keys:import', { workspaceId: 'main', fileId: later.fileId, passphrase: 'pp' })).toEqual({ ok: false, error: 'not_found' });
  });

  it('deletes a key and returns the saved list, where the servers that used it have no key', async () => {
    await boot();
    const { key } = await call('store:ssh-keys:generate', { workspaceId: 'main', name: 'laptop' });
    await call('store:profiles:save', { workspaceId: 'main', profiles: [profile({ authType: 'key', keyId: key.id })] });
    const deleted = await call('store:ssh-keys:delete', { workspaceId: 'main', id: key.id });
    expect(deleted.ok).toBe(true);
    expect(deleted.profiles.map((entry: { id: string; keyId: string | null }) => [entry.id, entry.keyId])).toEqual([['web', null]]);
    expectNoSecrets(deleted);
    expect((await call('store:ssh-keys:list', { workspaceId: 'main' })).keys).toEqual([]);
    expect(await call('store:ssh-keys:delete', { workspaceId: 'main', id: key.id })).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('moves the key file a server uses into the store for every server of the workspace on that file, links and case included', async () => {
    const dir = path.join(home, 'link-test');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'id_server');
    fs.writeFileSync(file, rsaPem(PROFILE_PASSPHRASE));
    const link = path.join(home, 'id_link');
    if (!fs.existsSync(link)) fs.symlinkSync(file, link);
    const other = path.join(dir, 'id_other');
    fs.writeFileSync(other, rsaPem('x'));
    await boot({
      profiles: {
        main: [
          // The passphrase saved with the server opens the file.
          profile({ authType: 'key', privateKeyPath: '~/link-test/id_server', passphrase: PROFILE_PASSPHRASE }),
          profile({ id: 'by-link', authType: 'key', privateKeyPath: link, passphrase: 'stale passphrase' }),
          profile({ id: 'other-file', authType: 'key', privateKeyPath: other }),
        ],
      },
    });
    const result = await call('store:ssh-keys:import-profile-file', { workspaceId: 'main', profileId: 'web', trashOriginal: false });
    expect(result).toMatchObject({ ok: true, workspaceId: 'main', key: { name: 'id_server', hasPassphrase: true }, trashed: false });
    expectNoSecrets(result);
    const byId = Object.fromEntries(result.profiles.map((entry: { id: string }) => [entry.id, entry]));
    expect(byId.web).toMatchObject({ authType: 'key', keyId: result.key.id, privateKeyPath: null, hasPassphrase: false });
    expect(byId['by-link']).toMatchObject({ keyId: result.key.id, privateKeyPath: null, hasPassphrase: false });
    expect(byId['other-file']).toMatchObject({ keyId: null, privateKeyPath: other });
    expect(storedKey(result.key.id).passphrase).toBe(PROFILE_PASSPHRASE);
    expect(mocks.shell.trashItem).not.toHaveBeenCalled();
    expect(mocks.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(await call('store:ssh-keys:import-profile-file', { workspaceId: 'main', profileId: 'web', trashOriginal: false }), 'web uses the stored key now').toEqual({ ok: false, error: 'invalid_argument' });
    expect(await call('store:ssh-keys:import-profile-file', { workspaceId: 'main', profileId: 'other-file', trashOriginal: false })).toEqual({ ok: false, error: 'needs_password' });
    expect(await call('store:ssh-keys:import-profile-file', { workspaceId: 'main', profileId: 'other-file', passphrase: 'wrong', trashOriginal: false })).toEqual({ ok: false, error: 'wrong_password' });
  });

  it('asks in the main process before the Trash, and keeps a file anything GETSSH knows may still use', async () => {
    const userData = fs.mkdtempSync(path.join(home, 'user-data-'));
    mocks.app.getPath.mockImplementation((name: string) => (name === 'userData' ? userData : os.tmpdir()));
    const keyFile = (name: string, passphrase: string) => {
      const file = path.join(home, name);
      fs.writeFileSync(file, rsaPem(passphrase));
      return file;
    };
    try {
      const shared = keyFile('id_shared', 'a');
      const alone = keyFile('id_alone', 'b');
      await boot({
        workspaces: [{ id: 'main', name: 'Main', is_main: true }, { id: 'team', name: 'Team' }, { id: 'locked', name: 'Locked', password: WORKSPACE_PASSWORD }],
        profiles: {
          main: [profile({ id: 'shared', authType: 'key', privateKeyPath: shared }), profile({ id: 'alone', authType: 'key', privateKeyPath: alone })],
          // The same file, spelled through ~ in another workspace.
          team: [profile({ id: 'team-shared', authType: 'key', privateKeyPath: `~/id_shared` })],
        },
      });
      const run = (profileId: string, passphrase: string, workspaceId = 'main') => call('store:ssh-keys:import-profile-file', { workspaceId, profileId, passphrase, trashOriginal: true, language: 'zh-CN' });
      expect(await run('alone', 'b')).toMatchObject({ ok: true, trashed: false, kept: 'workspaces_locked' });
      await fake.unlockWorkspace('locked', { password: WORKSPACE_PASSWORD });
      expect(await run('shared', 'a')).toMatchObject({ ok: true, trashed: false, kept: 'used_elsewhere' });
      expect(mocks.dialog.showMessageBox).not.toHaveBeenCalled();

      const fresh = keyFile('id_fresh', 'c');
      await call('store:profiles:save', { workspaceId: 'team', profiles: [profile({ id: 'team-fresh', authType: 'key', privateKeyPath: fresh })] });
      answerDialog(1);
      expect(await run('team-fresh', 'c', 'team')).toMatchObject({ ok: true, trashed: false, kept: 'declined' });
      const [, asked] = mocks.dialog.showMessageBox.mock.calls.at(-1)!.length === 2 ? mocks.dialog.showMessageBox.mock.calls.at(-1)! : [null, mocks.dialog.showMessageBox.mock.calls.at(-1)![0]];
      expect(asked.detail).toContain(fresh);
      expect(asked.message).toMatch(/废纸篓|回收站/);
      expect(mocks.shell.trashItem).not.toHaveBeenCalled();

      const gone = keyFile('id_gone', 'd');
      await call('store:profiles:save', { workspaceId: 'team', profiles: [profile({ id: 'team-gone', authType: 'key', privateKeyPath: gone })] });
      answerDialog(0);
      expect(await run('team-gone', 'd', 'team')).toMatchObject({ ok: true, trashed: true });
      expect(mocks.shell.trashItem).toHaveBeenCalledWith(gone);

      const stuck = keyFile('id_stuck', 'e');
      await call('store:profiles:save', { workspaceId: 'team', profiles: [profile({ id: 'team-stuck', authType: 'key', privateKeyPath: stuck })] });
      answerDialog(0);
      mocks.shell.trashItem.mockRejectedValueOnce(new Error('no Trash'));
      expect(await run('team-stuck', 'e', 'team')).toMatchObject({ ok: true, trashed: false, kept: 'trash_failed' });

      // GETSSH 2.0's own server list is left in place for 2.x and may name the file.
      fs.writeFileSync(path.join(userData, 'profiles.json'), '[]');
      const legacy = keyFile('id_legacy', 'f');
      await call('store:profiles:save', { workspaceId: 'team', profiles: [profile({ id: 'team-legacy', authType: 'key', privateKeyPath: legacy })] });
      expect(await run('team-legacy', 'f', 'team')).toMatchObject({ ok: true, trashed: false, kept: 'used_elsewhere' });

      await call('store:profiles:save', { workspaceId: 'main', profiles: [profile({ id: 'gone', authType: 'key', privateKeyPath: path.join(home, 'missing') })] });
      expect(await call('store:ssh-keys:import-profile-file', { workspaceId: 'main', profileId: 'gone', trashOriginal: false })).toEqual({ ok: false, error: 'io' });
      expect(await call('store:ssh-keys:import-profile-file', { workspaceId: 'main', profileId: 'ghost', trashOriginal: false })).toEqual({ ok: false, error: 'not_found' });
      expect(await call('store:ssh-keys:import-profile-file', { workspaceId: 'main', profileId: 'gone' })).toEqual({ ok: false, error: 'invalid_argument' });
    } finally {
      mocks.app.getPath.mockImplementation(() => os.tmpdir());
    }
  });

  it('asks again after the Trash answer, and returns the list as it stands then', async () => {
    const userData = fs.mkdtempSync(path.join(home, 'user-data-'));
    mocks.app.getPath.mockImplementation((name: string) => (name === 'userData' ? userData : os.tmpdir()));
    try {
      const file = path.join(home, 'id_raced');
      fs.writeFileSync(file, rsaPem('r'));
      const before = profile({ id: 'raced', authType: 'key', privateKeyPath: file });
      await boot({ workspaces: [{ id: 'main', name: 'Main', is_main: true }], profiles: { main: [before] } });
      // The window saves its whole list, still from before the import, while the question is open.
      let answer!: (value: { response: number; checkboxChecked: boolean }) => void;
      mocks.dialog.showMessageBox.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
      const pending = call('store:ssh-keys:import-profile-file', { workspaceId: 'main', profileId: 'raced', passphrase: 'r', trashOriginal: true });
      await vi.waitFor(() => expect(mocks.dialog.showMessageBox).toHaveBeenCalled());
      await call('store:profiles:save', { workspaceId: 'main', profiles: [{ ...before, keyId: null }] });
      answer({ response: 0, checkboxChecked: false });
      const result = await pending;
      expect(result).toMatchObject({ ok: true, trashed: false, kept: 'used_elsewhere' });
      expect(mocks.shell.trashItem).not.toHaveBeenCalled();
      expect(fs.existsSync(file)).toBe(true);
      expect(result.profiles.find((entry: { id: string }) => entry.id === 'raced')).toMatchObject({ keyId: null, privateKeyPath: file });
    } finally {
      mocks.app.getPath.mockImplementation(() => os.tmpdir());
    }
  });

  it('keeps keyId on a save that leaves the field out, and drops one whose key is gone', async () => {
    await boot();
    const { key } = await call('store:ssh-keys:generate', { workspaceId: 'main', name: 'laptop' });
    await call('store:profiles:save', { workspaceId: 'main', profiles: [profile({ authType: 'key', keyId: key.id })] });
    const { keyId: _left, ...withoutKeyId } = profile({ authType: 'key' });
    const kept = await call('store:profiles:save', { workspaceId: 'main', profiles: [withoutKeyId] });
    expect(kept.profiles[0].keyId).toBe(key.id);
    await call('store:ssh-keys:delete', { workspaceId: 'main', id: key.id });
    // A window that still holds the deleted key's id: the save goes through without it.
    const stale = await call('store:profiles:save', { workspaceId: 'main', profiles: [profile({ authType: 'key', keyId: key.id })] });
    expect(stale.ok).toBe(true);
    expect(stale.profiles[0].keyId).toBeNull();
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

  it('offers the home folder when Windows cannot give the Documents folder', async () => {
    await boot();
    // app.getPath('documents') throws when the known folder is missing, e.g. redirected to a share.
    mocks.app.getPath.mockImplementation((name: string) => {
      if (name === 'documents') throw new Error("Failed to get 'documents' path");
      return name === 'home' ? home : os.tmpdir();
    });
    try {
      mocks.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });
      expect(await call('store:backup:export', { workspaceIds: ['main'], password: EXPORT_PASSWORD })).toMatchObject({ ok: false, error: 'cancelled' });
      const options = mocks.dialog.showSaveDialog.mock.calls.at(-1)!.at(-1);
      expect(path.dirname(options.defaultPath)).toBe(home);
    } finally {
      mocks.app.getPath.mockImplementation(() => os.tmpdir());
    }
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
