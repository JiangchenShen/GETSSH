//! Store tests on the software device from getssh-keystore (no Secure Enclave, TPM or prompts).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use getssh_keystore::crypto::{self, Argon2Params};
use getssh_keystore::device::fake::FakeDevice;
use getssh_keystore::Keystore;
use zeroize::Zeroizing;

use crate::error::Code;
use crate::profiles::{ProfileInput, SecretField, SecretUpdate};
use crate::sqlite::{Connection, Key, Mode};
use crate::store::{Store, UnlockRoute, WorkspaceChanges};

const FAST: Argon2Params = Argon2Params { m_kib: 8 * 1024, t: 1, p: 1 };

struct Env {
    dir: PathBuf,
    machine: [u8; 32],
}

impl Env {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("gs-store-{}", crypto::random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        Env { dir, machine: crypto::random_array() }
    }

    fn open(&self) -> Store<FakeDevice> {
        let ks = Keystore::with_options(FakeDevice::new(self.machine), self.dir.join("keyring.json"), FAST, Arc::new(Instant::now)).unwrap();
        Store::with_keystore(ks, self.dir.clone())
    }

    fn started(&self) -> Store<FakeDevice> {
        let store = self.open();
        store.start().unwrap();
        store
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn pw(s: &str) -> UnlockRoute {
    UnlockRoute::Password(Zeroizing::new(s.to_string()))
}

fn profile(id: &str, password: SecretUpdate) -> ProfileInput {
    ProfileInput {
        id: id.into(),
        host: format!("{id}.example"),
        username: "root".into(),
        port: Some(22),
        protocol: Some("ssh".into()),
        auth_type: Some("password".into()),
        alias: None,
        os_type: None,
        group_name: Some("Prod/DB".into()),
        auto_start: false,
        use_keep_alive: true,
        strict_host_key_checking: false,
        proxy_jump: None,
        initial_directory: None,
        post_connect_script: None,
        theme_override: None,
        key_id: None,
        private_key_path: None,
        password,
        passphrase: SecretUpdate::Keep,
    }
}

fn set(s: &str) -> SecretUpdate {
    SecretUpdate::Set(Zeroizing::new(s.to_string()))
}

#[test]
fn a_fresh_install_opens_with_a_default_main_workspace() {
    let env = Env::new();
    let store = env.started();
    let state = store.app_state();
    assert!(state.ready && !state.master_password);
    let workspaces = store.list_workspaces().unwrap();
    assert_eq!(workspaces.len(), 1);
    assert!(workspaces[0].is_main && workspaces[0].open && workspaces[0].id == "default");
    assert!(env.dir.join("main.db").exists() && env.dir.join("workspace_default.db").exists());
}

#[test]
fn secrets_are_sealed_on_disk_and_never_listed() {
    let env = Env::new();
    let store = env.started();
    store.save_profiles("default", &[profile("web", set("hunter2-secret"))]).unwrap();
    let listed = store.list_profiles("default").unwrap();
    assert!(listed[0].has_password && !listed[0].has_passphrase);
    assert_eq!(listed[0].group_name.as_deref(), Some("Prod/DB"));
    // On disk (inside the SQLCipher database) the column holds a sealed field, not the password.
    let key = store.keystore().database_key("ws:default", "database", false).unwrap();
    drop(store);
    let conn = Connection::open(&env.dir.join("workspace_default.db"), &Key::Raw(&key), Mode::ReadOnly).unwrap();
    let raw = conn.query_row("SELECT password FROM profiles WHERE id = 'web'", &[], |r| r.text(0)).unwrap().unwrap();
    assert!(raw.starts_with("gk1:") && !raw.contains("hunter2"), "{raw}");
    let store = env.started();
    let secrets = store.connect_secrets("default", "web").unwrap();
    assert_eq!(secrets.password.as_deref().map(|v| v.as_slice()), Some(&b"hunter2-secret"[..]));
}

#[test]
fn saving_keeps_clears_and_replaces_secrets() {
    let env = Env::new();
    let store = env.started();
    store.save_profiles("default", &[profile("a", set("first-pass")), profile("b", set("other-pass"))]).unwrap();
    // The renderer never has the secrets: Keep must preserve them.
    store.save_profiles("default", &[profile("a", SecretUpdate::Keep), profile("b", SecretUpdate::Clear)]).unwrap();
    assert_eq!(store.connect_secrets("default", "a").unwrap().password.unwrap().as_slice(), b"first-pass");
    assert!(store.connect_secrets("default", "b").unwrap().password.is_none());
    store.save_profiles("default", &[profile("a", set("second-pass"))]).unwrap();
    assert_eq!(store.connect_secrets("default", "a").unwrap().password.unwrap().as_slice(), b"second-pass");
    assert_eq!(store.connect_secrets("default", "b").err().unwrap().code, Code::NotFound, "missing profiles are deleted");
}

#[test]
fn a_sealed_secret_does_not_open_under_another_profile() {
    let env = Env::new();
    let store = env.started();
    store.save_profiles("default", &[profile("a", set("secret-of-a")), profile("b", SecretUpdate::Clear)]).unwrap();
    store
        .with_workspace("default", |c| {
            c.execute("UPDATE profiles SET password = (SELECT password FROM profiles WHERE id = 'a') WHERE id = 'b'", &[])?;
            Ok(())
        })
        .unwrap();
    assert!(store.connect_secrets("default", "b").is_err(), "the sealed field is bound to its profile");
}

#[test]
fn legacy_plaintext_secrets_are_sealed_when_the_workspace_opens() {
    let env = Env::new();
    let store = env.started();
    store.save_profiles("default", &[profile("old", SecretUpdate::Clear)]).unwrap();
    store
        .with_workspace("default", |c| {
            c.execute("UPDATE profiles SET password = 'plain-from-2x', passphrase = 'phrase-2x' WHERE id = 'old'", &[])?;
            Ok(())
        })
        .unwrap();
    drop(store);
    let store = env.started();
    let secrets = store.connect_secrets("default", "old").unwrap();
    assert_eq!(secrets.password.unwrap().as_slice(), b"plain-from-2x");
    assert_eq!(secrets.passphrase.unwrap().as_slice(), b"phrase-2x");
    let raw = store.with_workspace("default", |c| Ok(c.query_row("SELECT password, passphrase FROM profiles", &[], |r| Ok((r.text(0)?, r.text(1)?)))?)).unwrap();
    assert!(raw.0.unwrap().starts_with("gk1:") && raw.1.unwrap().starts_with("gk1:"));
}

#[test]
fn a_master_password_locks_everything_and_one_password_opens_it() {
    let env = Env::new();
    let store = env.started();
    store.create_workspace(Some("work"), "Work", None, None).unwrap();
    store.save_profiles("work", &[profile("db", set("db-password"))]).unwrap();
    assert!(store.set_master_password("short", None).is_err(), "12 characters at least");
    assert!(!store.set_master_password("correct horse battery", None).unwrap());
    store.lock_app();
    assert!(!store.app_state().ready);
    assert_eq!(store.list_profiles("work").err().unwrap().code, Code::Locked);
    drop(store);

    let store = env.open();
    store.start().unwrap();
    assert!(!store.app_state().ready, "a restart asks for the master password");
    assert_eq!(store.unlock_app(pw("wrong password!!")).err().unwrap().code, Code::WrongPassword);
    let state = store.unlock_app(pw("correct horse battery")).unwrap();
    assert!(state.ready && state.master_password && !state.master_password_must_change);
    assert_eq!(store.connect_secrets("work", "db").unwrap().password.unwrap().as_slice(), b"db-password");
    // Every database moved to keys that the device alone can no longer open.
    assert!(store.list_workspaces().unwrap().iter().all(|w| w.open));
}

#[test]
fn removing_the_master_password_returns_to_quiet_unlock() {
    let env = Env::new();
    let store = env.started();
    store.set_master_password("correct horse battery", None).unwrap();
    assert_eq!(store.remove_master_password("not the password").err().unwrap().code, Code::WrongPassword);
    store.remove_master_password("correct horse battery").unwrap();
    drop(store);
    let store = env.started();
    assert!(store.app_state().ready && !store.app_state().master_password);
}

#[test]
fn changing_the_master_password_needs_the_current_one() {
    let env = Env::new();
    let store = env.started();
    store.set_master_password("correct horse battery", None).unwrap();
    assert_eq!(store.set_master_password("another long password", None).err().unwrap().code, Code::NeedsPassword);
    store.set_master_password("another long password", Some("correct horse battery")).unwrap();
    drop(store);
    let store = env.open();
    store.start().unwrap();
    store.unlock_app(pw("another long password")).unwrap();
}

#[test]
fn workspace_passwords_lock_one_workspace_and_never_main() {
    let env = Env::new();
    let store = env.started();
    assert_eq!(store.set_workspace_password("default", "eight-chars", None).err().unwrap().code, Code::InvalidArgument);
    store.create_workspace(Some("secret"), "Secret", None, Some("eight-chars")).unwrap();
    store.save_profiles("secret", &[profile("s", set("inner"))]).unwrap();
    drop(store);
    let store = env.started();
    let secret = store.workspace("secret").unwrap();
    assert!(secret.has_password && !secret.open);
    assert_eq!(store.list_profiles("secret").err().unwrap().code, Code::Locked);
    assert!(store.list_profiles("default").is_ok(), "other workspaces stay open");
    assert_eq!(store.unlock_workspace("secret", pw("nope-nope")).err().unwrap().code, Code::WrongPassword);
    store.unlock_workspace("secret", pw("eight-chars")).unwrap();
    assert_eq!(store.list_profiles("secret").unwrap().len(), 1);
    store.lock_workspace("secret").unwrap();
    assert_eq!(store.list_profiles("secret").err().unwrap().code, Code::Locked);
    store.unlock_workspace("secret", pw("eight-chars")).unwrap();
    store.remove_workspace_password("secret", "eight-chars").unwrap();
    drop(store);
    assert!(env.started().workspace("secret").unwrap().open);
}

#[test]
fn a_master_password_refuses_new_workspace_passwords() {
    let env = Env::new();
    let store = env.started();
    store.set_master_password("correct horse battery", None).unwrap();
    assert_eq!(store.create_workspace(Some("x"), "X", None, Some("eight-chars")).err().unwrap().code, Code::InvalidArgument);
    store.create_workspace(Some("x"), "X", None, None).unwrap();
}

#[test]
fn short_master_passwords_are_flagged_for_a_change() {
    // Builds from before the 12-character rule accepted 8; unlocking with one sets the flag.
    assert!(crate::store::master_password_too_short("eleven-char"));
    assert!(crate::store::master_password_too_short("主密码主密码主密码主密"), "11 characters, 33 bytes");
    assert!(!crate::store::master_password_too_short("twelve-chars"));
    // NFC: "é" typed as e + combining accent still counts as one character.
    assert!(crate::store::master_password_too_short("cafe\u{301}-pass-x"));
}

#[test]
fn workspace_ids_are_file_names_only() {
    let env = Env::new();
    let store = env.started();
    for bad in ["..", "../x", "a/b", "a\\b", "CON", "lpt1.txt", " x", "x.", "", "a:b"] {
        assert_eq!(store.create_workspace(Some(bad), "Bad", None, None).err().unwrap().code, Code::InvalidArgument, "{bad:?}");
    }
    store.create_workspace(Some("工作区 1"), "工作区", None, None).unwrap();
}

#[test]
fn deleting_a_workspace_removes_its_database_and_key_scope() {
    let env = Env::new();
    let store = env.started();
    store.create_workspace(Some("tmp"), "Tmp", None, None).unwrap();
    store.save_profiles("tmp", &[profile("p", set("x-secret"))]).unwrap();
    assert_eq!(store.delete_workspace("default").err().unwrap().code, Code::InvalidArgument, "main cannot be deleted");
    store.delete_workspace("tmp").unwrap();
    assert!(!env.dir.join("workspace_tmp.db").exists());
    assert!(store.keystore().status().scopes.iter().all(|s| s.id != "ws:tmp"));
    assert_eq!(store.list_profiles("tmp").err().unwrap().code, Code::NotFound);
}

#[test]
fn a_plain_2x_workspace_is_encrypted_when_adopted() {
    let env = Env::new();
    let store = env.started();
    {
        let conn = Connection::open(&env.dir.join("workspace_legacy.db"), &Key::Plain, Mode::Create).unwrap();
        crate::schema::migrate_workspace(&conn).unwrap();
        conn.execute("INSERT INTO profiles (id, workspace_id, host, username, password) VALUES ('p', 'legacy', 'h', 'u', 'plain-pw')", &[]).unwrap();
    }
    store
        .with_main(|c| {
            c.execute("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('legacy', 'Legacy', 1, 1)", &[])?;
            Ok(())
        })
        .unwrap();
    assert!(store.open_workspace("legacy").unwrap());
    let header = std::fs::read(env.dir.join("workspace_legacy.db")).unwrap();
    assert_ne!(&header[..16], b"SQLite format 3\0");
    assert_eq!(store.connect_secrets("legacy", "p").unwrap().password.unwrap().as_slice(), b"plain-pw");
}

#[test]
fn a_2x_password_workspace_migrates_when_its_password_is_typed() {
    let env = Env::new();
    let store = env.started();
    {
        let conn = Connection::open(&env.dir.join("workspace_old.db"), &Key::Passphrase(b"old-pw"), Mode::Create).unwrap();
        crate::schema::migrate_workspace(&conn).unwrap();
        conn.execute("INSERT INTO profiles (id, workspace_id, host, username) VALUES ('p', 'old', 'h', 'u')", &[]).unwrap();
    }
    store
        .with_main(|c| {
            c.execute("INSERT INTO workspaces (id, name, hasPassword, created_at, updated_at) VALUES ('old', 'Old', 1, 1, 1)", &[])?;
            Ok(())
        })
        .unwrap();
    assert_eq!(store.open_workspace("old").err().unwrap().code, Code::NeedsPassword);
    assert_eq!(store.unlock_workspace("old", pw("wrong")).err().unwrap().code, Code::WrongPassword);
    store.unlock_workspace("old", pw("old-pw")).unwrap();
    assert_eq!(store.list_profiles("old").unwrap().len(), 1);
    drop(store);
    let store = env.started();
    store.unlock_workspace("old", pw("old-pw")).unwrap();
}

#[test]
fn reveal_needs_an_open_window() {
    let env = Env::new();
    let store = env.started();
    store.create_workspace(Some("w"), "W", None, Some("eight-chars")).unwrap();
    store.save_profiles("w", &[profile("p", set("revealed-value"))]).unwrap();
    assert_eq!(store.reveal_secret("w", "p", SecretField::Password).err().unwrap().code, Code::Locked);
    store.open_reveal("w", None, Some("eight-chars")).unwrap();
    assert_eq!(store.reveal_secret("w", "p", SecretField::Password).unwrap().as_str(), "revealed-value");
    store.close_reveal();
    assert_eq!(store.reveal_secret("w", "p", SecretField::Password).err().unwrap().code, Code::Locked);
}

#[test]
fn workspace_updates_and_settings_persist() {
    let env = Env::new();
    let store = env.started();
    store.create_workspace(Some("w"), "W", Some("#fff"), None).unwrap();
    store.update_workspace("w", WorkspaceChanges { name: Some("Renamed".into()), theme_color: Some(None), preferences: Some("{\"a\":1}".into()) }).unwrap();
    store.set_main_workspace("w").unwrap();
    store.set_global_setting("language", "zh-CN").unwrap();
    drop(store);
    let store = env.started();
    let w = store.workspace("w").unwrap();
    assert_eq!((w.name.as_str(), w.theme_color.clone(), w.preferences.as_str(), w.is_main), ("Renamed", None, "{\"a\":1}", true));
    assert!(!store.workspace("default").unwrap().is_main);
    assert_eq!(store.get_global_setting("language").unwrap().as_deref(), Some("zh-CN"));
    assert_eq!(store.workspace_stats("w").unwrap().profile_count, 0);
}

#[test]
fn legacy_layouts_are_left_for_the_typescript_migration() {
    let env = Env::new();
    std::fs::write(env.dir.join("app_key.enc"), b"x").unwrap();
    assert_eq!(env.open().start().err().unwrap().code, Code::Unavailable);
}

// ───────────────────────────── export bundles ─────────────────────────────

/// Removes the backup directory an import leaves next to the data directory.
struct Backup(Option<PathBuf>);

impl Drop for Backup {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

const BUNDLE_PASSWORD: &str = "bundle password 1";

/// A source install with a main workspace, a password workspace and a setting.
fn source_with_data(env: &Env) -> Store<FakeDevice> {
    let store = env.started();
    store.save_profiles("default", &[profile("web", set("web-secret"))]).unwrap();
    store.create_workspace(Some("vault"), "Vault", None, Some("vault-pass")).unwrap();
    store.save_profiles("vault", &[profile("db", set("db-secret"))]).unwrap();
    store.set_global_setting("language", "zh-CN").unwrap();
    store
}

fn export_to(store: &Store<FakeDevice>, env: &Env, ids: &[&str]) -> PathBuf {
    let path = env.dir.join("out.getssh-backup");
    let ids: Vec<String> = ids.iter().map(|s| s.to_string()).collect();
    let report = store.export_bundle(&path, BUNDLE_PASSWORD, &ids, "3.0.0-test").unwrap();
    assert_eq!(report.bytes, std::fs::metadata(&path).unwrap().len());
    path
}

fn import_into(target: &Env, bundle: &std::path::Path) -> (Store<FakeDevice>, Backup) {
    let store = target.started();
    let report = store.import_bundle(bundle, BUNDLE_PASSWORD, FakeDevice::new(target.machine)).unwrap();
    let backup = Backup(report.backup_path.clone());
    assert_eq!(store.list_workspaces().err().unwrap().code, Code::Unavailable, "the old store refuses calls after an import");
    drop(store);
    (target.open(), backup)
}

#[test]
fn a_bundle_restores_everything_on_another_computer() {
    let (a, b) = (Env::new(), Env::new());
    let source = source_with_data(&a);
    let bundle = export_to(&source, &a, &["default", "vault"]);
    // The bundle is opaque without its password.
    let raw = std::fs::read(&bundle).unwrap();
    assert!(!raw.windows(10).any(|w| w == b"web-secret") && !raw.windows(5).any(|w| w == b"zh-CN"));

    let info = source.inspect_bundle(&bundle, BUNDLE_PASSWORD).unwrap();
    assert_eq!(info.app_version, "3.0.0-test");
    assert_eq!(info.workspaces.iter().map(|w| (w.id.as_str(), w.has_password)).collect::<Vec<_>>(), [("default", false), ("vault", true)]);

    let (store, backup) = import_into(&b, &bundle);
    store.start().unwrap();
    assert!(store.app_state().ready, "no master password: the new device key opens it quietly");
    assert_eq!(store.connect_secrets("default", "web").unwrap().password.unwrap().as_slice(), b"web-secret");
    assert_eq!(store.get_global_setting("language").unwrap().as_deref(), Some("zh-CN"));
    // The workspace keeps its own password.
    assert_eq!(store.list_profiles("vault").err().unwrap().code, Code::Locked);
    store.unlock_workspace("vault", pw("vault-pass")).unwrap();
    assert_eq!(store.connect_secrets("vault", "db").unwrap().password.unwrap().as_slice(), b"db-secret");
    // The previous data of computer B is kept next to it.
    let old = backup.0.as_ref().unwrap();
    assert!(old.join("main.db").exists() && old.join("keyring.json").exists());
}

#[test]
fn a_master_password_travels_with_the_bundle() {
    let (a, b) = (Env::new(), Env::new());
    let source = source_with_data(&a);
    source.unlock_workspace("vault", pw("vault-pass")).ok();
    source.remove_workspace_password("vault", "vault-pass").unwrap();
    source.set_master_password("correct horse battery", None).unwrap();
    let bundle = export_to(&source, &a, &["default", "vault"]);

    let (store, _backup) = import_into(&b, &bundle);
    store.start().unwrap();
    assert!(!store.app_state().ready && store.app_state().master_password);
    assert_eq!(store.unlock_app(pw("bundle password 1")).err().unwrap().code, Code::WrongPassword, "the bundle password is not the master password");
    store.unlock_app(pw("correct horse battery")).unwrap();
    assert_eq!(store.connect_secrets("vault", "db").unwrap().password.unwrap().as_slice(), b"db-secret");
}

#[test]
fn a_subset_export_carries_only_the_chosen_workspaces() {
    let (a, b) = (Env::new(), Env::new());
    let source = source_with_data(&a);
    source.create_workspace(Some("team"), "Team", None, None).unwrap();
    source.save_profiles("team", &[profile("t", set("team-secret"))]).unwrap();
    let bundle = export_to(&source, &a, &["team"]);
    assert!(source.list_profiles("default").is_ok() && source.workspace("default").unwrap().is_main, "exporting does not touch the source");

    let (store, _backup) = import_into(&b, &bundle);
    store.start().unwrap();
    let workspaces = store.list_workspaces().unwrap();
    assert_eq!(workspaces.len(), 1);
    assert!(workspaces[0].id == "team" && workspaces[0].is_main, "the only workspace becomes main");
    assert_eq!(store.connect_secrets("team", "t").unwrap().password.unwrap().as_slice(), b"team-secret");
    assert!(!b.dir.join("workspace_default.db").exists());
}

#[test]
fn export_checks_its_inputs() {
    let a = Env::new();
    let source = source_with_data(&a);
    drop(source);
    let source = a.started();
    let path = a.dir.join("x.getssh-backup");
    let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(source.export_bundle(&path, "short", &ids(&["default"]), "t").err().unwrap().code, Code::InvalidArgument);
    assert_eq!(source.export_bundle(&path, BUNDLE_PASSWORD, &[], "t").err().unwrap().code, Code::InvalidArgument);
    assert_eq!(source.export_bundle(&path, BUNDLE_PASSWORD, &ids(&["default", "default"]), "t").err().unwrap().code, Code::InvalidArgument);
    assert_eq!(source.export_bundle(&path, BUNDLE_PASSWORD, &ids(&["nope"]), "t").err().unwrap().code, Code::NotFound);
    assert_eq!(source.export_bundle(&path, BUNDLE_PASSWORD, &ids(&["vault"]), "t").err().unwrap().code, Code::Locked);
    assert!(!path.exists());
    let candidates = source.export_candidates().unwrap();
    let vault = candidates.iter().find(|c| c.id == "vault").unwrap();
    assert!(!vault.open && vault.unlock_with == ["password"]);
    assert!(candidates.iter().find(|c| c.id == "default").unwrap().profile_count == 1);
    let own = format!(".{}-export-", a.dir.file_name().unwrap().to_string_lossy());
    assert!(std::fs::read_dir(a.dir.parent().unwrap()).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().starts_with(&own)), "staging is cleaned up");
}

/// Byte offsets of each payload chunk (length prefix included).
fn chunk_offsets(raw: &[u8]) -> Vec<(usize, usize)> {
    let u32_at = |at: usize| u32::from_le_bytes(raw[at..at + 4].try_into().unwrap()) as usize;
    let mut at = 10;
    at += 4 + u32_at(at);
    at += 4 + u32_at(at);
    let mut chunks = Vec::new();
    while at < raw.len() {
        let len = 4 + u32_at(at);
        chunks.push((at, len));
        at += len;
    }
    chunks
}

#[test]
fn damaged_bundles_and_wrong_passwords_change_nothing() {
    let (a, b) = (Env::new(), Env::new());
    let source = source_with_data(&a);
    source.unlock_workspace("vault", pw("vault-pass")).ok();
    let bundle = export_to(&source, &a, &["default", "vault"]);
    let raw = std::fs::read(&bundle).unwrap();
    let chunks = chunk_offsets(&raw);
    assert!(chunks.len() > 2, "the test needs several chunks, got {}", chunks.len());
    let (mid_at, mid_len) = chunks[1];
    let (last_at, _) = *chunks.last().unwrap();

    let target = b.started();
    target.save_profiles("default", &[profile("mine", set("keep-me"))]).unwrap();
    let damaged = b.dir.join("damaged.getssh-backup");
    let cases: Vec<(&str, Vec<u8>, Code)> = vec![
        ("payload byte flipped", { let mut r = raw.clone(); r[mid_at + 40] ^= 1; r }, Code::Corrupt),
        ("last chunk dropped", raw[..last_at].to_vec(), Code::Corrupt),
        ("a chunk removed", [&raw[..mid_at], &raw[mid_at + mid_len..]].concat(), Code::Corrupt),
        ("chunks swapped", [&raw[..chunks[1].0], &raw[chunks[2].0..chunks[2].0 + chunks[2].1], &raw[chunks[1].0..chunks[2].0], &raw[chunks[2].0 + chunks[2].1..]].concat(), Code::Corrupt),
        ("extra data", [&raw[..], b"x"].concat(), Code::Corrupt),
        ("cut mid-chunk", raw[..raw.len() - 7].to_vec(), Code::Corrupt),
        ("header edited", { let mut r = raw.clone(); let i = r.windows(5).position(|w| w == b"3.0.0").unwrap(); r[i] = b'4'; r }, Code::WrongPassword),
        ("not a bundle", b"SQLite format 3\0".to_vec(), Code::Corrupt),
    ];
    for (what, bytes, code) in cases {
        std::fs::write(&damaged, &bytes).unwrap();
        let error = target.import_bundle(&damaged, BUNDLE_PASSWORD, FakeDevice::new(b.machine)).err().unwrap_or_else(|| panic!("{what}: imported"));
        assert_eq!(error.code, code, "{what}: {error:?}");
    }
    assert_eq!(target.inspect_bundle(&bundle, "wrong password!").err().unwrap().code, Code::WrongPassword);
    assert_eq!(target.import_bundle(&bundle, "wrong password!", FakeDevice::new(b.machine)).err().unwrap().code, Code::WrongPassword);
    // Nothing moved: the target still works on its own data, and no staging is left behind.
    assert_eq!(target.connect_secrets("default", "mine").unwrap().password.unwrap().as_slice(), b"keep-me");
    let parent = b.dir.parent().unwrap();
    let leftovers: Vec<_> = std::fs::read_dir(parent).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.contains(&*b.dir.file_name().unwrap().to_string_lossy()) && n != &*b.dir.file_name().unwrap().to_string_lossy()).collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}

#[test]
fn a_locked_app_cannot_import() {
    let (a, b) = (Env::new(), Env::new());
    let source = source_with_data(&a);
    source.unlock_workspace("vault", pw("vault-pass")).ok();
    let bundle = export_to(&source, &a, &["default"]);
    let target = b.started();
    target.set_master_password("target master pw", None).unwrap();
    target.lock_app();
    assert_eq!(target.import_bundle(&bundle, BUNDLE_PASSWORD, FakeDevice::new(b.machine)).err().unwrap().code, Code::Locked);
}

// ───────────────────────────── conformance with store.d.ts / the fake ─────────────────────────────

#[test]
fn calls_before_start_are_not_configured() {
    let env = Env::new();
    let store = env.open();
    assert_eq!(store.list_workspaces().err().unwrap().code, Code::NotConfigured);
    store.start().unwrap();
    assert!(store.list_workspaces().is_ok());
}

#[test]
fn the_first_master_password_replaces_workspace_passwords() {
    let env = Env::new();
    let store = env.started();
    store.create_workspace(Some("p"), "P", None, Some("eight-chars")).unwrap();
    store.save_profiles("p", &[profile("x", set("inner-secret"))]).unwrap();
    store.lock_workspace("p").unwrap();
    assert_eq!(store.set_master_password("correct horse battery", None).err().unwrap().code, Code::Locked, "its key must be in memory");
    assert!(!store.app_state().master_password, "nothing changed");
    store.unlock_workspace("p", pw("eight-chars")).unwrap();
    store.set_master_password("correct horse battery", None).unwrap();
    let p = store.workspace("p").unwrap();
    assert!(!p.has_password && p.open);
    drop(store);

    let store = env.started();
    store.unlock_app(pw("correct horse battery")).unwrap();
    assert!(store.workspace("p").unwrap().open, "the master password opens it");
    assert_eq!(store.connect_secrets("p", "x").unwrap().password.unwrap().as_slice(), b"inner-secret");
    assert_eq!(store.verify_password("eight-chars", Some("p")).ok(), Some(false), "the old workspace password is gone");
}

#[test]
fn presence_unlock_where_it_is_not_enabled_asks_for_the_password() {
    let env = Env::new();
    let store = env.started();
    store.create_workspace(Some("p"), "P", None, Some("eight-chars")).unwrap();
    store.lock_workspace("p").unwrap();
    let presence = UnlockRoute::Presence("test".into());
    assert_eq!(store.unlock_workspace("p", presence).err().unwrap().code, Code::NeedsPassword);
}

#[test]
fn a_closed_reveal_window_does_not_say_whether_a_profile_exists() {
    let env = Env::new();
    let store = env.started();
    store.create_workspace(Some("w"), "W", None, Some("eight-chars")).unwrap();
    assert_eq!(store.reveal_secret("w", "missing", SecretField::Password).err().unwrap().code, Code::Locked);
    store.open_reveal("w", None, Some("eight-chars")).unwrap();
    assert_eq!(store.reveal_secret("w", "missing", SecretField::Password).err().unwrap().code, Code::NotFound);
}

#[test]
fn a_recovery_code_unlock_may_set_a_new_master_password() {
    let env = Env::new();
    let store = env.started();
    store.set_master_password("correct horse battery", None).unwrap();
    let code = store.create_recovery_code(Some("correct horse battery")).unwrap();
    store.lock_app();
    drop(store);
    let store = env.started();
    store.unlock_app(UnlockRoute::RecoveryCode(code)).unwrap();
    store.set_master_password("a brand new password", None).unwrap();
    assert_eq!(store.set_master_password("yet another password", None).err().unwrap().code, Code::NeedsPassword, "only once, right after the recovery unlock");
    drop(store);
    let store = env.started();
    store.unlock_app(pw("a brand new password")).unwrap();
    assert_eq!(store.set_master_password("yet another password", None).err().unwrap().code, Code::NeedsPassword);
}

#[test]
fn a_bundle_without_an_eligible_main_gets_an_empty_default() {
    let (a, b) = (Env::new(), Env::new());
    let source = source_with_data(&a);
    source.unlock_workspace("vault", pw("vault-pass")).ok();
    // Only the password workspace: it cannot become MAIN.
    let bundle = export_to(&source, &a, &["vault"]);
    let (store, _backup) = import_into(&b, &bundle);
    store.start().unwrap();
    let workspaces = store.list_workspaces().unwrap();
    let main = workspaces.iter().find(|w| w.is_main).unwrap();
    assert!(main.id == "default" && !main.has_password && main.open);
    assert_eq!(store.list_profiles("default").unwrap().len(), 0);
    let vault = workspaces.iter().find(|w| w.id == "vault").unwrap();
    assert!(!vault.is_main && vault.has_password && !vault.open);
    store.unlock_workspace("vault", pw("vault-pass")).unwrap();
    assert_eq!(store.connect_secrets("vault", "db").unwrap().password.unwrap().as_slice(), b"db-secret");
}

#[test]
fn the_device_backend_uses_the_public_names() {
    let env = Env::new();
    let backend = env.started().app_state().device_backend;
    assert!(["secure-enclave", "keychain", "tpm", "dpapi", "unsupported"].contains(&backend.as_str()), "{backend}");
}
