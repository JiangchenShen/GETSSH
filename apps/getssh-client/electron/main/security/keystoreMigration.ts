import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { type DatabaseKey, keyOpens, openDatabase, rekeyDatabaseFile, wipeKey } from './databaseKeys';
import { APP_SCOPE, isKeystoreError, keystore, workspaceScope } from './keystore';
import { readSecretFile } from './secretStore';

/**
 * One-time move of data written by GETSSH before 3.0 into the keystore:
 *
 * - main.db (keyed with the 64-hex app key from app_key.enc / app_key.txt, or still plaintext)
 *   is re-encrypted with the keystore's app key;
 * - workspace databases without a password are encrypted with their own keystore key;
 * - workspace databases keyed with their password get a keystore scope protected by that same
 *   password (read from vault.key) and are re-encrypted with the scope key. Where vault.key is
 *   missing the workspace stays as it is until the owner types the password
 *   (migrateLegacyWorkspace);
 * - app_key.*, vault.key and the leftover getssh.db.migrated are deleted at the end.
 *
 * Every step can run again after a crash: a database is only replaced by a verified copy, and a
 * scope is created before its database is re-encrypted, so the key it needs always exists. Files
 * are copied to a backup directory first and restored if the migration fails.
 */

export interface MigrationReport {
  migratedWorkspaces: string[];
  deferredWorkspaces: string[];
  /** Workspaces that had Touch ID unlock: it has to be switched on again. */
  presenceToReenable: string[];
  /** Workspaces whose database could not be moved (damaged files); left exactly as they were. */
  failedWorkspaces: string[];
}

interface WorkspaceRow {
  id: string;
  hasPassword: number;
  biometric_enabled?: number;
}

const BACKUP_DIR = '.keystore-migration-backup';

export function workspaceDatabasePath(baseDir: string, workspaceId: string): string {
  return path.join(baseDir, `workspace_${workspaceId}.db`);
}

function vaultKeyPath(baseDir: string, workspaceId: string): string {
  return path.join(baseDir, 'workspaces', workspaceId, 'vault.key');
}

/** Whether this installation still has data from before the keystore. */
export function hasLegacyData(baseDir: string): boolean {
  if (['main.db', 'getssh.db', 'app_key.enc', 'app_key.txt'].some(name => fs.existsSync(path.join(baseDir, name)))) return true;
  const workspacesDir = path.join(baseDir, 'workspaces');
  try {
    return fs.readdirSync(workspacesDir).some(id =>
      ['profiles.json', 'runbooks.json', 'ai_chats.json'].some(name => fs.existsSync(path.join(workspacesDir, id, name))));
  } catch {
    return false;
  }
}

/** The key that opens a legacy database now: one of `candidates`, or none for plaintext. */
function currentLegacyKey(file: string, candidates: DatabaseKey[]): DatabaseKey {
  for (const candidate of candidates) {
    if (keyOpens(file, candidate)) return candidate;
  }
  if (keyOpens(file, { kind: 'none' })) return { kind: 'none' };
  throw new Error(`${path.basename(file)} does not open with the legacy key`);
}

function scopeExists(scope: string): boolean {
  return keystore.status().scopes.some(s => s.id === scope);
}

function readLegacyAppKey(baseDir: string): DatabaseKey {
  const encrypted = path.join(baseDir, 'app_key.enc');
  const plain = path.join(baseDir, 'app_key.txt');
  let text: string | null = null;
  if (fs.existsSync(encrypted)) {
    text = readSecretFile(encrypted, (value: string) => /^[0-9a-f]{64}$/i.test(value));
  } else if (fs.existsSync(plain)) {
    text = fs.readFileSync(plain, 'utf8');
  }
  if (!text) return { kind: 'none' };
  return { kind: 'passphrase', passphrase: Buffer.from(text, 'utf8') };
}

function readVaultPassword(baseDir: string, workspaceId: string): string | null {
  const file = vaultKeyPath(baseDir, workspaceId);
  if (!fs.existsSync(file)) return null;
  try {
    return readSecretFile(file);
  } catch (error) {
    console.warn(`[KeystoreMigration] vault.key of ${workspaceId} could not be read:`, error);
    return null;
  }
}

function passphraseKey(password: string): DatabaseKey {
  return { kind: 'passphrase', passphrase: Buffer.from(password, 'utf8') };
}

function scopeKey(scope: string): DatabaseKey {
  return { kind: 'raw', key: keystore.databaseKey(scope) };
}

