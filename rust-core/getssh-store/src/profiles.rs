//! Server profiles. Passwords and passphrases are sealed fields ("gk1:…", AES-256-GCM under the
//! workspace's field key, bound to workspace, profile and field), so a row copied to another
//! profile or field does not open. Read functions return only hasPassword / hasPassphrase.

use std::collections::{HashMap, HashSet};

use getssh_keystore::device::Device;
use getssh_keystore::{KsError, Keystore};
use zeroize::Zeroizing;

use crate::error::{Code, StoreError, StoreResult};
use crate::sqlite::{Connection, Row, SqlResult, Value};
use crate::store::{workspace_scope, Store};

const PROTOCOLS: &[&str] = &["ssh", "local", "telnet", "auto"];
const AUTH_TYPES: &[&str] = &["password", "key", "agent"];
const MAX_TEXT: usize = 4096;
/// Scripts run after connecting can be long; DatabaseManager.ts never limited them.
const MAX_SCRIPT: usize = 64 * 1024;
const MAX_SECRET_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct Profile {
    pub id: String,
    pub workspace_id: String,
    pub host: String,
    pub username: String,
    pub port: i64,
    pub protocol: String,
    pub auth_type: String,
    pub alias: Option<String>,
    pub os_type: Option<String>,
    pub group_name: Option<String>,
    pub auto_start: bool,
    pub use_keep_alive: bool,
    pub strict_host_key_checking: bool,
    pub proxy_jump: Option<String>,
    pub initial_directory: Option<String>,
    pub post_connect_script: Option<String>,
    pub theme_override: Option<String>,
    pub key_id: Option<String>,
    pub private_key_path: Option<String>,
    pub has_password: bool,
    pub has_passphrase: bool,
}

/// A secret field in a save: keep the stored value, clear it, or set a new one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretUpdate {
    Keep,
    Clear,
    Set(Zeroizing<String>),
}

#[derive(Debug, Clone)]
pub struct ProfileInput {
    pub id: String,
    pub host: String,
    pub username: String,
    pub port: Option<i64>,
    pub protocol: Option<String>,
    pub auth_type: Option<String>,
    pub alias: Option<String>,
    pub os_type: Option<String>,
    pub group_name: Option<String>,
    pub auto_start: bool,
    pub use_keep_alive: bool,
    pub strict_host_key_checking: bool,
    pub proxy_jump: Option<String>,
    pub initial_directory: Option<String>,
    pub post_connect_script: Option<String>,
    pub theme_override: Option<String>,
    pub key_id: Option<String>,
    pub private_key_path: Option<String>,
    pub password: SecretUpdate,
    pub passphrase: SecretUpdate,
}

/// Credentials for a connection: handed to ssh2 by the main process, never to a renderer.
#[derive(Default)]
pub struct ConnectSecrets {
    pub password: Option<Zeroizing<Vec<u8>>>,
    pub passphrase: Option<Zeroizing<Vec<u8>>>,
    pub private_key: Option<Zeroizing<Vec<u8>>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SecretField {
    Password,
    Passphrase,
}

impl SecretField {
    fn column(self) -> &'static str {
        match self {
            SecretField::Password => "password",
            SecretField::Passphrase => "passphrase",
        }
    }
}

fn context(profile_id: &str, field: SecretField) -> String {
    format!("profile|{profile_id}|{}", field.column())
}

const COLUMNS: &str = "id, workspace_id, host, username, port, protocol, authType, alias, osType, groupName, autoStart, useKeepAlive, \
    strictHostKeyChecking, proxyJump, initialDirectory, postConnectScript, themeOverride, keyId, privateKeyPath, password, passphrase";
// Positions in COLUMNS.
const COLUMN_COUNT: usize = 21;
const KEY_ID: usize = 17;
const PASSWORD: usize = 19;
const PASSPHRASE: usize = 20;
const KEY_COLUMNS: &str = "id, name, algorithm, fingerprint, public_key, private_key, has_passphrase, created_at";
const KEY_COLUMN_COUNT: usize = 8;
const KEY_PRIVATE: usize = 5;

