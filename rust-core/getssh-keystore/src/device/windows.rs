//! Windows device keys. None of them needs a signed binary, a package identity or any other
//! certificate-backed entitlement.
//!
//! Quiet key (no prompt, ever): a per-user RSA-2048 key in the TPM (Microsoft Platform Crypto
//! Provider) that decrypts a 32-byte device secret, or, where no TPM works, the same kind of
//! secret protected with DPAPI for the current user. Each wrap derives its KEK from that secret
//! with a fresh salt. The only job of this key is to keep copied files from opening elsewhere.
//!
//! Presence key: a Windows Hello key credential. Its private key only ever signs a random
//! challenge; RSASSA-PKCS1-v1_5 signatures are deterministic, so the signature is reproducible
//! key material that exists only after the user verifies with Windows Hello.
//!
//! WinRT operations are awaited with blocking `.join()` calls on a fresh thread in the
//! multithreaded apartment. The JS thread is a single-threaded apartment, where a blocking wait
//! can deadlock, and libuv worker threads carry whatever apartment another addon left them in.

use std::collections::BTreeMap;
use std::ffi::c_void;
use std::panic;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, Once, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use ::windows::core::{factory, w, Array, Error as WinError, Interface, HRESULT, HSTRING, PCWSTR};
use ::windows::Security::Credentials::UI::{
    UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
};
use ::windows::Security::Credentials::{
    KeyCredential, KeyCredentialCreationOption, KeyCredentialManager, KeyCredentialStatus,
};
use ::windows::Security::Cryptography::Core::{
    AsymmetricAlgorithmNames, AsymmetricKeyAlgorithmProvider, CryptographicEngine, CryptographicPublicKeyBlobType,
};
use ::windows::Security::Cryptography::CryptographicBuffer;
use ::windows::Storage::Streams::IBuffer;
use ::windows::Win32::Foundation::{
    LocalFree, ERROR_CANCELLED, ERROR_INVALID_DATA, ERROR_INVALID_PARAMETER, E_POINTER, HLOCAL, HWND, NTE_BAD_DATA,
    NTE_BAD_KEYSET, NTE_BAD_KEY_STATE, NTE_BAD_LEN, NTE_BAD_SIGNATURE, NTE_NO_KEY,
};
use ::windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, NCryptCreatePersistedKey, NCryptDecrypt, NCryptDeleteKey, NCryptEncrypt,
    NCryptFinalizeKey, NCryptFreeObject, NCryptOpenKey, NCryptOpenStorageProvider, NCryptSetProperty,
    BCRYPT_OAEP_PADDING_INFO, BCRYPT_SHA256_ALGORITHM, CERT_KEY_SPEC, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    MS_PLATFORM_CRYPTO_PROVIDER, NCRYPT_ALLOW_DECRYPT_FLAG, NCRYPT_FLAGS, NCRYPT_KEY_HANDLE,
    NCRYPT_KEY_USAGE_PROPERTY, NCRYPT_LENGTH_PROPERTY, NCRYPT_PAD_OAEP_FLAG, NCRYPT_PAD_PKCS1_FLAG,
    NCRYPT_PROV_HANDLE, NCRYPT_RSA_ALGORITHM, NCRYPT_SILENT_FLAG,
};
use ::windows::Win32::System::Com::CoIncrementMTAUsage;
use ::windows::Win32::System::WinRT::{IBufferByteAccess, IUserConsentVerifierInterop};
use ::windows::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowThreadProcessId, IsWindow, SetForegroundWindow};
use ::windows_future::IAsyncOperation;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use super::Device;
use crate::crypto::{self, Key32, KEY_LEN};
use crate::error::KsError;
use crate::keyring::DeviceKey;

const TPM: &str = "windows-tpm";
const DPAPI: &str = "windows-dpapi";
const HELLO: &str = "windows-hello";

/// Every key this backend creates carries one of these prefixes plus 32 lowercase hex digits.
/// Entries naming anything else are never opened or deleted, so an edited keyring.json cannot
/// point GETSSH at another application's TPM key or Windows Hello credential.
const TPM_KEY_PREFIX: &str = "GETSSH-Keystore-";
const HELLO_KEY_PREFIX: &str = "GETSSH-Presence-";
const KEY_NAME_HEX: usize = 32;

// DeviceKey.params entries.
const KEY_NAME: &str = "keyName";
const SEALED_SECRET: &str = "sealedSecret";
const PADDING: &str = "padding";
const PROTECTED_SECRET: &str = "protectedSecret";
const PUBLIC_KEY_SHA256: &str = "publicKeySha256";

const QUIET_SALT_LEN: usize = 16;
const CHALLENGE_LEN: usize = 32;
const RSA_BITS: u32 = 2048;
/// Upper bound for RSA ciphertexts and signatures coming back from the OS or the keyring.
const MAX_RSA_BYTES: usize = 1024;
const MAX_PROTECTED_LEN: usize = 4096;

const DPAPI_ENTROPY: &[u8] = b"getssh-keystore/v1";
const DPAPI_DESCRIPTION: PCWSTR = w!("GETSSH keystore");

const PRESENCE_TTL: Duration = Duration::from_secs(30);
/// How long the very first presence_supported() call waits (it may run on the JS thread).
const PRESENCE_FIRST_WAIT: Duration = Duration::from_secs(2);
const DIALOG_CLASS: PCWSTR = w!("Credential Dialog Xaml Host");
const DIALOG_RAISE_FOR: Duration = Duration::from_secs(5);
const DIALOG_POLL: Duration = Duration::from_millis(100);
const MAX_PROMPT_CHARS: usize = 256;

/// Errors that mean "this DPAPI blob cannot be opened by this user on this machine": it was made
/// by another user or machine (NTE_BAD_KEY_STATE), or it was modified.
const DPAPI_FOREIGN: [HRESULT; 6] = [
    NTE_BAD_KEY_STATE,
    NTE_BAD_DATA,
    NTE_BAD_SIGNATURE,
    ERROR_INVALID_DATA.to_hresult(),
    // Only the blob can be malformed: every other argument of the call is fixed.
    ERROR_INVALID_PARAMETER.to_hresult(),
    NTE_BAD_LEN,
];

/// Parent window for Windows Hello verification (BrowserWindow.getNativeWindowHandle()).
static PARENT_WINDOW: AtomicIsize = AtomicIsize::new(0);

