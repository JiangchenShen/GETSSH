//! Table definitions. They are the ones DatabaseManager.ts created (runMainMigrations /
//! runWorkspaceMigrations), so existing databases need no conversion; getssh-store only adds the
//! tables and columns it introduces (ssh_keys, app_secrets, profiles.keyId).

use crate::sqlite::{Connection, SqlResult};

/// Adds a column unless it already exists (older databases have some, newer ones all of them).
fn add_column(conn: &Connection, table: &str, column: &str, definition: &str) -> SqlResult<()> {
    let exists = conn
        .query_map(&format!("PRAGMA table_info({table})"), &[], |row| row.text(1))?
        .into_iter()
        .any(|name| name.as_deref() == Some(column));
    if !exists {
        conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"))?;
    }
    Ok(())
}

pub fn migrate_main(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS workspaces (
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
        CREATE TABLE IF NOT EXISTS ai_memory_vectors (
            workspace_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            embedding BLOB NOT NULL,
            dimensions INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            PRIMARY KEY (workspace_id, message_id),
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_ai_memory_workspace_time ON ai_memory_vectors(workspace_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_ai_memory_workspace_session ON ai_memory_vectors(workspace_id, session_id);
        CREATE TABLE IF NOT EXISTS app_secrets (
            name TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        -- Workspaces adopt_workspace (store.rs) has started encrypting and not mounted yet.
        CREATE TABLE IF NOT EXISTS adopting_workspaces (
            id TEXT PRIMARY KEY
        );",
    )?;
    add_column(conn, "workspaces", "is_main", "INTEGER DEFAULT 0")?;
    add_column(conn, "workspaces", "preferences", "TEXT")?;
    add_column(conn, "workspaces", "biometric_enabled", "INTEGER DEFAULT 0")?;
    let has_main = conn.query_row("SELECT count(*) FROM workspaces WHERE is_main = 1", &[], |r| r.integer(0))?;
    if has_main == 0 {
        conn.execute("UPDATE workspaces SET is_main = 1 WHERE id = 'default'", &[])?;
    }
    Ok(())
}

pub fn migrate_workspace(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS profiles (
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
            osType TEXT,
            protocol TEXT DEFAULT 'ssh',
            groupName TEXT,
            useKeepAlive INTEGER DEFAULT 1,
            authType TEXT DEFAULT 'password',
            proxyJump TEXT,
            strictHostKeyChecking INTEGER DEFAULT 0,
            initialDirectory TEXT,
            postConnectScript TEXT,
            themeOverride TEXT
        );
        CREATE TABLE IF NOT EXISTS asset_folders (
            path TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL
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
        CREATE TABLE IF NOT EXISTS ssh_keys (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            algorithm TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            public_key TEXT NOT NULL,
            private_key TEXT NOT NULL,
            has_passphrase INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_profiles_workspace_id ON profiles(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_runbooks_workspace_id ON runbooks(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_ai_sessions_workspace_id ON ai_sessions(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_ai_messages_session_id ON ai_messages(session_id);",
    )?;
    for (column, definition) in [
        ("passphrase", "TEXT"),
        ("protocol", "TEXT DEFAULT 'ssh'"),
        ("groupName", "TEXT"),
        ("useKeepAlive", "INTEGER DEFAULT 1"),
        ("authType", "TEXT DEFAULT 'password'"),
        ("proxyJump", "TEXT"),
        ("strictHostKeyChecking", "INTEGER DEFAULT 0"),
        ("initialDirectory", "TEXT"),
        ("postConnectScript", "TEXT"),
        ("themeOverride", "TEXT"),
        ("keyId", "TEXT"),
    ] {
        add_column(conn, "profiles", column, definition)?;
    }
    Ok(())
}
