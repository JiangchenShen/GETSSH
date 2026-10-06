import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The GETSSH 2.0 profile import on rust-core/getssh-store/store.fake.js. Every 2.0 file is built
// here with node:crypto inside a temporary userData folder; HOME points at a temporary directory,
// and safeStorage is a stand-in that counts every decryption (each one would be a Keychain or
// DPAPI access in the real app).

const mocks = vi.hoisted(() => {
  const PREFIX = Buffer.from('fake-dpapi:');
  const state = { decrypts: 0 };
  return {
    state,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.concat([PREFIX, Buffer.from(value, 'utf8')]),
      decryptString: (blob: Buffer) => {
        state.decrypts++;
        if (!blob.subarray(0, PREFIX.length).equals(PREFIX)) throw new Error('Error while decrypting the ciphertext');
        return blob.subarray(PREFIX.length).toString('utf8');
      },
    },
    app: {
      isPackaged: false,
      getAppPath: () => process.cwd(),
      getVersion: () => '3.0.0-test',
      getPath: () => {
        throw new Error('tests never use the real userData folder');
      },
    },
  };
});

vi.mock('electron', () => ({ app: mocks.app, safeStorage: mocks.safeStorage }));

import { DatabaseManager } from './DatabaseManager';
import { configureStore, getStore, resetStoreForTest } from './getsshStore';
import {
  applyV2DefaultPort,
  decryptV2Vault,
  detectV2Profiles,
  getV2ImportState,
  importV2WithPassword,
  runAutomaticV2Import,
  V2_IMPORT_SETTING,
} from './legacyV2Profiles';

const fake = createRequire(import.meta.url)(path.resolve(process.cwd(), '../../rust-core/getssh-store/store.fake.js'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-legacy-v2-'));
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, GETSSH_FAKE_STORE: process.env.GETSSH_FAKE_STORE };

const V2_PASSWORD = 'old 2.0 password';
const MAC = { platform: 'darwin' as const };

// --- 2.0 files, written the way 2.0 (and 1.x) wrote them ---

function vault(password: string, rows: unknown, version: 'v2' | 'v1' = 'v2'): Buffer {
  const salt = crypto.randomBytes(version === 'v2' ? 32 : 16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, 100_000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(rows), 'utf8'), cipher.final()]);
  // getssh-vault writes the tag before the ciphertext.
  const parts = [salt, iv, cipher.getAuthTag(), ciphertext];
  return Buffer.concat(version === 'v2' ? [Buffer.from('GETSSH_V2', 'ascii'), ...parts] : parts);
}

/** profiles.key as 2.0 wrote it on macOS: safeStorage under --use-mock-keychain. */
function mockKeychainKey(password: string): Buffer {
  const key = crypto.pbkdf2Sync('mock_password', 'saltysalt', 1003, 16, 'sha1');
  const cipher = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from('v10', 'ascii'), cipher.update(password, 'utf8'), cipher.final()]);
}

/** profiles.key as 2.0 wrote it on Windows: safeStorage over DPAPI (the stand-in's format here). */
function dpapiKey(password: string): Buffer {
  return mocks.safeStorage.encryptString(password);
}

/** A profiles.key from 1.x on macOS: the real Keychain's key, which only a Keychain prompt opens. */
function realKeychainKey(): Buffer {
  return Buffer.concat([Buffer.from('v10', 'ascii'), crypto.randomBytes(48)]);
}

const ROWS = [
  { host: 'web.example.com', username: 'root', password: 'web-secret-1', port: 2222, protocol: 'ssh', alias: 'Web', autoStart: true, osType: 'ubuntu', authType: 'password' },
  { host: 'key.example.com', username: 'deploy', password: 'stale-password', privateKeyPath: '~/.ssh/id_ed25519', useKeepAlive: false, authType: 'password' },
  { host: 'switch.lan', username: '', protocol: 'telnet', name: 'Core switch', password: '' },
  { host: '', username: '', protocol: 'local', alias: 'Local shell' },
];