/// Takes the Buffer from Electron's getNativeWindowHandle(): a pointer-sized little-endian HWND.
/// Anything of another length is ignored; an all-zero handle clears the parent.
pub fn set_parent_window(handle: &[u8]) {
    let Ok(bytes) = <[u8; std::mem::size_of::<isize>()]>::try_from(handle) else { return };
    PARENT_WINDOW.store(isize::from_le_bytes(bytes), Ordering::SeqCst);
}

/// The parent window, if it is still a live window of this process.
fn parent_window() -> Option<HWND> {
    let raw = PARENT_WINDOW.load(Ordering::SeqCst);
    if raw == 0 {
        return None;
    }
    let window = HWND(raw as *mut c_void);
    let mut process = 0u32;
    // SAFETY: both functions accept any handle value; a stale or foreign one makes them fail or
    // report another process, and `process` is a valid out pointer.
    let live = unsafe { IsWindow(Some(window)).as_bool() && GetWindowThreadProcessId(window, Some(&mut process)) != 0 };
    (live && process == std::process::id()).then_some(window)
}

#[derive(Default)]
pub struct PlatformDevice;

impl PlatformDevice {
    pub fn new() -> Self {
        PlatformDevice
    }
}

// ---------------------------------------------------------------------------------------------
// Errors and small helpers

fn code(error: &WinError) -> u32 {
    error.code().0 as u32
}

fn unavailable(what: &str, error: &WinError) -> KsError {
    KsError::Unavailable(format!("{what} failed (0x{:08X})", code(error)))
}

/// A cancelled WinRT operation is the user's choice, not a fault.
fn winrt_error(what: &str, error: &WinError) -> KsError {
    if error.code() == ERROR_CANCELLED.to_hresult() {
        KsError::Cancelled
    } else {
        unavailable(what, error)
    }
}

fn is_hex_digit(byte: u8) -> bool {
    byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
}

/// The name of a key this backend created. Anything else cannot refer to a key of ours, so it is
/// reported as lost (and never opened or deleted).
fn key_name<'a>(key: &'a DeviceKey, prefix: &str) -> Result<&'a str, KsError> {
    let name = key.params.get(KEY_NAME).map(String::as_str).ok_or(KsError::DeviceKeyLost)?;
    match name.strip_prefix(prefix) {
        Some(suffix) if suffix.len() == KEY_NAME_HEX && suffix.bytes().all(is_hex_digit) => Ok(name),
        _ => Err(KsError::DeviceKeyLost),
    }
}

fn new_key_name(prefix: &str) -> String {
    format!("{prefix}{}", crypto::to_hex(&crypto::random_array::<{ KEY_NAME_HEX / 2 }>()))
}

/// A base64 parameter of at most `max` bytes. A missing or malformed one cannot open anything
/// here, which is what DeviceKeyLost means.
fn binary_param(key: &DeviceKey, name: &str, max: usize) -> Result<Vec<u8>, KsError> {
    let text = key.params.get(name).ok_or(KsError::DeviceKeyLost)?;
    match STANDARD.decode(text) {
        Ok(bytes) if !bytes.is_empty() && bytes.len() <= max => Ok(bytes),
        _ => Err(KsError::DeviceKeyLost),
    }
}

fn sha256_param(key: &DeviceKey) -> Result<[u8; 32], KsError> {
    let text = key.params.get(PUBLIC_KEY_SHA256).ok_or(KsError::DeviceKeyLost)?;
    if text.len() != 64 || !text.bytes().all(is_hex_digit) {
        return Err(KsError::DeviceKeyLost);
    }
    let mut out = [0u8; 32];
    for (byte, pair) in out.iter_mut().zip(text.as_bytes().chunks(2)) {
        let hex = std::str::from_utf8(pair).map_err(|_| KsError::DeviceKeyLost)?;
        *byte = u8::from_str_radix(hex, 16).map_err(|_| KsError::DeviceKeyLost)?;
    }
    Ok(out)
}

/// The 32-byte device secret. Anything else means the entry does not belong to this key.
fn device_secret(bytes: &[u8]) -> Result<Key32, KsError> {
    if bytes.len() != KEY_LEN {
        return Err(KsError::DeviceKeyLost);
    }
    let mut secret = Zeroizing::new([0u8; KEY_LEN]);
    secret.copy_from_slice(bytes);
    Ok(secret)
}

/// Maps a check to key_usable()'s answer: lost is Ok(false), other failures stay errors.
fn usable(outcome: Result<(), KsError>) -> Result<bool, KsError> {
    match outcome {
        Ok(()) => Ok(true),
        Err(KsError::DeviceKeyLost) => Ok(false),
        Err(error) => Err(error),
    }
}

// ---------------------------------------------------------------------------------------------
// Quiet key, preferred: TPM (Microsoft Platform Crypto Provider)

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Padding {
    OaepSha256,
    Pkcs1,
}

impl Padding {
    /// In order of preference; some TPM drivers only take PKCS#1 v1.5 encryption padding.
    const ALL: [Padding; 2] = [Padding::OaepSha256, Padding::Pkcs1];

    fn name(self) -> &'static str {
        match self {
            Padding::OaepSha256 => "oaep-sha256",
            Padding::Pkcs1 => "pkcs1",
        }
    }

    fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|padding| padding.name() == name)
    }
}

struct Provider(NCRYPT_PROV_HANDLE);

impl Provider {
    fn open_tpm() -> Result<Self, WinError> {
        let mut handle = NCRYPT_PROV_HANDLE(0);
        // SAFETY: `handle` is a valid out pointer and the provider name a static NUL-terminated
        // string; flags must be 0.
        unsafe { NCryptOpenStorageProvider(&mut handle, MS_PLATFORM_CRYPTO_PROVIDER, 0) }?;
        Ok(Provider(handle))
    }
}

impl Drop for Provider {
    fn drop(&mut self) {
        // SAFETY: the handle came from NCryptOpenStorageProvider and is released only here.
        let _ = unsafe { NCryptFreeObject(self.0.into()) };
    }
}

/// An open TPM key. Its provider is released after it (fields drop after `Drop::drop`).
struct TpmKey {
    handle: NCRYPT_KEY_HANDLE,
    _provider: Provider,
}

