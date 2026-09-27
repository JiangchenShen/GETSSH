'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { app } = require('electron');
const Database = require('better-sqlite3-multiple-ciphers');
const ts = require('typescript');

function loadDatabaseManager() {
  const source = path.resolve(__dirname, '../../electron/main/services/DatabaseManager.ts');
  const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  });
  const loaded = new Module(source, module);
  loaded.filename = source;
  loaded.paths = Module._nodeModulePaths(path.dirname(source));
  loaded._compile(compiled.outputText, source);
  return loaded.exports.DatabaseManager;
}

function expectError(action, pattern) {
  assert.throws(action, pattern);
}

function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-folders-'));
  const workspaceId = 'folder-smoke';
  const dbPath = path.join(tempDir, `workspace_${workspaceId}.db`);
  const key = Buffer.from('temporary-test-folder-key', 'utf8');
  const DatabaseManager = loadDatabaseManager();
  let db;
  let mainDb;
  try {
    expectError(() => DatabaseManager.getAssetFolders(workspaceId), /locked/i);
    mainDb = new Database(':memory:');
    mainDb.exec('CREATE TABLE workspaces (id TEXT PRIMARY KEY, hasPassword INTEGER NOT NULL)');
    mainDb.prepare('INSERT INTO workspaces VALUES (?, ?)').run(workspaceId, 1);
    DatabaseManager.mainDb = mainDb;
    DatabaseManager.baseDir = tempDir;
    const plainWorkspaceId = 'plain-folder-smoke';
    mainDb.prepare('INSERT INTO workspaces VALUES (?, ?)').run(plainWorkspaceId, 0);
    assert.deepEqual(DatabaseManager.getAssetFolders(plainWorkspaceId), []);
    DatabaseManager.createAssetFolder(plainWorkspaceId, 'Projects/Live');
    assert.deepEqual(DatabaseManager.getAssetFolders(plainWorkspaceId), ['Projects', 'Projects/Live']);
    DatabaseManager.unmountWorkspace(plainWorkspaceId);
    db = new Database(dbPath);
    db.pragma("cipher = 'sqlcipher'");
    db.key(key);
    DatabaseManager.runWorkspaceMigrations(db);
    DatabaseManager.workspaceDbs.set(workspaceId, db);
    expectError(() => DatabaseManager.getAssetFolders(workspaceId), /locked/i);
    DatabaseManager.markAssetFolderWorkspaceUnlocked(workspaceId);
    const insert = db.prepare('INSERT INTO profiles (id, workspace_id, host, username, groupName) VALUES (?, ?, ?, ?, ?)');
    insert.run('db-host', workspaceId, 'db.example', 'root', 'Prod/DB');
    insert.run('web-host', workspaceId, 'web.example', 'root', 'Prod/Web');
    insert.run('legacy-host', workspaceId, 'legacy.example', 'root', ' Ops / DB ');
    insert.run('other-workspace-host', 'another-workspace', 'other.example', 'root', null);

    assert.deepEqual(DatabaseManager.getAssetFolders(workspaceId), [' Ops ', ' Ops / DB ', 'Prod', 'Prod/DB', 'Prod/Web']);
    DatabaseManager.renameAssetFolder(workspaceId, ' Ops ', 'Team');
    assert.equal(db.prepare('SELECT groupName FROM profiles WHERE id = ?').get('legacy-host').groupName, 'Team/ DB ');
    DatabaseManager.createAssetFolder(workspaceId, 'Empty/Sub');
    assert(DatabaseManager.getAssetFolders(workspaceId).includes('Empty/Sub'));
    expectError(() => DatabaseManager.createAssetFolder(workspaceId, 'Prod//Bad'), /Invalid folder path/);
    expectError(() => DatabaseManager.createAssetFolder(workspaceId, '../Bad'), /Invalid folder path/);

    const renamed = DatabaseManager.renameAssetFolder(workspaceId, 'Prod', 'Live');
    assert.deepEqual(renamed.memberships.map(entry => entry.id).sort(), ['db-host', 'web-host']);
    assert(!('profiles' in renamed));
    assert.equal(db.prepare('SELECT groupName FROM profiles WHERE id = ?').get('db-host').groupName, 'Live/DB');
    assert.equal(db.prepare('SELECT groupName FROM profiles WHERE id = ?').get('web-host').groupName, 'Live/Web');
    assert(!DatabaseManager.getAssetFolders(workspaceId).includes('Prod'));
    DatabaseManager.createAssetFolder(workspaceId, 'Taken');
    expectError(() => DatabaseManager.renameAssetFolder(workspaceId, 'Live', 'Taken'), /already exists/i);
    assert.equal(db.prepare('SELECT groupName FROM profiles WHERE id = ?').get('db-host').groupName, 'Live/DB');
    expectError(() => DatabaseManager.removeAssetFolder(workspaceId, 'Live'), /child folders/i);
    expectError(() => DatabaseManager.removeAssetFolder(workspaceId, 'Live/DB'), /Move hosts/i);

    expectError(() => DatabaseManager.moveProfilesToAssetFolder(workspaceId, ['db-host', 'other-workspace-host'], 'Empty/Sub'), /does not exist/i);
    assert.equal(db.prepare('SELECT groupName FROM profiles WHERE id = ?').get('db-host').groupName, 'Live/DB');
    const moved = DatabaseManager.moveProfilesToAssetFolder(workspaceId, ['db-host', 'web-host'], 'Empty/Sub');
    assert.deepEqual(moved.memberships.map(entry => entry.id).sort(), ['db-host', 'web-host']);
    assert.equal(db.prepare('SELECT groupName FROM profiles WHERE id = ?').get('db-host').groupName, 'Empty/Sub');
    assert.equal(db.prepare('SELECT groupName FROM profiles WHERE id = ?').get('web-host').groupName, 'Empty/Sub');
    expectError(() => DatabaseManager.removeAssetFolder(workspaceId, 'Empty/Sub'), /Move hosts/i);
    DatabaseManager.moveProfilesToAssetFolder(workspaceId, ['db-host', 'web-host'], null);
    DatabaseManager.removeAssetFolder(workspaceId, 'Empty/Sub');
    assert(!DatabaseManager.getAssetFolders(workspaceId).includes('Empty/Sub'));
    expectError(() => DatabaseManager.moveProfileToAssetFolder(workspaceId, 'missing', null), /does not exist/);

    assert.deepEqual(Object.keys(moved.memberships[0]).sort(), ['group', 'id']);
    DatabaseManager.resetAssetFolderUnlocks();
    expectError(() => DatabaseManager.getAssetFolders(workspaceId), /locked/i);
    DatabaseManager.unmountWorkspace(workspaceId);
    db = undefined;
    assert.equal(DatabaseManager.mountWorkspace(workspaceId, 'wrong-password'), false);
    assert.equal(DatabaseManager.mountWorkspace(workspaceId, key.toString('utf8')), true);
    expectError(() => DatabaseManager.getAssetFolders(workspaceId), /locked/i);
    DatabaseManager.markAssetFolderWorkspaceUnlocked(workspaceId);
    db = DatabaseManager.workspaceDbs.get(workspaceId);
    DatabaseManager.unmountWorkspace(workspaceId);
    db = undefined;
    assert.equal(DatabaseManager.mountWorkspace(workspaceId, key.toString('utf8')), true);
    expectError(() => DatabaseManager.getAssetFolders(workspaceId), /locked/i);
    DatabaseManager.markAssetFolderWorkspaceUnlocked(workspaceId);
    db = DatabaseManager.workspaceDbs.get(workspaceId);

    DatabaseManager.workspaceDbs.delete(workspaceId);
    DatabaseManager.resetAssetFolderUnlocks();
    expectError(() => DatabaseManager.getAssetFolders(workspaceId), /locked/i);
    db.close();
    db = undefined;
    const withoutKey = new Database(dbPath, { readonly: true });
    try { expectError(() => withoutKey.prepare('SELECT path FROM asset_folders').all(), /encrypted|not a database/i); }
    finally { withoutKey.close(); }
    console.log('asset folder SQLCipher smoke passed');
    app.exit(0);
  } catch (error) {
    console.error('asset folder SQLCipher smoke failed:', error);
    app.exit(1);
  } finally {
    DatabaseManager.workspaceDbs.delete(workspaceId);
    DatabaseManager.resetAssetFolderUnlocks();
    DatabaseManager.mainDb = null;
    try { db?.close(); } catch {}
    try { mainDb?.close(); } catch {}
    key.fill(0);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

app.whenReady().then(run).catch(error => {
  console.error('asset folder SQLCipher smoke failed:', error);
  app.exit(1);
});