const EXISTING = {
  id: 'existing', host: 'db.lan', username: 'admin', port: 22, protocol: 'ssh', authType: 'password',
  alias: 'db', osType: 'debian', groupName: 'prod', autoStart: false, useKeepAlive: true, strictHostKeyChecking: true,
  proxyJump: 'bastion.lan', initialDirectory: '/srv', postConnectScript: 'uptime', themeOverride: null, keyId: null, privateKeyPath: null,
  password: 'existing-password-1', passphrase: 'existing-passphrase-2',
};

/** `port`: the row's own, or 'default' for a row saved without one. */
function v2Id(protocol: string, host: string, port: number | 'default', username: string, n = 0): string {
  return `v2-${crypto.createHash('sha256').update(`${protocol}|${host}|${port}|${username}|${n}`).digest('hex').slice(0, 32)}`;
}

let dir: string;

function write(name: string, data: Buffer | string) {
  fs.writeFileSync(path.join(dir, name), data);
}

/** Every file in userData with its content hash and modification time. */
function folderState() {
  return fs.readdirSync(dir).sort().map(name => {
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    return { name, mtimeMs: stat.mtimeMs, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
  });
}

async function boot(seed: Record<string, unknown> = {}) {
  fake.__fake.reset();
  resetStoreForTest();
  fake.configure(path.join(home, '.getssh'), '3.0.0-test');
  fake.__fake.seed({
    workspaces: [
      { id: 'default', name: 'Default' },
      { id: 'home', name: 'Home', is_main: true },
    ],
    profiles: { home: [EXISTING] },
    ...seed,
  });
  await configureStore().start();
}

const profiles = (workspaceId = 'home') => DatabaseManager.getProfiles(workspaceId);
const byHost = (host: string, workspaceId = 'home') => profiles(workspaceId).find(profile => profile.host === host);
const marker = () => DatabaseManager.getGlobalSetting(V2_IMPORT_SETTING);

beforeEach(async () => {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.GETSSH_FAKE_STORE = '1';
  dir = fs.mkdtempSync(path.join(home, 'user-data-'));
  mocks.state.decrypts = 0;
  await boot();
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(home, { recursive: true, force: true });
});

describe('the 2.0 vault format', () => {
  // The golden files of rust-core/getssh-vault (lib.rs golden_tests), written by the build 2.0 shipped.
  const unhex = (hex: string) => Buffer.from(hex, 'hex');
  const GOLDEN_V2 = unhex('4745545353485f5632378744bf28132d8634ea3de331fcb5f8b3e284f89fa66b63e13dd0a733b57c19f1735a777dcb07faaa7c20f9c94ffcfbdedceb8f0be49aaeed2ead6ae8f794b1ba1b8265f91d7ac86b6b2fdacf5feb63');
  const GOLDEN_V1 = unhex('050505050505050505050505050505050606060606060606060606065d6e4c12f64bdf7ef170c6f6e37ccd08750cefb19707925903007533c8ebca2efe');

  it('opens the files getssh-vault wrote, V2 and V1, with node:crypto alone', async () => {
    expect((await decryptV2Vault(GOLDEN_V2, 'golden vault password'))?.toString()).toBe('golden vault payload');
    expect((await decryptV2Vault(GOLDEN_V1, 'golden vault password'))?.toString()).toBe('legacy v1 payload');
    expect(await decryptV2Vault(GOLDEN_V2, 'wrong password')).toBeNull();
    expect(await decryptV2Vault(GOLDEN_V2.subarray(0, 60), 'golden vault password')).toBeNull();
    expect(await decryptV2Vault(GOLDEN_V2, '')).toBeNull();
  });
});

describe('detectV2Profiles', () => {
  it('finds what 2.0 left, profiles.enc first, as 2.0 itself did', () => {
    expect(detectV2Profiles(dir)).toEqual({ kind: 'none', hasKey: false });
    expect(detectV2Profiles(path.join(dir, 'missing'))).toEqual({ kind: 'none', hasKey: false });
    write('profiles.json', JSON.stringify(ROWS, null, 2));
    expect(detectV2Profiles(dir)).toEqual({ kind: 'plain', hasKey: false });
    write('profiles.enc', vault(V2_PASSWORD, ROWS));
    write('profiles.key', mockKeychainKey(V2_PASSWORD));
    expect(detectV2Profiles(dir)).toEqual({ kind: 'encrypted', hasKey: true });
  });

  it('reports a 1.x safeStorage blob, a damaged vault or a folder as unreadable', () => {
    write('profiles.json', crypto.randomBytes(64));
    expect(detectV2Profiles(dir).kind).toBe('unreadable');
    write('profiles.json', '{"host":"not a list"}');
    expect(detectV2Profiles(dir).kind).toBe('unreadable');
    write('profiles.enc', Buffer.from('GETSSH_V2 too short'));
    expect(detectV2Profiles(dir).kind).toBe('unreadable');
    fs.rmSync(path.join(dir, 'profiles.enc'));
    fs.mkdirSync(path.join(dir, 'profiles.enc'));
    expect(detectV2Profiles(dir).kind).toBe('unreadable');
  });
});

describe('runAutomaticV2Import', () => {
  it('imports an encrypted list with the saved 2.0 password into MAIN, without touching userData', async () => {
    write('profiles.enc', vault(V2_PASSWORD, ROWS));
    write('profiles.key', mockKeychainKey(V2_PASSWORD));
    write('profiles.json.bak', crypto.randomBytes(40));
    const before = folderState();

    expect(await runAutomaticV2Import(dir, MAC)).toEqual({ status: 'imported', imported: 4, skipped: 0 });

    expect(folderState()).toEqual(before);
    expect(mocks.state.decrypts).toBe(0);
    expect(profiles('default')).toEqual([]);
    expect(profiles().map(profile => profile.id)).toEqual([
      'existing',
      v2Id('ssh', 'web.example.com', 2222, 'root'),
      v2Id('ssh', 'key.example.com', 'default', 'deploy'),
      v2Id('telnet', 'switch.lan', 'default', ''),
      v2Id('local', '', 'default', ''),
    ]);
    expect(byHost('web.example.com')).toMatchObject({
      workspace_id: 'home', username: 'root', port: 2222, protocol: 'ssh', authType: 'password', alias: 'Web', osType: 'ubuntu',
      groupName: null, autoStart: true, useKeepAlive: true, strictHostKeyChecking: false, keyId: null, privateKeyPath: null,
      hasPassword: true, hasPassphrase: false,
    });
    // A key file wins over the password at connect time, in 2.0 and 3.0 alike.
    expect(byHost('key.example.com')).toMatchObject({ authType: 'key', privateKeyPath: '~/.ssh/id_ed25519', useKeepAlive: false, autoStart: false, alias: null });
    expect(byHost('switch.lan')).toMatchObject({ protocol: 'telnet', port: 23, alias: 'Core switch', hasPassword: false });
    expect(byHost('')).toMatchObject({ protocol: 'local', alias: 'Local shell' });

    const secrets = fake.__fake.secretsFor('home').profiles;
    expect(secrets[v2Id('ssh', 'web.example.com', 2222, 'root')]).toEqual({ password: 'web-secret-1', passphrase: null });
    expect(secrets[v2Id('ssh', 'key.example.com', 'default', 'deploy')]).toEqual({ password: 'stale-password', passphrase: null });
    expect(secrets[v2Id('telnet', 'switch.lan', 'default', '')]).toEqual({ password: null, passphrase: null });

    const record = JSON.parse(marker() ?? 'null');
    expect(record).toEqual({
      at: expect.any(Number),
      source: 'profiles.enc',
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'profiles.enc'))).digest('hex'),
      imported: 4,
      skipped: 0,
      // key.example.com had no port: it waits for the window's default port.
      portDefaulted: [{ workspaceId: 'home', ids: [v2Id('ssh', 'key.example.com', 'default', 'deploy')] }],
    });
    expect(DatabaseManager.getAuditLogs('home')[0]).toMatchObject({ action: 'Profiles Imported', target: 'GETSSH 2.0', details: '4 imported, 0 skipped' });
    expect(DatabaseManager.getAuditLogs('default')).toEqual([]);
  });

  it('keeps every existing profile and its stored secrets', async () => {
    const before = profiles().find(profile => profile.id === 'existing');
    write('profiles.json', JSON.stringify(ROWS, null, 2));
    expect((await runAutomaticV2Import(dir, MAC)).status).toBe('imported');
    expect(profiles()).toHaveLength(5);
    expect(profiles().find(profile => profile.id === 'existing')).toEqual(before);
    expect(fake.__fake.secretsFor('home').profiles.existing).toEqual({ password: 'existing-password-1', passphrase: 'existing-passphrase-2' });
    const secrets = getStore().connectSecrets('home', 'existing');
    expect(secrets.password?.toString()).toBe('existing-password-1');
    expect(secrets.passphrase?.toString()).toBe('existing-passphrase-2');
  });

  it('saves into the workspace marked MAIN, whatever its id', async () => {
    await boot({
      workspaces: [
        { id: 'default', name: 'Default' },
        { id: 'work', name: 'Work', is_main: true },
      ],
      profiles: {},
    });
    write('profiles.json', JSON.stringify(ROWS));
    expect((await runAutomaticV2Import(dir, MAC)).imported).toBe(4);
    expect(profiles('work')).toHaveLength(4);
    expect(profiles('default')).toEqual([]);
  });

  it('imports a plain profiles.json without any password', async () => {
    write('profiles.json', JSON.stringify(ROWS, null, 2));
    expect(await runAutomaticV2Import(dir, MAC)).toEqual({ status: 'imported', imported: 4, skipped: 0 });
    expect(JSON.parse(marker() ?? '{}').source).toBe('profiles.json');
    expect(fake.__fake.secretsFor('home').profiles[v2Id('ssh', 'web.example.com', 2222, 'root')].password).toBe('web-secret-1');
  });

  it('without profiles.key it waits for the typed password and changes nothing', async () => {
    write('profiles.enc', vault(V2_PASSWORD, ROWS));
    const before = fake.__fake.snapshot();
    expect(await runAutomaticV2Import(dir, MAC)).toEqual({ status: 'needs_password', imported: 0, skipped: 0 });
    expect(fake.__fake.snapshot()).toEqual(before);
    expect(marker()).toBeNull();
    expect(await getV2ImportState(dir, MAC)).toEqual({ kind: 'encrypted', needsPassword: true, imported: null });
  });

  it('never asks the Keychain on macOS: a key it cannot open counts as missing', async () => {
    write('profiles.enc', vault(V2_PASSWORD, ROWS));
    for (const key of [realKeychainKey(), dpapiKey(V2_PASSWORD), mockKeychainKey('another password'), Buffer.alloc(0)]) {
      write('profiles.key', key);
      expect((await runAutomaticV2Import(dir, MAC)).status).toBe('needs_password');
    }
    expect(mocks.state.decrypts).toBe(0);
    expect(profiles()).toHaveLength(1);
    expect(marker()).toBeNull();
  });

  it('opens profiles.key through DPAPI on Windows, and nowhere else', async () => {
    write('profiles.enc', vault(V2_PASSWORD, ROWS));
    write('profiles.key', dpapiKey(V2_PASSWORD));
    expect((await runAutomaticV2Import(dir, { platform: 'linux' })).status).toBe('needs_password');
    expect(mocks.state.decrypts).toBe(0);
    expect(await runAutomaticV2Import(dir, { platform: 'win32' })).toEqual({ status: 'imported', imported: 4, skipped: 0 });
    expect(mocks.state.decrypts).toBe(1);
  });

  it('runs once: a second run, or a 2.0 file changed since, adds nothing by itself', async () => {
    write('profiles.json', JSON.stringify(ROWS));
    expect((await runAutomaticV2Import(dir, MAC)).status).toBe('imported');
    const first = marker();
    expect(await runAutomaticV2Import(dir, MAC)).toEqual({ status: 'already', imported: 0, skipped: 0 });
    expect(await importV2WithPassword(dir, null, MAC)).toEqual({ status: 'already', imported: 0, skipped: 0 });

    write('profiles.json', JSON.stringify([...ROWS, { host: 'new.example.com', username: 'ops' }]));
    expect((await runAutomaticV2Import(dir, MAC)).status).toBe('already');
    expect(profiles()).toHaveLength(5);
    expect(marker()).toBe(first);
    expect((await getV2ImportState(dir, MAC)).imported).toEqual({ at: expect.any(Number), source: 'profiles.json', imported: 4, skipped: 0, changed: true, portDefaulted: 1 });

    // Asked for: only the new server is added; the ones imported before are skipped.
    expect(await importV2WithPassword(dir, null, MAC)).toEqual({ status: 'imported', imported: 1, skipped: 4 });
    expect(profiles()).toHaveLength(6);
    expect((await getV2ImportState(dir, MAC)).imported?.changed).toBe(false);
  });

  it('reports nothing, an empty list or an unreadable file without recording an import', async () => {
    expect(await runAutomaticV2Import(dir, MAC)).toEqual({ status: 'nothing', imported: 0, skipped: 0 });
    write('profiles.json', '[]');
    expect((await runAutomaticV2Import(dir, MAC)).status).toBe('nothing');
    write('profiles.json', crypto.randomBytes(80));
    expect((await runAutomaticV2Import(dir, MAC)).status).toBe('unreadable');
    write('profiles.enc', vault(V2_PASSWORD, { not: 'a list' }));
    write('profiles.key', mockKeychainKey(V2_PASSWORD));
    expect((await runAutomaticV2Import(dir, MAC)).status).toBe('unreadable');
    expect(marker()).toBeNull();
    expect(profiles()).toHaveLength(1);
  });

  it('never throws: a failure is a status, and nothing is recorded', async () => {
    write('profiles.json', JSON.stringify(ROWS));
    const save = vi.spyOn(DatabaseManager, 'saveProfiles').mockImplementation(() => {
      throw new Error('disk full');
    });
    try {
      expect(await runAutomaticV2Import(dir, MAC)).toEqual({ status: 'failed', imported: 0, skipped: 0, error: 'internal' });
    } finally {
      save.mockRestore();
    }
    expect(profiles()).toHaveLength(1);
    expect(marker()).toBeNull();
    resetStoreForTest();
    expect(await runAutomaticV2Import(dir, MAC)).toEqual({ status: 'failed', imported: 0, skipped: 0, error: 'locked' });
  });
});

