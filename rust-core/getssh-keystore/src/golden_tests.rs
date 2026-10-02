//! Keyrings, sealed fields and primitive outputs written by an earlier build of this crate
//! (tests/fixtures/golden, generated 2026-10-02 with aes-gcm 0.10, argon2 0.5, hkdf 0.12,
//! sha2 0.10, p256 0.13). Every later build must open them and derive the same keys, or
//! existing users lose their data. Never regenerate these files.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use serde_json::Value;

use crate::crypto::{self, Argon2Params};
use crate::device::fake::FakeDevice;
use crate::recovery::RecoveryCode;
use crate::store::Keystore;

const FAST: Argon2Params = Argon2Params { m_kib: 8 * 1024, t: 1, p: 1 };

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/golden")
}

fn expected() -> Value {
    serde_json::from_slice(&std::fs::read(fixtures().join("expected.json")).unwrap()).unwrap()
}

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or_else(|| panic!("{key} missing"))
}

/// A copy of a fixture keyring in a fresh directory (unlocking may rewrite it).
fn keystore(name: &str) -> (Keystore<FakeDevice>, PathBuf) {
    let dir = std::env::temp_dir().join(format!("gk-golden-{name}-{}", crypto::random_id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::copy(fixtures().join(name).join("keyring.json"), dir.join("keyring.json")).unwrap();
    let ks = Keystore::with_options(FakeDevice::new([1u8; 32]), dir.join("keyring.json"), FAST, Arc::new(Instant::now)).unwrap();
    (ks, dir)
}

fn db_key(ks: &Keystore<FakeDevice>, scope: &str) -> String {
    crypto::to_hex(&ks.database_key(scope, "database", false).unwrap()[..])
}

fn cleanup(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_master_password_keyring_from_an_earlier_build_opens() {
    let e = expected();
    let (ks, dir) = keystore("master");
    assert!(ks.open_scope("app").is_err(), "locked without the password");
    ks.unlock_with_password("app", s(&e, "master_password")).unwrap();
    assert_eq!(db_key(&ks, "app"), s(&e, "master_db_app"));
    ks.open_scope("ws:w1").unwrap();
    assert_eq!(db_key(&ks, "ws:w1"), s(&e, "master_db_w1"));
    let plain = ks.open_field("ws:w1", "profile|p1|password", s(&e, "master_sealed")).unwrap();
    assert_eq!(&plain[..], b"golden secret");
    cleanup(&dir);
}

#[test]
fn a_recovery_code_from_an_earlier_build_opens_its_keyring() {
    let e = expected();
    let (ks, dir) = keystore("master");
    ks.unlock_with_recovery(s(&e, "recovery_code")).unwrap();
    assert_eq!(db_key(&ks, "app"), s(&e, "master_db_app"));
    cleanup(&dir);
}

#[test]
fn a_device_and_workspace_password_keyring_from_an_earlier_build_opens() {
    let e = expected();
    let (ks, dir) = keystore("workspace");
    ks.open_scope("app").unwrap();
    assert_eq!(db_key(&ks, "app"), s(&e, "ws_db_app"));
    assert!(ks.open_scope("ws:p").is_err());
    ks.unlock_with_password("ws:p", s(&e, "ws_password")).unwrap();
    assert_eq!(db_key(&ks, "ws:p"), s(&e, "ws_db_p"));
    let plain = ks.open_field("ws:p", "profile|q|passphrase", s(&e, "ws_sealed")).unwrap();
    assert_eq!(&plain[..], b"another secret");
    cleanup(&dir);
}

#[test]
fn primitives_match_an_earlier_build() {
    let e = expected();
    let hex = |b: &[u8]| crypto::to_hex(b);
    let unhex = |h: &str| (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect::<Vec<u8>>();
    assert_eq!(hex(&crypto::argon2id(b"golden", &[2u8; 16], FAST).unwrap()[..]), s(&e, "argon2id"));
    assert_eq!(hex(&crypto::hkdf32(b"ikm", b"salt", b"info")[..]), s(&e, "hkdf32"));
    assert_eq!(hex(&crypto::key_check(&[3u8; 32], "ctx")), s(&e, "key_check"));
    let plain = crypto::open(&[3u8; 32], &unhex(s(&e, "gcm_nonce")), &unhex(s(&e, "gcm_ciphertext")), b"aad").unwrap();
    assert_eq!(&plain[..], b"aes-gcm plaintext");
    let code = RecoveryCode::parse(s(&e, "ecies_code")).unwrap();
    assert_eq!(hex(&code.public_key()), s(&e, "ecies_public"));
    let kek = crypto::ecies_decapsulate(&code.secret_key(), &unhex(s(&e, "ecies_ephemeral")), b"golden-info").unwrap();
    assert_eq!(hex(&kek[..]), s(&e, "ecies_kek"));
}
