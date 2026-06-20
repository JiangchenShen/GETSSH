import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface WorkspaceRow {
  id: string;
  name: string;
  themeColor: string;
  hasPassword: number; // 0 or 1
  is_main?: number; // 0 or 1
  created_at: number;
  updated_at: number;
}

export interface ProfileRow {
  id: string;
  workspace_id: string;
  host: string;
  username: string;
  password?: string;
  privateKeyPath?: string;
  port: number;
  autoStart: number; // 0 or 1
  alias?: string;
  osType?: string;
}

export class DatabaseManager {
  private static db: Database.Database | null = null;
  private static dbPath: string = '';

  public static init() {
    if (this.db) return;

    const baseDir = path.join(os.homedir(), '.getssh');
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    this.dbPath = path.join(baseDir, 'getssh.db');
    this.db = new Database(this.dbPath);

    // WAL mode for performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    this.runMigrations();
    this.migrateLegacyData(baseDir);
  }

  private static migrateLegacyData(baseDir: string) {
    if (!this.db) return;
    
    // Check if we already migrated
    const workspacesCount = this.db.prepare('SELECT COUNT(*) as c FROM workspaces').get() as { c: number };
    if (workspacesCount.c > 0) return; // DB is already populated, skip migration

    console.log('[DatabaseManager] Empty DB detected. Attempting to migrate legacy JSON workspaces...');
    const legacyWsDir = path.join(baseDir, 'workspaces');
    if (!fs.existsSync(legacyWsDir)) return;

    try {
      const entries = fs.readdirSync(legacyWsDir, { withFileTypes: true });
      const workspaceIds = entries.filter(e => e.isDirectory()).map(e => e.name);

      const now = Date.now();
      for (const id of workspaceIds) {
        const wsPath = path.join(legacyWsDir, id);
        const metaPath = path.join(wsPath, 'workspace_meta.json');
        
        let name = id === 'default' ? 'Default Workspace' : id;
        let themeColor = '#1e293b';
        let hasPassword = 0;

        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            if (meta.name) name = meta.name;
            if (meta.themeColor) themeColor = meta.themeColor;
            if (meta.hasPassword) hasPassword = 1;
          } catch {}
        }

        // Insert workspace
        this.createWorkspace({
          id, name, themeColor, hasPassword, created_at: now, updated_at: now
        });

        // Migrate profiles (if unencrypted)
        const profilesPath = path.join(wsPath, 'profiles.json');
        if (fs.existsSync(profilesPath) && !hasPassword) {
          try {
            const profilesRaw = fs.readFileSync(profilesPath, 'utf-8');
            const profiles = JSON.parse(profilesRaw);
            this.saveProfiles(id, profiles.map((p: any) => ({ ...p, workspace_id: id })));
          } catch {}
        }

        // Migrate runbooks
        const runbooksPath = path.join(wsPath, 'runbooks.json');
        if (fs.existsSync(runbooksPath)) {
          try {
            const runbooksRaw = fs.readFileSync(runbooksPath, 'utf-8');
            const runbooks = JSON.parse(runbooksRaw);
            const insertRb = this.db.prepare('INSERT INTO runbooks (id, workspace_id, title, script, riskLevel, created_at) VALUES (?, ?, ?, ?, ?, ?)');
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
            
            if (chats.sessions) {
              const insertSession = this.db.prepare('INSERT INTO ai_sessions (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
              for (const s of chats.sessions) {
                insertSession.run(s.id, id, s.title, s.created_at || now, s.updated_at || now);
              }
            }
            if (chats.messages) {
              const insertMsg = this.db.prepare('INSERT INTO ai_messages (id, session_id, role, content, raw_content, timestamp) VALUES (?, ?, ?, ?, ?, ?)');
              for (const m of chats.messages) {
                insertMsg.run(m.id, m.session_id, m.role, m.content, m.raw_content || null, m.timestamp || now);
              }
            }
          } catch {}
        }
      }
      console.log('[DatabaseManager] Legacy migration completed successfully.');
    } catch (e) {
      console.error('[DatabaseManager] Failed to migrate legacy data', e);
    }
  }

  private static runMigrations() {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        themeColor TEXT,
        hasPassword INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        host TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT,
        privateKeyPath TEXT,
        port INTEGER DEFAULT 22,
        autoStart INTEGER DEFAULT 0,
        alias TEXT,
        osType TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS runbooks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        script TEXT NOT NULL,
        riskLevel TEXT DEFAULT 'LOW',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ai_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
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
    `);

    // Migrate: Add is_main column if not exists
    try {
      this.db.exec('ALTER TABLE workspaces ADD COLUMN is_main INTEGER DEFAULT 0');
    } catch (e) {
      // Column already exists, do nothing
    }

    try {
      // Ensure at least one main workspace exists
      const row = this.db.prepare('SELECT COUNT(*) as c FROM workspaces WHERE is_main = 1').get() as { c: number };
      if (row.c === 0) {
        this.db.exec("UPDATE workspaces SET is_main = 1 WHERE id = 'default'");
      }
    } catch (e) {}
  }

  // --- Workspaces ---

  public static getWorkspaces(): WorkspaceRow[] {
    if (!this.db) return [];
    return this.db.prepare('SELECT * FROM workspaces ORDER BY created_at ASC').all() as WorkspaceRow[];
  }

  public static createWorkspace(ws: WorkspaceRow) {
    if (!this.db) return;
    const stmt = this.db.prepare(`
      INSERT INTO workspaces (id, name, themeColor, hasPassword, is_main, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        themeColor = excluded.themeColor,
        hasPassword = excluded.hasPassword,
        is_main = excluded.is_main,
        updated_at = excluded.updated_at
    `);
    stmt.run(ws.id, ws.name, ws.themeColor, ws.hasPassword, ws.is_main || 0, ws.created_at, ws.updated_at);
  }

  public static deleteWorkspace(workspaceId: string) {
    if (!this.db) return;
    // Check if it's main
    const ws = this.db.prepare('SELECT is_main FROM workspaces WHERE id = ?').get(workspaceId) as WorkspaceRow;
    if (ws && ws.is_main === 1) return; // Cannot delete main workspace
    
    const stmt = this.db.prepare('DELETE FROM workspaces WHERE id = ?');
    stmt.run(workspaceId);
  }

  public static setMainWorkspace(workspaceId: string) {
    if (!this.db) return;
    const transaction = this.db.transaction(() => {
      this.db!.prepare('UPDATE workspaces SET is_main = 0').run();
      this.db!.prepare('UPDATE workspaces SET is_main = 1 WHERE id = ?').run(workspaceId);
    });
    transaction();
  }

  // --- Profiles ---

  public static getProfiles(workspaceId: string): ProfileRow[] {
    if (!this.db) return [];
    return this.db.prepare('SELECT * FROM profiles WHERE workspace_id = ?').all(workspaceId) as ProfileRow[];
  }

  public static saveProfiles(workspaceId: string, profiles: ProfileRow[]) {
    if (!this.db) return;

    const transaction = this.db.transaction(() => {
      // Basic sync: delete all and re-insert for simplicity. 
      // This ensures exact sync with frontend state without complex diffing.
      this.db!.prepare('DELETE FROM profiles WHERE workspace_id = ?').run(workspaceId);
      
      const insertStmt = this.db!.prepare(`
        INSERT INTO profiles (id, workspace_id, host, username, password, privateKeyPath, port, autoStart, alias, osType)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const p of profiles) {
        insertStmt.run(
          p.id, p.workspace_id, p.host, p.username, p.password || null, 
          p.privateKeyPath || null, p.port, p.autoStart, p.alias || null, p.osType || null
        );
      }
    });

    transaction();
  }

  // --- Runbooks ---

  public static getRunbooks(workspaceId: string): any[] {
    if (!this.db) return [];
    return this.db.prepare('SELECT * FROM runbooks WHERE workspace_id = ? ORDER BY created_at ASC').all(workspaceId);
  }

  public static saveRunbooks(workspaceId: string, runbooks: any[]) {
    if (!this.db) return;

    const transaction = this.db.transaction(() => {
      this.db!.prepare('DELETE FROM runbooks WHERE workspace_id = ?').run(workspaceId);
      
      const insertStmt = this.db!.prepare(`
        INSERT INTO runbooks (id, workspace_id, title, script, riskLevel, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const rb of runbooks) {
        insertStmt.run(rb.id, workspaceId, rb.title, rb.script, rb.riskLevel || 'LOW', rb.created_at || Date.now());
      }
    });

    transaction();
  }

  // --- AI Chats ---

  public static getAiSessions(workspaceId: string): any[] {
    if (!this.db) return [];
    const sessions = this.db.prepare('SELECT * FROM ai_sessions WHERE workspace_id = ? ORDER BY updated_at DESC').all(workspaceId) as any[];
    for (const s of sessions) {
      s.messages = this.db.prepare('SELECT * FROM ai_messages WHERE session_id = ? ORDER BY timestamp ASC').all(s.id);
    }
    return sessions;
  }

  public static createAiSession(workspaceId: string, id: string, title: string, timestamp: number) {
    if (!this.db) return;
    this.db.prepare('INSERT INTO ai_sessions (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, workspaceId, title, timestamp, timestamp);
  }

  public static saveAiMessage(msg: any) {
    if (!this.db) return;
    this.db.prepare(`
      INSERT INTO ai_messages (id, session_id, role, content, raw_content, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        raw_content = excluded.raw_content
    `).run(msg.id, msg.session_id, msg.role, msg.content, msg.raw_content || null, msg.timestamp);
    
    // Update session timestamp
    this.db.prepare('UPDATE ai_sessions SET updated_at = ? WHERE id = ?').run(msg.timestamp, msg.session_id);
  }

  public static updateAiSessionTitle(id: string, title: string) {
    if (!this.db) return;
    this.db.prepare('UPDATE ai_sessions SET title = ? WHERE id = ?').run(title, id);
  }

  public static deleteAiSession(id: string) {
    if (!this.db) return;
    this.db.prepare('DELETE FROM ai_sessions WHERE id = ?').run(id);
  }
}