impl TpmKey {
    /// Creates and finalizes a per-user persisted RSA-2048 key with no UI policy and no PIN.
    fn create(name: &str) -> Result<Self, WinError> {
        let provider = Provider::open_tpm()?;
        let name = HSTRING::from(name);
        let mut handle = NCRYPT_KEY_HANDLE(0);
        // SAFETY: the provider handle is live, `handle` is a valid out pointer, and the algorithm
        // id and key name are NUL-terminated strings that outlive the call. Flags 0: a per-user
        // key that must not replace an existing one.
        unsafe {
            NCryptCreatePersistedKey(provider.0, &mut handle, NCRYPT_RSA_ALGORITHM, &name, CERT_KEY_SPEC(0), NCRYPT_FLAGS(0))
        }?;
        let key = TpmKey { handle, _provider: provider };
        match key.finalize() {
            Ok(()) => Ok(key),
            Err(error) => {
                key.delete();
                Err(error)
            }
        }
    }

    fn finalize(&self) -> Result<(), WinError> {
        // SAFETY: the key handle is live; the value is a 4-byte buffer read during the call.
        unsafe { NCryptSetProperty(self.handle.into(), NCRYPT_LENGTH_PROPERTY, &RSA_BITS.to_le_bytes(), NCRYPT_FLAGS(0)) }?;
        // Decrypting the device secret is all the key is for. Not every TPM driver takes this
        // property; without it the key keeps the provider's default usage.
        // SAFETY: as above.
        let _ = unsafe {
            NCryptSetProperty(
                self.handle.into(),
                NCRYPT_KEY_USAGE_PROPERTY,
                &NCRYPT_ALLOW_DECRYPT_FLAG.to_le_bytes(),
                NCRYPT_FLAGS(0),
            )
        };
        // SAFETY: the key handle is live. The silent flag makes the provider fail rather than
        // show UI.
        unsafe { NCryptFinalizeKey(self.handle, NCRYPT_SILENT_FLAG) }
    }

    fn open(name: &str) -> Result<Self, WinError> {
        let provider = Provider::open_tpm()?;
        let name = HSTRING::from(name);
        let mut handle = NCRYPT_KEY_HANDLE(0);
        // SAFETY: the provider handle is live, `handle` is a valid out pointer and `name` a
        // NUL-terminated string that outlives the call.
        unsafe { NCryptOpenKey(provider.0, &mut handle, &name, CERT_KEY_SPEC(0), NCRYPT_SILENT_FLAG) }?;
        Ok(TpmKey { handle, _provider: provider })
    }

    /// Deletes the key from the TPM key store (best effort).
    fn delete(mut self) {
        // SAFETY: the handle is live; NCryptDeleteKey releases it when it succeeds.
        if unsafe { NCryptDeleteKey(self.handle, NCRYPT_SILENT_FLAG.0) }.is_ok() {
            self.handle = NCRYPT_KEY_HANDLE(0);
        }
    }

    fn encrypt(&self, input: &[u8], padding: Padding) -> Result<Zeroizing<Vec<u8>>, WinError> {
        self.rsa(input, padding, true)
    }

    fn decrypt(&self, input: &[u8], padding: Padding) -> Result<Zeroizing<Vec<u8>>, WinError> {
        self.rsa(input, padding, false)
    }

    fn rsa(&self, input: &[u8], padding: Padding, encrypt: bool) -> Result<Zeroizing<Vec<u8>>, WinError> {
        let oaep = BCRYPT_OAEP_PADDING_INFO { pszAlgId: BCRYPT_SHA256_ALGORITHM, pbLabel: ptr::null_mut(), cbLabel: 0 };
        let (info, flags) = match padding {
            Padding::OaepSha256 => (Some(ptr::addr_of!(oaep).cast::<c_void>()), NCRYPT_PAD_OAEP_FLAG),
            Padding::Pkcs1 => (None, NCRYPT_PAD_PKCS1_FLAG),
        };
        let run = |output: Option<&mut [u8]>, length: &mut u32| {
            // SAFETY: the key handle is live; `input`, `output` and `oaep` outlive the call and
            // the slices carry their own lengths. Encryption is a public-key operation and never
            // shows UI; decryption is asked to stay silent.
            unsafe {
                if encrypt {
                    NCryptEncrypt(self.handle, Some(input), info, output, length, flags)
                } else {
                    NCryptDecrypt(self.handle, Some(input), info, output, length, flags | NCRYPT_SILENT_FLAG)
                }
            }
        };
        let mut length = 0u32;
        run(None, &mut length)?;
        if length == 0 || length as usize > MAX_RSA_BYTES {
            return Err(NTE_BAD_LEN.into());
        }
        let mut output = Zeroizing::new(vec![0u8; length as usize]);
        run(Some(output.as_mut_slice()), &mut length)?;
        let written = (length as usize).min(output.len());
        output.truncate(written);
        Ok(output)
    }
}

impl Drop for TpmKey {
    fn drop(&mut self) {
        if self.handle.0 != 0 {
            // SAFETY: the handle came from NCryptCreatePersistedKey or NCryptOpenKey and is
            // released only here.
            let _ = unsafe { NCryptFreeObject(self.handle.into()) };
        }
    }
}

/// NCryptOpenKey failures that mean the key does not exist in this user's TPM key store.
fn tpm_open_error(error: &WinError) -> KsError {
    if error.code() == NTE_BAD_KEYSET || error.code() == NTE_NO_KEY {
        KsError::DeviceKeyLost
    } else {
        unavailable("opening the TPM key", error)
    }
}

struct TpmParams<'a> {
    name: &'a str,
    sealed: Vec<u8>,
    padding: Padding,
}

fn tpm_params(key: &DeviceKey) -> Result<TpmParams<'_>, KsError> {
    let name = key_name(key, TPM_KEY_PREFIX)?;
    let sealed = binary_param(key, SEALED_SECRET, MAX_RSA_BYTES)?;
    let padding = key.params.get(PADDING).map(String::as_str).and_then(Padding::parse).ok_or(KsError::DeviceKeyLost)?;
    Ok(TpmParams { name, sealed, padding })
}

