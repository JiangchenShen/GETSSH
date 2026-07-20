import Database from 'better-sqlite3-multiple-ciphers';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import crypto from 'crypto';

export interface WorkspaceRow {
  id: string;
  name: string;
  themeColor?: string;
  hasPassword?: number;
  biometric_enabled?: number;
  is_main?: number;
  preferences?: string;
  created_at: number;
  updated_at: number;
}

export interface ProfileRow {
  id: string;
  workspace_id: string; // Kept for interface compatibility
  host: string;
  username: string;
  password?: string | null;
  privateKeyPath?: string | null;
  passphrase?: string | null;
  port?: number;
  autoStart: number;
  alias?: string | null;
  osType?: string | null;
}

export class DatabaseManager {
  private static mainDb: Database.Database | null = null;
  private static workspaceDbs: Map<string, Database.Database> = new Map();
  private static baseDir: string = '';

  public static getDb(): any { return this.mainDb; }

  public static init(appKeyBuffer: Buffer | null = null) {
    if (this.mainDb) return;

    this.baseDir = path.join(os.homedir(), '.getssh');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }

    // 1. Initialize Main DB (Kernel)
    const mainDbPath = path.join(this.baseDir, 'main.db');
    const legacyDbPath = path.join(this.baseDir, 'getssh.db');

    // Migration Check: If main.db doesn't exist but getssh.db does, we need to migrate
    const needsFissionMigration = !fs.existsSync(mainDbPath) && fs.existsSync(legacyDbPath);

    if (needsFissionMigration) {
      console.log('[DatabaseManager] Legacy getssh.db detected. Starting Fission Migration...');
      this.performFissionMigration(legacyDbPath, mainDbPath, appKeyBuffer);
    }

    this.mainDb = new Database(mainDbPath);

    if (appKeyBuffer) {
      this.mainDb.pragma(`cipher = 'sqlcipher'`);
      this.mainDb.pragma(`key = '${appKeyBuffer.toString('utf8')}'`);
    }

    this.mainDb.pragma('journal_mode = WAL');
    this.mainDb.pragma('synchronous = NORMAL');
    this.mainDb.pragma('foreign_keys = ON');

    this.runMainMigrations();

