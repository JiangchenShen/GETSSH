//! Recovery codes: 128 random bits plus a 32-bit checksum, written as 32 Crockford base32
//! characters in groups of four. The code deterministically yields a P-256 key pair; only the
//! public key is stored, so keys can be wrapped for recovery without the code being present.

use p256::SecretKey;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::crypto::{self, P256_PUBLIC_LEN};
use crate::error::KsError;

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENTROPY_LEN: usize = 16;
const CHECKSUM_LEN: usize = 4;
const RAW_LEN: usize = ENTROPY_LEN + CHECKSUM_LEN;
const CODE_CHARS: usize = RAW_LEN * 8 / 5;
const SALT: &[u8] = b"getssh-recovery/v1";

pub struct RecoveryCode {
    entropy: Zeroizing<[u8; ENTROPY_LEN]>,
}

fn checksum(entropy: &[u8; ENTROPY_LEN]) -> [u8; CHECKSUM_LEN] {
    let digest = Sha256::new().chain_update(b"getssh-recovery/v1/checksum").chain_update(entropy).finalize();
    let mut out = [0u8; CHECKSUM_LEN];
    out.copy_from_slice(&digest[..CHECKSUM_LEN]);
    out
}

fn symbol_value(c: char) -> Option<u8> {
    let c = match c.to_ascii_uppercase() {
        'O' => '0',
        'I' | 'L' => '1',
        other => other,
    };
    ALPHABET.iter().position(|&a| a as char == c).map(|i| i as u8)
}

impl RecoveryCode {
    pub fn generate() -> Self {
        Self { entropy: Zeroizing::new(crypto::random_array::<ENTROPY_LEN>()) }
    }

    /// Accepts any case, dashes and spaces, and the usual Crockford look-alikes (O→0, I/L→1).
    pub fn parse(input: &str) -> Result<Self, KsError> {
        let mut values = Zeroizing::new(Vec::with_capacity(CODE_CHARS));
        for c in input.chars() {
            if c == '-' || c.is_whitespace() {
                continue;
            }
            values.push(symbol_value(c).ok_or(KsError::InvalidRecoveryCode)?);
            if values.len() > CODE_CHARS {
                return Err(KsError::InvalidRecoveryCode);
            }
        }
        if values.len() != CODE_CHARS {
            return Err(KsError::InvalidRecoveryCode);
        }
        let mut raw = Zeroizing::new([0u8; RAW_LEN]);
        let (mut acc, mut bits, mut pos) = (0u64, 0u32, 0usize);
        for &v in values.iter() {
            acc = (acc << 5) | v as u64;
            bits += 5;
            while bits >= 8 {
                bits -= 8;
                raw[pos] = (acc >> bits) as u8;
                pos += 1;
            }
            acc &= (1u64 << bits) - 1;
        }
        let mut entropy = Zeroizing::new([0u8; ENTROPY_LEN]);
        entropy.copy_from_slice(&raw[..ENTROPY_LEN]);
        if !crypto::ct_eq(&checksum(&entropy), &raw[ENTROPY_LEN..]) {
            return Err(KsError::InvalidRecoveryCode);
        }
        Ok(Self { entropy })
    }

    /// "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
    pub fn display(&self) -> Zeroizing<String> {
        let mut raw = Zeroizing::new([0u8; RAW_LEN]);
        raw[..ENTROPY_LEN].copy_from_slice(self.entropy.as_slice());
        raw[ENTROPY_LEN..].copy_from_slice(&checksum(&self.entropy));
        let mut out = Zeroizing::new(String::with_capacity(CODE_CHARS + CODE_CHARS / 4));
        let (mut acc, mut bits, mut written) = (0u64, 0u32, 0usize);
        for &byte in raw.iter() {
            acc = (acc << 8) | byte as u64;
            bits += 8;
            while bits >= 5 {
                bits -= 5;
                if written > 0 && written % 4 == 0 {
                    out.push('-');
                }
                out.push(ALPHABET[((acc >> bits) & 31) as usize] as char);
                written += 1;
            }
            acc &= (1u64 << bits) - 1;
        }
        out
    }

    pub fn secret_key(&self) -> SecretKey {
        for counter in 0u32..=255 {
            let candidate = crypto::hkdf32(self.entropy.as_slice(), SALT, format!("p256-key/{counter}").as_bytes());
            if let Ok(key) = SecretKey::from_slice(candidate.as_slice()) {
                return key;
            }
        }
        // Each attempt fails with probability < 2^-32.
        unreachable!("no valid P-256 scalar in 256 attempts")
    }

    pub fn public_key(&self) -> [u8; P256_PUBLIC_LEN] {
        crypto::p256_public_bytes(&self.secret_key().public_key())
    }
}

/// Identifier of a recovery public key, stored next to wraps made for it.
pub fn recovery_id(public_key: &[u8]) -> String {
    crypto::to_hex(&Sha256::digest(public_key)[..8])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_formats() {
        let code = RecoveryCode::generate();
        let text = code.display();
        assert_eq!(text.len(), 39);
        assert_eq!(text.split('-').count(), 8);
        assert!(text.split('-').all(|group| group.len() == 4));
        let parsed = RecoveryCode::parse(&text).unwrap();
        assert_eq!(parsed.public_key(), code.public_key());
    }

    #[test]
    fn tolerates_case_spacing_and_lookalikes() {
        let code = RecoveryCode::generate();
        let text = code.display().to_string();
        let loose = text.to_lowercase().replace('-', " ").replace('0', "o").replace('1', "l");
        assert_eq!(RecoveryCode::parse(&loose).unwrap().public_key(), code.public_key());
    }

    #[test]
    fn rejects_typos_and_wrong_lengths() {
        let text = RecoveryCode::generate().display().to_string();
        let mut chars: Vec<char> = text.chars().collect();
        let i = chars.iter().position(|c| *c != '-').unwrap();
        chars[i] = if chars[i] == 'A' { 'B' } else { 'A' };
        let typo: String = chars.into_iter().collect();
        assert_eq!(RecoveryCode::parse(&typo).err(), Some(KsError::InvalidRecoveryCode));
        assert!(RecoveryCode::parse(&text[..text.len() - 1]).is_err());
        assert!(RecoveryCode::parse(&format!("{text}A")).is_err());
        assert!(RecoveryCode::parse("").is_err());
        assert!(RecoveryCode::parse(&text.replace('-', "U")).is_err());
    }

    #[test]
    fn distinct_codes_give_distinct_keys() {
        let a = RecoveryCode::generate();
        let b = RecoveryCode::generate();
        assert_ne!(a.public_key(), b.public_key());
        assert_ne!(recovery_id(&a.public_key()), recovery_id(&b.public_key()));
        assert_eq!(recovery_id(&a.public_key()).len(), 16);
    }
}