fn read_profile(row: &Row<'_, '_>) -> SqlResult<Profile> {
    let flag = |i: usize, default: bool| -> SqlResult<bool> { Ok(row.optional_integer(i)?.map(|v| v != 0).unwrap_or(default)) };
    Ok(Profile {
        id: row.text(0)?.unwrap_or_default(),
        workspace_id: row.text(1)?.unwrap_or_default(),
        host: row.text(2)?.unwrap_or_default(),
        username: row.text(3)?.unwrap_or_default(),
        port: row.optional_integer(4)?.unwrap_or(22),
        protocol: row.text(5)?.unwrap_or_else(|| "ssh".into()),
        auth_type: row.text(6)?.unwrap_or_else(|| "password".into()),
        alias: row.text(7)?,
        os_type: row.text(8)?,
        group_name: row.text(9)?,
        auto_start: flag(10, false)?,
        use_keep_alive: flag(11, true)?,
        strict_host_key_checking: flag(12, false)?,
        proxy_jump: row.text(13)?,
        initial_directory: row.text(14)?,
        post_connect_script: row.text(15)?,
        theme_override: row.text(16)?,
        key_id: row.text(17)?,
        private_key_path: row.text(18)?,
        has_password: row.text(19)?.is_some_and(|v| !v.is_empty()),
        has_passphrase: row.text(20)?.is_some_and(|v| !v.is_empty()),
    })
}

fn check_text(name: &str, value: &Option<String>, max: usize) -> StoreResult<()> {
    if value.as_ref().is_some_and(|v| v.len() > max || v.contains('\0')) {
        return Err(StoreError::invalid(format!("{name} is too long or contains a NUL character")));
    }
    Ok(())
}

fn validate(input: &ProfileInput) -> StoreResult<()> {
    if input.id.is_empty() || input.id.len() > 128 || input.id.chars().any(|c| c.is_control()) {
        return Err(StoreError::invalid("invalid profile id"));
    }
    if input.host.len() > 1024 || input.username.len() > 1024 {
        return Err(StoreError::invalid("host or username is too long"));
    }
    if let Some(port) = input.port {
        if !(0..=65535).contains(&port) {
            return Err(StoreError::invalid("invalid port"));
        }
    }
    if input.protocol.as_deref().is_some_and(|p| !PROTOCOLS.contains(&p)) {
        return Err(StoreError::invalid("invalid protocol"));
    }
    if input.auth_type.as_deref().is_some_and(|a| !AUTH_TYPES.contains(&a)) {
        return Err(StoreError::invalid("invalid authType"));
    }
    for (name, value) in [
        ("alias", &input.alias),
        ("osType", &input.os_type),
        ("groupName", &input.group_name),
        ("proxyJump", &input.proxy_jump),
        ("initialDirectory", &input.initial_directory),
        ("themeOverride", &input.theme_override),
        ("keyId", &input.key_id),
        ("privateKeyPath", &input.private_key_path),
    ] {
        check_text(name, value, MAX_TEXT)?;
    }
    check_text("postConnectScript", &input.post_connect_script, MAX_SCRIPT)?;
    for secret in [&input.password, &input.passphrase] {
        if let SecretUpdate::Set(value) = secret {
            if value.len() > MAX_SECRET_BYTES {
                return Err(StoreError::invalid("secret is too large"));
            }
        }
    }
    Ok(())
}

