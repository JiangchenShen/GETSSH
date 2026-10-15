//! SSH private keys kept in a workspace (stage B). The key and the passphrase it still needs are
//! sealed fields ("ssh_key|<id>|private", "ssh_key|<id>|passphrase") under the workspace's field
//! key; they leave the store only through connect_secrets. The main process reads, checks and
//! converts key files (electron/main/services/sshKeyFiles.ts) and hands over the key as ssh2
//! reads it with its SSH public key blob; the algorithm, fingerprint and public line come from
//! that blob.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use getssh_keystore::device::Device;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::error::{StoreError, StoreResult};
use crate::sqlite::{Row, SqlResult};
use crate::store::{now_ms, workspace_scope, Store};

const MAX_KEY_BYTES: usize = 64 * 1024;
const MAX_PASSPHRASE_BYTES: usize = 64 * 1024;
/// UTF-16 units, as the workspace names and store.fake.js count them.
const MAX_NAME_UNITS: usize = 128;

#[derive(Debug, Clone, PartialEq)]
pub struct SshKey {
    pub id: String,
    pub name: String,
    pub algorithm: String,
    pub fingerprint: String,
    pub public_key: String,
    pub has_passphrase: bool,
    pub created_at: i64,
}

pub fn private_context(id: &str) -> String {
    format!("ssh_key|{id}|private")
}

pub fn passphrase_context(id: &str) -> String {
    format!("ssh_key|{id}|passphrase")
}

struct Wire<'a> {
    bytes: &'a [u8],
}

impl<'a> Wire<'a> {
    fn string(&mut self) -> Option<&'a [u8]> {
        if self.bytes.len() < 4 {
            return None;
        }
        let length = u32::from_be_bytes([self.bytes[0], self.bytes[1], self.bytes[2], self.bytes[3]]) as usize;
        let rest = &self.bytes[4..];
        if rest.len() < length {
            return None;
        }
        let (value, after) = rest.split_at(length);
        self.bytes = after;
        Some(value)
    }
}

fn bit_length(bytes: &[u8]) -> usize {
    match bytes.iter().position(|&b| b != 0) {
        Some(start) => (bytes.len() - start - 1) * 8 + (8 - bytes[start].leading_zeros() as usize),
        None => 0,
    }
}

/// The key type and the algorithm name of an SSH public key blob: ssh-ed25519, ssh-rsa (named by
/// its modulus size), the NIST ECDSA curves and ssh-dss. Anything else, a missing field or
/// trailing bytes is refused.
pub fn describe_public_key(blob: &[u8]) -> StoreResult<(String, String)> {
    let refuse = || StoreError::invalid("publicKey is not an SSH public key this store accepts");
    let mut wire = Wire { bytes: blob };
    let kind = std::str::from_utf8(wire.string().ok_or_else(refuse)?).map_err(|_| refuse())?.to_string();
    let algorithm = match kind.as_str() {
        "ssh-ed25519" => {
            if wire.string().ok_or_else(refuse)?.len() != 32 {
                return Err(refuse());
            }
            "ed25519".to_string()
        }
        "ssh-rsa" => {
            wire.string().ok_or_else(refuse)?;
            format!("rsa-{}", bit_length(wire.string().ok_or_else(refuse)?))
        }
        "ecdsa-sha2-nistp256" | "ecdsa-sha2-nistp384" | "ecdsa-sha2-nistp521" => {
            let curve = &kind["ecdsa-sha2-".len()..];
            if wire.string().ok_or_else(refuse)? != curve.as_bytes() || wire.string().ok_or_else(refuse)?.is_empty() {
                return Err(refuse());
            }
            format!("ecdsa-p{}", &curve["nist".len() + 1..])
        }
        "ssh-dss" => {
            for _ in 0..4 {
                wire.string().ok_or_else(refuse)?;
            }
            "dsa".to_string()
        }
        _ => return Err(refuse()),
    };
    if !wire.bytes.is_empty() {
        return Err(refuse());
    }
    Ok((kind, algorithm))
}

/// "SHA256:" and the unpadded base64 SHA-256 of the blob, as ssh-keygen -l prints it.
pub fn fingerprint(blob: &[u8]) -> String {
    format!("SHA256:{}", STANDARD.encode(Sha256::digest(blob)).trim_end_matches('='))
}

fn check_name(name: &str) -> StoreResult<()> {
    if name.trim().is_empty() || name.encode_utf16().count() > MAX_NAME_UNITS || name.chars().any(|c| matches!(c, '\u{0}'..='\u{1f}' | '\u{7f}')) {
        return Err(StoreError::invalid("name must have 1 to 128 characters and no control characters"));
    }
    Ok(())
}

const KEY_LIST: &str = "id, name, algorithm, fingerprint, public_key, has_passphrase, created_at";

