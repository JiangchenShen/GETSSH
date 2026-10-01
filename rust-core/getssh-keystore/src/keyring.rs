//! On-disk format of ~/.getssh/keyring.json. Nothing in it is usable without a wrapping secret:
//! a device key, a password, the parent (app) key or the recovery code.

use std::collections::BTreeMap;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::crypto::{self, Argon2Params, CHECK_LEN, KEY_LEN, NONCE_LEN, P256_PUBLIC_LEN, SALT_LEN};
use crate::error::KsError;

pub const FORMAT: u32 = 1;
pub const APP: &str = "app";
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_SCOPES: usize = 4096;
const MAX_WRAPS: usize = 16;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct B64(pub Vec<u8>);

impl Serialize for B64 {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&STANDARD.encode(&self.0))
    }
}

impl<'de> Deserialize<'de> for B64 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        STANDARD.decode(text).map(B64).map_err(serde::de::Error::custom)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Keyring {
    pub format: u32,
    pub generation: u64,
    /// Opens unprotected scopes without a prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quiet_device: Option<DeviceKey>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery: Option<RecoveryInfo>,
    pub scopes: BTreeMap<String, Scope>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceKey {
    pub id: String,
    pub backend: String,
    /// Backend-specific, public material (key handles, key names, public keys).
    #[serde(default)]
    pub params: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryInfo {
    pub id: String,
    pub public_key: B64,
    /// Keyed with the app's field key: while a master password is set, only its holder can
    /// point new recovery routes at a public key.
    pub mac: B64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    /// `[current]`, or `[current, staged]` while a key rotation waits for its database rekey.
    pub versions: Vec<KeyVersion>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeyVersion {
    pub id: String,
    pub check: B64,
    /// Protection flags sealed with this version's key, so editing the file cannot make a
    /// protected scope look unprotected.
    pub policy: SealedData,
    /// The scope's field-encryption key, sealed with this version's key.
    pub field_key: SealedData,
    pub wraps: Vec<Wrap>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SealedData {
    pub nonce: B64,
    pub ciphertext: B64,
}

impl From<crypto::Sealed> for SealedData {
    fn from(sealed: crypto::Sealed) -> Self {
        SealedData { nonce: B64(sealed.nonce.to_vec()), ciphertext: B64(sealed.ciphertext) }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Wrap {
    /// Sealed with a KEK from the quiet device key (matched by id).
    #[serde(rename_all = "camelCase")]
    Device { device: String, blob: B64, sealed: SealedData },
    /// Sealed with a KEK from a Touch ID / Windows Hello key created for this scope alone.
    #[serde(rename_all = "camelCase")]
    Presence { key: DeviceKey, blob: B64, sealed: SealedData },
    /// Sealed with Argon2id(password).
    #[serde(rename_all = "camelCase")]
    Password { salt: B64, m_kib: u32, t: u32, p: u32, sealed: SealedData },
    /// A workspace key sealed with a version of the app key (master password set).
    #[serde(rename_all = "camelCase")]
    Parent { parent_version: String, sealed: SealedData },
    /// ECIES to the recovery public key.
    #[serde(rename_all = "camelCase")]
    Recovery { recovery: String, ephemeral: B64, sealed: SealedData },
}

impl Wrap {
    pub fn sealed(&self) -> &SealedData {
        match self {
            Wrap::Device { sealed, .. }
            | Wrap::Presence { sealed, .. }
            | Wrap::Password { sealed, .. }
            | Wrap::Parent { sealed, .. }
            | Wrap::Recovery { sealed, .. } => sealed,
        }
    }

    pub fn is_password(&self) -> bool {
        matches!(self, Wrap::Password { .. })
    }

    pub fn uses_device(&self, device_id: &str) -> bool {
        matches!(self, Wrap::Device { device, .. } if device == device_id)
    }

    pub fn presence_key(&self) -> Option<&DeviceKey> {
        match self {
            Wrap::Presence { key, .. } => Some(key),
            _ => None,
        }
    }
}

impl Keyring {
    pub fn new() -> Self {
        Keyring {
            format: FORMAT,
            generation: 0,
            quiet_device: None,
            recovery: None,
            scopes: BTreeMap::new(),
        }
    }
}

/// "app", or "ws:<workspace id>". Workspace ids follow isValidWorkspaceId() in the main process;
/// here it only matters that they cannot contain the "|" separator of associated-data strings.
pub fn is_valid_scope_id(scope: &str) -> bool {
    if scope == APP {
        return true;
    }
    let Some(id) = scope.strip_prefix("ws:") else { return false };
    !id.is_empty()
        && id.len() <= 512
        && id == id.trim()
        && !id.chars().any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
}

fn is_valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn check_len(value: &B64, len: usize, what: &str) -> Result<(), KsError> {
    if value.0.len() == len {
        Ok(())
    } else {
        Err(KsError::Corrupt(format!("{what} has the wrong length")))
    }
}

fn validate_sealed(sealed: &SealedData, plaintext_len: usize, what: &str) -> Result<(), KsError> {
    check_len(&sealed.nonce, NONCE_LEN, what)?;
    check_len(&sealed.ciphertext, plaintext_len + 16, what)
}

fn validate_device(device: &DeviceKey) -> Result<(), KsError> {
    if !is_valid_id(&device.id) || !is_valid_id(&device.backend) {
        return Err(KsError::Corrupt("invalid device key entry".into()));
    }
    if device.params.len() > 16 || device.params.iter().any(|(k, v)| k.len() > 64 || v.len() > 8192) {
        return Err(KsError::Corrupt("oversized device key entry".into()));
    }
    Ok(())
}

pub fn validate(keyring: &Keyring) -> Result<(), KsError> {
    if keyring.format != FORMAT {
        return Err(KsError::Corrupt(format!("unsupported keyring format {}", keyring.format)));
    }
    if let Some(device) = &keyring.quiet_device {
        validate_device(device)?;
    }
    if let Some(recovery) = &keyring.recovery {
        if !is_valid_id(&recovery.id) {
            return Err(KsError::Corrupt("invalid recovery id".into()));
        }
        check_len(&recovery.public_key, P256_PUBLIC_LEN, "recovery public key")?;
        check_len(&recovery.mac, KEY_LEN, "recovery authentication tag")?;
        crypto::parse_p256_public(&recovery.public_key.0)?;
    }
    if !keyring.scopes.contains_key(APP) {
        return Err(KsError::Corrupt("the app scope is missing".into()));
    }
    if keyring.scopes.len() > MAX_SCOPES {
        return Err(KsError::Corrupt("too many scopes".into()));
    }
    for (scope_id, scope) in &keyring.scopes {
        if !is_valid_scope_id(scope_id) {
            return Err(KsError::Corrupt("invalid scope id".into()));
        }
        if scope.versions.is_empty() || scope.versions.len() > 2 {
            return Err(KsError::Corrupt(format!("{scope_id}: invalid number of key versions")));
        }
        if scope.versions.len() == 2 && scope.versions[0].id == scope.versions[1].id {
            return Err(KsError::Corrupt(format!("{scope_id}: duplicate key version")));
        }
        for version in &scope.versions {
            if !is_valid_id(&version.id) {
                return Err(KsError::Corrupt(format!("{scope_id}: invalid version id")));
            }
            check_len(&version.check, CHECK_LEN, "key check")?;
            validate_sealed(&version.policy, 1, "protection flags")?;
            validate_sealed(&version.field_key, KEY_LEN, "field key")?;
            if version.wraps.len() > MAX_WRAPS {
                return Err(KsError::Corrupt(format!("{scope_id}: too many wraps")));
            }
            for wrap in &version.wraps {
                validate_sealed(wrap.sealed(), KEY_LEN, "wrapped key")?;
                match wrap {
                    Wrap::Device { device, blob, .. } => {
                        if !is_valid_id(device) || blob.0.len() > 8192 {
                            return Err(KsError::Corrupt(format!("{scope_id}: invalid device wrap")));
                        }
                    }
                    Wrap::Presence { key, blob, .. } => {
                        validate_device(key)?;
                        if blob.0.len() > 8192 {
                            return Err(KsError::Corrupt(format!("{scope_id}: invalid presence wrap")));
                        }
                    }
                    Wrap::Password { salt, m_kib, t, p, .. } => {
                        check_len(salt, SALT_LEN, "password salt")?;
                        if !(Argon2Params { m_kib: *m_kib, t: *t, p: *p }).is_acceptable() {
                            return Err(KsError::Corrupt(format!("{scope_id}: unsupported Argon2 parameters")));
                        }
                    }
                    Wrap::Parent { parent_version, .. } => {
                        if scope_id == APP || !is_valid_id(parent_version) {
                            return Err(KsError::Corrupt(format!("{scope_id}: invalid parent wrap")));
                        }
                    }
                    Wrap::Recovery { recovery, ephemeral, .. } => {
                        if !is_valid_id(recovery) {
                            return Err(KsError::Corrupt(format!("{scope_id}: invalid recovery wrap")));
                        }
                        check_len(ephemeral, P256_PUBLIC_LEN, "recovery ephemeral key")?;
                    }
                }
            }
        }
    }
    Ok(())
}

/// Opens the keyring once, refusing symlinks, and checks type and size on that same handle.
fn open_keyring(path: &Path) -> std::io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc_nofollow());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(path)
}

#[cfg(target_os = "macos")]
fn libc_nofollow() -> i32 {
    0x0100
}

#[cfg(all(unix, not(target_os = "macos")))]
fn libc_nofollow() -> i32 {
    0o400000
}

/// Returns None when no keyring exists yet.
pub fn load(path: &Path) -> Result<Option<Keyring>, KsError> {
    use std::io::Read;
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() {
            return Err(KsError::Corrupt("the keyring is not a regular file".into()));
        }
    }
    let file = match open_keyring(path) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(KsError::Corrupt(format!("the keyring cannot be opened: {error}"))),
    };
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(KsError::Corrupt("the keyring is not a regular file".into()));
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(KsError::Corrupt("the keyring file is too large".into()));
    }
    let keyring: Keyring =
        serde_json::from_slice(&bytes).map_err(|e| KsError::Corrupt(format!("keyring JSON: {e}")))?;
    validate(&keyring)?;
    Ok(Some(keyring))
}

/// Replaces the keyring atomically. No backup copy is kept on purpose: an older keyring can hold
/// routes that were removed since (a device wrap from before a master password was set).
pub fn save(path: &Path, keyring: &Keyring) -> Result<(), KsError> {
    validate(keyring)?;
    let dir = path.parent().ok_or_else(|| KsError::Io("keyring path has no parent".into()))?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("keyring.json");
    let temp = dir.join(format!(".{name}.{}.tmp", crypto::random_id()));
    let json = serde_json::to_vec_pretty(keyring).map_err(|e| KsError::Io(e.to_string()))?;

    let result = (|| -> Result<(), KsError> {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        file.write_all(&json)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)?;
        #[cfg(unix)]
        if let Ok(dir_handle) = fs::File::open(dir) {
            let _ = dir_handle.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sealed(len: usize) -> SealedData {
        SealedData { nonce: B64(vec![0; NONCE_LEN]), ciphertext: B64(vec![0; len + 16]) }
    }

    fn sample() -> Keyring {
        let mut keyring = Keyring::new();
        keyring.scopes.insert(
            APP.into(),
            Scope {
                versions: vec![KeyVersion {
                    id: "v1".into(),
                    check: B64(vec![0; CHECK_LEN]),
                    policy: sealed(1),
                    field_key: sealed(KEY_LEN),
                    wraps: vec![Wrap::Password {
                        salt: B64(vec![0; SALT_LEN]),
                        m_kib: 65536,
                        t: 3,
                        p: 1,
                        sealed: sealed(KEY_LEN),
                    }],
                }],
            },
        );
        keyring
    }

    #[test]
    fn saves_atomically_and_privately() {
        let dir = std::env::temp_dir().join(format!("gk-keyring-{}", crypto::random_id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("keyring.json");
        assert_eq!(load(&path).unwrap(), None);
        save(&path, &sample()).unwrap();
        save(&path, &sample()).unwrap();
        assert_eq!(load(&path).unwrap(), Some(sample()));
        let entries: Vec<_> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(entries, vec![std::ffi::OsString::from("keyring.json")]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_malformed_files() {
        let mut bad = sample();
        bad.format = 2;
        assert!(validate(&bad).is_err());

        let mut bad = sample();
        bad.scopes.insert("ws:a|b".into(), bad.scopes[APP].clone());
        assert!(validate(&bad).is_err());

        let mut bad = sample();
        if let Wrap::Password { m_kib, .. } = &mut bad.scopes.get_mut(APP).unwrap().versions[0].wraps[0] {
            *m_kib = 8 * 1024 * 1024;
        }
        assert!(validate(&bad).is_err());

        let mut bad = sample();
        bad.scopes.get_mut(APP).unwrap().versions[0].wraps.push(Wrap::Parent {
            parent_version: "v1".into(),
            sealed: sealed(KEY_LEN),
        });
        assert!(validate(&bad).is_err(), "the app scope cannot have a parent");

        let mut bad = sample();
        bad.scopes.remove(APP);
        assert!(validate(&bad).is_err());

        let json = serde_json::to_string(&sample()).unwrap().replace("\"generation\"", "\"extra\":1,\"generation\"");
        assert!(serde_json::from_str::<Keyring>(&json).is_err());
    }

    #[test]
    fn scope_ids() {
        assert!(is_valid_scope_id("app"));
        assert!(is_valid_scope_id("ws:default"));
        assert!(is_valid_scope_id("ws:生产 环境"));
        assert!(!is_valid_scope_id("ws:"));
        assert!(!is_valid_scope_id("ws: padded"));
        assert!(!is_valid_scope_id("ws:a|b"));
        assert!(!is_valid_scope_id("ws:a/b"));
        assert!(!is_valid_scope_id("workspace"));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinked_keyring() {
        let dir = std::env::temp_dir().join(format!("gk-keyring-{}", crypto::random_id()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("real.json");
        save(&target, &sample()).unwrap();
        let link = dir.join("keyring.json");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(matches!(load(&link), Err(KsError::Corrupt(_))));
        fs::remove_dir_all(&dir).unwrap();
    }
}
