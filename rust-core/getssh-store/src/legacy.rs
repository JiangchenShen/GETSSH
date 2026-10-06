//! Moves the data of GETSSH 3.0 development builds, written before the keystore, into the
//! keystore. A port of keystoreMigration.ts and legacyDatabase.ts, step by step:
//!
//! - main.db, keyed with the 64-hex app key of app_key.enc / app_key.txt as a SQLCipher
//!   passphrase (or still plaintext), is brought up to date under that key (the split of
//!   getssh.db, the import of the JSON files of even older builds, missing columns) and then
//!   re-encrypted with the keystore's app key;
//! - workspace databases without a password are encrypted with their own keystore key;
//! - a workspace database keyed with its password gets a scope protected by that same password
//!   (its decrypted vault.key) and is re-encrypted with the scope key. Without vault.key the
//!   workspace waits until the owner types the password (Store::unlock_workspace);
//! - vault.key, app_key.* and getssh.db.migrated are deleted at the end.
//!
//! Only Electron can decrypt app_key.enc and vault.key (safeStorage), so the main process passes
//! their contents in (LegacySecrets); everything else is read here.
//!
//! Every step can run again after a crash: a database is replaced only by a verified copy, and a
//! scope exists before its database is re-encrypted. The legacy files are first copied, once, to
//! .keystore-migration-backup (the directory and layout of the TypeScript version, so a migration
//! that version started is finished here) and copied back if the migration fails.
//!
//! Where this differs from the TypeScript version, on purpose:
//! - a failed split of getssh.db stops the migration instead of being logged and ignored, and the
//!   split writes its databases under temporary names first;
//! - a getssh.db that was never split (an older build went on with a partial main.db beside it)
//!   is not deleted: it is moved, with app_key.* (the only key that opens it), to .pre-keystore-kept,
//!   where the detection does not see it;
//! - the backup is marked complete once taken, and a restore deletes the databases the failed
//!   attempt created, so the next attempt starts from the files as they were (and does not skip
//!   the split or the JSON import because main.db exists);
//! - a workspace id an old build accepted but the store refuses (a typed name with '/' or ':', a
//!   reserved name) is replaced by a valid one ('ws-' and 12 hex digits of its MD5) in the split
//!   and the JSON import, so its data is encrypted and usable; the old id stays as its name;
//! - plain workspaces are marked in adopting_workspaces before they move, so one whose move fails
//!   (disk full, a file another program holds) is finished by open_workspace at a later start.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

use getssh_keystore::device::Device;
use getssh_keystore::keyring::APP;
use md5::{Digest, Md5};
use serde_json::Value as Json;
use zeroize::Zeroizing;

use crate::error::{Code, StoreError, StoreResult};
use crate::rekey;
use crate::schema;
use crate::sqlite::{Connection, Key, Mode, SqlResult, Value};
use crate::store::{is_plain_sqlite, now_ms, remove_database, validate_workspace_id, workspace_scope, StartReport, Store, DATABASE_LABEL};

/// The backup directory inside the data directory (keystoreMigration.ts and appLock.ts use it too).
pub const BACKUP_DIR: &str = ".keystore-migration-backup";
/// Written into the backup once every legacy file is in it (the TypeScript version wrote none).
const BACKUP_COMPLETE: &str = ".complete";
/// Legacy files kept but no longer migrated: an unsplit getssh.db with the app key that opens it,
/// and a backup found after the app had already started. The detection ignores this directory.
pub const KEPT_DIR: &str = ".pre-keystore-kept";
/// The files of builds older than getssh.db, one set per workspace directory.
const JSON_FILES: [&str; 3] = ["profiles.json", "runbooks.json", "ai_chats.json"];
/// The split of getssh.db writes its databases under this suffix and renames them at the end.
const SPLIT_SUFFIX: &str = ".split";

/// What only Electron can decrypt (safeStorage), handed to start(): store.d.ts LegacySecrets.
#[derive(Default)]
pub struct LegacySecrets {
    /// app_key.enc, decrypted: 64 hex characters, the SQLCipher passphrase of main.db and getssh.db.
    pub app_key: Option<Zeroizing<String>>,
    /// workspaces/<id>/vault.key, decrypted, by workspace id.
    pub workspace_passwords: HashMap<String, Zeroizing<String>>,
}

impl LegacySecrets {
    /// Only the app key is checked: a workspace password that matches no usable row (an id the
    /// store does not accept, an empty value) is simply not used, rather than failing every start.
    pub fn validate(&self) -> StoreResult<()> {
        if let Some(key) = &self.app_key {
            if key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(StoreError::invalid("appKey must be 64 hex characters"));
            }
        }
        Ok(())
    }

    fn workspace_password(&self, id: &str) -> Option<&Zeroizing<String>> {
        self.workspace_passwords.get(id).filter(|password| !password.is_empty())
    }
}

/// Whether `base` still holds data of GETSSH 3.0 development builds, or a migration of it was
/// interrupted (appLock.ts needsLegacyMigration and keystoreMigration.ts hasLegacyData). Once a
/// keyring exists only the backup and app_key.* count: the JSON files are never deleted.
pub fn needs_migration(base: &Path) -> bool {
    let exists = |name: &str| base.join(name).exists();
    if exists("keyring.json") {
        return exists(BACKUP_DIR) || exists("app_key.enc") || exists("app_key.txt");
    }
    if ["main.db", "getssh.db", "app_key.enc", "app_key.txt"].into_iter().any(exists) {
        return true;
    }
    fs::read_dir(base.join("workspaces"))
        .map(|entries| entries.flatten().any(|entry| JSON_FILES.iter().any(|name| entry.path().join(name).exists())))
        .unwrap_or(false)
}

/// A workspace row as the migration reads it (keystoreMigration.ts WorkspaceRow).
struct LegacyRow {
    id: String,
    has_password: bool,
    biometric: bool,
}

impl<D: Device> Store<D> {
    /// needsLegacyMigration() in store.d.ts.
    pub fn needs_legacy_migration(&self) -> bool {
        needs_migration(self.base())
    }

