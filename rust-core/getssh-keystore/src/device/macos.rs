//! macOS device keys: Secure Enclave P-256 keys through CryptoKit (see macos_shim.swift), with
//! the login Keychain as the quiet fallback on Macs without a Secure Enclave.
//!
//! Quiet and presence keys are key-agreement keys: encapsulation is ECIES to the enclave key's
//! public key (no prompt, done in Rust), decapsulation is ECDH inside the enclave.

use std::collections::BTreeMap;
use std::ffi::{c_char, CString};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::Device;
use crate::crypto::{self, Key32, P256_PUBLIC_LEN};
use crate::error::KsError;
use crate::keyring::DeviceKey;

const SE_QUIET: &str = "macos-se";
const SE_PRESENCE: &str = "macos-se-presence";
const KEYCHAIN: &str = "macos-keychain";
const MAX_HANDLE: usize = 4096;
const KEYCHAIN_SECRET_LEN: usize = 32;
const KEYCHAIN_SALT_LEN: usize = 16;

const GK_OK: i32 = 0;
const GK_CANCELLED: i32 = 1;
const GK_UNAVAILABLE: i32 = 2;
const GK_LOST: i32 = 3;

extern "C" {
    fn gk_se_available() -> bool;
    fn gk_la_available() -> bool;
    fn gk_se_create(presence: bool, handle_out: *mut u8, handle_cap: isize, handle_len: *mut isize, public_out: *mut u8) -> i32;
    fn gk_se_ecdh(handle: *const u8, handle_len: isize, peer: *const u8, presence: bool, reason: *const c_char, secret_out: *mut u8) -> i32;
    fn gk_la_verify(reason: *const c_char) -> i32;
    fn gk_kc_store(account: *const c_char, secret: *const u8, length: isize) -> i32;
    fn gk_kc_load(account: *const c_char, out: *mut u8, capacity: isize, out_len: *mut isize) -> i32;
    fn gk_kc_exists(account: *const c_char) -> i32;
    fn gk_kc_delete(account: *const c_char) -> i32;
}

fn check(code: i32, what: &str) -> Result<(), KsError> {
    match code {
        GK_OK => Ok(()),
        GK_CANCELLED => Err(KsError::Cancelled),
        GK_UNAVAILABLE => Err(KsError::Unavailable(format!("{what}: not available right now"))),
        GK_LOST => Err(KsError::DeviceKeyLost),
        other => Err(KsError::Unavailable(format!("{what} failed ({other})"))),
    }
}

/// Prompt text for the system sheet; interior NULs are dropped rather than truncating silently.
fn c_text(text: &str) -> CString {
    CString::new(text.replace('\0', "")).expect("NULs were removed")
}

fn param_bytes(key: &DeviceKey, name: &str) -> Result<Vec<u8>, KsError> {
    let value = key.params.get(name).ok_or_else(|| KsError::Corrupt(format!("device key without {name}")))?;
    STANDARD.decode(value).map_err(|_| KsError::Corrupt(format!("device key {name} is not base64")))
}

/// DER framing of a CryptoKit enclave handle: one OCTET STRING spanning the whole blob.
fn plausible_handle(handle: &[u8]) -> bool {
    if handle.len() < 4 || handle.len() > MAX_HANDLE || handle[0] != 0x04 {
        return false;
    }
    let (length, header) = match handle[1] {
        n if n < 0x80 => (n as usize, 2),
        0x81 => (handle[2] as usize, 3),
        0x82 => (((handle[2] as usize) << 8) | handle[3] as usize, 4),
        _ => return false,
    };
    header + length == handle.len()
}

/// The stored handle, released for use only if it is exactly what gk_se_create returned: its
/// checksum matches and its framing is intact. Anything else is treated as lost and never
/// reaches the enclave.
fn checked_handle(key: &DeviceKey) -> Result<Vec<u8>, KsError> {
    let handle = param_bytes(key, "handle")?;
    let expected = key.params.get("handleSha256").ok_or_else(|| KsError::Corrupt("device key without checksum".into()))?;
    if crypto::to_hex(&Sha256::digest(&handle)) != *expected || !plausible_handle(&handle) {
        return Err(KsError::DeviceKeyLost);
    }
    Ok(handle)
}

