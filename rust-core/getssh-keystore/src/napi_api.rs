//! The N-API surface of the keystore, built only with `--features napi` for the standalone
//! getssh-keystore.node. getssh-store links this crate as a plain Rust library instead, so these
//! exports are not registered twice.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use napi::bindgen_prelude::{AsyncTask, Buffer, ToNapiValue, TypeName};
use napi::{Env, Task};
use napi_derive::napi;
use zeroize::Zeroizing;

use crate::device::{self, PlatformDevice};
use crate::error::KsError;
use crate::recovery;
use crate::store::Keystore;

static KEYSTORE: OnceLock<Keystore<PlatformDevice>> = OnceLock::new();
static CONFIGURE: Mutex<()> = Mutex::new(());

fn js_error(error: KsError) -> napi::Error {
    napi::Error::from_reason(error.to_string())
}

fn keystore() -> napi::Result<&'static Keystore<PlatformDevice>> {
    KEYSTORE.get().ok_or_else(|| js_error(KsError::NotConfigured))
}

type Work<O> = Box<dyn FnOnce(&'static Keystore<PlatformDevice>) -> Result<O, KsError> + Send>;

pub struct Job<O: Send + 'static> {
    work: Option<Work<O>>,
}

impl<O: ToNapiValue + TypeName + Send + 'static> Task for Job<O> {
    type Output = O;
    type JsValue = O;

    fn compute(&mut self) -> napi::Result<O> {
        let work = self.work.take().ok_or_else(|| napi::Error::from_reason("[keystore:internal] job ran twice"))?;
        work(keystore()?).map_err(js_error)
    }

    fn resolve(&mut self, _env: Env, output: O) -> napi::Result<O> {
        Ok(output)
    }
}

/// Runs `work` on the libuv thread pool: Argon2, TPM calls and OS prompts never block the event loop.
fn job<O: ToNapiValue + TypeName + Send + 'static>(
    work: impl FnOnce(&'static Keystore<PlatformDevice>) -> Result<O, KsError> + Send + 'static,
) -> AsyncTask<Job<O>> {
    AsyncTask::new(Job { work: Some(Box::new(work)) })
}

/// Moves the bytes into a String without leaving another copy behind.
fn utf8(mut bytes: Zeroizing<Vec<u8>>) -> napi::Result<String> {
    if std::str::from_utf8(&bytes).is_err() {
        return Err(js_error(KsError::Corrupt("field is not UTF-8".into())));
    }
    String::from_utf8(std::mem::take(&mut *bytes)).map_err(|_| js_error(KsError::Corrupt("field is not UTF-8".into())))
}

#[napi(object)]
pub struct ScopeStatus {
    pub id: String,
    pub protected: bool,
    pub own_password: bool,
    pub presence: bool,
    pub unlocked: bool,
    pub staged: bool,
    pub recovery: bool,
    pub master_linked: bool,
    pub reveal_remaining_ms: Option<u32>,
}

#[napi(object)]
pub struct KeystoreStatus {
    pub initialized: bool,
    pub app_protected: bool,
    pub recovery_configured: bool,
    pub presence_supported: bool,
    pub quiet_backend: Option<String>,
    pub device_key_lost: bool,
    pub scopes: Vec<ScopeStatus>,
}

/// Points the keystore at its keyring file. Can be called once per process (again only with the
/// same path).
#[napi]
pub fn configure(keyring_path: String) -> napi::Result<()> {
    let _guard = CONFIGURE.lock().unwrap_or_else(|p| p.into_inner());
    let path = PathBuf::from(keyring_path);
    if !path.is_absolute() {
        return Err(js_error(KsError::InvalidArgument("the keyring path must be absolute".into())));
    }
    if let Some(existing) = KEYSTORE.get() {
        return if existing.path() == path {
            Ok(())
        } else {
            Err(js_error(KsError::InvalidArgument("the keystore is already configured".into())))
        };
    }
    let keystore = Keystore::open(PlatformDevice::new(), path).map_err(js_error)?;
    let _ = KEYSTORE.set(keystore);
    Ok(())
}

