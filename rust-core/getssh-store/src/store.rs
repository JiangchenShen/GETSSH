//! The data layer: the keystore, main.db and every workspace database, behind one object.
//! Ported from DatabaseManager.ts and keystoreHandler.ts; database keys never leave this crate.
//!
//! Locking: `main` and `workspaces` are held only for database work, never across a keystore
//! call that may prompt (Touch ID / Windows Hello) or run Argon2.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use getssh_keystore::crypto::Key32;
use getssh_keystore::device::Device;
use getssh_keystore::keyring::APP;
use getssh_keystore::store::ScopeStatus;
use getssh_keystore::{KsError, Keystore};
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

use crate::error::{Code, StoreError, StoreResult};
use crate::rekey;
use crate::schema;
use crate::sqlite::{Connection, Key, Mode};

/// The label every GETSSH database key is derived with (keystore.ts DATABASE_KEY_LABEL).
pub const DATABASE_LABEL: &str = "database";
/// Master passwords set before 3.0 may be shorter; they must be changed after unlocking.
pub const MIN_MASTER_PASSWORD_CHARS: usize = 12;
const MAX_WORKSPACE_ID_UTF16: usize = 128;

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Whether a master password is shorter than the 3.0 minimum (counted in characters after NFC).
pub fn master_password_too_short(password: &str) -> bool {
    password.nfc().count() < MIN_MASTER_PASSWORD_CHARS
}

/// The same rules as utils/workspaceId.ts: ids are file and directory names.
pub fn validate_workspace_id(id: &str) -> StoreResult<()> {
    let len = id.encode_utf16().count();
    let reserved = {
        let lower = id.to_ascii_lowercase();
        let stem = lower.split('.').next().unwrap_or("");
        matches!(stem, "con" | "prn" | "aux" | "nul")
            || ((stem.starts_with("com") || stem.starts_with("lpt")) && stem.len() == 4 && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    };
    let valid = len > 0
        && len <= MAX_WORKSPACE_ID_UTF16
        && id == id.trim()
        && !id.starts_with('.')
        && !id.ends_with('.')
        && !id.chars().any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || (c as u32) < 0x20 || c == '\u{7f}')
        && !reserved;
    if valid {
        Ok(())
    } else {
        Err(StoreError::invalid("invalid workspace id"))
    }
}

