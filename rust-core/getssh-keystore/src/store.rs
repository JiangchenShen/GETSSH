//! Key hierarchy and protection policy.
//!
//! Every scope ("app" for the main database and app-wide secrets, "ws:<id>" for a workspace) has a
//! random key. On disk that key only exists sealed by one or more routes:
//!
//! - quiet device key (Secure Enclave / TPM / DPAPI, no prompt): present only while the scope is
//!   unprotected. It keeps copied files unreadable on other machines and nothing more.
//! - password: Argon2id of the master password ("app") or of the workspace's own password.
//! - presence (Touch ID, Windows Hello): a shortcut for a scope that has a password, through a
//!   device key created for that scope when the shortcut was enabled.
//! - parent: a workspace key sealed with the app key while a master password is set, so one
//!   master unlock opens every workspace.
//! - recovery: ECIES to the recovery code's public key; the code itself is never stored.
//!
//! A scope is protected when a master password is set or the scope has its own password.
//! `reconcile` re-derives the routes after every change: a protected scope never keeps a quiet
//! route and a parent route never outlives the master password. Routes that grant access are
//! removed immediately; routes that need a key are added as soon as that key is in memory.
//!
//! keyring.json is not trusted. Whether a scope has its own password is sealed inside the scope
//! (`KeyVersion::policy`), and nothing that loosens protection or points a new route at a key
//! described by the file happens unless that sealed record, read with the scope's key, allows it:
//! deleting a password route from the file cannot turn a protected scope into a quiet one, and
//! replacing the recovery public key cannot redirect new recovery routes while a master password
//! is set.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

use crate::crypto::{self, Argon2Params, Key32, DOMAIN, NONCE_LEN, SALT_LEN};
use crate::device::Device;
use crate::error::KsError;
use crate::keyring::{self, DeviceKey, KeyVersion, Keyring, RecoveryInfo, Scope, SealedData, Wrap, APP, B64};
use crate::recovery::{self, RecoveryCode};

/// A reveal session ends after this long without a reveal.
pub const REVEAL_IDLE: Duration = Duration::from_secs(5 * 60);
/// Minimum length of a new workspace password.
const MIN_PASSWORD_CHARS: usize = 8;
/// Minimum length of a new master password: it alone protects everything, including copies of
/// the data taken off this computer, where only its strength slows down guessing.
const MIN_MASTER_PASSWORD_CHARS: usize = 12;
const MAX_PASSWORD_BYTES: usize = 1024;
const FIELD_PREFIX: &str = "gk1:";
const MAX_FIELD_BYTES: usize = 1024 * 1024;
const MAX_CONTEXT_BYTES: usize = 256;
const FREE_PASSWORD_FAILURES: u32 = 4;
const MAX_PASSWORD_DELAY_MS: u64 = 30_000;
const POLICY_OWN_PASSWORD: u8 = 1;

pub type Clock = Arc<dyn Fn() -> Instant + Send + Sync>;
type Slot = (String, String);
type KeyMap = HashMap<Slot, Key32>;

#[derive(Default)]
struct State {
    keyring: Option<Keyring>,
    /// Unlocked key versions.
    keys: KeyMap,
    /// Field keys of unlocked scopes.
    field_keys: HashMap<String, Key32>,
    /// Reveal sessions: domain -> last activity.
    reveal: HashMap<String, Instant>,
    /// Bumped by every lock; operations that started before a lock do not install keys.
    epoch: u64,
    password_failures: u32,
    password_retry_at: Option<Instant>,
    quiet_device_lost: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ScopeStatus {
    pub id: String,
    pub protected: bool,
    pub own_password: bool,
    pub presence: bool,
    pub unlocked: bool,
    pub staged: bool,
    pub recovery: bool,
    pub master_linked: bool,
    pub reveal_remaining_ms: Option<u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Status {
    pub initialized: bool,
    pub app_protected: bool,
    pub recovery_configured: bool,
    pub presence_supported: bool,
    pub quiet_backend: Option<String>,
    pub device_key_lost: bool,
    pub scopes: Vec<ScopeStatus>,
}

/// One scope's current key version for an encrypted export bundle (getssh-store): the version key
/// and the version record with only the routes that work on another computer (passwords).
/// Device, presence, parent and recovery routes belong to this keyring and are rebuilt by the
/// importing keystore. Holds a key, so it never leaves Rust.
#[derive(Clone)]
pub struct ScopeExport {
    pub scope_id: String,
    pub key: Key32,
    pub version: KeyVersion,
}

pub struct Keystore<D: Device> {
    device: D,
    path: PathBuf,
    argon2: Argon2Params,
    clock: Clock,
    /// Serializes operations that change the keyring, prompt or run Argon2.
    op: Mutex<()>,
    state: Mutex<State>,
}

fn slot(scope_id: &str, version_id: &str) -> Slot {
    (scope_id.to_string(), version_id.to_string())
}

/// The version whose protection record decides how the scope is protected: the staged one
/// while a rotation is pending (it carries the change being made), otherwise the current one.
fn governing(scope: &Scope) -> &KeyVersion {
    scope.versions.last().expect("a scope always has a version")
}

fn has_password_route(scope: &Scope) -> bool {
    governing(scope).wraps.iter().any(Wrap::is_password)
}

fn policy_aad(scope_id: &str, version_id: &str) -> Vec<u8> {
    format!("{DOMAIN}|policy|{scope_id}|{version_id}").into_bytes()
}

fn seal_policy(scope_id: &str, version_id: &str, key: &Key32, own_password: bool) -> SealedData {
    let flags = if own_password { POLICY_OWN_PASSWORD } else { 0 };
    crypto::seal(key, &[flags], &policy_aad(scope_id, version_id)).into()
}

/// The sealed own-password flag. A record that does not open counts as protected.
fn read_own_password(scope_id: &str, version: &KeyVersion, key: &Key32) -> bool {
    match crypto::open(key, &version.policy.nonce.0, &version.policy.ciphertext.0, &policy_aad(scope_id, &version.id)) {
        Ok(flags) if flags.len() == 1 => flags[0] & POLICY_OWN_PASSWORD != 0,
        _ => true,
    }
}

/// Whether a scope has its own password, and whether that answer is authenticated (read from
/// the sealed record with the scope's key) or only taken from the file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Flag {
    value: bool,
    authenticated: bool,
}

struct Policy {
    /// Own-password flag of each scope, from its governing version.
    own: HashMap<String, Flag>,
    /// Sealed own-password flag of every version whose key is known.
    version_own: HashMap<Slot, bool>,
    app_versions: Vec<String>,
    /// App versions sealed while a master password was set (and whose key is known): the only
    /// ones workspace keys may be wrapped under.
    master_versions: Vec<String>,
    quiet: Option<DeviceKey>,
    recovery: Option<RecoveryInfo>,
    /// The recovery entry carries a valid tag from the governing app version's key.
    recovery_trusted: bool,
}

impl Policy {
    fn build(keyring: &Keyring, known: &KeyMap) -> Self {
        let mut version_own = HashMap::new();
        for (id, scope) in &keyring.scopes {
            for version in &scope.versions {
                if let Some(key) = known.get(&slot(id, &version.id)) {
                    version_own.insert(slot(id, &version.id), read_own_password(id, version, key));
                }
            }
        }
        let own = keyring
            .scopes
            .iter()
            .map(|(id, scope)| {
                let flag = match version_own.get(&slot(id, &governing(scope).id)) {
                    Some(value) => Flag { value: *value, authenticated: true },
                    None => Flag { value: has_password_route(scope), authenticated: false },
                };
                (id.clone(), flag)
            })
            .collect();
        let app = &keyring.scopes[APP];
        let app_governing = governing(app);
        let recovery_trusted = match (&keyring.recovery, known.get(&slot(APP, &app_governing.id))) {
            (Some(recovery), Some(app_key)) => crypto::ct_eq(
                recovery_mac(app_key, &app_governing.id, &recovery.id, &recovery.public_key.0).as_slice(),
                &recovery.mac.0,
            ),
            _ => false,
        };
        Policy {
            own,
            master_versions: app
                .versions
                .iter()
                .filter(|v| version_own.get(&slot(APP, &v.id)) == Some(&true))
                .map(|v| v.id.clone())
                .collect(),
            version_own,
            app_versions: app.versions.iter().map(|v| v.id.clone()).collect(),
            quiet: keyring.quiet_device.clone(),
            recovery: keyring.recovery.clone(),
            recovery_trusted,
        }
    }

    /// The sealed flag of one version: Some(..) when its key is known.
    fn version_own(&self, scope_id: &str, version_id: &str) -> Option<bool> {
        self.version_own.get(&slot(scope_id, version_id)).copied()
    }

    fn own(&self, scope_id: &str) -> Flag {
        self.own.get(scope_id).copied().unwrap_or(Flag { value: true, authenticated: false })
    }

    fn app(&self) -> Flag {
        self.own(APP)
    }

    /// Best available answer; used for decisions that only tighten protection.
    fn protected(&self, scope_id: &str) -> bool {
        self.own(scope_id).value || (scope_id != APP && self.app().value)
    }

    /// Unprotected according to sealed records only; required before adding a quiet route.
    fn verified_unprotected(&self, scope_id: &str) -> bool {
        let own = self.own(scope_id);
        let app = self.app();
        own.authenticated && !own.value && (scope_id == APP || (app.authenticated && !app.value))
    }

    /// Master password set according to the app's sealed record.
    fn verified_master(&self) -> bool {
        let app = self.app();
        app.authenticated && app.value
    }

    /// Whether a recovery route may be added: to unprotected scopes always (anyone at the computer
    /// can open them anyway), to protected ones only while a verified master password is set and
    /// the recovery entry was created by its holder. A workspace protected only by its own
    /// password is never covered by a code that anyone could have generated.
    fn recovery_may_cover(&self, scope_id: &str) -> bool {
        self.recovery.is_some() && (self.verified_unprotected(scope_id) || (self.verified_master() && self.recovery_trusted))
    }

    fn is_quiet(&self, wrap: &Wrap) -> bool {
        self.quiet.as_ref().is_some_and(|d| wrap.uses_device(&d.id))
    }

    fn is_current_recovery(&self, wrap: &Wrap) -> bool {
        matches!((wrap, &self.recovery), (Wrap::Recovery { recovery, .. }, Some(info)) if *recovery == info.id)
    }

    fn is_parent_of(wrap: &Wrap, app_version: &str) -> bool {
        matches!(wrap, Wrap::Parent { parent_version, .. } if parent_version == app_version)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Verdict {
    /// A route the policy wants.
    Keep,
    /// A route that would bypass the scope's protection: always removed.
    Forbidden,
    /// Unusable leftovers (a replaced device key, an old recovery code, a retired app key).
    Stale,
}

fn verdict(policy: &Policy, scope_id: &str, version_id: &str, wrap: &Wrap) -> Verdict {
    let own = policy.own(scope_id);
    // While a password is being removed, the version sealed with it keeps its password routes
    // until the rotation is committed; otherwise the governing record decides.
    let version_has_password = policy.version_own(scope_id, version_id).unwrap_or(true);
    match wrap {
        // A password route where neither the scope nor this version has a password was not written by us.
        Wrap::Password { .. } if own.authenticated && !own.value && !version_has_password => Verdict::Stale,
        Wrap::Password { .. } => Verdict::Keep,
        Wrap::Device { .. } if policy.is_quiet(wrap) => {
            if policy.protected(scope_id) {
                Verdict::Forbidden
            } else {
                Verdict::Keep
            }
        }
        Wrap::Device { .. } => Verdict::Stale,
        Wrap::Presence { .. } => {
            if own.value || (version_has_password && policy.version_own(scope_id, version_id).is_some()) {
                Verdict::Keep
            } else {
                Verdict::Forbidden
            }
        }
        Wrap::Parent { parent_version, .. } => {
            if scope_id == APP || !policy.app().value {
                Verdict::Forbidden
            } else if !policy.app_versions.contains(parent_version) {
                Verdict::Stale
            } else if policy.version_own(APP, parent_version) == Some(false) {
                // An app key from before the master password: anyone could read it then.
                Verdict::Forbidden
            } else {
                Verdict::Keep
            }
        }
        Wrap::Recovery { .. } => {
            if policy.is_current_recovery(wrap) {
                Verdict::Keep
            } else {
                Verdict::Stale
            }
        }
    }
}

fn wrap_aad(scope_id: &str, version_id: &str, kind: &str, extra: &str) -> Vec<u8> {
    format!("{DOMAIN}|wrap|{scope_id}|{version_id}|{kind}|{extra}").into_bytes()
}

fn aad_for(scope_id: &str, version_id: &str, wrap: &Wrap) -> Vec<u8> {
    match wrap {
        Wrap::Device { device, .. } => wrap_aad(scope_id, version_id, "device", device),
        Wrap::Presence { key, .. } => wrap_aad(scope_id, version_id, "presence", &key.id),
        Wrap::Password { .. } => wrap_aad(scope_id, version_id, "password", ""),
        Wrap::Parent { parent_version, .. } => wrap_aad(scope_id, version_id, "parent", parent_version),
        Wrap::Recovery { recovery, .. } => wrap_aad(scope_id, version_id, "recovery", recovery),
    }
}

fn check_context(scope_id: &str, version_id: &str) -> String {
    format!("{scope_id}|{version_id}")
}

fn field_key_aad(scope_id: &str, version_id: &str) -> Vec<u8> {
    format!("{DOMAIN}|field-key|{scope_id}|{version_id}").into_bytes()
}

fn field_aad(scope_id: &str, context: &str) -> Vec<u8> {
    format!("{DOMAIN}|field|{scope_id}|{context}").into_bytes()
}

/// Tag that makes a recovery entry trusted: keyed with the governing app version's key, which
/// a master password protects and which is replaced whenever the master password is set or
/// removed, so entries made before (or written back from an older keyring) do not verify.
fn recovery_mac(app_key: &Key32, app_version: &str, id: &str, public_key: &[u8]) -> Key32 {
    crypto::hkdf32(
        app_key.as_slice(),
        DOMAIN.as_bytes(),
        format!("{DOMAIN}|recovery-authority|{app_version}|{id}|{}", crypto::to_hex(public_key)).as_bytes(),
    )
}

fn new_version(scope_id: &str, key: &Key32, field_key: &Key32, own_password: bool) -> KeyVersion {
    let id = crypto::random_id();
    KeyVersion {
        check: B64(crypto::key_check(key, &check_context(scope_id, &id)).to_vec()),
        policy: seal_policy(scope_id, &id, key, own_password),
        field_key: crypto::seal(key, field_key.as_slice(), &field_key_aad(scope_id, &id)).into(),
        wraps: Vec::new(),
        id,
    }
}

/// Opens a wrapped version key with its KEK and confirms it against the version's check value.
fn open_version_key(scope_id: &str, version: &KeyVersion, wrap: &Wrap, kek: &Key32) -> Result<Key32, crypto::AuthError> {
    let sealed = wrap.sealed();
    let key = crypto::open_key(kek, &sealed.nonce.0, &sealed.ciphertext.0, &aad_for(scope_id, &version.id, wrap))?;
    if !crypto::ct_eq(&crypto::key_check(&key, &check_context(scope_id, &version.id)), &version.check.0) {
        return Err(crypto::AuthError);
    }
    Ok(key)
}

fn open_field_key(scope_id: &str, version: &KeyVersion, key: &Key32) -> Result<Key32, KsError> {
    let sealed = &version.field_key;
    crypto::open_key(key, &sealed.nonce.0, &sealed.ciphertext.0, &field_key_aad(scope_id, &version.id))
        .map_err(|_| KsError::Corrupt(format!("{scope_id}: the field key does not open")))
}

fn seal_route(kek: &Key32, key: &Key32, aad: &[u8]) -> SealedData {
    crypto::seal(kek, key.as_slice(), aad).into()
}

fn parent_wrap(scope_id: &str, version_id: &str, app_version: &str, app_key: &Key32, key: &Key32) -> Wrap {
    Wrap::Parent {
        parent_version: app_version.to_string(),
        sealed: seal_route(app_key, key, &wrap_aad(scope_id, version_id, "parent", app_version)),
    }
}

fn recovery_wrap(scope_id: &str, version_id: &str, recovery: &RecoveryInfo, key: &Key32) -> Result<Wrap, KsError> {
    let aad = wrap_aad(scope_id, version_id, "recovery", &recovery.id);
    let (kek, ephemeral) = crypto::ecies_encapsulate(&recovery.public_key.0, &aad)?;
    Ok(Wrap::Recovery {
        recovery: recovery.id.clone(),
        ephemeral: B64(ephemeral.to_vec()),
        sealed: seal_route(&kek, key, &aad),
    })
}

fn get_scope<'a>(keyring: &'a Keyring, scope_id: &str) -> Result<&'a Scope, KsError> {
    if !keyring::is_valid_scope_id(scope_id) {
        return Err(KsError::InvalidArgument("invalid scope id".into()));
    }
    keyring.scopes.get(scope_id).ok_or_else(|| KsError::UnknownScope(scope_id.to_string()))
}

/// Which reveal session covers a scope: its own while it has its own password and no master
/// password is set; otherwise the app-wide one (one master password opens everything).
fn reveal_domain(policy: &Policy, keyring: &Keyring, scope_id: &str) -> Result<String, KsError> {
    get_scope(keyring, scope_id)?;
    if scope_id != APP && policy.own(scope_id).value && !policy.app().value {
        Ok(scope_id.to_string())
    } else {
        Ok(APP.to_string())
    }
}

/// Keys of Touch ID / Hello routes in `wraps`.
fn presence_keys<'a>(wraps: impl Iterator<Item = &'a Wrap>) -> Vec<DeviceKey> {
    let mut keys: Vec<DeviceKey> = Vec::new();
    for key in wraps.filter_map(Wrap::presence_key) {
        if !keys.iter().any(|k| k.id == key.id) {
            keys.push(key.clone());
        }
    }
    keys
}