fn create_tpm_key() -> Result<DeviceKey, KsError> {
    let name = new_key_name(TPM_KEY_PREFIX);
    let key = TpmKey::create(&name).map_err(|e| unavailable("creating a TPM key", &e))?;
    let secret = crypto::random_key();
    let sealed = Padding::ALL.into_iter().find_map(|padding| {
        let sealed = key.encrypt(secret.as_slice(), padding).ok()?;
        let opened = key.decrypt(&sealed, padding).ok()?;
        crypto::ct_eq(&opened, secret.as_slice()).then_some((sealed, padding))
    });
    let Some((sealed, padding)) = sealed else {
        key.delete();
        return Err(KsError::Unavailable("the TPM key failed its round trip".into()));
    };
    let mut params = BTreeMap::new();
    params.insert(KEY_NAME.to_string(), name);
    params.insert(SEALED_SECRET.to_string(), STANDARD.encode(sealed.as_slice()));
    params.insert(PADDING.to_string(), padding.name().to_string());
    Ok(DeviceKey { id: crypto::random_id(), backend: TPM.to_string(), params })
}

fn tpm_secret(key: &DeviceKey) -> Result<Key32, KsError> {
    let params = tpm_params(key)?;
    let tpm_key = TpmKey::open(params.name).map_err(|e| tpm_open_error(&e))?;
    let plaintext = tpm_key.decrypt(&params.sealed, params.padding).map_err(|e| {
        // A padding check failure: the sealed secret in the entry is not this key's.
        if e.code() == NTE_BAD_DATA {
            KsError::DeviceKeyLost
        } else {
            unavailable("decrypting with the TPM key", &e)
        }
    })?;
    device_secret(&plaintext)
}

fn tpm_key_opens(key: &DeviceKey) -> Result<(), KsError> {
    let params = tpm_params(key)?;
    TpmKey::open(params.name).map(drop).map_err(|e| tpm_open_error(&e))
}

// ---------------------------------------------------------------------------------------------
// Quiet key, fallback: DPAPI (current user)

/// A buffer DPAPI allocated with LocalAlloc. Wiped, then released with LocalFree.
struct LocalBlob(CRYPT_INTEGER_BLOB);

impl LocalBlob {
    fn empty() -> Self {
        LocalBlob(CRYPT_INTEGER_BLOB { cbData: 0, pbData: ptr::null_mut() })
    }

    fn bytes(&self) -> &[u8] {
        if self.0.pbData.is_null() || self.0.cbData == 0 {
            return &[];
        }
        // SAFETY: DPAPI set pbData to an allocation of cbData bytes that lives until Drop.
        unsafe { std::slice::from_raw_parts(self.0.pbData, self.0.cbData as usize) }
    }
}

impl Drop for LocalBlob {
    fn drop(&mut self) {
        if self.0.pbData.is_null() {
            return;
        }
        // SAFETY: the allocation of cbData bytes is exclusively ours; it is wiped and then
        // released with LocalFree, as DPAPI requires, exactly once.
        unsafe {
            std::slice::from_raw_parts_mut(self.0.pbData, self.0.cbData as usize).zeroize();
            let _ = LocalFree(Some(HLOCAL(self.0.pbData.cast())));
        }
    }
}

/// Describes a buffer DPAPI only reads.
fn input_blob(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr().cast_mut() }
}

fn dpapi_protect(secret: &[u8]) -> Result<Vec<u8>, WinError> {
    let input = input_blob(secret);
    let entropy = input_blob(DPAPI_ENTROPY);
    let mut output = LocalBlob::empty();
    // SAFETY: `input` and `entropy` describe live buffers that DPAPI only reads; the output is
    // allocated by DPAPI and released by LocalBlob. UI is forbidden.
    unsafe {
        CryptProtectData(
            &input,
            DPAPI_DESCRIPTION,
            Some(ptr::addr_of!(entropy)),
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output.0,
        )
    }?;
    Ok(output.bytes().to_vec())
}

fn dpapi_unprotect(protected: &[u8]) -> Result<Zeroizing<Vec<u8>>, WinError> {
    let input = input_blob(protected);
    let entropy = input_blob(DPAPI_ENTROPY);
    let mut output = LocalBlob::empty();
    // SAFETY: as in dpapi_protect; no description is requested, so none is allocated.
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            Some(ptr::addr_of!(entropy)),
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output.0,
        )
    }?;
    Ok(Zeroizing::new(output.bytes().to_vec()))
}

fn create_dpapi_key() -> Result<DeviceKey, KsError> {
    let secret = crypto::random_key();
    let protected = dpapi_protect(secret.as_slice()).map_err(|e| unavailable("protecting the device secret with DPAPI", &e))?;
    let opened = dpapi_unprotect(&protected).map_err(|e| unavailable("checking the DPAPI device secret", &e))?;
    if !crypto::ct_eq(&opened, secret.as_slice()) {
        return Err(KsError::Unavailable("the DPAPI device secret failed its round trip".into()));
    }
    let mut params = BTreeMap::new();
    params.insert(PROTECTED_SECRET.to_string(), STANDARD.encode(&protected));
    Ok(DeviceKey { id: crypto::random_id(), backend: DPAPI.to_string(), params })
}

fn dpapi_secret(key: &DeviceKey) -> Result<Key32, KsError> {
    let protected = binary_param(key, PROTECTED_SECRET, MAX_PROTECTED_LEN)?;
    let plaintext = dpapi_unprotect(&protected).map_err(|e| {
        if DPAPI_FOREIGN.contains(&e.code()) {
            KsError::DeviceKeyLost
        } else {
            unavailable("opening the DPAPI device secret", &e)
        }
    })?;
    device_secret(&plaintext)
}

fn quiet_secret(key: &DeviceKey) -> Result<Key32, KsError> {
    match key.backend.as_str() {
        TPM => tpm_secret(key),
        DPAPI => dpapi_secret(key),
        _ => Err(KsError::DeviceKeyLost),
    }
}

// ---------------------------------------------------------------------------------------------
// WinRT plumbing

/// Makes sure the process has a multithreaded apartment, so threads that never initialized COM
/// (the worker threads below) join it implicitly. windows-rs 0.57 also does this on demand when
/// activation fails with CO_E_NOTINITIALIZED; doing it up front keeps the apartment explicit.
fn ensure_mta() {
    static MTA: Once = Once::new();
    MTA.call_once(|| {
        // SAFETY: no preconditions. The cookie is deliberately never released: the MTA then
        // stays up for the life of the process.
        let _ = unsafe { CoIncrementMTAUsage() };
    });
}

