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

pub(crate) struct Env {
    pub(crate) dir: PathBuf,
    pub(crate) machine: [u8; 32],
}

impl Env {
    pub(crate) fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("gs-store-{}", crypto::random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        Env { dir, machine: crypto::random_array() }
    }

    pub(crate) fn open(&self) -> Store<FakeDevice> {
        let ks = Keystore::with_options(FakeDevice::new(self.machine), self.dir.join("keyring.json"), FAST, Arc::new(Instant::now)).unwrap();
        Store::with_keystore(ks, self.dir.clone())
    }

    pub(crate) fn started(&self) -> Store<FakeDevice> {
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

pub(crate) fn pw(s: &str) -> UnlockRoute {
    UnlockRoute::Password(Zeroizing::new(s.to_string()))
}

pub(crate) fn profile(id: &str, password: SecretUpdate) -> ProfileInput {
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
fn scripts_after_connecting_may_be_long_other_text_may_not() {
    let env = Env::new();
    let store = env.started();
    let mut long_script = profile("script", SecretUpdate::Keep);
    long_script.post_connect_script = Some("echo ready\n".repeat(2000));
    store.save_profiles("default", &[long_script.clone()]).unwrap();
    assert_eq!(store.list_profiles("default").unwrap()[0].post_connect_script, long_script.post_connect_script);
    long_script.post_connect_script = Some("x".repeat(64 * 1024 + 1));
    assert_eq!(store.save_profiles("default", &[long_script]).unwrap_err().code, Code::InvalidArgument);
    let mut long_alias = profile("alias", SecretUpdate::Keep);
    long_alias.alias = Some("x".repeat(4097));
    assert_eq!(store.save_profiles("default", &[long_alias]).unwrap_err().code, Code::InvalidArgument);
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
    for bad in ["..", "../x", "a/b", "a\\b", "CON", "lpt1.txt", " x", "x.", "", "a:b", "\u{feff}x", "x\u{3000}", "x\u{85}", "a\u{9f}b"] {
        assert_eq!(store.create_workspace(Some(bad), "Bad", None, None).err().unwrap().code, Code::InvalidArgument, "{bad:?}");
    }
    store.create_workspace(Some("工作区 1"), "工作区", None, None).unwrap();
    // Refused by the store itself, not only by the keystore underneath (rows read from old data
    // never reach the keystore's check).
    for bad in ["x\u{85}", "a\u{9f}b", "\u{feff}x", "a\u{7f}", "con.a\u{2028}b", "LPT1.x\u{2029}"] {
        assert!(crate::store::validate_workspace_id(bad).is_err(), "{bad:?}");
    }
    assert!(crate::store::validate_workspace_id("a\u{a0}b").is_ok(), "inner spaces stay allowed");
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
    // Until then it exists but is locked, so the UI asks for its password instead of losing it.
    assert_eq!(store.get_runbooks("old").err().unwrap().code, Code::Locked);
    assert_eq!(store.list_profiles("old").err().unwrap().code, Code::Locked);
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
fn legacy_layouts_need_their_secrets_to_start() {
    let env = Env::new();
    std::fs::write(env.dir.join("app_key.enc"), b"x").unwrap();
    assert_eq!(env.open().start().err().unwrap().code, Code::Unavailable);
    assert!(!env.dir.join("keyring.json").exists(), "nothing changes");
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
    // An adoption mark of a workspace that is not chosen stays behind too.
    source.with_main(|c| { c.execute("INSERT INTO adopting_workspaces (id) VALUES ('private-project')", &[])?; Ok(()) }).unwrap();
    let bundle = export_to(&source, &a, &["team"]);
    assert!(source.list_profiles("default").is_ok() && source.workspace("default").unwrap().is_main, "exporting does not touch the source");

    let (store, _backup) = import_into(&b, &bundle);
    store.start().unwrap();
    let workspaces = store.list_workspaces().unwrap();
    assert_eq!(workspaces.len(), 1);
    assert!(workspaces[0].id == "team" && workspaces[0].is_main, "the only workspace becomes main");
    assert_eq!(store.connect_secrets("team", "t").unwrap().password.unwrap().as_slice(), b"team-secret");
    assert!(!b.dir.join("workspace_default.db").exists());
    let marks = store.with_main(|c| Ok(c.query_row("SELECT count(*) FROM adopting_workspaces", &[], |r| r.integer(0))?)).unwrap();
    assert_eq!(marks, 0);
}

#[test]
fn an_unlock_that_fails_after_opening_main_db_leaves_nothing_open() {
    // For example a pending rotation of the app key that hits a full disk.
    let env = Env::new();
    let store = env.started();
    store.set_master_password("a-master-password", None).unwrap();
    store.lock_app();
    crate::legacy::faults::fail_at("after unlock");
    assert_eq!(store.unlock_app(pw("a-master-password")).unwrap_err().code, Code::Io);
    assert!(!store.app_state().ready && !store.is_main_open(), "the window shows the lock screen: the store is locked too");
    assert!(store.keystore().status().scopes.iter().all(|s| s.id != "app" || !s.unlocked));
    store.unlock_app(pw("a-master-password")).unwrap();
    assert!(store.app_state().ready);
}

#[test]
fn creating_a_workspace_clears_a_stale_adoption_mark() {
    let env = Env::new();
    let store = env.started();
    store.with_main(|c| { c.execute("INSERT INTO adopting_workspaces (id) VALUES ('w')", &[])?; Ok(()) }).unwrap();
    store.create_workspace(Some("w"), "W", None, None).unwrap();
    let marks = store.with_main(|c| Ok(c.query_row("SELECT count(*) FROM adopting_workspaces WHERE id = 'w'", &[], |r| r.integer(0))?)).unwrap();
    assert_eq!(marks, 0);
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
fn a_cancelled_batch_unlock_still_opens_what_needs_no_prompt() {
    use std::sync::atomic::Ordering;
    let env = Env::new();
    {
        let store = env.started();
        for id in ["a", "b"] {
            store.create_workspace(Some(id), id, None, Some("eight-chars")).unwrap();
        }
        store.set_presence(true, "test").unwrap();
        store.create_workspace(Some("c"), "c", None, None).unwrap();
        store.create_workspace(Some("d"), "d", None, Some("eight-chars")).unwrap();
    }
    // After a relaunch: the password workspaces are locked; c needs no password and is open.
    let store = env.started();
    store.keystore().device().cancel_next.store(true, Ordering::SeqCst);
    let ids: Vec<String> = ["default", "a", "c", "a", "b", "d", "ghost"].iter().map(|id| id.to_string()).collect();
    let result = store.unlock_workspaces(&ids, "Export").unwrap();
    assert_eq!(result.unlocked, ["default", "c"], "a workspace without a password opens after the cancel too");
    assert_eq!(
        result.failed,
        [("a".into(), Code::Cancelled), ("b".into(), Code::Cancelled), ("d".into(), Code::NeedsPassword), ("ghost".into(), Code::NotFound)],
        "each id once; an unknown id is not created"
    );
    assert_eq!(store.keystore().device().prompts(), 1, "no second prompt after the cancel");
    assert!(store.workspace("ghost").is_err());
}

#[test]
fn turning_presence_on_reaches_unlocked_workspaces_and_turning_it_off_reaches_all() {
    let env = Env::new();
    let store = env.started();
    for id in ["a", "b"] {
        store.create_workspace(Some(id), id, None, Some("eight-chars")).unwrap();
    }
    let presence = |id: &str| store.workspace(id).unwrap().presence_enabled;
    store.set_presence(true, "test").unwrap();
    assert!(presence("a") && presence("b"));
    store.lock_workspace("b").unwrap();
    store.set_presence(false, "test").unwrap();
    assert!(!presence("a") && !presence("b"), "turning it off also reaches the locked workspace");
    store.set_presence(true, "test").unwrap();
    assert!(presence("a") && !presence("b"), "turning it on skips the locked workspace");
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

// ───────────────────────────── S3: the remaining tables ─────────────────────────────

fn ids(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

fn grouped(id: &str, group: Option<&str>) -> ProfileInput {
    ProfileInput { group_name: group.map(Into::into), ..profile(id, SecretUpdate::Keep) }
}

#[test]
fn asset_folders_include_profile_groups_and_parents() {
    let env = Env::new();
    let store = env.started();
    store.save_profiles("default", &[profile("web", SecretUpdate::Keep)]).unwrap();
    let snapshot = store.create_asset_folder("default", "Ops/Staging").unwrap();
    assert_eq!(snapshot.folders, ids(&["Ops", "Ops/Staging", "Prod", "Prod/DB"]));
    assert!(snapshot.memberships.is_empty());
    assert_eq!(store.get_asset_folders("default").unwrap(), snapshot.folders);
    for bad in ["", "a//b", "a/./b", "..", "a/\u{1}", " ", &"x".repeat(129)] {
        assert_eq!(store.create_asset_folder("default", bad).err().unwrap().code, Code::InvalidArgument, "{bad:?}");
    }
}

#[test]
fn renaming_a_folder_moves_its_subfolders_and_hosts() {
    let env = Env::new();
    let store = env.started();
    store.save_profiles("default", &[grouped("a", Some("Prod/DB")), grouped("b", Some("Prod")), grouped("c", Some("Production"))]).unwrap();
    store.create_asset_folder("default", "Prod/Empty").unwrap();
    store.create_asset_folder("default", "Prodigy").unwrap();
    let snapshot = store.rename_asset_folder("default", "Prod", "Live").unwrap();
    assert_eq!(snapshot.folders, ids(&["Live", "Live/DB", "Live/Empty", "Prodigy", "Production"]), "folders that only share a prefix stay");
    assert_eq!(snapshot.memberships, vec![("a".into(), Some("Live/DB".into())), ("b".into(), Some("Live".into()))]);
    assert_eq!(store.rename_asset_folder("default", "Live", "Production").err().unwrap().code, Code::InvalidArgument, "the target exists");
    assert_eq!(store.rename_asset_folder("default", "Missing", "X").err().unwrap().code, Code::NotFound);
    assert_eq!(store.rename_asset_folder("default", "Live", "a/b").err().unwrap().code, Code::InvalidArgument, "a name, not a path");
}

#[test]
fn only_empty_folders_can_be_removed() {
    let env = Env::new();
    let store = env.started();
    store.save_profiles("default", &[grouped("a", Some("Prod/DB"))]).unwrap();
    store.create_asset_folder("default", "Spare").unwrap();
    assert_eq!(store.remove_asset_folder("default", "Prod").err().unwrap().code, Code::InvalidArgument, "it has a subfolder");
    assert_eq!(store.remove_asset_folder("default", "Prod/DB").err().unwrap().code, Code::InvalidArgument, "it holds a host");
    assert_eq!(store.remove_asset_folder("default", "Nope").err().unwrap().code, Code::NotFound);
    assert_eq!(store.remove_asset_folder("default", "Spare").unwrap().folders, ids(&["Prod", "Prod/DB"]));
}

#[test]
fn moving_hosts_between_folders_reports_what_changed() {
    let env = Env::new();
    let store = env.started();
    store.save_profiles("default", &[grouped("a", None), grouped("b", Some("Ops"))]).unwrap();
    let moved = store.move_profiles_to_asset_folder("default", &ids(&["a", "b"]), Some("Ops")).unwrap();
    assert_eq!(moved.memberships, vec![("a".into(), Some("Ops".into()))], "b was already there");
    let out = store.move_profiles_to_asset_folder("default", &ids(&["a"]), None).unwrap();
    assert_eq!(out.memberships, vec![("a".into(), None)]);
    assert_eq!(out.folders, ids(&["Ops"]), "the folder was stored when a host moved in");
    assert_eq!(store.move_profiles_to_asset_folder("default", &ids(&["a"]), Some("Nope")).err().unwrap().code, Code::NotFound);
    assert_eq!(store.move_profiles_to_asset_folder("default", &ids(&["zz"]), Some("Ops")).err().unwrap().code, Code::NotFound);
    assert_eq!(store.move_profiles_to_asset_folder("default", &ids(&["a", "a"]), None).err().unwrap().code, Code::InvalidArgument);
    assert_eq!(store.move_profiles_to_asset_folder("default", &[], None).err().unwrap().code, Code::InvalidArgument);
}

#[test]
fn runbooks_are_replaced_as_a_whole_and_keep_their_order() {
    use crate::records::RunbookInput;
    let env = Env::new();
    let store = env.started();
    let rb = |id: &str, risk: Option<&str>, created_at: Option<f64>| RunbookInput {
        id: id.into(),
        title: format!("{id} title"),
        script: "uptime".into(),
        risk_level: risk.map(Into::into),
        created_at,
    };
    store.save_runbooks("default", &[rb("b", Some("HIGH"), Some(2.0)), rb("a", None, Some(1.0)), rb("c", Some(""), Some(2.0))]).unwrap();
    let listed = store.get_runbooks("default").unwrap();
    assert_eq!(listed.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), ["a", "b", "c"], "by created_at, then saved order");
    assert_eq!(listed.iter().map(|r| r.risk_level.as_str()).collect::<Vec<_>>(), ["LOW", "HIGH", "LOW"]);
    store.save_runbooks("default", &[rb("z", None, None)]).unwrap();
    let listed = store.get_runbooks("default").unwrap();
    assert_eq!(listed.len(), 1);
    assert!(listed[0].created_at > 1.0e12, "a missing created_at is now");
    assert_eq!(store.save_runbooks("default", &[rb("d", None, None), rb("d", None, None)]).err().unwrap().code, Code::InvalidArgument);
    assert_eq!(store.save_runbooks("default", &[rb("", None, None)]).err().unwrap().code, Code::InvalidArgument);
    assert_eq!(store.save_runbooks("default", &[rb("e", None, Some(f64::INFINITY))]).err().unwrap().code, Code::InvalidArgument);
}

fn message(id: &str, session: &str, role: &str, timestamp: f64) -> crate::records::AiMessage {
    crate::records::AiMessage {
        id: id.into(),
        session_id: session.into(),
        role: role.into(),
        content: format!("{id} text"),
        raw_content: None,
        timestamp,
    }
}

#[test]
fn ai_sessions_keep_their_messages_in_order() {
    let env = Env::new();
    let store = env.started();
    store.create_ai_session("default", "s1", "First", 100.0).unwrap();
    store.create_ai_session("default", "s2", "Second", 200.0).unwrap();
    assert_eq!(store.create_ai_session("default", "s1", "Again", 300.0).err().unwrap().code, Code::InvalidArgument);
    store.save_ai_message("default", &message("m2", "s1", "assistant", 120.0)).unwrap();
    store.save_ai_message("default", &message("m1", "s1", "user", 110.0)).unwrap();
    assert_eq!(store.save_ai_message("default", &message("m9", "nope", "user", 1.0)).err().unwrap().code, Code::NotFound);
    // Saving an existing message changes its text only.
    let edited = crate::records::AiMessage { content: "edited".into(), raw_content: Some("raw".into()), role: "system".into(), ..message("m2", "s1", "assistant", 500.0) };
    store.save_ai_message("default", &edited).unwrap();
    let sessions = store.get_ai_sessions("default").unwrap();
    assert_eq!(sessions.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["s1", "s2"], "s1 was updated last");
    assert_eq!(sessions[0].updated_at, 500.0);
    let messages = &sessions[0].messages;
    assert_eq!(messages.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["m1", "m2"]);
    assert_eq!((messages[1].content.as_str(), messages[1].raw_content.as_deref(), messages[1].role.as_str(), messages[1].timestamp), ("edited", Some("raw"), "assistant", 120.0));
    store.update_ai_session_title("default", "s1", "Renamed").unwrap();
    store.update_ai_session_title("default", "missing", "No-op").unwrap();
    assert_eq!(store.get_ai_sessions("default").unwrap()[0].title, "Renamed");
    store.save_ai_message("default", &message("k1", "s2", "user", 210.0)).unwrap();
    store.delete_ai_session("default", "s1").unwrap();
    let sessions = store.get_ai_sessions("default").unwrap();
    assert_eq!(sessions.iter().map(|s| (s.id.as_str(), s.messages.len())).collect::<Vec<_>>(), [("s2", 1)], "other chats stay");
    let left = store.get_ai_messages_by_ids("default", &ids(&["m1", "m2", "k1"])).unwrap();
    assert_eq!(left.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["k1"], "the messages of s1 went with it");
}

#[test]
fn ai_sessions_and_messages_come_in_pages() {
    use crate::records::MAX_AI_MESSAGE_PAGE_BYTES;
    let env = Env::new();
    let store = env.started();
    for (id, at) in [("s0", 100.0), ("s1", 200.0), ("s2", 300.0), ("t1", 300.0), ("s3", 400.0)] {
        store.create_ai_session("default", id, &format!("Chat {id}"), at).unwrap();
    }
    let reply = crate::records::AiMessage { content: "é".repeat(200), ..message("r1", "s1", "assistant", 210.0) };
    store.save_ai_message("default", &message("u1", "s1", "user", 205.0)).unwrap();
    store.save_ai_message("default", &reply).unwrap();
    // s1 moved to 210: s3, s2 and t1 (same time, t1 created later comes first), s1, s0.
    let ids = |page: &crate::records::AiSessionPage| page.sessions.iter().map(|s| s.id.clone()).collect::<Vec<_>>();
    let first = store.list_ai_sessions("default", 2.0, None).unwrap();
    assert_eq!(ids(&first), ["s3", "t1"]);
    let second = store.list_ai_sessions("default", 2.0, first.next.as_deref()).unwrap();
    assert_eq!(ids(&second), ["s2", "s1"]);
    let last = store.list_ai_sessions("default", 2.0, second.next.as_deref()).unwrap();
    assert_eq!((ids(&last), last.next), (vec!["s0".to_string()], None));
    let s1 = &second.sessions[1];
    assert_eq!((s1.message_count, s1.updated_at, s1.title.as_str()), (2, 210.0, "Chat s1"));
    assert_eq!(s1.preview.as_deref(), Some("é".repeat(120).as_str()), "the start of the first reply, in characters");
    assert_eq!(second.sessions[0].preview, None);
    assert_eq!(store.list_ai_sessions("default", 0.0, None).unwrap().sessions.len(), 1, "the limit is at least 1");
    assert_eq!(store.list_ai_sessions("default", 1e9, None).unwrap().sessions.len(), 5);
    assert_eq!(store.list_ai_sessions("default", 5.0, None).unwrap().next, None, "a page that ends with the last chat has no next");
    for bad in ["", "x", "1:", ":1", "NaN:1", "inf:1", "1:2:3"] {
        let result = store.list_ai_sessions("default", 2.0, Some(bad));
        if bad.is_empty() {
            assert_eq!(result.unwrap().sessions.len(), 2, "an empty cursor is the first page");
        } else {
            assert_eq!(result.err().unwrap().code, Code::InvalidArgument, "{bad}");
        }
    }
    assert_eq!(store.list_ai_sessions("default", f64::NAN, None).err().unwrap().code, Code::InvalidArgument);

    // Messages: the newest first page, read backwards; equal timestamps keep their saved order.
    for (id, at) in [("m0", 10.0), ("m1", 20.0), ("m2", 30.0), ("m3", 30.0), ("m4", 40.0)] {
        store.save_ai_message("default", &message(id, "s0", "user", at)).unwrap();
    }
    let ids = |page: &crate::records::AiMessagePage| page.messages.iter().map(|m| m.id.clone()).collect::<Vec<_>>();
    let newest = store.get_ai_messages("default", "s0", 2.0, None).unwrap();
    assert_eq!(ids(&newest), ["m3", "m4"]);
    let older = store.get_ai_messages("default", "s0", 2.0, newest.before.as_deref()).unwrap();
    assert_eq!(ids(&older), ["m1", "m2"]);
    let oldest = store.get_ai_messages("default", "s0", 2.0, older.before.as_deref()).unwrap();
    assert_eq!((ids(&oldest), oldest.before), (vec!["m0".to_string()], None));
    let whole = store.get_ai_messages("default", "s0", 1000.0, None).unwrap();
    assert_eq!((ids(&whole).len(), whole.before), (5, None));
    assert_eq!(store.get_ai_messages("default", "s0", 5.0, None).unwrap().before, None, "nothing before the first message");
    assert_eq!(whole.messages[0], message("m0", "s0", "user", 10.0));
    assert_eq!(store.get_ai_messages("default", "nope", 2.0, None).err().unwrap().code, Code::NotFound);
    assert_eq!(store.get_ai_messages("default", "", 2.0, None).err().unwrap().code, Code::InvalidArgument);
    assert_eq!(store.get_ai_messages("default", "s0", 2.0, Some("bad")).err().unwrap().code, Code::InvalidArgument);

    // Long messages: a page stops at the byte budget, but always holds one message.
    let big = (MAX_AI_MESSAGE_PAGE_BYTES / 3) as usize;
    for (n, at) in [(0, 1.0), (1, 2.0), (2, 3.0)] {
        let long = crate::records::AiMessage { content: "x".repeat(big), raw_content: Some("y".repeat(16)), ..message(&format!("b{n}"), "s2", "assistant", at) };
        store.save_ai_message("default", &long).unwrap();
    }
    let huge = crate::records::AiMessage { content: "z".repeat(MAX_AI_MESSAGE_PAGE_BYTES as usize + 1), ..message("b3", "s2", "assistant", 4.0) };
    store.save_ai_message("default", &huge).unwrap();
    let page = store.get_ai_messages("default", "s2", 10.0, None).unwrap();
    assert_eq!(ids(&page), ["b3"], "one message over the budget comes alone");
    let page = store.get_ai_messages("default", "s2", 10.0, page.before.as_deref()).unwrap();
    assert_eq!(ids(&page), ["b1", "b2"], "a third would pass the budget");
    let page = store.get_ai_messages("default", "s2", 10.0, page.before.as_deref()).unwrap();
    assert_eq!((ids(&page), page.before), (vec!["b0".to_string()], None));
}

#[test]
fn ai_memory_reads_back_newest_first_and_only_for_open_workspaces() {
    use crate::records::AiMemoryVector;
    let env = Env::new();
    let store = env.started();
    assert!(store.is_encrypted_ai_memory_available().unwrap());
    let vector = |id: &str, session: &str, timestamp: f64| AiMemoryVector {
        workspace_id: "default".into(),
        message_id: id.into(),
        session_id: session.into(),
        role: "user".into(),
        embedding: vec![1, 2, 3],
        dimensions: 3.0,
        content_hash: format!("hash-{id}"),
        timestamp,
    };
    store.upsert_ai_memory_vector(&vector("m1", "s1", 10.0)).unwrap();
    store.upsert_ai_memory_vector(&vector("m2", "s2", 20.0)).unwrap();
    store.upsert_ai_memory_vector(&vector("m1", "s1", 30.0)).unwrap();
    let all = store.get_ai_memory_vectors("default", 10.0, None).unwrap();
    assert_eq!(all.iter().map(|v| v.message_id.as_str()).collect::<Vec<_>>(), ["m1", "m2"], "m1 was rewritten later");
    assert_eq!(all[0].embedding, vec![1, 2, 3]);
    assert_eq!(store.get_ai_memory_vectors("default", 0.0, None).unwrap().len(), 1, "the limit is at least 1");
    assert_eq!(store.get_ai_memory_vectors("default", 10.0, Some("s1")).unwrap().len(), 1);
    assert_eq!(store.get_ai_memory_vectors("default", 10.0, Some("")).unwrap().len(), 2, "an empty session id excludes nothing");
    assert_eq!(store.get_ai_memory_vectors("default", f64::NAN, None).err().unwrap().code, Code::InvalidArgument);
    for bad in [
        AiMemoryVector { role: "system".into(), ..vector("x", "s", 1.0) },
        AiMemoryVector { dimensions: 1.5, ..vector("x", "s", 1.0) },
        AiMemoryVector { message_id: String::new(), ..vector("x", "s", 1.0) },
    ] {
        assert_eq!(store.upsert_ai_memory_vector(&bad).err().unwrap().code, Code::InvalidArgument);
    }
    store.upsert_ai_memory_vector(&vector("m3", "s2", 40.0)).unwrap();
    store.delete_ai_memory_message("default", "m2").unwrap();
    let left = store.get_ai_memory_vectors("default", 10.0, None).unwrap();
    assert_eq!(left.iter().map(|v| v.message_id.as_str()).collect::<Vec<_>>(), ["m3", "m1"], "only m2 went");
    store.delete_ai_memory_session("default", "s1").unwrap();
    let left = store.get_ai_memory_vectors("default", 10.0, None).unwrap();
    assert_eq!(left.iter().map(|v| v.message_id.as_str()).collect::<Vec<_>>(), ["m3"], "only session s1 went");

    store.create_workspace(Some("p"), "P", None, Some("eight-chars")).unwrap();
    store.lock_workspace("p").unwrap();
    assert_eq!(store.upsert_ai_memory_vector(&AiMemoryVector { workspace_id: "p".into(), ..vector("x", "s", 1.0) }).err().unwrap().code, Code::Locked);
    assert_eq!(store.get_ai_memory_vectors("p", 10.0, None).err().unwrap().code, Code::Locked);
}

#[test]
fn ai_memory_is_unavailable_while_a_master_password_locks_the_app() {
    let env = Env::new();
    let store = env.started();
    store.set_master_password("correct horse battery", None).unwrap();
    store.lock_app();
    assert!(!store.is_encrypted_ai_memory_available().unwrap());
    assert_eq!(store.get_ai_memory_vectors("default", 10.0, None).err().unwrap().code, Code::Locked);
}

#[test]
fn memory_message_queries_cover_user_and_assistant_messages_only() {
    let env = Env::new();
    let store = env.started();
    store.create_ai_session("default", "s", "S", 1.0).unwrap();
    for (id, role, ts) in [("u1", "user", 1.0), ("a1", "assistant", 2.0), ("t1", "tool", 3.0), ("u2", "user", 4.0)] {
        store.save_ai_message("default", &message(id, "s", role, ts)).unwrap();
    }
    let recent = store.get_recent_ai_messages_for_memory("default", 2.0).unwrap();
    assert_eq!(recent.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["u2", "a1"]);
    let by_id = store.get_ai_messages_by_ids("default", &ids(&["u2", "u1", "u2", "missing"])).unwrap();
    assert_eq!(by_id.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["u1", "u2"], "in saved order, duplicates once");
    assert!(store.get_ai_messages_by_ids("default", &[]).unwrap().is_empty());
    let many: Vec<String> = (0..40).map(|i| format!("id{i}")).chain(["u1".to_string()]).collect();
    assert!(store.get_ai_messages_by_ids("default", &many).unwrap().is_empty(), "only the first 32 ids are looked up");
}

#[test]
fn the_audit_log_is_newest_first_with_a_default_limit() {
    let env = Env::new();
    let store = env.started();
    for i in 0..55 {
        store.log_audit("default", &format!("action-{i}"), if i == 0 { None } else { Some("host") }, None).unwrap();
    }
    let logs = store.get_audit_logs("default", None).unwrap();
    assert_eq!(logs.len(), 50);
    assert_eq!(logs[0].action, "action-54");
    assert_eq!(store.get_audit_logs("default", Some(-1.0)).unwrap().len(), 55);
    assert!(store.get_audit_logs("default", Some(0.0)).unwrap().is_empty());
    let first = store.get_audit_logs("default", Some(-1.0)).unwrap().pop().unwrap();
    assert_eq!((first.action.as_str(), first.target.as_str(), first.details.as_str()), ("action-0", "", ""));
}

#[test]
fn copied_profiles_are_sealed_again_for_the_target_workspace() {
    use crate::records::RunbookInput;
    let env = Env::new();
    let store = env.started();
    store.create_workspace(Some("w2"), "W2", None, None).unwrap();
    // A stored SSH key, sealed the way import_ssh_key stores them.
    let sealed_key = store.keystore().seal_field("ws:default", "ssh_key|k1|private", b"PRIVATE KEY BYTES").unwrap();
    store
        .with_workspace("default", |c| {
            c.execute(
                "INSERT INTO ssh_keys (id, name, algorithm, fingerprint, public_key, private_key, has_passphrase, created_at) VALUES ('k1', 'laptop', 'ed25519', 'SHA256:x', 'ssh-ed25519 AAAA', ?, 0, 1)",
                &[sealed_key.as_str().into()],
            )?;
            Ok(())
        })
        .unwrap();
    let with_key = ProfileInput { key_id: Some("k1".into()), auth_type: Some("key".into()), ..profile("b", SecretUpdate::Keep) };
    store.save_profiles("default", &[profile("a", set("secret-a")), with_key]).unwrap();
    store
        .save_runbooks("default", &[RunbookInput { id: "r1".into(), title: "T".into(), script: "ls".into(), risk_level: None, created_at: Some(5.0) }])
        .unwrap();
    store.save_profiles("w2", &[ProfileInput { host: "old.example".into(), ..profile("a", set("old-secret")) }]).unwrap();

    store.copy_profiles("default", "w2", &ids(&["a", "b", "a"]), true).unwrap();
    let copied = store.list_profiles("w2").unwrap();
    assert_eq!(copied.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), ["a", "b"], "a replaced the old a in place");
    assert_eq!(copied[0].host, "a.example");
    assert_eq!(store.connect_secrets("w2", "a").unwrap().password.unwrap().as_slice(), b"secret-a");
    assert_eq!(store.connect_secrets("w2", "b").unwrap().private_key.unwrap().as_slice(), b"PRIVATE KEY BYTES");
    assert_eq!(store.get_runbooks("w2").unwrap().len(), 1);
    // The target holds its own ciphertext: the source's does not open there.
    let source = store.with_workspace("default", |c| Ok(c.query_row("SELECT password FROM profiles WHERE id = 'a'", &[], |r| r.text(0))?)).unwrap();
    let target = store.with_workspace("w2", |c| Ok(c.query_row("SELECT password FROM profiles WHERE id = 'a'", &[], |r| r.text(0))?)).unwrap();
    assert_ne!(source, target);

    assert_eq!(store.copy_profiles("default", "default", &ids(&["a"]), false).err().unwrap().code, Code::InvalidArgument);
    assert_eq!(store.copy_profiles("default", "w2", &ids(&["missing"]), false).err().unwrap().code, Code::NotFound);
    assert_eq!(store.copy_profiles("default", "nope", &ids(&["a"]), false).err().unwrap().code, Code::NotFound);
}

#[test]
fn the_remaining_tables_need_an_open_workspace_and_a_started_store() {
    let env = Env::new();
    let store = env.open();
    assert_eq!(store.get_runbooks("default").err().unwrap().code, Code::NotConfigured);
    assert_eq!(store.get_asset_folders("default").err().unwrap().code, Code::NotConfigured);
    store.start().unwrap();
    store.create_workspace(Some("p"), "P", None, Some("eight-chars")).unwrap();
    store.lock_workspace("p").unwrap();
    assert_eq!(store.get_runbooks("p").err().unwrap().code, Code::Locked);
    assert_eq!(store.get_ai_sessions("p").err().unwrap().code, Code::Locked);
    assert_eq!(store.log_audit("p", "x", None, None).err().unwrap().code, Code::Locked);
    assert_eq!(store.create_asset_folder("p", "A").err().unwrap().code, Code::Locked);
    assert_eq!(store.get_audit_logs("missing", None).err().unwrap().code, Code::NotFound);
}

#[test]
fn ai_memory_stays_with_its_workspace() {
    use crate::records::AiMemoryVector;
    let env = Env::new();
    let store = env.started();
    store.create_workspace(Some("b"), "B", None, Some("eight-chars")).unwrap();
    let vector = |workspace: &str| AiMemoryVector {
        workspace_id: workspace.into(),
        message_id: "m".into(),
        session_id: "s".into(),
        role: "assistant".into(),
        embedding: workspace.as_bytes().to_vec(),
        dimensions: 1.0,
        content_hash: format!("hash-{workspace}"),
        timestamp: 1.0,
    };
    // main.db keeps every workspace's vectors in one table, keyed by workspace.
    store.upsert_ai_memory_vector(&vector("default")).unwrap();
    store.upsert_ai_memory_vector(&vector("b")).unwrap();
    let a = store.get_ai_memory_vectors("default", 10.0, None).unwrap();
    assert_eq!(a.iter().map(|v| v.embedding.as_slice()).collect::<Vec<_>>(), [b"default".as_slice()]);
    store.delete_ai_memory_message("default", "m").unwrap();
    store.delete_ai_memory_session("default", "s").unwrap();
    assert_eq!(store.get_ai_memory_vectors("b", 10.0, None).unwrap().len(), 1, "deleting in one workspace leaves the other");
    store.lock_workspace("b").unwrap();
    assert_eq!(store.get_ai_memory_vectors("b", 10.0, None).err().unwrap().code, Code::Locked);
    assert!(store.get_ai_memory_vectors("default", 10.0, None).is_ok());
}

/// Seals an SSH key into a workspace the way import_ssh_key does, under a fixed id.
fn store_key(store: &Store<FakeDevice>, workspace: &str, id: &str, private: &[u8]) {
    let sealed = store.keystore().seal_field(&format!("ws:{workspace}"), &format!("ssh_key|{id}|private"), private).unwrap();
    store
        .with_workspace(workspace, |c| {
            c.execute(
                "INSERT INTO ssh_keys (id, name, algorithm, fingerprint, public_key, private_key, has_passphrase, created_at) VALUES (?, 'k', 'ed25519', 'SHA256:x', 'ssh-ed25519 AAAA', ?, 0, 1)",
                &[id.into(), sealed.as_str().into()],
            )?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn copying_keeps_the_targets_own_key_and_seals_passphrases_too() {
    use crate::records::RunbookInput;
    let env = Env::new();
    let store = env.started();
    store.create_workspace(Some("w2"), "W2", None, None).unwrap();
    store_key(&store, "default", "k1", b"SOURCE KEY");
    store_key(&store, "w2", "k1", b"TARGET KEY");
    let keyed = |id: &str| ProfileInput { key_id: Some("k1".into()), auth_type: Some("key".into()), passphrase: set("pp-secret"), ..profile(id, SecretUpdate::Keep) };
    store.save_profiles("default", &[keyed("a"), keyed("b")]).unwrap();
    let rb = |id: &str, title: &str| RunbookInput { id: id.into(), title: title.into(), script: "ls".into(), risk_level: None, created_at: Some(1.0) };
    store.save_runbooks("default", &[rb("r1", "source")]).unwrap();
    store.save_runbooks("w2", &[rb("r1", "target")]).unwrap();

    store.copy_profiles("default", "w2", &ids(&["a"]), false).unwrap();
    store.copy_profiles("default", "w2", &ids(&["b"]), false).unwrap();
    let secrets = store.connect_secrets("w2", "a").unwrap();
    assert_eq!(secrets.private_key.unwrap().as_slice(), b"TARGET KEY", "the target keeps its own key");
    assert_eq!(secrets.passphrase.unwrap().as_slice(), b"pp-secret");
    assert_eq!(store.connect_secrets("w2", "b").unwrap().passphrase.unwrap().as_slice(), b"pp-secret");
    let source = store.with_workspace("default", |c| Ok(c.query_row("SELECT passphrase FROM profiles WHERE id = 'a'", &[], |r| r.text(0))?)).unwrap();
    let target = store.with_workspace("w2", |c| Ok(c.query_row("SELECT passphrase FROM profiles WHERE id = 'a'", &[], |r| r.text(0))?)).unwrap();
    assert_ne!(source, target, "the passphrase is sealed again");
    let runbooks = store.get_runbooks("w2").unwrap();
    assert_eq!(runbooks.iter().map(|r| r.title.as_str()).collect::<Vec<_>>(), ["target"], "no runbooks without include_runbooks");
}

// ───────────────────────────── stage B: SSH keys ─────────────────────────────

fn wire(bytes: &[u8]) -> Vec<u8> {
    let mut out = (bytes.len() as u32).to_be_bytes().to_vec();
    out.extend_from_slice(bytes);
    out
}

fn blob(parts: &[&[u8]]) -> Vec<u8> {
    parts.iter().flat_map(|part| wire(part)).collect()
}

fn ed25519_blob(fill: u8) -> Vec<u8> {
    blob(&[b"ssh-ed25519", &[fill; 32]])
}

#[test]
fn ssh_keys_are_sealed_and_described_by_their_public_key() {
    use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let env = Env::new();
    let store = env.started();
    let ed = ed25519_blob(7);
    let key = store.import_ssh_key("default", "laptop", b"PRIVATE KEY DATA", None, &ed).unwrap();
    assert_eq!((key.algorithm.as_str(), key.has_passphrase), ("ed25519", false));
    assert_eq!(key.public_key, format!("ssh-ed25519 {} laptop", STANDARD.encode(&ed)));
    assert_eq!(key.fingerprint, format!("SHA256:{}", STANDARD_NO_PAD.encode(Sha256::digest(&ed))));
    let (private, passphrase) = store
        .with_workspace("default", |c| Ok(c.query_row("SELECT private_key, passphrase FROM ssh_keys", &[], |r| Ok((r.text(0)?, r.text(1)?)))?))
        .unwrap();
    let private = private.unwrap();
    assert!(private.starts_with("gk1:") && !private.contains("PRIVATE"), "the key is a sealed field");
    assert_eq!(passphrase, None);

    let mut modulus = vec![0u8, 0xc0];
    modulus.extend(std::iter::repeat_n(0u8, 383));
    let named = |public: &[u8]| store.import_ssh_key("default", "k", b"k", None, public).map(|k| k.algorithm);
    assert_eq!(named(&blob(&[b"ssh-rsa", &[1, 0, 1], &modulus])).unwrap(), "rsa-3072");
    let point = [4u8; 97];
    assert_eq!(named(&blob(&[b"ecdsa-sha2-nistp384", b"nistp384", &point])).unwrap(), "ecdsa-p384");
    assert_eq!(named(&blob(&[b"ecdsa-sha2-nistp521", b"nistp521", &point])).unwrap(), "ecdsa-p521");
    for junk in [
        b"hello".to_vec(),
        [ed.clone(), vec![0]].concat(),
        blob(&[b"ssh-ed25519", &[1; 31]]),
        blob(&[b"ecdsa-sha2-nistp256", b"nistp384", &point]),
        blob(&[b"sk-ssh-ed25519@openssh.com", &[1; 32]]),
        blob(&[b"ssh-rsa", &[1, 0, 1]]),
        blob(&[b"ssh-dss", &[1], &[2], &[3], &[4]]),
    ] {
        assert_eq!(named(&junk).err().unwrap().code, Code::InvalidArgument, "{junk:?}");
    }
    let refused = |name: &str, data: &[u8]| store.import_ssh_key("default", name, data, None, &ed).err().unwrap().code;
    assert_eq!(refused("k", b""), Code::InvalidArgument);
    assert_eq!(refused("k", &vec![1u8; 64 * 1024 + 1]), Code::InvalidArgument);
    assert_eq!(refused("  ", b"k"), Code::InvalidArgument);
    assert_eq!(refused("tab\tname", b"k"), Code::InvalidArgument);
    assert_eq!(refused(&"x".repeat(129), b"k"), Code::InvalidArgument);
    assert!(store.import_ssh_key("default", &"x".repeat(128), b"k", None, &ed).is_ok());
    assert_eq!(store.import_ssh_key("ghost", "k", b"k", None, &ed).err().unwrap().code, Code::NotFound);

    let names: Vec<String> = store.list_ssh_keys("default").unwrap().into_iter().map(|k| k.name).collect();
    assert_eq!(names.len(), 5);
    assert_eq!(names[0], "laptop", "oldest first");
    drop(store);
    let store = env.started();
    assert_eq!(store.list_ssh_keys("default").unwrap()[0], key, "kept across a restart");
}

#[test]
fn deleting_a_key_leaves_its_profiles_without_one_and_an_unknown_key_id_is_refused() {
    let env = Env::new();
    let store = env.started();
    let key = store.import_ssh_key("default", "deploy", b"KEY", None, &ed25519_blob(1)).unwrap();
    let keyed = |id: &str, key_id: &str| ProfileInput { key_id: Some(key_id.into()), auth_type: Some("key".into()), ..profile(id, SecretUpdate::Keep) };
    store.save_profiles("default", &[keyed("a", &key.id), profile("b", SecretUpdate::Keep)]).unwrap();
    assert_eq!(store.save_profiles("default", &[keyed("c", "ghost")]).err().unwrap().code, Code::InvalidArgument);
    assert_eq!(store.list_profiles("default").unwrap().len(), 2, "a refused save changes nothing");
    // An empty keyId means none.
    store.save_profiles("default", &[keyed("a", &key.id), keyed("e", "")]).unwrap();
    assert_eq!(store.list_profiles("default").unwrap()[1].key_id, None);
    store.delete_ssh_key("default", &key.id).unwrap();
    assert!(store.list_ssh_keys("default").unwrap().is_empty());
    assert_eq!(store.list_profiles("default").unwrap()[0].key_id, None);
    assert_eq!(store.delete_ssh_key("default", &key.id).err().unwrap().code, Code::NotFound);
    assert_eq!(store.save_profiles("default", &[keyed("a", &key.id)]).err().unwrap().code, Code::InvalidArgument);
}

#[test]
fn a_stored_key_brings_its_passphrase_over_a_stale_one_on_the_profile() {
    let env = Env::new();
    let store = env.started();
    let key = store.import_ssh_key("default", "enc", b"ENCRYPTED KEY", Some("key-pass"), &ed25519_blob(2)).unwrap();
    assert!(key.has_passphrase);
    let sealed = store.with_workspace("default", |c| Ok(c.query_row("SELECT passphrase FROM ssh_keys", &[], |r| r.text(0))?)).unwrap().unwrap();
    assert!(sealed.starts_with("gk1:") && !sealed.contains("key-pass"));
    let keyed = |id: &str, passphrase: SecretUpdate| ProfileInput { key_id: Some(key.id.clone()), auth_type: Some("key".into()), passphrase, ..profile(id, SecretUpdate::Keep) };
    store.save_profiles("default", &[keyed("own", SecretUpdate::Keep), keyed("stale", set("old-file-pass"))]).unwrap();
    let own = store.connect_secrets("default", "own").unwrap();
    assert_eq!(own.private_key.unwrap().as_slice(), b"ENCRYPTED KEY");
    assert_eq!(own.passphrase.unwrap().as_slice(), b"key-pass");
    assert_eq!(store.connect_secrets("default", "stale").unwrap().passphrase.unwrap().as_slice(), b"key-pass", "the key's checked passphrase wins");
    // A key stored without a passphrase leaves the profile's.
    let plain = store.import_ssh_key("default", "plain", b"PLAIN KEY", None, &ed25519_blob(6)).unwrap();
    store
        .save_profiles("default", &[ProfileInput { key_id: Some(plain.id.clone()), auth_type: Some("key".into()), passphrase: set("profile-pass"), ..profile("p", SecretUpdate::Keep) }])
        .unwrap();
    assert_eq!(store.connect_secrets("default", "p").unwrap().passphrase.unwrap().as_slice(), b"profile-pass");
    // Switched back to password login: the keyId stays, but the password is what is tried.
    store
        .save_profiles("default", &[ProfileInput { key_id: Some(plain.id.clone()), auth_type: Some("password".into()), password: set("pw"), ..profile("p", SecretUpdate::Keep) }])
        .unwrap();
    assert_eq!(store.list_profiles("default").unwrap()[0].key_id.as_deref(), Some(plain.id.as_str()));
    let password_login = store.connect_secrets("default", "p").unwrap();
    assert!(password_login.private_key.is_none(), "a password login does not bring the stored key");
    assert_eq!(password_login.password.unwrap().as_slice(), b"pw");
}

#[test]
fn a_copied_profile_brings_its_key_and_the_keys_passphrase_sealed_again() {
    let env = Env::new();
    let store = env.started();
    store.create_workspace(Some("w2"), "W2", None, None).unwrap();
    let key = store.import_ssh_key("default", "enc", b"KEY BYTES", Some("key-pass"), &ed25519_blob(3)).unwrap();
    store.save_profiles("default", &[ProfileInput { key_id: Some(key.id.clone()), auth_type: Some("key".into()), ..profile("a", SecretUpdate::Keep) }]).unwrap();
    store.copy_profiles("default", "w2", &ids(&["a"]), false).unwrap();
    let copied = store.connect_secrets("w2", "a").unwrap();
    assert_eq!(copied.private_key.unwrap().as_slice(), b"KEY BYTES");
    assert_eq!(copied.passphrase.unwrap().as_slice(), b"key-pass");
    assert_eq!(store.list_ssh_keys("w2").unwrap(), vec![key]);
    let sealed = |ws: &str| store.with_workspace(ws, |c| Ok(c.query_row("SELECT passphrase FROM ssh_keys", &[], |r| r.text(0))?)).unwrap();
    assert_ne!(sealed("default"), sealed("w2"), "sealed again for the target");
}

#[test]
fn the_keys_of_a_locked_workspace_are_out_of_reach() {
    let env = Env::new();
    let store = env.started();
    store.create_workspace(Some("secret"), "Secret", None, Some("eight-chars")).unwrap();
    let key = store.import_ssh_key("secret", "k", b"KEY", None, &ed25519_blob(4)).unwrap();
    store.lock_workspace("secret").unwrap();
    assert_eq!(store.list_ssh_keys("secret").err().unwrap().code, Code::Locked);
    assert_eq!(store.import_ssh_key("secret", "k", b"KEY", None, &ed25519_blob(5)).err().unwrap().code, Code::Locked);
    assert_eq!(store.delete_ssh_key("secret", &key.id).err().unwrap().code, Code::Locked);
    store.unlock_workspace("secret", pw("eight-chars")).unwrap();
    assert_eq!(store.list_ssh_keys("secret").unwrap(), vec![key]);
}

#[test]
fn argon2_for_putty_files_is_deterministic_and_capped() {
    use crate::ssh_keys::derive_argon2;
    let a = derive_argon2("argon2id", b"pass", b"saltsalt", 8192, 2, 1, 80).unwrap();
    assert_eq!(a.len(), 80);
    assert_eq!(a, derive_argon2("argon2id", b"pass", b"saltsalt", 8192, 2, 1, 80).unwrap());
    assert_ne!(a, derive_argon2("argon2i", b"pass", b"saltsalt", 8192, 2, 1, 80).unwrap());
    assert_ne!(a, derive_argon2("argon2d", b"pass", b"saltsalt", 8192, 2, 1, 80).unwrap());
    for (algorithm, salt, memory, passes, parallelism, length) in [
        ("scrypt", &b"saltsalt"[..], 8192, 1, 1, 80),
        ("argon2id", &b"short"[..], 8192, 1, 1, 80),
        ("argon2id", &b"saltsalt"[..], 256 * 1024 + 1, 1, 1, 80),
        ("argon2id", &b"saltsalt"[..], 256 * 1024, 9, 1, 80),
        ("argon2id", &b"saltsalt"[..], 8192, 0, 1, 80),
        ("argon2id", &b"saltsalt"[..], 8192, 1, 17, 80),
        ("argon2id", &b"saltsalt"[..], 8192, 1, 1, 0),
    ] {
        assert_eq!(derive_argon2(algorithm, b"pass", salt, memory, passes, parallelism, length).err().unwrap().code, Code::InvalidArgument);
    }
}

// ───────────────────────────── S4: app-wide secrets ─────────────────────────────

#[test]
fn app_secrets_are_sealed_listed_by_name_and_deleted_with_none() {
    let env = Env::new();
    let store = env.started();
    store.set_app_secret("ai/openai", Some("sk-openai-secret")).unwrap();
    store.set_app_secret("ai/anthropic", Some("sk-ant-secret")).unwrap();
    store.set_app_secret("plugin/x", Some("")).unwrap();
    assert_eq!(store.get_app_secret("ai/openai").unwrap().unwrap().as_slice(), b"sk-openai-secret");
    assert_eq!(store.get_app_secret("plugin/x").unwrap().unwrap().as_slice(), b"", "an empty value is still a value");
    assert!(store.get_app_secret("missing").unwrap().is_none());
    assert_eq!(store.list_app_secret_names(None).unwrap(), ["ai/anthropic", "ai/openai", "plugin/x"]);
    assert_eq!(store.list_app_secret_names(Some("ai/")).unwrap(), ["ai/anthropic", "ai/openai"]);
    assert_eq!(store.list_app_secret_names(Some("")).unwrap().len(), 3);

    store.set_app_secret("ai/openai", Some("sk-rotated")).unwrap();
    assert_eq!(store.get_app_secret("ai/openai").unwrap().unwrap().as_slice(), b"sk-rotated");
    store.set_app_secret("ai/openai", None).unwrap();
    assert!(store.get_app_secret("ai/openai").unwrap().is_none());
    store.set_app_secret("never-set", None).unwrap();

    for bad in ["", "a\u{1}b", &"n".repeat(257)] {
        assert_eq!(store.set_app_secret(bad, Some("v")).err().unwrap().code, Code::InvalidArgument, "{bad:?}");
        assert_eq!(store.get_app_secret(bad).err().unwrap().code, Code::InvalidArgument);
    }

    // On disk the value is a sealed field bound to its name.
    let raw = store.with_main(|c| Ok(c.query_row("SELECT value FROM app_secrets WHERE name = 'ai/anthropic'", &[], |r| r.text(0))?)).unwrap().unwrap();
    assert!(raw.starts_with("gk1:") && !raw.contains("sk-ant"), "{raw}");
    store
        .with_main(|c| {
            c.execute("INSERT INTO app_secrets (name, value, updated_at) VALUES ('copied', ?, 1)", &[raw.as_str().into()])?;
            Ok(())
        })
        .unwrap();
    assert!(store.get_app_secret("copied").is_err(), "a value moved to another name does not open");
}

#[test]
fn app_secrets_follow_the_master_password() {
    let env = Env::new();
    let store = env.started();
    store.set_app_secret("ai/openai", Some("sk-1")).unwrap();
    store.set_master_password("correct horse battery", None).unwrap();
    assert_eq!(store.get_app_secret("ai/openai").unwrap().unwrap().as_slice(), b"sk-1", "the key rotation keeps them readable");
    store.lock_app();
    assert_eq!(store.get_app_secret("ai/openai").err().unwrap().code, Code::Locked);
    assert_eq!(store.set_app_secret("ai/openai", Some("x")).err().unwrap().code, Code::Locked);
    assert_eq!(store.list_app_secret_names(None).err().unwrap().code, Code::Locked);
    drop(store);
    let store = env.started();
    store.unlock_app(pw("correct horse battery")).unwrap();
    assert_eq!(store.get_app_secret("ai/openai").unwrap().unwrap().as_slice(), b"sk-1");
    store.remove_master_password("correct horse battery").unwrap();
    assert_eq!(store.get_app_secret("ai/openai").unwrap().unwrap().as_slice(), b"sk-1");
}

#[test]
fn app_secrets_travel_in_an_export() {
    let env = Env::new();
    let store = source_with_data(&env);
    store.set_app_secret("ai/openai", Some("sk-travels")).unwrap();
    let bundle = export_to(&store, &env, &["default"]);
    let target = Env::new();
    let (imported, _backup) = import_into(&target, &bundle);
    drop(imported);
    let store = target.started();
    assert_eq!(store.get_app_secret("ai/openai").unwrap().unwrap().as_slice(), b"sk-travels");
}

#[test]
fn app_secrets_need_a_started_store() {
    let env = Env::new();
    let store = env.open();
    assert_eq!(store.set_app_secret("a", Some("b")).err().unwrap().code, Code::NotConfigured);
    assert_eq!(store.get_app_secret("a").err().unwrap().code, Code::NotConfigured);
}