    /// Runs the migration (keystoreMigration.ts migrateLegacyData). If it fails, the backup is
    /// put back and the error returned; the keyring stays, and the next start tries again.
    pub(crate) fn migrate_legacy(&self, secrets: &LegacySecrets) -> StoreResult<StartReport> {
        let base = self.base();
        if base.join("app_key.enc").exists() && secrets.app_key.is_none() {
            return Err(StoreError::invalid("app_key.enc exists: pass its decrypted contents as appKey"));
        }
        let app_key = legacy_app_key(base, secrets)?;
        let app_key = app_key.as_ref().map(|k| k.as_slice());
        let scopes: Vec<String> = self.keystore().status().scopes.into_iter().map(|scope| scope.id).collect();
        take_backup(base, app_key, secrets, &scopes)?;
        match self.migrate_legacy_data(secrets, app_key) {
            Ok(report) => {
                drop_backup(base)?;
                Ok(report)
            }
            Err(error) => {
                let _ = restore_backup(base);
                Err(error)
            }
        }
    }

    fn migrate_legacy_data(&self, secrets: &LegacySecrets, app_key: Option<&[u8]>) -> StoreResult<StartReport> {
        let base = self.base();
        let ks = self.keystore();
        if !ks.status().initialized {
            ks.initialize()?;
        }
        ks.open_scope(APP)?;
        let main = base.join("main.db");
        let key = ks.database_key(APP, DATABASE_LABEL, false)?;
        let target = Key::Raw(&key);
        // Already moved when an earlier attempt stopped after this step.
        if Connection::open(&main, &target, Mode::ReadOnly).is_err() {
            prepare_main(base, app_key)?;
            let current = legacy_key_of(&main, app_key)?;
            rekey::move_to_key(&main, &current, &target)?;
        }
        fault("main.db moved")?;

        let mut report = StartReport::default();
        let mut flags = Vec::new();
        let rows = workspace_rows(&main, &target)?;
        mark_adopting(&main, &target, rows.iter().filter(|row| !row.has_password).map(|row| row.id.as_str()))?;
        for row in rows {
            // One damaged workspace must not keep GETSSH from starting: it stays as it was.
            match self.migrate_legacy_row(&row, secrets, &mut report) {
                Ok(Some(has_password)) => flags.push((row.id, has_password)),
                Ok(None) => {}
                Err(_) => report.failed_workspaces.push(row.id),
            }
        }
        fault("workspaces moved")?;
        update_flags(&main, &target, &flags)?;

        for id in &report.migrated_workspaces {
            self.remove_vault_key(id)?;
        }
        if base.join("getssh.db").exists() {
            // Never split, and only the app key opens it: both are kept, out of the detection's
            // way (left here, they would make every start migrate again).
            keep_unsplit(base)?;
        } else {
            remove_if_exists(&base.join("app_key.enc"))?;
            remove_if_exists(&base.join("app_key.txt"))?;
        }
        for name in ["getssh.db.migrated", "getssh.db.migrated-wal", "getssh.db.migrated-shm"] {
            remove_if_exists(&base.join(name))?;
        }
        // Migrated password workspaces are protected by the keystore now: locked until unlocked.
        ks.lock_protected();
        Ok(report)
    }

    /// One workspace row (keystoreMigration.ts migrateWorkspace). Returns the hasPassword flag of
    /// a migrated row, or None for a deferred one. An error leaves the database as it was; a
    /// scope created just before stays, so the workspace is reported as failed again later.
    fn migrate_legacy_row(&self, row: &LegacyRow, secrets: &LegacySecrets, report: &mut StartReport) -> StoreResult<Option<bool>> {
        let ks = self.keystore();
        let scope = workspace_scope(&row.id)?;
        let file = self.workspace_path(&row.id);
        let scope_exists = ks.status().scopes.iter().any(|s| s.id == scope);
        if !row.has_password {
            if scope_exists {
                ks.open_scope(&scope)?;
            } else {
                ks.create_scope(&scope, None)?;
            }
            self.move_to_scope_key(&file, &scope, &Key::Plain)?;
            report.migrated_workspaces.push(row.id.clone());
            return Ok(Some(false));
        }

        // The password comes from vault.key; without one Electron could decrypt, the workspace
        // waits for its owner.
        let vault = self.base().join("workspaces").join(&row.id).join("vault.key");
        let Some(password) = secrets.workspace_password(&row.id).filter(|_| vault.exists()) else {
            report.deferred_workspaces.push(row.id.clone());
            return Ok(None);
        };
        // The raw UTF-8 bytes were the SQLCipher passphrase; the keystore normalizes to NFC itself.
        let legacy = Key::Passphrase(password.as_bytes());
        if scope_exists {
            ks.unlock_with_password(&scope, password)?;
        } else {
            if file.exists() && Connection::open(&file, &legacy, Mode::ReadOnly).is_err() {
                // vault.key does not match the database: left for the owner to unlock by hand.
                report.deferred_workspaces.push(row.id.clone());
                return Ok(None);
            }
            ks.create_scope_with_legacy_password(&scope, password)?;
        }
        self.move_to_scope_key(&file, &scope, &legacy)?;
        if row.biometric {
            report.presence_to_reenable.push(row.id.clone());
        }
        report.migrated_workspaces.push(row.id.clone());
        Ok(Some(true))
    }
}

// ───────────────────────────────────── the app key ─────────────────────────────────────

/// The legacy app key as passphrase bytes (keystoreMigration.ts readLegacyAppKey). app_key.enc
/// wins over app_key.txt, whose contents are used as written, without trimming.
fn legacy_app_key(base: &Path, secrets: &LegacySecrets) -> StoreResult<Option<Zeroizing<Vec<u8>>>> {
    if base.join("app_key.enc").exists() {
        let key = secrets.app_key.as_ref().ok_or_else(|| StoreError::invalid("appKey is required"))?;
        return Ok(Some(Zeroizing::new(key.as_bytes().to_vec())));
    }
    let text = base.join("app_key.txt");
    if !text.exists() {
        return Ok(None);
    }
    let bytes = Zeroizing::new(fs::read(text)?);
    if bytes.is_empty() {
        return Ok(None);
    }
    // Node read the file as UTF-8 text, so invalid bytes had become U+FFFD.
    if std::str::from_utf8(&bytes).is_ok() {
        return Ok(Some(bytes));
    }
    Ok(Some(Zeroizing::new(String::from_utf8_lossy(&bytes).into_owned().into_bytes())))
}