#[napi]
pub fn status() -> napi::Result<KeystoreStatus> {
    let status = keystore()?.status();
    Ok(KeystoreStatus {
        initialized: status.initialized,
        app_protected: status.app_protected,
        recovery_configured: status.recovery_configured,
        presence_supported: status.presence_supported,
        quiet_backend: status.quiet_backend,
        device_key_lost: status.device_key_lost,
        scopes: status
            .scopes
            .into_iter()
            .map(|s| ScopeStatus {
                id: s.id,
                protected: s.protected,
                own_password: s.own_password,
                presence: s.presence,
                unlocked: s.unlocked,
                staged: s.staged,
                recovery: s.recovery,
                master_linked: s.master_linked,
                reveal_remaining_ms: s.reveal_remaining_ms.map(|ms| ms.min(u32::MAX as u64) as u32),
            })
            .collect(),
    })
}

#[napi(ts_return_type = "Promise<void>")]
pub fn initialize() -> AsyncTask<Job<()>> {
    job(|ks| ks.initialize())
}

#[napi(ts_return_type = "Promise<void>")]
pub fn open_scope(scope: String) -> AsyncTask<Job<()>> {
    job(move |ks| ks.open_scope(&scope))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn unlock_with_password(scope: String, password: String) -> AsyncTask<Job<()>> {
    let password = Zeroizing::new(password);
    job(move |ks| ks.unlock_with_password(&scope, &password))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn unlock_with_presence(scope: String, reason: String) -> AsyncTask<Job<()>> {
    job(move |ks| ks.unlock_with_presence(&scope, &reason))
}

/// Resolves to the ids of the scopes the code opened.
#[napi(ts_return_type = "Promise<string[]>")]
pub fn unlock_with_recovery(code: String) -> AsyncTask<Job<Vec<String>>> {
    let code = Zeroizing::new(code);
    job(move |ks| ks.unlock_with_recovery(&code))
}

#[napi]
pub fn lock_protected() -> napi::Result<()> {
    keystore()?.lock_protected();
    Ok(())
}

#[napi]
pub fn lock_scope(scope: String) -> napi::Result<()> {
    keystore()?.lock_scope(&scope).map_err(js_error)
}

#[napi(ts_return_type = "Promise<void>")]
pub fn create_scope(scope: String, password: Option<String>) -> AsyncTask<Job<()>> {
    let password = password.map(Zeroizing::new);
    job(move |ks| ks.create_scope(&scope, password.as_deref().map(String::as_str)))
}

/// Migration from GETSSH before 3.0: keeps the workspace's existing password as it is.
#[napi(ts_return_type = "Promise<void>")]
pub fn create_scope_with_legacy_password(scope: String, password: String) -> AsyncTask<Job<()>> {
    let password = Zeroizing::new(password);
    job(move |ks| ks.create_scope_with_legacy_password(&scope, &password))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn delete_scope(scope: String) -> AsyncTask<Job<()>> {
    job(move |ks| ks.delete_scope(&scope))
}

/// Resolves to the scopes whose databases must be rekeyed to the staged key.
#[napi(ts_return_type = "Promise<string[]>")]
pub fn set_password(scope: String, password: String) -> AsyncTask<Job<Vec<String>>> {
    let password = Zeroizing::new(password);
    job(move |ks| ks.set_password(&scope, &password))
}

/// Resolves to the scopes whose databases must be rekeyed to the staged key.
#[napi(ts_return_type = "Promise<string[]>")]
pub fn remove_password(scope: String) -> AsyncTask<Job<Vec<String>>> {
    job(move |ks| ks.remove_password(&scope))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn enable_presence(scope: String, reason: String) -> AsyncTask<Job<()>> {
    job(move |ks| ks.enable_presence(&scope, &reason))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn disable_presence(scope: String) -> AsyncTask<Job<()>> {
    job(move |ks| ks.disable_presence(&scope))
}

/// Resolves to the new recovery code. It is not stored anywhere; show it once.
#[napi(ts_return_type = "Promise<string>")]
pub fn setup_recovery() -> AsyncTask<Job<String>> {
    job(|ks| ks.setup_recovery().map(|code| code.to_string()))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn remove_recovery() -> AsyncTask<Job<()>> {
    job(|ks| ks.remove_recovery())
}

#[napi(ts_return_type = "Promise<void>")]
pub fn commit_rotation(scope: String) -> AsyncTask<Job<()>> {
    job(move |ks| ks.commit_rotation(&scope))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn abort_rotation(scope: String) -> AsyncTask<Job<()>> {
    job(move |ks| ks.abort_rotation(&scope))
}

/// 32-byte SQLCipher key. The caller passes it to the driver and zero-fills the Buffer.
#[napi]
pub fn database_key(scope: String, label: String, staged: Option<bool>) -> napi::Result<Buffer> {
    let key = keystore()?
        .database_key(&scope, &label, staged.unwrap_or(false))
        .map_err(js_error)?;
    Ok(Buffer::from(key.to_vec()))
}

#[napi]
pub fn seal_field(scope: String, context: String, plaintext: String) -> napi::Result<String> {
    let plaintext = Zeroizing::new(plaintext);
    keystore()?.seal_field(&scope, &context, plaintext.as_bytes()).map_err(js_error)
}

/// For use inside the main process only (connecting); never send the result to a renderer.
#[napi]
pub fn open_field(scope: String, context: String, sealed: String) -> napi::Result<String> {
    utf8(keystore()?.open_field(&scope, &context, &sealed).map_err(js_error)?)
}

#[napi]
pub fn is_sealed_field(value: String) -> bool {
    Keystore::<PlatformDevice>::is_sealed_field(&value)
}

#[napi(ts_return_type = "Promise<void>")]
pub fn open_reveal_with_presence(scope: String, reason: String) -> AsyncTask<Job<()>> {
    job(move |ks| ks.open_reveal_with_presence(&scope, &reason))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn open_reveal_with_password(scope: String, password: String) -> AsyncTask<Job<()>> {
    let password = Zeroizing::new(password);
    job(move |ks| ks.open_reveal_with_password(&scope, &password))
}

/// For display. Fails with reveal_locked unless a reveal session is active; extends the session.
#[napi]
pub fn reveal_field(scope: String, context: String, sealed: String) -> napi::Result<String> {
    utf8(keystore()?.reveal_field(&scope, &context, &sealed).map_err(js_error)?)
}

#[napi]
pub fn close_reveal() -> napi::Result<()> {
    keystore()?.close_reveal();
    Ok(())
}

#[napi(ts_return_type = "Promise<void>")]
pub fn verify_presence(reason: String) -> AsyncTask<Job<()>> {
    job(move |ks| ks.verify_presence(&reason))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn verify_password(scope: String, password: String) -> AsyncTask<Job<()>> {
    let password = Zeroizing::new(password);
    job(move |ks| ks.verify_password(&scope, &password))
}

/// Round trip through a throwaway quiet device key (no prompt, no keyring); resolves to the
/// backend name ("macos-se", "macos-keychain", "windows-tpm", "windows-dpapi").
#[napi(ts_return_type = "Promise<string>")]
pub fn probe_device() -> AsyncTask<Job<String>> {
    job(|ks| ks.probe_device())
}

/// Parent window for Windows Hello prompts: the Buffer from BrowserWindow.getNativeWindowHandle().
#[napi]
pub fn set_parent_window(handle: Buffer) {
    device::set_parent_window(&handle);
}

#[napi]
pub fn is_recovery_code_well_formed(code: String) -> bool {
    let code = Zeroizing::new(code);
    recovery::RecoveryCode::parse(&code).is_ok()
}