/// Presence keys among `candidates` that no wrap in the keyring uses any more.
fn unreferenced(keyring: &Keyring, candidates: Vec<DeviceKey>) -> Vec<DeviceKey> {
    let used: HashSet<&str> = keyring
        .scopes
        .values()
        .flat_map(|s| s.versions.iter())
        .flat_map(|v| v.wraps.iter())
        .filter_map(|w| w.presence_key().map(|k| k.id.as_str()))
        .collect();
    candidates.into_iter().filter(|k| !used.contains(k.id.as_str())).collect()
}

fn normalize_password(password: &str) -> Result<Zeroizing<String>, KsError> {
    if password.len() > MAX_PASSWORD_BYTES * 4 {
        return Err(KsError::InvalidArgument("password is too long".into()));
    }
    // Reserve the worst case up front so growing the String never leaves partial copies behind.
    let mut normalized = Zeroizing::new(String::with_capacity(password.len() * 3));
    normalized.extend(password.nfc());
    Ok(normalized)
}

fn validate_new_password(scope_id: &str, password: &str) -> Result<Zeroizing<String>, KsError> {
    let normalized = normalize_password(password)?;
    let min_chars = if scope_id == APP { MIN_MASTER_PASSWORD_CHARS } else { MIN_PASSWORD_CHARS };
    if normalized.chars().count() < min_chars {
        return Err(KsError::InvalidArgument(format!("password must have at least {min_chars} characters")));
    }
    if normalized.len() > MAX_PASSWORD_BYTES {
        return Err(KsError::InvalidArgument("password is too long".into()));
    }
    Ok(normalized)
}

fn validate_context(context: &str) -> Result<(), KsError> {
    if context.is_empty() || context.len() > MAX_CONTEXT_BYTES || context.chars().any(char::is_control) {
        return Err(KsError::InvalidArgument("invalid field context".into()));
    }
    Ok(())
}

fn validate_label(label: &str) -> Result<(), KsError> {
    if label.is_empty() || label.len() > 32 || !label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
        return Err(KsError::InvalidArgument("invalid key label".into()));
    }
    Ok(())
}

fn open_sealed_field(field_key: &Key32, scope_id: &str, context: &str, sealed: &str) -> Result<Zeroizing<Vec<u8>>, KsError> {
    validate_context(context)?;
    let body = sealed
        .strip_prefix(FIELD_PREFIX)
        .ok_or_else(|| KsError::InvalidArgument("not a sealed field".into()))?;
    if body.len() > (MAX_FIELD_BYTES + NONCE_LEN + 16) * 4 / 3 + 4 {
        return Err(KsError::InvalidArgument("sealed field is too large".into()));
    }
    let raw = STANDARD.decode(body).map_err(|_| KsError::Corrupt("sealed field is not base64".into()))?;
    if raw.len() < NONCE_LEN + 16 {
        return Err(KsError::Corrupt("sealed field is truncated".into()));
    }
    crypto::open(field_key, &raw[..NONCE_LEN], &raw[NONCE_LEN..], &field_aad(scope_id, context))
        .map_err(|_| KsError::Corrupt("sealed field does not open".into()))
}

fn fs_exists(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok()
}

/// Changes to State that an operation applies after saving the keyring.
type StateUpdate<'a> = Box<dyn FnOnce(&mut State) + 'a>;

/// Engine: routes, reconciliation and persistence.
impl<D: Device> Keystore<D> {
    pub fn open(device: D, path: PathBuf) -> Result<Self, KsError> {
        Self::with_options(device, path, Argon2Params::DEFAULT, Arc::new(Instant::now))
    }