/// The key that opens main.db before the move (keystoreMigration.ts currentLegacyKey).
fn legacy_key_of<'a>(main: &Path, app_key: Option<&'a [u8]>) -> StoreResult<Key<'a>> {
    if let Some(key) = app_key {
        if Connection::open(main, &Key::Passphrase(key), Mode::ReadOnly).is_ok() {
            return Ok(Key::Passphrase(key));
        }
    }
    if Connection::open(main, &Key::Plain, Mode::ReadOnly).is_ok() {
        return Ok(Key::Plain);
    }
    Err(StoreError::new(Code::Corrupt, "main.db does not open with the legacy key"))
}

// ───────────────────────────────────── main.db ─────────────────────────────────────

/// Brings main.db up to date under its legacy key (legacyDatabase.ts prepareLegacyMainDatabase):
/// splits getssh.db, adds missing tables and columns, imports the JSON files of older builds.
fn prepare_main(base: &Path, app_key: Option<&[u8]>) -> StoreResult<()> {
    let main = base.join("main.db");
    let getssh = base.join("getssh.db");
    let main_temp = base.join(format!("main.db{SPLIT_SUFFIX}"));
    // A split that stopped right before its last rename: getssh.db is getssh.db.migrated already.
    if !main.exists() && !getssh.exists() && main_temp.exists() && base.join("getssh.db.migrated").exists() {
        fs::rename(&main_temp, &main)?;
    }
    let split = !main.exists() && getssh.exists();
    if split {
        split_getssh_db(base, app_key)?;
    }
    let key = match app_key {
        Some(key) if !is_plain_sqlite(&main) => Key::Passphrase(key),
        _ => Key::Plain,
    };
    let conn = Connection::open(&main, &key, Mode::Create)?;
    schema::migrate_main(&conn)?;
    if !split && !getssh.exists() {
        import_json(base, &conn)?;
    }
    Ok(())
}

/// The workspace rows in table order (keystoreMigration.ts readWorkspaceRows). Not open_main:
/// that adds a 'default' row to an empty table, which the migration must not report.
fn workspace_rows(main: &Path, key: &Key<'_>) -> StoreResult<Vec<LegacyRow>> {
    let conn = Connection::open(main, key, Mode::ReadOnly)?;
    let table = conn.query_optional("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'", &[], |_| Ok(()))?;
    if table.is_none() {
        return Ok(Vec::new());
    }
    let biometric = conn.query_map("PRAGMA table_info(workspaces)", &[], |r| r.text(1))?.iter().any(|c| c.as_deref() == Some("biometric_enabled"));
    let sql = if biometric { "SELECT id, hasPassword, biometric_enabled FROM workspaces" } else { "SELECT id, hasPassword FROM workspaces" };
    Ok(conn.query_map(sql, &[], |r| {
        Ok(LegacyRow { id: r.text(0)?.unwrap_or_default(), has_password: truthy(&r.value(1)?), biometric: biometric && truthy(&r.value(2)?) })
    })?)
}

/// JavaScript truthiness of a column value as better-sqlite3 returns it.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Integer(v) => *v != 0,
        Value::Real(v) => *v != 0.0 && !v.is_nan(),
        Value::Text(v) => !v.is_empty(),
        Value::Blob(_) => true,
    }
}

/// Records the moved rows (keystoreMigration.ts updateWorkspaceFlags). The keystore decides
/// whether a workspace has a password from now on; this keeps the table in line with it.
fn update_flags(main: &Path, key: &Key<'_>, flags: &[(String, bool)]) -> StoreResult<()> {
    if flags.is_empty() {
        return Ok(());
    }
    let conn = Connection::open(main, key, Mode::ReadWrite)?;
    conn.transaction(|c| {
        for (id, has_password) in flags {
            c.execute("UPDATE workspaces SET hasPassword = ?, biometric_enabled = 0 WHERE id = ?", &[(*has_password).into(), id.as_str().into()])?;
        }
        Ok(())
    })?;
    Ok(())
}

/// Marks plain workspaces for store.rs open_workspace, which encrypts a plaintext database only
/// while its id is in adopting_workspaces (the mark is cleared once the database is mounted).
/// main.db moved by the TypeScript version may not have the table yet.
fn mark_adopting<'a>(main: &Path, key: &Key<'_>, ids: impl Iterator<Item = &'a str>) -> StoreResult<()> {
    let conn = Connection::open(main, key, Mode::ReadWrite)?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS adopting_workspaces (id TEXT PRIMARY KEY)")?;
    conn.transaction(|c| {
        for id in ids {
            c.execute("INSERT INTO adopting_workspaces (id) VALUES (?) ON CONFLICT(id) DO NOTHING", &[id.into()])?;
        }
        Ok(())
    })?;
    Ok(())
}

/// The ids given to workspaces an old build wrote with ids the store refuses.
#[derive(Default)]
struct Ids {
    taken: std::collections::HashSet<String>,
}

impl Ids {
    /// `id` when the store accepts it; otherwise 'ws-' and 12 hex digits of its MD5 (the same on
    /// every attempt), with a counter in the rare case that is taken.
    fn usable(&mut self, id: &str) -> String {
        let mut candidate = id.to_string();
        if validate_workspace_id(id).is_err() {
            let base = format!("ws-{}", &md5_hex(id)[..12]);
            candidate = base.clone();
            let mut n = 2;
            while self.taken.contains(&candidate) {
                candidate = format!("{base}-{n}");
                n += 1;
            }
        }
        self.taken.insert(candidate.clone());
        candidate
    }
}

// ─────────────────────────────────── splitting getssh.db ───────────────────────────────────

/// A row as better-sqlite3's all() returns it: column name → value.
type Record = HashMap<String, Value>;

/// Every row of a query. Integers come back as reals: they crossed JavaScript as numbers, which
/// better-sqlite3 binds as REAL (an INTEGER column turns them back into integers).
fn select(conn: &Connection, sql: &str, params: &[Value]) -> SqlResult<Vec<Record>> {
    let mut stmt = conn.prepare(sql)?;
    stmt.bind(params)?;
    let names = stmt.column_names();
    let mut rows = Vec::new();
    while let Some(row) = stmt.step()? {
        let mut record = Record::new();
        for (i, name) in names.iter().enumerate() {
            let value = match row.value(i)? {
                Value::Integer(v) => Value::Real(v as f64),
                other => other,
            };
            record.insert(name.clone(), value);
        }
        rows.push(record);
    }
    Ok(rows)
}

