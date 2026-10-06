//! Tests of the migration of data written by GETSSH 3.0 development builds (legacy.rs), on the
//! software device. The layouts are written with this crate's engine the way those builds wrote
//! them; tests/fixtures/legacy-bsmc holds files written by better-sqlite3-multiple-ciphers itself.

use std::collections::BTreeMap;
use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

use getssh_keystore::device::fake::FakeDevice;
use zeroize::Zeroizing;

use crate::error::Code;
use crate::legacy::{faults, needs_migration, LegacySecrets, BACKUP_DIR, KEPT_DIR};
use crate::sqlite::{Connection, Key, Mode};
use crate::store::{StartReport, Store};
use crate::profiles::SecretUpdate;
use crate::tests::{profile, pw, Env};

/// legacyDatabase.ts runMainMigrations.
const LEGACY_MAIN: &str = "CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, themeColor TEXT, hasPassword INTEGER DEFAULT 0, \
    biometric_enabled INTEGER DEFAULT 0, is_main INTEGER DEFAULT 0, preferences TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); \
    CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT);";

/// legacyDatabase.ts runWorkspaceMigrations.
const LEGACY_WORKSPACE: &str = "CREATE TABLE profiles (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, host TEXT NOT NULL, username TEXT NOT NULL, \
    password TEXT, privateKeyPath TEXT, passphrase TEXT, port INTEGER DEFAULT 22, autoStart INTEGER DEFAULT 0, alias TEXT, osType TEXT); \
    CREATE TABLE runbooks (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, script TEXT NOT NULL, riskLevel TEXT DEFAULT 'LOW', created_at INTEGER NOT NULL); \
    CREATE TABLE ai_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); \
    CREATE TABLE ai_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, raw_content TEXT, timestamp INTEGER NOT NULL, \
    FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE);";

/// getssh.db as DatabaseManager.ts of e65aed4 wrote it (no passphrase column), plus is_main.
const LEGACY_GETSSH: &str = "CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, themeColor TEXT, hasPassword INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); \
    CREATE TABLE profiles (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, host TEXT NOT NULL, username TEXT NOT NULL, password TEXT, privateKeyPath TEXT, port INTEGER DEFAULT 22, \
    autoStart INTEGER DEFAULT 0, alias TEXT, osType TEXT, FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE); \
    CREATE TABLE runbooks (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, script TEXT NOT NULL, riskLevel TEXT DEFAULT 'LOW', created_at INTEGER NOT NULL); \
    CREATE TABLE ai_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); \
    CREATE TABLE ai_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, raw_content TEXT, timestamp INTEGER NOT NULL); \
    ALTER TABLE workspaces ADD COLUMN is_main INTEGER DEFAULT 0;";

/// The app key of the e2e test: 64 hex characters, used as a SQLCipher passphrase.
fn app_key() -> String {
    "ab".repeat(32)
}

fn secrets(app_key: Option<&str>, passwords: &[(&str, &str)]) -> LegacySecrets {
    LegacySecrets {
        app_key: app_key.map(|k| Zeroizing::new(k.to_string())),
        workspace_passwords: passwords.iter().map(|(id, password)| (id.to_string(), Zeroizing::new(password.to_string()))).collect(),
    }
}

/// What Electron decrypts for development_layout().
fn layout_secrets() -> LegacySecrets {
    secrets(Some(&app_key()), &[("secret", "secret-pw-1")])
}

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

fn report(migrated: &[&str], deferred: &[&str], presence: &[&str], failed: &[&str]) -> StartReport {
    StartReport { migrated_workspaces: ids(migrated), deferred_workspaces: ids(deferred), presence_to_reenable: ids(presence), failed_workspaces: ids(failed) }
}

fn is_plain(file: &Path) -> bool {
    fs::read(file).is_ok_and(|bytes| bytes.starts_with(b"SQLite format 3\0"))
}

/// main.db with rows (id, hasPassword, biometric_enabled, is_main), in WAL mode as those builds kept it.
fn write_main(dir: &Path, key: &Key<'_>, rows: &[(&str, i64, i64, i64)]) {
    let conn = Connection::open(&dir.join("main.db"), key, Mode::Create).unwrap();
    conn.execute_batch(&format!("PRAGMA journal_mode = WAL; {LEGACY_MAIN}")).unwrap();
    for (i, (id, has_password, biometric, is_main)) in rows.iter().enumerate() {
        let at = i as i64 + 1;
        conn.execute(
            "INSERT INTO workspaces (id, name, hasPassword, biometric_enabled, is_main, preferences, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '{}', ?, ?)",
            &[(*id).into(), format!("Workspace {id}").into(), (*has_password).into(), (*biometric).into(), (*is_main).into(), at.into(), at.into()],
        )
        .unwrap();
    }
}

/// workspace_<id>.db with profiles (id, host, username, password).
fn write_workspace(dir: &Path, workspace: &str, key: &Key<'_>, profiles: &[(&str, &str, &str, &str)]) {
    let conn = Connection::open(&dir.join(format!("workspace_{workspace}.db")), key, Mode::Create).unwrap();
    conn.execute_batch(&format!("PRAGMA journal_mode = WAL; {LEGACY_WORKSPACE}")).unwrap();
    for (id, host, username, password) in profiles {
        conn.execute(
            "INSERT INTO profiles (id, workspace_id, host, username, password) VALUES (?, ?, ?, ?, ?)",
            &[(*id).into(), workspace.into(), (*host).into(), (*username).into(), (*password).into()],
        )
        .unwrap();
    }
}

/// A safeStorage blob; the migration only checks that it exists (Electron decrypts it).
fn write_vault_key(dir: &Path, workspace: &str) {
    let folder = dir.join("workspaces").join(workspace);
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join("vault.key"), b"GETSSH-SS1:opaque blob").unwrap();
}

/// The layout the keystore e2e test writes (entry.ts writeLegacyLayout).
fn development_layout(dir: &Path) {
    let key = app_key();
    fs::write(dir.join("app_key.enc"), b"GETSSH-SS1:opaque blob").unwrap();
    write_main(dir, &Key::Passphrase(key.as_bytes()), &[("default", 0, 0, 1), ("secret", 1, 1, 0), ("lost", 1, 0, 0)]);
    write_workspace(dir, "default", &Key::Plain, &[("p1", "router.lan", "root", "hunter2")]);
    write_workspace(dir, "secret", &Key::Passphrase(b"secret-pw-1"), &[("p2", "prod.example", "admin", "topsecret")]);
    write_vault_key(dir, "secret");
    write_workspace(dir, "lost", &Key::Passphrase(b"abc"), &[("p3", "old.example", "old", "x")]);
}