describe('importV2WithPassword', () => {
  it('a wrong password changes nothing', async () => {
    write('profiles.enc', vault(V2_PASSWORD, ROWS));
    const before = fake.__fake.snapshot();
    expect(await importV2WithPassword(dir, 'not the password', MAC)).toEqual({ status: 'wrong_password', imported: 0, skipped: 0 });
    expect(await importV2WithPassword(dir, 'x'.repeat(4097), MAC)).toEqual({ status: 'wrong_password', imported: 0, skipped: 0 });
    expect(fake.__fake.snapshot()).toEqual(before);
    expect(fake.__fake.secretsFor('home').profiles).toEqual({ existing: { password: 'existing-password-1', passphrase: 'existing-passphrase-2' } });
    expect(marker()).toBeNull();
    // Without a password only the saved one is tried; there is none here.
    expect((await importV2WithPassword(dir, '', MAC)).status).toBe('needs_password');
  });

  it('takes a 2.0 password of any length, here 3 characters', async () => {
    write('profiles.enc', vault('abc', ROWS));
    expect(await importV2WithPassword(dir, 'abc', MAC)).toEqual({ status: 'imported', imported: 4, skipped: 0 });
    expect(await getV2ImportState(dir, MAC)).toMatchObject({ kind: 'encrypted', needsPassword: false, imported: { imported: 4, changed: false } });
  });

  it('opens a vault last written by 1.x', async () => {
    write('profiles.enc', vault(V2_PASSWORD, ROWS, 'v1'));
    expect((await runAutomaticV2Import(dir, MAC)).status).toBe('needs_password');
    expect((await importV2WithPassword(dir, V2_PASSWORD, MAC)).imported).toBe(4);
  });

  it('uses the port the window passes for 2.0 profiles without one', async () => {
    write('profiles.json', JSON.stringify([{ host: 'a.lan', username: 'u' }, { host: 'b.lan', protocol: 'telnet' }, { host: 'c.lan', port: 2200 }]));
    expect((await importV2WithPassword(dir, null, { ...MAC, defaultPort: 2022 })).imported).toBe(3);
    expect(profiles().map(profile => [profile.host, profile.port])).toEqual([['db.lan', 22], ['a.lan', 2022], ['b.lan', 23], ['c.lan', 2200]]);
  });
});