    pub fn with_options(device: D, path: PathBuf, argon2: Argon2Params, clock: Clock) -> Result<Self, KsError> {
        let keyring = keyring::load(&path)?;
        Ok(Keystore {
            device,
            path,
            argon2,
            clock,
            op: Mutex::new(()),
            state: Mutex::new(State { keyring, ..State::default() }),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The Argon2id parameters this keystore uses for new password wraps.
    pub fn argon2_params(&self) -> Argon2Params {
        self.argon2
    }

    #[cfg(test)]
    pub fn device(&self) -> &D {
        &self.device
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn op(&self) -> MutexGuard<'_, ()> {
        self.op.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn now(&self) -> Instant {
        (self.clock)()
    }

    fn snapshot(&self) -> Result<(Keyring, KeyMap, u64, bool), KsError> {
        let st = self.state();
        let keyring = st.keyring.clone().ok_or(KsError::NotInitialized)?;
        Ok((keyring, st.keys.clone(), st.epoch, st.quiet_device_lost))
    }

    /// Saves `keyring` if it changed and applies `update`, unless a lock happened since `epoch`.
    /// Device keys in `retired` are deleted only after the keyring that dropped them is saved.
    fn finish(
        &self,
        epoch: u64,
        keyring: Option<Keyring>,
        lost: bool,
        retired: Vec<DeviceKey>,
        update: StateUpdate<'_>,
    ) -> Result<(), KsError> {
        let mut st = self.state();
        if st.epoch != epoch {
            return Err(KsError::Cancelled);
        }
        if let Some(mut keyring) = keyring {
            let previous = st.keyring.as_ref().map_or(0, |k| k.generation);
            keyring.generation = previous;
            if st.keyring.as_ref() != Some(&keyring) {
                keyring.generation = previous + 1;
                keyring::save(&self.path, &keyring)?;
                st.keyring = Some(keyring);
            }
        }
        st.quiet_device_lost = lost;
        update(&mut st);
        drop(st);
        for device in retired {
            self.device.delete_key(&device);
        }
        Ok(())
    }

    fn note_lost(&self) {
        self.state().quiet_device_lost = true;
    }

    fn quiet_wrap(&self, scope_id: &str, version_id: &str, device: &DeviceKey, key: &Key32) -> Result<Wrap, KsError> {
        let aad = wrap_aad(scope_id, version_id, "device", &device.id);
        let (kek, blob) = self.device.encapsulate(device, &aad, "")?;
        Ok(Wrap::Device { device: device.id.clone(), blob: B64(blob), sealed: seal_route(&kek, key, &aad) })
    }

    fn presence_wrap(&self, scope_id: &str, version_id: &str, device: &DeviceKey, key: &Key32, reason: &str) -> Result<Wrap, KsError> {
        let aad = wrap_aad(scope_id, version_id, "presence", &device.id);
        let (kek, blob) = self.device.encapsulate(device, &aad, reason)?;
        Ok(Wrap::Presence { key: device.clone(), blob: B64(blob), sealed: seal_route(&kek, key, &aad) })
    }

    fn password_wrap(&self, scope_id: &str, version_id: &str, password: &[u8], key: &Key32) -> Result<Wrap, KsError> {
        let salt = crypto::random_array::<SALT_LEN>();
        let kek = crypto::argon2id(password, &salt, self.argon2)?;
        Ok(Wrap::Password {
            salt: B64(salt.to_vec()),
            m_kib: self.argon2.m_kib,
            t: self.argon2.t,
            p: self.argon2.p,
            sealed: seal_route(&kek, key, &wrap_aad(scope_id, version_id, "password", "")),
        })
    }

    /// Recovers a version key without asking the user: from memory, through a parent wrap whose
    /// app key is in memory, or through the quiet device key.
    fn obtain_quietly(
        &self,
        keyring: &Keyring,
        known: &KeyMap,
        scope_id: &str,
        version: &KeyVersion,
        lost: &mut bool,
    ) -> Result<Option<Key32>, KsError> {
        if let Some(key) = known.get(&slot(scope_id, &version.id)) {
            return Ok(Some(key.clone()));
        }
        for wrap in &version.wraps {
            let Wrap::Parent { parent_version, .. } = wrap else { continue };
            let Some(app_key) = known.get(&slot(APP, parent_version)) else { continue };
            // Only app keys sealed under a master password may open workspaces; an app key from a
            // time without one was readable by anyone at the computer.
            let master_era = keyring.scopes[APP]
                .versions
                .iter()
                .find(|v| v.id == *parent_version)
                .is_some_and(|v| read_own_password(APP, v, app_key));
            if master_era {
                if let Ok(key) = open_version_key(scope_id, version, wrap, app_key) {
                    return Ok(Some(key));
                }
            }
        }
        let Some(quiet) = keyring.quiet_device.as_ref().filter(|_| !*lost) else { return Ok(None) };
        for wrap in &version.wraps {
            let Wrap::Device { device, blob, .. } = wrap else { continue };
            if *device != quiet.id {
                continue;
            }
            return match self.device.decapsulate(quiet, &blob.0, &aad_for(scope_id, &version.id, wrap), "") {
                Ok(kek) => open_version_key(scope_id, version, wrap, &kek)
                    .map(Some)
                    .map_err(|_| KsError::Corrupt(format!("{scope_id}: the device route does not open"))),
                Err(KsError::DeviceKeyLost) => {
                    *lost = true;
                    Ok(None)
                }
                Err(error) => Err(error),
            };
        }
        Ok(None)
    }

    /// Whether `version` may get a quiet route: the scope must be unprotected by its sealed
    /// records, and an app version that is about to be retired never gets one (it may have been
    /// the master-era key that workspaces were wrapped under).
    fn quiet_allowed(policy: &Policy, scope_id: &str, is_governing: bool) -> bool {
        policy.verified_unprotected(scope_id) && (is_governing || scope_id != APP)
    }

    fn needs_work(policy: &Policy, scope_id: &str, version: &KeyVersion, is_governing: bool) -> bool {
        version.wraps.iter().any(|w| verdict(policy, scope_id, &version.id, w) != Verdict::Keep)
            || (Self::quiet_allowed(policy, scope_id, is_governing) && !version.wraps.iter().any(|w| policy.is_quiet(w)))
            || (scope_id != APP
                && policy.verified_master()
                && policy.master_versions.iter().any(|av| !version.wraps.iter().any(|w| Policy::is_parent_of(w, av))))
            || (policy.recovery_may_cover(scope_id) && !version.wraps.iter().any(|w| policy.is_current_recovery(w)))
    }

    /// Brings the routes of `only` (or of every scope) in line with the policy. Keys recovered on
    /// the way are added to `known`. Returns device keys that are no longer referenced.
    fn reconcile(&self, keyring: &mut Keyring, known: &mut KeyMap, only: Option<&str>, lost: &mut bool) -> Result<Vec<DeviceKey>, KsError> {
        let scope_ids: Vec<String> = match only {
            Some(scope_id) => vec![scope_id.to_string()],
            // "app" sorts first, so workspace keys can come through a freshly recovered app key.
            None => keyring.scopes.keys().cloned().collect(),
        };

        // The app's sealed record decides whether workspaces may be quiet, so fetch its keys if
        // that needs no prompt (it cannot while a master password is set).
        for app_version in keyring.scopes[APP].versions.clone() {
            if let Some(key) = self.obtain_quietly(keyring, known, APP, &app_version, lost)? {
                known.insert(slot(APP, &app_version.id), key);
            }
        }
        let policy = Policy::build(keyring, known);
        for scope_id in &scope_ids {
            let scope = &keyring.scopes[scope_id];
            let last = scope.versions.len() - 1;
            for (i, version) in scope.versions.iter().enumerate() {
                if !known.contains_key(&slot(scope_id, &version.id)) && Self::needs_work(&policy, scope_id, version, i == last) {
                    if let Some(key) = self.obtain_quietly(keyring, known, scope_id, version, lost)? {
                        known.insert(slot(scope_id, &version.id), key);
                    }
                }
            }
        }
        let mut policy = Policy::build(keyring, known);

        // New quiet routes need a device key that exists on this machine. One that came along
        // from another computer would accept wraps that never open again, so check it first.
        let mut retired = Vec::new();
        let needs_quiet = scope_ids.iter().any(|id| policy.verified_unprotected(id));
        let adds_quiet_route = scope_ids.iter().any(|id| {
            let versions = &keyring.scopes[id].versions;
            versions.iter().enumerate().any(|(i, v)| {
                Self::quiet_allowed(&policy, id, i == versions.len() - 1) && !v.wraps.iter().any(|w| policy.is_quiet(w))
            })
        });
        if needs_quiet {
            let replace = match &keyring.quiet_device {
                None => true,
                Some(_) if *lost => true,
                Some(quiet) if adds_quiet_route => !self.device.key_usable(quiet)?,
                Some(_) => false,
            };
            if replace {
                let fresh = self.device.create_quiet_key()?;
                retired.extend(keyring.quiet_device.replace(fresh));
                *lost = false;
                policy.quiet = keyring.quiet_device.clone();
            }
        }

        let mut dropped_presence = Vec::new();
        for scope_id in &scope_ids {
            let scope = keyring.scopes.get_mut(scope_id).expect("scope listed above");
            let last = scope.versions.len() - 1;
            for (i, version) in scope.versions.iter_mut().enumerate() {
                let key = known.get(&slot(scope_id, &version.id)).cloned();
                let before = presence_keys(version.wraps.iter());
                self.apply_policy(&policy, scope_id, version, i == last, key.as_ref(), known)?;
                let after = presence_keys(version.wraps.iter());
                dropped_presence.extend(before.into_iter().filter(|k| !after.iter().any(|a| a.id == k.id)));
            }
        }
        retired.extend(unreferenced(keyring, dropped_presence));
        Ok(retired)
    }

    fn apply_policy(
        &self,
        policy: &Policy,
        scope_id: &str,
        version: &mut KeyVersion,
        is_governing: bool,
        key: Option<&Key32>,
        known: &KeyMap,
    ) -> Result<(), KsError> {
        let verdicts: Vec<Verdict> = version.wraps.iter().map(|w| verdict(policy, scope_id, &version.id, w)).collect();
        let route_survives = verdicts.contains(&Verdict::Keep);
        let Some(key) = key else {
            if verdicts.contains(&Verdict::Forbidden) && !route_survives {
                return Err(KsError::Unavailable(format!("{scope_id} could not be opened to update its protection")));
            }
            // Leftovers stay while they are the only way in (a lost device's only recovery route).
            let mut i = 0;
            version.wraps.retain(|_| {
                let v = verdicts[i];
                i += 1;
                v == Verdict::Keep || (v == Verdict::Stale && !route_survives)
            });
            return Ok(());
        };

        let mut i = 0;
        version.wraps.retain(|_| {
            let keep = verdicts[i] == Verdict::Keep;
            i += 1;
            keep
        });
        if Self::quiet_allowed(policy, scope_id, is_governing) && !version.wraps.iter().any(|w| policy.is_quiet(w)) {
            let quiet = policy.quiet.as_ref().ok_or_else(|| KsError::Unavailable("no device key".into()))?;
            version.wraps.push(self.quiet_wrap(scope_id, &version.id, quiet, key)?);
        }
        if scope_id != APP && policy.verified_master() {
            for app_version in &policy.master_versions {
                if version.wraps.iter().any(|w| Policy::is_parent_of(w, app_version)) {
                    continue;
                }
                if let Some(app_key) = known.get(&slot(APP, app_version)) {
                    version.wraps.push(parent_wrap(scope_id, &version.id, app_version, app_key, key));
                }
            }
        }
        if let Some(recovery) = &policy.recovery {
            if policy.recovery_may_cover(scope_id) && !version.wraps.iter().any(|w| policy.is_current_recovery(w)) {
                version.wraps.push(recovery_wrap(scope_id, &version.id, recovery, key)?);
            }
        }
        if version.wraps.is_empty() {
            return Err(KsError::Corrupt(format!("{scope_id} would be left without a way to open it")));
        }
        Ok(())
    }

    /// Policy for the keys currently in memory.
    fn current_policy(st: &State) -> Option<Policy> {
        st.keyring.as_ref().map(|keyring| Policy::build(keyring, &st.keys))
    }
}

/// Public operations.
impl<D: Device> Keystore<D> {
    pub fn status(&self) -> Status {
        let st = self.state();
        let presence_supported = self.device.presence_supported();
        let (Some(keyring), Some(policy)) = (&st.keyring, Self::current_policy(&st)) else {
            return Status { presence_supported, ..Status::default() };
        };
        let now = self.now();
        let scopes = keyring
            .scopes
            .iter()
            .map(|(id, scope)| {
                let current = &scope.versions[0];
                let reveal_remaining_ms = reveal_domain(&policy, keyring, id)
                    .ok()
                    .and_then(|domain| st.reveal.get(&domain).copied())
                    .and_then(|last| REVEAL_IDLE.checked_sub(now.saturating_duration_since(last)))
                    .filter(|left| !left.is_zero())
                    .map(|left| left.as_millis() as u64);
                ScopeStatus {
                    id: id.clone(),
                    protected: policy.protected(id),
                    own_password: policy.own(id).value,
                    presence: current.wraps.iter().any(|w| matches!(w, Wrap::Presence { .. })),
                    unlocked: st.keys.contains_key(&slot(id, &current.id)),
                    staged: scope.versions.len() > 1,
                    recovery: current.wraps.iter().any(|w| policy.is_current_recovery(w)),
                    master_linked: id != APP
                        && current.wraps.iter().any(|w| matches!(w, Wrap::Parent { parent_version, .. } if policy.app_versions.contains(parent_version))),
                    reveal_remaining_ms,
                }
            })
            .collect();
        Status {
            initialized: true,
            app_protected: policy.app().value,
            recovery_configured: keyring.recovery.is_some(),
            presence_supported,
            quiet_backend: keyring.quiet_device.as_ref().map(|d| d.backend.clone()),
            device_key_lost: st.quiet_device_lost,
            scopes,
        }
    }

    /// First run: creates the app scope, readable through the quiet device key only.
    pub fn initialize(&self) -> Result<(), KsError> {
        let _op = self.op();
        let epoch = {
            let st = self.state();
            if st.keyring.is_some() {
                return Err(KsError::AlreadyInitialized);
            }
            st.epoch
        };
        if fs_exists(&self.path) {
            return Err(KsError::AlreadyInitialized);
        }
        let mut keyring = Keyring::new();
        let key = crypto::random_key();
        let field_key = crypto::random_key();
        let version = new_version(APP, &key, &field_key, false);
        let app_slot = slot(APP, &version.id);
        keyring.scopes.insert(APP.into(), Scope { versions: vec![version] });
        let mut known = KeyMap::new();
        known.insert(app_slot.clone(), key.clone());
        let mut lost = false;
        let retired = self.reconcile(&mut keyring, &mut known, Some(APP), &mut lost)?;
        self.finish(
            epoch,
            Some(keyring),
            lost,
            retired,
            Box::new(move |st| {
                st.keys.insert(app_slot, key);
                st.field_keys.insert(APP.into(), field_key);
            }),
        )
    }

    /// Unlocks a scope without asking the user: through the quiet device key, or through the app
    /// key when a master password is set and already entered.
    pub fn open_scope(&self, scope_id: &str) -> Result<(), KsError> {
        let _op = self.op();
        let (keyring, mut known, epoch, mut lost) = self.snapshot()?;
        let scope = get_scope(&keyring, scope_id)?;
        let mut install = Vec::new();
        for (i, version) in scope.versions.iter().enumerate() {
            let version_slot = slot(scope_id, &version.id);
            if known.contains_key(&version_slot) {
                continue;
            }
            match self.obtain_quietly(&keyring, &known, scope_id, version, &mut lost)? {
                Some(key) => {
                    known.insert(version_slot.clone(), key.clone());
                    install.push((version_slot, key));
                }
                None if i == 0 => {
                    if lost {
                        self.note_lost();
                    }
                    // A password route on the current version also means "ask for the password":
                    // a password removal waiting for its rotation leaves the old key behind it.
                    let has_secret_route = version.wraps.iter().any(|w| w.is_password() || matches!(w, Wrap::Presence { .. }));
                    return Err(if Policy::build(&keyring, &known).protected(scope_id) || has_secret_route {
                        KsError::Locked(scope_id.to_string())
                    } else if lost {
                        KsError::DeviceKeyLost
                    } else {
                        KsError::Unavailable(format!("{scope_id} has no usable device route"))
                    });
                }
                None => {}
            }
        }
        self.complete_unlock(epoch, keyring, known, install, scope_id, lost)
    }

    pub fn unlock_with_password(&self, scope_id: &str, password: &str) -> Result<(), KsError> {
        let password = normalize_password(password)?;
        let _op = self.op();
        self.check_rate_limit()?;
        let (keyring, mut known, epoch, lost) = self.snapshot()?;
        let scope = get_scope(&keyring, scope_id)?;
        let install = self.record_password_attempt(self.open_with_password(scope_id, scope, password.as_bytes()))?;
        for (version_slot, key) in &install {
            known.insert(version_slot.clone(), key.clone());
        }
        self.complete_unlock(epoch, keyring, known, install, scope_id, lost)
    }

    pub fn unlock_with_presence(&self, scope_id: &str, reason: &str) -> Result<(), KsError> {
        let _op = self.op();
        let (keyring, mut known, epoch, lost) = self.snapshot()?;
        let scope = get_scope(&keyring, scope_id)?;
        let not_enabled = || KsError::Unavailable(format!("{scope_id}: Touch ID / Windows Hello is not enabled"));
        let mut install = Vec::new();
        for (i, version) in scope.versions.iter().enumerate() {
            let Some(wrap @ Wrap::Presence { key: device, blob, .. }) = version.wraps.iter().find(|w| matches!(w, Wrap::Presence { .. })) else {
                if i == 0 {
                    return Err(not_enabled());
                }
                continue;
            };
            let kek = match self.device.decapsulate(device, &blob.0, &aad_for(scope_id, &version.id, wrap), reason) {
                Ok(kek) => kek,
                Err(error) if i == 0 => return Err(error),
                Err(_) => continue,
            };
            match open_version_key(scope_id, version, wrap, &kek) {
                Ok(key) => {
                    known.insert(slot(scope_id, &version.id), key.clone());
                    install.push((slot(scope_id, &version.id), key));
                }
                Err(_) if i == 0 => return Err(KsError::Corrupt(format!("{scope_id}: the presence route does not open"))),
                Err(_) => {}
            }
        }
        self.complete_unlock(epoch, keyring, known, install, scope_id, lost)
    }

    /// Unlocks every scope the recovery code can open. Returns their ids.
    pub fn unlock_with_recovery(&self, code: &str) -> Result<Vec<String>, KsError> {
        let code = RecoveryCode::parse(code)?;
        let secret = code.secret_key();
        let recovery = recovery::recovery_id(&code.public_key());
        let _op = self.op();
        let (mut keyring, mut known, epoch, mut lost) = self.snapshot()?;
        let mut install = Vec::new();
        let mut field_keys = Vec::new();
        let mut opened = Vec::new();
        for (scope_id, scope) in &keyring.scopes {
            for (i, version) in scope.versions.iter().enumerate() {
                let key = version.wraps.iter().find_map(|wrap| match wrap {
                    Wrap::Recovery { recovery: id, ephemeral, .. } if *id == recovery => {
                        let kek = crypto::ecies_decapsulate(&secret, &ephemeral.0, &aad_for(scope_id, &version.id, wrap)).ok()?;
                        open_version_key(scope_id, version, wrap, &kek).ok()
                    }
                    _ => None,
                });
                let Some(key) = key else { continue };
                if i == 0 {
                    field_keys.push((scope_id.clone(), open_field_key(scope_id, version, &key)?));
                    opened.push(scope_id.clone());
                }
                known.insert(slot(scope_id, &version.id), key.clone());
                install.push((slot(scope_id, &version.id), key));
            }
        }
        if opened.is_empty() {
            return Err(KsError::InvalidRecoveryCode);
        }
        // Moving to a new machine: replace a quiet device key that does not exist here.
        if let Some(quiet) = &keyring.quiet_device {
            if !lost && !self.device.key_usable(quiet).unwrap_or(true) {
                lost = true;
            }
        }
        let mut updated = keyring.clone();
        let retired = match self.reconcile(&mut updated, &mut known, None, &mut lost) {
            Ok(retired) => {
                keyring = updated;
                retired
            }
            // The unlock itself succeeded; the repair is retried on the next unlock.
            Err(_) => Vec::new(),
        };
        self.finish(
            epoch,
            Some(keyring),
            lost,
            retired,
            Box::new(move |st| {
                st.keys.extend(install);
                st.field_keys.extend(field_keys);
            }),
        )?;
        Ok(opened)
    }

    /// Installs freshly unlocked keys and adds routes that could not be created while the scope
    /// was locked (a parent route after a master password was set, a new recovery route).
    fn complete_unlock(
        &self,
        epoch: u64,
        keyring: Keyring,
        mut known: KeyMap,
        mut install: Vec<(Slot, Key32)>,
        scope_id: &str,
        mut lost: bool,
    ) -> Result<(), KsError> {
        // The other version of a pending rotation often opens without a prompt (its quiet or
        // parent route); the caller needs both keys to finish the rotation.
        for version in keyring.scopes[scope_id].versions.clone() {
            if known.contains_key(&slot(scope_id, &version.id)) {
                continue;
            }
            if let Ok(Some(key)) = self.obtain_quietly(&keyring, &known, scope_id, &version, &mut lost) {
                known.insert(slot(scope_id, &version.id), key.clone());
                install.push((slot(scope_id, &version.id), key));
            }
        }
        let current = &keyring.scopes[scope_id].versions[0];
        let current_key = known
            .get(&slot(scope_id, &current.id))
            .ok_or_else(|| KsError::Locked(scope_id.to_string()))?;
        let field_key = open_field_key(scope_id, current, current_key)?;
        let mut updated = keyring.clone();
        let (save, retired) = match self.reconcile(&mut updated, &mut known, Some(scope_id), &mut lost) {
            Ok(retired) => (updated, retired),
            // The unlock itself succeeded; the upgrade is retried on the next unlock.
            Err(_) => (keyring, Vec::new()),
        };
        let scope_id = scope_id.to_string();
        self.finish(
            epoch,
            Some(save),
            lost,
            retired,
            Box::new(move |st| {
                st.keys.extend(install);
                st.field_keys.insert(scope_id, field_key);
            }),
        )
    }

    fn open_with_password(&self, scope_id: &str, scope: &Scope, password: &[u8]) -> Result<Vec<(Slot, Key32)>, KsError> {
        // Any version counts: while a password removal waits for its rotation, only the old
        // version still has the password.
        if !scope.versions.iter().any(|v| v.wraps.iter().any(Wrap::is_password)) {
            return Err(KsError::NoPassword(scope_id.to_string()));
        }
        let mut opened = Vec::new();
        for (i, version) in scope.versions.iter().enumerate() {
            let Some(wrap @ Wrap::Password { salt, m_kib, t, p, .. }) = version.wraps.iter().find(|w| w.is_password()) else { continue };
            let kek = crypto::argon2id(password, &salt.0, Argon2Params { m_kib: *m_kib, t: *t, p: *p })?;
            match open_version_key(scope_id, version, wrap, &kek) {
                Ok(key) => opened.push((slot(scope_id, &version.id), key)),
                Err(_) if i == 0 => return Err(KsError::WrongPassword),
                Err(_) => {}
            }
        }
        if opened.is_empty() {
            return Err(KsError::WrongPassword);
        }
        Ok(opened)
    }

    fn check_rate_limit(&self) -> Result<(), KsError> {
        let st = self.state();
        let now = self.now();
        match st.password_retry_at {
            Some(at) if at > now => Err(KsError::RateLimited((at - now).as_millis().max(1) as u64)),
            _ => Ok(()),
        }
    }

    /// Wrong passwords beyond the first few cost a growing wait, on top of Argon2's own cost.
    fn record_password_attempt<T>(&self, result: Result<T, KsError>) -> Result<T, KsError> {
        let mut st = self.state();
        match &result {
            Ok(_) => {
                st.password_failures = 0;
                st.password_retry_at = None;
            }
            Err(KsError::WrongPassword) => {
                st.password_failures = st.password_failures.saturating_add(1);
                if st.password_failures > FREE_PASSWORD_FAILURES {
                    let exponent = (st.password_failures - FREE_PASSWORD_FAILURES - 1).min(16);
                    let delay = (1000u64 << exponent).min(MAX_PASSWORD_DELAY_MS);
                    st.password_retry_at = Some(self.now() + Duration::from_millis(delay));
                }
            }
            Err(_) => {}
        }
        result
    }

    /// Drops the keys of every protected scope and ends reveal sessions. Unprotected scopes stay
    /// usable: anyone at the computer can open them anyway.
    pub fn lock_protected(&self) {
        let mut guard = self.state();
        let st = &mut *guard;
        st.epoch += 1;
        st.reveal.clear();
        let Some(policy) = Self::current_policy(st) else { return };
        let protected: HashSet<String> = policy.own.keys().filter(|id| policy.protected(id)).cloned().collect();
        st.keys.retain(|(scope_id, _), _| !protected.contains(scope_id));
        st.field_keys.retain(|scope_id, _| !protected.contains(scope_id));
    }

    /// Locks one protected workspace again (leaving it). "app" locks everything protected.
    pub fn lock_scope(&self, scope_id: &str) -> Result<(), KsError> {
        if scope_id == APP {
            self.lock_protected();
            return Ok(());
        }
        let mut guard = self.state();
        let st = &mut *guard;
        let policy = Self::current_policy(st).ok_or(KsError::NotInitialized)?;
        let keyring = st.keyring.as_ref().ok_or(KsError::NotInitialized)?;
        let domain = reveal_domain(&policy, keyring, scope_id)?;
        if policy.protected(scope_id) {
            // An operation already under way must not put the key back after this lock.
            st.epoch += 1;
            st.keys.retain(|(id, _), _| id != scope_id);
            st.field_keys.remove(scope_id);
        }
        if domain == scope_id {
            st.reveal.remove(scope_id);
        }
        Ok(())
    }

    /// Creates a workspace scope, optionally with its own password.
    pub fn create_scope(&self, scope_id: &str, password: Option<&str>) -> Result<(), KsError> {
        let password = password.map(|p| validate_new_password(scope_id, p)).transpose()?;
        self.create_scope_with(scope_id, password)
    }

    /// Creates a workspace scope for a workspace migrated from an older GETSSH, keeping the
    /// password it already had even where it is shorter than new passwords may be.
    pub fn create_scope_with_legacy_password(&self, scope_id: &str, password: &str) -> Result<(), KsError> {
        let password = normalize_password(password)?;
        if password.is_empty() {
            return Err(KsError::InvalidArgument("empty password".into()));
        }
        self.create_scope_with(scope_id, Some(password))
    }

    fn create_scope_with(&self, scope_id: &str, password: Option<Zeroizing<String>>) -> Result<(), KsError> {
        if scope_id == APP || !keyring::is_valid_scope_id(scope_id) {
            return Err(KsError::InvalidArgument("invalid workspace scope id".into()));
        }
        let _op = self.op();
        let (mut keyring, mut known, epoch, mut lost) = self.snapshot()?;
        if keyring.scopes.contains_key(scope_id) {
            return Err(KsError::ScopeExists(scope_id.to_string()));
        }
        // Under a master password a new workspace needs the app key for its parent route.
        let app_current = &keyring.scopes[APP].versions[0];
        if !known.contains_key(&slot(APP, &app_current.id)) && has_password_route(&keyring.scopes[APP]) {
            return Err(KsError::Locked(APP.to_string()));
        }
        let key = crypto::random_key();
        let field_key = crypto::random_key();
        let mut version = new_version(scope_id, &key, &field_key, password.is_some());
        if let Some(password) = &password {
            version.wraps.push(self.password_wrap(scope_id, &version.id, password.as_bytes(), &key)?);
        }
        let version_slot = slot(scope_id, &version.id);
        keyring.scopes.insert(scope_id.to_string(), Scope { versions: vec![version] });
        known.insert(version_slot.clone(), key.clone());
        let retired = self.reconcile(&mut keyring, &mut known, Some(scope_id), &mut lost)?;
        let scope_id = scope_id.to_string();
        self.finish(
            epoch,
            Some(keyring),
            lost,
            retired,
            Box::new(move |st| {
                st.keys.insert(version_slot, key);
                st.field_keys.insert(scope_id, field_key);
            }),
        )
    }

    pub fn delete_scope(&self, scope_id: &str) -> Result<(), KsError> {
        if scope_id == APP {
            return Err(KsError::InvalidArgument("the app scope cannot be deleted".into()));
        }
        let _op = self.op();
        let (mut keyring, _known, epoch, lost) = self.snapshot()?;
        let scope = get_scope(&keyring, scope_id)?;
        let presence = presence_keys(scope.versions.iter().flat_map(|v| v.wraps.iter()));
        keyring.scopes.remove(scope_id);
        let retired = unreferenced(&keyring, presence);
        let scope_id = scope_id.to_string();
        self.finish(
            epoch,
            Some(keyring),
            lost,
            retired,
            Box::new(move |st| {
                st.keys.retain(|(id, _), _| *id != scope_id);
                st.field_keys.remove(&scope_id);
                st.reveal.remove(&scope_id);
            }),
        )
    }

    /// Adds a staged key version to `scope_id` (sealed with `own_password`) and records its key
    /// in `known`. The current key must be in `known` or quietly obtainable.
    fn stage_version(
        &self,
        keyring: &mut Keyring,
        known: &mut KeyMap,
        scope_id: &str,
        own_password: bool,
        password: Option<&[u8]>,
        lost: &mut bool,
    ) -> Result<(), KsError> {
        let current = keyring.scopes[scope_id].versions[0].clone();
        let Some(current_key) = self.obtain_quietly(keyring, known, scope_id, &current, lost)? else {
            return Err(KsError::Unavailable(format!("{scope_id} could not be opened to change its protection")));
        };
        known.insert(slot(scope_id, &current.id), current_key.clone());
        let field_key = open_field_key(scope_id, &current, &current_key)?;
        let staged_key = crypto::random_key();
        let mut staged = new_version(scope_id, &staged_key, &field_key, own_password);
        if let Some(password) = password {
            staged.wraps.push(self.password_wrap(scope_id, &staged.id, password, &staged_key)?);
        }
        known.insert(slot(scope_id, &staged.id), staged_key);
        keyring.scopes.get_mut(scope_id).expect("scope exists").versions.push(staged);
        Ok(())
    }

    /// Saves a protection change and keeps every key of `touched` scopes unlocked (their
    /// databases are rekeyed next). Reveal sessions end: they were opened under the old rules.
    fn finish_protection_change(
        &self,
        epoch: u64,
        keyring: Keyring,
        known: &KeyMap,
        touched: &[String],
        lost: bool,
        retired: Vec<DeviceKey>,
    ) -> Result<(), KsError> {
        let mut install = Vec::new();
        let mut field_keys = Vec::new();
        for target in touched {
            let scope = &keyring.scopes[target];
            for version in &scope.versions {
                if let Some(key) = known.get(&slot(target, &version.id)) {
                    install.push((slot(target, &version.id), key.clone()));
                }
            }
            if let Some(key) = known.get(&slot(target, &scope.versions[0].id)) {
                field_keys.push((target.clone(), open_field_key(target, &scope.versions[0], key)?));
            }
        }
        self.finish(
            epoch,
            Some(keyring),
            lost,
            retired,
            Box::new(move |st| {
                st.keys.extend(install);
                st.field_keys.extend(field_keys);
                st.reveal.clear();
            }),
        )
    }

    fn fetch_app_keys_quietly(&self, keyring: &Keyring, known: &mut KeyMap, lost: &mut bool) -> Result<(), KsError> {
        for version in keyring.scopes[APP].versions.clone() {
            if let Some(key) = self.obtain_quietly(keyring, known, APP, &version, lost)? {
                known.insert(slot(APP, &version.id), key);
            }
        }
        Ok(())
    }

    /// Sets or changes a scope's password ("app": the master password); the scope must be
    /// unlocked. Changing an existing password keeps the key. Giving a scope a password stages a
    /// new key version sealed with the new protection, as it does for every workspace that
    /// becomes protected by a new master password: an old copy of keyring.json then cannot open
    /// data written from now on, and no older protection record can be replayed against the new
    /// version. Returns the staged scopes: rekey each database to `database_key(scope, label,
    /// true)`, then `commit_rotation`.
    ///
    /// Setting a master password also discards the recovery code: anyone at the computer may have
    /// created it, and from now on it would open everything. Create a new one right after.
    pub fn set_password(&self, scope_id: &str, password: &str) -> Result<Vec<String>, KsError> {
        let password = validate_new_password(scope_id, password)?;
        let _op = self.op();
        let (mut keyring, mut known, epoch, mut lost) = self.snapshot()?;
        let scope = get_scope(&keyring, scope_id)?;
        if scope.versions.len() > 1 {
            return Err(KsError::RotationPending(scope_id.to_string()));
        }
        let current = scope.versions[0].clone();
        let key = known
            .get(&slot(scope_id, &current.id))
            .cloned()
            .ok_or_else(|| KsError::Locked(scope_id.to_string()))?;
        self.fetch_app_keys_quietly(&keyring, &mut known, &mut lost)?;
        let before = Policy::build(&keyring, &known);
        let was_protected: HashMap<String, bool> = keyring.scopes.keys().map(|id| (id.clone(), before.protected(id))).collect();
        let had_password = read_own_password(scope_id, &current, &key);

        // The current version takes the password too: until a rotation is committed its database
        // still uses this key.
        let wrap = self.password_wrap(scope_id, &current.id, password.as_bytes(), &key)?;
        {
            let version = &mut keyring.scopes.get_mut(scope_id).expect("checked above").versions[0];
            version.wraps.retain(|w| !w.is_password());
            version.wraps.push(wrap);
        }
        let mut staged = Vec::new();
        if !had_password {
            self.stage_version(&mut keyring, &mut known, scope_id, true, Some(password.as_bytes()), &mut lost)?;
            staged.push(scope_id.to_string());
            if scope_id == APP {
                keyring.recovery = None;
            }
            let after = Policy::build(&keyring, &known);
            let transitioning: Vec<String> = keyring
                .scopes
                .iter()
                .filter(|(id, s)| *id != scope_id && !was_protected[*id] && after.protected(id) && s.versions.len() == 1)
                .map(|(id, _)| id.clone())
                .collect();
            for target in transitioning {
                self.stage_version(&mut keyring, &mut known, &target, false, None, &mut lost)?;
                staged.push(target);
            }
        }
        let retired = self.reconcile(&mut keyring, &mut known, None, &mut lost)?;
        let mut touched = staged.clone();
        if !touched.iter().any(|id| id == scope_id) {
            touched.push(scope_id.to_string());
        }
        self.finish_protection_change(epoch, keyring, &known, &touched, lost, retired)?;
        Ok(staged)
    }

    /// Removes a scope's own password ("app": the master password) and its Touch ID / Hello
    /// route by staging a new key version sealed without a password. The old version keeps its
    /// password until the rotation is committed (its database still uses it) and is then gone:
    /// in particular the master-era app key, which protected workspaces were wrapped under, never
    /// gets a no-prompt route. Returns the staged scopes, as set_password does.
    pub fn remove_password(&self, scope_id: &str) -> Result<Vec<String>, KsError> {
        let _op = self.op();
        let (mut keyring, mut known, epoch, mut lost) = self.snapshot()?;
        let scope = get_scope(&keyring, scope_id)?;
        if scope.versions.len() > 1 {
            return Err(KsError::RotationPending(scope_id.to_string()));
        }
        let current = scope.versions[0].clone();
        let key = known
            .get(&slot(scope_id, &current.id))
            .cloned()
            .ok_or_else(|| KsError::Locked(scope_id.to_string()))?;
        if !read_own_password(scope_id, &current, &key) {
            return Err(KsError::NoPassword(scope_id.to_string()));
        }
        self.fetch_app_keys_quietly(&keyring, &mut known, &mut lost)?;
        self.stage_version(&mut keyring, &mut known, scope_id, false, None, &mut lost)?;
        let retired = self.reconcile(&mut keyring, &mut known, None, &mut lost)?;
        self.finish_protection_change(epoch, keyring, &known, &[scope_id.to_string()], lost, retired)?;
        Ok(vec![scope_id.to_string()])
    }

    /// Adds a Touch ID / Windows Hello route to a scope that has its own password, through a
    /// device key created now for this scope alone (never one described by the keyring file).
    pub fn enable_presence(&self, scope_id: &str, reason: &str) -> Result<(), KsError> {
        let _op = self.op();
        let (mut keyring, known, epoch, lost) = self.snapshot()?;
        let scope = get_scope(&keyring, scope_id)?;
        let keys: Vec<(String, Key32)> = scope
            .versions
            .iter()
            .map(|v| known.get(&slot(scope_id, &v.id)).map(|k| (v.id.clone(), k.clone())))
            .collect::<Option<_>>()
            .ok_or_else(|| KsError::Locked(scope_id.to_string()))?;
        let governing_key = &keys.last().expect("a scope always has a version").1;
        if !read_own_password(scope_id, governing(scope), governing_key) {
            return Err(KsError::NoPassword(scope_id.to_string()));
        }
        if !self.device.presence_supported() {
            return Err(KsError::Unavailable("Touch ID / Windows Hello is not available".into()));
        }
        let old = presence_keys(scope.versions.iter().flat_map(|v| v.wraps.iter()));
        let device = self.device.create_presence_key(reason)?;
        let mut wraps = Vec::new();
        for (version_id, key) in &keys {
            match self.presence_wrap(scope_id, version_id, &device, key, reason) {
                Ok(wrap) => wraps.push((version_id.clone(), wrap)),
                Err(error) => {
                    self.device.delete_key(&device);
                    return Err(error);
                }
            }
        }
        for version in &mut keyring.scopes.get_mut(scope_id).expect("checked above").versions {
            version.wraps.retain(|w| !matches!(w, Wrap::Presence { .. }));
            if let Some((_, wrap)) = wraps.iter().find(|(id, _)| *id == version.id) {
                version.wraps.push(wrap.clone());
            }
        }
        let retired = unreferenced(&keyring, old);
        let result = self.finish(epoch, Some(keyring), lost, retired, Box::new(|_| {}));
        if result.is_err() {
            self.device.delete_key(&device);
        }
        result
    }

    pub fn disable_presence(&self, scope_id: &str) -> Result<(), KsError> {
        let _op = self.op();
        let (mut keyring, _known, epoch, lost) = self.snapshot()?;
        let scope = get_scope(&keyring, scope_id)?;
        let old = presence_keys(scope.versions.iter().flat_map(|v| v.wraps.iter()));
        if old.is_empty() {
            return Ok(());
        }
        for version in &mut keyring.scopes.get_mut(scope_id).expect("checked above").versions {
            version.wraps.retain(|w| !matches!(w, Wrap::Presence { .. }));
            if version.wraps.is_empty() {
                return Err(KsError::InvalidArgument(format!("{scope_id} has no other way to open it")));
            }
        }
        let retired = unreferenced(&keyring, old);
        self.finish(epoch, Some(keyring), lost, retired, Box::new(|_| {}))
    }

    /// Creates (or replaces) the recovery code and returns it for display, once. The app scope
    /// must be unlocked. It covers the app, unprotected workspaces and, while a master password is
    /// set, every workspace; scopes locked right now get their route when next unlocked. Without a
    /// master password, workspaces protected by their own password are not covered: anyone at the
    /// computer could have created the code.
    pub fn setup_recovery(&self) -> Result<Zeroizing<String>, KsError> {
        let _op = self.op();
        let (mut keyring, mut known, epoch, mut lost) = self.snapshot()?;
        let app_governing = governing(&keyring.scopes[APP]).clone();
        let app_key = known
            .get(&slot(APP, &app_governing.id))
            .cloned()
            .ok_or_else(|| KsError::Locked(APP.to_string()))?;
        let code = RecoveryCode::generate();
        let public_key = code.public_key();
        let id = recovery::recovery_id(&public_key);
        let mac = recovery_mac(&app_key, &app_governing.id, &id, &public_key);
        keyring.recovery = Some(RecoveryInfo { id, public_key: B64(public_key.to_vec()), mac: B64(mac.to_vec()) });
        let retired = self.reconcile(&mut keyring, &mut known, None, &mut lost)?;
        self.finish(epoch, Some(keyring), lost, retired, Box::new(|_| {}))?;
        Ok(code.display())
    }

    pub fn remove_recovery(&self) -> Result<(), KsError> {
        let _op = self.op();
        let (mut keyring, mut known, epoch, mut lost) = self.snapshot()?;
        if !known.contains_key(&slot(APP, &governing(&keyring.scopes[APP]).id)) {
            return Err(KsError::Locked(APP.to_string()));
        }
        keyring.recovery = None;
        let retired = self.reconcile(&mut keyring, &mut known, None, &mut lost)?;
        self.finish(epoch, Some(keyring), lost, retired, Box::new(|_| {}))
    }

    /// Makes the staged key current once the scope's databases use it.
    pub fn commit_rotation(&self, scope_id: &str) -> Result<(), KsError> {
        let _op = self.op();
        let (mut keyring, mut known, epoch, mut lost) = self.snapshot()?;
        let scope = get_scope(&keyring, scope_id)?;
        let staged = scope.versions.get(1).ok_or_else(|| KsError::NoRotation(scope_id.to_string()))?;
        let staged_slot = slot(scope_id, &staged.id);
        let staged_key = known.get(&staged_slot).cloned().ok_or_else(|| KsError::Locked(scope_id.to_string()))?;
        let field_key = open_field_key(scope_id, staged, &staged_key)?;
        let retired_version = keyring.scopes.get_mut(scope_id).expect("checked above").versions.remove(0);
        let old_slot = slot(scope_id, &retired_version.id);
        let mut retired = self.reconcile(&mut keyring, &mut known, None, &mut lost)?;
        retired.extend(unreferenced(&keyring, presence_keys(retired_version.wraps.iter())));
        let scope_id = scope_id.to_string();
        self.finish(
            epoch,
            Some(keyring),
            lost,
            retired,
            Box::new(move |st| {
                st.keys.remove(&old_slot);
                st.keys.insert(staged_slot, staged_key);
                st.field_keys.insert(scope_id, field_key);
            }),
        )
    }

    /// Drops a staged key (its database was never rekeyed).
    pub fn abort_rotation(&self, scope_id: &str) -> Result<(), KsError> {
        let _op = self.op();
        let (mut keyring, mut known, epoch, mut lost) = self.snapshot()?;
        let scope = get_scope(&keyring, scope_id)?;
        let staged = scope.versions.get(1).ok_or_else(|| KsError::NoRotation(scope_id.to_string()))?;
        let staged_slot = slot(scope_id, &staged.id);
        let dropped = keyring.scopes.get_mut(scope_id).expect("checked above").versions.remove(1);
        let mut retired = self.reconcile(&mut keyring, &mut known, None, &mut lost)?;
        retired.extend(unreferenced(&keyring, presence_keys(dropped.wraps.iter())));
        self.finish(
            epoch,
            Some(keyring),
            lost,
            retired,
            Box::new(move |st| {
                st.keys.remove(&staged_slot);
            }),
        )
    }

    /// Key for an SQLCipher database of an unlocked scope.
    pub fn database_key(&self, scope_id: &str, label: &str, staged: bool) -> Result<Key32, KsError> {
        validate_label(label)?;
        let st = self.state();
        let keyring = st.keyring.as_ref().ok_or(KsError::NotInitialized)?;
        let scope = get_scope(keyring, scope_id)?;
        let version = if staged {
            scope.versions.get(1).ok_or_else(|| KsError::NoRotation(scope_id.to_string()))?
        } else {
            &scope.versions[0]
        };
        let key = st
            .keys
            .get(&slot(scope_id, &version.id))
            .ok_or_else(|| KsError::Locked(scope_id.to_string()))?;
        Ok(crypto::hkdf32(key.as_slice(), DOMAIN.as_bytes(), format!("{DOMAIN}|db|{scope_id}|{label}").as_bytes()))
    }

    /// Encrypts a credential field of an unlocked scope. `context` names the record and field
    /// (e.g. "profile:<id>:password") so a sealed value cannot be moved to another record.
    pub fn seal_field(&self, scope_id: &str, context: &str, plaintext: &[u8]) -> Result<String, KsError> {
        validate_context(context)?;
        if plaintext.len() > MAX_FIELD_BYTES {
            return Err(KsError::InvalidArgument("field is too large".into()));
        }
        let st = self.state();
        let field_key = st.field_keys.get(scope_id).ok_or_else(|| KsError::Locked(scope_id.to_string()))?;
        let sealed = crypto::seal(field_key, plaintext, &field_aad(scope_id, context));
        let mut raw = sealed.nonce.to_vec();
        raw.extend_from_slice(&sealed.ciphertext);
        Ok(format!("{FIELD_PREFIX}{}", STANDARD.encode(raw)))
    }

    /// Decrypts a field for use inside the main process (connecting). Not for display.
    pub fn open_field(&self, scope_id: &str, context: &str, sealed: &str) -> Result<Zeroizing<Vec<u8>>, KsError> {
        let st = self.state();
        let field_key = st.field_keys.get(scope_id).ok_or_else(|| KsError::Locked(scope_id.to_string()))?;
        open_sealed_field(field_key, scope_id, context, sealed)
    }

    pub fn is_sealed_field(value: &str) -> bool {
        value.starts_with(FIELD_PREFIX)
    }

    fn require_unlocked(&self, scope_id: &str) -> Result<(String, u64), KsError> {
        let st = self.state();
        let policy = Self::current_policy(&st).ok_or(KsError::NotInitialized)?;
        let keyring = st.keyring.as_ref().ok_or(KsError::NotInitialized)?;
        let domain = reveal_domain(&policy, keyring, scope_id)?;
        if !st.field_keys.contains_key(scope_id) {
            return Err(KsError::Locked(scope_id.to_string()));
        }
        Ok((domain, st.epoch))
    }

    fn start_reveal(&self, domain: String, epoch: u64) -> Result<(), KsError> {
        let mut st = self.state();
        if st.epoch != epoch {
            return Err(KsError::Cancelled);
        }
        let now = self.now();
        st.reveal.insert(domain, now);
        Ok(())
    }

    /// Starts a reveal session after the OS verified the user.
    pub fn open_reveal_with_presence(&self, scope_id: &str, reason: &str) -> Result<(), KsError> {
        let _op = self.op();
        let (domain, epoch) = self.require_unlocked(scope_id)?;
        self.device.verify_presence(reason)?;
        self.start_reveal(domain, epoch)
    }

    /// Starts a reveal session with the password that protects the scope (the master password
    /// when one is set). Unprotected scopes have no password and need the OS check instead.
    pub fn open_reveal_with_password(&self, scope_id: &str, password: &str) -> Result<(), KsError> {
        let _op = self.op();
        let (domain, epoch) = self.require_unlocked(scope_id)?;
        self.check_password(&domain, password)?;
        self.start_reveal(domain, epoch)
    }

    /// Checks the password that protects `scope_id` without changing what is unlocked.
    pub fn verify_password(&self, scope_id: &str, password: &str) -> Result<(), KsError> {
        let _op = self.op();
        let domain = {
            let st = self.state();
            let policy = Self::current_policy(&st).ok_or(KsError::NotInitialized)?;
            reveal_domain(&policy, st.keyring.as_ref().ok_or(KsError::NotInitialized)?, scope_id)?
        };
        self.check_password(&domain, password)
    }

    fn check_password(&self, password_scope: &str, password: &str) -> Result<(), KsError> {
        let password = normalize_password(password)?;
        self.check_rate_limit()?;
        let (keyring, _, _, _) = self.snapshot()?;
        let scope = get_scope(&keyring, password_scope)?;
        let current = Scope { versions: vec![scope.versions[0].clone()] };
        self.record_password_attempt(self.open_with_password(password_scope, &current, password.as_bytes()))
            .map(|_| ())
    }

    /// Decrypts a field for display. Needs an active reveal session; each reveal extends it.
    pub fn reveal_field(&self, scope_id: &str, context: &str, sealed: &str) -> Result<Zeroizing<Vec<u8>>, KsError> {
        let mut guard = self.state();
        let st = &mut *guard;
        let policy = Self::current_policy(st).ok_or(KsError::NotInitialized)?;
        let keyring = st.keyring.as_ref().ok_or(KsError::NotInitialized)?;
        let domain = reveal_domain(&policy, keyring, scope_id)?;
        let now = self.now();
        match st.reveal.get(&domain) {
            Some(last) if now.saturating_duration_since(*last) < REVEAL_IDLE => {}
            _ => {
                st.reveal.remove(&domain);
                return Err(KsError::RevealLocked);
            }
        }
        let field_key = st.field_keys.get(scope_id).ok_or_else(|| KsError::Locked(scope_id.to_string()))?;
        let value = open_sealed_field(field_key, scope_id, context, sealed)?;
        st.reveal.insert(domain, now);
        Ok(value)
    }

    pub fn close_reveal(&self) {
        self.state().reveal.clear();
    }

    /// OS verification for sensitive actions, one prompt at a time.
    pub fn verify_presence(&self, reason: &str) -> Result<(), KsError> {
        let _op = self.op();
        self.device.verify_presence(reason)
    }

    /// The current version of an unlocked scope with its key, keeping only password routes.
    /// Refused while a rotation is staged (the database would be on the other key).
    pub fn export_scope(&self, scope_id: &str) -> Result<ScopeExport, KsError> {
        let st = self.state();
        let keyring = st.keyring.as_ref().ok_or(KsError::NotInitialized)?;
        let scope = get_scope(keyring, scope_id)?;
        if scope.versions.len() > 1 {
            return Err(KsError::RotationPending(scope_id.to_string()));
        }
        let mut version = scope.versions[0].clone();
        let key = st.keys.get(&slot(scope_id, &version.id)).cloned().ok_or_else(|| KsError::Locked(scope_id.to_string()))?;
        version.wraps.retain(Wrap::is_password);
        Ok(ScopeExport { scope_id: scope_id.to_string(), key, version })
    }

    /// First run from an export bundle: a keyring holding exactly the exported versions. The
    /// policy then adds this computer's routes: the quiet device key for unprotected scopes and
    /// parent routes under a master password. Database and field keys stay what they were, so the
    /// exported databases open unchanged and existing passwords keep working.
    pub fn initialize_from_export(&self, scopes: Vec<ScopeExport>) -> Result<(), KsError> {
        let _op = self.op();
        let epoch = {
            let st = self.state();
            if st.keyring.is_some() {
                return Err(KsError::AlreadyInitialized);
            }
            st.epoch
        };
        if fs_exists(&self.path) {
            return Err(KsError::AlreadyInitialized);
        }
        if !scopes.iter().any(|s| s.scope_id == APP) {
            return Err(KsError::InvalidArgument("the export has no app scope".into()));
        }
        let mut keyring = Keyring::new();
        let mut known = KeyMap::new();
        let mut field_keys = Vec::new();
        for export in scopes {
            let ScopeExport { scope_id, key, version } = export;
            if scope_id != APP && !keyring::is_valid_scope_id(&scope_id) {
                return Err(KsError::InvalidArgument("invalid scope id in the export".into()));
            }
            if keyring.scopes.contains_key(&scope_id) {
                return Err(KsError::InvalidArgument(format!("{scope_id} appears twice in the export")));
            }
            if version.wraps.iter().any(|w| !w.is_password()) {
                return Err(KsError::InvalidArgument("exported versions carry password routes only".into()));
            }
            if !crypto::ct_eq(&crypto::key_check(&key, &check_context(&scope_id, &version.id)), &version.check.0) {
                return Err(KsError::Corrupt(format!("{scope_id}: the exported key does not match its version")));
            }
            let field_key = crypto::open_key(&key, &version.field_key.nonce.0, &version.field_key.ciphertext.0, &field_key_aad(&scope_id, &version.id))
                .map_err(|_| KsError::Corrupt(format!("{scope_id}: the field key does not open")))?;
            known.insert(slot(&scope_id, &version.id), key);
            field_keys.push((scope_id.clone(), field_key));
            keyring.scopes.insert(scope_id, Scope { versions: vec![version] });
        }
        let mut lost = false;
        let retired = self.reconcile(&mut keyring, &mut known, None, &mut lost)?;
        keyring::validate(&keyring)?;
        self.finish(
            epoch,
            Some(keyring),
            lost,
            retired,
            Box::new(move |st| {
                st.keys.extend(known);
                st.field_keys.extend(field_keys);
            }),
        )
    }

    /// Creates a throwaway quiet device key, runs a full encapsulate / decapsulate round trip
    /// (never prompts), deletes the key and returns the backend name. For startup checks and
    /// diagnostics; touches no keyring.
    pub fn probe_device(&self) -> Result<String, KsError> {
        let key = self.device.create_quiet_key()?;
        let info = format!("{DOMAIN}|probe").into_bytes();
        let result = (|| {
            let (kek, blob) = self.device.encapsulate(&key, &info, "")?;
            let recovered = self.device.decapsulate(&key, &blob, &info, "")?;
            if !crypto::ct_eq(kek.as_slice(), recovered.as_slice()) || !self.device.key_usable(&key)? {
                return Err(KsError::Unavailable("the device key did not round-trip".into()));
            }
            Ok(key.backend.clone())
        })();
        self.device.delete_key(&key);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::fake::FakeDevice;
    use std::sync::atomic::Ordering;

    const FAST: Argon2Params = Argon2Params { m_kib: 8 * 1024, t: 1, p: 1 };

    struct Env {
        dir: PathBuf,
        machine: [u8; 32],
        clock: Arc<Mutex<Instant>>,
    }

    impl Env {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("gk-store-{}", crypto::random_id()));
            std::fs::create_dir_all(&dir).unwrap();
            Env { dir, machine: crypto::random_array(), clock: Arc::new(Mutex::new(Instant::now())) }
        }

        fn path(&self) -> PathBuf {
            self.dir.join("keyring.json")
        }

        /// A fresh process on the same machine.
        fn open(&self) -> Keystore<FakeDevice> {
            self.open_on(self.machine)
        }

        fn open_on(&self, machine: [u8; 32]) -> Keystore<FakeDevice> {
            let clock = self.clock.clone();
            Keystore::with_options(FakeDevice::new(machine), self.path(), FAST, Arc::new(move || *clock.lock().unwrap())).unwrap()
        }

        fn advance(&self, by: Duration) {
            *self.clock.lock().unwrap() += by;
        }

        fn keyring(&self) -> Keyring {
            keyring::load(&self.path()).unwrap().unwrap()
        }
    }

    impl Drop for Env {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn scope_status(ks: &Keystore<FakeDevice>, id: &str) -> ScopeStatus {
        ks.status().scopes.into_iter().find(|s| s.id == id).unwrap()
    }

    fn db(ks: &Keystore<FakeDevice>, scope: &str) -> [u8; 32] {
        *ks.database_key(scope, "database", false).unwrap()
    }

    fn kinds(env: &Env, scope: &str) -> Vec<String> {
        let keyring = env.keyring();
        let policy = Policy::build(&keyring, &KeyMap::new());
        let mut kinds: Vec<String> = keyring.scopes[scope].versions[0]
            .wraps
            .iter()
            .map(|w| match w {
                Wrap::Device { .. } if policy.is_quiet(w) => "quiet".to_string(),
                Wrap::Device { .. } => "stale-device".to_string(),
                Wrap::Presence { .. } => "presence".to_string(),
                Wrap::Password { .. } => "password".to_string(),
                Wrap::Parent { .. } => "parent".to_string(),
                Wrap::Recovery { .. } => "recovery".to_string(),
            })
            .collect();
        kinds.sort();
        kinds
    }

    /// Every version of every scope keeps at least one route, and protected scopes have no quiet
    /// route and no parent route without a master password.
    fn assert_invariants(env: &Env) {
        let keyring = env.keyring();
        let policy = Policy::build(&keyring, &KeyMap::new());
        for (id, scope) in &keyring.scopes {
            for version in &scope.versions {
                assert!(!version.wraps.is_empty(), "{id} has no route");
                if policy.protected(id) {
                    assert!(!version.wraps.iter().any(|w| policy.is_quiet(w)), "{id} is protected but has a quiet route");
                }
                if !policy.app().value {
                    assert!(!version.wraps.iter().any(|w| matches!(w, Wrap::Parent { .. })), "{id} has a parent route without a master password");
                }
                if !has_password_route(scope) {
                    assert!(!version.wraps.iter().any(|w| matches!(w, Wrap::Presence { .. })), "{id} has a presence route without a password");
                }
            }
        }
    }

    #[test]
    fn without_passwords_everything_opens_quietly_and_survives_restarts() {
        let env = Env::new();
        let ks = env.open();
        assert!(!ks.status().initialized);
        ks.initialize().unwrap();
        assert_eq!(ks.initialize(), Err(KsError::AlreadyInitialized));
        ks.create_scope("ws:default", None).unwrap();
        let (app_db, ws_db) = (db(&ks, APP), db(&ks, "ws:default"));
        assert_ne!(app_db, ws_db);
        assert_eq!(kinds(&env, APP), ["quiet"]);
        assert_eq!(kinds(&env, "ws:default"), ["quiet"]);

        let ks = env.open();
        assert_eq!(ks.database_key(APP, "database", false), Err(KsError::Locked(APP.into())));
        ks.open_scope(APP).unwrap();
        ks.open_scope("ws:default").unwrap();
        assert_eq!(db(&ks, APP), app_db);
        assert_eq!(db(&ks, "ws:default"), ws_db);
        assert_eq!(ks.device().prompts(), 0);
        assert!(!ks.status().app_protected);
        assert_invariants(&env);
    }

    #[test]
    fn a_copied_keyring_does_not_open_on_another_machine() {
        let env = Env::new();
        env.open().initialize().unwrap();
        let elsewhere = env.open_on(crypto::random_array());
        assert_eq!(elsewhere.open_scope(APP), Err(KsError::DeviceKeyLost));
        assert!(elsewhere.status().device_key_lost);
    }

    #[test]
    fn a_workspace_password_protects_only_that_workspace() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:default", None).unwrap();
        ks.create_scope("ws:a", None).unwrap();
        let a_db = db(&ks, "ws:a");
        let staged = ks.set_password("ws:a", "correct horse").unwrap();
        assert_eq!(staged, ["ws:a"]);
        let staged_db = *ks.database_key("ws:a", "database", true).unwrap();
        assert_ne!(staged_db, a_db, "protecting a workspace rotates its key");
        ks.commit_rotation("ws:a").unwrap();
        assert_eq!(db(&ks, "ws:a"), staged_db);
        assert_eq!(kinds(&env, "ws:a"), ["password"]);

        let ks = env.open();
        ks.open_scope(APP).unwrap();
        ks.open_scope("ws:default").unwrap();
        assert_eq!(ks.open_scope("ws:a"), Err(KsError::Locked("ws:a".into())));
        assert_eq!(ks.unlock_with_password("ws:a", "wrong horse"), Err(KsError::WrongPassword));
        ks.unlock_with_password("ws:a", "correct horse").unwrap();
        assert_eq!(db(&ks, "ws:a"), staged_db);
        assert!(!ks.status().app_protected);
        assert!(scope_status(&ks, "ws:a").protected);
        assert!(!scope_status(&ks, "ws:default").protected);

        ks.lock_protected();
        assert_eq!(ks.database_key("ws:a", "database", false), Err(KsError::Locked("ws:a".into())));
        assert!(ks.database_key("ws:default", "database", false).is_ok(), "unprotected scopes stay open");
        assert_invariants(&env);
    }

    #[test]
    fn a_master_password_covers_every_workspace_with_one_unlock() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:default", None).unwrap();
        ks.create_scope("ws:own", Some("workspace-pw")).unwrap();
        let mut staged = ks.set_password(APP, "master-password").unwrap();
        staged.sort();
        assert_eq!(staged, [APP, "ws:default"], "ws:own was already protected");
        for scope in &staged {
            ks.commit_rotation(scope).unwrap();
        }
        let (app_db, default_db, own_db) = (db(&ks, APP), db(&ks, "ws:default"), db(&ks, "ws:own"));
        assert_eq!(kinds(&env, APP), ["password"]);
        assert_eq!(kinds(&env, "ws:default"), ["parent"]);
        assert_eq!(kinds(&env, "ws:own"), ["parent", "password"]);
        assert_invariants(&env);

        let ks = env.open();
        assert_eq!(ks.open_scope(APP), Err(KsError::Locked(APP.into())));
        assert_eq!(ks.open_scope("ws:default"), Err(KsError::Locked("ws:default".into())));
        ks.unlock_with_password(APP, "master-password").unwrap();
        ks.open_scope("ws:default").unwrap();
        ks.open_scope("ws:own").unwrap();
        assert_eq!((db(&ks, APP), db(&ks, "ws:default"), db(&ks, "ws:own")), (app_db, default_db, own_db));
        assert_eq!(ks.device().prompts(), 0);

        ks.lock_protected();
        for scope in [APP, "ws:default", "ws:own"] {
            assert_eq!(ks.database_key(scope, "database", false), Err(KsError::Locked(scope.into())));
        }
    }

    #[test]
    fn a_workspace_locked_while_the_master_password_is_set_joins_on_its_next_unlock() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:own", Some("workspace-pw")).unwrap();
        drop(ks);

        let ks = env.open();
        ks.open_scope(APP).unwrap();
        for scope in ks.set_password(APP, "master-password").unwrap() {
            ks.commit_rotation(&scope).unwrap();
        }
        assert_eq!(kinds(&env, "ws:own"), ["password"], "locked: no parent route yet");

        let ks = env.open();
        ks.unlock_with_password(APP, "master-password").unwrap();
        assert_eq!(ks.open_scope("ws:own"), Err(KsError::Locked("ws:own".into())));
        ks.unlock_with_password("ws:own", "workspace-pw").unwrap();
        assert_eq!(kinds(&env, "ws:own"), ["parent", "password"]);

        let ks = env.open();
        ks.unlock_with_password(APP, "master-password").unwrap();
        ks.open_scope("ws:own").unwrap();
        assert_invariants(&env);
    }

    #[test]
    fn removing_the_master_password_restores_quiet_routes_but_keeps_workspace_passwords() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:default", None).unwrap();
        ks.create_scope("ws:own", Some("workspace-pw")).unwrap();
        for scope in ks.set_password(APP, "master-password").unwrap() {
            ks.commit_rotation(&scope).unwrap();
        }
        let ks = env.open();
        ks.unlock_with_password(APP, "master-password").unwrap();
        for staged in ks.remove_password(APP).unwrap() {
            ks.commit_rotation(&staged).unwrap();
        }
        assert_eq!(kinds(&env, APP), ["quiet"]);
        assert_eq!(kinds(&env, "ws:default"), ["quiet"]);
        assert_eq!(kinds(&env, "ws:own"), ["password"]);
        assert_invariants(&env);

        let ks = env.open();
        ks.open_scope(APP).unwrap();
        ks.open_scope("ws:default").unwrap();
        assert_eq!(ks.open_scope("ws:own"), Err(KsError::Locked("ws:own".into())));
        ks.unlock_with_password("ws:own", "workspace-pw").unwrap();
    }

