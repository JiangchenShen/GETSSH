import fs from 'node:fs';
import Database from 'better-sqlite3-multiple-ciphers';

/**
 * SQLCipher keys for databases opened with keys from the Rust keystore.
 *
 * Keystore keys are 256 random bits, so they are handed to SQLCipher as raw keys (x'<hex>') and
 * skip the passphrase KDF (about 80 ms per open). Legacy databases were keyed with passphrases:
 * the app key's 64 hex characters, or a workspace password.
 */
export type DatabaseKey =
  | { kind: 'raw'; key: Buffer }
  | { kind: 'passphrase'; passphrase: Buffer }
  | { kind: 'none' };

const HEX = Buffer.from('0123456789abcdef', 'ascii');

/** x'<hex>' as a Buffer, built without an intermediate JS string (strings cannot be wiped). */
export function rawKeyLiteral(key: Buffer): Buffer {
  if (key.length !== 32) throw new Error('SQLCipher raw keys are 32 bytes');
  const out = Buffer.alloc(3 + key.length * 2);
  out[0] = 0x78; // x
  out[1] = 0x27; // '
  for (let i = 0; i < key.length; i++) {
    out[2 + 2 * i] = HEX[key[i] >> 4];
    out[3 + 2 * i] = HEX[key[i] & 0x0f];
  }
  out[out.length - 1] = 0x27;
  return out;
}

function keyMaterial(key: DatabaseKey): Buffer | null {
  switch (key.kind) {
    case 'raw':
      return rawKeyLiteral(key.key);
    case 'passphrase':
      return Buffer.from(key.passphrase);
    case 'none':
      return null;
  }
}

/** Keys an open connection; the temporary buffer is wiped. */
export function applyKey(db: Database.Database, key: DatabaseKey): void {
  const material = keyMaterial(key);
  if (!material) return;
  try {
    db.pragma("cipher = 'sqlcipher'");
    db.key(material);
  } finally {
    material.fill(0);
  }
}

function rekeyConnection(db: Database.Database, key: DatabaseKey): void {
  const material = keyMaterial(key) ?? Buffer.alloc(0);
  try {
    db.pragma("cipher = 'sqlcipher'");
    db.rekey(material);
  } finally {
    material.fill(0);
  }
}

export function wipeKey(key: DatabaseKey): void {
  if (key.kind === 'raw') key.key.fill(0);
  if (key.kind === 'passphrase') key.passphrase.fill(0);
}

/** Opens a database and proves the key works before returning it. */
export function openDatabase(file: string, key: DatabaseKey, options: Database.Options = {}): Database.Database {
  const db = new Database(file, options);
  try {
    applyKey(db, key);
    db.prepare('SELECT count(*) FROM sqlite_master').get();
    return db;
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }
}

/** Whether `key` opens the database (read-only check, nothing is written). */
export function keyOpens(file: string, key: DatabaseKey): boolean {
  if (!fs.existsSync(file)) return false;
  let db: Database.Database | null = null;
  try {
    db = openDatabase(file, key, { readonly: true, fileMustExist: true });
    return true;
  } catch {
    return false;
  } finally {
    try { db?.close(); } catch {}
  }
}

function assertIntegrity(db: Database.Database): void {
  const row = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined;
  if (!row || Object.values(row)[0] !== 'ok') throw new Error('SQLite integrity check failed');
}

/** Row count of every table: a rekeyed copy must match it exactly. */
function tableCounts(db: Database.Database): Map<string, number> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  const counts = new Map<string, number>();
  for (const { name } of tables) {
    const quoted = `"${name.replace(/"/g, '""')}"`;
    counts.set(name, (db.prepare(`SELECT count(*) AS n FROM ${quoted}`).get() as { n: number }).n);
  }
  return counts;
}

function sameCounts(a: Map<string, number>, b: Map<string, number>): boolean {
  return a.size === b.size && [...a].every(([table, count]) => b.get(table) === count);
}

function removeWithSidecars(file: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(file + suffix, { force: true }); } catch {}
  }
}

/**
 * Re-encrypts a database file from `from` to `to` through a verified copy, then atomically
 * replaces the original. The original is untouched until the copy opened with `to` passes an
 * integrity check and has exactly the same row counts. SQLite3 Multiple Ciphers cannot rekey in
 * WAL mode, so the source is checkpointed into DELETE mode first; the result is left in WAL mode.
 */
export function rekeyDatabaseFile(file: string, from: DatabaseKey, to: DatabaseKey): void {
  const temp = `${file}.rekey-${process.pid}-${Date.now()}`;
  let source: Database.Database | null = null;
  let candidate: Database.Database | null = null;
  let verifier: Database.Database | null = null;
  try {
    source = openDatabase(file, from, { fileMustExist: true });
    assertIntegrity(source);
    const expected = tableCounts(source);
    source.pragma('journal_mode = DELETE');
    source.close();
    source = null;

    fs.copyFileSync(file, temp, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temp, 0o600);

    candidate = openDatabase(temp, from, { fileMustExist: true });
    candidate.pragma('journal_mode = DELETE');
    rekeyConnection(candidate, to);
    candidate.close();
    candidate = null;

    verifier = openDatabase(temp, to, { fileMustExist: true });
    assertIntegrity(verifier);
    if (!sameCounts(expected, tableCounts(verifier))) throw new Error('Row counts changed while re-encrypting');
    verifier.pragma('journal_mode = WAL');
    verifier.close();
    verifier = null;

    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(file + suffix, { force: true }); } catch {}
    }
  } catch (error) {
    try { source?.close(); } catch {}
    try { candidate?.close(); } catch {}
    try { verifier?.close(); } catch {}
    removeWithSidecars(temp);
    throw error;
  }
}

/** Changes the key of an open connection in place (DELETE journal during the rekey, then WAL). */
export function rekeyOpenDatabase(db: Database.Database, to: DatabaseKey): void {
  db.pragma('journal_mode = DELETE');
  try {
    rekeyConnection(db, to);
  } finally {
    db.pragma('journal_mode = WAL');
  }
}