describe('applyV2DefaultPort', () => {
  // 2.0 connected a server without a port at `port || appConfig.defaultPort || 22`.
  const PORTLESS = [
    { host: 'a.lan', username: 'u' },
    { host: 'b.lan', username: 'u', port: 0 },
    { host: 'c.lan', username: 'u', port: 2200 },
    { host: 'd.lan', protocol: 'telnet' },
    { host: '', protocol: 'local', alias: 'Shell' },
    { host: 'e.lan', username: 'u' },
  ];
  const ports = () => profiles().map(profile => [profile.host, profile.port]);

  it('gives the window\'s default port, once, to the servers the automatic import set to 22', async () => {
    write('profiles.json', JSON.stringify(PORTLESS));
    expect((await runAutomaticV2Import(dir, MAC)).imported).toBe(6);
    expect((await getV2ImportState(dir, MAC)).imported?.portDefaulted).toBe(3);
    // Changed in 3.0 in the meantime: left alone.
    const edited = profiles().map(profile => (profile.host === 'e.lan' ? { ...profile, port: 2201 } : { ...profile }));
    DatabaseManager.saveProfiles('home', edited);

    expect(await applyV2DefaultPort(2222)).toEqual({ status: 'applied', changed: 2 });
    expect(ports()).toEqual([['db.lan', 22], ['a.lan', 2222], ['b.lan', 2222], ['c.lan', 2200], ['d.lan', 23], ['', 22], ['e.lan', 2201]]);
    expect(fake.__fake.secretsFor('home').profiles.existing).toEqual({ password: 'existing-password-1', passphrase: 'existing-passphrase-2' });
    expect(DatabaseManager.getAuditLogs('home')[0].details).toBe('2 given the 2.0 default port 2222');
    expect((await getV2ImportState(dir, MAC)).imported?.portDefaulted).toBe(0);
    expect(await applyV2DefaultPort(2022)).toEqual({ status: 'nothing', changed: 0 });
    expect(ports()[1]).toEqual(['a.lan', 2222]);
  });

  it('a default port of 22 changes nothing and ends the wait', async () => {
    write('profiles.json', JSON.stringify(PORTLESS));
    await runAutomaticV2Import(dir, MAC);
    const before = ports();
    expect(await applyV2DefaultPort(22)).toEqual({ status: 'applied', changed: 0 });
    expect(ports()).toEqual(before);
    expect(await applyV2DefaultPort(2222)).toEqual({ status: 'nothing', changed: 0 });
  });

  it('nothing waits after an import that had the port, or after none', async () => {
    expect(await applyV2DefaultPort(2222)).toEqual({ status: 'nothing', changed: 0 });
    write('profiles.json', JSON.stringify(PORTLESS));
    await importV2WithPassword(dir, null, { ...MAC, defaultPort: 2022 });
    expect((await getV2ImportState(dir, MAC)).imported?.portDefaulted).toBe(0);
    expect(await applyV2DefaultPort(2222)).toEqual({ status: 'nothing', changed: 0 });
  });

  it('keeps the servers of an earlier import waiting when a later one adds more', async () => {
    write('profiles.json', JSON.stringify([PORTLESS[0]]));
    await runAutomaticV2Import(dir, MAC);
    write('profiles.json', JSON.stringify([PORTLESS[0], PORTLESS[5]]));
    expect((await importV2WithPassword(dir, null, MAC)).imported).toBe(1);
    expect((await getV2ImportState(dir, MAC)).imported?.portDefaulted).toBe(2);
    expect((await applyV2DefaultPort(2222)).changed).toBe(2);
  });

  it('a later import with the default port does not add the waiting servers a second time', async () => {
    write('profiles.json', JSON.stringify([PORTLESS[0]]));
    await runAutomaticV2Import(dir, MAC);
    // 2.0 saved again (a new server), then the window imports with its default port first.
    write('profiles.json', JSON.stringify([PORTLESS[0], { host: 'new.lan', username: 'u' }]));
    expect(await importV2WithPassword(dir, null, { ...MAC, defaultPort: 2022 })).toEqual({ status: 'imported', imported: 1, skipped: 1 });
    expect(ports()).toEqual([['db.lan', 22], ['a.lan', 22], ['new.lan', 2022]]);
    expect((await applyV2DefaultPort(2022)).changed).toBe(1);
    expect(ports()).toEqual([['db.lan', 22], ['a.lan', 2022], ['new.lan', 2022]]);
  });

  it('changes the servers in the workspace they were imported into, also after MAIN moved', async () => {
    await boot({ workspaces: [{ id: 'home', name: 'Home', is_main: true }, { id: 'work', name: 'Work' }] });
    write('profiles.json', JSON.stringify([PORTLESS[0]]));
    await runAutomaticV2Import(dir, MAC);
    DatabaseManager.setMainWorkspace('work');
    expect(await applyV2DefaultPort(2222)).toEqual({ status: 'applied', changed: 1 });
    expect(byHost('a.lan', 'home')?.port).toBe(2222);

    // Imported into a workspace that is locked now: nothing changes and everything keeps waiting.
    await boot();
    write('profiles.json', JSON.stringify([PORTLESS[0]]));
    await runAutomaticV2Import(dir, MAC);
    DatabaseManager.setMainWorkspace('default');
    await getStore().setWorkspacePassword('home', 'home-password-1');
    DatabaseManager.lockWorkspace('home');
    expect(await applyV2DefaultPort(2222)).toEqual({ status: 'failed', changed: 0, error: 'locked' });
    expect((await getV2ImportState(dir, MAC)).imported?.portDefaulted).toBe(1);
    // Deleted since: nothing left to change, nothing waits any more.
    await DatabaseManager.deleteWorkspace('home');
    expect(await applyV2DefaultPort(2222)).toEqual({ status: 'applied', changed: 0 });
    expect((await getV2ImportState(dir, MAC)).imported?.portDefaulted).toBe(0);
  });

  it('never mistakes a server without a port for one saved at port 22', async () => {
    write('profiles.json', JSON.stringify([{ host: 'h.lan', username: 'u', port: 22 }]));
    await runAutomaticV2Import(dir, MAC);
    // In 2.0 the port was cleared, so it now connects at 2.0's default port.
    write('profiles.json', JSON.stringify([{ host: 'h.lan', username: 'u' }]));
    expect(await importV2WithPassword(dir, null, { ...MAC, defaultPort: 2022 })).toEqual({ status: 'imported', imported: 1, skipped: 0 });
    expect(ports()).toEqual([['db.lan', 22], ['h.lan', 22], ['h.lan', 2022]]);
  });

  it('refuses a port that is not an integer from 1 to 65535, and never throws', async () => {
    for (const bad of [0, 65536, 22.5, NaN, '2222' as unknown as number]) {
      expect(await applyV2DefaultPort(bad)).toEqual({ status: 'failed', changed: 0, error: 'invalid_argument' });
    }
    write('profiles.json', JSON.stringify(PORTLESS));
    await runAutomaticV2Import(dir, MAC);
    resetStoreForTest();
    expect(await applyV2DefaultPort(2222)).toEqual({ status: 'failed', changed: 0, error: 'locked' });
  });
});

