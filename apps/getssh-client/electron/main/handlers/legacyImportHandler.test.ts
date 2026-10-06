import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { IpcMain } from 'electron';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The legacy-v2:* channels against rust-core/getssh-store/store.fake.js, with a temporary HOME and
// a temporary folder standing in for userData.

const mocks = vi.hoisted(() => {
  const state = { userData: '', ready: true, active: 'home' };
  return {
    state,
    app: {
      isPackaged: false,
      getAppPath: () => process.cwd(),
      getVersion: () => '3.0.0-test',
      getPath: (name: string) => {
        if (name !== 'userData') throw new Error(`unexpected app.getPath(${name})`);
        return state.userData;
      },
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: () => {
        throw new Error('not used');
      },
      decryptString: vi.fn(() => {
        throw new Error('safeStorage must not be used on macOS');
      }),
    },
  };
});

vi.mock('electron', () => ({ app: mocks.app, safeStorage: mocks.safeStorage }));
vi.mock('../security/appLock', () => ({ appLock: { isReady: () => mocks.state.ready } }));
vi.mock('../windowRegistry', () => ({
  isMainWebContents: (webContents: { id: number } | null | undefined) => webContents?.id === 1,
}));
vi.mock('./workspaceHandler', () => ({ getActiveWorkspaceId: () => mocks.state.active }));

import { DatabaseManager } from '../services/DatabaseManager';
import { configureStore, resetStoreForTest } from '../services/getsshStore';
import { V2_IMPORT_SETTING } from '../services/legacyV2Profiles';
import { registerLegacyImportHandlers } from './legacyImportHandler';

const fake = createRequire(import.meta.url)(path.resolve(process.cwd(), '../../rust-core/getssh-store/store.fake.js'));

const V2_PASSWORD = 'pw!';
const SERVER_PASSWORD = 'server-password-6b1d';
const ROWS = [
  { host: 'web.example.com', username: 'root', password: SERVER_PASSWORD, port: 22 },
  { host: 'db.example.com', username: 'admin', privateKeyPath: '/keys/db' },
];

type Handler = (event: unknown, request?: unknown) => Promise<any>;
const handlers = new Map<string, Handler>();
const ipcMain = { handle: (channel: string, run: Handler) => handlers.set(channel, run) } as unknown as IpcMain;

const MAIN = { sender: { id: 1 }, senderFrame: { parent: null } };
const SUBFRAME = { sender: { id: 1 }, senderFrame: { parent: {} } };
const NO_FRAME = { sender: { id: 1 }, senderFrame: null };
const OTHER_WINDOW = { sender: { id: 2 }, senderFrame: { parent: null } };

function call(channel: string, request?: unknown, event: unknown = MAIN): Promise<any> {
  const run = handlers.get(channel);
  if (!run) throw new Error(`no handler for ${channel}`);
  return run(event, request);
}

function vault(password: string, rows: unknown): Buffer {
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, 100_000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(rows), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('GETSSH_V2', 'ascii'), salt, iv, cipher.getAuthTag(), ciphertext]);
}

let home: string;
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, GETSSH_FAKE_STORE: process.env.GETSSH_FAKE_STORE };

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-legacy-ipc-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.GETSSH_FAKE_STORE = '1';
  registerLegacyImportHandlers(ipcMain);
});

beforeEach(async () => {
  mocks.state.ready = true;
  mocks.state.active = 'home';
  mocks.state.userData = fs.mkdtempSync(path.join(home, 'user-data-'));
  // No profiles.key: the typed password is the only way in.
  fs.writeFileSync(path.join(mocks.state.userData, 'profiles.enc'), vault(V2_PASSWORD, ROWS));
  fake.__fake.reset();
  resetStoreForTest();
  fake.configure(path.join(home, '.getssh'), '3.0.0-test');
  fake.__fake.seed({
    workspaces: [
      { id: 'home', name: 'Home', is_main: true },
      { id: 'lab', name: 'Lab' },
    ],
    profiles: { lab: [{ id: 'lab-1', host: 'lab.lan', username: 'pi', password: 'lab-password' }] },
  });
  await configureStore().start();
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(home, { recursive: true, force: true });
});