/// The public key recorded when the key was created. Wraps made for a different key simply do
/// not open, and key_usable() checks the pair with a real key agreement.
fn recorded_public(key: &DeviceKey) -> Result<[u8; P256_PUBLIC_LEN], KsError> {
    let bytes = param_bytes(key, "publicKey")?;
    crypto::parse_p256_public(&bytes)?;
    let mut out = [0u8; P256_PUBLIC_LEN];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn keychain_account(key: &DeviceKey) -> CString {
    c_text(&format!("keystore-{}", key.id))
}

pub struct PlatformDevice;

impl Default for PlatformDevice {
    fn default() -> Self {
        Self::new()
    }
}

impl PlatformDevice {
    pub fn new() -> Self {
        PlatformDevice
    }
}

fn se_available() -> bool {
    // SAFETY: no arguments; reads a CryptoKit class property.
    unsafe { gk_se_available() }
}

fn se_create(presence: bool, backend: &str) -> Result<DeviceKey, KsError> {
    let mut handle = vec![0u8; MAX_HANDLE];
    let mut handle_len: isize = 0;
    let mut public_key = [0u8; P256_PUBLIC_LEN];
    // SAFETY: the buffers outlive the call and their capacities are passed alongside them.
    let code = unsafe {
        gk_se_create(presence, handle.as_mut_ptr(), handle.len() as isize, &mut handle_len, public_key.as_mut_ptr())
    };
    check(code, "creating a Secure Enclave key")?;
    handle.truncate(handle_len.clamp(0, MAX_HANDLE as isize) as usize);
    crypto::parse_p256_public(&public_key)?;
    if !plausible_handle(&handle) {
        return Err(KsError::Unavailable("the Secure Enclave returned an unexpected key handle".into()));
    }
    let mut params = BTreeMap::new();
    params.insert("handle".to_string(), STANDARD.encode(&handle));
    params.insert("handleSha256".to_string(), crypto::to_hex(&Sha256::digest(&handle)));
    params.insert("publicKey".to_string(), STANDARD.encode(public_key));
    Ok(DeviceKey { id: crypto::random_id(), backend: backend.to_string(), params })
}

fn se_ecdh(key: &DeviceKey, peer: &[u8], presence: bool, reason: &str) -> Result<Zeroizing<[u8; 32]>, KsError> {
    if peer.len() != P256_PUBLIC_LEN {
        return Err(KsError::Corrupt("malformed ephemeral key".into()));
    }
    crypto::parse_p256_public(peer)?;
    let handle = checked_handle(key)?;
    let reason = c_text(reason);
    let mut shared = Zeroizing::new([0u8; 32]);
    // SAFETY: every pointer refers to a live buffer of the stated length; `peer` is 65 bytes.
    let code = unsafe {
        gk_se_ecdh(handle.as_ptr(), handle.len() as isize, peer.as_ptr(), presence, reason.as_ptr(), shared.as_mut_ptr())
    };
    check(code, "using the Secure Enclave key")?;
    Ok(shared)
}

fn keychain_load(key: &DeviceKey) -> Result<Zeroizing<Vec<u8>>, KsError> {
    let account = keychain_account(key);
    let mut secret = Zeroizing::new(vec![0u8; 64]);
    let mut length: isize = 0;
    // SAFETY: `secret` has the stated capacity and outlives the call.
    let code = unsafe { gk_kc_load(account.as_ptr(), secret.as_mut_ptr(), secret.len() as isize, &mut length) };
    check(code, "reading the GETSSH Keychain item")?;
    if length != KEYCHAIN_SECRET_LEN as isize {
        return Err(KsError::DeviceKeyLost);
    }
    secret.truncate(KEYCHAIN_SECRET_LEN);
    Ok(secret)
}

fn quiet_self_test(key: &DeviceKey) -> Result<(), KsError> {
    let peer = <p256::ecdh::EphemeralSecret as p256::elliptic_curve::Generate>::generate_from_rng(&mut crate::crypto::os_rng());
    let peer_public = crypto::p256_public_bytes(&peer.public_key());
    let enclave = se_ecdh(key, &peer_public, false, "")?;
    let expected = peer.diffie_hellman(&crypto::parse_p256_public(&recorded_public(key)?)?);
    if crypto::ct_eq(enclave.as_slice(), expected.raw_secret_bytes().as_slice()) {
        Ok(())
    } else {
        Err(KsError::DeviceKeyLost)
    }
}

impl Device for PlatformDevice {
    fn create_quiet_key(&self) -> Result<DeviceKey, KsError> {
        if se_available() {
            return se_create(false, SE_QUIET);
        }
        let key = DeviceKey { id: crypto::random_id(), backend: KEYCHAIN.to_string(), params: BTreeMap::new() };
        let secret = crypto::random_key();
        let account = keychain_account(&key);
        // SAFETY: `secret` is 32 live bytes.
        let code = unsafe { gk_kc_store(account.as_ptr(), secret.as_ptr(), KEYCHAIN_SECRET_LEN as isize) };
        check(code, "creating the GETSSH Keychain item")?;
        Ok(key)
    }

    fn presence_supported(&self) -> bool {
        // SAFETY: no arguments.
        se_available() && unsafe { gk_la_available() }
    }

    fn create_presence_key(&self, _reason: &str) -> Result<DeviceKey, KsError> {
        if !self.presence_supported() {
            return Err(KsError::Unavailable("Touch ID or the login password cannot be used here".into()));
        }
        se_create(true, SE_PRESENCE)
    }

    fn encapsulate(&self, key: &DeviceKey, info: &[u8], _reason: &str) -> Result<(Key32, Vec<u8>), KsError> {
        match key.backend.as_str() {
            SE_QUIET | SE_PRESENCE => {
                checked_handle(key)?;
                let (kek, ephemeral) = crypto::ecies_encapsulate(&recorded_public(key)?, info)?;
                Ok((kek, ephemeral.to_vec()))
            }
            KEYCHAIN => {
                let secret = keychain_load(key)?;
                let salt = crypto::random_array::<KEYCHAIN_SALT_LEN>();
                Ok((crypto::hkdf32(&secret, &salt, info), salt.to_vec()))
            }
            _ => Err(KsError::DeviceKeyLost),
        }
    }

    fn decapsulate(&self, key: &DeviceKey, blob: &[u8], info: &[u8], reason: &str) -> Result<Key32, KsError> {
        match key.backend.as_str() {
            SE_QUIET | SE_PRESENCE => {
                let presence = key.backend == SE_PRESENCE;
                let recipient = recorded_public(key)?;
                let shared = se_ecdh(key, blob, presence, reason)?;
                Ok(crypto::ecies_kek(shared.as_slice(), blob, &recipient, info))
            }
            KEYCHAIN => {
                if blob.len() != KEYCHAIN_SALT_LEN {
                    return Err(KsError::Corrupt("malformed Keychain wrap".into()));
                }
                let secret = keychain_load(key)?;
                Ok(crypto::hkdf32(&secret, blob, info))
            }
            _ => Err(KsError::DeviceKeyLost),
        }
    }

    fn verify_presence(&self, reason: &str) -> Result<(), KsError> {
        let reason = c_text(reason);
        // SAFETY: `reason` is a live NUL-terminated string.
        check(unsafe { gk_la_verify(reason.as_ptr()) }, "verifying the user")
    }

    fn key_usable(&self, key: &DeviceKey) -> Result<bool, KsError> {
        let outcome = match key.backend.as_str() {
            // A key agreement with a throwaway peer proves the enclave holds the private half of
            // the recorded public key. Quiet keys never prompt; presence keys would, so for them
            // only the handle is checked.
            SE_QUIET => quiet_self_test(key),
            SE_PRESENCE => checked_handle(key).map(|_| ()),
            KEYCHAIN => {
                let account = keychain_account(key);
                // SAFETY: `account` is a live NUL-terminated string.
                check(unsafe { gk_kc_exists(account.as_ptr()) }, "looking up the GETSSH Keychain item")
            }
            _ => Err(KsError::DeviceKeyLost),
        };
        match outcome {
            Ok(()) => Ok(true),
            Err(KsError::DeviceKeyLost) => Ok(false),
            Err(error) => Err(error),
        }
    }

    fn delete_key(&self, key: &DeviceKey) {
        // Enclave keys exist only as their handle; dropping the handle deletes them.
        if key.backend == KEYCHAIN {
            let account = keychain_account(key);
            // SAFETY: `account` is a live NUL-terminated string.
            let _ = unsafe { gk_kc_delete(account.as_ptr()) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Runs only where the Secure Enclave exists (Apple silicon / T2). Quiet keys never prompt and
    // live only in memory, so this touches neither the Keychain nor any GETSSH data.
    #[test]
    fn quiet_enclave_keys_round_trip_without_prompting() {
        if !se_available() {
            eprintln!("no Secure Enclave here; skipped");
            return;
        }
        let device = PlatformDevice::new();
        let key = device.create_quiet_key().unwrap();
        assert_eq!(key.backend, SE_QUIET);
        assert!(device.key_usable(&key).unwrap());
        let (kek, blob) = device.encapsulate(&key, b"info", "").unwrap();
        assert_eq!(*device.decapsulate(&key, &blob, b"info", "").unwrap(), *kek);
        assert_ne!(*device.decapsulate(&key, &blob, b"other", "").unwrap(), *kek);
    }

    #[test]
    fn edited_key_entries_are_refused_before_reaching_the_enclave() {
        if !se_available() {
            return;
        }
        let device = PlatformDevice::new();
        let key = device.create_quiet_key().unwrap();
        let (kek, blob) = device.encapsulate(&key, b"info", "").unwrap();

        // Another public key: the self-test fails and wraps made for it do not open.
        let mut swapped = key.clone();
        let other = <p256::SecretKey as p256::elliptic_curve::Generate>::generate_from_rng(&mut crate::crypto::os_rng());
        swapped.params.insert("publicKey".into(), STANDARD.encode(crypto::p256_public_bytes(&other.public_key())));
        assert!(!device.key_usable(&swapped).unwrap());
        assert_ne!(*device.decapsulate(&swapped, &blob, b"info", "").unwrap(), *kek);

        // A handle whose checksum does not match is never passed to the enclave. (Only the stored
        // checksum is edited here: modified handles must never be sent to real hardware.)
        let mut tampered = key.clone();
        tampered.params.insert("handleSha256".into(), "00".repeat(32));
        assert!(!device.key_usable(&tampered).unwrap());
        assert_eq!(device.decapsulate(&tampered, &blob, b"info", ""), Err(KsError::DeviceKeyLost));
        assert!(plausible_handle(&param_bytes(&key, "handle").unwrap()));
        assert!(!plausible_handle(&[0x04, 0x82, 0x01]));
        assert!(!plausible_handle(&[0x30, 0x02, 0, 0]));
    }

    #[test]
    fn presence_keys_are_created_without_prompting() {
        if !se_available() {
            return;
        }
        let device = PlatformDevice::new();
        let key = match se_create(true, SE_PRESENCE) {
            Ok(key) => key,
            // Presence keys can only be created while the Mac is unlocked.
            Err(KsError::Unavailable(reason)) => {
                eprintln!("presence key not created ({reason}); screen locked? skipped");
                return;
            }
            Err(error) => panic!("{error:?}"),
        };
        // Encapsulation needs only the public key: no prompt. Decapsulation would prompt, so the
        // test stops here.
        let (_, blob) = device.encapsulate(&key, b"info", "").unwrap();
        assert_eq!(blob.len(), P256_PUBLIC_LEN);
        assert!(device.key_usable(&key).unwrap());
    }
}