/// getssh.db of the builds before main.db, keyed with the app key.
fn write_getssh_db(dir: &Path) {
    let key = app_key();
    let conn = Connection::open(&dir.join("getssh.db"), &Key::Passphrase(key.as_bytes()), Mode::Create).unwrap();
    conn.execute_batch(&format!("PRAGMA journal_mode = WAL; {LEGACY_GETSSH}")).unwrap();
    conn.execute_batch(
        "INSERT INTO workspaces (id, name, themeColor, hasPassword, created_at, updated_at, is_main) VALUES ('default', 'Default Workspace', '#1e293b', 0, 1, 1, 1), ('team', 'Team', NULL, 0, 2, 2, 0);
         INSERT INTO profiles (id, workspace_id, host, username, password, port, autoStart, alias) VALUES ('p1', 'default', 'router.lan', 'root', 'hunter2', 2222, 1, 'Router'), ('p2', 'team', 'db.internal', 'admin', 'dbpass', 22, 0, NULL);
         INSERT INTO runbooks (id, workspace_id, title, script, riskLevel, created_at) VALUES ('r1', 'team', 'Restart', 'systemctl restart app', 'HIGH', 5);
         INSERT INTO ai_sessions (id, workspace_id, title, created_at, updated_at) VALUES ('s1', 'default', 'Chat', 3, 4);
         INSERT INTO ai_messages (id, session_id, role, content, raw_content, timestamp) VALUES ('m1', 's1', 'user', 'hello', NULL, 3), ('m2', 's1', 'assistant', 'hi', 'raw hi', 4);",
    )
    .unwrap();
}

/// "host:password" of every profile of a workspace, read through the store.
fn logins(store: &Store<FakeDevice>, workspace: &str) -> Vec<String> {
    store
        .list_profiles(workspace)
        .unwrap()
        .into_iter()
        .map(|p| {
            let password = store.connect_secrets(workspace, &p.id).unwrap().password.map(|v| String::from_utf8(v.to_vec()).unwrap()).unwrap_or_default();
            format!("{}:{password}", p.host)
        })
        .collect()
}