pub fn workspace_scope(id: &str) -> StoreResult<String> {
    validate_workspace_id(id)?;
    Ok(format!("ws:{id}"))
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StartReport {
    pub migrated_workspaces: Vec<String>,
    pub deferred_workspaces: Vec<String>,
    pub presence_to_reenable: Vec<String>,
    pub failed_workspaces: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppStateInfo {
    pub ready: bool,
    pub master_password: bool,
    pub master_password_must_change: bool,
    pub presence_supported: bool,
    pub presence_enabled: bool,
    pub recovery_configured: bool,
    pub device_key_lost: bool,
    pub device_backend: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub theme_color: Option<String>,
    pub is_main: bool,
    pub has_password: bool,
    pub presence_enabled: bool,
    pub open: bool,
    pub preferences: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceStats {
    pub size_mb: f64,
    pub profile_count: i64,
    pub runbook_count: i64,
}

/// The result of unlocking several workspaces at once (before an export).
#[derive(Debug, Default, PartialEq, Eq)]
pub struct BatchUnlock {
    pub unlocked: Vec<String>,
    pub failed: Vec<(String, Code)>,
}

pub enum UnlockRoute {
    Password(Zeroizing<String>),
    Presence(String),
    RecoveryCode(Zeroizing<String>),
}

#[derive(Default)]
pub struct WorkspaceChanges {
    pub name: Option<String>,
    pub theme_color: Option<Option<String>>,
    pub preferences: Option<String>,
}

pub struct Store<D: Device> {
    base: PathBuf,
    ks: Keystore<D>,
    main: Mutex<Option<Connection>>,
    workspaces: Mutex<HashMap<String, Connection>>,
    must_change_master: AtomicBool,
}

fn is_locked(error: &KsError) -> bool {
    matches!(error, KsError::Locked(_) | KsError::NoPassword(_))
}

#[cfg(unix)]
fn owner_only(path: &Path, mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn owner_only(_path: &Path, _mode: u32) -> std::io::Result<()> {
    Ok(())
}

fn is_plain_sqlite(path: &Path) -> bool {
    use std::io::Read;
    let mut header = [0u8; 16];
    fs::File::open(path).and_then(|mut f| f.read_exact(&mut header)).is_ok() && &header == b"SQLite format 3\0"
}

impl<D: Device> Store<D> {
    /// Opens the store on `base` (normally ~/.getssh), creating the directory with mode 0700.
    pub fn open(device: D, base: PathBuf) -> StoreResult<Self> {
        fs::create_dir_all(&base)?;
        owner_only(&base, 0o700)?;
        let ks = Keystore::open(device, base.join("keyring.json"))?;
        Ok(Self::with_keystore(ks, base))
    }

    pub fn with_keystore(ks: Keystore<D>, base: PathBuf) -> Self {
        Store { base, ks, main: Mutex::new(None), workspaces: Mutex::new(HashMap::new()), must_change_master: AtomicBool::new(false) }
    }

    pub fn keystore(&self) -> &Keystore<D> {
        &self.ks
    }

    pub fn base(&self) -> &Path {
        &self.base
    }

    fn main_path(&self) -> PathBuf {
        self.base.join("main.db")
    }

    pub(crate) fn workspace_path(&self, id: &str) -> PathBuf {
        self.base.join(format!("workspace_{id}.db"))
    }

    fn db_key(&self, scope: &str, staged: bool) -> StoreResult<Key32> {
        Ok(self.ks.database_key(scope, DATABASE_LABEL, staged)?)
    }

    fn scope_status(&self, scope: &str) -> Option<ScopeStatus> {
        self.ks.status().scopes.into_iter().find(|s| s.id == scope)
    }

    fn app_protected(&self) -> bool {
        self.ks.status().app_protected
    }

    // ───────────────────────────── connections ─────────────────────────────

    pub(crate) fn with_main<T>(&self, f: impl FnOnce(&Connection) -> StoreResult<T>) -> StoreResult<T> {
        let guard = self.main.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(conn) => f(conn),
            None => Err(StoreError::locked(APP)),
        }
    }

    pub fn is_main_open(&self) -> bool {
        self.main.lock().unwrap_or_else(|e| e.into_inner()).is_some()
    }

    /// Runs `f` on a workspace database, mounting it first when its key is already in memory.
    pub(crate) fn with_workspace<T>(&self, id: &str, f: impl FnOnce(&Connection) -> StoreResult<T>) -> StoreResult<T> {
        let scope = workspace_scope(id)?;
        if !self.is_mounted(id) {
            match self.scope_status(&scope) {
                Some(status) if status.unlocked => self.mount(id)?,
                Some(_) => return Err(StoreError::locked(scope)),
                None => return Err(StoreError::not_found(format!("workspace {id}"))),
            }
        }
        let guard = self.workspaces.lock().unwrap_or_else(|e| e.into_inner());
        match guard.get(id) {
            Some(conn) => f(conn),
            None => Err(StoreError::locked(scope)),
        }
    }

    pub fn is_mounted(&self, id: &str) -> bool {
        self.workspaces.lock().unwrap_or_else(|e| e.into_inner()).contains_key(id)
    }

    fn prepare(conn: &Connection) -> StoreResult<()> {
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;")?;
        Ok(())
    }

    fn open_main(&self) -> StoreResult<()> {
        if self.is_main_open() {
            return Ok(());
        }
        let key = self.db_key(APP, false)?;
        let path = self.main_path();
        let conn = Connection::open(&path, &Key::Raw(&key), Mode::Create)?;
        owner_only(&path, 0o600)?;
        Self::prepare(&conn)?;
        schema::migrate_main(&conn)?;
        let count = conn.query_row("SELECT count(*) FROM workspaces", &[], |r| r.integer(0))?;
        if count == 0 {
            let now = now_ms();
            conn.execute(
                "INSERT INTO workspaces (id, name, themeColor, hasPassword, biometric_enabled, is_main, preferences, created_at, updated_at) VALUES ('default', 'Default Workspace', NULL, 0, 0, 1, '{}', ?, ?)",
                &[now.into(), now.into()],
            )?;
        }
        *self.main.lock().unwrap_or_else(|e| e.into_inner()) = Some(conn);
        Ok(())
    }

    /// Opens a workspace database whose key is in memory.
    fn mount(&self, id: &str) -> StoreResult<()> {
        if self.is_mounted(id) {
            return Ok(());
        }
        let scope = workspace_scope(id)?;
        let key = self.db_key(&scope, false)?;
        let path = self.workspace_path(id);
        let conn = Connection::open(&path, &Key::Raw(&key), Mode::Create)?;
        owner_only(&path, 0o600)?;
        Self::prepare(&conn)?;
        schema::migrate_workspace(&conn)?;
        crate::profiles::seal_legacy_secrets(&self.ks, &scope, &conn)?;
        self.workspaces.lock().unwrap_or_else(|e| e.into_inner()).insert(id.to_string(), conn);
        Ok(())
    }

    /// Closes every database whose scope is locked now.
    fn close_locked(&self) {
        let status = self.ks.status();
        let unlocked = |scope: &str| status.scopes.iter().any(|s| s.id == scope && s.unlocked);
        if !unlocked(APP) {
            *self.main.lock().unwrap_or_else(|e| e.into_inner()) = None;
        }
        self.workspaces.lock().unwrap_or_else(|e| e.into_inner()).retain(|id, _| unlocked(&format!("ws:{id}")));
    }

    fn workspace_ids(&self) -> StoreResult<Vec<String>> {
        self.with_main(|conn| Ok(conn.query_map("SELECT id FROM workspaces ORDER BY created_at ASC", &[], |r| Ok(r.text(0)?.unwrap_or_default()))?))
    }

    // ───────────────────────────── lifecycle ─────────────────────────────

    /// Opens everything that needs no password. A first run creates the keyring and main.db.
    pub fn start(&self) -> StoreResult<StartReport> {
        let keyring = self.base.join("keyring.json");
        if !keyring.exists() {
            let legacy = ["app_key.enc", "app_key.txt", "getssh.db"].iter().any(|n| self.base.join(n).exists()) || self.main_path().exists();
            if legacy {
                // The 2.x / early-3.0 migration still runs in keystoreMigration.ts until step S6.
                return Err(StoreError::new(Code::Unavailable, "legacy data must be migrated first"));
            }
            self.ks.initialize()?;
        }
        let mut report = StartReport::default();
        match self.ks.open_scope(APP) {
            Ok(()) => {}
            Err(error) if is_locked(&error) => return Ok(report),
            Err(error) => return Err(error.into()),
        }
        self.open_main()?;
        self.after_unlock(&mut report)?;
        Ok(report)
    }

    /// Finishes rotations and opens every workspace that needs nothing more.
    fn after_unlock(&self, report: &mut StartReport) -> StoreResult<()> {
        self.complete_pending_rotations()?;
        for id in self.workspace_ids()? {
            match self.open_workspace(&id) {
                Ok(_) => {}
                Err(error) if error.code == Code::NeedsPassword => report.deferred_workspaces.push(id),
                Err(error) if matches!(error.code, Code::Corrupt | Code::Io) => report.failed_workspaces.push(id),
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }

    pub fn app_state(&self) -> AppStateInfo {
        let status = self.ks.status();
        let app = status.scopes.iter().find(|s| s.id == APP);
        AppStateInfo {
            ready: app.is_some_and(|s| s.unlocked) && self.is_main_open(),
            master_password: status.app_protected,
            master_password_must_change: self.must_change_master.load(Ordering::SeqCst),
            presence_supported: status.presence_supported,
            presence_enabled: app.is_some_and(|s| s.presence),
            recovery_configured: status.recovery_configured,
            device_key_lost: status.device_key_lost,
            device_backend: status.quiet_backend.unwrap_or_else(|| "unsupported".into()),
        }
    }

    pub fn unlock_app(&self, route: UnlockRoute) -> StoreResult<AppStateInfo> {
        match &route {
            UnlockRoute::Password(password) => {
                self.ks.unlock_with_password(APP, password)?;
                self.must_change_master.store(master_password_too_short(password), Ordering::SeqCst);
            }
            UnlockRoute::Presence(reason) => self.ks.unlock_with_presence(APP, reason)?,
            UnlockRoute::RecoveryCode(code) => {
                self.ks.unlock_with_recovery(code)?;
            }
        }
        self.open_main()?;
        self.after_unlock(&mut StartReport::default())?;
        Ok(self.app_state())
    }

    /// Drops every key a password protects and closes those databases.
    pub fn lock_app(&self) {
        self.ks.lock_protected();
        self.close_locked();
    }

    // ─────────────────────────── key rotations ───────────────────────────

    /// Moves a scope's database to its staged key, then commits the rotation. After a crash
    /// between the two steps the file already opens with the staged key and only the commit runs.
    fn complete_rotation(&self, scope: &str) -> StoreResult<()> {
        if !self.scope_status(scope).is_some_and(|s| s.staged) {
            return Ok(());
        }
        let staged = self.db_key(scope, true)?;
        let to = Key::Raw(&staged);
        let file = match scope {
            APP => self.main_path(),
            _ => self.workspace_path(&scope["ws:".len()..]),
        };
        let rekeyed_open = if scope == APP {
            let guard = self.main.lock().unwrap_or_else(|e| e.into_inner());
            match guard.as_ref() {
                Some(conn) => rekey::rekey_open(conn, &to).map(|_| true)?,
                None => false,
            }
        } else {
            let guard = self.workspaces.lock().unwrap_or_else(|e| e.into_inner());
            match guard.get(&scope["ws:".len()..]) {
                Some(conn) => rekey::rekey_open(conn, &to).map(|_| true)?,
                None => false,
            }
        };
        if !rekeyed_open && file.exists() && Connection::open(&file, &to, Mode::ReadOnly).is_err() {
            let current = self.db_key(scope, false)?;
            rekey::rekey_file(&file, &Key::Raw(&current), &to)?;
        }
        self.ks.commit_rotation(scope)?;
        Ok(())
    }

    fn complete_pending_rotations(&self) -> StoreResult<()> {
        for scope in self.ks.status().scopes {
            if scope.staged && scope.unlocked {
                self.complete_rotation(&scope.id)?;
            }
        }
        Ok(())
    }

    fn complete_rotations(&self, staged: Vec<String>) -> StoreResult<()> {
        for scope in staged {
            self.complete_rotation(&scope)?;
        }
        Ok(())
    }

    // ──────────────────── master password, presence, recovery ────────────────────

    /// Returns whether a recovery code existed and was reset (setting a master password discards it).
    pub fn set_master_password(&self, password: &str, current: Option<&str>) -> StoreResult<bool> {
        if self.app_protected() {
            let current = current.ok_or_else(|| StoreError::new(Code::NeedsPassword, "the current master password is required"))?;
            self.ks.verify_password(APP, current)?;
        } else if self.must_change_master.load(Ordering::SeqCst) {
            return Err(StoreError::new(Code::MustChangeMasterPassword, ""));
        }
        let recovery_before = self.ks.status().recovery_configured;
        let staged = self.ks.set_password(APP, password)?;
        self.complete_rotations(staged)?;
        self.must_change_master.store(false, Ordering::SeqCst);
        Ok(recovery_before && !self.ks.status().recovery_configured)
    }

    pub fn remove_master_password(&self, current: &str) -> StoreResult<()> {
        if !self.app_protected() {
            return Err(StoreError::invalid("no master password is set"));
        }
        self.ks.verify_password(APP, current)?;
        let staged = self.ks.remove_password(APP)?;
        self.complete_rotations(staged)?;
        self.must_change_master.store(false, Ordering::SeqCst);
        Ok(())
    }

    /// Touch ID / Windows Hello for the app (with a master password) and for every unlocked
    /// workspace that has its own password.
    pub fn set_presence(&self, enabled: bool, reason: &str) -> StoreResult<()> {
        let status = self.ks.status();
        let targets: Vec<&ScopeStatus> = status
            .scopes
            .iter()
            .filter(|s| if s.id == APP { status.app_protected } else { s.own_password })
            .collect();
        if enabled && !status.presence_supported {
            return Err(StoreError::new(Code::Unavailable, "Touch ID / Windows Hello is not available"));
        }
        for scope in targets {
            if enabled && !scope.presence && scope.unlocked {
                self.ks.enable_presence(&scope.id, reason)?;
            } else if !enabled && scope.presence {
                self.ks.disable_presence(&scope.id)?;
            }
        }
        Ok(())
    }

    /// A new recovery code, shown once. With a master password the current one is required;
    /// without one the OS confirms the person where it can.
    pub fn create_recovery_code(&self, current: Option<&str>) -> StoreResult<Zeroizing<String>> {
        let status = self.ks.status();
        if status.app_protected {
            let current = current.ok_or_else(|| StoreError::new(Code::NeedsPassword, "the current master password is required"))?;
            self.ks.verify_password(APP, current)?;
        } else if status.presence_supported {
            self.ks.verify_presence("create a recovery code")?;
        }
        Ok(self.ks.setup_recovery()?)
    }

    pub fn remove_recovery_code(&self) -> StoreResult<()> {
        Ok(self.ks.remove_recovery()?)
    }

    pub fn verify_presence(&self, reason: &str) -> StoreResult<bool> {
        match self.ks.verify_presence(reason) {
            Ok(()) => Ok(true),
            Err(KsError::Cancelled) => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    pub fn verify_password(&self, password: &str, workspace: Option<&str>) -> StoreResult<bool> {
        let scope = match workspace {
            Some(id) => workspace_scope(id)?,
            None => APP.to_string(),
        };
        match self.ks.verify_password(&scope, password) {
            Ok(()) => Ok(true),
            Err(KsError::WrongPassword) => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    // ───────────────────────────── workspaces ─────────────────────────────

    pub fn list_workspaces(&self) -> StoreResult<Vec<WorkspaceInfo>> {
        let status = self.ks.status();
        let rows = self.with_main(|conn| {
            Ok(conn.query_map(
                "SELECT id, name, themeColor, is_main, preferences, created_at, updated_at FROM workspaces ORDER BY created_at ASC",
                &[],
                |r| {
                    Ok((
                        r.text(0)?.unwrap_or_default(),
                        r.text(1)?.unwrap_or_default(),
                        r.text(2)?,
                        r.optional_integer(3)?.unwrap_or(0) == 1,
                        r.text(4)?.unwrap_or_else(|| "{}".into()),
                        r.integer(5)?,
                        r.integer(6)?,
                    ))
                },
            )?)
        })?;
        Ok(rows
            .into_iter()
            .map(|(id, name, theme_color, is_main, preferences, created_at, updated_at)| {
                let scope = status.scopes.iter().find(|s| s.id == format!("ws:{id}"));
                WorkspaceInfo {
                    open: scope.is_some_and(|s| s.unlocked),
                    has_password: scope.is_some_and(|s| s.own_password),
                    presence_enabled: scope.is_some_and(|s| s.presence),
                    id,
                    name,
                    theme_color,
                    is_main,
                    preferences,
                    created_at,
                    updated_at,
                }
            })
            .collect())
    }

    pub fn workspace(&self, id: &str) -> StoreResult<WorkspaceInfo> {
        self.list_workspaces()?.into_iter().find(|w| w.id == id).ok_or_else(|| StoreError::not_found(format!("workspace {id}")))
    }

    pub fn create_workspace(&self, id: Option<&str>, name: &str, theme_color: Option<&str>, password: Option<&str>) -> StoreResult<WorkspaceInfo> {
        let id = match id {
            Some(id) => id.to_string(),
            None => getssh_keystore::crypto::random_id(),
        };
        let scope = workspace_scope(&id)?;
        if name.trim().is_empty() || name.chars().count() > 128 {
            return Err(StoreError::invalid("invalid workspace name"));
        }
        if password.is_some() && self.app_protected() {
            return Err(StoreError::invalid("the master password already protects every workspace"));
        }
        let exists = self.with_main(|conn| Ok(conn.query_optional("SELECT 1 FROM workspaces WHERE id = ?", &[id.as_str().into()], |_| Ok(()))?.is_some()))?;
        if exists {
            return Err(StoreError::invalid(format!("workspace {id} already exists")));
        }
        let path = self.workspace_path(&id);
        if path.exists() {
            return Err(StoreError::invalid(format!("a database for workspace {id} already exists")));
        }
        self.ks.create_scope(&scope, password)?;
        let created = (|| -> StoreResult<()> {
            self.mount(&id)?;
            let now = now_ms();
            self.with_main(|conn| {
                conn.execute(
                    "INSERT INTO workspaces (id, name, themeColor, hasPassword, biometric_enabled, is_main, preferences, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, '{}', ?, ?)",
                    &[id.as_str().into(), name.into(), theme_color.into(), (password.is_some()).into(), now.into(), now.into()],
                )?;
                Ok(())
            })
        })();
        if let Err(error) = created {
            self.workspaces.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
            let _ = self.ks.delete_scope(&scope);
            remove_database(&path);
            return Err(error);
        }
        self.workspace(&id)
    }

    pub fn update_workspace(&self, id: &str, changes: WorkspaceChanges) -> StoreResult<WorkspaceInfo> {
        validate_workspace_id(id)?;
        if let Some(name) = &changes.name {
            if name.trim().is_empty() || name.chars().count() > 128 {
                return Err(StoreError::invalid("invalid workspace name"));
            }
        }
        if let Some(preferences) = &changes.preferences {
            if preferences.len() > 64 * 1024 {
                return Err(StoreError::invalid("preferences are too large"));
            }
        }
        self.with_main(|conn| {
            conn.transaction(|c| {
                if let Some(name) = &changes.name {
                    c.execute("UPDATE workspaces SET name = ? WHERE id = ?", &[name.as_str().into(), id.into()])?;
                }
                if let Some(theme) = &changes.theme_color {
                    c.execute("UPDATE workspaces SET themeColor = ? WHERE id = ?", &[theme.clone().into(), id.into()])?;
                }
                if let Some(preferences) = &changes.preferences {
                    c.execute("UPDATE workspaces SET preferences = ? WHERE id = ?", &[preferences.as_str().into(), id.into()])?;
                }
                c.execute("UPDATE workspaces SET updated_at = ? WHERE id = ?", &[now_ms().into(), id.into()])?;
                Ok(())
            })?;
            Ok(())
        })?;
        self.workspace(id)
    }

    pub fn set_main_workspace(&self, id: &str) -> StoreResult<()> {
        self.workspace(id)?;
        self.with_main(|conn| {
            conn.transaction(|c| {
                c.execute("UPDATE workspaces SET is_main = 0", &[])?;
                c.execute("UPDATE workspaces SET is_main = 1 WHERE id = ?", &[id.into()])?;
                Ok(())
            })?;
            Ok(())
        })
    }

    pub fn delete_workspace(&self, id: &str) -> StoreResult<()> {
        let workspace = self.workspace(id)?;
        if workspace.is_main {
            return Err(StoreError::invalid("the main workspace cannot be deleted"));
        }
        let scope = workspace_scope(id)?;
        self.workspaces.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
        self.with_main(|conn| {
            conn.transaction(|c| {
                c.execute("DELETE FROM ai_memory_vectors WHERE workspace_id = ?", &[id.into()])?;
                c.execute("DELETE FROM workspaces WHERE id = ?", &[id.into()])?;
                Ok(())
            })?;
            Ok(())
        })?;
        match self.ks.delete_scope(&scope) {
            Ok(()) | Err(KsError::UnknownScope(_)) => {}
            Err(error) => return Err(error.into()),
        }
        remove_database(&self.workspace_path(id));
        let dir = self.base.join("workspaces").join(id);
        if dir.parent() == Some(&self.base.join("workspaces")) {
            let _ = fs::remove_dir_all(dir);
        }
        Ok(())
    }

    /// Opens a workspace that needs nothing more (no password of its own, or the master password
    /// already opened it). Returns false while it waits for a password.
    pub fn open_workspace(&self, id: &str) -> StoreResult<bool> {
        if self.is_mounted(id) {
            return Ok(true);
        }
        let scope = workspace_scope(id)?;
        if self.scope_status(&scope).is_none() {
            return self.adopt_workspace(id);
        }
        match self.ks.open_scope(&scope) {
            Ok(()) => {
                self.complete_rotation(&scope)?;
                self.mount(id)?;
                Ok(true)
            }
            Err(error) if is_locked(&error) => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    /// A workspace row without a key scope: created by an older GETSSH, or found on disk. A plain
    /// (2.x, no password) database is encrypted here; an encrypted one waits for its password.
    fn adopt_workspace(&self, id: &str) -> StoreResult<bool> {
        let scope = workspace_scope(id)?;
        let path = self.workspace_path(id);
        if path.exists() && !is_plain_sqlite(&path) {
            return Err(StoreError::new(Code::NeedsPassword, format!("workspace {id} still uses its pre-3.0 password")));
        }
        self.ks.create_scope(&scope, None)?;
        if path.exists() {
            let key = self.db_key(&scope, false)?;
            if let Err(error) = rekey::rekey_file(&path, &Key::Plain, &Key::Raw(&key)) {
                let _ = self.ks.delete_scope(&scope);
                return Err(error);
            }
        }
        self.mount(id)?;
        Ok(true)
    }

    pub fn unlock_workspace(&self, id: &str, route: UnlockRoute) -> StoreResult<()> {
        let scope = workspace_scope(id)?;
        if self.scope_status(&scope).is_none() {
            // A pre-3.0 password workspace without vault.key: migrated the first time its password is typed.
            let UnlockRoute::Password(password) = route else {
                return Err(StoreError::new(Code::NeedsPassword, format!("workspace {id} still uses its pre-3.0 password")));
            };
            return self.migrate_legacy_workspace(id, &password);
        }
        match route {
            UnlockRoute::Password(password) => self.ks.unlock_with_password(&scope, &password)?,
            UnlockRoute::Presence(reason) => self.ks.unlock_with_presence(&scope, &reason)?,
            UnlockRoute::RecoveryCode(code) => {
                self.ks.unlock_with_recovery(&code)?;
            }
        }
        self.complete_rotation(&scope)?;
        self.mount(id)
    }

    fn migrate_legacy_workspace(&self, id: &str, password: &str) -> StoreResult<()> {
        let scope = workspace_scope(id)?;
        let path = self.workspace_path(id);
        let legacy = Key::Passphrase(password.as_bytes());
        match Connection::open(&path, &legacy, Mode::ReadOnly) {
            Ok(_) => {}
            Err(error) if error.is_not_a_database() => return Err(StoreError::new(Code::WrongPassword, "")),
            Err(error) => return Err(error.into()),
        }
        self.ks.create_scope_with_legacy_password(&scope, password)?;
        let key = self.db_key(&scope, false)?;
        if let Err(error) = rekey::rekey_file(&path, &legacy, &Key::Raw(&key)) {
            let _ = self.ks.delete_scope(&scope);
            return Err(error);
        }
        self.mount(id)
    }

    /// One Touch ID / Windows Hello prompt per workspace that has it enabled (see store.d.ts).
    pub fn unlock_workspaces(&self, ids: &[String], reason: &str) -> StoreResult<BatchUnlock> {
        let status = self.ks.status();
        let mut unlocked = Vec::new();
        let mut failed = Vec::new();
        for id in ids {
            let scope = workspace_scope(id)?;
            if self.is_mounted(id) || self.open_workspace(id).unwrap_or(false) {
                unlocked.push(id.clone());
                continue;
            }
            let presence = status.scopes.iter().any(|s| s.id == scope && s.presence);
            if !presence {
                failed.push((id.clone(), Code::NeedsPassword));
                continue;
            }
            match self.unlock_workspace(id, UnlockRoute::Presence(reason.to_string())) {
                Ok(()) => unlocked.push(id.clone()),
                Err(error) if error.code == Code::Cancelled => {
                    failed.push((id.clone(), Code::Cancelled));
                    // The person said no: do not prompt again for the rest.
                    let rest: Vec<String> = ids.iter().filter(|r| !unlocked.contains(r) && !failed.iter().any(|(f, _)| f == *r)).cloned().collect();
                    failed.extend(rest.into_iter().map(|r| (r, Code::Cancelled)));
                    break;
                }
                Err(error) => failed.push((id.clone(), error.code)),
            }
        }
        Ok(BatchUnlock { unlocked, failed })
    }

    pub fn lock_workspace(&self, id: &str) -> StoreResult<()> {
        let scope = workspace_scope(id)?;
        self.ks.lock_scope(&scope)?;
        self.close_locked();
        Ok(())
    }

    pub fn set_workspace_password(&self, id: &str, password: &str, current: Option<&str>) -> StoreResult<()> {
        let workspace = self.workspace(id)?;
        if workspace.is_main {
            return Err(StoreError::invalid("the main workspace cannot have its own password"));
        }
        if self.app_protected() {
            return Err(StoreError::invalid("the master password already protects every workspace"));
        }
        let scope = workspace_scope(id)?;
        if workspace.has_password {
            let current = current.ok_or_else(|| StoreError::new(Code::NeedsPassword, "the current workspace password is required"))?;
            self.ks.verify_password(&scope, current)?;
        }
        self.open_workspace(id)?;
        let staged = self.ks.set_password(&scope, password)?;
        self.complete_rotations(staged)?;
        self.with_main(|conn| {
            conn.execute("UPDATE workspaces SET hasPassword = 1, updated_at = ? WHERE id = ?", &[now_ms().into(), id.into()])?;
            Ok(())
        })
    }

    pub fn remove_workspace_password(&self, id: &str, current: &str) -> StoreResult<()> {
        let workspace = self.workspace(id)?;
        if !workspace.has_password {
            return Err(StoreError::invalid(format!("workspace {id} has no password")));
        }
        let scope = workspace_scope(id)?;
        self.ks.verify_password(&scope, current)?;
        if !self.is_mounted(id) {
            self.ks.unlock_with_password(&scope, current)?;
            self.mount(id)?;
        }
        let staged = self.ks.remove_password(&scope)?;
        self.complete_rotations(staged)?;
        self.with_main(|conn| {
            conn.execute("UPDATE workspaces SET hasPassword = 0, biometric_enabled = 0, updated_at = ? WHERE id = ?", &[now_ms().into(), id.into()])?;
            Ok(())
        })
    }

    pub fn workspace_stats(&self, id: &str) -> StoreResult<WorkspaceStats> {
        validate_workspace_id(id)?;
        let bytes: u64 = ["", "-wal"].iter().filter_map(|s| fs::metadata(format!("{}{s}", self.workspace_path(id).display())).ok()).map(|m| m.len()).sum();
        let (profile_count, runbook_count) = self
            .with_workspace(id, |conn| {
                let profiles = conn.query_row("SELECT count(*) FROM profiles WHERE workspace_id = ?", &[id.into()], |r| r.integer(0))?;
                let runbooks = conn.query_row("SELECT count(*) FROM runbooks WHERE workspace_id = ?", &[id.into()], |r| r.integer(0))?;
                Ok((profiles, runbooks))
            })
            .unwrap_or((0, 0));
        let size_mb = (bytes as f64 / (1024.0 * 1024.0) * 100.0).round() / 100.0;
        Ok(WorkspaceStats { size_mb, profile_count, runbook_count })
    }

    // ───────────────────────────── settings ─────────────────────────────

    pub fn get_global_setting(&self, key: &str) -> StoreResult<Option<String>> {
        self.with_main(|conn| Ok(conn.query_optional("SELECT value FROM global_settings WHERE key = ?", &[key.into()], |r| r.text(0))?.flatten()))
    }

    pub fn set_global_setting(&self, key: &str, value: &str) -> StoreResult<()> {
        if key.is_empty() || key.len() > 256 || value.len() > 1024 * 1024 {
            return Err(StoreError::invalid("invalid setting"));
        }
        self.with_main(|conn| {
            conn.execute(
                "INSERT INTO global_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                &[key.into(), value.into()],
            )?;
            Ok(())
        })
    }
}

pub(crate) fn remove_database(path: &Path) {
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let _ = fs::remove_file(format!("{}{suffix}", path.display()));
    }
}