/// Runs WinRT work, including its blocking waits, on a fresh thread in the MTA.
fn in_mta<T: Send>(work: impl FnOnce() -> Result<T, KsError> + Send) -> Result<T, KsError> {
    ensure_mta();
    thread::scope(|scope| {
        let worker = thread::Builder::new()
            .name("getssh-keystore-winrt".into())
            .spawn_scoped(scope, work)
            .map_err(|e| KsError::Unavailable(format!("starting a Windows Hello thread: {e}")))?;
        worker
            .join()
            .unwrap_or_else(|_| Err(KsError::Unavailable("the Windows Hello thread panicked".into())))
    })
}

/// Runs `f` over the bytes of a WinRT buffer, in place.
fn with_buffer_bytes<R>(buffer: &IBuffer, f: impl FnOnce(&mut [u8]) -> R) -> Result<R, WinError> {
    let length = buffer.Length()? as usize;
    if length == 0 {
        return Ok(f(&mut []));
    }
    let access: IBufferByteAccess = buffer.cast()?;
    // SAFETY: IBufferByteAccess::Buffer only returns a pointer to the buffer's backing store.
    let data = unsafe { access.Buffer() }?;
    if data.is_null() {
        return Err(E_POINTER.into());
    }
    // SAFETY: `data` points to the buffer's `length` initialized bytes; `buffer` (and `access`)
    // keep them alive and unresized for the duration of `f`, and nothing else touches them.
    Ok(f(unsafe { std::slice::from_raw_parts_mut(data, length) }))
}

fn read_buffer(buffer: &IBuffer) -> Result<Zeroizing<Vec<u8>>, WinError> {
    if let Ok(copy) = with_buffer_bytes(buffer, |bytes| Zeroizing::new(bytes.to_vec())) {
        return Ok(copy);
    }
    let mut array = Array::<u8>::new();
    CryptographicBuffer::CopyToByteArray(buffer, &mut array)?;
    let copy = Zeroizing::new(array.to_vec());
    array.zeroize();
    Ok(copy)
}

/// Zero-fills a WinRT buffer that held secret material when it goes out of scope.
struct WipeOnDrop(IBuffer);

impl Drop for WipeOnDrop {
    fn drop(&mut self) {
        let _ = with_buffer_bytes(&self.0, |bytes| bytes.zeroize());
    }
}

/// Windows Hello key-credential prompts cannot be given an owner window and often open behind
/// the app. While one is pending, this brings the system dialog to the front (best effort).
struct DialogRaiser {
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl DialogRaiser {
    fn start() -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let thread = thread::Builder::new()
            .name("getssh-hello-raise".into())
            .spawn(move || {
                let deadline = Instant::now() + DIALOG_RAISE_FOR;
                while !flag.load(Ordering::SeqCst) && Instant::now() < deadline {
                    // SAFETY: the class name is a static NUL-terminated string; no window name.
                    // A missing window is an error since windows 0.58.
                    if let Ok(dialog) = unsafe { FindWindowW(DIALOG_CLASS, PCWSTR::null()) } {
                        // SAFETY: accepts any handle; a window that just closed only makes it fail.
                        let _ = unsafe { SetForegroundWindow(dialog) };
                        return;
                    }
                    thread::park_timeout(DIALOG_POLL);
                }
            })
            .ok();
        DialogRaiser { stop, thread }
    }
}

impl Drop for DialogRaiser {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            thread.thread().unpark();
            let _ = thread.join();
        }
    }
}

/// Text for the Windows Hello dialog.
fn prompt_text(reason: &str) -> String {
    let text: String = reason.chars().filter(|c| *c != '\0').take(MAX_PROMPT_CHARS).collect();
    let text = text.trim();
    if text.is_empty() {
        "GETSSH".to_string()
    } else {
        text.to_string()
    }
}

// ---------------------------------------------------------------------------------------------
// Presence: Windows Hello

fn credential_status(status: KeyCredentialStatus) -> Result<(), KsError> {
    match status {
        KeyCredentialStatus::Success => Ok(()),
        KeyCredentialStatus::UserCanceled | KeyCredentialStatus::UserPrefersPassword => Err(KsError::Cancelled),
        KeyCredentialStatus::NotFound => Err(KsError::DeviceKeyLost),
        other => Err(KsError::Unavailable(format!("Windows Hello returned status {}", other.0))),
    }
}

fn consent_result(result: UserConsentVerificationResult) -> Result<(), KsError> {
    match result {
        UserConsentVerificationResult::Verified => Ok(()),
        UserConsentVerificationResult::Canceled
        | UserConsentVerificationResult::DeviceBusy
        | UserConsentVerificationResult::RetriesExhausted => Err(KsError::Cancelled),
        UserConsentVerificationResult::DeviceNotPresent
        | UserConsentVerificationResult::NotConfiguredForUser
        | UserConsentVerificationResult::DisabledByPolicy => {
            Err(KsError::Unavailable("Windows Hello is not available for this user".into()))
        }
        other => Err(KsError::Unavailable(format!("Windows Hello verification returned {}", other.0))),
    }
}

struct HelloParams {
    name: HSTRING,
    public_key_sha256: [u8; 32],
}

impl HelloParams {
    /// Checked before any Windows Hello call is made.
    fn of(key: &DeviceKey) -> Result<Self, KsError> {
        let name = key_name(key, HELLO_KEY_PREFIX)?;
        let public_key_sha256 = sha256_param(key)?;
        Ok(HelloParams { name: HSTRING::from(name), public_key_sha256 })
    }
}

/// Opens the credential (no prompt) and checks it is still the key the entry was made with: a
/// credential re-created under the same name is another key.
fn open_credential(params: &HelloParams) -> Result<(KeyCredential, IBuffer), KsError> {
    let failed = |e: WinError| winrt_error("opening the Windows Hello key", &e);
    let result = KeyCredentialManager::OpenAsync(&params.name).and_then(|op| op.join()).map_err(failed)?;
    credential_status(result.Status().map_err(failed)?)?;
    let credential = result.Credential().map_err(failed)?;
    let public_key = credential.RetrievePublicKeyWithDefaultBlobType().map_err(failed)?;
    let bytes = read_buffer(&public_key).map_err(failed)?;
    if !crypto::ct_eq(Sha256::digest(bytes.as_slice()).as_slice(), &params.public_key_sha256) {
        return Err(KsError::DeviceKeyLost);
    }
    Ok((credential, public_key))
}

