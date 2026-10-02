//! Primitives: AES-256-GCM, HKDF-SHA256, Argon2id and P-256 ECIES key encapsulation.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use p256::ecdh::{diffie_hellman, EphemeralSecret};
use p256::elliptic_curve::sec1::ToSec1Point;
use p256::elliptic_curve::Generate;
use p256::{PublicKey, SecretKey};
use getrandom::rand_core::UnwrapErr;
use getrandom::SysRng;
use sha2::Sha256;
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

use crate::error::KsError;

pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 12;
pub const SALT_LEN: usize = 16;
pub const CHECK_LEN: usize = 16;
pub const P256_PUBLIC_LEN: usize = 65;

/// Domain prefix for every derivation and associated-data string in this crate.
pub const DOMAIN: &str = "getssh-keystore/v1";

pub type Key32 = Zeroizing<[u8; KEY_LEN]>;

/// Authentication failed: wrong key, or the data was modified.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthError;

/// The OS random number generator for key generation. Like rand_core's former OsRng it panics if
/// the OS cannot provide randomness: no key may ever be made from anything weaker.
pub fn os_rng() -> UnwrapErr<SysRng> {
    UnwrapErr(SysRng)
}

fn fill_random(out: &mut [u8]) {
    getrandom::fill(out).expect("the OS random number generator failed");
}

pub fn random_key() -> Key32 {
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    fill_random(key.as_mut_slice());
    key
}

pub fn random_array<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    fill_random(&mut out);
    out
}

pub fn random_id() -> String {
    to_hex(&random_array::<8>())
}

pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn hkdf32(ikm: &[u8], salt: &[u8], info: &[u8]) -> Key32 {
    let mut out = Zeroizing::new([0u8; KEY_LEN]);
    Hkdf::<Sha256>::new(Some(salt), ikm)
        .expand(info, out.as_mut_slice())
        .expect("32 bytes is a valid HKDF-SHA256 output length");
    out
}

pub struct Sealed {
    pub nonce: [u8; NONCE_LEN],
    pub ciphertext: Vec<u8>,
}

pub fn seal(key: &[u8; KEY_LEN], plaintext: &[u8], aad: &[u8]) -> Sealed {
    let cipher = Aes256Gcm::new_from_slice(key).expect("AES-256 takes a 32-byte key");
    let nonce = random_array::<NONCE_LEN>();
    let ciphertext = cipher
        .encrypt(&Nonce::from(nonce), Payload { msg: plaintext, aad })
        .expect("AES-GCM encryption of an in-memory buffer cannot fail");
    Sealed { nonce, ciphertext }
}

pub fn open(key: &[u8; KEY_LEN], nonce: &[u8], ciphertext: &[u8], aad: &[u8]) -> Result<Zeroizing<Vec<u8>>, AuthError> {
    let nonce = Nonce::try_from(nonce).map_err(|_| AuthError)?;
    let cipher = Aes256Gcm::new_from_slice(key).expect("AES-256 takes a 32-byte key");
    cipher
        .decrypt(&nonce, Payload { msg: ciphertext, aad })
        .map(Zeroizing::new)
        .map_err(|_| AuthError)
}

/// Opens a sealed 32-byte key.
pub fn open_key(key: &[u8; KEY_LEN], nonce: &[u8], ciphertext: &[u8], aad: &[u8]) -> Result<Key32, AuthError> {
    let plaintext = open(key, nonce, ciphertext, aad)?;
    let mut out = Zeroizing::new([0u8; KEY_LEN]);
    if plaintext.len() != KEY_LEN {
        return Err(AuthError);
    }
    out.copy_from_slice(&plaintext);
    Ok(out)
}

/// Short value stored next to a key so a substituted or corrupted key is detected after unwrapping.
pub fn key_check(key: &[u8; KEY_LEN], context: &str) -> [u8; CHECK_LEN] {
    let derived = hkdf32(key, DOMAIN.as_bytes(), format!("{DOMAIN}|check|{context}").as_bytes());
    let mut out = [0u8; CHECK_LEN];
    out.copy_from_slice(&derived[..CHECK_LEN]);
    out
}

pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && bool::from(a.ct_eq(b))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Argon2Params {
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
}

impl Argon2Params {
    /// 64 MiB, 3 passes: roughly 0.2–0.5 s on current laptops.
    pub const DEFAULT: Self = Self { m_kib: 64 * 1024, t: 3, p: 1 };

    /// Bounds accepted from the keyring file, close to what GETSSH writes, so a modified file
    /// cannot make an unlock allocate huge amounts of memory or run for long.
    pub fn is_acceptable(&self) -> bool {
        (8 * 1024..=256 * 1024).contains(&self.m_kib) && (1..=8).contains(&self.t) && (1..=4).contains(&self.p)
    }
}

pub fn argon2id(password: &[u8], salt: &[u8], params: Argon2Params) -> Result<Key32, KsError> {
    if !params.is_acceptable() {
        return Err(KsError::Corrupt("unsupported Argon2 parameters".into()));
    }
    let argon_params = argon2::Params::new(params.m_kib, params.t, params.p, Some(KEY_LEN))
        .map_err(|e| KsError::Corrupt(format!("Argon2 parameters: {e}")))?;
    let argon = argon2::Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, argon_params);
    let mut out = Zeroizing::new([0u8; KEY_LEN]);
    argon
        .hash_password_into(password, salt, out.as_mut_slice())
        .map_err(|e| KsError::Corrupt(format!("Argon2: {e}")))?;
    Ok(out)
}

pub fn p256_public_bytes(key: &PublicKey) -> [u8; P256_PUBLIC_LEN] {
    let point = key.to_sec1_point(false);
    let mut out = [0u8; P256_PUBLIC_LEN];
    out.copy_from_slice(point.as_bytes());
    out
}