    // The legacy migration from JSON should still run if no db existed at all
    if (!needsFissionMigration && !fs.existsSync(legacyDbPath)) {
       // Only run JSON migration if neither main.db nor getssh.db existed
       this.migrateLegacyJsonData(this.baseDir);
    }
  }

  // Mounts a workspace DB. Uses password if provided, otherwise attempts plaintext.
  public static mountWorkspace(workspaceId: string, password?: string): boolean {
    if (this.workspaceDbs.has(workspaceId)) {
      // Already mounted
      return true;
    }

    const wsDbPath = path.join(this.baseDir, `workspace_${workspaceId}.db`);
    try {
      const db = new Database(wsDbPath);
      
      if (password) {
        db.pragma(`cipher = 'sqlcipher'`);
        db.pragma(`key = '${password}'`);
      }

      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('foreign_keys = ON');

      // Test connection to verify password
      db.exec('CREATE TABLE IF NOT EXISTS _test (id INTEGER PRIMARY KEY)');

      // Run workspace schema migrations
      this.runWorkspaceMigrations(db);

      this.workspaceDbs.set(workspaceId, db);
      return true;
    } catch (e: any) {
      console.error(`[DatabaseManager] Failed to mount workspace ${workspaceId}:`, e.message);
      return false;
    }
  }

  public static unmountWorkspace(workspaceId: string) {
    const db = this.workspaceDbs.get(workspaceId);
    if (db) {
      db.close();
      this.workspaceDbs.delete(workspaceId);
    }
  }

  public static getWorkspaceDb(workspaceId: string): Database.Database | null {
    // If not mounted, try to mount without password (plaintext db)
    if (!this.workspaceDbs.has(workspaceId)) {
      const success = this.mountWorkspace(workspaceId);
      if (!success) return null;
    }
    return this.workspaceDbs.get(workspaceId) || null;
  }

  private static performFissionMigration(legacyPath: string, mainPath: string, appKeyBuffer: Buffer | null) {
    try {
      // Open legacy DB (assuming it was encrypted with AppKey from previous step if it existed)
      const legacyDb = new Database(legacyPath);
      if (appKeyBuffer) {
        legacyDb.pragma(`cipher = 'sqlcipher'`);
        legacyDb.pragma(`key = '${appKeyBuffer.toString('utf8')}'`);
      }

      // Check if it's readable
      legacyDb.prepare('SELECT 1 FROM workspaces LIMIT 1').get();

      // Create new main DB
      const mainDb = new Database(mainPath);
      if (appKeyBuffer) {
        mainDb.pragma(`cipher = 'sqlcipher'`);
        mainDb.pragma(`key = '${appKeyBuffer.toString('utf8')}'`);
      }
      this.mainDb = mainDb;
      this.runMainMigrations();

      // Migrate Workspaces
      const workspaces = legacyDb.prepare('SELECT * FROM workspaces').all() as any[];
      const insertWs = mainDb.prepare('INSERT INTO workspaces (id, name, themeColor, hasPassword, is_main, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      
      for (const ws of workspaces) {
        insertWs.run(ws.id, ws.name, ws.themeColor, ws.hasPassword, ws.is_main, ws.created_at, ws.updated_at);

        // Create Workspace DB (assume no workspace password during fission, because the old DB had column-level encryption or no password)
        // Wait, if it had column-level encryption, the password field is base64 encrypted string. That's fine, we just migrate it AS-IS.
        const wsDbPath = path.join(this.baseDir, `workspace_${ws.id}.db`);
        const wsDb = new Database(wsDbPath);
        this.runWorkspaceMigrations(wsDb);

        // Migrate Profiles
        const profiles = legacyDb.prepare('SELECT * FROM profiles WHERE workspace_id = ?').all(ws.id) as any[];
        const insertProfile = wsDb.prepare(`INSERT INTO profiles (id, workspace_id, host, username, password, privateKeyPath, passphrase, port, autoStart, alias, osType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const p of profiles) {
          insertProfile.run(p.id, p.workspace_id, p.host, p.username, p.password, p.privateKeyPath, p.passphrase, p.port, p.autoStart, p.alias, p.osType);
        }

        // Migrate Runbooks
        const runbooks = legacyDb.prepare('SELECT * FROM runbooks WHERE workspace_id = ?').all(ws.id) as any[];
        const insertRb = wsDb.prepare(`INSERT INTO runbooks (id, workspace_id, title, script, riskLevel, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
        for (const rb of runbooks) {
          insertRb.run(rb.id, rb.workspace_id, rb.title, rb.script, rb.riskLevel, rb.created_at);
        }

        // Migrate AI Sessions
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
        
        wsDb.close();
      }

      legacyDb.close();
      // Rename legacy db to avoid re-migration
      fs.renameSync(legacyPath, legacyPath + '.migrated');
      console.log('[DatabaseManager] Fission Migration successful.');
      this.mainDb = null; // Let init() open it properly
    } catch (e) {
      console.error('[DatabaseManager] Fission Migration failed:', e);
    }
  }

  private static migrateLegacyJsonData(baseDir: string) {
    if (!this.mainDb) return;
    
    // Check if we already migrated
    const workspacesCount = this.mainDb.prepare('SELECT COUNT(*) as c FROM workspaces').get() as { c: number };
    if (workspacesCount.c > 0) return; // Already initialized

    console.log('[DatabaseManager] Starting JSON to SQLite Migration...');
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
        this.createWorkspace({
          id: 'default',
          name: 'Default Workspace',
          created_at: now,
          updated_at: now,
          is_main: 1,
          hasPassword: 0
        });
        return;
      }

      const dirs = fs.readdirSync(workspacesDir);
      for (const id of dirs) {
        const wsPath = path.join(workspacesDir, id);
        if (fs.statSync(wsPath).isDirectory()) {
          const isMain = id === defaultWorkspaceId ? 1 : 0;
          this.mainDb.prepare('INSERT INTO workspaces (id, name, created_at, updated_at, is_main, hasPassword) VALUES (?, ?, ?, ?, ?, ?)')
              .run(id, id === 'default' ? 'Default Workspace' : id, now, now, isMain, 0);

          // Force mount plaintext workspace DB to migrate data
          const wsDbPath = path.join(this.baseDir, `workspace_${id}.db`);
          const wsDb = new Database(wsDbPath);
          this.runWorkspaceMigrations(wsDb);

          // Migrate profiles
          const plainPath = path.join(wsPath, 'profiles.json');
          if (fs.existsSync(plainPath)) {
            try {
              const profilesRaw = fs.readFileSync(plainPath, 'utf-8');
              const profiles = JSON.parse(profilesRaw);
              const insertProfile = wsDb.prepare(`INSERT INTO profiles (id, workspace_id, host, username, password, privateKeyPath, passphrase, port, autoStart, alias, osType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
              for (const p of profiles) {
                const pId = crypto.createHash('md5').update(`${p.host}:${p.username}`).digest('hex');
                insertProfile.run(pId, id, p.host, p.username, p.password, p.privateKeyPath, p.passphrase, p.port || 22, p.autoStart ? 1 : 0, p.alias, p.osType);
              }
            } catch {}
          }

          // Migrate runbooks
          const runbooksPath = path.join(wsPath, 'runbooks.json');
          if (fs.existsSync(runbooksPath)) {
            try {
              const runbooksRaw = fs.readFileSync(runbooksPath, 'utf-8');
              const runbooks = JSON.parse(runbooksRaw);
              const insertRb = wsDb.prepare('INSERT INTO runbooks (id, workspace_id, title, script, riskLevel, created_at) VALUES (?, ?, ?, ?, ?, ?)');
              for (const rb of runbooks) {
                insertRb.run(rb.id, id, rb.title, rb.script, rb.riskLevel || 'LOW', rb.created_at || now);
              }
            } catch {}
          }

          // Migrate ai_chats
          const chatsPath = path.join(wsPath, 'ai_chats.json');
          if (fs.existsSync(chatsPath)) {
            try {
              const chatsRaw = fs.readFileSync(chatsPath, 'utf-8');
              const chats = JSON.parse(chatsRaw);
              const insertSess = wsDb.prepare('INSERT INTO ai_sessions (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
              const insertMsg = wsDb.prepare('INSERT INTO ai_messages (id, session_id, role, content, raw_content, timestamp) VALUES (?, ?, ?, ?, ?, ?)');
              
              insertSess.run(chats.id, id, chats.title || 'Migration Chat', chats.updatedAt || now, chats.updatedAt || now);
              for (const m of chats.messages) {
                insertMsg.run(m.id, chats.id, m.role, m.content, m.raw_content || null, m.timestamp || now);
              }
            } catch {}
          }
          wsDb.close();
        }
      }
      console.log('[DatabaseManager] JSON migration completed successfully.');
    } catch (e) {
      console.error('[DatabaseManager] Failed to migrate legacy JSON data', e);
    }
  }

  private static runMainMigrations() {
    if (!this.mainDb) return;
    this.mainDb.exec(`
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
    `);

    this.mainDb.exec(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    try {
      this.mainDb.exec(`ALTER TABLE workspaces ADD COLUMN is_main INTEGER DEFAULT 0;`);
    } catch (e) {
      // Column already exists
    }

    try {
      this.mainDb.exec(`ALTER TABLE workspaces ADD COLUMN preferences TEXT;`);
    } catch (e) {
      // Column already exists
    }

    try {
      this.mainDb.exec(`ALTER TABLE workspaces ADD COLUMN biometric_enabled INTEGER DEFAULT 0;`);
    } catch (e) {
      // Column already exists
    }

    try {
      const row = this.mainDb.prepare('SELECT COUNT(*) as c FROM workspaces WHERE is_main = 1').get() as { c: number };
      if (row.c === 0) {
        this.mainDb.exec("UPDATE workspaces SET is_main = 1 WHERE id = 'default'");
      }
    } catch (e) {}
  }

  private static runWorkspaceMigrations(db: Database.Database) {
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

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        details TEXT,
        created_at INTEGER NOT NULL
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

      CREATE INDEX IF NOT EXISTS idx_profiles_workspace_id ON profiles(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_runbooks_workspace_id ON runbooks(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_ai_sessions_workspace_id ON ai_sessions(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_ai_messages_session_id ON ai_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_ai_messages_session_id ON ai_messages(session_id);
    `);

    try {
      db.exec(`ALTER TABLE profiles ADD COLUMN passphrase TEXT;`);
    } catch (e) {
      // Column already exists
    }
  }

  // --- Workspaces (Main DB) ---

  public static getWorkspaces(): WorkspaceRow[] {
    if (!this.mainDb) return [];
    return this.mainDb.prepare('SELECT * FROM workspaces ORDER BY created_at ASC').all() as WorkspaceRow[];
  }

  public static createWorkspace(ws: WorkspaceRow) {
    if (!this.mainDb) return;
    const stmt = this.mainDb.prepare(`
      INSERT INTO workspaces (id, name, themeColor, hasPassword, biometric_enabled, is_main, preferences, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        themeColor = excluded.themeColor,
        hasPassword = excluded.hasPassword,
        biometric_enabled = excluded.biometric_enabled,
        is_main = excluded.is_main,
        preferences = excluded.preferences,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      ws.id, 
      ws.name, 
      ws.themeColor, 
      ws.hasPassword, 
      ws.biometric_enabled || 0, 
      ws.is_main || 0, 
      ws.preferences || '{}',
      ws.created_at, 
      ws.updated_at
    );
  }

  public static deleteWorkspace(workspaceId: string) {
    if (!this.mainDb) return;
    const ws = this.mainDb.prepare('SELECT is_main FROM workspaces WHERE id = ?').get(workspaceId) as WorkspaceRow;
    if (ws && ws.is_main === 1) {
      throw new Error('Cannot delete main workspace');
    }
    
    this.mainDb.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);

    // Physically delete the workspace sub-database file
    this.unmountWorkspace(workspaceId);
    try {
       fs.unlinkSync(path.join(this.baseDir, `workspace_${workspaceId}.db`));
    } catch (e) {}
  }

  public static setMainWorkspace(workspaceId: string) {
    if (!this.mainDb) return;
    const transaction = this.mainDb.transaction(() => {
      this.mainDb!.prepare('UPDATE workspaces SET is_main = 0').run();
      this.mainDb!.prepare('UPDATE workspaces SET is_main = 1 WHERE id = ?').run(workspaceId);
    });
    transaction();
  }

  // --- Global Settings ---
  public static getGlobalSetting(key: string): string | null {
    if (!this.mainDb) return null;
    const row = this.mainDb.prepare('SELECT value FROM global_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  public static setGlobalSetting(key: string, value: string) {
    if (!this.mainDb) return;
    this.mainDb.prepare('INSERT INTO global_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // --- Profiles (Sub DB) ---

  public static getProfiles(workspaceId: string): ProfileRow[] {
    const db = this.getWorkspaceDb(workspaceId);
    if (!db) return [];
    return db.prepare('SELECT * FROM profiles WHERE workspace_id = ?').all(workspaceId) as ProfileRow[];
  }

  public static saveProfiles(workspaceId: string, profiles: ProfileRow[]) {
    const db = this.getWorkspaceDb(workspaceId);
    if (!db) return;

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM profiles WHERE workspace_id = ?').run(workspaceId);
      const insertStmt = db.prepare(`
        INSERT INTO profiles (id, workspace_id, host, username, password, privateKeyPath, passphrase, port, autoStart, alias, osType)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const p of profiles) {
        insertStmt.run(p.id, p.workspace_id, p.host, p.username, p.password || null, p.privateKeyPath || null, p.passphrase || null, p.port, p.autoStart ? 1 : 0, p.alias || null, p.osType || null);
      }
    });
    transaction();
  }

  // --- Runbooks (Sub DB) ---

  public static getRunbooks(workspaceId: string): any[] {
    const db = this.getWorkspaceDb(workspaceId);
    if (!db) return [];
    return db.prepare('SELECT * FROM runbooks WHERE workspace_id = ? ORDER BY created_at ASC').all(workspaceId);
  }

  public static saveRunbooks(workspaceId: string, runbooks: any[]) {
    const db = this.getWorkspaceDb(workspaceId);
    if (!db) return;

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM runbooks WHERE workspace_id = ?').run(workspaceId);
      const insertStmt = db.prepare(`
        INSERT INTO runbooks (id, workspace_id, title, script, riskLevel, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const rb of runbooks) {
        insertStmt.run(rb.id, workspaceId, rb.title, rb.script, rb.riskLevel || 'LOW', rb.created_at || Date.now());
      }
    });
    transaction();
  }

  // --- AI Chats (Sub DB) ---

  public static getAiSessions(workspaceId: string): any[] {
    const db = this.getWorkspaceDb(workspaceId);
    if (!db) return [];
    const sessions = db.prepare('SELECT * FROM ai_sessions WHERE workspace_id = ? ORDER BY updated_at DESC').all(workspaceId) as any[];
    for (const s of sessions) {
      s.messages = db.prepare('SELECT * FROM ai_messages WHERE session_id = ? ORDER BY timestamp ASC').all(s.id);
    }
    return sessions;
  }

  public static createAiSession(workspaceId: string, id: string, title: string, timestamp: number) {
    const db = this.getWorkspaceDb(workspaceId);
    if (!db) return;
    db.prepare('INSERT INTO ai_sessions (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, workspaceId, title, timestamp, timestamp);
  }

  public static saveAiMessage(workspaceId: string, msg: any) {
    const db = this.getWorkspaceDb(workspaceId);
    if (!db) return;
    db.prepare(`
      INSERT INTO ai_messages (id, session_id, role, content, raw_content, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        raw_content = excluded.raw_content
    `).run(msg.id, msg.session_id, msg.role, msg.content, msg.raw_content || null, msg.timestamp);
    
    db.prepare('UPDATE ai_sessions SET updated_at = ? WHERE id = ?').run(msg.timestamp, msg.session_id);
  }

  public static updateAiSessionTitle(workspaceId: string, id: string, title: string) {
    const db = this.getWorkspaceDb(workspaceId);
    if (!db) return;
    db.prepare('UPDATE ai_sessions SET title = ? WHERE id = ?').run(title, id);
  }

  public static deleteAiSession(workspaceId: string, id: string) {
    const db = this.getWorkspaceDb(workspaceId);
    if (!db) return;
    db.prepare('DELETE FROM ai_sessions WHERE id = ?').run(id);
  }

  public static logAudit(workspaceId: string, action: string, target?: string, details?: string) {
    const db = this.getWorkspaceDb(workspaceId);
    if (!db) return;
    try {
      db.prepare('INSERT INTO audit_logs (id, workspace_id, action, target, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(require('crypto').randomUUID(), workspaceId, action, target || '', details || '', Date.now());
    } catch(e) {}
  }

  public static getAuditLogs(workspaceId: string, limit: number = 50) {
    const db = this.getWorkspaceDb(workspaceId);
    if (!db) return [];
    try {
      return db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?').all(limit);
    } catch(e) {
      return [];
    }
  }

  public static getWorkspaceStats(workspaceId: string) {
    let sizeMb = 0;
    let profileCount = 0;
    let runbookCount = 0;
    
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const wsDir = path.join(os.homedir(), '.getssh', 'workspaces', workspaceId);
      
      if (fs.existsSync(wsDir)) {
        // Calculate size of ai_chats.db if it exists
        const aiChatsDbPath = path.join(wsDir, 'ai_chats.db');
        if (fs.existsSync(aiChatsDbPath)) {
          sizeMb += fs.statSync(aiChatsDbPath).size / (1024 * 1024);
        }
        // Calculate size of nexus.db if it exists
        const nexusDbPath = path.join(wsDir, 'nexus.db');
        if (fs.existsSync(nexusDbPath)) {
          sizeMb += fs.statSync(nexusDbPath).size / (1024 * 1024);
        }
        
        // Count profiles
        const profilesPath = path.join(wsDir, 'profiles.json');
        if (fs.existsSync(profilesPath)) {
          try {
            const data = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
            profileCount = Object.keys(data).length;
          } catch(e) {}
        }
        
        // Count runbooks
        const runbooksPath = path.join(wsDir, 'runbooks.json');
        if (fs.existsSync(runbooksPath)) {
          try {
            const data = JSON.parse(fs.readFileSync(runbooksPath, 'utf8'));
            runbookCount = Object.keys(data).length;
          } catch(e) {}
        }
      }
    } catch (e) {}

    // Ensure sizeMb is at least 0.01 if there are profiles or runbooks, just so it doesn't show 0.00 incorrectly
    if (sizeMb < 0.01 && (profileCount > 0 || runbookCount > 0)) sizeMb = 0.01;

    return { size: parseFloat(sizeMb.toFixed(2)), profileCount, runbookCount };
  }
}
