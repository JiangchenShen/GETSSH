#![deny(clippy::all)]

#[cfg(feature = "native")]
pub mod redaction;

// Re-export all N-API functions from the redaction module
#[cfg(feature = "native")]
pub use redaction::*;