/// Windows Hello signs with RSASSA-PKCS1-v1_5 over SHA-256. The signature is only used once it
/// verifies as exactly that: a randomized scheme would give a KEK that never comes back.
fn signature_verifies(public_key: &IBuffer, data: &IBuffer, signature: &IBuffer) -> Result<bool, WinError> {
    let provider = AsymmetricKeyAlgorithmProvider::OpenAlgorithm(&AsymmetricAlgorithmNames::RsaSignPkcs1Sha256()?)?;
    let key = provider.ImportPublicKeyWithBlobType(public_key, CryptographicPublicKeyBlobType::X509SubjectPublicKeyInfo)?;
    CryptographicEngine::VerifySignature(&key, data, signature)
}

/// Signs `challenge` with the Hello credential. Prompts.
fn hello_signature(key: &DeviceKey, challenge: &[u8]) -> Result<Zeroizing<Vec<u8>>, KsError> {
    let params = HelloParams::of(key)?;
    in_mta(|| {
        let (credential, public_key) = open_credential(&params)?;
        let failed = |e: WinError| winrt_error("signing with Windows Hello", &e);
        let data = CryptographicBuffer::CreateFromByteArray(challenge).map_err(failed)?;
        let result = {
            let _raise = DialogRaiser::start();
            credential.RequestSignAsync(&data).and_then(|op| op.join())
        }
        .map_err(failed)?;
        credential_status(result.Status().map_err(failed)?)?;
        let signature_buffer = WipeOnDrop(result.Result().map_err(failed)?);
        let signature = read_buffer(&signature_buffer.0).map_err(failed)?;
        if signature.is_empty() || signature.len() > MAX_RSA_BYTES {
            return Err(KsError::Unavailable("Windows Hello returned a malformed signature".into()));
        }
        if !signature_verifies(&public_key, &data, &signature_buffer.0).map_err(failed)? {
            return Err(KsError::Unavailable("the Windows Hello signature does not verify".into()));
        }
        Ok(signature)
    })
}

fn hello_key_opens(key: &DeviceKey) -> Result<(), KsError> {
    let params = HelloParams::of(key)?;
    in_mta(|| open_credential(&params).map(drop))
}

fn create_hello_key() -> Result<DeviceKey, KsError> {
    let name = new_key_name(HELLO_KEY_PREFIX);
    let public_key_sha256 = in_mta(|| {
        let supported = KeyCredentialManager::IsSupportedAsync()
            .and_then(|op| op.join())
            .map_err(|e| winrt_error("checking for Windows Hello", &e))?;
        if !supported {
            return Err(KsError::Unavailable("Windows Hello is not set up for this user".into()));
        }
        let hname = HSTRING::from(name.as_str());
        let failed = |e: WinError| winrt_error("creating the Windows Hello key", &e);
        let result = {
            let _raise = DialogRaiser::start();
            KeyCredentialManager::RequestCreateAsync(&hname, KeyCredentialCreationOption::FailIfExists)
                .and_then(|op| op.join())
        }
        .map_err(failed)?;
        credential_status(result.Status().map_err(failed)?).map_err(|e| match e {
            KsError::DeviceKeyLost => KsError::Unavailable("Windows Hello could not create the key".into()),
            other => other,
        })?;
        let public_key = result
            .Credential()
            .and_then(|credential| credential.RetrievePublicKeyWithDefaultBlobType())
            .and_then(|buffer| read_buffer(&buffer));
        match public_key {
            Ok(bytes) if !bytes.is_empty() => Ok(crypto::to_hex(&Sha256::digest(bytes.as_slice()))),
            _ => {
                let _ = KeyCredentialManager::DeleteAsync(&hname).and_then(|op| op.join());
                Err(KsError::Unavailable("reading the new Windows Hello key failed".into()))
            }
        }
    })?;
    let mut params = BTreeMap::new();
    params.insert(KEY_NAME.to_string(), name);
    params.insert(PUBLIC_KEY_SHA256.to_string(), public_key_sha256);
    Ok(DeviceKey { id: crypto::random_id(), backend: HELLO.to_string(), params })
}

/// Deletes the credential, but only while it is still the key the entry describes.
fn delete_hello_key(key: &DeviceKey) {
    let Ok(params) = HelloParams::of(key) else { return };
    let _ = in_mta(|| {
        open_credential(&params)?;
        let _ = KeyCredentialManager::DeleteAsync(&params.name).and_then(|op| op.join());
        Ok(())
    });
}

fn probe_presence() -> bool {
    ensure_mta();
    let verifier = UserConsentVerifier::CheckAvailabilityAsync().and_then(|op| op.join());
    if !matches!(verifier, Ok(UserConsentVerifierAvailability::Available)) {
        return false;
    }
    matches!(KeyCredentialManager::IsSupportedAsync().and_then(|op| op.join()), Ok(true))
}

struct PresenceCache {
    value: Option<bool>,
    checked_at: Option<Instant>,
    probing: bool,
}

static PRESENCE: Mutex<PresenceCache> = Mutex::new(PresenceCache { value: None, checked_at: None, probing: false });
static PRESENCE_PROBED: Condvar = Condvar::new();

fn presence_cache() -> MutexGuard<'static, PresenceCache> {
    PRESENCE.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Cached for PRESENCE_TTL. A stale answer is returned at once while a probe refreshes it in the
/// background; only the first call ever waits, and at most PRESENCE_FIRST_WAIT. Never prompts.
fn presence_supported() -> bool {
    let mut cache = presence_cache();
    if let (Some(value), Some(checked_at)) = (cache.value, cache.checked_at) {
        if checked_at.elapsed() < PRESENCE_TTL {
            return value;
        }
    }
    if !cache.probing {
        cache.probing = thread::Builder::new()
            .name("getssh-hello-probe".into())
            .spawn(|| {
                let value = panic::catch_unwind(probe_presence).unwrap_or(false);
                let mut cache = presence_cache();
                cache.value = Some(value);
                cache.checked_at = Some(Instant::now());
                cache.probing = false;
                drop(cache);
                PRESENCE_PROBED.notify_all();
            })
            .is_ok();
    }
    if let Some(stale) = cache.value {
        return stale;
    }
    let (mut cache, _) = PRESENCE_PROBED
        .wait_timeout_while(cache, PRESENCE_FIRST_WAIT, |cache| cache.probing)
        .unwrap_or_else(PoisonError::into_inner);
    // Still probing: answer "no" until it finishes rather than blocking every caller.
    *cache.value.get_or_insert(false)
}

