// Electron main-process entry for run.mjs; one phase per process (KS_PHASE). Legacy files are
// written with --use-mock-keychain, never the real Keychain. Nothing here can prompt.
import { app } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { DatabaseManager as DM } from '../../../electron/main/services/DatabaseManager';
import { appLock } from '../../../electron/main/security/appLock';
import { keyOpens } from '../../../electron/main/security/databaseKeys';
import { APP_SCOPE, keystore, workspaceScope } from '../../../electron/main/security/keystore';
import { writeSecretFile } from '../../../electron/main/security/secretStore';

app.commandLine.appendSwitch('use-mock-keychain');

const phase = process.env.KS_PHASE ?? '';
const base = path.join(os.homedir(), '.getssh');
const marker = (name: string) => path.join(os.homedir(), name);
/** Step markers for run.mjs's diagnostic rerun after a native crash. */
const trace = (step: string) => { if (process.env.KS_TRACE) process.stderr.write(`[${phase}] trace: ${step}\n`); };

const WORKSPACE_SCHEMA = 'CREATE TABLE profiles (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, host TEXT NOT NULL, username TEXT NOT NULL, password TEXT, privateKeyPath TEXT, passphrase TEXT, port INTEGER DEFAULT 22, autoStart INTEGER DEFAULT 0, alias TEXT, osType TEXT)';

function legacyDb(file: string, passphrase: string | null, setup: (db: Database.Database) => void) {
  const db = new Database(file);
  if (passphrase) {
    db.pragma("cipher = 'sqlcipher'");
    db.key(Buffer.from(passphrase, 'utf8'));
  }
  setup(db);
  db.close();
}

/** What GETSSH 2.x / early 3.0 left on disk: app key in safeStorage, workspace passwords in vault.key. */
function writeLegacyLayout(options: { corruptDefault?: boolean } = {}) {
  fs.mkdirSync(path.join(base, 'workspaces'), { recursive: true });
  const appKey = 'ab'.repeat(32);
  trace('safeStorage: writing app_key.enc');
  writeSecretFile(path.join(base, 'app_key.enc'), appKey);
  trace('better-sqlite3: writing the legacy main.db');
  legacyDb(path.join(base, 'main.db'), appKey, db => {
    db.exec('CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, themeColor TEXT, hasPassword INTEGER DEFAULT 0, biometric_enabled INTEGER DEFAULT 0, is_main INTEGER DEFAULT 0, preferences TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
    const insert = db.prepare('INSERT INTO workspaces (id, name, hasPassword, biometric_enabled, is_main, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1)');
    insert.run('default', 'Default', 0, 0, 1);
    insert.run('secret', 'Secret', 1, 1, 0);
    insert.run('lost', 'Lost', 1, 0, 0);
  });
  if (options.corruptDefault) {
    fs.writeFileSync(path.join(base, 'workspace_default.db'), Buffer.alloc(4096, 0x5a));
  } else {
    legacyDb(path.join(base, 'workspace_default.db'), null, db => {
      db.exec(WORKSPACE_SCHEMA);
      db.prepare("INSERT INTO profiles (id, workspace_id, host, username, password) VALUES ('p1', 'default', 'router.lan', 'admin', 'hunter2')").run();
    });
  }
  legacyDb(path.join(base, 'workspace_secret.db'), 'secret-pw-1', db => {
    db.exec(WORKSPACE_SCHEMA);
    db.prepare("INSERT INTO profiles (id, workspace_id, host, username, password) VALUES ('s1', 'secret', 'prod.example', 'root', 'topsecret')").run();
  });
  fs.mkdirSync(path.join(base, 'workspaces', 'secret'), { recursive: true });
  writeSecretFile(path.join(base, 'workspaces', 'secret', 'vault.key'), 'secret-pw-1');
  // A password workspace whose vault.key is missing, with a password shorter than 3.0 allows.
  legacyDb(path.join(base, 'workspace_lost.db'), 'abc', db => {
    db.exec(WORKSPACE_SCHEMA);
    db.prepare("INSERT INTO profiles (id, workspace_id, host, username, password) VALUES ('l1', 'lost', 'old.example', 'me', 'x')").run();
  });
}

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.set(path.relative(dir, full), fs.readFileSync(full).toString('base64'));
    }
  };
  walk(dir);
  return out;
}

const hosts = (workspaceId: string) => DM.getProfiles(workspaceId).map(p => `${p.host}:${p.password}`).sort();
const scope = (id: string) => keystore.status().scopes.find(s => s.id === id);

