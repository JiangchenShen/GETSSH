#![deny(clippy::all)]

//! getssh-store: the native data layer of GETSSH 3.0. The interface is frozen in store.d.ts and
//! described in docs/GETSSH_STORE_DESIGN_CN.md. Database keys come from getssh-keystore inside
//! this module and never cross into JavaScript.
//!
//! S1: the vendored SQLite3 Multiple Ciphers engine and its safe wrapper (sqlite.rs).
//! S2: the store itself (store.rs, profiles.rs); the N-API surface follows the tests.
//! S3: the remaining tables (folders.rs, records.rs) and copying profiles between workspaces.

pub mod bundle;
pub mod error;
pub mod folders;
pub mod napi_api;
pub mod profiles;
pub mod records;
pub mod rekey;
pub mod schema;
pub mod sqlite;
pub mod store;

#[cfg(test)]
mod tests;

use napi_derive::napi;

/// The SQLite engine inside getssh-store, for diagnostics and the packaged-startup smoke test.
#[napi]
pub fn engine_version() -> String {
    format!("SQLite {} (SQLite3 Multiple Ciphers 2.3.5)", sqlite::engine_version())
}
