#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use napi::bindgen_prelude::*;
use pbkdf2::pbkdf2_hmac;
use rand::Rng;
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Zeroize, ZeroizeOnDrop)]
struct SecretKey(Vec<u8>);

impl SecretKey {
    fn new(len: usize) -> Self {
        Self(vec![0; len])
    }
}

/// Zeroize-on-drop wrapper for intermediate encrypted/decrypted data.
/// Prevents sensitive bytes from lingering in heap memory after an early return or failure.
#[derive(Zeroize, ZeroizeOnDrop)]
struct SensitiveBuffer(Vec<u8>);

const MAGIC_V2: &[u8] = b"GETSSH_V2";

fn decrypt_vault_inner(master_password: &[u8], encrypted_payload: &[u8]) -> std::result::Result<Vec<u8>, String> {
    // Determine format by checking for the V2 magic header
    let is_v2 = encrypted_payload.starts_with(MAGIC_V2);

    let (salt, iv, auth_tag, ciphertext) = if is_v2 {
        // --- V2 Format Parsing ---
        // Minimum header = 9 (magic) + 32 (salt) + 12 (iv) + 16 (auth_tag) = 69 bytes
        if encrypted_payload.len() < 69 {
            return Err("Invalid V2 encrypted profile: too short".to_string());
        }
        (
            &encrypted_payload[9..41],  // 32 bytes salt
            &encrypted_payload[41..53], // 12 bytes IV
            &encrypted_payload[53..69], // 16 bytes AuthTag
            &encrypted_payload[69..],   // Ciphertext
        )
    } else {
        // --- V1 Format Parsing (Legacy Compatibility) ---
        // Minimum header = 16 (salt) + 12 (iv) + 16 (auth_tag) = 44 bytes
        if encrypted_payload.len() < 44 {
            return Err("Invalid V1 encrypted profile: too short".to_string());
        }
        (
            &encrypted_payload[0..16],  // 16 bytes salt
            &encrypted_payload[16..28], // 12 bytes IV
            &encrypted_payload[28..44], // 16 bytes AuthTag
            &encrypted_payload[44..],   // Ciphertext
        )
    };

    // PBKDF2 key derivation (100,000 iterations, SHA-256)
    let mut key = SecretKey::new(32);
    pbkdf2_hmac::<Sha256>(master_password, salt, 100000, &mut key.0);

    // Initialize cipher
    let cipher = Aes256Gcm::new_from_slice(&key.0)
        .map_err(|e| format!("Invalid key length: {}", e))?;

    let nonce = Nonce::try_from(iv).map_err(|_| "Invalid IV length".to_string())?;

    // aes-gcm expects `ciphertext + auth_tag` as a single slice.
    // Wrap in SensitiveBuffer so it is zeroized on drop regardless of success/failure.
    let encrypted_data = SensitiveBuffer({
        let mut v = Vec::with_capacity(ciphertext.len() + auth_tag.len());
        v.extend_from_slice(ciphertext);
        v.extend_from_slice(auth_tag);
        v
    });

    // Decrypt — SensitiveBuffer is dropped (and zeroized) at end of scope.
    let mut plaintext = cipher
        .decrypt(&nonce, Payload { msg: &encrypted_data.0, aad: &[] })
        .map_err(|_| "Invalid master password or corrupted file".to_string())?;

    // We can't automatically zeroize the returned Buffer because ownership passes to Node.js.
    // The TypeScript layer MUST explicitly call `buffer.fill(0)` after use.
    let result = plaintext.clone();

    // Zeroize local temporary plaintext before exit (even though we cloned it).
    plaintext.zeroize();

    Ok(result)
}

/// Decrypts the vault payload.
/// Supports both V1 (legacy) and V2 (modern) formats.
/// V2 format: [Magic "GETSSH_V2" 9B] [Salt 32B] [IV 12B] [AuthTag 16B] [Ciphertext]
/// V1 format: [Salt 16B] [IV 12B] [AuthTag 16B] [Ciphertext]
#[napi]
pub fn decrypt_vault(master_password: Buffer, encrypted_payload: Buffer) -> Result<Buffer> {
    decrypt_vault_inner(master_password.as_ref(), encrypted_payload.as_ref())
        .map(|v| v.into())
        .map_err(Error::from_reason)
}

