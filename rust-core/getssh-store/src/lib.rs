#![deny(clippy::all)]

//! getssh-store: the native data layer of GETSSH 3.0. The interface is frozen in store.d.ts and
//! described in docs/GETSSH_STORE_DESIGN_CN.md. Database keys come from getssh-keystore inside
//! this module and never cross into JavaScript.
//!
//! Step S1 (this commit): the crate, the vendored SQLite3 Multiple Ciphers engine and its safe
//! wrapper. The functions of store.d.ts arrive in S2 onwards.

pub mod sqlite;

use napi_derive::napi;

/// The SQLite engine inside getssh-store, for diagnostics and the packaged-startup smoke test.
#[napi]
pub fn engine_version() -> String {
    format!("SQLite {} (SQLite3 Multiple Ciphers 2.3.5)", sqlite::engine_version())
}