/** Rekeys `file` to the scope's key unless it already uses it. */
function moveToScopeKey(file: string, scope: string, legacy: DatabaseKey): void {
  if (!fs.existsSync(file)) return;
  const target = scopeKey(scope);
  try {
    if (keyOpens(file, target)) return;
    rekeyDatabaseFile(file, legacy, target);
  } finally {
    wipeKey(target);
  }
}

// ---------------------------------------------------------------------------------------------
// Backup

function backupFiles(baseDir: string): string[] {
  const names = fs.readdirSync(baseDir).filter(name =>
    /^(main|getssh)\.db(-wal|-shm)?$/.test(name) ||
    /^getssh\.db\.migrated(-wal|-shm)?$/.test(name) ||
    /^workspace_.+\.db(-wal|-shm)?$/.test(name) ||
    /^app_key\.(enc|txt)$/.test(name));
  const files = names.map(name => path.join(baseDir, name));
  const workspacesDir = path.join(baseDir, 'workspaces');
  if (fs.existsSync(workspacesDir)) {
    for (const id of fs.readdirSync(workspacesDir)) {
      const vault = path.join(workspacesDir, id, 'vault.key');
      if (fs.existsSync(vault)) files.push(vault);
    }
  }
  return files;
}

function backupPath(baseDir: string, file: string): string {
  return path.join(baseDir, BACKUP_DIR, path.relative(baseDir, file));
}

/** Copies every legacy file once; files already in the backup (an earlier attempt) are kept. */
function takeBackup(baseDir: string): void {
  fs.mkdirSync(path.join(baseDir, BACKUP_DIR), { recursive: true, mode: 0o700 });
  for (const file of backupFiles(baseDir)) {
    const target = backupPath(baseDir, file);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o600);
  }
}

function restoreBackup(baseDir: string): void {
  const root = path.join(baseDir, BACKUP_DIR);
  if (!fs.existsSync(root)) return;
  // A restored database must not meet a WAL or SHM file from the failed attempt (written with
  // another key, for a newer version of the file): SQLite would replay it into the old one.
  for (const name of fs.readdirSync(baseDir)) {
    const sidecar = /^(.+\.db(?:\.migrated)?)-(wal|shm|journal)$/.exec(name);
    if (sidecar && fs.existsSync(path.join(root, sidecar[1])) && !fs.existsSync(path.join(root, name))) {
      fs.rmSync(path.join(baseDir, name), { force: true });
    }
  }
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const source = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(source);
        continue;
      }
      const target = path.join(baseDir, path.relative(root, source));
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.copyFileSync(source, target);
    }
  };
  walk(root);
}