fn read_key(row: &Row<'_, '_>) -> SqlResult<SshKey> {
    Ok(SshKey {
        id: row.text(0)?.unwrap_or_default(),
        name: row.text(1)?.unwrap_or_default(),
        algorithm: row.text(2)?.unwrap_or_default(),
        fingerprint: row.text(3)?.unwrap_or_default(),
        public_key: row.text(4)?.unwrap_or_default(),
        has_passphrase: row.optional_integer(5)?.unwrap_or(0) != 0,
        created_at: row.optional_integer(6)?.unwrap_or(0),
    })
}

impl<D: Device> Store<D> {
    /// Stores a key; `data` is the key as ssh2 reads it, `public_key` its SSH public key blob.
    pub fn import_ssh_key(&self, workspace_id: &str, name: &str, data: &[u8], passphrase: Option<&str>, public_key: &[u8]) -> StoreResult<SshKey> {
        check_name(name)?;
        if data.is_empty() || data.len() > MAX_KEY_BYTES {
            return Err(StoreError::invalid("data must be a Buffer of 1 to 65536 bytes"));
        }
        if passphrase.is_some_and(|p| p.len() > MAX_PASSPHRASE_BYTES || p.contains('\0')) {
            return Err(StoreError::invalid("passphrase is too long or has a NUL character"));
        }
        let (kind, algorithm) = describe_public_key(public_key)?;
        let scope = workspace_scope(workspace_id)?;
        let id = getssh_keystore::crypto::random_id();
        let key = SshKey {
            id: id.clone(),
            name: name.to_string(),
            algorithm,
            fingerprint: fingerprint(public_key),
            public_key: format!("{kind} {} {name}", STANDARD.encode(public_key)),
            has_passphrase: passphrase.is_some(),
            created_at: now_ms(),
        };
        self.with_workspace(workspace_id, |conn| {
            let ks = self.keystore();
            let sealed_key = ks.seal_field(&scope, &private_context(&id), data)?;
            let sealed_passphrase = match passphrase {
                Some(value) => Some(ks.seal_field(&scope, &passphrase_context(&id), Zeroizing::new(value.as_bytes().to_vec()).as_slice())?),
                None => None,
            };
            conn.execute(
                "INSERT INTO ssh_keys (id, name, algorithm, fingerprint, public_key, private_key, has_passphrase, created_at, passphrase) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                &[
                    key.id.as_str().into(),
                    key.name.as_str().into(),
                    key.algorithm.as_str().into(),
                    key.fingerprint.as_str().into(),
                    key.public_key.as_str().into(),
                    sealed_key.into(),
                    key.has_passphrase.into(),
                    key.created_at.into(),
                    sealed_passphrase.into(),
                ],
            )?;
            Ok(())
        })?;
        Ok(key)
    }

    /// Oldest first; ties (the same millisecond) in the order they were stored.
    pub fn list_ssh_keys(&self, workspace_id: &str) -> StoreResult<Vec<SshKey>> {
        workspace_scope(workspace_id)?;
        self.with_workspace(workspace_id, |conn| Ok(conn.query_map(&format!("SELECT {KEY_LIST} FROM ssh_keys ORDER BY created_at, rowid"), &[], read_key)?))
    }

    /// Deletes the key; profiles that used it keep their row with keyId NULL.
    pub fn delete_ssh_key(&self, workspace_id: &str, id: &str) -> StoreResult<()> {
        workspace_scope(workspace_id)?;
        self.with_workspace(workspace_id, |conn| {
            let known = conn.query_optional("SELECT 1 FROM ssh_keys WHERE id = ?", &[id.into()], |r| r.optional_integer(0))?.is_some();
            if !known {
                return Err(StoreError::not_found(format!("SSH key \"{id}\" does not exist")));
            }
            conn.execute_batch("PRAGMA secure_delete = ON")?;
            conn.transaction(|c| {
                c.execute("UPDATE profiles SET keyId = NULL WHERE keyId = ?", &[id.into()])?;
                c.execute("DELETE FROM ssh_keys WHERE id = ?", &[id.into()])?;
                Ok(())
            })?;
            Ok(())
        })
    }

    /// The passphrase stored with a key, if it has one. Main process only (connect_secrets).
    pub(crate) fn ssh_key_passphrase(&self, workspace_id: &str, key_id: &str) -> StoreResult<Option<Zeroizing<Vec<u8>>>> {
        let scope = workspace_scope(workspace_id)?;
        let sealed = self.with_workspace(workspace_id, |conn| {
            Ok(conn.query_optional("SELECT passphrase FROM ssh_keys WHERE id = ?", &[key_id.into()], |r| r.text(0))?.flatten())
        })?;
        match sealed {
            Some(sealed) if !sealed.is_empty() => Ok(Some(self.keystore().open_field(&scope, &passphrase_context(key_id), &sealed)?)),
            _ => Ok(None),
        }
    }
}
