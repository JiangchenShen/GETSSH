//! The N-API surface of getssh-store (store.d.ts). Every function here is a thin conversion:
//! validation and behaviour live in store.rs and profiles.rs. Functions that may prompt, run
//! Argon2 or rekey a database run on the libuv thread pool (AsyncTask).

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use getssh_keystore::device::PlatformDevice;
use getssh_keystore::recovery::RecoveryCode;
use napi::bindgen_prelude::{AsyncTask, Buffer, Either, Null, ToNapiValue, TypeName};
use napi::{Env, Task};
use napi_derive::napi;
use zeroize::Zeroizing;

use crate::error::{Code, StoreError, StoreResult};
use crate::bundle::ExportCandidate as RsExportCandidate;
use crate::folders::FolderSnapshot;
use crate::profiles::{Profile as RsProfile, ProfileInput as RsProfileInput, SecretField, SecretUpdate};
use crate::records::{
    AiMemoryMessage as RsAiMemoryMessage, AiMemoryVector as RsAiMemoryVector, AiMessage as RsAiMessage, AiSession as RsAiSession,
    AuditLog as RsAuditLog, Runbook as RsRunbook, RunbookInput as RsRunbookInput,
};
use crate::store::{AppStateInfo, Store, UnlockRoute, WorkspaceChanges, WorkspaceInfo};

static STORE: OnceLock<Store<PlatformDevice>> = OnceLock::new();
static CONFIGURE: Mutex<()> = Mutex::new(());
/// Written into export bundles ("made by GETSSH x.y.z").
static APP_VERSION: OnceLock<String> = OnceLock::new();

fn js_error(error: StoreError) -> napi::Error {
    napi::Error::from_reason(error.to_string())
}

fn store() -> napi::Result<&'static Store<PlatformDevice>> {
    STORE.get().ok_or_else(|| js_error(StoreError::new(Code::NotConfigured, "")))
}

fn sync<T>(f: impl FnOnce(&'static Store<PlatformDevice>) -> StoreResult<T>) -> napi::Result<T> {
    f(store()?).map_err(js_error)
}

type Work<O> = Box<dyn FnOnce(&'static Store<PlatformDevice>) -> StoreResult<O> + Send>;

pub struct Job<O: Send + 'static> {
    work: Option<Work<O>>,
}

impl<O: ToNapiValue + TypeName + Send + 'static> Task for Job<O> {
    type Output = O;
    type JsValue = O;

    fn compute(&mut self) -> napi::Result<O> {
        let work = self.work.take().ok_or_else(|| napi::Error::from_reason("[store:internal] job ran twice"))?;
        work(store()?).map_err(js_error)
    }

    fn resolve(&mut self, _env: Env, output: O) -> napi::Result<O> {
        Ok(output)
    }
}

fn job<O: ToNapiValue + TypeName + Send + 'static>(work: impl FnOnce(&'static Store<PlatformDevice>) -> StoreResult<O> + Send + 'static) -> AsyncTask<Job<O>> {
    AsyncTask::new(Job { work: Some(Box::new(work)) })
}

// ───────────────────────────── lifecycle and app lock ─────────────────────────────

#[napi(object)]
pub struct StartReport {
    pub migrated_workspaces: Vec<String>,
    pub deferred_workspaces: Vec<String>,
    pub presence_to_reenable: Vec<String>,
    pub failed_workspaces: Vec<String>,
}

#[napi(object)]
pub struct AppState {
    #[napi(ts_type = "'locked' | 'ready'")]
    pub phase: String,
    pub master_password: bool,
    pub master_password_must_change: bool,
    pub presence_supported: bool,
    pub presence_enabled: bool,
    pub recovery_configured: bool,
    pub device_key_lost: bool,
    pub device_backend: String,
}

impl From<AppStateInfo> for AppState {
    fn from(s: AppStateInfo) -> Self {
        AppState {
            phase: if s.ready { "ready" } else { "locked" }.into(),
            master_password: s.master_password,
            master_password_must_change: s.master_password_must_change,
            presence_supported: s.presence_supported,
            presence_enabled: s.presence_enabled,
            recovery_configured: s.recovery_configured,
            device_key_lost: s.device_key_lost,
            device_backend: s.device_backend,
        }
    }
}

#[napi(object)]
pub struct UnlockRouteJs {
    pub password: Option<String>,
    pub presence: Option<String>,
    pub recovery_code: Option<String>,
}

fn route(input: UnlockRouteJs) -> StoreResult<UnlockRoute> {
    match (input.password, input.presence, input.recovery_code) {
        (Some(p), None, None) => Ok(UnlockRoute::Password(Zeroizing::new(p))),
        (None, Some(r), None) => Ok(UnlockRoute::Presence(r)),
        (None, None, Some(c)) => Ok(UnlockRoute::RecoveryCode(Zeroizing::new(c))),
        _ => Err(StoreError::invalid("give exactly one of password, presence or recoveryCode")),
    }
}

