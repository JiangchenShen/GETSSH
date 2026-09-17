'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const Database = require('better-sqlite3-multiple-ciphers');

function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-db-key-'));
  const dbPath = path.join(tempDir, 'quoted-key.db');
  const attachedDbPath = path.join(tempDir, "import'ed.db");
  const legacyPlaintextPath = path.join(tempDir, 'legacy-plaintext.db');
  const encryptedCandidatePath = path.join(tempDir, 'legacy-plaintext.db.encrypting');
  const firstKey = Buffer.from("a'quoted-key-123", 'utf8');
  const secondKey = Buffer.from("second'quoted-key-456", 'utf8');

  try {
    let db = new Database(dbPath);
    db.pragma("cipher = 'sqlcipher'");
    db.key(firstKey);
    db.exec("CREATE TABLE secret (value TEXT); INSERT INTO secret VALUES ('ok')");
    db.exec('CREATE TABLE ai_memory_vectors (message_id TEXT PRIMARY KEY, embedding BLOB NOT NULL)');
    db.prepare('INSERT INTO ai_memory_vectors VALUES (?, ?)').run('message-1', Buffer.alloc(384 * 4, 7));
    db.close();

    db = new Database(dbPath);
    let rejectedWithoutKey = false;
    try {
      db.prepare('SELECT embedding FROM ai_memory_vectors').get();
    } catch {
      rejectedWithoutKey = true;
    } finally {
      db.close();
    }
    if (!rejectedWithoutKey) {
      throw new Error('local-memory vector table was readable without the SQLCipher key');
    }

    db = new Database(dbPath);
    db.pragma("cipher = 'sqlcipher'");
    db.key(firstKey);
    if (db.prepare('SELECT value FROM secret').get().value !== 'ok') {
      throw new Error('reading with the original key failed');
    }
    if (db.prepare('SELECT length(embedding) AS size FROM ai_memory_vectors').get().size !== 384 * 4) {
      throw new Error('encrypted local-memory vector was not preserved');
    }
    db.rekey(secondKey);
    db.close();

    db = new Database(dbPath);
    db.pragma("cipher = 'sqlcipher'");
    db.key(secondKey);
    if (db.prepare('SELECT value FROM secret').get().value !== 'ok') {
      throw new Error('reading after rekey failed');
    }
    db.rekey(Buffer.alloc(0));
    db.close();

    db = new Database(dbPath);
    if (db.prepare('SELECT value FROM secret').get().value !== 'ok') {
      throw new Error('reading after removing encryption failed');
    }

    const attachedDb = new Database(attachedDbPath);
    attachedDb.exec("CREATE TABLE imported_value (value TEXT); INSERT INTO imported_value VALUES ('attached')");
    attachedDb.close();
    db.prepare('ATTACH DATABASE ? AS imported').run(attachedDbPath);
    if (db.prepare('SELECT value FROM imported.imported_value').get().value !== 'attached') {
      throw new Error('parameterized database attachment failed');
    }
    db.exec('DETACH DATABASE imported');
    db.close();

    // A V3 preview could leave main.db plaintext before app-key encryption was
    // enabled. Exercise the production migration shape: checkpoint, copy,
    // encrypt the copy, verify it with the app key, then atomically replace.
    let legacyDb = new Database(legacyPlaintextPath);
    legacyDb.pragma('journal_mode = WAL');
    legacyDb.exec("CREATE TABLE workspaces (id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES ('preserved')");
    legacyDb.pragma('journal_mode = DELETE');
    legacyDb.close();

    fs.copyFileSync(legacyPlaintextPath, encryptedCandidatePath, fs.constants.COPYFILE_EXCL);
    let candidateDb = new Database(encryptedCandidatePath);
    candidateDb.pragma("cipher = 'sqlcipher'");
    candidateDb.rekey(firstKey);
    if (candidateDb.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
      throw new Error('legacy plaintext candidate failed integrity verification');
    }
    candidateDb.close();

    candidateDb = new Database(encryptedCandidatePath, { readonly: true, fileMustExist: true });
    candidateDb.pragma("cipher = 'sqlcipher'");
    candidateDb.key(firstKey);
    if (candidateDb.prepare('SELECT count(*) AS count FROM workspaces').get().count !== 1) {
      throw new Error('legacy plaintext data was not preserved in the encrypted candidate');
    }
    candidateDb.close();

    fs.renameSync(encryptedCandidatePath, legacyPlaintextPath);
    legacyDb = new Database(legacyPlaintextPath, { readonly: true, fileMustExist: true });
    legacyDb.pragma("cipher = 'sqlcipher'");
    legacyDb.key(firstKey);
    if (legacyDb.prepare('SELECT id FROM workspaces').get().id !== 'preserved') {
      throw new Error('legacy plaintext data was not preserved after atomic replacement');
    }
    legacyDb.close();

    legacyDb = new Database(legacyPlaintextPath, { readonly: true, fileMustExist: true });
    let migratedDbRejectedWithoutKey = false;
    try {
      legacyDb.prepare('SELECT id FROM workspaces').get();
    } catch {
      migratedDbRejectedWithoutKey = true;
    } finally {
      legacyDb.close();
    }
    if (!migratedDbRejectedWithoutKey) {
      throw new Error('migrated legacy database was readable without the app key');
    }

    console.log('database key/rekey smoke passed');
    app.exit(0);
  } catch (error) {
    console.error(`database key/rekey smoke failed: ${error.message || error}`);
    app.exit(1);
  } finally {
    firstKey.fill(0);
    secondKey.fill(0);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

app.whenReady().then(run).catch((error) => {
  console.error(`database key/rekey smoke failed: ${error.message || error}`);
  app.exit(1);
});