describe('rows', () => {
  it('skips blank, malformed, oversized and already known rows one by one and imports the rest', async () => {
    const rows = [
      null, 'web.example.com', 42, [{ host: 'nested' }],
      { host: '', username: 'root' },
      { host: '   ', username: 'root', protocol: 'telnet' },
      { host: 'h'.repeat(1025), username: 'root' },
      // 513 characters, 1026 bytes: the store counts bytes.
      { host: 'long-user.lan', username: 'é'.repeat(513) },
      { host: 'nul.lan', alias: 'bad\0alias' },
      { host: 'path.lan', privateKeyPath: `/keys/${'k'.repeat(4096)}` },
      { host: 'db.lan', username: 'admin', port: 22, protocol: 'ssh', alias: 'the same server as in 3.0' },
      { host: 'db.lan', username: 'admin', protocol: 'ssh', password: 'p' },
      { host: 'ok-1.lan', username: 'a', port: 0 },
      { host: 'ok-2.lan', username: 'b', port: '2200', protocol: 'rdp', groupId: 'g1' },
      { host: 'ok-3.lan', username: 'c', port: 70000, groupId: '', alias: '', name: 'From an export' },
      { host: 'ok-4.lan', username: 'd', password: 'x'.repeat(64 * 1024) },
    ];
    write('profiles.json', JSON.stringify(rows));
    expect(await runAutomaticV2Import(dir, MAC)).toEqual({ status: 'imported', imported: 4, skipped: 12 });
    expect(profiles().map(profile => profile.host)).toEqual(['db.lan', 'ok-1.lan', 'ok-2.lan', 'ok-3.lan', 'ok-4.lan']);
    expect(byHost('ok-1.lan')?.port).toBe(22);
    expect(byHost('ok-2.lan')).toMatchObject({ port: 2200, protocol: 'ssh', groupName: 'g1', group: 'g1' });
    expect(byHost('ok-3.lan')).toMatchObject({ port: 22, groupName: null, alias: 'From an export' });
    expect(JSON.parse(marker() ?? '{}')).toMatchObject({ imported: 4, skipped: 12 });
    expect(DatabaseManager.getAuditLogs('home')[0].details).toBe('4 imported, 12 skipped');
  });

  it('gives the same ids every time, also to identical servers listed twice', async () => {
    const twin = { host: 'twin.lan', username: 'root', port: 22 };
    write('profiles.json', JSON.stringify([twin, { ...twin, alias: 'second' }, { host: 'other.lan', username: 'root' }]));
    const expected = [v2Id('ssh', 'twin.lan', 22, 'root', 0), v2Id('ssh', 'twin.lan', 22, 'root', 1), v2Id('ssh', 'other.lan', 'default', 'root', 0)];
    expect((await runAutomaticV2Import(dir, MAC)).imported).toBe(3);
    expect(profiles().slice(1).map(profile => profile.id)).toEqual(expected);
    expect(byHost('twin.lan')?.alias).toBeNull();

    await boot();
    expect((await runAutomaticV2Import(dir, MAC)).imported).toBe(3);
    expect(profiles().slice(1).map(profile => profile.id)).toEqual(expected);
  });
});