// ---------------------------------------------------------------------------------------------

impl Device for PlatformDevice {
    fn create_quiet_key(&self) -> Result<DeviceKey, KsError> {
        create_tpm_key().or_else(|_| create_dpapi_key())
    }

    fn presence_supported(&self) -> bool {
        presence_supported()
    }

    fn create_presence_key(&self, _reason: &str) -> Result<DeviceKey, KsError> {
        create_hello_key()
    }

    fn encapsulate(&self, key: &DeviceKey, info: &[u8], _reason: &str) -> Result<(Key32, Vec<u8>), KsError> {
        match key.backend.as_str() {
            TPM | DPAPI => {
                let secret = quiet_secret(key)?;
                let salt = crypto::random_array::<QUIET_SALT_LEN>();
                Ok((crypto::hkdf32(secret.as_slice(), &salt, info), salt.to_vec()))
            }
            HELLO => {
                let challenge = crypto::random_array::<CHALLENGE_LEN>();
                let signature = hello_signature(key, &challenge)?;
                Ok((crypto::hkdf32(&signature, &challenge, info), challenge.to_vec()))
            }
            _ => Err(KsError::DeviceKeyLost),
        }
    }

    fn decapsulate(&self, key: &DeviceKey, blob: &[u8], info: &[u8], _reason: &str) -> Result<Key32, KsError> {
        match key.backend.as_str() {
            TPM | DPAPI => {
                if blob.len() != QUIET_SALT_LEN {
                    return Err(KsError::Corrupt("malformed device wrap".into()));
                }
                let secret = quiet_secret(key)?;
                Ok(crypto::hkdf32(secret.as_slice(), blob, info))
            }
            HELLO => {
                if blob.len() != CHALLENGE_LEN {
                    return Err(KsError::Corrupt("malformed Windows Hello wrap".into()));
                }
                let signature = hello_signature(key, blob)?;
                Ok(crypto::hkdf32(&signature, blob, info))
            }
            _ => Err(KsError::DeviceKeyLost),
        }
    }

    fn verify_presence(&self, reason: &str) -> Result<(), KsError> {
        let message = prompt_text(reason);
        in_mta(move || {
            let message = HSTRING::from(message.as_str());
            let failed = |e: WinError| winrt_error("verifying with Windows Hello", &e);
            let result = match parent_window() {
                Some(window) => {
                    let interop =
                        factory::<UserConsentVerifier, IUserConsentVerifierInterop>().map_err(failed)?;
                    // SAFETY: `window` is a live window of this process and `message` a valid
                    // HSTRING; the requested interface is the operation type the method returns.
                    let operation = unsafe {
                        interop.RequestVerificationForWindowAsync::<IAsyncOperation<UserConsentVerificationResult>>(
                            window, &message,
                        )
                    }
                    .map_err(failed)?;
                    operation.join()
                }
                None => {
                    let _raise = DialogRaiser::start();
                    UserConsentVerifier::RequestVerificationAsync(&message).and_then(|op| op.join())
                }
            }
            .map_err(failed)?;
            consent_result(result)
        })
    }

    fn key_usable(&self, key: &DeviceKey) -> Result<bool, KsError> {
        usable(match key.backend.as_str() {
            TPM => tpm_key_opens(key),
            DPAPI => dpapi_secret(key).map(drop),
            HELLO => hello_key_opens(key),
            _ => Err(KsError::DeviceKeyLost),
        })
    }

