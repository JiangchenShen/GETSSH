//! Device-bound key encapsulation.
//!
//! A device key never leaves the security hardware (Secure Enclave, TPM) or the OS store (DPAPI,
//! login Keychain on Macs without a Secure Enclave). The keystore only asks it for key-encryption
//! keys: `encapsulate` returns a fresh KEK plus the public blob needed to get it back, and
//! `decapsulate` recovers the KEK from that blob on this machine only.
//!
//! Quiet keys work without any prompt and protect copied files only. Presence keys require the
//! user (Touch ID, the Mac login password, Windows Hello) every time they are used to decapsulate.

use crate::crypto::Key32;
use crate::error::KsError;
use crate::keyring::DeviceKey;

pub trait Device: Send + Sync + 'static {
    /// Creates the no-prompt device key.
    fn create_quiet_key(&self) -> Result<DeviceKey, KsError>;
    /// Whether this machine can verify the user (Touch ID / login password, Windows Hello).
    fn presence_supported(&self) -> bool;
    /// Creates a key whose use requires the user. May prompt (Windows Hello enrolment).
    fn create_presence_key(&self, reason: &str) -> Result<DeviceKey, KsError>;
    /// A fresh KEK bound to `info`, and the blob that recovers it. Prompts only where the
    /// platform cannot encapsulate with a public key alone (Windows Hello).
    fn encapsulate(&self, key: &DeviceKey, info: &[u8], reason: &str) -> Result<(Key32, Vec<u8>), KsError>;
    /// Recovers the KEK. Presence keys prompt; `DeviceKeyLost` means the key no longer exists here.
    fn decapsulate(&self, key: &DeviceKey, blob: &[u8], info: &[u8], reason: &str) -> Result<Key32, KsError>;
    /// Asks the OS to verify the user. Ok(()) only when verified.
    fn verify_presence(&self, reason: &str) -> Result<(), KsError>;
    /// Whether the key still exists on this machine, checked without prompting. Ok(false) means
    /// lost for good (another computer, reset hardware); Err means the check itself failed.
    fn key_usable(&self, key: &DeviceKey) -> Result<bool, KsError>;
    /// Best-effort removal of a key that no keyring entry references any more.
    fn delete_key(&self, key: &DeviceKey);
}

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use self::windows::{set_parent_window, PlatformDevice};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::PlatformDevice;

#[cfg(not(any(windows, target_os = "macos")))]
mod unsupported;
#[cfg(not(any(windows, target_os = "macos")))]
pub use unsupported::PlatformDevice;

/// Window that OS prompts should attach to (Electron's getNativeWindowHandle()). Only Windows
/// needs it; macOS attaches Touch ID sheets itself.
#[cfg(not(windows))]
pub fn set_parent_window(_handle: &[u8]) {}

#[cfg(any(test, feature = "fake-device"))]
pub mod fake;