fn encrypt_vault_inner(master_password: &[u8], payload: &[u8]) -> std::result::Result<Vec<u8>, String> {
    let mut rng = rand::rng();

    // V2 Format: Salt increased to 32 bytes per NIST SP 800-132.
    let mut salt = [0u8; 32];
    rng.fill_bytes(&mut salt);

    let mut iv = [0u8; 12];
    rng.fill_bytes(&mut iv);

    // PBKDF2 key derivation (100,000 iterations, SHA-256)
    let mut key = SecretKey::new(32);
    pbkdf2_hmac::<Sha256>(master_password, &salt, 100000, &mut key.0);

    // Initialize cipher
    let cipher = Aes256Gcm::new_from_slice(&key.0)
        .map_err(|e| format!("Invalid key length: {}", e))?;

    let nonce = Nonce::from(iv);

    // Encrypt — wrap result in SensitiveBuffer so it is zeroized on drop
    // on ALL exit paths, including early-return error cases.
    let encrypted_data = SensitiveBuffer(
        cipher
            .encrypt(&nonce, Payload { msg: payload, aad: &[] })
            .map_err(|e| format!("Encryption failed: {}", e))?,
    );

    // aes-gcm appends the 16-byte tag to the ciphertext automatically.
    if encrypted_data.0.len() < 16 {
        return Err("Encryption failed: missing auth tag".to_string());
    }

    let tag_start = encrypted_data.0.len() - 16;
    let auth_tag = &encrypted_data.0[tag_start..];
    let ciphertext = &encrypted_data.0[..tag_start];

    let mut output = Vec::with_capacity(MAGIC_V2.len() + 32 + 12 + 16 + ciphertext.len());
    output.extend_from_slice(MAGIC_V2);
    output.extend_from_slice(&salt);
    output.extend_from_slice(&iv);
    output.extend_from_slice(auth_tag);
    output.extend_from_slice(ciphertext);

    // SensitiveBuffer is dropped and zeroized here automatically.
    Ok(output)
}

/// Encrypts the vault payload into V2 format.
/// Returns format: [Magic "GETSSH_V2" 9B] [Salt 32B] [IV 12B] [AuthTag 16B] [Ciphertext]
#[napi]
pub fn encrypt_vault(master_password: Buffer, payload: Buffer) -> Result<Buffer> {
    encrypt_vault_inner(master_password.as_ref(), payload.as_ref())
        .map(|v| v.into())
        .map_err(Error::from_reason)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_v2() {
        let password = b"my_super_secret_password";
        let payload = b"this is some secret payload data";

        // Encrypt
        let encrypted = encrypt_vault_inner(password, payload).expect("Encryption failed");

        // Verify V2 header
        assert!(encrypted.starts_with(MAGIC_V2));

        // Decrypt
        let decrypted = decrypt_vault_inner(password, &encrypted).expect("Decryption failed");

        // Verify payload matches
        assert_eq!(payload.as_slice(), decrypted.as_slice());
    }

    #[test]
    fn test_decrypt_wrong_password() {
        let password = b"correct_password";
        let wrong_password = b"wrong_password";
        let payload = b"secret data";

        let encrypted = encrypt_vault_inner(password, payload).expect("Encryption failed");

        let result = decrypt_vault_inner(wrong_password, &encrypted);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Invalid master password or corrupted file");
    }

    #[test]
    fn test_decrypt_invalid_v2_payload() {
        let password = b"password";
        // Header requires 69 bytes, let's provide a valid magic but too short
        let mut invalid_payload = Vec::from(MAGIC_V2);
        invalid_payload.extend_from_slice(b"too_short");

        let result = decrypt_vault_inner(password, &invalid_payload);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Invalid V2 encrypted profile: too short");
    }
}

/// Files written by an earlier build (aes-gcm 0.10, pbkdf2 0.12, generated 2026-10-02). Every
/// later build must still decrypt them, or exported profiles become unreadable.
#[cfg(test)]
mod golden_tests {
    use super::*;

    fn unhex(h: &str) -> Vec<u8> {
        (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect()
    }

    const V2: &str = "4745545353485f5632378744bf28132d8634ea3de331fcb5f8b3e284f89fa66b63e13dd0a733b57c19f1735a777dcb07faaa7c20f9c94ffcfbdedceb8f0be49aaeed2ead6ae8f794b1ba1b8265f91d7ac86b6b2fdacf5feb63";
    const V1: &str = "050505050505050505050505050505050606060606060606060606065d6e4c12f64bdf7ef170c6f6e37ccd08750cefb19707925903007533c8ebca2efe";

    #[test]
    fn v2_files_from_an_earlier_build_decrypt() {
        assert_eq!(decrypt_vault_inner(b"golden vault password", &unhex(V2)).unwrap(), b"golden vault payload");
        assert!(decrypt_vault_inner(b"wrong password", &unhex(V2)).is_err());
    }

    #[test]
    fn v1_files_from_an_earlier_build_decrypt() {
        assert_eq!(decrypt_vault_inner(b"golden vault password", &unhex(V1)).unwrap(), b"legacy v1 payload");
    }
}