describe('access', () => {
  it('answers only the top frame of the main window, and only while the app is unlocked', async () => {
    const strangers = [SUBFRAME, NO_FRAME, OTHER_WINDOW, { sender: null }, {}];
    for (const event of strangers) {
      expect(await call('legacy-v2:status', undefined, event)).toEqual({ ok: false, error: 'unauthorized' });
      expect(await call('legacy-v2:import', { password: V2_PASSWORD }, event)).toEqual({ ok: false, error: 'unauthorized' });
      expect(await call('legacy-v2:apply-default-port', { port: 2222 }, event)).toEqual({ ok: false, error: 'unauthorized' });
    }
    mocks.state.ready = false;
    expect(await call('legacy-v2:status')).toEqual({ ok: false, error: 'unauthorized' });
    expect(await call('legacy-v2:import', { password: V2_PASSWORD })).toEqual({ ok: false, error: 'unauthorized' });
    expect(await call('legacy-v2:apply-default-port', { port: 2222 })).toEqual({ ok: false, error: 'unauthorized' });
    mocks.state.ready = true;
    // The right password from the wrong sender imported nothing.
    expect(DatabaseManager.getProfiles('home')).toEqual([]);
    expect(DatabaseManager.getGlobalSetting(V2_IMPORT_SETTING)).toBeNull();
  });

  it('refuses a password that is not a string of at most 4096 characters', async () => {
    for (const request of [{ password: 42 }, { password: { value: V2_PASSWORD } }, { password: 'x'.repeat(4097) }, 'pw', [V2_PASSWORD]]) {
      expect(await call('legacy-v2:import', request)).toEqual({ ok: false, error: 'invalid_argument' });
    }
  });
});

describe('legacy-v2:status and legacy-v2:import', () => {
  it('asks for the 2.0 password, imports with it into MAIN and returns the new list', async () => {
    expect(await call('legacy-v2:status')).toEqual({ ok: true, kind: 'encrypted', needsPassword: true, imported: null });
    expect(await call('legacy-v2:import', {})).toMatchObject({ ok: true, status: 'needs_password' });

    const wrong = await call('legacy-v2:import', { password: 'pw?' });
    expect(wrong).toMatchObject({ ok: true, status: 'wrong_password', imported: 0, workspaceId: 'home', profiles: [] });

    const done = await call('legacy-v2:import', { password: V2_PASSWORD, defaultPort: 2022 });
    expect(done).toMatchObject({ ok: true, status: 'imported', imported: 2, skipped: 0, workspaceId: 'home' });
    expect(done.profiles.map((profile: { host: string; port: number; authType: string }) => [profile.host, profile.port, profile.authType]))
      .toEqual([['web.example.com', 22, 'password'], ['db.example.com', 2022, 'key']]);
    expect(done.profiles).toEqual(DatabaseManager.getProfiles('home'));
    // Neither the 2.0 password nor a server password reaches the window.
    const json = JSON.stringify(done);
    expect(json).not.toContain(SERVER_PASSWORD);
    expect(json).not.toContain(V2_PASSWORD);
    expect(mocks.safeStorage.decryptString).not.toHaveBeenCalled();

    expect(await call('legacy-v2:status')).toMatchObject({
      ok: true, kind: 'encrypted', needsPassword: false, imported: { source: 'profiles.enc', imported: 2, skipped: 0, changed: false },
    });
    expect(await call('legacy-v2:import', { password: V2_PASSWORD })).toMatchObject({ ok: true, status: 'already', imported: 0 });
    expect(DatabaseManager.getProfiles('home')).toHaveLength(2);
  });

  it('applies the window\'s default port to the servers imported without one and returns the new list', async () => {
    for (const request of [{ port: 0 }, { port: '2222' }, { port: 2222.5 }, 2222, [2222]]) {
      expect(await call('legacy-v2:apply-default-port', request)).toEqual({ ok: false, error: 'invalid_argument' });
    }
    expect(await call('legacy-v2:apply-default-port', { port: 2222 })).toMatchObject({ ok: true, status: 'nothing', changed: 0 });
    // Without a default port, the way appLock imports: db.example.com has none and gets 22.
    await call('legacy-v2:import', { password: V2_PASSWORD });
    expect(await call('legacy-v2:status')).toMatchObject({ ok: true, imported: { portDefaulted: 1 } });
    const done = await call('legacy-v2:apply-default-port', { port: 2222 });
    expect(done).toMatchObject({ ok: true, status: 'applied', changed: 1, workspaceId: 'home' });
    expect(done.profiles.map((profile: { host: string; port: number }) => [profile.host, profile.port]))
      .toEqual([['web.example.com', 22], ['db.example.com', 2222]]);
    expect(JSON.stringify(done)).not.toContain(SERVER_PASSWORD);
  });

  it('returns the list of the active workspace, which may not be MAIN', async () => {
    mocks.state.active = 'lab';
    const done = await call('legacy-v2:import', { password: V2_PASSWORD });
    expect(done).toMatchObject({ ok: true, status: 'imported', imported: 2, workspaceId: 'lab' });
    expect(done.profiles.map((profile: { id: string }) => profile.id)).toEqual(['lab-1']);
    expect(DatabaseManager.getProfiles('home')).toHaveLength(2);
    expect(fake.__fake.secretsFor('lab').profiles['lab-1'].password).toBe('lab-password');
  });
});