/// Seals the plaintext secrets a workspace written before 3.0 still holds. Runs on every mount;
/// after it changed something, the freed pages are wiped (secure_delete) and the WAL truncated.
pub fn seal_legacy_secrets<D: Device>(ks: &Keystore<D>, scope: &str, conn: &Connection) -> StoreResult<()> {
    let rows = conn.query_map(
        "SELECT id, password, passphrase FROM profiles WHERE (password IS NOT NULL AND password <> '' AND password NOT LIKE 'gk1:%') \
         OR (passphrase IS NOT NULL AND passphrase <> '' AND passphrase NOT LIKE 'gk1:%')",
        &[],
        |row| Ok((row.text(0)?.unwrap_or_default(), row.text(1)?.map(Zeroizing::new), row.text(2)?.map(Zeroizing::new))),
    )?;
    if rows.is_empty() {
        return Ok(());
    }
    let mut updates = Vec::with_capacity(rows.len());
    for (id, password, passphrase) in rows {
        let seal = |field: SecretField, value: &Option<Zeroizing<String>>| -> StoreResult<Value> {
            Ok(match value {
                Some(v) if !v.is_empty() && !Keystore::<D>::is_sealed_field(v) => Value::Text(ks.seal_field(scope, &context(&id, field), v.as_bytes())?),
                Some(v) if !v.is_empty() => Value::Text(v.to_string()),
                _ => Value::Null,
            })
        };
        updates.push((seal(SecretField::Password, &password)?, seal(SecretField::Passphrase, &passphrase)?, id));
    }
    conn.execute_batch("PRAGMA secure_delete = ON")?;
    conn.transaction(|c| {
        for (password, passphrase, id) in &updates {
            c.execute("UPDATE profiles SET password = ?, passphrase = ? WHERE id = ?", &[password.clone(), passphrase.clone(), id.as_str().into()])?;
        }
        Ok(())
    })?;
    conn.checkpoint_truncate()?;
    Ok(())
}

impl<D: Device> Store<D> {
    pub fn list_profiles(&self, workspace_id: &str) -> StoreResult<Vec<Profile>> {
        self.with_workspace(workspace_id, |conn| {
            Ok(conn.query_map(&format!("SELECT {COLUMNS} FROM profiles WHERE workspace_id = ? ORDER BY rowid"), &[workspace_id.into()], read_profile)?)
        })
    }