async function commitAll(staged: string[]) {
  for (const id of staged) await DM.completeRotation(id);
}

async function run(): Promise<string> {
  trace('app ready');
  if (process.env.KS_TRACE) {
    const localState = path.join(app.getPath('userData'), 'Local State');
    const text = fs.existsSync(localState) ? fs.readFileSync(localState, 'utf8') : null;
    trace(`Local State ${text === null ? 'missing' : `present, os_crypt key ${text.includes('"encrypted_key"') ? 'stored' : 'absent'}`} (${localState})`);
  }
  switch (phase) {
    case 'legacy':
      writeLegacyLayout();
      return 'legacy layout written';

    case 'migrate': {
      await appLock.start();
      const state = appLock.state();
      assert.equal(state.phase, 'ready', JSON.stringify(state));
      assert.deepEqual([...(state.migration?.migratedWorkspaces ?? [])].sort(), ['default', 'secret']);
      assert.deepEqual(state.migration?.deferredWorkspaces, ['lost']);
      assert.deepEqual(state.migration?.presenceToReenable, ['secret']);
      assert.deepEqual(state.migration?.failedWorkspaces, []);
      for (const gone of ['app_key.enc', 'workspaces/secret/vault.key', '.keystore-migration-backup']) {
        assert.ok(!fs.existsSync(path.join(base, gone)), `${gone} should be gone`);
      }
      assert.equal(await DM.openWorkspace('default'), 'open');
      assert.deepEqual(hosts('default'), ['router.lan:hunter2']);
      assert.ok(!keyOpens(path.join(base, 'workspace_default.db'), { kind: 'none' }), 'default is encrypted now');
      assert.equal(await DM.openWorkspace('secret'), 'locked');
      assert.equal(await DM.unlockWorkspaceWithPassword('secret', 'wrong-pw'), false);
      assert.equal(await DM.unlockWorkspaceWithPassword('secret', 'secret-pw-1'), true);
      assert.deepEqual(hosts('secret'), ['prod.example:topsecret']);
      assert.equal(await DM.openWorkspace('lost'), 'legacy');
      assert.equal(await DM.unlockWorkspaceWithPassword('lost', 'nope'), false);
      assert.equal(await DM.unlockWorkspaceWithPassword('lost', 'abc'), true, 'short legacy passwords survive');
      assert.deepEqual(hosts('lost'), ['old.example:x']);
      assert.ok(scope(workspaceScope('lost'))?.ownPassword);
      return 'migrated ' + JSON.stringify(state.migration);
    }

    case 'restart-plain': {
      await appLock.start();
      assert.equal(appLock.state().phase, 'ready');
      assert.equal(appLock.state().migration, undefined, 'no second migration');
      assert.equal(await DM.openWorkspace('default'), 'open');
      assert.equal(await DM.openWorkspace('secret'), 'locked');
      assert.equal(await DM.unlockWorkspaceWithPassword('lost', 'abc'), true);
      appLock.lock('idle');
      assert.ok(!DM.isWorkspaceMounted('lost'), 'protected workspaces close on idle');
      assert.ok(DM.isWorkspaceMounted('default'), 'the rest stays open without a master password');
      assert.equal(appLock.state().phase, 'ready');
      return 'restart without master password ok';
    }

    case 'set-master': {
      await appLock.start();
      assert.equal(await DM.openWorkspace('default'), 'open');
      const staged = await keystore.setPassword(APP_SCOPE, 'master-password-1');
      assert.deepEqual([...staged].sort(), [APP_SCOPE, workspaceScope('default')].sort());
      await commitAll(staged);
      assert.ok(!scope(APP_SCOPE)?.staged && !scope(workspaceScope('default'))?.staged);
      assert.deepEqual(hosts('default'), ['router.lan:hunter2']);
      assert.ok(!keystore.status().recoveryConfigured, 'setting the master password discards the old code');
      fs.writeFileSync(marker('recovery.txt'), await keystore.setupRecovery());
      return 'master password set';
    }

    case 'restart-master': {
      await appLock.start();
      assert.equal(appLock.state().phase, 'locked');
      assert.ok(!DM.isMainDbOpen());
      assert.equal((await appLock.unlock({ method: 'password', password: 'wrong' })).ok, false);
      assert.deepEqual(await appLock.unlock({ method: 'password', password: 'master-password-1' }), { ok: true });
      assert.equal(await DM.openWorkspace('default'), 'open', 'one master unlock opens it');
      assert.deepEqual(hosts('default'), ['router.lan:hunter2']);
      assert.equal(await DM.openWorkspace('secret'), 'locked', 'its own password, locked while the master password was set');
      assert.equal(await DM.unlockWorkspaceWithPassword('secret', 'secret-pw-1'), true);
      appLock.lock('screen locked');
      assert.equal(appLock.state().phase, 'locked');
      assert.ok(!DM.isMainDbOpen() && !DM.isWorkspaceMounted('default') && !DM.isWorkspaceMounted('secret'));
      assert.deepEqual(await appLock.unlock({ method: 'recovery', code: fs.readFileSync(marker('recovery.txt'), 'utf8') }), { ok: true });
      assert.equal(await DM.openWorkspace('secret'), 'open', 'joined the master password on its unlock above');
      return 'master password lock/unlock ok';
    }

    case 'remove-master': {
      await appLock.start();
      assert.deepEqual(await appLock.unlock({ method: 'password', password: 'master-password-1' }), { ok: true });
      assert.equal(await DM.openWorkspace('default'), 'open');
      const staged = await keystore.removePassword(APP_SCOPE);
      assert.deepEqual(staged, [APP_SCOPE]);
      await commitAll(staged);
      assert.ok(!keystore.status().appProtected);
      assert.deepEqual(hosts('default'), ['router.lan:hunter2']);
      return 'master password removed';
    }

    case 'restart-after-removal': {
      await appLock.start();
      assert.equal(appLock.state().phase, 'ready', 'no master password: opens without a prompt');
      assert.equal(await DM.openWorkspace('default'), 'open');
      assert.equal(await DM.openWorkspace('secret'), 'locked', 'workspace passwords outlive the master password');
      assert.equal(await DM.unlockWorkspaceWithPassword('secret', 'secret-pw-1'), true);
      assert.deepEqual(hosts('secret'), ['prod.example:topsecret']);
      return 'restart after removing the master password ok';
    }

    case 'fresh': {
      await appLock.start();
      assert.equal(appLock.state().phase, 'ready');
      assert.equal(appLock.state().migration, undefined);
      assert.deepEqual(DM.getWorkspaces().map(w => w.id), ['default']);
      assert.equal(await DM.openWorkspace('default'), 'open');
      assert.ok(!keyOpens(path.join(base, 'main.db'), { kind: 'none' }));
      return 'fresh install ok';
    }

    case 'asset-folders': {
      // Folder operations never reach a locked workspace: its key is simply not in memory.
      await appLock.start();
      const plainId = 'plain-folder-smoke';
      DM.createWorkspace({ id: plainId, name: plainId, hasPassword: 0, created_at: 1, updated_at: 1 });
      assert.equal(await DM.openWorkspace(plainId), 'open');
      assert.deepEqual(DM.getAssetFolders(plainId), []);
      DM.createAssetFolder(plainId, 'Projects/Live');
      assert.deepEqual(DM.getAssetFolders(plainId), ['Projects', 'Projects/Live']);

      const id = 'folder-smoke';
      const wsScope = workspaceScope(id);
      DM.createWorkspace({ id, name: id, hasPassword: 0, created_at: 1, updated_at: 1 });
      assert.equal(await DM.openWorkspace(id), 'open');
      await commitAll(await keystore.setPassword(wsScope, 'folder-password'));
      const db = DM.getWorkspaceDb(id)!;
      const insert = db.prepare('INSERT INTO profiles (id, workspace_id, host, username, groupName) VALUES (?, ?, ?, ?, ?)');
      insert.run('db-host', id, 'db.example', 'root', 'Prod/DB');
      insert.run('web-host', id, 'web.example', 'root', 'Prod/Web');
      insert.run('legacy-host', id, 'legacy.example', 'root', ' Ops / DB ');
      insert.run('other-workspace-host', 'another-workspace', 'other.example', 'root', null);
      const group = (profileId: string) => (db.prepare('SELECT groupName FROM profiles WHERE id = ?').get(profileId) as { groupName: string | null }).groupName;

      assert.deepEqual(DM.getAssetFolders(id), [' Ops ', ' Ops / DB ', 'Prod', 'Prod/DB', 'Prod/Web']);
      DM.renameAssetFolder(id, ' Ops ', 'Team');
      assert.equal(group('legacy-host'), 'Team/ DB ');
      DM.createAssetFolder(id, 'Empty/Sub');
      assert.ok(DM.getAssetFolders(id).includes('Empty/Sub'));
      assert.throws(() => DM.createAssetFolder(id, 'Prod//Bad'), /Invalid folder path/);
      assert.throws(() => DM.createAssetFolder(id, '../Bad'), /Invalid folder path/);
      const renamed = DM.renameAssetFolder(id, 'Prod', 'Live');
      assert.deepEqual(renamed.memberships.map(entry => entry.id).sort(), ['db-host', 'web-host']);
      assert.equal(group('db-host'), 'Live/DB');
      DM.createAssetFolder(id, 'Taken');
      assert.throws(() => DM.renameAssetFolder(id, 'Live', 'Taken'), /already exists/i);
      assert.throws(() => DM.removeAssetFolder(id, 'Live'), /child folders/i);
      assert.throws(() => DM.removeAssetFolder(id, 'Live/DB'), /Move hosts/i);
      assert.throws(() => DM.moveProfilesToAssetFolder(id, ['db-host', 'other-workspace-host'], 'Empty/Sub'), /does not exist/i);
      const moved = DM.moveProfilesToAssetFolder(id, ['db-host', 'web-host'], 'Empty/Sub');
      assert.deepEqual(moved.memberships.map(entry => entry.id).sort(), ['db-host', 'web-host']);
      assert.deepEqual(Object.keys(moved.memberships[0]).sort(), ['group', 'id']);
      DM.moveProfilesToAssetFolder(id, ['db-host', 'web-host'], null);
      DM.removeAssetFolder(id, 'Empty/Sub');
      assert.throws(() => DM.moveProfileToAssetFolder(id, 'missing', null), /does not exist/);

      keystore.lockScope(wsScope);
      DM.closeLockedDatabases();
      assert.throws(() => DM.getAssetFolders(id), /locked/i);
      assert.throws(() => DM.createAssetFolder(id, 'Nope'), /locked/i);
      assert.equal(await DM.unlockWorkspaceWithPassword(id, 'wrong-password'), false);
      assert.throws(() => DM.getAssetFolders(id), /locked/i);
      assert.equal(await DM.unlockWorkspaceWithPassword(id, 'folder-password'), true);
      assert.ok(DM.getAssetFolders(id).includes('Taken'), 'folders survive a lock and unlock');
      keystore.lockScope(wsScope);
      DM.closeLockedDatabases();
      const withoutKey = new Database(path.join(base, `workspace_${id}.db`), { readonly: true });
      try {
        assert.throws(() => withoutKey.prepare('SELECT path FROM asset_folders').all(), /encrypted|not a database/i);
      } finally {
        withoutKey.close();
      }
      return 'asset folders respect workspace locks';
    }

    case 'rollback-setup':
      writeLegacyLayout({ corruptDefault: true });
      return 'legacy layout with a damaged workspace written';

    case 'damaged': {
      await appLock.start();
      assert.equal(appLock.state().phase, 'ready', JSON.stringify(appLock.state()));
      assert.deepEqual(appLock.state().migration?.failedWorkspaces, ['default']);
      assert.equal(await DM.unlockWorkspaceWithPassword('secret', 'secret-pw-1'), true);
      assert.deepEqual(hosts('secret'), ['prod.example:topsecret']);
      return 'a damaged workspace does not block the rest';
    }

    case 'rollback-main':
      fs.writeFileSync(path.join(base, 'main.db'), Buffer.alloc(4096, 0x5a));
      fs.writeFileSync(marker('legacy-snapshot.json'), JSON.stringify([...snapshot(base)]));
      return 'damaged main.db written';

    case 'rollback': {
      await appLock.start();
      assert.equal(appLock.state().phase, 'error');
      const before = new Map<string, string>(JSON.parse(fs.readFileSync(marker('legacy-snapshot.json'), 'utf8')));
      const after = snapshot(base);
      for (const [file, content] of before) assert.equal(after.get(file), content, `${file} restored byte for byte`);
      for (const file of after.keys()) {
        assert.ok(before.has(file) || file.startsWith('.keystore-migration-backup') || file === 'keyring.json', `${file} left behind`);
      }
      return 'a failed migration restored every file';
    }
  }
  throw new Error(`unknown phase ${phase}`);
}

app.whenReady().then(run).then(
  message => {
    console.log(`[${phase}] OK ${message}`);
    // A normal quit, not app.exit(): on Windows the safeStorage key lives in Chromium's Local
    // State, which must reach the disk for the next phase to read app_key.enc.
    app.quit();
  },
  error => {
    console.error(`[${phase}] FAILED`, error);
    app.exit(1);
  },
);
