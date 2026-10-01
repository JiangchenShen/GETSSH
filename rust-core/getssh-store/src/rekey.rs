//! Moving a database to a new key. Ported from databaseKeys.ts: a closed file is re-encrypted on
//! a verified copy (integrity check and identical row counts) and only then renamed over the
//! original; an open connection is rekeyed in place. SQLite3MC rekeys in DELETE journal mode so a
//! fresh salt is written; the database goes back to WAL afterwards.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{Code, StoreError, StoreResult};
use crate::sqlite::{Connection, Key, Mode};

fn table_counts(conn: &Connection) -> StoreResult<BTreeMap<String, i64>> {
    let tables = conn.query_map("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'", &[], |row| {
        Ok(row.text(0)?.unwrap_or_default())
    })?;
    let mut counts = BTreeMap::new();
    for table in tables {
        let quoted = format!("\"{}\"", table.replace('"', "\"\""));
        let count = conn.query_row(&format!("SELECT count(*) FROM {quoted}"), &[], |row| row.integer(0))?;
        counts.insert(table, count);
    }
    Ok(counts)
}

fn assert_intact(conn: &Connection) -> StoreResult<()> {
    if !conn.integrity_check()? {
        return Err(StoreError::new(Code::Corrupt, "integrity check failed"));
    }
    Ok(())
}

fn sidecar(file: &Path, suffix: &str) -> PathBuf {
    let mut name = file.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

fn remove_with_sidecars(file: &Path) {
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let _ = fs::remove_file(sidecar(file, suffix));
    }
}

#[cfg(unix)]
fn owner_only(file: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(file, fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn owner_only(_file: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Re-encrypts `file` from `from` to `to` through a verified copy. The original is untouched
/// until the copy, opened with `to`, passes an integrity check with identical row counts.
pub fn rekey_file(file: &Path, from: &Key<'_>, to: &Key<'_>) -> StoreResult<()> {
    let temp = sidecar(file, &format!(".rekey-{}-{}", std::process::id(), getssh_keystore::crypto::random_id()));
    let result = (|| -> StoreResult<()> {
        let expected = {
            let source = Connection::open(file, from, Mode::ReadWrite)?;
            assert_intact(&source)?;
            let counts = table_counts(&source)?;
            source.execute_batch("PRAGMA journal_mode = DELETE")?;
            counts
        };
        fs::copy(file, &temp)?;
        owner_only(&temp)?;
        {
            let candidate = Connection::open(&temp, from, Mode::ReadWrite)?;
            candidate.execute_batch("PRAGMA journal_mode = DELETE")?;
            candidate.rekey(to)?;
        }
        {
            let verifier = Connection::open(&temp, to, Mode::ReadWrite)?;
            assert_intact(&verifier)?;
            if table_counts(&verifier)? != expected {
                return Err(StoreError::new(Code::Corrupt, "row counts changed while re-encrypting"));
            }
            verifier.execute_batch("PRAGMA journal_mode = WAL")?;
        }
        fs::rename(&temp, file)?;
        owner_only(file)?;
        for suffix in ["-wal", "-shm"] {
            let _ = fs::remove_file(sidecar(file, suffix));
        }
        Ok(())
    })();
    if result.is_err() {
        remove_with_sidecars(&temp);
    }
    result
}

/// Changes the key of an open connection in place.
pub fn rekey_open(conn: &Connection, to: &Key<'_>) -> StoreResult<()> {
    conn.execute_batch("PRAGMA journal_mode = DELETE")?;
    let result = conn.rekey(to).map_err(StoreError::from);
    conn.execute_batch("PRAGMA journal_mode = WAL")?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_moves_to_the_new_key_and_keeps_every_row() {
        let dir = std::env::temp_dir().join(format!("gs-rekey-{}", getssh_keystore::crypto::random_id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.db");
        let (old, new) = ([1u8; 32], [2u8; 32]);
        {
            let conn = Connection::open(&file, &Key::Raw(&old), Mode::Create).unwrap();
            conn.execute_batch("PRAGMA journal_mode = WAL; CREATE TABLE t (v); INSERT INTO t VALUES (1), (2), (3);").unwrap();
        }
        rekey_file(&file, &Key::Raw(&old), &Key::Raw(&new)).unwrap();
        assert!(Connection::open(&file, &Key::Raw(&old), Mode::ReadOnly).is_err());
        let conn = Connection::open(&file, &Key::Raw(&new), Mode::ReadOnly).unwrap();
        assert_eq!(conn.query_row("SELECT count(*) FROM t", &[], |r| r.integer(0)).unwrap(), 3);
        let leftovers: Vec<_> = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name()).filter(|n| n.to_string_lossy().contains("rekey")).collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_wrong_source_key_leaves_the_file_alone() {
        let dir = std::env::temp_dir().join(format!("gs-rekey-{}", getssh_keystore::crypto::random_id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.db");
        {
            let conn = Connection::open(&file, &Key::Raw(&[1; 32]), Mode::Create).unwrap();
            conn.execute_batch("CREATE TABLE t (v); INSERT INTO t VALUES (1);").unwrap();
        }
        let before = fs::read(&file).unwrap();
        assert!(rekey_file(&file, &Key::Raw(&[9; 32]), &Key::Raw(&[2; 32])).is_err());
        assert_eq!(fs::read(&file).unwrap(), before);
        let _ = fs::remove_dir_all(&dir);
    }
}