/// The named columns of a row; a column the old table lacks is undefined in JavaScript: NULL.
fn columns(record: &Record, names: &[&str]) -> Vec<Value> {
    names.iter().map(|name| record.get(*name).cloned().unwrap_or(Value::Null)).collect()
}

/// `${value}` in JavaScript for a value read from SQLite.
fn js_text(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Integer(v) => v.to_string(),
        Value::Real(v) => js_number(*v),
        Value::Text(v) => v.clone(),
        Value::Blob(v) => String::from_utf8_lossy(v).into_owned(),
    }
}

/// Splits getssh.db, the single database of early builds, into main.db (under the same key) and
/// one plaintext database per workspace (legacyDatabase.ts performFissionMigration). Everything
/// is written under temporary names and renamed into place at the end: the workspace databases,
/// then getssh.db to getssh.db.migrated, then main.db. So main.db and getssh.db never exist side
/// by side because of a split (prepare_main finishes the last rename after a crash).
fn split_getssh_db(base: &Path, app_key: Option<&[u8]>) -> StoreResult<()> {
    let key = app_key.map_or(Key::Plain, Key::Passphrase);
    let main_temp = base.join(format!("main.db{SPLIT_SUFFIX}"));
    let mut workspaces: Vec<PathBuf> = Vec::new();
    let result = (|| -> StoreResult<()> {
        {
            let source = Connection::open(&base.join("getssh.db"), &key, Mode::ReadWrite)?;
            source.query_optional("SELECT 1 FROM workspaces LIMIT 1", &[], |_| Ok(()))?;
            remove_database(&main_temp);
            let main = Connection::open(&main_temp, &key, Mode::Create)?;
            schema::migrate_main(&main)?;
            let rows = select(&source, "SELECT * FROM workspaces", &[])?;
            let mut ids = Ids::default();
            for ws in &rows {
                if let Some(Value::Text(id)) = ws.get("id") {
                    if validate_workspace_id(id).is_ok() {
                        ids.taken.insert(id.clone());
                    }
                }
            }
            for ws in rows {
                let id = ws.get("id").cloned().unwrap_or(Value::Null);
                let text = js_text(&id);
                let usable = ids.usable(&text);
                // A refused id is replaced, in the row and in every copied row; others are copied
                // exactly as before.
                let new_id = (usable != text).then(|| Value::Text(usable.clone()));
                let mut values = columns(&ws, &["id", "name", "themeColor", "hasPassword", "is_main", "created_at", "updated_at"]);
                if let Some(new_id) = &new_id {
                    // The row keeps its name (NOT NULL in getssh.db), which the window shows.
                    values[0] = new_id.clone();
                }
                main.execute("INSERT INTO workspaces (id, name, themeColor, hasPassword, is_main, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", &values)?;
                let temp = base.join(format!("workspace_{usable}.db{SPLIT_SUFFIX}"));
                remove_database(&temp);
                workspaces.push(temp.clone());
                let db = Connection::open(&temp, &Key::Plain, Mode::Create)?;
                schema::migrate_workspace(&db)?;
                db.transaction(|db| copy_workspace(&source, db, &id, new_id.as_ref()))?;
            }
        }
        fault("split")?;
        let into_place = |temp: &Path| -> StoreResult<()> {
            let file = base.join(temp.file_name().and_then(|n| n.to_str()).and_then(|n| n.strip_suffix(SPLIT_SUFFIX)).unwrap_or_default());
            // A WAL or journal left by an earlier attempt would be replayed into the new file.
            for suffix in ["-wal", "-shm", "-journal"] {
                remove_if_exists(&sidecar(&file, suffix))?;
            }
            fs::rename(temp, &file)?;
            Ok(())
        };
        for temp in &workspaces {
            into_place(temp)?;
        }
        let getssh = base.join("getssh.db");
        let migrated = base.join("getssh.db.migrated");
        for suffix in ["-wal", "-shm"] {
            if sidecar(&getssh, suffix).exists() {
                fs::rename(sidecar(&getssh, suffix), sidecar(&migrated, suffix))?;
            }
        }
        fs::rename(&getssh, &migrated)?;
        fault("split renamed")?;
        into_place(&main_temp)
    })();
    if result.is_err() {
        for temp in workspaces.iter().chain([&main_temp]) {
            remove_database(temp);
        }
    }
    result
}

/// Copies one workspace's rows out of getssh.db, the columns legacyDatabase.ts copies.
/// `new_id` replaces workspace_id in every row (the store lists rows by it).
fn copy_workspace(source: &Connection, db: &Connection, id: &Value, new_id: Option<&Value>) -> SqlResult<()> {
    // workspace_id is the second column of every insert below.
    let with_id = |mut values: Vec<Value>| {
        if let Some(new_id) = new_id {
            values[1] = new_id.clone();
        }
        values
    };
    for p in select(source, "SELECT * FROM profiles WHERE workspace_id = ?", std::slice::from_ref(id))? {
        db.execute(
            "INSERT INTO profiles (id, workspace_id, host, username, password, privateKeyPath, passphrase, port, autoStart, alias, osType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            &with_id(columns(&p, &["id", "workspace_id", "host", "username", "password", "privateKeyPath", "passphrase", "port", "autoStart", "alias", "osType"])),
        )?;
    }
    for rb in select(source, "SELECT * FROM runbooks WHERE workspace_id = ?", std::slice::from_ref(id))? {
        db.execute(
            "INSERT INTO runbooks (id, workspace_id, title, script, riskLevel, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            &with_id(columns(&rb, &["id", "workspace_id", "title", "script", "riskLevel", "created_at"])),
        )?;
    }
    for s in select(source, "SELECT * FROM ai_sessions WHERE workspace_id = ?", std::slice::from_ref(id))? {
        db.execute(
            "INSERT INTO ai_sessions (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            &with_id(columns(&s, &["id", "workspace_id", "title", "created_at", "updated_at"])),
        )?;
        let session = s.get("id").cloned().unwrap_or(Value::Null);
        for m in select(source, "SELECT * FROM ai_messages WHERE session_id = ?", &[session])? {
            db.execute(
                "INSERT INTO ai_messages (id, session_id, role, content, raw_content, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
                &columns(&m, &["id", "session_id", "role", "content", "raw_content", "timestamp"]),
            )?;
        }
    }
    Ok(())
}

