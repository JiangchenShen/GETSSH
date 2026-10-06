// Writes the golden databases of GETSSH 3.0 development builds with
// better-sqlite3-multiple-ciphers, the engine those builds used, for the Rust test
// legacy_tests::databases_written_by_better_sqlite3_migrate. Run it from apps/getssh-client so
// the app's installed version is used:
//
//   node ../../rust-core/getssh-store/tests/fixtures/legacy-bsmc/make-fixtures.cjs <empty dir>
//
// then copy the files from <empty dir> next to this script. Keys and contents are the ones the
// keystore e2e test uses (scripts/security/keystore-e2e/entry.ts writeLegacyLayout).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const Database = require(require.resolve('better-sqlite3-multiple-ciphers', { paths: [process.cwd()] }));
const out = process.argv[2];
if (!out || !path.isAbsolute(out) || fs.readdirSync(out).length) {
  console.error('usage: make-fixtures.cjs <absolute path of an empty directory>');
  process.exit(2);
}

const APP_KEY = 'ab'.repeat(32);

/** Opens a database the way those builds did: cipher 'sqlcipher', then the passphrase. */
function open(name, passphrase) {
  const db = new Database(path.join(out, name));
  if (passphrase) {
    db.pragma("cipher = 'sqlcipher'");
    db.key(Buffer.from(passphrase, 'utf8'));
  }
  db.pragma('journal_mode = WAL');
  return db;
}

// legacyDatabase.ts runMainMigrations
const MAIN = `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, themeColor TEXT, hasPassword INTEGER DEFAULT 0,
    biometric_enabled INTEGER DEFAULT 0, is_main INTEGER DEFAULT 0, preferences TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS global_settings (key TEXT PRIMARY KEY, value TEXT);`;

// The profiles table of legacyDatabase.ts runWorkspaceMigrations. The other tables are left out
// to keep the files small; the store creates them when it mounts a workspace.
const WORKSPACE = `
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, host TEXT NOT NULL, username TEXT NOT NULL,
    password TEXT, privateKeyPath TEXT, passphrase TEXT, port INTEGER DEFAULT 22,
    autoStart INTEGER DEFAULT 0, alias TEXT, osType TEXT);`;

// DatabaseManager.ts of e65aed4 (getssh.db), with the is_main column added later.
const GETSSH = `
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, themeColor TEXT, hasPassword INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE profiles (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, host TEXT NOT NULL, username TEXT NOT NULL,
    password TEXT, privateKeyPath TEXT, port INTEGER DEFAULT 22, autoStart INTEGER DEFAULT 0,
    alias TEXT, osType TEXT, FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE);
  CREATE TABLE runbooks (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, script TEXT NOT NULL,
    riskLevel TEXT DEFAULT 'LOW', created_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE);
  CREATE TABLE ai_sessions (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE);
  CREATE TABLE ai_messages (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
    raw_content TEXT, timestamp INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE);
  ALTER TABLE workspaces ADD COLUMN is_main INTEGER DEFAULT 0;`;

const insertProfile = 'INSERT INTO profiles (id, workspace_id, host, username, password, port, autoStart) VALUES (?, ?, ?, ?, ?, ?, ?)';

let db = open('main.db', APP_KEY);
db.exec(MAIN);
const insertWorkspace = db.prepare('INSERT INTO workspaces (id, name, hasPassword, biometric_enabled, is_main, preferences, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
insertWorkspace.run('default', 'Default Workspace', 0, 0, 1, '{}', 1, 1);
insertWorkspace.run('secret', 'Secret', 1, 1, 0, '{}', 2, 2);
db.prepare('INSERT INTO global_settings (key, value) VALUES (?, ?)').run('language', 'zh-CN');
db.close();

db = open('workspace_default.db', null);
db.exec(WORKSPACE);
db.prepare(insertProfile).run('p1', 'default', 'router.lan', 'root', 'hunter2', 22, 0);
db.close();

db = open('workspace_secret.db', 'secret-pw-1');
db.exec(WORKSPACE);
db.prepare(insertProfile).run('p2', 'secret', 'prod.example', 'admin', 'topsecret', 2222, 1);
db.close();

db = open('getssh.db', APP_KEY);
db.exec(GETSSH);
db.prepare('INSERT INTO workspaces (id, name, themeColor, hasPassword, created_at, updated_at, is_main) VALUES (?, ?, ?, ?, ?, ?, ?)').run('default', 'Default Workspace', '#1e293b', 0, 1, 1, 1);
db.prepare('INSERT INTO workspaces (id, name, themeColor, hasPassword, created_at, updated_at, is_main) VALUES (?, ?, ?, ?, ?, ?, ?)').run('team', 'Team', null, 0, 2, 2, 0);
db.prepare('INSERT INTO profiles (id, workspace_id, host, username, password, port, autoStart, alias) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('p1', 'default', 'router.lan', 'root', 'hunter2', 22, 1, 'Router');
db.prepare('INSERT INTO profiles (id, workspace_id, host, username, password, port, autoStart, alias) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('p2', 'team', 'db.internal', 'admin', 'dbpass', 5432, 0, null);
db.prepare('INSERT INTO runbooks (id, workspace_id, title, script, riskLevel, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('r1', 'team', 'Restart', 'systemctl restart app', 'HIGH', 5);
db.prepare('INSERT INTO ai_sessions (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'default', 'Chat', 3, 4);
db.prepare('INSERT INTO ai_messages (id, session_id, role, content, raw_content, timestamp) VALUES (?, ?, ?, ?, ?, ?)').run('m1', 's1', 'user', 'hello', null, 3);
db.prepare('INSERT INTO ai_messages (id, session_id, role, content, raw_content, timestamp) VALUES (?, ?, ?, ?, ?, ?)').run('m2', 's1', 'assistant', 'hi', 'raw hi', 4);
db.close();

const probe = new Database(':memory:');
const versions = {
  'better-sqlite3-multiple-ciphers': require(require.resolve('better-sqlite3-multiple-ciphers/package.json', { paths: [process.cwd()] })).version,
  sqlite: probe.prepare('SELECT sqlite_version() AS v').get().v,
  node: process.versions.node,
};
probe.close();
fs.writeFileSync(path.join(out, 'versions.json'), `${JSON.stringify(versions, null, 2)}\n`);
console.log(fs.readdirSync(out).join(' '), versions);