function dropBackup(baseDir: string): void {
  fs.rmSync(path.join(baseDir, BACKUP_DIR), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------

function readWorkspaceRows(mainDbPath: string): WorkspaceRow[] {
  const key = scopeKey(APP_SCOPE);
  let db: Database.Database | null = null;
  try {
    db = openDatabase(mainDbPath, key, { readonly: true, fileMustExist: true });
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'").get();
    if (!hasTable) return [];
    const columns = (db.prepare('PRAGMA table_info(workspaces)').all() as { name: string }[]).map(c => c.name);
    const biometric = columns.includes('biometric_enabled') ? ', biometric_enabled' : '';
    return db.prepare(`SELECT id, hasPassword${biometric} FROM workspaces`).all() as WorkspaceRow[];
  } finally {
    try { db?.close(); } catch {}
    wipeKey(key);
  }
}

function updateWorkspaceFlags(mainDbPath: string, changes: { id: string; hasPassword: number; biometric: number }[]): void {
  if (changes.length === 0) return;
  const key = scopeKey(APP_SCOPE);
  let db: Database.Database | null = null;
  try {
    db = openDatabase(mainDbPath, key, { fileMustExist: true });
    const update = db.prepare('UPDATE workspaces SET hasPassword = ?, biometric_enabled = ? WHERE id = ?');
    db.transaction(() => {
      for (const change of changes) update.run(change.hasPassword, change.biometric, change.id);
    })();
  } finally {
    try { db?.close(); } catch {}
    wipeKey(key);
  }
}

async function migrateWorkspace(baseDir: string, row: WorkspaceRow, report: MigrationReport): Promise<{ hasPassword: number } | null> {
  const scope = workspaceScope(row.id);
  const file = workspaceDatabasePath(baseDir, row.id);
  if (!row.hasPassword) {
    if (!scopeExists(scope)) await keystore.createScope(scope);
    else await keystore.openScope(scope);
    moveToScopeKey(file, scope, { kind: 'none' });
    report.migratedWorkspaces.push(row.id);
    return { hasPassword: 0 };
  }

  const password = readVaultPassword(baseDir, row.id);
  if (password === null) {
    report.deferredWorkspaces.push(row.id);
    return null;
  }
  const legacy = passphraseKey(password);
  try {
    if (!scopeExists(scope)) {
      if (fs.existsSync(file) && !keyOpens(file, legacy)) {
        // vault.key does not match the database: leave it for the owner to unlock by hand.
        report.deferredWorkspaces.push(row.id);
        return null;
      }
      await keystore.createScopeWithLegacyPassword(scope, password);
    } else {
      await keystore.unlockWithPassword(scope, password);
    }
    moveToScopeKey(file, scope, legacy);
  } finally {
    wipeKey(legacy);
  }
  if (row.biometric_enabled) report.presenceToReenable.push(row.id);
  report.migratedWorkspaces.push(row.id);
  return { hasPassword: 1 };
}

/**
 * Runs the migration. `prepareLegacyMainDatabase` brings main.db up to date with the legacy key
 * (fission of getssh.db, JSON import, plaintext upgrade) and closes it again.
 */
export async function migrateLegacyData(
  baseDir: string,
  prepareLegacyMainDatabase: (legacyKey: Buffer | null) => void,
): Promise<MigrationReport> {
  const report: MigrationReport = { migratedWorkspaces: [], deferredWorkspaces: [], presenceToReenable: [], failedWorkspaces: [] };
  takeBackup(baseDir);
  const legacyAppKey = readLegacyAppKey(baseDir);
  try {
    if (!keystore.status().initialized) await keystore.initialize();
    await keystore.openScope(APP_SCOPE);

    const mainDbPath = path.join(baseDir, 'main.db');
    const appKey = scopeKey(APP_SCOPE);
    const alreadyMoved = keyOpens(mainDbPath, appKey);
    wipeKey(appKey);
    if (!alreadyMoved) {
      prepareLegacyMainDatabase(legacyAppKey.kind === 'passphrase' ? Buffer.from(legacyAppKey.passphrase) : null);
      moveToScopeKey(mainDbPath, APP_SCOPE, currentLegacyKey(mainDbPath, legacyAppKey.kind === 'none' ? [] : [legacyAppKey]));
    }

    const flags: { id: string; hasPassword: number; biometric: number }[] = [];
    for (const row of readWorkspaceRows(mainDbPath)) {
      // One damaged workspace must not keep GETSSH from starting: it stays as it was.
      try {
        const outcome = await migrateWorkspace(baseDir, row, report);
        if (outcome) flags.push({ id: row.id, hasPassword: outcome.hasPassword, biometric: 0 });
      } catch (error) {
        console.error(`[KeystoreMigration] Workspace ${row.id} could not be moved; it is left unchanged:`, error);
        report.failedWorkspaces.push(row.id);
      }
    }
    updateWorkspaceFlags(mainDbPath, flags);

    for (const id of report.migratedWorkspaces) {
      fs.rmSync(vaultKeyPath(baseDir, id), { force: true });
    }
    for (const name of ['app_key.enc', 'app_key.txt', 'getssh.db.migrated', 'getssh.db.migrated-wal', 'getssh.db.migrated-shm']) {
      fs.rmSync(path.join(baseDir, name), { force: true });
    }
    // Migrated workspaces are protected by the keystore now; locked ones get keys only when unlocked.
    keystore.lockProtected();
    dropBackup(baseDir);
    return report;
  } catch (error) {
    console.error('[KeystoreMigration] Migration failed; restoring the previous files:', error);
    try {
      restoreBackup(baseDir);
    } catch (restoreError) {
      console.error('[KeystoreMigration] Restoring the backup failed:', restoreError);
    }
    throw error;
  } finally {
    wipeKey(legacyAppKey);
  }
}

/**
 * A workspace left behind by the migration (its password was not in vault.key) moves to the
 * keystore the first time the owner types that password. Returns false for a wrong password.
 */
export async function migrateLegacyWorkspace(baseDir: string, workspaceId: string, password: string): Promise<boolean> {
  const scope = workspaceScope(workspaceId);
  const file = workspaceDatabasePath(baseDir, workspaceId);
  const legacy = passphraseKey(password);
  try {
    if (scopeExists(scope)) {
      try {
        await keystore.unlockWithPassword(scope, password);
      } catch (error) {
        if (isKeystoreError(error, 'wrong_password')) return false;
        throw error;
      }
    } else {
      if (fs.existsSync(file) && !keyOpens(file, legacy)) return false;
      await keystore.createScopeWithLegacyPassword(scope, password);
    }
    moveToScopeKey(file, scope, legacy);
    fs.rmSync(vaultKeyPath(path.dirname(file), workspaceId), { force: true });
    return true;
  } finally {
    wipeKey(legacy);
  }
}