/// Every file under `dir`, by relative path.
fn snapshot(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<PathBuf, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                out.insert(path.strip_prefix(root).unwrap().to_path_buf(), fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

/// Every file of `before` is unchanged and the only new ones are the keyring and the backup.
fn assert_restored(dir: &Path, before: &BTreeMap<PathBuf, Vec<u8>>) {
    let after = snapshot(dir);
    for (path, bytes) in before {
        assert!(after.get(path) == Some(bytes), "{} changed or disappeared", path.display());
    }
    let new: Vec<_> = after.keys().filter(|p| !before.contains_key(*p) && !p.starts_with(BACKUP_DIR) && *p != Path::new("keyring.json")).collect();
    assert!(new.is_empty(), "left behind: {new:?}");
}

fn has_scope(store: &Store<FakeDevice>, scope: &str) -> bool {
    store.keystore().status().scopes.iter().any(|s| s.id == scope)
}

// ───────────────────────────────────── the e2e layout ─────────────────────────────────────

#[test]
fn the_development_layout_moves_to_the_keystore() {
    let env = Env::new();
    development_layout(&env.dir);
    let store = env.open();
    assert!(store.needs_legacy_migration());
    assert_eq!(store.start().unwrap_err().code, Code::Unavailable, "the secrets only Electron can read are needed");
    assert!(!env.dir.join("keyring.json").exists());

    // Each id appears once: after_unlock does not list 'lost' (needs_password) a second time.
    let migrated = store.start_with(Some(&layout_secrets())).unwrap();
    assert_eq!(migrated, report(&["default", "secret"], &["lost"], &["secret"], &[]));
    for gone in ["app_key.enc", "workspaces/secret/vault.key", BACKUP_DIR] {
        assert!(!env.dir.join(gone).exists(), "{gone}");
    }
    assert!(env.dir.join("workspaces/secret").is_dir(), "the workspace directory stays");
    assert!(!store.needs_legacy_migration());
    assert!(store.app_state().ready);

    // main.db and the plain workspace use keystore keys now.
    assert!(Connection::open(&env.dir.join("main.db"), &Key::Passphrase(app_key().as_bytes()), Mode::ReadOnly).is_err());
    assert!(!is_plain(&env.dir.join("workspace_default.db")));
    assert_eq!(logins(&store, "default"), ["router.lan:hunter2"]);

    // The password workspace keeps its password and is locked after the start.
    let secret = store.workspace("secret").unwrap();
    assert!(!secret.open && secret.has_password);
    assert_eq!(store.unlock_workspace("secret", pw("wrong-pw")).unwrap_err().code, Code::WrongPassword);
    store.unlock_workspace("secret", pw("secret-pw-1")).unwrap();
    assert_eq!(logins(&store, "secret"), ["prod.example:topsecret"]);

    // Without vault.key it waits for its password; a 3-character one from those builds still works.
    assert!(!store.workspace("lost").unwrap().open);
    assert_eq!(store.unlock_workspace("lost", pw("nope")).unwrap_err().code, Code::WrongPassword);
    store.unlock_workspace("lost", pw("abc")).unwrap();
    assert_eq!(logins(&store, "lost"), ["old.example:x"]);
    assert!(store.workspace("lost").unwrap().has_password);

    // Only migrated rows get new flags; the Touch ID flag is reported instead of kept.
    let flags = store
        .with_main(|c| Ok(c.query_map("SELECT id, hasPassword, biometric_enabled FROM workspaces ORDER BY created_at", &[], |r| Ok((r.text(0)?.unwrap(), r.integer(1)?, r.integer(2)?)))?))
        .unwrap();
    assert_eq!(flags, [("default".to_string(), 0, 0), ("secret".to_string(), 1, 0), ("lost".to_string(), 1, 0)]);
    drop(store);

    // Nothing is left to migrate; secrets passed anyway are checked and ignored.
    let store = env.open();
    assert!(!store.needs_legacy_migration());
    assert_eq!(store.start_with(Some(&layout_secrets())).unwrap(), StartReport::default());
    assert_eq!(logins(&store, "default"), ["router.lan:hunter2"]);
}

#[test]
fn app_key_txt_is_the_passphrase_as_written() {
    let env = Env::new();
    // Read with readFileSync(…, 'utf8') and used untrimmed: the newline is part of the passphrase.
    let key = format!("{}\n", app_key());
    fs::write(env.dir.join("app_key.txt"), &key).unwrap();
    write_main(&env.dir, &Key::Passphrase(key.as_bytes()), &[("default", 0, 0, 1)]);
    write_workspace(&env.dir, "default", &Key::Plain, &[("p1", "router.lan", "root", "hunter2")]);
    let store = env.open();
    assert_eq!(store.start_with(Some(&LegacySecrets::default())).unwrap(), report(&["default"], &[], &[], &[]));
    assert!(!env.dir.join("app_key.txt").exists());
    assert_eq!(logins(&store, "default"), ["router.lan:hunter2"]);
}

#[test]
fn a_plaintext_main_db_is_encrypted_even_next_to_an_app_key() {
    let env = Env::new();
    // The header decides: a plaintext main.db stays plaintext until the move (legacyDatabase.ts).
    fs::write(env.dir.join("app_key.txt"), app_key()).unwrap();
    write_main(&env.dir, &Key::Plain, &[("default", 0, 0, 1), ("work", 0, 0, 0)]);
    write_workspace(&env.dir, "default", &Key::Plain, &[("p1", "router.lan", "root", "hunter2")]);
    let store = env.open();
    // A row without a database file still counts as migrated (it gets an empty one).
    assert_eq!(store.start_with(Some(&LegacySecrets::default())).unwrap(), report(&["default", "work"], &[], &[], &[]));
    assert!(!is_plain(&env.dir.join("main.db")));
    assert!(!env.dir.join("app_key.txt").exists());
    assert_eq!(logins(&store, "default"), ["router.lan:hunter2"]);
    assert!(store.workspace("work").unwrap().open);
}

#[test]
fn getssh_db_is_split_into_main_and_workspace_databases() {
    let env = Env::new();
    fs::write(env.dir.join("app_key.enc"), b"GETSSH-SS1:opaque blob").unwrap();
    write_getssh_db(&env.dir);
    // A crash in the middle of the split leaves only temporary files: the next start splits again.
    {
        let store = env.open();
        faults::crash_at("split");
        assert!(catch_unwind(AssertUnwindSafe(|| store.start_with(Some(&secrets(Some(&app_key()), &[]))))).is_err());
    }
    assert!(!env.dir.join("main.db").exists() && env.dir.join("main.db.split").exists() && env.dir.join("getssh.db").exists());

    let store = env.open();
    assert!(store.needs_legacy_migration(), "the keyring exists, and so does the backup");
    assert_eq!(store.start_with(Some(&secrets(Some(&app_key()), &[]))).unwrap(), report(&["default", "team"], &[], &[], &[]));
    for gone in ["getssh.db", "getssh.db.migrated", "getssh.db.migrated-wal", "app_key.enc", "main.db.split", "workspace_default.db.split", BACKUP_DIR] {
        assert!(!env.dir.join(gone).exists(), "{gone}");
    }

    let main = store.workspace("default").unwrap();
    assert_eq!((main.name.as_str(), main.theme_color.as_deref(), main.is_main), ("Default Workspace", Some("#1e293b"), true));
    assert_eq!(logins(&store, "default"), ["router.lan:hunter2"]);
    let router = &store.list_profiles("default").unwrap()[0];
    assert_eq!((router.port, router.auto_start, router.alias.as_deref(), router.has_passphrase), (2222, true, Some("Router"), false));
    assert_eq!(logins(&store, "team"), ["db.internal:dbpass"]);
    let runbooks = store.get_runbooks("team").unwrap();
    assert_eq!((runbooks.len(), runbooks[0].title.as_str(), runbooks[0].risk_level.as_str()), (1, "Restart", "HIGH"));
    let chats = store.get_ai_sessions("default").unwrap();
    assert_eq!(chats.len(), 1);
    let messages: Vec<_> = chats[0].messages.iter().map(|m| (m.role.as_str(), m.content.as_str(), m.raw_content.as_deref())).collect();
    assert_eq!(messages, [("user", "hello", None), ("assistant", "hi", Some("raw hi"))]);
}

#[test]
fn a_split_that_stopped_before_its_last_rename_is_finished() {
    let env = Env::new();
    fs::write(env.dir.join("app_key.enc"), b"GETSSH-SS1:opaque blob").unwrap();
    write_getssh_db(&env.dir);
    let key = secrets(Some(&app_key()), &[]);
    {
        let store = env.open();
        faults::crash_at("split renamed");
        assert!(catch_unwind(AssertUnwindSafe(|| store.start_with(Some(&key)))).is_err());
    }
    // getssh.db is getssh.db.migrated already; main.db is complete but still has its temporary name.
    assert!(!env.dir.join("getssh.db").exists() && env.dir.join("getssh.db.migrated").exists());
    assert!(!env.dir.join("main.db").exists() && env.dir.join("main.db.split").exists());
    let store = env.open();
    assert_eq!(store.start_with(Some(&key)).unwrap(), report(&["default", "team"], &[], &[], &[]));
    for gone in ["main.db.split", "getssh.db.migrated", "app_key.enc", BACKUP_DIR] {
        assert!(!env.dir.join(gone).exists(), "{gone}");
    }
    assert_eq!(logins(&store, "team"), ["db.internal:dbpass"]);
}

#[test]
fn an_install_from_the_json_era_is_imported() {
    let env = Env::new();
    let write = |path: &str, text: &str| {
        let file = env.dir.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, text).unwrap();
    };
    // A boolean cannot be bound: that row stops profiles.json, the rows before it stay.
    write(
        "workspaces/default/profiles.json",
        r#"[{"host":"router.lan","username":"root","password":"hunter2","port":0,"autoStart":1},{"host":"db","username":"u","password":true},{"host":"after","username":"x"}]"#,
    );
    write("workspaces/default/runbooks.json", r#"[{"id":7,"title":"Uptime","script":"uptime"}]"#);
    write("workspaces/default/ai_chats.json", r#"{"id":"c1","title":"","updatedAt":5,"messages":[{"id":"m1","role":"user","content":"hi"}]}"#);
    write("workspaces/work/profiles.json", "not json");
    write("workspaces/work/runbooks.json", r#"[{"id":"r1","title":"Disk","script":"df -h","riskLevel":"HIGH","created_at":9}]"#);
    write("workspaces/notes.txt", "a file, not a workspace");
    write("app-config.json", r#"{"active_workspace":"work"}"#);

    let store = env.open();
    assert!(store.needs_legacy_migration());
    assert_eq!(store.start().unwrap_err().code, Code::Unavailable);
    assert_eq!(store.start_with(Some(&LegacySecrets::default())).unwrap(), report(&["default", "work"], &[], &[], &[]));
    assert!(!store.needs_legacy_migration(), "the JSON files stay, the keyring marks the move as done");
    assert!(env.dir.join("workspaces/default/profiles.json").exists());

    assert!(store.workspace("work").unwrap().is_main && !store.workspace("default").unwrap().is_main);
    assert_eq!(store.workspace("default").unwrap().name, "Default Workspace");
    let profiles = store.list_profiles("default").unwrap();
    assert_eq!(profiles.len(), 1);
    // crypto.createHash('md5').update('router.lan:root').digest('hex'); port 0 || 22; autoStart 1 → true
    assert_eq!((profiles[0].id.as_str(), profiles[0].port, profiles[0].auto_start), ("6a5b926a18cee72698207819024201b7", 22, true));
    assert_eq!(logins(&store, "default"), ["router.lan:hunter2"]);
    // better-sqlite3 binds JavaScript numbers as REAL, so a numeric id became the text "7.0".
    let runbook = &store.get_runbooks("default").unwrap()[0];
    assert_eq!((runbook.id.as_str(), runbook.risk_level.as_str()), ("7.0", "LOW"));
    let chat = &store.get_ai_sessions("default").unwrap()[0];
    assert_eq!((chat.id.as_str(), chat.title.as_str(), chat.created_at, chat.messages.len()), ("c1", "Migration Chat", 5.0, 1));
    assert!(store.list_profiles("work").unwrap().is_empty());
    assert_eq!(store.get_runbooks("work").unwrap()[0].title, "Disk");
}

#[test]
fn an_empty_install_without_workspaces_gets_a_default_one() {
    let env = Env::new();
    write_main(&env.dir, &Key::Plain, &[]);
    let store = env.open();
    assert_eq!(store.start_with(Some(&LegacySecrets::default())).unwrap(), report(&["default"], &[], &[], &[]));
    assert!(store.workspace("default").unwrap().is_main);
}

#[test]
fn an_unsplit_getssh_db_is_kept_with_its_app_key_and_migrates_once() {
    // main.db and getssh.db side by side: an older build stopped splitting and went on with a
    // partial main.db. getssh.db opens only with the app key, so both are kept, away from the
    // detection: left in place they made every start migrate again, and once a master password
    // was set, every start fail.
    let env = Env::new();
    fs::write(env.dir.join("app_key.enc"), b"GETSSH-SS1:opaque blob").unwrap();
    write_getssh_db(&env.dir);
    write_main(&env.dir, &Key::Passphrase(app_key().as_bytes()), &[("default", 0, 0, 1)]);
    let store = env.open();
    assert_eq!(store.start_with(Some(&secrets(Some(&app_key()), &[]))).unwrap(), report(&["default"], &[], &[], &[]));
    for gone in ["app_key.enc", "getssh.db", "getssh.db-wal", BACKUP_DIR] {
        assert!(!env.dir.join(gone).exists(), "{gone}");
    }
    let kept = env.dir.join(KEPT_DIR);
    assert_eq!(fs::read(kept.join("app_key.enc")).unwrap(), b"GETSSH-SS1:opaque blob");
    assert!(Connection::open(&kept.join("getssh.db"), &Key::Passphrase(app_key().as_bytes()), Mode::ReadOnly).is_ok());
    assert!(!store.needs_legacy_migration());

    store.set_master_password("a-master-password", None).unwrap();
    drop(store);
    let store = env.open();
    assert_eq!(store.start_with(Some(&secrets(Some(&app_key()), &[]))).unwrap(), StartReport::default());
    assert!(!store.app_state().ready);
    store.unlock_app(pw("a-master-password")).unwrap();
    assert!(store.app_state().ready);
}

#[test]
fn leftovers_found_under_a_master_password_are_set_aside_not_migrated() {
    // A backup and an app key next to a started app with a master password: what is left is not
    // resumed (it would need the locked app key), the backup is never restored over newer data,
    // and the start goes on to the lock screen instead of failing.
    let env = Env::new();
    let store = env.started();
    store.save_profiles("default", &[profile("new", SecretUpdate::Keep)]).unwrap();
    store.set_master_password("a-master-password", None).unwrap();
    drop(store);
    let stale = env.dir.join(BACKUP_DIR);
    fs::create_dir_all(&stale).unwrap();
    fs::write(stale.join("main.db"), vec![0x5a; 4096]).unwrap();
    fs::write(env.dir.join("app_key.txt"), app_key()).unwrap();
    // Kept earlier: never replaced.
    fs::create_dir_all(env.dir.join(KEPT_DIR)).unwrap();
    fs::write(env.dir.join(KEPT_DIR).join("app_key.txt"), b"first-key").unwrap();
    let main_before = fs::read(env.dir.join("main.db")).unwrap();

    let store = env.open();
    assert!(store.needs_legacy_migration());
    assert_eq!(store.start().unwrap(), StartReport::default());
    assert!(!store.needs_legacy_migration());
    assert_eq!(fs::read(env.dir.join("main.db")).unwrap(), main_before);
    let kept = env.dir.join(KEPT_DIR);
    assert_eq!(fs::read(kept.join("app_key.txt")).unwrap(), b"first-key");
    let moved: Vec<_> = fs::read_dir(&kept).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with("app_key.txt.")).collect();
    assert_eq!(moved.len(), 1);
    assert_eq!(fs::read(moved[0].path()).unwrap(), app_key().as_bytes());
    let backups: Vec<_> = fs::read_dir(&kept).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with("backup-")).collect();
    assert_eq!(backups.len(), 1);
    assert_eq!(fs::read(backups[0].path().join("main.db")).unwrap(), vec![0x5a; 4096]);
    store.unlock_app(pw("a-master-password")).unwrap();
    assert_eq!(logins(&store, "default"), ["new.example:"]);
}

// ─────────────────────────────── failures, restores and reruns ───────────────────────────────

#[test]
fn a_crashed_migration_resumes_from_its_backup() {
    let env = Env::new();
    development_layout(&env.dir);
    let before = snapshot(&env.dir);
    {
        let store = env.open();
        faults::crash_at("workspaces moved");
        assert!(catch_unwind(AssertUnwindSafe(|| store.start_with(Some(&layout_secrets())))).is_err());
    }
    // The backup has the layout of the TypeScript version and the original bytes.
    let backup = snapshot(&env.dir.join(BACKUP_DIR));
    let names: Vec<_> = backup.keys().map(|p| p.to_string_lossy().into_owned()).filter(|n| n != ".complete").collect();
    assert!(backup.contains_key(Path::new(".complete")), "marked complete");
    assert_eq!(names, ["app_key.enc", "main.db", "workspace_default.db", "workspace_lost.db", "workspace_secret.db", "workspaces/secret/vault.key"]);
    for (path, bytes) in backup.iter().filter(|(p, _)| *p != Path::new(".complete")) {
        assert!(before.get(path) == Some(bytes), "{}", path.display());
    }
    assert!(env.dir.join("app_key.enc").exists() && env.dir.join("workspaces/secret/vault.key").exists());

    // The keyring already has the app and workspace scopes; the rerun finishes the job.
    let store = env.open();
    assert!(store.needs_legacy_migration());
    assert!(has_scope(&store, "ws:default") && has_scope(&store, "ws:secret"));
    assert_eq!(store.start_with(Some(&layout_secrets())).unwrap(), report(&["default", "secret"], &["lost"], &["secret"], &[]));
    assert!(!env.dir.join(BACKUP_DIR).exists() && !env.dir.join("app_key.enc").exists());
    assert_eq!(logins(&store, "default"), ["router.lan:hunter2"]);
    store.unlock_workspace("secret", pw("secret-pw-1")).unwrap();
    assert_eq!(logins(&store, "secret"), ["prod.example:topsecret"]);
}

#[test]
fn a_damaged_workspace_fails_alone_and_keeps_its_scope() {
    let env = Env::new();
    development_layout(&env.dir);
    fs::write(env.dir.join("workspace_default.db"), vec![0x5a; 4096]).unwrap();
    let store = env.open();
    // Reported once, as failed: after_unlock does not add it again.
    assert_eq!(store.start_with(Some(&layout_secrets())).unwrap(), report(&["secret"], &["lost"], &["secret"], &["default"]));
    assert_eq!(fs::read(env.dir.join("workspace_default.db")).unwrap(), vec![0x5a; 4096], "left exactly as it was");
    // The scope created before the failed rekey stays, so the workspace does not turn into one
    // that asks for a pre-3.0 password it never had.
    assert!(has_scope(&store, "ws:default"));
    store.unlock_workspace("secret", pw("secret-pw-1")).unwrap();
    drop(store);
    let store = env.open();
    assert_eq!(store.start().unwrap(), report(&[], &["lost"], &[], &["default"]));
}

#[test]
fn a_damaged_main_db_restores_every_file() {
    let env = Env::new();
    development_layout(&env.dir);
    fs::write(env.dir.join("main.db"), vec![0x5a; 4096]).unwrap();
    let before = snapshot(&env.dir);
    // Twice: the second attempt reuses the backup of the first and restores the same bytes.
    for _ in 0..2 {
        let store = env.open();
        assert_eq!(store.start_with(Some(&layout_secrets())).unwrap_err().code, Code::Corrupt);
        assert_restored(&env.dir, &before);
        assert!(store.needs_legacy_migration());
    }
}

#[test]
fn a_failed_attempt_removes_the_databases_it_created() {
    // The split: main.db, the workspace databases and getssh.db.migrated are new.
    let env = Env::new();
    fs::write(env.dir.join("app_key.enc"), b"GETSSH-SS1:opaque blob").unwrap();
    write_getssh_db(&env.dir);
    let before = snapshot(&env.dir);
    let key = secrets(Some(&app_key()), &[]);
    for point in ["split", "split renamed", "main.db moved", "workspaces moved"] {
        let store = env.open();
        faults::fail_at(point);
        assert_eq!(store.start_with(Some(&key)).unwrap_err().code, Code::Io, "{point}");
        assert_restored(&env.dir, &before);
    }
    // Otherwise the next attempt would find main.db and skip the split.
    assert_eq!(env.open().start_with(Some(&key)).unwrap(), report(&["default", "team"], &[], &[], &[]));

    // The JSON import: main.db and workspace_default.db are new.
    let env = Env::new();
    let profiles = env.dir.join("workspaces/default/profiles.json");
    fs::create_dir_all(profiles.parent().unwrap()).unwrap();
    fs::write(&profiles, r#"[{"host":"router.lan","username":"root","password":"hunter2"}]"#).unwrap();
    let before = snapshot(&env.dir);
    let store = env.open();
    faults::fail_at("main.db moved");
    assert_eq!(store.start_with(Some(&LegacySecrets::default())).unwrap_err().code, Code::Io);
    assert_restored(&env.dir, &before);
    drop(store);
    let store = env.open();
    assert_eq!(store.start_with(Some(&LegacySecrets::default())).unwrap(), report(&["default"], &[], &[], &[]));
    assert_eq!(logins(&store, "default"), ["router.lan:hunter2"]);
}

#[test]
fn malformed_or_wrong_secrets_change_nothing() {
    let env = Env::new();
    development_layout(&env.dir);
    let before = snapshot(&env.dir);
    let store = env.open();
    for bad in [
        secrets(Some("zz"), &[]),
        secrets(Some(&"g".repeat(64)), &[]),
        secrets(Some(&format!("{}é", "a".repeat(62))), &[]),
        // app_key.enc exists, so its contents are required.
        secrets(None, &[("secret", "secret-pw-1")]),
    ] {
        assert_eq!(store.start_with(Some(&bad)).unwrap_err().code, Code::InvalidArgument);
    }
    assert_eq!(snapshot(&env.dir), before, "nothing was written");

    // Upper-case hex is valid; a key that does not open main.db restores everything.
    let wrong = secrets(Some(&"CD".repeat(32)), &[("secret", "secret-pw-1")]);
    assert_eq!(store.start_with(Some(&wrong)).unwrap_err().code, Code::Corrupt);
    assert_restored(&env.dir, &before);
    drop(store);
    // A workspace password the store cannot use (an id it rejects, an empty value) is left out
    // rather than failing every start: 'secret' then waits for its password.
    let unusable = secrets(Some(&app_key()), &[("../x", "pw"), ("work\u{85}", "pw"), ("secret", "")]);
    assert_eq!(env.open().start_with(Some(&unusable)).unwrap(), report(&["default"], &["secret", "lost"], &[], &[]));
}

#[test]
fn a_vault_key_that_does_not_open_the_database_defers_the_workspace() {
    let env = Env::new();
    development_layout(&env.dir);
    write_vault_key(&env.dir, "lost");
    let store = env.open();
    // 'lost' has a vault.key Electron could not decrypt (left out); 'secret' one with the wrong password.
    let report_ = store.start_with(Some(&secrets(Some(&app_key()), &[("secret", "not-the-password")]))).unwrap();
    assert_eq!(report_, report(&["default"], &["secret", "lost"], &[], &[]));
    assert!(!has_scope(&store, "ws:secret"));
    assert!(env.dir.join("workspaces/lost/vault.key").exists(), "kept until the workspace moves");
    // Typing the password moves it and deletes vault.key.
    store.unlock_workspace("lost", pw("abc")).unwrap();
    assert!(!env.dir.join("workspaces/lost/vault.key").exists());
    store.unlock_workspace("secret", pw("secret-pw-1")).unwrap();
    assert_eq!(logins(&store, "secret"), ["prod.example:topsecret"]);
}

#[test]
fn detection_follows_the_typescript_rules() {
    let cases: &[(&[&str], bool)] = &[
        (&[], false),
        (&["main.db"], true),
        (&["getssh.db"], true),
        (&["app_key.enc"], true),
        (&["app_key.txt"], true),
        (&["workspaces/w/profiles.json"], true),
        (&["workspaces/w/runbooks.json"], true),
        (&["workspaces/w/ai_chats.json"], true),
        (&["workspaces/w/vault.key"], false),
        (&["workspaces/w/notes.json"], false),
        (&["workspace_w.db", "app-config.json", "getssh.db.migrated"], false),
        // With a keyring only an interrupted migration counts; the JSON files are never deleted.
        (&["keyring.json", "main.db", "getssh.db", "workspaces/w/profiles.json"], false),
        (&["keyring.json", ".keystore-migration-backup/main.db"], true),
        (&["keyring.json", "app_key.enc"], true),
        (&["keyring.json", "app_key.txt"], true),
    ];
    for (files, expected) in cases {
        let env = Env::new();
        for file in *files {
            let path = env.dir.join(file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"x").unwrap();
        }
        assert_eq!(needs_migration(&env.dir), *expected, "{files:?}");
    }
}

// ───────────────────────────── crash windows outside the migration ─────────────────────────────

#[test]
fn a_plain_workspace_whose_adoption_stopped_is_encrypted_when_opened() {
    // adopt_workspace stopped between creating the scope and encrypting the file: its row in
    // adopting_workspaces says so.
    let env = Env::new();
    let store = env.started();
    write_workspace(&env.dir, "half", &Key::Plain, &[("p", "half.example", "u", "pw")]);
    store
        .with_main(|c| {
            c.execute("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('half', 'Half', 5, 5)", &[])?;
            c.execute("INSERT INTO adopting_workspaces (id) VALUES ('half')", &[])?;
            Ok(())
        })
        .unwrap();
    store.keystore().create_scope("ws:half", None).unwrap();
    drop(store);
    let store = env.started();
    assert!(store.workspace("half").unwrap().open);
    assert!(!is_plain(&env.dir.join("workspace_half.db")));
    assert_eq!(logins(&store, "half"), ["half.example:pw"]);
    let marks = store.with_main(|c| c.query_row("SELECT count(*) FROM adopting_workspaces", &[], |r| r.integer(0)).map_err(Into::into)).unwrap();
    assert_eq!(marks, 0, "the mark goes once the database is mounted");
}

#[test]
fn a_plaintext_file_put_in_place_of_a_workspace_database_is_refused() {
    // Without the mark, a plaintext database where an encrypted one belongs is not taken over:
    // SQLCipher's page authentication is what tells that the file was replaced.
    let env = Env::new();
    let store = env.started();
    store.create_workspace(Some("w"), "W", None, None).unwrap();
    store.save_profiles("w", &[profile("real", SecretUpdate::Keep)]).unwrap();
    drop(store);
    for id in ["w", "default"] {
        let file = env.dir.join(format!("workspace_{id}.db"));
        let _ = fs::remove_file(&file);
        write_workspace(&env.dir, id, &Key::Plain, &[("x", "attacker.example", "u", "pw")]);
    }
    let store = env.open();
    assert_eq!(store.start().unwrap(), report(&[], &[], &[], &["default", "w"]));
    assert!(is_plain(&env.dir.join("workspace_w.db")) && is_plain(&env.dir.join("workspace_default.db")), "left as they are");
    assert_eq!(store.list_profiles("w").unwrap_err().code, Code::Corrupt);
}

#[test]
fn a_password_workspace_whose_scope_exists_moves_when_unlocked() {
    // migrate_legacy_workspace stopped between creating the scope and re-encrypting the file.
    let env = Env::new();
    let store = env.started();
    write_workspace(&env.dir, "old", &Key::Passphrase(b"old-pw"), &[("p", "old.example", "u", "x")]);
    write_vault_key(&env.dir, "old");
    store
        .with_main(|c| {
            c.execute("INSERT INTO workspaces (id, name, hasPassword, created_at, updated_at) VALUES ('old', 'Old', 1, 5, 5)", &[])?;
            Ok(())
        })
        .unwrap();
    store.keystore().create_scope_with_legacy_password("ws:old", "old-pw").unwrap();
    drop(store);
    let store = env.started();
    assert!(!store.workspace("old").unwrap().open);
    assert_eq!(store.unlock_workspace("old", pw("wrong")).unwrap_err().code, Code::WrongPassword);
    store.unlock_workspace("old", pw("old-pw")).unwrap();
    assert_eq!(logins(&store, "old"), ["old.example:x"]);
    assert!(!env.dir.join("workspaces/old/vault.key").exists());
}

// ─────────────────────────────── files written by better-sqlite3 ───────────────────────────────

/// Golden files written by better-sqlite3-multiple-ciphers (tests/fixtures/legacy-bsmc, made by
/// make-fixtures.cjs there; versions.json names the engine): a main.db keyed with the 64-hex app
/// key, a password workspace, a plain workspace and an encrypted getssh.db.
#[test]
fn databases_written_by_better_sqlite3_migrate() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/legacy-bsmc");
    let copy = |env: &Env, names: &[&str]| {
        for name in names {
            fs::copy(fixtures.join(name), env.dir.join(name)).unwrap();
        }
        fs::write(env.dir.join("app_key.enc"), b"GETSSH-SS1:opaque blob").unwrap();
    };

    let env = Env::new();
    copy(&env, &["main.db", "workspace_default.db", "workspace_secret.db"]);
    write_vault_key(&env.dir, "secret");
    let store = env.open();
    assert_eq!(store.start_with(Some(&layout_secrets())).unwrap(), report(&["default", "secret"], &[], &["secret"], &[]));
    assert_eq!(logins(&store, "default"), ["router.lan:hunter2"]);
    store.unlock_workspace("secret", pw("secret-pw-1")).unwrap();
    assert_eq!(logins(&store, "secret"), ["prod.example:topsecret"]);
    assert_eq!(store.list_profiles("secret").unwrap()[0].port, 2222);
    assert_eq!(store.get_global_setting("language").unwrap().as_deref(), Some("zh-CN"));

    let env = Env::new();
    copy(&env, &["getssh.db"]);
    let store = env.open();
    assert_eq!(store.start_with(Some(&secrets(Some(&app_key()), &[]))).unwrap(), report(&["default", "team"], &[], &[], &[]));
    assert_eq!(logins(&store, "default"), ["router.lan:hunter2"]);
    assert_eq!(logins(&store, "team"), ["db.internal:dbpass"]);
    assert_eq!(store.get_runbooks("team").unwrap()[0].script, "systemctl restart app");
    assert_eq!(store.get_ai_sessions("default").unwrap()[0].messages.len(), 2);
    assert!(store.workspace("default").unwrap().is_main);
}

// ──────────────────────────────── found by the review of 10-06 ────────────────────────────────

/// A deferred password workspace ('lost' of development_layout) whose scope was created with its
/// password while the file kept that password as its passphrase: a move that failed or stopped.
fn half_moved_lost(store: &Store<FakeDevice>) {
    store.keystore().create_scope_with_legacy_password("ws:lost", "abc").unwrap();
}

#[test]
fn a_half_moved_password_workspace_asks_for_its_password_even_under_a_master_password() {
    let env = Env::new();
    development_layout(&env.dir);
    write_vault_key(&env.dir, "lost");
    let store = env.open();
    // vault.key is there, but Electron could not decrypt it: 'lost' is deferred.
    store.start_with(Some(&layout_secrets())).unwrap();
    // The first master password needs every workspace with its own password open.
    store.unlock_workspace("secret", pw("secret-pw-1")).unwrap();
    store.set_master_password("a-master-password", None).unwrap();
    half_moved_lost(&store);
    // Same session: the scope is unlocked in memory, the file does not open with its key.
    assert_eq!(store.open_workspace("lost").unwrap_err().code, Code::NeedsPassword);
    drop(store);

    let store = env.open();
    store.start().unwrap();
    // The master password opens the scope, the database still waits for its own password.
    store.unlock_app(pw("a-master-password")).unwrap();
    let lost = store.list_workspaces().unwrap().into_iter().find(|w| w.id == "lost").unwrap();
    assert!(!lost.open);
    assert_eq!(store.unlock_workspace("lost", pw("nope")).unwrap_err().code, Code::WrongPassword);
    store.unlock_workspace("lost", pw("abc")).unwrap();
    assert_eq!(logins(&store, "lost"), ["old.example:x"]);
    assert!(!env.dir.join("workspaces/lost/vault.key").exists(), "vault.key goes once the database opens with its key");
    // Under the master password the workspace's own password is dropped once it is open.
    assert!(!store.workspace("lost").unwrap().has_password);
    drop(store);
    let store = env.open();
    store.start().unwrap();
    store.unlock_app(pw("a-master-password")).unwrap();
    assert_eq!(logins(&store, "lost"), ["old.example:x"]);
}

#[test]
fn a_master_password_set_while_a_workspace_is_half_moved_keeps_its_password() {
    let env = Env::new();
    development_layout(&env.dir);
    let store = env.open();
    store.start_with(Some(&layout_secrets())).unwrap();
    store.unlock_workspace("secret", pw("secret-pw-1")).unwrap();
    half_moved_lost(&store);
    // 'lost' is unlocked but not mounted: its password is the only way to finish the move, so
    // setting the master password must not drop it.
    store.set_master_password("a-master-password", None).unwrap();
    assert!(store.keystore().status().scopes.iter().any(|s| s.id == "ws:lost" && s.own_password));
    store.unlock_workspace("lost", pw("abc")).unwrap();
    assert_eq!(logins(&store, "lost"), ["old.example:x"]);
    assert!(!store.workspace("lost").unwrap().has_password);
}

#[test]
fn a_half_moved_password_workspace_finishes_in_the_same_session_without_a_master_password() {
    let env = Env::new();
    development_layout(&env.dir);
    let store = env.open();
    store.start_with(Some(&layout_secrets())).unwrap();
    half_moved_lost(&store);
    store.unlock_workspace("lost", pw("abc")).unwrap();
    assert_eq!(logins(&store, "lost"), ["old.example:x"]);
}

#[test]
fn a_vault_key_left_after_its_move_is_deleted_at_the_next_unlock() {
    let env = Env::new();
    development_layout(&env.dir);
    write_vault_key(&env.dir, "lost");
    let store = env.open();
    store.start_with(Some(&layout_secrets())).unwrap();
    // The move finished, then the process stopped before vault.key was deleted.
    half_moved_lost(&store);
    store.move_to_scope_key(&env.dir.join("workspace_lost.db"), "ws:lost", &Key::Passphrase(b"abc")).unwrap();
    drop(store);
    // So did an earlier drop_backup and take_backup.
    fs::create_dir_all(env.dir.join(format!("{BACKUP_DIR}.delete/workspaces/x"))).unwrap();
    fs::write(env.dir.join(format!("{BACKUP_DIR}.delete/workspaces/x/vault.key")), b"blob").unwrap();
    fs::write(env.dir.join(format!("{BACKUP_DIR}.partial")), b"half a copy").unwrap();
    // And an interrupted restore and re-encryption (plaintext copies, possibly).
    let temps = ["workspace_default.db.restoring", "workspace_default.db.rekey-7-ab", "workspace_default.db.rekey-7-ab-wal", "workspaces/secret/vault.key.restoring"];
    for temp in temps {
        fs::write(env.dir.join(temp), b"router.lan hunter2").unwrap();
    }

    let store = env.started();
    assert!(!env.dir.join(format!("{BACKUP_DIR}.delete")).exists() && !env.dir.join(format!("{BACKUP_DIR}.partial")).exists());
    for temp in temps {
        assert!(!env.dir.join(temp).exists(), "{temp}");
    }
    assert!(env.dir.join("workspaces/lost/vault.key").exists());
    store.unlock_workspace("lost", pw("abc")).unwrap();
    assert!(!env.dir.join("workspaces/lost/vault.key").exists());
    assert_eq!(logins(&store, "lost"), ["old.example:x"]);
}

/// The id Ids::usable gives a workspace id the store refuses.
fn usable(id: &str) -> String {
    use md5::{Digest, Md5};
    let hex: String = Md5::digest(id.as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
    format!("ws-{}", &hex[..12])
}

#[test]
fn workspace_ids_the_store_refuses_get_valid_ones_and_keep_their_data() {
    // JSON era: a directory with a refused name gets a valid id and keeps its name; hidden
    // directories are no workspaces. The JSON files stay where they are.
    let env = Env::new();
    for dir in ["default", "con", ".hidden", "trailing."] {
        let file = env.dir.join("workspaces").join(dir).join("profiles.json");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, format!(r#"[{{"host":"{}.lan","username":"root","password":"pw"}}]"#, dir.trim_matches('.'))).unwrap();
    }
    let store = env.open();
    let (con, trailing) = (usable("con"), usable("trailing."));
    assert_eq!(store.start_with(Some(&LegacySecrets::default())).unwrap(), report(&[&con, "default", &trailing], &[], &[], &[]));
    assert_eq!((store.workspace(&con).unwrap().name, logins(&store, &con)), ("con".to_string(), vec!["con.lan:pw".to_string()]));
    assert_eq!(store.workspace(&trailing).unwrap().name, "trailing.");
    assert!(env.dir.join("workspaces/con/profiles.json").exists());
    drop(store);
    assert_eq!(env.open().start().unwrap(), StartReport::default());

    // getssh.db: typed names with '/', ':' or a reserved name. Their rows and data move under
    // valid ids and are encrypted like the others; nothing is left in plaintext.
    let env = Env::new();
    fs::write(env.dir.join("app_key.enc"), b"GETSSH-SS1:opaque blob").unwrap();
    write_getssh_db(&env.dir);
    let conn = Connection::open(&env.dir.join("getssh.db"), &Key::Passphrase(app_key().as_bytes()), Mode::ReadWrite).unwrap();
    conn.execute_batch(
        "INSERT INTO workspaces (id, name, hasPassword, created_at, updated_at, is_main) VALUES ('aux', 'Aux', 0, 3, 3, 0), ('Prod/Staging', 'Prod/Staging', 0, 4, 4, 0), ('Client: Acme', 'Client: Acme', 0, 5, 5, 0);
         INSERT INTO profiles (id, workspace_id, host, username, password, port) VALUES ('p3', 'aux', 'aux.lan', 'u', 'aux-pw', 22), ('p4', 'Prod/Staging', 'stage.lan', 'u', 'stage-pw', 22), ('p5', 'Client: Acme', 'acme.lan', 'u', 'acme-cleartext-pw', 22);",
    )
    .unwrap();
    drop(conn);
    let (aux, stage, acme) = (usable("aux"), usable("Prod/Staging"), usable("Client: Acme"));
    let store = env.open();
    assert_eq!(store.start_with(Some(&secrets(Some(&app_key()), &[]))).unwrap(), report(&["default", "team", &aux, &stage, &acme], &[], &[], &[]));
    assert_eq!(logins(&store, &aux), ["aux.lan:aux-pw"]);
    assert_eq!((store.workspace(&stage).unwrap().name, logins(&store, &stage)), ("Prod/Staging".to_string(), vec!["stage.lan:stage-pw".to_string()]));
    assert_eq!((store.workspace(&acme).unwrap().name, logins(&store, &acme)), ("Client: Acme".to_string(), vec!["acme.lan:acme-cleartext-pw".to_string()]));
    for entry in fs::read_dir(&env.dir).unwrap().flatten() {
        let bytes = fs::read(entry.path()).unwrap_or_default();
        assert!(!bytes.windows(17).any(|w| w == b"acme-cleartext-pw"), "{} holds a password in clear", entry.path().display());
    }
    drop(store);
    assert_eq!(env.open().start().unwrap(), StartReport::default());
}

#[test]
fn a_row_with_a_refused_id_left_by_an_older_migration_is_reported_and_can_be_deleted() {
    let env = Env::new();
    let store = env.started();
    store.with_main(|c| { c.execute("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('a/b', 'Old', 9, 9)", &[])?; Ok(()) }).unwrap();
    drop(store);
    let store = env.open();
    assert_eq!(store.start().unwrap(), report(&[], &[], &[], &["a/b"]));
    store.delete_workspace("a/b").unwrap();
    drop(store);
    assert_eq!(env.open().start().unwrap(), StartReport::default());
}

#[cfg(unix)]
#[test]
fn a_plain_workspace_whose_move_fails_once_is_finished_at_the_next_start() {
    use std::os::unix::fs::PermissionsExt;
    let env = Env::new();
    development_layout(&env.dir);
    let file = env.dir.join("workspace_default.db");
    fs::set_permissions(&file, fs::Permissions::from_mode(0o444)).unwrap();
    let store = env.open();
    let first = store.start_with(Some(&layout_secrets())).unwrap();
    assert!(first.failed_workspaces.contains(&"default".to_string()), "{first:?}");
    drop(store);
    // Writable again, with the WAL and SHM SQLite created read-only like their database.
    for name in ["workspace_default.db", "workspace_default.db-wal", "workspace_default.db-shm"] {
        let _ = fs::set_permissions(env.dir.join(name), fs::Permissions::from_mode(0o600));
    }
    let store = env.open();
    assert_eq!(store.start().unwrap(), report(&[], &["lost"], &[], &[]));
    assert!(!is_plain(&file));
    assert_eq!(logins(&store, "default"), ["router.lan:hunter2"]);
}

#[test]
fn a_master_password_set_while_an_adoption_waits_finishes_it() {
    // adopt_workspace stopped before encrypting; the first master password stages every scope.
    let env = Env::new();
    let store = env.started();
    write_workspace(&env.dir, "half", &Key::Plain, &[("p", "half.example", "u", "pw")]);
    store
        .with_main(|c| {
            c.execute("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('half', 'Half', 5, 5)", &[])?;
            c.execute("INSERT INTO adopting_workspaces (id) VALUES ('half')", &[])?;
            Ok(())
        })
        .unwrap();
    store.keystore().create_scope("ws:half", None).unwrap();
    store.set_master_password("a-master-password", None).unwrap();
    assert!(!is_plain(&env.dir.join("workspace_half.db")));
    assert!(store.open_workspace("half").unwrap());
    assert_eq!(logins(&store, "half"), ["half.example:pw"]);
    drop(store);
    let store = env.open();
    store.start().unwrap();
    store.unlock_app(pw("a-master-password")).unwrap();
    assert_eq!(logins(&store, "half"), ["half.example:pw"]);
}

#[test]
fn removing_the_password_of_a_half_moved_workspace_finishes_the_move() {
    let env = Env::new();
    development_layout(&env.dir);
    let store = env.open();
    store.start_with(Some(&layout_secrets())).unwrap();
    half_moved_lost(&store);
    store.remove_workspace_password("lost", "abc").unwrap();
    assert!(!store.workspace("lost").unwrap().has_password);
    assert_eq!(logins(&store, "lost"), ["old.example:x"]);
}

#[test]
fn a_complete_backup_is_not_added_to_so_a_restore_undoes_a_crashed_split() {
    // A split that crashed after its renames, then an attempt that failed: the backup of the first
    // attempt is complete, so the second does not add the split's files to it, and the restore
    // gives back getssh.db alone (not getssh.db beside the split's main.db).
    let env = Env::new();
    fs::write(env.dir.join("app_key.enc"), b"GETSSH-SS1:opaque blob").unwrap();
    write_getssh_db(&env.dir);
    let before = snapshot(&env.dir);
    let key = secrets(Some(&app_key()), &[]);
    {
        let store = env.open();
        faults::crash_at("workspaces moved");
        assert!(catch_unwind(AssertUnwindSafe(|| store.start_with(Some(&key)))).is_err());
    }
    assert!(env.dir.join("main.db").exists() && env.dir.join("getssh.db.migrated").exists());
    let store = env.open();
    faults::fail_at("workspaces moved");
    assert_eq!(store.start_with(Some(&key)).unwrap_err().code, Code::Io);
    assert_restored(&env.dir, &before);
    drop(store);
    assert_eq!(env.open().start_with(Some(&key)).unwrap(), report(&["default", "team"], &[], &[], &[]));
    assert!(!env.dir.join(KEPT_DIR).exists(), "split, so nothing is kept aside");
}

#[test]
fn a_truncated_copy_in_a_backup_the_typescript_version_started_is_taken_again() {
    // keystoreMigration.ts copied in place and wrote no completion mark: a crash while copying
    // left a truncated copy, and nothing had been migrated yet.
    let env = Env::new();
    development_layout(&env.dir);
    let before = snapshot(&env.dir);
    let backup = env.dir.join(BACKUP_DIR);
    fs::create_dir_all(&backup).unwrap();
    fs::copy(env.dir.join("main.db"), backup.join("main.db")).unwrap();
    let whole = fs::read(env.dir.join("workspace_default.db")).unwrap();
    fs::write(backup.join("workspace_default.db"), &whole[..1024]).unwrap();
    // Also one of a workspace waiting for its password, whose old key is not known here.
    let lost = fs::read(env.dir.join("workspace_lost.db")).unwrap();
    fs::write(backup.join("workspace_lost.db"), &lost[..1024]).unwrap();
    // A key that does not open main.db: the attempt fails and the backup is restored.
    let store = env.open();
    let wrong = secrets(Some(&"CD".repeat(32)), &[("secret", "secret-pw-1")]);
    assert_eq!(store.start_with(Some(&wrong)).unwrap_err().code, Code::Corrupt);
    assert_restored(&env.dir, &before);
    drop(store);
    let store = env.open();
    assert_eq!(store.start_with(Some(&layout_secrets())).unwrap(), report(&["default", "secret"], &["lost"], &["secret"], &[]));
    store.unlock_workspace("lost", pw("abc")).unwrap();
    assert_eq!(logins(&store, "lost"), ["old.example:x"]);
}
