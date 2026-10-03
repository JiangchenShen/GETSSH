import Database from 'better-sqlite3-multiple-ciphers';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { type DatabaseKey, openDatabase } from './databaseKeys';

/**
 * The part of the GETSSH 2.x migration that still runs on better-sqlite3-multiple-ciphers: before
 * keystoreMigration.ts moves main.db to the keystore key, main.db is brought up to date under its
 * legacy key (the getssh.db "fission" into main.db + workspace_<id>.db, the JSON import of even
 * older installs, missing columns). getssh-store takes over every database afterwards. Removed in
 * step S6, when Rust opens the legacy databases itself.
 *
 * Nothing here runs while getssh-store has a database open: appLock calls it before
 * configureStore().
 */

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'utf8');

function isPlaintextSqliteDatabase(dbPath: string): boolean {
  if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size < SQLITE_HEADER.length) return false;
  const fd = fs.openSync(dbPath, 'r');
  const header = Buffer.alloc(SQLITE_HEADER.length);
  try {
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    return bytesRead === header.length && header.equals(SQLITE_HEADER);
  } finally {
    header.fill(0);
    fs.closeSync(fd);
  }
}

/**
 * Brings a pre-3.0 main.db up to date under its legacy key (fission of getssh.db, JSON import)
 * and closes it again; the keystore migration then moves it to the keystore key.
 */
export function prepareLegacyMainDatabase(baseDir: string, legacyKey: Buffer | null): void {
  fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  const mainDbPath = path.join(baseDir, 'main.db');
  const legacyDbPath = path.join(baseDir, 'getssh.db');
  const needsFissionMigration = !fs.existsSync(mainDbPath) && fs.existsSync(legacyDbPath);
  if (needsFissionMigration) {
    console.log('[LegacyDatabase] Legacy getssh.db detected. Starting Fission Migration...');
    performFissionMigration(baseDir, legacyDbPath, mainDbPath, legacyKey);
  }
  const key: DatabaseKey = legacyKey && !isPlaintextSqliteDatabase(mainDbPath)
    ? { kind: 'passphrase', passphrase: legacyKey }
    : { kind: 'none' };
  const mainDb = key.kind === 'none' ? new Database(mainDbPath) : openDatabase(mainDbPath, key);
  try {
    runMainMigrations(mainDb);
    if (!needsFissionMigration && !fs.existsSync(legacyDbPath)) {
      migrateLegacyJsonData(baseDir, mainDb);
    }
  } finally {
    try { mainDb.close(); } catch {}
    if (legacyKey) legacyKey.fill(0);
  }
}