#[napi]
pub fn configure(base_dir: String, app_version: Option<String>) -> napi::Result<()> {
    let _guard = CONFIGURE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(version) = app_version {
        let _ = APP_VERSION.set(version);
    }
    let base = PathBuf::from(&base_dir);
    if let Some(existing) = STORE.get() {
        if existing.base() == base {
            return Ok(());
        }
        return Err(js_error(StoreError::invalid("the store is already configured for another directory")));
    }
    if !base.is_absolute() {
        return Err(js_error(StoreError::invalid("baseDir must be absolute")));
    }
    let opened = Store::open(PlatformDevice::new(), base).map_err(js_error)?;
    let _ = STORE.set(opened);
    Ok(())
}

#[napi(ts_return_type = "Promise<StartReport>")]
pub fn start() -> AsyncTask<Job<StartReport>> {
    job(|s| {
        let r = s.start()?;
        Ok(StartReport {
            migrated_workspaces: r.migrated_workspaces,
            deferred_workspaces: r.deferred_workspaces,
            presence_to_reenable: r.presence_to_reenable,
            failed_workspaces: r.failed_workspaces,
        })
    })
}

#[napi]
pub fn app_state() -> napi::Result<AppState> {
    sync(|s| Ok(s.app_state().into()))
}

#[napi(ts_args_type = "route: UnlockRoute", ts_return_type = "Promise<AppState>")]
pub fn unlock_app(route_input: UnlockRouteJs) -> AsyncTask<Job<AppState>> {
    job(move |s| Ok(s.unlock_app(route(route_input)?)?.into()))
}

#[napi(ts_args_type = "reason: 'manual' | 'idle' | 'screen-locked' | 'sleep'")]
pub fn lock_app(reason: String) -> napi::Result<()> {
    sync(|s| {
        if !["manual", "idle", "screen-locked", "sleep"].contains(&reason.as_str()) {
            return Err(StoreError::invalid("reason must be manual, idle, screen-locked or sleep"));
        }
        s.lock_app();
        Ok(())
    })
}

// ───────────────────────── master password, presence, recovery ─────────────────────────

#[napi(object)]
pub struct SetMasterPasswordResult {
    pub recovery_reset: bool,
}