    #[test]
    fn setting_the_master_password_fails_closed_when_a_workspace_cannot_be_opened() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:default", None).unwrap();
        let before = env.keyring();
        let ks = env.open();
        ks.open_scope(APP).unwrap();
        ks.device().quiet_unavailable.store(true, Ordering::SeqCst);
        assert!(matches!(ks.set_password(APP, "master-password"), Err(KsError::Unavailable(_))));
        assert_eq!(env.keyring(), before, "nothing changed");
    }

    #[test]
    fn removing_a_workspace_password_needs_the_workspace_unlocked() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", Some("workspace-pw")).unwrap();
        let ks = env.open();
        ks.open_scope(APP).unwrap();
        assert_eq!(ks.remove_password("ws:a"), Err(KsError::Locked("ws:a".into())));
        assert_eq!(ks.set_password("ws:a", "another-pw"), Err(KsError::Locked("ws:a".into())));
        ks.unlock_with_password("ws:a", "workspace-pw").unwrap();
        for staged in ks.remove_password("ws:a").unwrap() {
            ks.commit_rotation(&staged).unwrap();
        }
        assert_eq!(kinds(&env, "ws:a"), ["quiet"]);
        assert_eq!(ks.remove_password("ws:a"), Err(KsError::NoPassword("ws:a".into())));
    }

    #[test]
    fn changing_a_password_revokes_the_old_one() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", Some("first-password")).unwrap();
        assert_eq!(ks.set_password("ws:a", "second-password").unwrap(), Vec::<String>::new(), "no rotation for a change");
        let ks = env.open();
        assert_eq!(ks.unlock_with_password("ws:a", "first-password"), Err(KsError::WrongPassword));
        ks.unlock_with_password("ws:a", "second-password").unwrap();
    }

    #[test]
    fn migrated_workspaces_keep_short_legacy_passwords() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        assert!(matches!(ks.create_scope("ws:old", Some("abc")), Err(KsError::InvalidArgument(_))));
        ks.create_scope_with_legacy_password("ws:old", "abc").unwrap();
        assert!(matches!(ks.create_scope_with_legacy_password("ws:empty", ""), Err(KsError::InvalidArgument(_))));
        let ks = env.open();
        ks.unlock_with_password("ws:old", "abc").unwrap();
        assert!(matches!(ks.set_password("ws:old", "abcd"), Err(KsError::InvalidArgument(_))), "new passwords follow the rules");
    }

    #[test]
    fn passwords_are_normalized_and_validated() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        assert!(matches!(ks.create_scope("ws:a", Some("short")), Err(KsError::InvalidArgument(_))));
        // "é" precomposed at creation, decomposed when typed.
        ks.create_scope("ws:a", Some("caf\u{e9}-password")).unwrap();
        let ks = env.open();
        ks.unlock_with_password("ws:a", "cafe\u{301}-password").unwrap();
    }

    #[test]
    fn master_passwords_need_twelve_characters() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", Some("8-chars!")).unwrap();
        assert!(matches!(ks.set_password(APP, "eleven-char"), Err(KsError::InvalidArgument(_))));
        // Counted in characters, not bytes: 11 CJK characters are 33 bytes and still too short.
        assert!(matches!(ks.set_password(APP, "主密码主密码主密码主密"), Err(KsError::InvalidArgument(_))));
        for scope in ks.set_password(APP, "twelve-chars").unwrap() {
            ks.commit_rotation(&scope).unwrap();
        }
        let ks = env.open();
        ks.unlock_with_password(APP, "twelve-chars").unwrap();
    }

    #[test]
    fn wrong_passwords_are_rate_limited() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", Some("workspace-pw")).unwrap();
        let ks = env.open();
        for _ in 0..FREE_PASSWORD_FAILURES + 1 {
            assert_eq!(ks.unlock_with_password("ws:a", "nope-nope"), Err(KsError::WrongPassword));
        }
        assert!(matches!(ks.unlock_with_password("ws:a", "workspace-pw"), Err(KsError::RateLimited(_))));
        env.advance(Duration::from_secs(2));
        ks.unlock_with_password("ws:a", "workspace-pw").unwrap();
        assert_eq!(ks.unlock_with_password("ws:a", "nope-nope"), Err(KsError::WrongPassword));
        ks.unlock_with_password("ws:a", "workspace-pw").unwrap();
    }

    #[test]
    fn presence_unlocks_protected_scopes_and_honours_cancel() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        assert_eq!(ks.enable_presence(APP, "r"), Err(KsError::NoPassword(APP.into())));
        for scope in ks.set_password(APP, "master-password").unwrap() {
            ks.commit_rotation(&scope).unwrap();
        }
        ks.enable_presence(APP, "r").unwrap();
        assert_eq!(kinds(&env, APP), ["password", "presence"]);
        assert!(scope_status(&ks, APP).presence);

        let ks = env.open();
        ks.device().cancel_next.store(true, Ordering::SeqCst);
        assert_eq!(ks.unlock_with_presence(APP, "unlock"), Err(KsError::Cancelled));
        ks.unlock_with_presence(APP, "unlock").unwrap();
        assert_eq!(ks.device().prompts(), 2);

        let presence_id = env.keyring().scopes[APP].versions[0].wraps.iter().find_map(|w| w.presence_key().map(|k| k.id.clone())).unwrap();
        for staged in ks.remove_password(APP).unwrap() {
            ks.commit_rotation(&staged).unwrap();
        }
        assert_eq!(kinds(&env, APP), ["quiet"]);
        assert!(ks.device().deleted.lock().unwrap().contains(&presence_id), "the scope's presence key is deleted");
        assert_invariants(&env);
    }

    #[test]
    fn recovery_opens_everything_and_moves_to_a_new_machine() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:default", None).unwrap();
        ks.create_scope("ws:own", Some("workspace-pw")).unwrap();
        let code = ks.setup_recovery().unwrap().to_string();
        let dbs = (db(&ks, APP), db(&ks, "ws:default"));
        assert!(kinds(&env, "ws:default").contains(&"recovery".to_string()));
        assert!(!kinds(&env, "ws:own").contains(&"recovery".to_string()), "no master password: its own password only");

        let new_machine = env.open_on(crypto::random_array());
        assert_eq!(new_machine.open_scope(APP), Err(KsError::DeviceKeyLost));
        assert_eq!(
            new_machine.unlock_with_recovery(&RecoveryCode::generate().display()),
            Err(KsError::InvalidRecoveryCode)
        );
        assert_eq!(new_machine.unlock_with_recovery("not a code"), Err(KsError::InvalidRecoveryCode));
        let mut opened = new_machine.unlock_with_recovery(&code.to_lowercase()).unwrap();
        opened.sort();
        assert_eq!(opened, [APP, "ws:default"]);
        assert_eq!((db(&new_machine, APP), db(&new_machine, "ws:default")), dbs);
        new_machine.unlock_with_password("ws:own", "workspace-pw").unwrap();
        assert_invariants(&env);

        // The new machine's device key now opens the unprotected scopes without the code.
        let machine = env.keyring().quiet_device.unwrap().params["machine"].clone();
        let next_start = {
            let clock = env.clock.clone();
            let device = FakeDevice::new(crypto::random_array());
            let _ = machine;
            Keystore::with_options(device, env.path(), FAST, Arc::new(move || *clock.lock().unwrap())).unwrap()
        };
        // (a third machine still cannot)
        assert_eq!(next_start.open_scope(APP), Err(KsError::DeviceKeyLost));
    }

    #[test]
    fn recovery_survives_a_restart_on_the_new_machine() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        let code = ks.setup_recovery().unwrap().to_string();
        let new_machine: [u8; 32] = crypto::random_array();
        let ks = env.open_on(new_machine);
        ks.unlock_with_recovery(&code).unwrap();
        let ks = env.open_on(new_machine);
        ks.open_scope(APP).unwrap();
        assert!(!ks.status().device_key_lost);
    }

    #[test]
    fn removing_the_master_password_on_a_new_machine_uses_a_key_from_that_machine() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:default", None).unwrap();
        for scope in ks.set_password(APP, "master-password").unwrap() {
            ks.commit_rotation(&scope).unwrap();
        }
        let new_machine: [u8; 32] = crypto::random_array();
        let ks = env.open_on(new_machine);
        ks.unlock_with_password(APP, "master-password").unwrap();
        ks.open_scope("ws:default").unwrap();
        for staged in ks.remove_password(APP).unwrap() {
            ks.commit_rotation(&staged).unwrap();
        }
        let ks = env.open_on(new_machine);
        ks.open_scope(APP).unwrap();
        ks.open_scope("ws:default").unwrap();
        assert_invariants(&env);
    }

    #[test]
    fn rotating_the_recovery_code_revokes_the_old_one() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", None).unwrap();
        let old = ks.setup_recovery().unwrap().to_string();
        let new = ks.setup_recovery().unwrap().to_string();
        assert_ne!(old, new);
        let ks = env.open();
        assert_eq!(ks.unlock_with_recovery(&old), Err(KsError::InvalidRecoveryCode));
        assert_eq!(ks.unlock_with_recovery(&new).unwrap().len(), 2);
        ks.remove_recovery().unwrap();
        assert!(!kinds(&env, APP).contains(&"recovery".to_string()));
        let ks = env.open();
        assert_eq!(ks.unlock_with_recovery(&new), Err(KsError::InvalidRecoveryCode));
    }

    #[test]
    fn recovery_resets_a_forgotten_master_password() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:default", None).unwrap();
        for scope in ks.set_password(APP, "master-password").unwrap() {
            ks.commit_rotation(&scope).unwrap();
        }
        let code = ks.setup_recovery().unwrap().to_string();
        let ks = env.open();
        ks.unlock_with_recovery(&code).unwrap();
        ks.set_password(APP, "new-master-password").unwrap();
        let ks = env.open();
        assert_eq!(ks.unlock_with_password(APP, "master-password"), Err(KsError::WrongPassword));
        ks.unlock_with_password(APP, "new-master-password").unwrap();
        ks.open_scope("ws:default").unwrap();
    }

    #[test]
    fn an_interrupted_rotation_keeps_both_keys_until_committed() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", None).unwrap();
        let old_db = db(&ks, "ws:a");
        ks.set_password("ws:a", "workspace-pw").unwrap();
        let new_db = *ks.database_key("ws:a", "database", true).unwrap();
        drop(ks); // crash before the database was rekeyed

        let ks = env.open();
        ks.unlock_with_password("ws:a", "workspace-pw").unwrap();
        assert!(scope_status(&ks, "ws:a").staged);
        assert_eq!(db(&ks, "ws:a"), old_db);
        assert_eq!(*ks.database_key("ws:a", "database", true).unwrap(), new_db);
        assert_eq!(ks.set_password("ws:a", "other-password"), Err(KsError::RotationPending("ws:a".into())));
        ks.commit_rotation("ws:a").unwrap();
        assert_eq!(db(&ks, "ws:a"), new_db);
        assert_eq!(ks.commit_rotation("ws:a"), Err(KsError::NoRotation("ws:a".into())));
        assert_invariants(&env);
    }

    #[test]
    fn master_rotation_keeps_workspaces_reachable_through_the_new_app_key() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:b", None).unwrap();
        let staged = ks.set_password(APP, "master-password").unwrap();
        // Commit the app first, then the workspace, as the main process may in either order.
        ks.commit_rotation(APP).unwrap();
        let ks2 = env.open();
        ks2.unlock_with_password(APP, "master-password").unwrap();
        ks2.open_scope("ws:b").unwrap();
        assert!(scope_status(&ks2, "ws:b").staged);
        drop(ks2);
        for scope in staged.iter().filter(|s| *s != APP) {
            ks.commit_rotation(scope).unwrap();
        }
        let ks = env.open();
        ks.unlock_with_password(APP, "master-password").unwrap();
        ks.open_scope("ws:b").unwrap();
        assert_invariants(&env);
        assert_eq!(kinds(&env, "ws:b"), ["parent"]);
    }

    #[test]
    fn an_old_keyring_copy_does_not_open_data_protected_later() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        let before = std::fs::read(env.path()).unwrap();
        for scope in ks.set_password(APP, "master-password").unwrap() {
            ks.commit_rotation(&scope).unwrap();
        }
        let protected_db = db(&ks, APP);
        let after = std::fs::read(env.path()).unwrap();
        std::fs::write(env.path(), &before).unwrap();
        let attacker = env.open();
        attacker.open_scope(APP).unwrap();
        assert_ne!(db(&attacker, APP), protected_db);
        std::fs::write(env.path(), after).unwrap();
    }

    #[test]
    fn fields_are_bound_to_scope_and_context_and_reveal_needs_a_session() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", None).unwrap();
        let sealed = ks.seal_field("ws:a", "profile:1:password", "hunter2".as_bytes()).unwrap();
        assert!(Keystore::<FakeDevice>::is_sealed_field(&sealed));
        assert_eq!(ks.open_field("ws:a", "profile:1:password", &sealed).unwrap().as_slice(), b"hunter2");
        assert!(ks.open_field("ws:a", "profile:2:password", &sealed).is_err());
        assert!(ks.open_field(APP, "profile:1:password", &sealed).is_err());

        assert_eq!(ks.reveal_field("ws:a", "profile:1:password", &sealed), Err(KsError::RevealLocked));
        assert_eq!(ks.open_reveal_with_password("ws:a", "anything"), Err(KsError::NoPassword(APP.into())));
        ks.device().cancel_next.store(true, Ordering::SeqCst);
        assert_eq!(ks.open_reveal_with_presence("ws:a", "show"), Err(KsError::Cancelled));
        ks.open_reveal_with_presence("ws:a", "show").unwrap();
        assert!(scope_status(&ks, "ws:a").reveal_remaining_ms.is_some());
        env.advance(Duration::from_secs(4 * 60));
        assert_eq!(ks.reveal_field("ws:a", "profile:1:password", &sealed).unwrap().as_slice(), b"hunter2");
        env.advance(Duration::from_secs(4 * 60));
        ks.reveal_field("ws:a", "profile:1:password", &sealed).expect("each reveal extends the session");
        env.advance(REVEAL_IDLE);
        assert_eq!(ks.reveal_field("ws:a", "profile:1:password", &sealed), Err(KsError::RevealLocked));

        ks.open_reveal_with_presence("ws:a", "show").unwrap();
        ks.close_reveal();
        assert_eq!(ks.reveal_field("ws:a", "profile:1:password", &sealed), Err(KsError::RevealLocked));

        let ks = env.open();
        assert_eq!(ks.seal_field("ws:a", "x", b"y"), Err(KsError::Locked("ws:a".into())));
        ks.open_scope("ws:a").unwrap();
        assert_eq!(ks.open_field("ws:a", "profile:1:password", &sealed).unwrap().as_slice(), b"hunter2");
    }

    #[test]
    fn sealed_fields_survive_key_rotation() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", None).unwrap();
        let sealed = ks.seal_field("ws:a", "ctx", b"secret").unwrap();
        ks.set_password("ws:a", "workspace-pw").unwrap();
        ks.commit_rotation("ws:a").unwrap();
        let ks = env.open();
        ks.unlock_with_password("ws:a", "workspace-pw").unwrap();
        assert_eq!(ks.open_field("ws:a", "ctx", &sealed).unwrap().as_slice(), b"secret");
    }

    #[test]
    fn reveal_domains_follow_the_master_password() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", Some("workspace-pw")).unwrap();
        ks.create_scope("ws:b", None).unwrap();
        let a = ks.seal_field("ws:a", "ctx", b"a").unwrap();
        let b = ks.seal_field("ws:b", "ctx", b"b").unwrap();
        // No master password: ws:a has its own session, opened with its own password.
        assert_eq!(ks.open_reveal_with_password("ws:a", "wrong-password"), Err(KsError::WrongPassword));
        ks.open_reveal_with_password("ws:a", "workspace-pw").unwrap();
        ks.reveal_field("ws:a", "ctx", &a).unwrap();
        assert_eq!(ks.reveal_field("ws:b", "ctx", &b), Err(KsError::RevealLocked));
        ks.close_reveal();
        // With a master password, one session covers every scope.
        for scope in ks.set_password(APP, "master-password").unwrap() {
            ks.commit_rotation(&scope).unwrap();
        }
        assert_eq!(ks.open_reveal_with_password("ws:a", "workspace-pw"), Err(KsError::WrongPassword));
        ks.open_reveal_with_password("ws:b", "master-password").unwrap();
        ks.reveal_field("ws:a", "ctx", &a).unwrap();
        ks.reveal_field("ws:b", "ctx", &b).unwrap();
        ks.lock_protected();
        assert_eq!(ks.reveal_field("ws:b", "ctx", &b), Err(KsError::RevealLocked));
    }

    #[test]
    fn tampered_keyrings_fail_closed() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", Some("workspace-pw")).unwrap();
        ks.create_scope("ws:b", Some("workspace-pw")).unwrap();

        // Moving a's password route onto b does not open b.
        let mut keyring = env.keyring();
        let a_wrap = keyring.scopes["ws:a"].versions[0].wraps[0].clone();
        keyring.scopes.get_mut("ws:b").unwrap().versions[0].wraps = vec![a_wrap];
        keyring::save(&env.path(), &keyring).unwrap();
        let ks = env.open();
        assert_eq!(ks.unlock_with_password("ws:b", "workspace-pw"), Err(KsError::WrongPassword));

        // A flipped ciphertext bit does not open either.
        let mut keyring = env.keyring();
        if let Wrap::Password { sealed, .. } = &mut keyring.scopes.get_mut("ws:a").unwrap().versions[0].wraps[0] {
            sealed.ciphertext.0[0] ^= 1;
        }
        keyring::save(&env.path(), &keyring).unwrap();
        let ks = env.open();
        assert_eq!(ks.unlock_with_password("ws:a", "workspace-pw"), Err(KsError::WrongPassword));

        std::fs::write(env.path(), b"{not json").unwrap();
        assert!(matches!(
            Keystore::with_options(FakeDevice::new(env.machine), env.path(), FAST, Arc::new(Instant::now)),
            Err(KsError::Corrupt(_))
        ));
    }

    #[test]
    fn a_lock_during_an_unlock_wins() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", Some("workspace-pw")).unwrap();
        let ks = Arc::new(env.open());
        let (epoch, lost) = {
            let st = ks.state();
            (st.epoch, st.quiet_device_lost)
        };
        ks.lock_protected();
        // An unlock that started before the lock must not install its keys afterwards.
        assert_eq!(
            ks.finish(epoch, None, lost, Vec::new(), Box::new(|st| st.keys.insert(slot("ws:a", "v"), crypto::random_key()).map(|_| ()).unwrap_or(()))),
            Err(KsError::Cancelled)
        );
        assert!(ks.state().keys.is_empty());
    }

    #[test]
    fn deleting_a_scope_forgets_it() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", None).unwrap();
        assert_eq!(ks.create_scope("ws:a", None), Err(KsError::ScopeExists("ws:a".into())));
        ks.delete_scope("ws:a").unwrap();
        assert_eq!(ks.open_scope("ws:a"), Err(KsError::UnknownScope("ws:a".into())));
        assert!(matches!(ks.delete_scope(APP), Err(KsError::InvalidArgument(_))));
        assert!(matches!(ks.create_scope("ws:a|b", None), Err(KsError::InvalidArgument(_))));
    }

    #[test]
    fn creating_a_workspace_under_a_locked_master_password_is_refused() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        for scope in ks.set_password(APP, "master-password").unwrap() {
            ks.commit_rotation(&scope).unwrap();
        }
        let ks = env.open();
        assert_eq!(ks.create_scope("ws:new", None), Err(KsError::Locked(APP.into())));
        ks.unlock_with_password(APP, "master-password").unwrap();
        ks.create_scope("ws:new", None).unwrap();
        assert_eq!(kinds(&env, "ws:new"), ["parent"]);
    }

    #[test]
    fn the_device_probe_round_trips_and_cleans_up() {
        let env = Env::new();
        let ks = env.open();
        assert_eq!(ks.probe_device().unwrap(), "fake-quiet");
        assert_eq!(ks.device().deleted.lock().unwrap().len(), 1);
        assert!(!env.path().exists(), "the probe touches no keyring");
        ks.device().quiet_unavailable.store(true, Ordering::SeqCst);
        assert!(ks.probe_device().is_err());
    }

    #[test]
    fn labels_derive_independent_database_keys() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        let a = *ks.database_key(APP, "database", false).unwrap();
        let b = *ks.database_key(APP, "memory", false).unwrap();
        assert_ne!(a, b);
        assert!(ks.database_key(APP, "Bad Label", false).is_err());
        assert_eq!(ks.database_key(APP, "database", true), Err(KsError::NoRotation(APP.into())));
    }

    fn set_master(ks: &Keystore<FakeDevice>, password: &str) {
        for scope in ks.set_password(APP, password).unwrap() {
            ks.commit_rotation(&scope).unwrap();
        }
    }

    #[test]
    fn deleting_the_password_route_from_the_file_does_not_unprotect_anything() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:default", None).unwrap();
        set_master(&ks, "master-password");
        ks.enable_presence(APP, "r").unwrap();

        let mut keyring = env.keyring();
        keyring.scopes.get_mut(APP).unwrap().versions[0].wraps.retain(|w| !w.is_password());
        keyring::save(&env.path(), &keyring).unwrap();

        let ks = env.open();
        assert!(ks.open_scope(APP).is_err());
        ks.unlock_with_presence(APP, "unlock").unwrap();
        ks.open_scope("ws:default").unwrap();
        assert!(ks.status().app_protected, "the sealed record still says protected");
        ks.remove_password("ws:default").unwrap_err();
        assert_eq!(kinds(&env, APP), ["presence"]);
        assert_eq!(kinds(&env, "ws:default"), ["parent"]);
        // Even an explicit request elsewhere keeps protection: a new workspace goes under the master.
        ks.create_scope("ws:new", None).unwrap();
        assert_eq!(kinds(&env, "ws:new"), ["parent"]);
    }

    #[test]
    fn a_planted_password_route_does_not_lock_an_unprotected_scope() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", Some("workspace-pw")).unwrap();
        ks.create_scope("ws:b", None).unwrap();
        let mut keyring = env.keyring();
        let planted = keyring.scopes["ws:a"].versions[0].wraps.iter().find(|w| w.is_password()).unwrap().clone();
        keyring.scopes.get_mut("ws:b").unwrap().versions[0].wraps.push(planted);
        keyring::save(&env.path(), &keyring).unwrap();
        let ks = env.open();
        ks.open_scope("ws:b").unwrap();
        assert_eq!(kinds(&env, "ws:b"), ["quiet"], "the foreign route was cleaned up on unlock");
    }

    #[test]
    fn a_replaced_recovery_key_is_ignored_under_a_master_password() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", None).unwrap();
        set_master(&ks, "master-password");
        ks.setup_recovery().unwrap();

        let attacker = RecoveryCode::generate();
        let public_key = attacker.public_key();
        let mut keyring = env.keyring();
        keyring.recovery = Some(RecoveryInfo {
            id: recovery::recovery_id(&public_key),
            public_key: B64(public_key.to_vec()),
            mac: B64(vec![0; 32]),
        });
        keyring::save(&env.path(), &keyring).unwrap();

        let ks = env.open();
        ks.unlock_with_password(APP, "master-password").unwrap();
        ks.open_scope("ws:a").unwrap();
        let keyring = env.keyring();
        for scope in keyring.scopes.values() {
            assert!(!scope.versions[0].wraps.iter().any(|w| matches!(w, Wrap::Recovery { .. })), "no route for the planted key");
        }
        assert_eq!(env.open().unlock_with_recovery(&attacker.display()), Err(KsError::InvalidRecoveryCode));
    }

    #[test]
    fn without_a_master_password_the_recovery_code_never_covers_own_password_workspaces() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:own", Some("workspace-pw")).unwrap();
        let ks = env.open();
        ks.open_scope(APP).unwrap();
        // Anyone at the computer can do this without a master password.
        let code = ks.setup_recovery().unwrap().to_string();
        let ks = env.open();
        ks.unlock_with_password("ws:own", "workspace-pw").unwrap();
        assert!(!kinds(&env, "ws:own").contains(&"recovery".to_string()));
        assert_eq!(env.open().unlock_with_recovery(&code).unwrap(), [APP]);
    }

    #[test]
    fn setting_a_master_password_discards_the_old_recovery_code() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:own", Some("workspace-pw")).unwrap();
        let old = ks.setup_recovery().unwrap().to_string();
        set_master(&ks, "master-password");
        assert!(!ks.status().recovery_configured);
        assert_eq!(env.open().unlock_with_recovery(&old), Err(KsError::InvalidRecoveryCode));

        let code = ks.setup_recovery().unwrap().to_string();
        // ws:own was unlocked while the master password was set, so it is covered now.
        assert!(kinds(&env, "ws:own").contains(&"recovery".to_string()));
        let mut opened = env.open().unlock_with_recovery(&code).unwrap();
        opened.sort();
        assert_eq!(opened, [APP, "ws:own"]);
    }

    #[test]
    fn a_workspace_locked_during_recovery_setup_is_covered_on_its_next_unlock_under_a_master_password() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:own", Some("workspace-pw")).unwrap();
        // The master password is set while ws:own is locked, so it has no parent route yet.
        let ks = env.open();
        ks.open_scope(APP).unwrap();
        set_master(&ks, "master-password");
        assert_eq!(kinds(&env, "ws:own"), ["password"]);
        let code = ks.setup_recovery().unwrap().to_string();
        assert!(!kinds(&env, "ws:own").contains(&"recovery".to_string()), "locked: not yet");
        ks.unlock_with_password("ws:own", "workspace-pw").unwrap();
        assert!(kinds(&env, "ws:own").contains(&"recovery".to_string()));
        assert!(env.open().unlock_with_recovery(&code).unwrap().contains(&"ws:own".to_string()));
    }

    #[test]
    fn each_scope_gets_its_own_presence_key() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", Some("workspace-pw")).unwrap();
        ks.create_scope("ws:b", Some("workspace-pw")).unwrap();
        ks.enable_presence("ws:a", "r").unwrap();
        ks.enable_presence("ws:b", "r").unwrap();
        let key_of = |scope: &str| {
            env.keyring().scopes[scope].versions[0].wraps.iter().find_map(|w| w.presence_key().map(|k| k.id.clone())).unwrap()
        };
        let (a, b) = (key_of("ws:a"), key_of("ws:b"));
        assert_ne!(a, b);
        ks.enable_presence("ws:a", "r").unwrap();
        assert_ne!(key_of("ws:a"), a, "re-enabling makes a new key");
        assert!(ks.device().deleted.lock().unwrap().contains(&a));
        ks.disable_presence("ws:b").unwrap();
        assert!(ks.device().deleted.lock().unwrap().contains(&b));
        assert_eq!(kinds(&env, "ws:b"), ["password"]);
        assert_eq!(ks.enable_presence(APP, "r"), Err(KsError::NoPassword(APP.into())));
    }

    // Regression tests from the robustness review (2026-09-29).

    #[test]
    fn parent_wraps_do_not_outlive_the_master_password() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:own", Some("workspace-pw")).unwrap();
        set_master(&ks, "master-password");
        let during_master = env.keyring();
        for staged in ks.remove_password(APP).unwrap() {
            ks.commit_rotation(&staged).unwrap();
        }
        let mut edited = env.keyring();
        let old_parent = during_master.scopes["ws:own"].versions[0]
            .wraps
            .iter()
            .find(|w| matches!(w, Wrap::Parent { .. }))
            .unwrap()
            .clone();
        edited.scopes.get_mut("ws:own").unwrap().versions[0].wraps.push(old_parent);
        edited.scopes.get_mut(APP).unwrap().versions = during_master.scopes[APP].versions.clone();
        keyring::save(&env.path(), &edited).unwrap();
        let other = env.open();
        let _ = other.open_scope(APP);
        assert_eq!(other.open_scope("ws:own"), Err(KsError::Locked("ws:own".into())));
    }

    #[test]
    fn a_discarded_recovery_entry_stays_discarded() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:own", Some("workspace-pw")).unwrap();
        let code = ks.setup_recovery().unwrap().to_string();
        let entry = env.keyring().recovery.clone().unwrap();
        set_master(&ks, "master-password");
        let mut edited = env.keyring();
        edited.recovery = Some(entry);
        keyring::save(&env.path(), &edited).unwrap();
        let user = env.open();
        user.unlock_with_password(APP, "master-password").unwrap();
        user.unlock_with_password("ws:own", "workspace-pw").unwrap();
        assert_eq!(env.open().unlock_with_recovery(&code), Err(KsError::InvalidRecoveryCode));
    }

    #[test]
    fn a_pending_master_rotation_never_wraps_under_the_old_app_key() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:own", Some("workspace-pw")).unwrap();
        ks.create_scope("ws:plain", None).unwrap();
        let old = env.keyring().scopes[APP].versions[0].id.clone();
        ks.set_password(APP, "master-password").unwrap();
        let pending = env.keyring();
        for scope in ["ws:own", "ws:plain"] {
            for version in &pending.scopes[scope].versions {
                assert!(!version.wraps.iter().any(|w| Policy::is_parent_of(w, &old)), "{scope} wrapped under the pre-master app key");
            }
        }
        // Still reachable after a crash: the master password opens both app versions.
        let after_crash = env.open();
        after_crash.unlock_with_password(APP, "master-password").unwrap();
        after_crash.open_scope("ws:plain").unwrap();
        after_crash.open_scope("ws:own").unwrap();
    }

    #[test]
    fn an_older_protection_record_cannot_be_replayed() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:b", None).unwrap();
        set_master(&ks, "master-password");
        let unprotected_record = env.keyring().scopes["ws:b"].versions[0].clone();
        for staged in ks.set_password("ws:b", "workspace-pw").unwrap() {
            ks.commit_rotation(&staged).unwrap();
        }
        for staged in ks.remove_password(APP).unwrap() {
            ks.commit_rotation(&staged).unwrap();
        }
        let mut edited = env.keyring();
        edited.scopes.get_mut("ws:b").unwrap().versions[0].policy = unprotected_record.policy.clone();
        keyring::save(&env.path(), &edited).unwrap();
        let ks = env.open();
        ks.open_scope(APP).unwrap();
        assert_eq!(ks.open_scope("ws:b"), Err(KsError::Locked("ws:b".into())));
        // The owner's next unlock does not turn it into a quiet workspace either: the record no
        // longer opens, which counts as protected.
        ks.unlock_with_password("ws:b", "workspace-pw").unwrap();
        assert!(!kinds(&env, "ws:b").contains(&"quiet".to_string()));
    }

    #[test]
    fn locking_one_workspace_cancels_an_unlock_already_under_way() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", Some("workspace-pw")).unwrap();
        let epoch = ks.state().epoch;
        ks.lock_scope("ws:a").unwrap();
        assert_eq!(ks.finish(epoch, None, false, Vec::new(), Box::new(|_| {})), Err(KsError::Cancelled));
    }

    #[test]
    fn protection_changes_end_reveal_sessions() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:a", Some("workspace-pw")).unwrap();
        let sealed = ks.seal_field("ws:a", "ctx", b"x").unwrap();
        ks.open_reveal_with_password("ws:a", "workspace-pw").unwrap();
        ks.reveal_field("ws:a", "ctx", &sealed).unwrap();
        ks.set_password(APP, "master-password").unwrap();
        assert_eq!(ks.reveal_field("ws:a", "ctx", &sealed), Err(KsError::RevealLocked));
    }

    #[test]
    fn aborting_a_new_master_password_restores_the_previous_state() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:plain", None).unwrap();
        let staged = ks.set_password(APP, "master-password").unwrap();
        for scope in &staged {
            ks.abort_rotation(scope).unwrap();
        }
        assert!(!ks.status().app_protected);
        assert_eq!(kinds(&env, APP), ["quiet"]);
        assert_eq!(kinds(&env, "ws:plain"), ["quiet"]);
        let ks = env.open();
        ks.open_scope(APP).unwrap();
        ks.open_scope("ws:plain").unwrap();
        assert_invariants(&env);
    }

    #[test]
    fn removing_the_master_password_finishes_after_a_crash_with_the_old_password() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        set_master(&ks, "master-password");
        let app_db = db(&ks, APP);
        assert_eq!(ks.remove_password(APP).unwrap(), [APP]);
        drop(ks); // crash before the database moved to the staged key
        let ks = env.open();
        assert!(!ks.status().app_protected);
        // The database still uses the master-era key, which has no quiet route.
        assert_eq!(ks.open_scope(APP), Err(KsError::Locked(APP.into())));
        ks.unlock_with_password(APP, "master-password").unwrap();
        assert_eq!(db(&ks, APP), app_db);
        ks.commit_rotation(APP).unwrap();
        let ks = env.open();
        ks.open_scope(APP).unwrap();
    }

    fn export_all(ks: &Keystore<FakeDevice>, scopes: &[&str]) -> Vec<ScopeExport> {
        scopes.iter().map(|s| ks.export_scope(s).unwrap()).collect()
    }

    #[test]
    fn an_export_opens_on_another_computer_with_the_same_keys() {
        let a = Env::new();
        let ks = a.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:plain", None).unwrap();
        ks.create_scope("ws:secret", Some("secret-password")).unwrap();
        let sealed_plain = ks.seal_field("ws:plain", "profile|p|password", b"pw-plain").unwrap();
        let sealed_secret = ks.seal_field("ws:secret", "profile|s|password", b"pw-secret").unwrap();
        let db_keys: Vec<_> = ["app", "ws:plain", "ws:secret"].iter().map(|s| ks.database_key(s, "database", false).unwrap()).collect();
        let exports = export_all(&ks, &["app", "ws:plain", "ws:secret"]);
        assert!(exports.iter().all(|e| e.version.wraps.iter().all(|w| w.is_password())), "device routes stay behind");

        let b = Env::new();
        let other: [u8; 32] = crypto::random_array();
        let imported = b.open_on(other);
        imported.initialize_from_export(exports).unwrap();
        for (scope, key) in ["app", "ws:plain", "ws:secret"].iter().zip(&db_keys) {
            assert_eq!(&imported.database_key(scope, "database", false).unwrap(), key, "{scope} keeps its database key");
        }
        assert_eq!(&imported.open_field("ws:plain", "profile|p|password", &sealed_plain).unwrap()[..], b"pw-plain");
        assert_eq!(&imported.open_field("ws:secret", "profile|s|password", &sealed_secret).unwrap()[..], b"pw-secret");

        // After a restart on the new computer: quiet scopes open by themselves, the password one asks.
        let ks = b.open_on(other);
        ks.open_scope(APP).unwrap();
        ks.open_scope("ws:plain").unwrap();
        assert!(matches!(ks.open_scope("ws:secret"), Err(KsError::Locked(_))));
        ks.unlock_with_password("ws:secret", "secret-password").unwrap();
        // The original computer's device keys mean nothing there.
        assert!(b.keyring().quiet_device.as_ref().is_some_and(|d| a.keyring().quiet_device.as_ref().is_some_and(|o| o.id != d.id)));
    }

    #[test]
    fn an_export_under_a_master_password_still_needs_it() {
        let a = Env::new();
        let ks = a.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:w", None).unwrap();
        for scope in ks.set_password(APP, "master-password").unwrap() {
            ks.commit_rotation(&scope).unwrap();
        }
        let exports = export_all(&ks, &["app", "ws:w"]);
        let b = Env::new();
        let other: [u8; 32] = crypto::random_array();
        b.open_on(other).initialize_from_export(exports).unwrap();
        let ks = b.open_on(other);
        assert!(matches!(ks.open_scope(APP), Err(KsError::Locked(_))));
        assert!(matches!(ks.open_scope("ws:w"), Err(KsError::Locked(_))));
        assert!(matches!(ks.unlock_with_password(APP, "wrong-password"), Err(KsError::WrongPassword)));
        ks.unlock_with_password(APP, "master-password").unwrap();
        ks.open_scope("ws:w").unwrap();
        assert!(ks.status().app_protected);
    }

    #[test]
    fn a_tampered_or_incomplete_export_is_refused() {
        let a = Env::new();
        let ks = a.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:w", None).unwrap();
        let fresh = || Env::new();

        let mut swapped = export_all(&ks, &["app", "ws:w"]);
        let other_key = swapped[0].key.clone();
        swapped[1].key = other_key;
        let env = fresh();
        assert!(matches!(env.open().initialize_from_export(swapped), Err(KsError::Corrupt(_))));
        assert!(!env.path().exists(), "nothing written");

        let env = fresh();
        assert!(matches!(env.open().initialize_from_export(export_all(&ks, &["ws:w"])), Err(KsError::InvalidArgument(_))), "no app scope");

        let mut with_device = export_all(&ks, &["app"]);
        with_device[0].version = ks.state().keyring.as_ref().unwrap().scopes[APP].versions[0].clone();
        assert!(matches!(fresh().open().initialize_from_export(with_device), Err(KsError::InvalidArgument(_))), "device routes refused");

        assert!(matches!(a.open().initialize_from_export(export_all(&ks, &["app"])), Err(KsError::AlreadyInitialized)));
    }

    #[test]
    fn locked_or_rotating_scopes_cannot_be_exported() {
        let env = Env::new();
        let ks = env.open();
        ks.initialize().unwrap();
        ks.create_scope("ws:s", Some("secret-password")).unwrap();
        ks.lock_scope("ws:s").unwrap();
        assert!(matches!(ks.export_scope("ws:s"), Err(KsError::Locked(_))));
        ks.unlock_with_password("ws:s", "secret-password").unwrap();
        ks.remove_password("ws:s").unwrap();
        assert!(matches!(ks.export_scope("ws:s"), Err(KsError::RotationPending(_))));
    }
}
