#![deny(clippy::all)]

//! GETSSH keystore: every key and credential encryption for the app lives here, in native code.
//! The main process only receives what it must hand to other libraries (SQLCipher database keys,
//! a decrypted credential while connecting), never a key that opens other keys.
//!
//! This crate is a Rust library used by getssh-store, which is the only module the app loads; the
//! standalone getssh-keystore.node it used to build went with step S6.

pub mod crypto;
pub mod device;
pub mod error;
pub mod keyring;
pub mod recovery;
pub mod store;
#[cfg(test)]
mod golden_tests;

pub use device::PlatformDevice;
pub use error::KsError;
pub use store::Keystore;