/// Parses an uncompressed SEC1 P-256 point; rejects the identity and off-curve points.
pub fn parse_p256_public(bytes: &[u8]) -> Result<PublicKey, KsError> {
    if bytes.len() != P256_PUBLIC_LEN || bytes[0] != 0x04 {
        return Err(KsError::Corrupt("malformed P-256 public key".into()));
    }
    PublicKey::from_sec1_bytes(bytes).map_err(|_| KsError::Corrupt("invalid P-256 public key".into()))
}

/// KEK for an ECDH secret between an ephemeral key and a recipient key. Both public keys are bound
/// into the derivation, so a blob cannot be replayed against another recipient.
pub fn ecies_kek(shared_x: &[u8], ephemeral: &[u8], recipient: &[u8], info: &[u8]) -> Key32 {
    let mut salt = Vec::with_capacity(ephemeral.len() + recipient.len());
    salt.extend_from_slice(ephemeral);
    salt.extend_from_slice(recipient);
    hkdf32(shared_x, &salt, info)
}

/// Encapsulates a fresh KEK to `recipient` (uncompressed SEC1). Needs only the public key.
pub fn ecies_encapsulate(recipient: &[u8], info: &[u8]) -> Result<(Key32, [u8; P256_PUBLIC_LEN]), KsError> {
    let recipient_key = parse_p256_public(recipient)?;
    let ephemeral = EphemeralSecret::generate_from_rng(&mut os_rng());
    let ephemeral_public = p256_public_bytes(&ephemeral.public_key());
    let shared = ephemeral.diffie_hellman(&recipient_key);
    let kek = ecies_kek(shared.raw_secret_bytes().as_slice(), &ephemeral_public, recipient, info);
    Ok((kek, ephemeral_public))
}

/// Recovers the KEK with a software private key (recovery keys, tests).
pub fn ecies_decapsulate(secret: &SecretKey, ephemeral: &[u8], info: &[u8]) -> Result<Key32, KsError> {
    let ephemeral_key = parse_p256_public(ephemeral)?;
    let recipient = p256_public_bytes(&secret.public_key());
    let shared = diffie_hellman(secret.to_nonzero_scalar(), ephemeral_key.as_affine());
    Ok(ecies_kek(shared.raw_secret_bytes().as_slice(), ephemeral, &recipient, info))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_round_trip_and_aad_binding() {
        let key = random_key();
        let sealed = seal(&key, b"secret", b"aad-1");
        assert_eq!(open(&key, &sealed.nonce, &sealed.ciphertext, b"aad-1").unwrap().as_slice(), b"secret");
        assert!(open(&key, &sealed.nonce, &sealed.ciphertext, b"aad-2").is_err());
        assert!(open(&random_key(), &sealed.nonce, &sealed.ciphertext, b"aad-1").is_err());
        let mut tampered = sealed.ciphertext.clone();
        tampered[0] ^= 1;
        assert!(open(&key, &sealed.nonce, &tampered, b"aad-1").is_err());
        assert!(open(&key, &sealed.nonce[..11], &sealed.ciphertext, b"aad-1").is_err());
    }

    #[test]
    fn open_key_rejects_wrong_length() {
        let key = random_key();
        let sealed = seal(&key, &[7u8; 31], b"");
        assert!(open_key(&key, &sealed.nonce, &sealed.ciphertext, b"").is_err());
    }

    #[test]
    fn ecies_round_trip_and_binding() {
        let secret = SecretKey::generate_from_rng(&mut os_rng());
        let public = p256_public_bytes(&secret.public_key());
        let (kek, ephemeral) = ecies_encapsulate(&public, b"info").unwrap();
        assert_eq!(*ecies_decapsulate(&secret, &ephemeral, b"info").unwrap(), *kek);
        assert_ne!(*ecies_decapsulate(&secret, &ephemeral, b"other").unwrap(), *kek);
        let other = SecretKey::generate_from_rng(&mut os_rng());
        assert_ne!(*ecies_decapsulate(&other, &ephemeral, b"info").unwrap(), *kek);
    }

    #[test]
    fn rejects_malformed_points() {
        assert!(parse_p256_public(&[0u8; 65]).is_err());
        let mut compressed = [0u8; 65];
        compressed[0] = 0x02;
        assert!(parse_p256_public(&compressed).is_err());
        let mut off_curve = [1u8; 65];
        off_curve[0] = 0x04;
        assert!(parse_p256_public(&off_curve).is_err());
    }

    #[test]
    fn argon2_is_deterministic_and_bounded() {
        let params = Argon2Params { m_kib: 8 * 1024, t: 1, p: 1 };
        let a = argon2id(b"pw", &[1u8; 16], params).unwrap();
        let b = argon2id(b"pw", &[1u8; 16], params).unwrap();
        let c = argon2id(b"pw", &[2u8; 16], params).unwrap();
        assert_eq!(*a, *b);
        assert_ne!(*a, *c);
        assert!(argon2id(b"pw", &[1u8; 16], Argon2Params { m_kib: 4 * 1024 * 1024, t: 1, p: 1 }).is_err());
        assert!(argon2id(b"pw", &[1u8; 16], Argon2Params { m_kib: 512 * 1024, t: 1, p: 1 }).is_err());
        assert!(argon2id(b"pw", &[1u8; 16], Argon2Params { m_kib: 8 * 1024, t: 16, p: 1 }).is_err());
        assert!(argon2id(b"pw", &[1u8; 16], Argon2Params { m_kib: 8 * 1024, t: 0, p: 1 }).is_err());
    }
}