    fn delete_key(&self, key: &DeviceKey) {
        match key.backend.as_str() {
            TPM => {
                if let Ok(name) = key_name(key, TPM_KEY_PREFIX) {
                    if let Ok(tpm_key) = TpmKey::open(name) {
                        tpm_key.delete();
                    }
                }
            }
            HELLO => delete_hello_key(key),
            // DPAPI: the protected secret exists only inside the keyring entry.
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Only the quiet backend is exercised: TPM where it works, DPAPI otherwise. Nothing here
    // calls Windows Hello or UserConsentVerifier, so no test can prompt.

    fn assert_round_trip(device: &PlatformDevice, key: &DeviceKey) {
        assert_eq!(device.key_usable(key), Ok(true));
        let (kek, blob) = device.encapsulate(key, b"info", "").unwrap();
        assert_eq!(blob.len(), QUIET_SALT_LEN);
        assert_eq!(*device.decapsulate(key, &blob, b"info", "").unwrap(), *kek);
        assert_ne!(*device.decapsulate(key, &blob, b"other", "").unwrap(), *kek);
        let (other_kek, other_blob) = device.encapsulate(key, b"info", "").unwrap();
        assert_ne!(other_blob, blob, "every wrap gets a fresh salt");
        assert_ne!(*other_kek, *kek);
        assert!(matches!(device.decapsulate(key, &blob[..8], b"info", ""), Err(KsError::Corrupt(_))));
        // The entry works after a trip through keyring.json.
        let reloaded: DeviceKey = serde_json::from_str(&serde_json::to_string(key).unwrap()).unwrap();
        assert_eq!(*device.decapsulate(&reloaded, &blob, b"info", "").unwrap(), *kek);
    }

    fn assert_lost(device: &PlatformDevice, key: &DeviceKey) {
        assert_eq!(device.key_usable(key), Ok(false));
        assert_eq!(device.decapsulate(key, &[0u8; QUIET_SALT_LEN], b"info", "").err(), Some(KsError::DeviceKeyLost));
        assert_eq!(device.encapsulate(key, b"info", "").err(), Some(KsError::DeviceKeyLost));
    }

    #[test]
    fn quiet_key_round_trips_without_prompting() {
        let device = PlatformDevice::new();
        let key = device.create_quiet_key().unwrap();
        assert!(key.backend == TPM || key.backend == DPAPI, "unexpected backend {}", key.backend);
        eprintln!("quiet backend: {}", key.backend);
        assert_round_trip(&device, &key);
        device.delete_key(&key);
        if key.backend == TPM {
            assert_lost(&device, &key);
        } else {
            assert_round_trip(&device, &key);
        }
    }

    #[test]
    fn dpapi_key_round_trips() {
        let device = PlatformDevice::new();
        let key = create_dpapi_key().unwrap();
        assert_eq!(key.backend, DPAPI);
        assert_round_trip(&device, &key);
    }

    #[test]
    fn corrupted_dpapi_secret_is_a_lost_key() {
        let device = PlatformDevice::new();
        let key = create_dpapi_key().unwrap();
        let mut protected = STANDARD.decode(&key.params[PROTECTED_SECRET]).unwrap();
        // The last bytes are DPAPI's integrity check over the blob.
        *protected.last_mut().unwrap() ^= 0x01;
        let mut corrupted = key.clone();
        corrupted.params.insert(PROTECTED_SECRET.into(), STANDARD.encode(&protected));
        assert_lost(&device, &corrupted);

        let mut not_base64 = key.clone();
        not_base64.params.insert(PROTECTED_SECRET.into(), "not base64!".into());
        assert_lost(&device, &not_base64);

        let mut missing = key.clone();
        missing.params.clear();
        assert_lost(&device, &missing);

        assert_round_trip(&device, &key);
    }

    #[test]
    fn made_up_tpm_key_names_are_lost_keys() {
        let key = match create_tpm_key() {
            Ok(key) => key,
            Err(error) => {
                eprintln!("no usable TPM here ({error}); skipped");
                return;
            }
        };
        let device = PlatformDevice::new();
        assert_round_trip(&device, &key);

        let mut made_up = key.clone();
        made_up.params.insert(KEY_NAME.into(), new_key_name(TPM_KEY_PREFIX));
        assert_lost(&device, &made_up);

        let mut other_secret = key.clone();
        let mut sealed = STANDARD.decode(&key.params[SEALED_SECRET]).unwrap();
        sealed[0] ^= 0x01;
        other_secret.params.insert(SEALED_SECRET.into(), STANDARD.encode(&sealed));
        assert!(matches!(
            device.decapsulate(&other_secret, &[0u8; QUIET_SALT_LEN], b"info", ""),
            Err(KsError::DeviceKeyLost) | Err(KsError::Unavailable(_))
        ));

        device.delete_key(&key);
        assert_lost(&device, &key);
    }

    #[test]
    fn foreign_and_malformed_entries_never_reach_the_os() {
        let device = PlatformDevice::new();
        let foreign_names = [
            String::new(),
            "Microsoft Connected Devices Platform device certificate".to_string(),
            format!("{TPM_KEY_PREFIX}{}", "A".repeat(KEY_NAME_HEX)),
            format!("{TPM_KEY_PREFIX}{}", "0".repeat(KEY_NAME_HEX - 1)),
            format!("{TPM_KEY_PREFIX}{}/..", "0".repeat(KEY_NAME_HEX)),
            format!("{HELLO_KEY_PREFIX}{}", "0".repeat(KEY_NAME_HEX)),
        ];
        for name in &foreign_names {
            let mut params = BTreeMap::new();
            params.insert(KEY_NAME.to_string(), name.clone());
            params.insert(SEALED_SECRET.to_string(), STANDARD.encode([0u8; 256]));
            params.insert(PADDING.to_string(), Padding::OaepSha256.name().to_string());
            let key = DeviceKey { id: crypto::random_id(), backend: TPM.into(), params };
            assert_lost(&device, &key);
            device.delete_key(&key);
        }

        let mut tpm_params = BTreeMap::new();
        tpm_params.insert(KEY_NAME.to_string(), new_key_name(TPM_KEY_PREFIX));
        tpm_params.insert(SEALED_SECRET.to_string(), STANDARD.encode([0u8; 256]));
        tpm_params.insert(PADDING.to_string(), "none".to_string());
        assert_lost(&device, &DeviceKey { id: crypto::random_id(), backend: TPM.into(), params: tpm_params });

        for backend in ["macos-se", "fake-quiet", ""] {
            let key = DeviceKey { id: crypto::random_id(), backend: backend.into(), params: BTreeMap::new() };
            assert_lost(&device, &key);
        }
    }

    #[test]
    fn hello_entries_are_validated_before_any_call() {
        let mut key = DeviceKey { id: crypto::random_id(), backend: HELLO.into(), params: BTreeMap::new() };
        assert!(matches!(HelloParams::of(&key), Err(KsError::DeviceKeyLost)));
        key.params.insert(KEY_NAME.into(), new_key_name(TPM_KEY_PREFIX));
        key.params.insert(PUBLIC_KEY_SHA256.into(), "0".repeat(64));
        assert!(matches!(HelloParams::of(&key), Err(KsError::DeviceKeyLost)));
        key.params.insert(KEY_NAME.into(), new_key_name(HELLO_KEY_PREFIX));
        for bad_hash in [String::new(), "zz".into(), "0".repeat(63), "A".repeat(64), "0".repeat(65)] {
            key.params.insert(PUBLIC_KEY_SHA256.into(), bad_hash.clone());
            assert!(matches!(HelloParams::of(&key), Err(KsError::DeviceKeyLost)), "{bad_hash:?}");
        }
        let hash = crypto::to_hex(&Sha256::digest(b"public key"));
        key.params.insert(PUBLIC_KEY_SHA256.into(), hash);
        let params = HelloParams::of(&key).unwrap();
        assert_eq!(params.public_key_sha256.as_slice(), Sha256::digest(b"public key").as_slice());
        assert_eq!(params.name.to_string(), key.params[KEY_NAME]);
    }

    #[test]
    fn parent_window_input_is_validated() {
        set_parent_window(&0x1234isize.to_le_bytes());
        assert_eq!(PARENT_WINDOW.load(Ordering::SeqCst), 0x1234);
        set_parent_window(&[1, 2, 3]);
        set_parent_window(&[]);
        set_parent_window(&[0u8; 16]);
        assert_eq!(PARENT_WINDOW.load(Ordering::SeqCst), 0x1234, "malformed input is ignored");
        set_parent_window(&0isize.to_le_bytes());
        assert_eq!(PARENT_WINDOW.load(Ordering::SeqCst), 0);
        assert!(parent_window().is_none());
    }

    #[test]
    fn prompt_text_is_bounded() {
        assert_eq!(prompt_text(""), "GETSSH");
        assert_eq!(prompt_text(" \0 "), "GETSSH");
        assert_eq!(prompt_text("Unlock\0 GETSSH"), "Unlock GETSSH");
        assert_eq!(prompt_text(&"x".repeat(1000)).chars().count(), MAX_PROMPT_CHARS);
    }
}