function insertWorkspace(db: Database.Database, ws: { id: string; name: string; is_main: number; created_at: number; updated_at: number }): void {
  db.prepare('INSERT INTO workspaces (id, name, themeColor, hasPassword, biometric_enabled, is_main, preferences, created_at, updated_at) VALUES (?, ?, NULL, 0, 0, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
    .run(ws.id, ws.name, ws.is_main, '{}', ws.created_at, ws.updated_at);
}

function performFissionMigration(baseDir: string, legacyPath: string, mainPath: string, appKeyBuffer: Buffer | null) {
  // Every handle is closed before getssh-store opens these files, whatever happens here.
  const open: Database.Database[] = [];
  const track = (db: Database.Database) => { open.push(db); return db; };
  try {
    // Open legacy DB (assuming it was encrypted with AppKey from previous step if it existed)
    const legacyDb = track(new Database(legacyPath));
    if (appKeyBuffer) {
      legacyDb.pragma(`cipher = 'sqlcipher'`);
      legacyDb.key(appKeyBuffer);
    }

    // Check if it's readable
    legacyDb.prepare('SELECT 1 FROM workspaces LIMIT 1').get();

    // Create new main DB
    const mainDb = track(new Database(mainPath));
    if (appKeyBuffer) {
      mainDb.pragma(`cipher = 'sqlcipher'`);
      mainDb.key(appKeyBuffer);
    }
    runMainMigrations(mainDb);

    // Migrate Workspaces
    const workspaces = legacyDb.prepare('SELECT * FROM workspaces').all() as any[];
    const insertWs = mainDb.prepare('INSERT INTO workspaces (id, name, themeColor, hasPassword, is_main, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');

    for (const ws of workspaces) {
      insertWs.run(ws.id, ws.name, ws.themeColor, ws.hasPassword, ws.is_main, ws.created_at, ws.updated_at);

      // The old database had no workspace passwords: every workspace database starts plaintext and
      // the keystore migration encrypts it. Passwords are copied as they are.
      const wsDbPath = path.join(baseDir, `workspace_${ws.id}.db`);
      const wsDb = track(new Database(wsDbPath));
      runWorkspaceMigrations(wsDb);

      const profiles = legacyDb.prepare('SELECT * FROM profiles WHERE workspace_id = ?').all(ws.id) as any[];
      const insertProfile = wsDb.prepare(`INSERT INTO profiles (id, workspace_id, host, username, password, privateKeyPath, passphrase, port, autoStart, alias, osType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const p of profiles) {
        insertProfile.run(p.id, p.workspace_id, p.host, p.username, p.password, p.privateKeyPath, p.passphrase, p.port, p.autoStart, p.alias, p.osType);
      }

      const runbooks = legacyDb.prepare('SELECT * FROM runbooks WHERE workspace_id = ?').all(ws.id) as any[];
      const insertRb = wsDb.prepare(`INSERT INTO runbooks (id, workspace_id, title, script, riskLevel, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const rb of runbooks) {
        insertRb.run(rb.id, rb.workspace_id, rb.title, rb.script, rb.riskLevel, rb.created_at);
      }

      const sessions = legacyDb.prepare('SELECT * FROM ai_sessions WHERE workspace_id = ?').all(ws.id) as any[];
      const insertSess = wsDb.prepare(`INSERT INTO ai_sessions (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`);
      const insertMsg = wsDb.prepare(`INSERT INTO ai_messages (id, session_id, role, content, raw_content, timestamp) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const s of sessions) {
        insertSess.run(s.id, s.workspace_id, s.title, s.created_at, s.updated_at);
        const messages = legacyDb.prepare('SELECT * FROM ai_messages WHERE session_id = ?').all(s.id) as any[];
        for (const m of messages) {
          insertMsg.run(m.id, m.session_id, m.role, m.content, m.raw_content, m.timestamp);
        }
      }

    }

    for (const db of open.splice(0)) db.close();
    // Rename legacy db to avoid re-migration
    fs.renameSync(legacyPath, legacyPath + '.migrated');
    console.log('[LegacyDatabase] Fission Migration successful.');
  } catch (e) {
    console.error('[LegacyDatabase] Fission Migration failed:', e);
  } finally {
    for (const db of open) {
      try { db.close(); } catch {}
    }
  }
}

function migrateLegacyJsonData(baseDir: string, mainDb: Database.Database) {
  const workspacesCount = mainDb.prepare('SELECT COUNT(*) as c FROM workspaces').get() as { c: number };
  if (workspacesCount.c > 0) return; // Already initialized

  console.log('[LegacyDatabase] Starting JSON to SQLite Migration...');
  const now = Date.now();
  try {
    const configPath = path.join(baseDir, 'app-config.json');
    let defaultWorkspaceId = 'default';
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        defaultWorkspaceId = config.active_workspace || 'default';
      } catch {}
    }

    const workspacesDir = path.join(baseDir, 'workspaces');
    if (!fs.existsSync(workspacesDir)) {
      insertWorkspace(mainDb, { id: 'default', name: 'Default Workspace', is_main: 1, created_at: now, updated_at: now });
      return;
    }

    for (const id of fs.readdirSync(workspacesDir)) {
      const wsPath = path.join(workspacesDir, id);
      if (!fs.statSync(wsPath).isDirectory()) continue;
      insertWorkspace(mainDb, { id, name: id === 'default' ? 'Default Workspace' : id, is_main: id === defaultWorkspaceId ? 1 : 0, created_at: now, updated_at: now });

      // A plaintext workspace database; the keystore migration encrypts it right after.
      const wsDb = new Database(path.join(baseDir, `workspace_${id}.db`));
      try {
        runWorkspaceMigrations(wsDb);

        const plainPath = path.join(wsPath, 'profiles.json');
        if (fs.existsSync(plainPath)) {
          try {
            const profiles = JSON.parse(fs.readFileSync(plainPath, 'utf-8'));
            const insertProfile = wsDb.prepare(`INSERT INTO profiles (id, workspace_id, host, username, password, privateKeyPath, passphrase, port, autoStart, alias, osType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const p of profiles) {
              const pId = crypto.createHash('md5').update(`${p.host}:${p.username}`).digest('hex');
              insertProfile.run(pId, id, p.host, p.username, p.password, p.privateKeyPath, p.passphrase, p.port || 22, p.autoStart ? 1 : 0, p.alias, p.osType);
            }
          } catch {}
        }

        const runbooksPath = path.join(wsPath, 'runbooks.json');
        if (fs.existsSync(runbooksPath)) {
          try {
            const runbooks = JSON.parse(fs.readFileSync(runbooksPath, 'utf-8'));
            const insertRb = wsDb.prepare('INSERT INTO runbooks (id, workspace_id, title, script, riskLevel, created_at) VALUES (?, ?, ?, ?, ?, ?)');
            for (const rb of runbooks) {
              insertRb.run(rb.id, id, rb.title, rb.script, rb.riskLevel || 'LOW', rb.created_at || now);
            }
          } catch {}
        }

        const chatsPath = path.join(wsPath, 'ai_chats.json');
        if (fs.existsSync(chatsPath)) {
          try {
            const chats = JSON.parse(fs.readFileSync(chatsPath, 'utf-8'));
            const insertSess = wsDb.prepare('INSERT INTO ai_sessions (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
            const insertMsg = wsDb.prepare('INSERT INTO ai_messages (id, session_id, role, content, raw_content, timestamp) VALUES (?, ?, ?, ?, ?, ?)');
            insertSess.run(chats.id, id, chats.title || 'Migration Chat', chats.updatedAt || now, chats.updatedAt || now);
            for (const m of chats.messages) {
              insertMsg.run(m.id, chats.id, m.role, m.content, m.raw_content || null, m.timestamp || now);
            }
          } catch {}
        }
      } finally {
        wsDb.close();
      }
    }
    console.log('[LegacyDatabase] JSON migration completed successfully.');
  } catch (e) {
    console.error('[LegacyDatabase] Failed to migrate legacy JSON data', e);
  }
}

function runMainMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      themeColor TEXT,
      hasPassword INTEGER DEFAULT 0,
      biometric_enabled INTEGER DEFAULT 0,
      is_main INTEGER DEFAULT 0,
      preferences TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS global_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  for (const column of ['is_main INTEGER DEFAULT 0', 'preferences TEXT', 'biometric_enabled INTEGER DEFAULT 0']) {
    try {
      db.exec(`ALTER TABLE workspaces ADD COLUMN ${column};`);
    } catch {
      // Column already exists
    }
  }
  try {
    const row = db.prepare('SELECT COUNT(*) as c FROM workspaces WHERE is_main = 1').get() as { c: number };
    if (row.c === 0) db.exec("UPDATE workspaces SET is_main = 1 WHERE id = 'default'");
  } catch {}
}

function runWorkspaceMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      host TEXT NOT NULL,
      username TEXT NOT NULL,
      password TEXT,
      privateKeyPath TEXT,
      passphrase TEXT,
      port INTEGER DEFAULT 22,
      autoStart INTEGER DEFAULT 0,
      alias TEXT,
      osType TEXT
    );
    CREATE TABLE IF NOT EXISTS runbooks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      script TEXT NOT NULL,
      riskLevel TEXT DEFAULT 'LOW',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      raw_content TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
    );
  `);
}