// ─────────────────────────────────── importing the JSON files ───────────────────────────────────

/// Imports the JSON files of builds older than getssh.db into an empty main.db and new plaintext
/// workspace databases (legacyDatabase.ts migrateLegacyJsonData). Like the TypeScript version it
/// skips what it cannot read: a bad file stops that file, a bad workspace stops the import.
fn import_json(base: &Path, main: &Connection) -> StoreResult<()> {
    if main.query_row("SELECT count(*) FROM workspaces", &[], |r| r.integer(0))? > 0 {
        return Ok(());
    }
    let _ = import_workspaces(base, main, now_ms());
    Ok(())
}

fn import_workspaces(base: &Path, main: &Connection, now: i64) -> StoreResult<()> {
    let active = active_workspace(base);
    let dir = base.join("workspaces");
    if !dir.exists() {
        return insert_workspace(main, "default", "Default Workspace", true, now);
    }
    // Node lists a directory sorted by byte order (libuv scandir), so rows keep that order.
    let entries = names(&dir)?;
    let mut ids = Ids::default();
    ids.taken.extend(entries.iter().filter(|name| validate_workspace_id(name).is_ok()).cloned());
    for dir_name in entries {
        let path = dir.join(&dir_name);
        // Hidden directories are no workspaces. Other names the store refuses get a valid id
        // (Ids::usable) and keep their name; the JSON files stay where they are, as for all.
        if !fs::metadata(&path)?.is_dir() || dir_name.starts_with('.') {
            continue;
        }
        let id = ids.usable(&dir_name);
        let name = if dir_name == "default" { "Default Workspace" } else { dir_name.as_str() };
        insert_workspace(main, &id, name, active.as_deref() == Some(dir_name.as_str()), now)?;
        let db = Connection::open(&base.join(format!("workspace_{id}.db")), &Key::Plain, Mode::Create)?;
        schema::migrate_workspace(&db)?;
        let _ = import_profiles(&db, &id, &path.join("profiles.json"));
        let _ = import_runbooks(&db, &id, &path.join("runbooks.json"), now);
        let _ = import_chat(&db, &id, &path.join("ai_chats.json"), now);
    }
    Ok(())
}

fn insert_workspace(main: &Connection, id: &str, name: &str, is_main: bool, now: i64) -> StoreResult<()> {
    main.execute(
        "INSERT INTO workspaces (id, name, themeColor, hasPassword, biometric_enabled, is_main, preferences, created_at, updated_at) VALUES (?, ?, NULL, 0, 0, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
        &[id.into(), name.into(), is_main.into(), "{}".into(), now.into(), now.into()],
    )?;
    Ok(())
}

/// `config.active_workspace || 'default'` from app-config.json. None for a value that never
/// equals a directory name (a truthy non-string).
fn active_workspace(base: &Path) -> Option<String> {
    let default = Some("default".to_string());
    let Some(config) = read_json(&base.join("app-config.json")) else { return default };
    match property(&config, "active_workspace") {
        Ok(Some(Json::String(id))) if !id.is_empty() => Some(id.clone()),
        Ok(value) if truthy_json(value) => None,
        _ => default,
    }
}

/// JSON.parse(fs.readFileSync(file, 'utf-8')): None when the file cannot be read or parsed.
fn read_json(file: &Path) -> Option<Json> {
    let bytes = fs::read(file).ok()?;
    serde_json::from_str(&String::from_utf8_lossy(&bytes)).ok()
}

/// A failed import of one file: it stops, and what it inserted so far stays.
struct Skip;

/// `value.key` in JavaScript: a TypeError for null, undefined for anything but an object.
fn property<'a>(value: &'a Json, key: &str) -> Result<Option<&'a Json>, Skip> {
    match value {
        Json::Null => Err(Skip),
        Json::Object(map) => Ok(map.get(key)),
        _ => Ok(None),
    }
}

/// What `for (const x of value)` visits. A non-empty string iterates characters, which never
/// make a valid row (the first insert fails), so it stops the file like a non-iterable does.
fn items(value: Option<&Json>) -> Result<&[Json], Skip> {
    match value {
        Some(Json::Array(items)) => Ok(items),
        Some(Json::String(s)) if s.is_empty() => Ok(&[]),
        _ => Err(Skip),
    }
}