#[napi(ts_return_type = "Promise<{ recoveryReset: boolean }>")]
pub fn set_master_password(password: String, current: Option<String>) -> AsyncTask<Job<SetMasterPasswordResult>> {
    let (password, current) = (Zeroizing::new(password), current.map(Zeroizing::new));
    job(move |s| Ok(SetMasterPasswordResult { recovery_reset: s.set_master_password(&password, current.as_deref().map(|c| c.as_str()))? }))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn remove_master_password(current: String) -> AsyncTask<Job<()>> {
    let current = Zeroizing::new(current);
    job(move |s| s.remove_master_password(&current))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn set_presence(enabled: bool, reason: String) -> AsyncTask<Job<()>> {
    job(move |s| s.set_presence(enabled, &reason))
}

#[napi(ts_return_type = "Promise<string>")]
pub fn create_recovery_code(current: Option<String>) -> AsyncTask<Job<String>> {
    let current = current.map(Zeroizing::new);
    job(move |s| Ok(s.create_recovery_code(current.as_deref().map(|c| c.as_str()))?.to_string()))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn remove_recovery_code() -> AsyncTask<Job<()>> {
    job(|s| s.remove_recovery_code())
}

#[napi]
pub fn is_recovery_code_well_formed(code: String) -> bool {
    RecoveryCode::parse(&code).is_ok()
}

#[napi(ts_return_type = "Promise<boolean>")]
pub fn verify_presence(reason: String) -> AsyncTask<Job<bool>> {
    job(move |s| s.verify_presence(&reason))
}

#[napi(ts_return_type = "Promise<boolean>")]
pub fn verify_password(password: String, workspace_id: Option<String>) -> AsyncTask<Job<bool>> {
    let password = Zeroizing::new(password);
    job(move |s| s.verify_password(&password, workspace_id.as_deref()))
}

// ──────────────────────────────────── workspaces ────────────────────────────────────

#[napi(object, use_nullable = true)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub theme_color: Option<String>,
    #[napi(js_name = "is_main")]
    pub is_main: bool,
    pub has_password: bool,
    pub presence_enabled: bool,
    #[napi(ts_type = "'open' | 'locked'")]
    pub state: String,
    pub preferences: String,
    #[napi(js_name = "created_at")]
    pub created_at: i64,
    #[napi(js_name = "updated_at")]
    pub updated_at: i64,
}

impl From<WorkspaceInfo> for Workspace {
    fn from(w: WorkspaceInfo) -> Self {
        Workspace {
            state: if w.open { "open" } else { "locked" }.into(),
            id: w.id,
            name: w.name,
            theme_color: w.theme_color,
            is_main: w.is_main,
            has_password: w.has_password,
            presence_enabled: w.presence_enabled,
            preferences: w.preferences,
            created_at: w.created_at,
            updated_at: w.updated_at,
        }
    }
}

#[napi(object)]
pub struct CreateWorkspaceInput {
    pub id: Option<String>,
    pub name: String,
    pub theme_color: Option<String>,
    pub password: Option<String>,
}

#[napi(object)]
pub struct WorkspaceChangesJs {
    pub name: Option<String>,
    pub theme_color: Option<Either<String, Null>>,
    pub preferences: Option<String>,
}

#[napi(object)]
pub struct WorkspaceStats {
    pub size: f64,
    pub profile_count: i64,
    pub runbook_count: i64,
}

#[napi(object)]
pub struct FailedUnlock {
    pub id: String,
    pub code: String,
}

#[napi(object)]
pub struct BatchUnlockResult {
    pub unlocked: Vec<String>,
    pub failed: Vec<FailedUnlock>,
}

#[napi(object)]
pub struct WorkspaceUnlockRoute {
    pub password: Option<String>,
    pub presence: Option<String>,
}

#[napi]
pub fn list_workspaces() -> napi::Result<Vec<Workspace>> {
    sync(|s| Ok(s.list_workspaces()?.into_iter().map(Into::into).collect()))
}

#[napi(ts_return_type = "Promise<Workspace>")]
pub fn create_workspace(input: CreateWorkspaceInput) -> AsyncTask<Job<Workspace>> {
    let password = input.password.map(Zeroizing::new);
    job(move |s| {
        Ok(s.create_workspace(input.id.as_deref(), &input.name, input.theme_color.as_deref(), password.as_deref().map(|p| p.as_str()))?
            .into())
    })
}

#[napi]
pub fn update_workspace(id: String, changes: WorkspaceChangesJs) -> napi::Result<Workspace> {
    let changes = WorkspaceChanges {
        name: changes.name,
        theme_color: changes.theme_color.map(|t| match t {
            Either::A(color) => Some(color),
            Either::B(_) => None,
        }),
        preferences: changes.preferences,
    };
    sync(move |s| Ok(s.update_workspace(&id, changes)?.into()))
}

#[napi]
pub fn set_main_workspace(id: String) -> napi::Result<()> {
    sync(|s| s.set_main_workspace(&id))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn delete_workspace(id: String) -> AsyncTask<Job<()>> {
    job(move |s| s.delete_workspace(&id))
}

#[napi(ts_return_type = "Promise<'open' | 'locked'>")]
pub fn open_workspace(id: String) -> AsyncTask<Job<String>> {
    job(move |s| Ok(if s.open_workspace(&id)? { "open" } else { "locked" }.to_string()))
}

#[napi(ts_args_type = "id: string, route: { password: string } | { presence: string }", ts_return_type = "Promise<void>")]
pub fn unlock_workspace(id: String, route_input: WorkspaceUnlockRoute) -> AsyncTask<Job<()>> {
    job(move |s| {
        let route = match (route_input.password, route_input.presence) {
            (Some(p), None) => UnlockRoute::Password(Zeroizing::new(p)),
            (None, Some(r)) => UnlockRoute::Presence(r),
            _ => return Err(StoreError::invalid("give exactly one of password or presence")),
        };
        s.unlock_workspace(&id, route)
    })
}

#[napi(ts_return_type = "Promise<{ unlocked: string[]; failed: { id: string; code: StoreErrorCode }[] }>")]
pub fn unlock_workspaces(ids: Vec<String>, reason: String) -> AsyncTask<Job<BatchUnlockResult>> {
    job(move |s| {
        let result = s.unlock_workspaces(&ids, &reason)?;
        Ok(BatchUnlockResult {
            unlocked: result.unlocked,
            failed: result.failed.into_iter().map(|(id, code)| FailedUnlock { id, code: code.as_str().into() }).collect(),
        })
    })
}

#[napi]
pub fn lock_workspace(id: String) -> napi::Result<()> {
    sync(|s| s.lock_workspace(&id))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn set_workspace_password(id: String, password: String, current: Option<String>) -> AsyncTask<Job<()>> {
    let (password, current) = (Zeroizing::new(password), current.map(Zeroizing::new));
    job(move |s| s.set_workspace_password(&id, &password, current.as_deref().map(|c| c.as_str())))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn remove_workspace_password(id: String, current: String) -> AsyncTask<Job<()>> {
    let current = Zeroizing::new(current);
    job(move |s| s.remove_workspace_password(&id, &current))
}

#[napi]
pub fn workspace_stats(id: String) -> napi::Result<WorkspaceStats> {
    sync(|s| {
        let stats = s.workspace_stats(&id)?;
        Ok(WorkspaceStats { size: stats.size_mb, profile_count: stats.profile_count, runbook_count: stats.runbook_count })
    })
}

// ───────────────────────────── server profiles (no secrets) ─────────────────────────────

#[napi(object, use_nullable = true)]
pub struct Profile {
    pub id: String,
    #[napi(js_name = "workspace_id")]
    pub workspace_id: String,
    pub host: String,
    pub username: String,
    pub port: i64,
    #[napi(ts_type = "'ssh' | 'local' | 'telnet' | 'auto'")]
    pub protocol: String,
    #[napi(js_name = "authType", ts_type = "'password' | 'key' | 'agent'")]
    pub auth_type: String,
    pub alias: Option<String>,
    pub os_type: Option<String>,
    pub group_name: Option<String>,
    pub group: Option<String>,
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

impl From<RsProfile> for Profile {
    fn from(p: RsProfile) -> Self {
        Profile {
            group: p.group_name.clone(),
            id: p.id,
            workspace_id: p.workspace_id,
            host: p.host,
            username: p.username,
            port: p.port,
            protocol: p.protocol,
            auth_type: p.auth_type,
            alias: p.alias,
            os_type: p.os_type,
            group_name: p.group_name,
            auto_start: p.auto_start,
            use_keep_alive: p.use_keep_alive,
            strict_host_key_checking: p.strict_host_key_checking,
            proxy_jump: p.proxy_jump,
            initial_directory: p.initial_directory,
            post_connect_script: p.post_connect_script,
            theme_override: p.theme_override,
            key_id: p.key_id,
            private_key_path: p.private_key_path,
            has_password: p.has_password,
            has_passphrase: p.has_passphrase,
        }
    }
}

#[napi(object)]
pub struct ProfileInput {
    pub id: String,
    pub host: String,
    pub username: String,
    pub port: Option<i64>,
    pub protocol: Option<String>,
    #[napi(js_name = "authType")]
    pub auth_type: Option<String>,
    // `string | null` in store.d.ts: a plain Option<String> would refuse null, so saving back what
    // listProfiles returned would fail.
    pub alias: Option<Either<String, Null>>,
    pub os_type: Option<Either<String, Null>>,
    pub group_name: Option<Either<String, Null>>,
    pub auto_start: Option<bool>,
    pub use_keep_alive: Option<bool>,
    pub strict_host_key_checking: Option<bool>,
    pub proxy_jump: Option<Either<String, Null>>,
    pub initial_directory: Option<Either<String, Null>>,
    pub post_connect_script: Option<Either<String, Null>>,
    pub theme_override: Option<Either<String, Null>>,
    pub key_id: Option<Either<String, Null>>,
    pub private_key_path: Option<Either<String, Null>>,
    /// undefined keeps the stored value, null clears it, a string replaces it.
    pub password: Option<Either<String, Null>>,
    pub passphrase: Option<Either<String, Null>>,
}

/// A `string | null` field: null and undefined are both "no value".
fn nullable(value: Option<Either<String, Null>>) -> Option<String> {
    match value {
        Some(Either::A(text)) => Some(text),
        _ => None,
    }
}

fn secret(update: Option<Either<String, Null>>) -> SecretUpdate {
    match update {
        None => SecretUpdate::Keep,
        Some(Either::B(_)) => SecretUpdate::Clear,
        Some(Either::A(value)) => SecretUpdate::Set(Zeroizing::new(value)),
    }
}

impl From<ProfileInput> for RsProfileInput {
    fn from(p: ProfileInput) -> Self {
        RsProfileInput {
            id: p.id,
            host: p.host,
            username: p.username,
            port: p.port,
            protocol: p.protocol,
            auth_type: p.auth_type,
            alias: nullable(p.alias),
            os_type: nullable(p.os_type),
            group_name: nullable(p.group_name),
            auto_start: p.auto_start.unwrap_or(false),
            use_keep_alive: p.use_keep_alive.unwrap_or(true),
            strict_host_key_checking: p.strict_host_key_checking.unwrap_or(false),
            proxy_jump: nullable(p.proxy_jump),
            initial_directory: nullable(p.initial_directory),
            post_connect_script: nullable(p.post_connect_script),
            theme_override: nullable(p.theme_override),
            key_id: nullable(p.key_id),
            private_key_path: nullable(p.private_key_path),
            password: secret(p.password),
            passphrase: secret(p.passphrase),
        }
    }
}

#[napi]
pub fn list_profiles(workspace_id: String) -> napi::Result<Vec<Profile>> {
    sync(|s| Ok(s.list_profiles(&workspace_id)?.into_iter().map(Into::into).collect()))
}

#[napi]
pub fn save_profiles(workspace_id: String, inputs: Vec<ProfileInput>) -> napi::Result<Vec<Profile>> {
    let inputs: Vec<RsProfileInput> = inputs.into_iter().map(Into::into).collect();
    sync(|s| Ok(s.save_profiles(&workspace_id, &inputs)?.into_iter().map(Into::into).collect()))
}

#[napi]
pub fn delete_profiles(workspace_id: String, ids: Vec<String>) -> napi::Result<()> {
    sync(|s| s.delete_profiles(&workspace_id, &ids))
}

#[napi(object)]
pub struct CopyProfilesOptions {
    pub include_runbooks: Option<bool>,
}

#[napi]
pub fn copy_profiles(from_workspace_id: String, to_workspace_id: String, ids: Vec<String>, options: Option<CopyProfilesOptions>) -> napi::Result<()> {
    let include_runbooks = options.and_then(|o| o.include_runbooks) == Some(true);
    sync(|s| s.copy_profiles(&from_workspace_id, &to_workspace_id, &ids, include_runbooks))
}

// ─────────────────────────── secrets (main process only) ───────────────────────────

#[napi(object)]
pub struct ConnectSecrets {
    pub password: Option<Buffer>,
    pub passphrase: Option<Buffer>,
    pub private_key: Option<Buffer>,
}

#[napi]
pub fn connect_secrets(workspace_id: String, profile_id: String) -> napi::Result<ConnectSecrets> {
    sync(|s| {
        let secrets = s.connect_secrets(&workspace_id, &profile_id)?;
        let buffer = |v: Option<Zeroizing<Vec<u8>>>| v.map(|v| Buffer::from(v.to_vec()));
        Ok(ConnectSecrets { password: buffer(secrets.password), passphrase: buffer(secrets.passphrase), private_key: buffer(secrets.private_key) })
    })
}

#[napi(ts_args_type = "workspaceId: string, route: { presence: string } | { password: string }", ts_return_type = "Promise<void>")]
pub fn open_reveal(workspace_id: String, route_input: WorkspaceUnlockRoute) -> AsyncTask<Job<()>> {
    let password = route_input.password.map(Zeroizing::new);
    job(move |s| s.open_reveal(&workspace_id, route_input.presence.as_deref(), password.as_deref().map(|p| p.as_str())))
}

#[napi(ts_args_type = "workspaceId: string, profileId: string, field: 'password' | 'passphrase'")]
pub fn reveal_secret(workspace_id: String, profile_id: String, field: String) -> napi::Result<String> {
    let field = match field.as_str() {
        "password" => SecretField::Password,
        "passphrase" => SecretField::Passphrase,
        _ => return Err(js_error(StoreError::invalid("field must be password or passphrase"))),
    };
    sync(|s| Ok(s.reveal_secret(&workspace_id, &profile_id, field)?.to_string()))
}

#[napi]
pub fn close_reveal(_workspace_id: String) -> napi::Result<()> {
    sync(|s| {
        s.close_reveal();
        Ok(())
    })
}

// ───────────────────────────────── settings ─────────────────────────────────

#[napi]
pub fn get_global_setting(key: String) -> napi::Result<Option<String>> {
    sync(|s| s.get_global_setting(&key))
}

#[napi]
pub fn set_global_setting(key: String, value: String) -> napi::Result<()> {
    sync(|s| s.set_global_setting(&key, &value))
}

// ───────────────── other tables: one function per DatabaseManager method ─────────────────

#[napi(object, use_nullable = true)]
pub struct AssetFolderMembership {
    pub id: String,
    pub group: Option<String>,
}

#[napi(object)]
pub struct AssetFolderSnapshot {
    pub folders: Vec<String>,
    pub memberships: Vec<AssetFolderMembership>,
}

impl From<FolderSnapshot> for AssetFolderSnapshot {
    fn from(s: FolderSnapshot) -> Self {
        AssetFolderSnapshot {
            folders: s.folders,
            memberships: s.memberships.into_iter().map(|(id, group)| AssetFolderMembership { id, group }).collect(),
        }
    }
}

#[napi]
pub fn get_asset_folders(workspace_id: String) -> napi::Result<Vec<String>> {
    sync(|s| s.get_asset_folders(&workspace_id))
}

#[napi]
pub fn create_asset_folder(workspace_id: String, folder_path: String) -> napi::Result<AssetFolderSnapshot> {
    sync(|s| Ok(s.create_asset_folder(&workspace_id, &folder_path)?.into()))
}

#[napi]
pub fn rename_asset_folder(workspace_id: String, folder_path: String, new_name: String) -> napi::Result<AssetFolderSnapshot> {
    sync(|s| Ok(s.rename_asset_folder(&workspace_id, &folder_path, &new_name)?.into()))
}

#[napi]
pub fn remove_asset_folder(workspace_id: String, folder_path: String) -> napi::Result<AssetFolderSnapshot> {
    sync(|s| Ok(s.remove_asset_folder(&workspace_id, &folder_path)?.into()))
}

#[napi(ts_args_type = "workspaceId: string, profileIds: string[], folderPath: string | null")]
pub fn move_profiles_to_asset_folder(workspace_id: String, profile_ids: Vec<String>, folder_path: Option<String>) -> napi::Result<AssetFolderSnapshot> {
    sync(|s| Ok(s.move_profiles_to_asset_folder(&workspace_id, &profile_ids, folder_path.as_deref())?.into()))
}

#[napi(object)]
pub struct Runbook {
    pub id: String,
    #[napi(js_name = "workspace_id")]
    pub workspace_id: String,
    pub title: String,
    pub script: String,
    #[napi(js_name = "riskLevel")]
    pub risk_level: String,
    #[napi(js_name = "created_at")]
    pub created_at: f64,
}

impl From<RsRunbook> for Runbook {
    fn from(r: RsRunbook) -> Self {
        Runbook { id: r.id, workspace_id: r.workspace_id, title: r.title, script: r.script, risk_level: r.risk_level, created_at: r.created_at }
    }
}

#[napi(object)]
pub struct RunbookInput {
    pub id: String,
    pub title: String,
    pub script: String,
    #[napi(js_name = "riskLevel")]
    pub risk_level: Option<String>,
    #[napi(js_name = "created_at")]
    pub created_at: Option<f64>,
}

#[napi]
pub fn get_runbooks(workspace_id: String) -> napi::Result<Vec<Runbook>> {
    sync(|s| Ok(s.get_runbooks(&workspace_id)?.into_iter().map(Into::into).collect()))
}

#[napi]
pub fn save_runbooks(workspace_id: String, runbooks: Vec<RunbookInput>) -> napi::Result<()> {
    let runbooks: Vec<RsRunbookInput> = runbooks
        .into_iter()
        .map(|r| RsRunbookInput { id: r.id, title: r.title, script: r.script, risk_level: r.risk_level, created_at: r.created_at })
        .collect();
    sync(|s| s.save_runbooks(&workspace_id, &runbooks))
}

#[napi(object, use_nullable = true)]
pub struct AiMessage {
    pub id: String,
    #[napi(js_name = "session_id")]
    pub session_id: String,
    pub role: String,
    pub content: String,
    #[napi(js_name = "raw_content")]
    pub raw_content: Option<String>,
    pub timestamp: f64,
}

impl From<RsAiMessage> for AiMessage {
    fn from(m: RsAiMessage) -> Self {
        AiMessage { id: m.id, session_id: m.session_id, role: m.role, content: m.content, raw_content: m.raw_content, timestamp: m.timestamp }
    }
}

#[napi(object)]
pub struct AiSession {
    pub id: String,
    #[napi(js_name = "workspace_id")]
    pub workspace_id: String,
    pub title: String,
    #[napi(js_name = "created_at")]
    pub created_at: f64,
    #[napi(js_name = "updated_at")]
    pub updated_at: f64,
    pub messages: Vec<AiMessage>,
}

impl From<RsAiSession> for AiSession {
    fn from(s: RsAiSession) -> Self {
        AiSession {
            id: s.id,
            workspace_id: s.workspace_id,
            title: s.title,
            created_at: s.created_at,
            updated_at: s.updated_at,
            messages: s.messages.into_iter().map(Into::into).collect(),
        }
    }
}

#[napi]
pub fn get_ai_sessions(workspace_id: String) -> napi::Result<Vec<AiSession>> {
    sync(|s| Ok(s.get_ai_sessions(&workspace_id)?.into_iter().map(Into::into).collect()))
}

#[napi]
pub fn create_ai_session(workspace_id: String, id: String, title: String, timestamp: f64) -> napi::Result<()> {
    sync(|s| s.create_ai_session(&workspace_id, &id, &title, timestamp))
}

/// AiMessage as the caller sends it: raw_content may be a string, null, or left out.
#[napi(object)]
pub struct AiMessageInput {
    pub id: String,
    #[napi(js_name = "session_id")]
    pub session_id: String,
    pub role: String,
    pub content: String,
    #[napi(js_name = "raw_content")]
    pub raw_content: Option<Either<String, Null>>,
    pub timestamp: f64,
}

#[napi(ts_args_type = "workspaceId: string, message: AiMessage")]
pub fn save_ai_message(workspace_id: String, message: AiMessageInput) -> napi::Result<()> {
    let message = RsAiMessage {
        id: message.id,
        session_id: message.session_id,
        role: message.role,
        content: message.content,
        raw_content: nullable(message.raw_content),
        timestamp: message.timestamp,
    };
    sync(|s| s.save_ai_message(&workspace_id, &message))
}

#[napi]
pub fn update_ai_session_title(workspace_id: String, id: String, title: String) -> napi::Result<()> {
    sync(|s| s.update_ai_session_title(&workspace_id, &id, &title))
}

#[napi]
pub fn delete_ai_session(workspace_id: String, id: String) -> napi::Result<()> {
    sync(|s| s.delete_ai_session(&workspace_id, &id))
}

#[napi(object)]
pub struct AiMemoryVector {
    #[napi(js_name = "workspace_id")]
    pub workspace_id: String,
    #[napi(js_name = "message_id")]
    pub message_id: String,
    #[napi(js_name = "session_id")]
    pub session_id: String,
    #[napi(ts_type = "'user' | 'assistant'")]
    pub role: String,
    pub embedding: Buffer,
    pub dimensions: f64,
    #[napi(js_name = "content_hash")]
    pub content_hash: String,
    pub timestamp: f64,
}

#[napi(object)]
pub struct AiMemoryMessage {
    pub id: String,
    #[napi(js_name = "session_id")]
    pub session_id: String,
    #[napi(ts_type = "'user' | 'assistant'")]
    pub role: String,
    pub content: String,
    pub timestamp: f64,
}

impl From<RsAiMemoryMessage> for AiMemoryMessage {
    fn from(m: RsAiMemoryMessage) -> Self {
        AiMemoryMessage { id: m.id, session_id: m.session_id, role: m.role, content: m.content, timestamp: m.timestamp }
    }
}

#[napi]
pub fn is_encrypted_ai_memory_available() -> napi::Result<bool> {
    sync(|s| s.is_encrypted_ai_memory_available())
}

#[napi]
pub fn upsert_ai_memory_vector(row: AiMemoryVector) -> napi::Result<()> {
    let row = RsAiMemoryVector {
        workspace_id: row.workspace_id,
        message_id: row.message_id,
        session_id: row.session_id,
        role: row.role,
        embedding: row.embedding.to_vec(),
        dimensions: row.dimensions,
        content_hash: row.content_hash,
        timestamp: row.timestamp,
    };
    sync(|s| s.upsert_ai_memory_vector(&row))
}

#[napi]
pub fn get_ai_memory_vectors(workspace_id: String, limit: f64, exclude_session_id: Option<String>) -> napi::Result<Vec<AiMemoryVector>> {
    sync(|s| {
        Ok(s.get_ai_memory_vectors(&workspace_id, limit, exclude_session_id.as_deref())?
            .into_iter()
            .map(|v| AiMemoryVector {
                workspace_id: v.workspace_id,
                message_id: v.message_id,
                session_id: v.session_id,
                role: v.role,
                embedding: v.embedding.into(),
                dimensions: v.dimensions,
                content_hash: v.content_hash,
                timestamp: v.timestamp,
            })
            .collect())
    })
}

#[napi]
pub fn delete_ai_memory_message(workspace_id: String, message_id: String) -> napi::Result<()> {
    sync(|s| s.delete_ai_memory_message(&workspace_id, &message_id))
}

#[napi]
pub fn delete_ai_memory_session(workspace_id: String, session_id: String) -> napi::Result<()> {
    sync(|s| s.delete_ai_memory_session(&workspace_id, &session_id))
}

#[napi]
pub fn get_recent_ai_messages_for_memory(workspace_id: String, limit: f64) -> napi::Result<Vec<AiMemoryMessage>> {
    sync(|s| Ok(s.get_recent_ai_messages_for_memory(&workspace_id, limit)?.into_iter().map(Into::into).collect()))
}

#[napi]
pub fn get_ai_messages_by_ids(workspace_id: String, message_ids: Vec<String>) -> napi::Result<Vec<AiMemoryMessage>> {
    sync(|s| Ok(s.get_ai_messages_by_ids(&workspace_id, &message_ids)?.into_iter().map(Into::into).collect()))
}

#[napi(object)]
pub struct AuditLog {
    pub id: String,
    #[napi(js_name = "workspace_id")]
    pub workspace_id: String,
    pub action: String,
    pub target: String,
    pub details: String,
    #[napi(js_name = "created_at")]
    pub created_at: f64,
}

impl From<RsAuditLog> for AuditLog {
    fn from(a: RsAuditLog) -> Self {
        AuditLog { id: a.id, workspace_id: a.workspace_id, action: a.action, target: a.target, details: a.details, created_at: a.created_at }
    }
}

#[napi]
pub fn log_audit(workspace_id: String, action: String, target: Option<String>, details: Option<String>) -> napi::Result<()> {
    sync(|s| s.log_audit(&workspace_id, &action, target.as_deref(), details.as_deref()))
}

#[napi]
pub fn get_audit_logs(workspace_id: String, limit: Option<f64>) -> napi::Result<Vec<AuditLog>> {
    sync(|s| Ok(s.get_audit_logs(&workspace_id, limit)?.into_iter().map(Into::into).collect()))
}

// ───────────────────────────── export and import ─────────────────────────────

#[napi(object)]
pub struct ExportCandidate {
    pub id: String,
    pub name: String,
    #[napi(js_name = "is_main")]
    pub is_main: bool,
    #[napi(ts_type = "'open' | 'locked'")]
    pub state: String,
    #[napi(ts_type = "Array<'presence' | 'password'>")]
    pub unlock_with: Vec<String>,
    pub profile_count: i64,
}

impl From<RsExportCandidate> for ExportCandidate {
    fn from(c: RsExportCandidate) -> Self {
        ExportCandidate {
            id: c.id,
            name: c.name,
            is_main: c.is_main,
            state: if c.open { "open" } else { "locked" }.into(),
            unlock_with: c.unlock_with.into_iter().map(String::from).collect(),
            profile_count: c.profile_count,
        }
    }
}

#[napi]
pub fn export_candidates() -> napi::Result<Vec<ExportCandidate>> {
    sync(|s| Ok(s.export_candidates()?.into_iter().map(ExportCandidate::from).collect()))
}

fn absolute(path: String) -> StoreResult<PathBuf> {
    let path = PathBuf::from(path);
    if !path.is_absolute() || path.file_name().is_none() {
        return Err(StoreError::invalid("the backup path must be an absolute file path"));
    }
    Ok(path)
}

#[napi(object)]
pub struct ExportReport {
    pub path: String,
    pub workspace_ids: Vec<String>,
    pub bytes: f64,
}

#[napi(ts_return_type = "Promise<ExportReport>")]
pub fn export_bundle(path: String, password: String, workspace_ids: Vec<String>) -> AsyncTask<Job<ExportReport>> {
    let password = Zeroizing::new(password);
    job(move |s| {
        let path = absolute(path)?;
        let version = APP_VERSION.get().map(String::as_str).unwrap_or("unknown");
        let r = s.export_bundle(&path, &password, &workspace_ids, version)?;
        Ok(ExportReport { path: r.path.to_string_lossy().into_owned(), workspace_ids: r.workspace_ids, bytes: r.bytes as f64 })
    })
}

#[napi(object)]
pub struct BundleWorkspace {
    pub id: String,
    pub name: String,
    pub has_password: bool,
}

#[napi(object)]
pub struct BundleInfo {
    pub format_version: u32,
    pub created_at: f64,
    pub app_version: String,
    pub workspaces: Vec<BundleWorkspace>,
}

#[napi(ts_return_type = "Promise<BundleInfo>")]
pub fn inspect_bundle(path: String, password: String) -> AsyncTask<Job<BundleInfo>> {
    let password = Zeroizing::new(password);
    job(move |s| {
        let info = s.inspect_bundle(&absolute(path)?, &password)?;
        Ok(BundleInfo {
            format_version: info.format_version.into(),
            created_at: info.created_at as f64,
            app_version: info.app_version,
            workspaces: info.workspaces.into_iter().map(|w| BundleWorkspace { id: w.id, name: w.name, has_password: w.has_password }).collect(),
        })
    })
}

#[napi(object, use_nullable = true)]
pub struct ImportReport {
    pub workspace_ids: Vec<String>,
    pub backup_path: Option<String>,
}

#[napi(ts_args_type = "path: string, password: string, mode: 'replace'", ts_return_type = "Promise<ImportReport>")]
pub fn import_bundle(path: String, password: String, mode: String) -> AsyncTask<Job<ImportReport>> {
    let password = Zeroizing::new(password);
    job(move |s| {
        if mode != "replace" {
            return Err(StoreError::invalid("3.0 imports in 'replace' mode only"));
        }
        let r = s.import_bundle(&absolute(path)?, &password, PlatformDevice::new())?;
        Ok(ImportReport { workspace_ids: r.workspace_ids, backup_path: r.backup_path.map(|p| p.to_string_lossy().into_owned()) })
    })
}