    /// Replaces the workspace's profiles with `inputs` (profiles missing from it are deleted).
    pub fn save_profiles(&self, workspace_id: &str, inputs: &[ProfileInput]) -> StoreResult<Vec<Profile>> {
        for input in inputs {
            validate(input)?;
        }
        let mut seen = std::collections::HashSet::new();
        if !inputs.iter().all(|p| seen.insert(p.id.as_str())) {
            return Err(StoreError::invalid("duplicate profile id"));
        }
        let scope = workspace_scope(workspace_id)?;
        let ks = self.keystore();
        self.with_workspace(workspace_id, |conn| {
            let existing: HashMap<String, (Option<String>, Option<String>)> = conn
                .query_map("SELECT id, password, passphrase FROM profiles WHERE workspace_id = ?", &[workspace_id.into()], |r| {
                    Ok((r.text(0)?.unwrap_or_default(), (r.text(1)?, r.text(2)?)))
                })?
                .into_iter()
                .collect();
            let mut rows = Vec::with_capacity(inputs.len());
            for input in inputs {
                let stored = existing.get(&input.id);
                let resolve = |field: SecretField, update: &SecretUpdate| -> StoreResult<Value> {
                    Ok(match update {
                        SecretUpdate::Keep => {
                            let old = stored.and_then(|(pw, pp)| if field == SecretField::Password { pw.clone() } else { pp.clone() });
                            old.map(Value::Text).unwrap_or(Value::Null)
                        }
                        SecretUpdate::Clear => Value::Null,
                        SecretUpdate::Set(value) if value.is_empty() => Value::Null,
                        SecretUpdate::Set(value) => Value::Text(ks.seal_field(&scope, &context(&input.id, field), value.as_bytes())?),
                    })
                };
                rows.push((input, resolve(SecretField::Password, &input.password)?, resolve(SecretField::Passphrase, &input.passphrase)?));
            }
            conn.execute_batch("PRAGMA secure_delete = ON")?;
            conn.transaction(|c| {
                c.execute("DELETE FROM profiles WHERE workspace_id = ?", &[workspace_id.into()])?;
                for (p, password, passphrase) in &rows {
                    c.execute(
                        &format!("INSERT INTO profiles ({COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
                        &[
                            p.id.as_str().into(),
                            workspace_id.into(),
                            p.host.as_str().into(),
                            p.username.as_str().into(),
                            p.port.unwrap_or(22).into(),
                            p.protocol.clone().unwrap_or_else(|| "ssh".into()).into(),
                            p.auth_type.clone().unwrap_or_else(|| "password".into()).into(),
                            p.alias.clone().into(),
                            p.os_type.clone().into(),
                            p.group_name.clone().into(),
                            p.auto_start.into(),
                            p.use_keep_alive.into(),
                            p.strict_host_key_checking.into(),
                            p.proxy_jump.clone().into(),
                            p.initial_directory.clone().into(),
                            p.post_connect_script.clone().into(),
                            p.theme_override.clone().into(),
                            p.key_id.clone().into(),
                            p.private_key_path.clone().into(),
                            password.clone(),
                            passphrase.clone(),
                        ],
                    )?;
                }
                Ok(())
            })?;
            Ok(())
        })?;
        self.list_profiles(workspace_id)
    }

    pub fn delete_profiles(&self, workspace_id: &str, ids: &[String]) -> StoreResult<()> {
        self.with_workspace(workspace_id, |conn| {
            conn.execute_batch("PRAGMA secure_delete = ON")?;
            conn.transaction(|c| {
                for id in ids {
                    c.execute("DELETE FROM profiles WHERE workspace_id = ? AND id = ?", &[workspace_id.into(), id.as_str().into()])?;
                }
                Ok(())
            })?;
            Ok(())
        })
    }

    /// Copies profiles into another workspace, with the SSH keys they use (unless the target has a
    /// key with that id) and, with `include_runbooks`, every runbook of the source (the asset
    /// bridge, which copies only the runbooks the user ticked, uses saveRunbooks for those). Ids are kept,
    /// so a profile or runbook with the same id in the target is replaced. Secrets are opened with
    /// the source workspace's field key and sealed again under the target's; a sealed value copied
    /// as it is would not open there.
    pub fn copy_profiles(&self, from: &str, to: &str, ids: &[String], include_runbooks: bool) -> StoreResult<()> {
        self.with_workspace(from, |_| Ok(()))?;
        self.with_workspace(to, |_| Ok(()))?;
        if from == to {
            return Err(StoreError::invalid("source and target workspace are the same"));
        }
        let (from_scope, to_scope) = (workspace_scope(from)?, workspace_scope(to)?);
        let mut seen = HashSet::new();
        let picked: Vec<&String> = ids.iter().filter(|id| seen.insert(id.as_str())).collect();
        let values = |r: &Row<'_, '_>, count: usize| (0..count).map(|i| r.value(i)).collect::<SqlResult<Vec<Value>>>();

        // Everything is read from the source first, so only one workspace is locked at a time.
        let (profiles, keys, runbooks) = self.with_workspace(from, |conn| {
            let mut profiles = Vec::with_capacity(picked.len());
            for id in &picked {
                let row = conn
                    .query_optional(&format!("SELECT {COLUMNS} FROM profiles WHERE workspace_id = ? AND id = ?"), &[from.into(), id.as_str().into()], |r| values(r, COLUMN_COUNT))?
                    .ok_or_else(|| StoreError::not_found(format!("profile {id} does not exist in workspace {from}")))?;
                profiles.push(row);
            }
            let mut key_ids = HashSet::new();
            let mut keys = Vec::new();
            for row in &profiles {
                if let Value::Text(key_id) = &row[KEY_ID] {
                    if !key_id.is_empty() && key_ids.insert(key_id.clone()) {
                        if let Some(key) = conn.query_optional(&format!("SELECT {KEY_COLUMNS} FROM ssh_keys WHERE id = ?"), &[key_id.as_str().into()], |r| values(r, KEY_COLUMN_COUNT))? {
                            keys.push(key);
                        }
                    }
                }
            }
            let runbooks = if include_runbooks {
                conn.query_map("SELECT id, title, script, riskLevel, created_at FROM runbooks WHERE workspace_id = ? ORDER BY rowid", &[from.into()], |r| values(r, 5))?
            } else {
                Vec::new()
            };
            Ok((profiles, keys, runbooks))
        })?;

        let ks = self.keystore();
        let reseal = |value: &Value, context: &str| -> StoreResult<Value> {
            match value {
                Value::Text(stored) if !stored.is_empty() => {
                    let plain = if Keystore::<D>::is_sealed_field(stored) {
                        ks.open_field(&from_scope, context, stored)?
                    } else {
                        Zeroizing::new(stored.as_bytes().to_vec())
                    };
                    Ok(Value::Text(ks.seal_field(&to_scope, context, &plain)?))
                }
                _ => Ok(Value::Null),
            }
        };
        let text_at = |row: &[Value], i: usize| match &row[i] {
            Value::Text(v) => v.clone(),
            _ => String::new(),
        };
        let mut copied = Vec::with_capacity(profiles.len());
        for mut row in profiles {
            let id = text_at(&row, 0);
            row[1] = to.into();
            row[PASSWORD] = reseal(&row[PASSWORD], &context(&id, SecretField::Password))?;
            row[PASSPHRASE] = reseal(&row[PASSPHRASE], &context(&id, SecretField::Passphrase))?;
            copied.push(row);
        }
        let mut copied_keys = Vec::with_capacity(keys.len());
        for mut key in keys {
            let id = text_at(&key, 0);
            key[KEY_PRIVATE] = reseal(&key[KEY_PRIVATE], &format!("ssh_key|{id}|private"))?;
            copied_keys.push(key);
        }

        self.with_workspace(to, |conn| {
            let existing_keys: HashSet<String> = conn.query_map("SELECT id FROM ssh_keys", &[], |r| Ok(r.text(0)?.unwrap_or_default()))?.into_iter().collect();
            let update_profile = COLUMNS.split(", ").skip(1).map(|c| format!("{c} = excluded.{c}")).collect::<Vec<_>>().join(", ");
            conn.transaction(|c| {
                for key in copied_keys.iter().filter(|key| !existing_keys.contains(&text_at(key, 0))) {
                    c.execute(&format!("INSERT INTO ssh_keys ({KEY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"), key)?;
                }
                for row in &copied {
                    c.execute(
                        &format!("INSERT INTO profiles ({COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET {update_profile}"),
                        row,
                    )?;
                }
                for rb in &runbooks {
                    c.execute(
                        "INSERT INTO runbooks (id, workspace_id, title, script, riskLevel, created_at) VALUES (?, ?, ?, ?, ?, ?) \
                         ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, title = excluded.title, script = excluded.script, \
                         riskLevel = excluded.riskLevel, created_at = excluded.created_at",
                        &[rb[0].clone(), to.into(), rb[1].clone(), rb[2].clone(), rb[3].clone(), rb[4].clone()],
                    )?;
                }
                Ok(())
            })?;
            Ok(())
        })
    }

    /// Opens one sealed field of a profile (connect and reveal share this).
    fn open_secret(&self, workspace_id: &str, profile_id: &str, field: SecretField, reveal: bool) -> StoreResult<Option<Zeroizing<Vec<u8>>>> {
        let scope = workspace_scope(workspace_id)?;
        let sealed = self.with_workspace(workspace_id, |conn| {
            conn.query_optional(
                &format!("SELECT {} FROM profiles WHERE workspace_id = ? AND id = ?", field.column()),
                &[workspace_id.into(), profile_id.into()],
                |r| r.text(0),
            )?
            .ok_or_else(|| StoreError::not_found(format!("profile {profile_id}")))
        })?;
        let Some(sealed) = sealed.filter(|s| !s.is_empty()).map(Zeroizing::new) else {
            return Ok(None);
        };
        let context = context(profile_id, field);
        let opened = if reveal {
            self.keystore().reveal_field(&scope, &context, &sealed)
        } else {
            self.keystore().open_field(&scope, &context, &sealed)
        };
        match opened {
            Ok(value) => Ok(Some(value)),
            Err(KsError::RevealLocked) => Err(StoreError::locked("the reveal window is closed")),
            Err(error) => Err(error.into()),
        }
    }

    /// Credentials for a connection. Main process only.
    pub fn connect_secrets(&self, workspace_id: &str, profile_id: &str) -> StoreResult<ConnectSecrets> {
        let password = self.open_secret(workspace_id, profile_id, SecretField::Password, false)?;
        let passphrase = self.open_secret(workspace_id, profile_id, SecretField::Passphrase, false)?;
        let profile = self
            .list_profiles(workspace_id)?
            .into_iter()
            .find(|p| p.id == profile_id)
            .ok_or_else(|| StoreError::not_found(format!("profile {profile_id}")))?;
        let private_key = match (&profile.key_id, &profile.private_key_path) {
            (Some(key_id), _) => Some(self.ssh_private_key(workspace_id, key_id)?),
            (None, Some(path)) if !path.is_empty() => Some(read_key_file(path)?),
            _ => None,
        };
        Ok(ConnectSecrets { password, passphrase, private_key })
    }

    pub fn open_reveal(&self, workspace_id: &str, presence_reason: Option<&str>, password: Option<&str>) -> StoreResult<()> {
        let scope = workspace_scope(workspace_id)?;
        match (presence_reason, password) {
            (Some(reason), _) => self.keystore().open_reveal_with_presence(&scope, reason)?,
            (None, Some(password)) => self.keystore().open_reveal_with_password(&scope, password)?,
            (None, None) => return Err(StoreError::invalid("a presence reason or a password is required")),
        }
        Ok(())
    }

    /// A secret while the reveal window is open; each call extends the window. Main process only.
    pub fn reveal_secret(&self, workspace_id: &str, profile_id: &str, field: SecretField) -> StoreResult<Zeroizing<String>> {
        if !self.keystore().reveal_active(&workspace_scope(workspace_id)?)? {
            return Err(StoreError::locked("the reveal window is closed"));
        }
        let value = self.open_secret(workspace_id, profile_id, field, true)?.ok_or_else(|| StoreError::not_found(format!("profile {profile_id} has no {}", field.column())))?;
        String::from_utf8(value.to_vec()).map(Zeroizing::new).map_err(|_| StoreError::new(Code::Corrupt, "the secret is not text"))
    }

    pub fn close_reveal(&self) {
        self.keystore().close_reveal();
    }

    /// The private key bytes of a stored SSH key (phase B fills ssh_keys).
    fn ssh_private_key(&self, workspace_id: &str, key_id: &str) -> StoreResult<Zeroizing<Vec<u8>>> {
        let scope = workspace_scope(workspace_id)?;
        let sealed = self.with_workspace(workspace_id, |conn| {
            conn.query_optional("SELECT private_key FROM ssh_keys WHERE id = ?", &[key_id.into()], |r| r.text(0))?
                .flatten()
                .ok_or_else(|| StoreError::not_found(format!("ssh key {key_id}")))
        })?;
        Ok(self.keystore().open_field(&scope, &format!("ssh_key|{key_id}|private"), &sealed)?)
    }
}

/// Transitional: profiles that still point at a key file on disk.
fn read_key_file(path: &str) -> StoreResult<Zeroizing<Vec<u8>>> {
    let expanded = match path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        Some(rest) => std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .map(|home| std::path::Path::new(&home).join(rest))
            .ok_or_else(|| StoreError::new(Code::Io, "no home directory"))?,
        None => std::path::PathBuf::from(path),
    };
    let meta = std::fs::metadata(&expanded).map_err(|e| StoreError::new(Code::NotFound, format!("private key file: {e}")))?;
    if !meta.is_file() || meta.len() > 1024 * 1024 {
        return Err(StoreError::invalid("the private key path is not a key file"));
    }
    Ok(Zeroizing::new(std::fs::read(&expanded)?))
}