/// JavaScript truthiness of a JSON value (`undefined` when missing).
fn truthy_json(value: Option<&Json>) -> bool {
    match value {
        None | Some(Json::Null) => false,
        Some(Json::Bool(b)) => *b,
        Some(Json::Number(n)) => n.as_f64().is_some_and(|v| v != 0.0),
        Some(Json::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// A JSON value bound the way better-sqlite3 binds the JavaScript value: numbers as REAL, strings
/// as TEXT, null and missing values as NULL. Booleans throw there; objects and arrays are refused.
fn bind(value: Option<&Json>) -> Result<Value, Skip> {
    match value {
        None | Some(Json::Null) => Ok(Value::Null),
        Some(Json::String(s)) => Ok(Value::Text(s.clone())),
        Some(Json::Number(n)) => n.as_f64().map(Value::Real).ok_or(Skip),
        Some(_) => Err(Skip),
    }
}

/// `value || fallback`.
fn or(value: Option<&Json>, fallback: Value) -> Result<Value, Skip> {
    if truthy_json(value) {
        bind(value)
    } else {
        Ok(fallback)
    }
}

/// `${value}` for the values that can end up in a valid row: text and numbers. Anything else
/// fails the insert that follows (NOT NULL, or a value better-sqlite3 cannot bind).
fn js_template(value: Option<&Json>) -> Result<String, Skip> {
    match value {
        Some(Json::String(s)) => Ok(s.clone()),
        Some(Json::Number(n)) => n.as_f64().map(js_number).ok_or(Skip),
        _ => Err(Skip),
    }
}

/// Number.prototype.toString for a finite number.
fn js_number(value: f64) -> String {
    if value == 0.0 {
        return "0".into();
    }
    if (1e-6..1e21).contains(&value.abs()) {
        return format!("{value}");
    }
    let text = format!("{value:e}");
    match text.split_once('e') {
        Some((mantissa, exponent)) if !exponent.starts_with('-') => format!("{mantissa}e+{exponent}"),
        _ => text,
    }
}

fn md5_hex(text: &str) -> String {
    Md5::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn run(db: &Connection, sql: &str, params: &[Value]) -> Result<(), Skip> {
    db.execute(sql, params).map(|_| ()).map_err(|_| Skip)
}

/// profiles.json: an array of profiles; the id is md5(`${host}:${username}`).
fn import_profiles(db: &Connection, workspace: &str, file: &Path) -> Result<(), Skip> {
    let profiles = read_json(file).ok_or(Skip)?;
    for p in items(Some(&profiles))? {
        let host = property(p, "host")?;
        let username = property(p, "username")?;
        let id = md5_hex(&format!("{}:{}", js_template(host)?, js_template(username)?));
        run(
            db,
            "INSERT INTO profiles (id, workspace_id, host, username, password, privateKeyPath, passphrase, port, autoStart, alias, osType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            &[
                id.into(),
                workspace.into(),
                bind(host)?,
                bind(username)?,
                bind(property(p, "password")?)?,
                bind(property(p, "privateKeyPath")?)?,
                bind(property(p, "passphrase")?)?,
                or(property(p, "port")?, Value::Integer(22))?,
                truthy_json(property(p, "autoStart")?).into(),
                bind(property(p, "alias")?)?,
                bind(property(p, "osType")?)?,
            ],
        )?;
    }
    Ok(())
}

/// runbooks.json: an array of runbooks.
fn import_runbooks(db: &Connection, workspace: &str, file: &Path, now: i64) -> Result<(), Skip> {
    let runbooks = read_json(file).ok_or(Skip)?;
    for rb in items(Some(&runbooks))? {
        run(
            db,
            "INSERT INTO runbooks (id, workspace_id, title, script, riskLevel, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            &[
                bind(property(rb, "id")?)?,
                workspace.into(),
                bind(property(rb, "title")?)?,
                bind(property(rb, "script")?)?,
                or(property(rb, "riskLevel")?, "LOW".into())?,
                or(property(rb, "created_at")?, now.into())?,
            ],
        )?;
    }
    Ok(())
}

/// ai_chats.json: one chat, { id, title, updatedAt, messages }.
fn import_chat(db: &Connection, workspace: &str, file: &Path, now: i64) -> Result<(), Skip> {
    let chat = read_json(file).ok_or(Skip)?;
    let session = property(&chat, "id")?;
    let updated = or(property(&chat, "updatedAt")?, now.into())?;
    run(
        db,
        "INSERT INTO ai_sessions (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        &[bind(session)?, workspace.into(), or(property(&chat, "title")?, "Migration Chat".into())?, updated.clone(), updated],
    )?;
    for m in items(property(&chat, "messages")?)? {
        run(
            db,
            "INSERT INTO ai_messages (id, session_id, role, content, raw_content, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            &[
                bind(property(m, "id")?)?,
                bind(session)?,
                bind(property(m, "role")?)?,
                bind(property(m, "content")?)?,
                or(property(m, "raw_content")?, Value::Null)?,
                or(property(m, "timestamp")?, now.into())?,
            ],
        )?;
    }
    Ok(())
}

// ───────────────────────────────────── the backup ─────────────────────────────────────

/// main.db, getssh.db, getssh.db.migrated or workspace_<id>.db (keystoreMigration.ts patterns).
fn is_database(name: &str) -> bool {
    matches!(name, "main.db" | "getssh.db" | "getssh.db.migrated")
        || (name.len() > "workspace_.db".len() && name.starts_with("workspace_") && name.ends_with(".db"))
}

/// The base-directory names the backup holds: those databases with their WAL and SHM, app_key.*.
fn backed_up(name: &str) -> bool {
    let db = name.strip_suffix("-wal").or_else(|| name.strip_suffix("-shm")).unwrap_or(name);
    is_database(db) || name == "app_key.enc" || name == "app_key.txt"
}

/// The database a `<name>.db-wal|-shm|-journal` (or `.db.migrated-…`) file belongs to.
fn sidecar_of(name: &str) -> Option<&str> {
    let db = ["-wal", "-shm", "-journal"].iter().find_map(|suffix| name.strip_suffix(suffix))?;
    let belongs = (db.len() > ".db".len() && db.ends_with(".db")) || (db.len() > ".db.migrated".len() && db.ends_with(".db.migrated"));
    belongs.then_some(db)
}

fn sidecar(file: &Path, suffix: &str) -> PathBuf {
    let mut name = file.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

/// The UTF-8 names in a directory, sorted by byte order.
fn names(dir: &Path) -> io::Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in fs::read_dir(dir)? {
        if let Ok(name) = entry?.file_name().into_string() {
            names.push(name);
        }
    }
    names.sort();
    Ok(names)
}

fn remove_if_exists(file: &Path) -> io::Result<()> {
    match fs::remove_file(file) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// Creates `dir` and its missing parents with mode 0700.
fn private_dir(dir: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(dir)
}

/// The legacy files the backup holds (keystoreMigration.ts backupFiles).
fn backup_files(base: &Path) -> io::Result<Vec<PathBuf>> {
    let mut files: Vec<PathBuf> = names(base)?.into_iter().filter(|name| backed_up(name)).map(|name| base.join(name)).collect();
    let workspaces = base.join("workspaces");
    if workspaces.exists() {
        for id in names(&workspaces)? {
            let vault = workspaces.join(id).join("vault.key");
            if vault.exists() {
                files.push(vault);
            }
        }
    }
    Ok(files)
}

/// Copies `source` to `target` through `temp` (in the same directory as `target`): flushed, then
/// renamed into place, so a crash never leaves a partial `target`.
fn copy_through(source: &Path, temp: &Path, target: &Path) -> io::Result<()> {
    remove_if_exists(temp)?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut copy = options.open(temp)?;
    io::copy(&mut File::open(source)?, &mut copy)?;
    copy.sync_all()?;
    drop(copy);
    fs::rename(temp, target)
}

/// Whether a legacy file is still as the development build left it, judged by the key it opens
/// with: none, the app key (main.db, getssh.db) or the workspace's password. No step of the
/// migration has changed such a file yet. app_key.* and vault.key are never changed, only deleted.
fn unchanged(base: &Path, file: &Path, app_key: Option<&[u8]>, secrets: &LegacySecrets, scopes: &[String]) -> bool {
    let Some(name) = file.file_name().and_then(|n| n.to_str()) else { return false };
    if matches!(name, "vault.key" | "app_key.enc" | "app_key.txt") {
        return true;
    }
    let db = name.strip_suffix("-wal").or_else(|| name.strip_suffix("-shm")).unwrap_or(name);
    // Nothing moves a database before its key scope exists: without one it is as it was, also
    // when its old key is not known here (a password workspace waiting for its password).
    let scope = match db.strip_prefix("workspace_").and_then(|n| n.strip_suffix(".db")) {
        Some(id) => format!("ws:{id}"),
        None => APP.to_string(),
    };
    if !scopes.contains(&scope) {
        return true;
    }
    let path = base.join(db);
    if is_plain_sqlite(&path) {
        return true;
    }
    let key = match db.strip_prefix("workspace_").and_then(|n| n.strip_suffix(".db")) {
        Some(id) => secrets.workspace_password(id).map(|p| p.as_bytes()),
        None => app_key,
    };
    key.is_some_and(|key| Connection::open(&path, &Key::Passphrase(key), Mode::ReadOnly).is_ok())
}

/// Copies every legacy file into the backup (keystoreMigration.ts takeBackup) and marks it
/// complete; a complete backup is never added to, so a restore removes whatever a failed
/// attempt created. A backup without the mark was started by the TypeScript version, or this
/// one stopped while taking it: in both cases nothing was migrated before it was complete, so
/// missing files are added, and a copy whose file is still unchanged is taken again (the
/// TypeScript version copied in place, and a crash could leave a truncated copy).
fn take_backup(base: &Path, app_key: Option<&[u8]>, secrets: &LegacySecrets, scopes: &[String]) -> StoreResult<()> {
    let root = base.join(BACKUP_DIR);
    let complete = root.join(BACKUP_COMPLETE);
    if complete.exists() {
        return Ok(());
    }
    private_dir(&root)?;
    let partial = base.join(format!("{BACKUP_DIR}.partial"));
    for file in backup_files(base)? {
        let relative = file.strip_prefix(base).map_err(|_| StoreError::new(Code::Internal, "a legacy file outside the data directory"))?;
        let target = root.join(relative);
        if target.exists() && !unchanged(base, &file, app_key, secrets, scopes) {
            continue;
        }
        if let Some(parent) = target.parent() {
            private_dir(parent)?;
        }
        copy_through(&file, &partial, &target)?;
    }
    File::create(&complete)?.sync_all()?;
    Ok(())
}

/// Puts the backup back (keystoreMigration.ts restoreBackup) and deletes the databases created
/// since it was taken. Every legacy database was copied at the start, so one without a copy was
/// written by the failed attempt (the split or the JSON import); left in place, it would make the
/// next attempt skip that step. Keeps going after an error and returns the first one.
fn restore_backup(base: &Path) -> io::Result<()> {
    let root = base.join(BACKUP_DIR);
    if !root.exists() {
        return Ok(());
    }
    let mut first_error = None;
    let mut note = |result: io::Result<()>| {
        if let Err(error) = result {
            first_error.get_or_insert(error);
        }
    };
    match names(base) {
        Ok(names) => {
            for name in names {
                if is_database(&name) && !root.join(&name).exists() {
                    remove_database(&base.join(&name));
                } else if let Some(db) = sidecar_of(&name) {
                    // A restored database must not meet a WAL, SHM or journal of the failed attempt
                    // (written with another key, for a newer version of the file): SQLite would
                    // replay it into the old one.
                    if root.join(db).exists() && !root.join(&name).exists() {
                        note(remove_if_exists(&base.join(&name)));
                    }
                }
            }
        }
        Err(error) => note(Err(error)),
    }
    note(copy_back(&root, &root, base));
    first_error.map_or(Ok(()), Err)
}

fn copy_back(root: &Path, dir: &Path, base: &Path) -> io::Result<()> {
    let mut first_error = None;
    for entry in fs::read_dir(dir)? {
        let result = (|| -> io::Result<()> {
            let entry = entry?;
            let source = entry.path();
            if entry.file_type()?.is_dir() {
                return copy_back(root, &source, base);
            }
            if source == root.join(BACKUP_COMPLETE) {
                return Ok(());
            }
            let target = base.join(source.strip_prefix(root).map_err(io::Error::other)?);
            if let Some(parent) = target.parent() {
                private_dir(parent)?;
            }
            // Not in place: a crash halfway through would leave a truncated database, and the
            // next attempt would drop the backup that still had it whole.
            copy_through(&source, &sidecar(&target, ".restoring"), &target)
        })();
        if let Err(error) = result {
            first_error.get_or_insert(error);
        }
    }
    first_error.map_or(Ok(()), Err)
}

/// Deletes the backup once everything moved. It is renamed away first, so an interrupted delete
/// never leaves a partial backup that a later attempt would restore from.
fn drop_backup(base: &Path) -> io::Result<()> {
    let root = base.join(BACKUP_DIR);
    if !root.exists() {
        return Ok(());
    }
    let doomed = base.join(format!("{BACKUP_DIR}.delete"));
    let _ = fs::remove_dir_all(&doomed);
    fs::rename(&root, &doomed)?;
    let _ = fs::remove_dir_all(&doomed);
    Ok(())
}

/// What an interrupted take_backup or drop_backup left: the half-written copy, and the renamed
/// backup (copies of vault.key and the old plaintext databases). Run at every start, before the
/// detection; failures are retried at the next one.
pub(crate) fn remove_leftovers(base: &Path) {
    let _ = fs::remove_dir_all(base.join(format!("{BACKUP_DIR}.delete")));
    let _ = remove_if_exists(&base.join(format!("{BACKUP_DIR}.partial")));
    // Half-written copies of a restore (copy_back) and of a re-encryption (rekey.rs rekey_file), with
    // their WAL and SHM: plaintext ones too. Never the only copy: the backup, or the original, is
    // still there when they are left behind.
    let temp = |name: &str| name.contains(".rekey-") || name.ends_with(".restoring");
    let mut dirs = vec![base.to_path_buf()];
    if let Ok(ids) = names(&base.join("workspaces")) {
        dirs.extend(ids.into_iter().map(|id| base.join("workspaces").join(id)));
    }
    for dir in dirs {
        for name in names(&dir).unwrap_or_default().into_iter().filter(|name| temp(name)) {
            let _ = remove_if_exists(&dir.join(name));
        }
    }
}

/// Moves `names` that exist in `base` into KEPT_DIR, in that order. Nothing there is replaced: a
/// name already taken gets the time as a suffix (rename would replace a file on every system).
fn keep(base: &Path, names: &[&str]) -> io::Result<()> {
    let kept = base.join(KEPT_DIR);
    private_dir(&kept)?;
    let stamp = now_ms();
    for name in names {
        let file = base.join(name);
        if fs::symlink_metadata(&file).is_err() {
            continue;
        }
        let mut target = kept.join(name);
        let mut n = 0;
        while fs::symlink_metadata(&target).is_ok() {
            n += 1;
            target = kept.join(format!("{name}.{stamp}-{n}"));
        }
        fs::rename(&file, target)?;
    }
    Ok(())
}

/// An unsplit getssh.db and the app key that opens it, moved together. The key goes first: a
/// crash in between leaves getssh.db here and the key in KEPT_DIR, and the next attempt (the
/// backup is still there) moves getssh.db after it, while the reverse order would let it delete
/// the key of a getssh.db it no longer sees.
fn keep_unsplit(base: &Path) -> io::Result<()> {
    keep(base, &["app_key.enc", "app_key.txt", "getssh.db-wal", "getssh.db-shm", "getssh.db"])
}

/// Legacy files found after the app has started under a master password (Store::start_with).
/// A backup is moved away whole: the data has changed since it was taken, and restoring it
/// later would bring back old files. The app key goes with an unsplit getssh.db, or alone.
pub(crate) fn set_aside_after_start(base: &Path) -> StoreResult<()> {
    let root = base.join(BACKUP_DIR);
    if root.exists() {
        let kept = base.join(KEPT_DIR);
        private_dir(&kept)?;
        fs::rename(&root, kept.join(format!("backup-{}", now_ms())))?;
    }
    keep_unsplit(base)?;
    Ok(())
}

// ───────────────────────────────────── test hooks ─────────────────────────────────────

/// Failures at named points of the migration, for tests only: an error (the backup is
/// restored) or a panic, which stands for a crash (nothing is restored).
#[cfg(test)]
pub(crate) mod faults {
    use std::cell::Cell;

    use crate::error::{Code, StoreError, StoreResult};

    thread_local! {
        static ARMED: Cell<Option<(&'static str, bool)>> = const { Cell::new(None) };
    }

    pub(crate) fn fail_at(point: &'static str) {
        ARMED.with(|armed| armed.set(Some((point, false))));
    }

    pub(crate) fn crash_at(point: &'static str) {
        ARMED.with(|armed| armed.set(Some((point, true))));
    }

    pub(super) fn check(point: &str) -> StoreResult<()> {
        match ARMED.with(|armed| armed.get()) {
            Some((armed, crash)) if armed == point => {
                ARMED.with(|armed| armed.set(None));
                if crash {
                    panic!("simulated crash at {point}");
                }
                Err(StoreError::new(Code::Io, format!("simulated failure at {point}")))
            }
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
use faults::check as fault;

#[cfg(not(test))]
fn fault(_point: &str) -> StoreResult<()> {
    Ok(())
}

#[cfg(test)]
mod unit {
    use super::*;

    #[test]
    fn numbers_print_like_javascript() {
        for (value, text) in [(0.0, "0"), (-0.0, "0"), (22.0, "22"), (1.5, "1.5"), (1e20, "100000000000000000000"), (1e21, "1e+21"), (1.5e-7, "1.5e-7"), (0.000001, "0.000001"), (-3.0, "-3"), (123456789012345680000.0, "123456789012345680000")] {
            assert_eq!(js_number(value), text, "{value}");
        }
    }

    #[test]
    fn file_patterns_match_the_typescript_regular_expressions() {
        for name in ["main.db", "main.db-wal", "getssh.db-shm", "getssh.db.migrated", "getssh.db.migrated-wal", "workspace_a.db", "workspace_a.db-shm", "workspace_.db.db", "app_key.enc", "app_key.txt"] {
            assert!(backed_up(name), "{name}");
        }
        for name in ["main.db-journal", "workspace_.db", "workspace_a.db.split", "keyring.json", "app_key.bak", "app-config.json", "main.dbx"] {
            assert!(!backed_up(name), "{name}");
        }
        assert_eq!(sidecar_of("main.db-journal"), Some("main.db"));
        assert_eq!(sidecar_of("getssh.db.migrated-shm"), Some("getssh.db.migrated"));
        assert_eq!(sidecar_of(".db-wal"), None);
        assert_eq!(sidecar_of("main.db"), None);
    }

    #[test]
    fn an_empty_workspace_password_is_never_used() {
        let secrets = LegacySecrets {
            app_key: None,
            workspace_passwords: [("a", ""), ("b", "pw")].into_iter().map(|(id, p)| (id.to_string(), Zeroizing::new(p.to_string()))).collect(),
        };
        assert!(secrets.validate().is_ok());
        assert!(secrets.workspace_password("a").is_none());
        assert_eq!(secrets.workspace_password("b").map(|p| p.as_str()), Some("pw"));
    }

    #[test]
    fn a_copy_replaces_its_target_whole_and_clears_a_stale_temp() {
        let dir = std::env::temp_dir().join(format!("gs-copy-{}", getssh_keystore::crypto::random_id()));
        fs::create_dir_all(&dir).unwrap();
        let (source, temp, target) = (dir.join("source"), dir.join("target.restoring"), dir.join("target"));
        fs::write(&source, b"whole").unwrap();
        fs::write(&target, b"the old, longer contents").unwrap();
        fs::write(&temp, b"half").unwrap();
        copy_through(&source, &temp, &target).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"whole");
        assert!(!temp.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn profile_ids_are_the_md5_of_host_and_username() {
        // node -e "crypto.createHash('md5').update('router.lan:root').digest('hex')"
        assert_eq!(md5_hex("router.lan:root"), "6a5b926a18cee72698207819024201b7");
        assert_eq!(md5_hex(&format!("{}:root", js_number(1.0))), "bc98981cdd54b7923b7fc54e0e69713b");
    }
}
