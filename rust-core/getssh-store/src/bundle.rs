//! Encrypted export bundles (.getssh-backup), docs/GETSSH_STORE_DESIGN_CN.md §5.
//!
//! ```text
//! "GETSSHBK" | u16 format | u32 len | header JSON (plain: KDF parameters, dates)
//!            | u32 len | key block: nonce ‖ AES-256-GCM(Argon2id(password, salt), aad = all of the above)
//!            | chunk*: u32 len | nonce ‖ AES-256-GCM(payload key, aad = header digest ‖ index ‖ last)
//! ```
//!
//! The key block holds each exported scope's key version (getssh-keystore ScopeExport), the list
//! of workspaces and the files of the payload. The payload is those files concatenated; every
//! 64 KiB chunk is bound to its position and to whether it is the last one, so a reordered,
//! truncated or extended bundle does not open. Databases travel as they are (already encrypted
//! with their own keys); importing moves the exported key versions into a new keyring, so
//! nothing is re-encrypted and existing passwords keep working.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use getssh_keystore::crypto::{self, Argon2Params, Key32};
use getssh_keystore::device::Device;
use getssh_keystore::keyring::{KeyVersion, APP, B64};
use getssh_keystore::store::ScopeExport;
use getssh_keystore::Keystore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use crate::error::{Code, StoreError, StoreResult};
use crate::sqlite::{Connection, Key, Mode};
use crate::store::{master_password_too_short, now_ms, validate_workspace_id, Store, DATABASE_LABEL};

const MAGIC: &[u8; 8] = b"GETSSHBK";
const FORMAT_VERSION: u16 = 1;
const CHUNK: usize = 64 * 1024;
const TAG: usize = 16;
const NONCE: usize = 12;
const MAX_HEADER: usize = 64 * 1024;
const MAX_KEY_BLOCK: usize = 4 * 1024 * 1024;
const MAX_FILES: usize = 1024;
/// Optional small files that travel with the databases.
const SIDE_FILES: &[&str] = &["app-config.json", "mcp_servers.json"];
/// Key material of older layouts; an import never carries it into the new directory.
const LEGACY_KEY_FILES: &[&str] = &["app_key.enc", "app_key.txt", "vault.key"];

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Header {
    format_version: u16,
    created_at: i64,
    app_version: String,
    kdf: Kdf,
    chunk_size: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Kdf {
    algorithm: String,
    m_kib: u32,
    t: u32,
    p: u32,
    salt: B64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KeyBlock {
    payload_key: B64,
    scopes: Vec<ExportedScope>,
    workspaces: Vec<BundleWorkspace>,
    files: Vec<BundleFile>,
}

impl Drop for KeyBlock {
    fn drop(&mut self) {
        self.payload_key.0.zeroize();
        for scope in &mut self.scopes {
            scope.key.0.zeroize();
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExportedScope {
    scope_id: String,
    key: B64,
    version: KeyVersion,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BundleWorkspace {
    pub id: String,
    pub name: String,
    pub has_password: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BundleFile {
    name: String,
    size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleInfo {
    pub format_version: u16,
    pub created_at: i64,
    pub app_version: String,
    pub workspaces: Vec<BundleWorkspace>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportReport {
    pub path: PathBuf,
    pub workspace_ids: Vec<String>,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportReport {
    pub workspace_ids: Vec<String>,
    pub backup_path: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportCandidate {
    pub id: String,
    pub name: String,
    pub is_main: bool,
    pub open: bool,
    pub unlock_with: Vec<&'static str>,
    pub profile_count: i64,
}

fn corrupt(what: &str) -> StoreError {
    StoreError::new(Code::Corrupt, format!("the bundle is damaged or not a GETSSH backup ({what})"))
}

/// Names a bundle may contain; anything else is refused before a byte is written.
fn allowed_name(name: &str) -> bool {
    if name == "main.db" || SIDE_FILES.contains(&name) {
        return true;
    }
    name.strip_prefix("workspace_").and_then(|rest| rest.strip_suffix(".db")).is_some_and(|id| validate_workspace_id(id).is_ok())
}

fn sibling_dir(base: &Path, label: &str) -> StoreResult<PathBuf> {
    let parent = base.parent().ok_or_else(|| StoreError::invalid("the data directory has no parent"))?;
    let name = base.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "getssh".into());
    let dir = parent.join(format!(".{name}-{label}-{}", crypto::random_id()));
    fs::create_dir(&dir)?;
    restrict(&dir, 0o700)?;
    Ok(dir)
}

#[cfg(unix)]
fn restrict(path: &Path, mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn restrict(_path: &Path, _mode: u32) -> std::io::Result<()> {
    Ok(())
}

/// Removes a staging directory when dropped.
struct Staging(PathBuf);

impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn chunk_aad(header_digest: &[u8], index: u64, last: bool) -> Vec<u8> {
    let mut aad = Vec::with_capacity(32 + 9 + 16);
    aad.extend_from_slice(b"getssh-bundle/v1|chunk|");
    aad.extend_from_slice(header_digest);
    aad.extend_from_slice(&index.to_be_bytes());
    aad.push(last as u8);
    aad
}

fn kek(password: &str, kdf: &Kdf) -> StoreResult<Key32> {
    if kdf.algorithm != "argon2id" {
        return Err(corrupt("unknown key derivation"));
    }
    let params = Argon2Params { m_kib: kdf.m_kib, t: kdf.t, p: kdf.p };
    if !params.is_acceptable() || kdf.salt.0.len() != 16 {
        return Err(corrupt("key derivation parameters out of range"));
    }
    use unicode_normalization::UnicodeNormalization;
    let normalized = Zeroizing::new(password.nfc().collect::<String>());
    Ok(crypto::argon2id(normalized.as_bytes(), &kdf.salt.0, params)?)
}

/// Writes the payload in authenticated chunks.
struct ChunkWriter<'a, W: Write> {
    out: W,
    key: &'a Key32,
    digest: [u8; 32],
    buffer: Zeroizing<Vec<u8>>,
    index: u64,
    written: u64,
}

impl<W: Write> ChunkWriter<'_, W> {
    fn emit(&mut self, last: bool) -> StoreResult<()> {
        let sealed = crypto::seal(self.key, &self.buffer, &chunk_aad(&self.digest, self.index, last));
        let len = (NONCE + sealed.ciphertext.len()) as u32;
        self.out.write_all(&len.to_le_bytes())?;
        self.out.write_all(&sealed.nonce)?;
        self.out.write_all(&sealed.ciphertext)?;
        self.written += 4 + len as u64;
        self.index += 1;
        self.buffer.clear();
        Ok(())
    }

    fn write(&mut self, mut data: &[u8]) -> StoreResult<()> {
        while !data.is_empty() {
            let take = (CHUNK - self.buffer.len()).min(data.len());
            self.buffer.extend_from_slice(&data[..take]);
            data = &data[take..];
            if self.buffer.len() == CHUNK {
                self.emit(false)?;
            }
        }
        Ok(())
    }

    fn finish(mut self) -> StoreResult<(W, u64)> {
        self.emit(true)?;
        Ok((self.out, self.written))
    }
}

/// Reads the payload back, chunk by chunk, verifying order and the final chunk.
struct ChunkReader<'a, R: Read> {
    input: R,
    key: &'a Key32,
    digest: [u8; 32],
    plain: Zeroizing<Vec<u8>>,
    position: usize,
    index: u64,
    done: bool,
}

impl<R: Read> ChunkReader<'_, R> {
    fn next_chunk(&mut self) -> StoreResult<()> {
        let mut len = [0u8; 4];
        self.input.read_exact(&mut len).map_err(|_| corrupt("truncated"))?;
        let len = u32::from_le_bytes(len) as usize;
        if !(NONCE + TAG..=NONCE + CHUNK + TAG).contains(&len) {
            return Err(corrupt("chunk size"));
        }
        let mut data = vec![0u8; len];
        self.input.read_exact(&mut data).map_err(|_| corrupt("truncated"))?;
        let (nonce, ciphertext) = data.split_at(NONCE);
        // The writer emits every full chunk at once, so the final chunk is always shorter (maybe
        // empty) and every full one is not final. The flag is authenticated either way.
        let last = ciphertext.len() < CHUNK + TAG;
        let plain = crypto::open(self.key, nonce, ciphertext, &chunk_aad(&self.digest, self.index, last)).map_err(|_| corrupt("a chunk does not authenticate"))?;
        self.plain = plain;
        self.position = 0;
        self.index += 1;
        self.done = last;
        Ok(())
    }

    fn read_exact(&mut self, mut out: impl Write, mut size: u64) -> StoreResult<()> {
        while size > 0 {
            if self.position == self.plain.len() {
                if self.done {
                    return Err(corrupt("the payload ends early"));
                }
                self.next_chunk()?;
            }
            let take = ((self.plain.len() - self.position) as u64).min(size) as usize;
            out.write_all(&self.plain[self.position..self.position + take])?;
            self.position += take;
            size -= take as u64;
        }
        Ok(())
    }

    /// After the last file: the stream must end exactly with the final chunk.
    fn finish(mut self) -> StoreResult<()> {
        if !self.done {
            if self.position != self.plain.len() {
                return Err(corrupt("unexpected data"));
            }
            self.next_chunk()?;
        }
        if self.position != self.plain.len() || !self.done {
            return Err(corrupt("unexpected data"));
        }
        let mut extra = [0u8; 1];
        if self.input.read(&mut extra)? != 0 {
            return Err(corrupt("data after the end"));
        }
        Ok(())
    }
}

struct Opened {
    header: Header,
    digest: [u8; 32],
    keys: KeyBlock,
    file: File,
}

fn read_u32(file: &mut File) -> StoreResult<u32> {
    let mut bytes = [0u8; 4];
    file.read_exact(&mut bytes).map_err(|_| corrupt("truncated"))?;
    Ok(u32::from_le_bytes(bytes))
}

/// Opens a bundle up to its payload: header, password, key block.
fn open_bundle(path: &Path, password: &str) -> StoreResult<Opened> {
    let mut file = File::open(path).map_err(|e| StoreError::new(Code::NotFound, format!("backup file: {e}")))?;
    let mut magic = [0u8; 10];
    file.read_exact(&mut magic).map_err(|_| corrupt("too short"))?;
    if &magic[..8] != MAGIC {
        return Err(corrupt("not a GETSSH backup"));
    }
    if u16::from_le_bytes([magic[8], magic[9]]) != FORMAT_VERSION {
        return Err(StoreError::new(Code::Unavailable, "this backup was made by a newer GETSSH"));
    }
    let header_len = read_u32(&mut file)? as usize;
    if header_len == 0 || header_len > MAX_HEADER {
        return Err(corrupt("header size"));
    }
    let mut header_bytes = vec![0u8; header_len];
    file.read_exact(&mut header_bytes).map_err(|_| corrupt("truncated"))?;
    let header: Header = serde_json::from_slice(&header_bytes).map_err(|_| corrupt("header"))?;
    if header.format_version != FORMAT_VERSION || header.chunk_size as usize != CHUNK {
        return Err(corrupt("header values"));
    }
    let mut prefix = Vec::with_capacity(14 + header_len);
    prefix.extend_from_slice(&magic);
    prefix.extend_from_slice(&(header_len as u32).to_le_bytes());
    prefix.extend_from_slice(&header_bytes);
    let digest: [u8; 32] = Sha256::digest(&prefix).into();

    let block_len = read_u32(&mut file)? as usize;
    if !(NONCE + TAG..=MAX_KEY_BLOCK).contains(&block_len) {
        return Err(corrupt("key block size"));
    }
    let mut block = vec![0u8; block_len];
    file.read_exact(&mut block).map_err(|_| corrupt("truncated"))?;
    let kek = kek(password, &header.kdf)?;
    let (nonce, ciphertext) = block.split_at(NONCE);
    let plain = crypto::open(&kek, nonce, ciphertext, &prefix).map_err(|_| StoreError::new(Code::WrongPassword, ""))?;
    let keys: KeyBlock = serde_json::from_slice(&plain).map_err(|_| corrupt("key block"))?;
    if keys.payload_key.0.len() != 32 || keys.files.len() > MAX_FILES || !keys.files.iter().all(|f| allowed_name(&f.name)) {
        return Err(corrupt("key block contents"));
    }
    if !keys.scopes.iter().any(|s| s.scope_id == APP) || keys.scopes.iter().any(|s| s.key.0.len() != 32) {
        return Err(corrupt("key block scopes"));
    }
    Ok(Opened { header, digest, keys, file })
}

fn key32(bytes: &[u8]) -> Key32 {
    let mut key = Zeroizing::new([0u8; 32]);
    key.copy_from_slice(bytes);
    key
}

impl<D: Device> Store<D> {
    /// The workspaces the export dialog lists.
    pub fn export_candidates(&self) -> StoreResult<Vec<ExportCandidate>> {
        let master = self.keystore().status().app_protected;
        let mut out = Vec::new();
        for w in self.list_workspaces()? {
            let mut unlock_with = Vec::new();
            if !w.open {
                if w.presence_enabled {
                    unlock_with.push("presence");
                }
                if w.has_password || master {
                    unlock_with.push("password");
                }
            }
            let profile_count = if w.open { self.workspace_stats(&w.id).map(|s| s.profile_count).unwrap_or(0) } else { 0 };
            out.push(ExportCandidate { id: w.id, name: w.name, is_main: w.is_main, open: w.open, unlock_with, profile_count });
        }
        Ok(out)
    }

    pub fn export_bundle(&self, path: &Path, password: &str, workspace_ids: &[String], app_version: &str) -> StoreResult<ExportReport> {
        if self.must_change_master() {
            return Err(StoreError::new(Code::MustChangeMasterPassword, ""));
        }
        if master_password_too_short(password) {
            return Err(StoreError::invalid("the export password needs at least 12 characters"));
        }
        if workspace_ids.is_empty() {
            return Err(StoreError::invalid("choose at least one workspace"));
        }
        let mut unique = workspace_ids.to_vec();
        unique.sort();
        unique.dedup();
        if unique.len() != workspace_ids.len() {
            return Err(StoreError::invalid("a workspace is listed twice"));
        }
        let all = self.list_workspaces()?;
        let mut workspaces = Vec::new();
        for id in workspace_ids {
            let w = all.iter().find(|w| &w.id == id).ok_or_else(|| StoreError::not_found(format!("workspace {id}")))?;
            if !self.open_workspace(id)? {
                return Err(StoreError::locked(format!("ws:{id}")));
            }
            workspaces.push(BundleWorkspace { id: w.id.clone(), name: w.name.clone(), has_password: w.has_password });
        }

        let staging = Staging(sibling_dir(self.base(), "export")?);
        // main.db, reduced to the chosen workspaces.
        let main_copy = staging.0.join("main.db");
        self.with_main(|conn| {
            conn.checkpoint_truncate()?;
            fs::copy(self.base().join("main.db"), &main_copy)?;
            Ok(())
        })?;
        {
            let key = self.keystore().database_key(APP, DATABASE_LABEL, false)?;
            let conn = Connection::open(&main_copy, &Key::Raw(&key), Mode::ReadWrite)?;
            conn.execute_batch("PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON;")?;
            let keep: Vec<String> = workspace_ids.iter().map(|id| format!("'{}'", id.replace('\'', "''"))).collect();
            let keep = keep.join(",");
            conn.execute_batch(&format!(
                "DELETE FROM ai_memory_vectors WHERE workspace_id NOT IN ({keep}); DELETE FROM workspaces WHERE id NOT IN ({keep}); VACUUM;"
            ))?;
            if !workspace_ids.iter().any(|id| all.iter().any(|w| &w.id == id && w.is_main)) {
                // MAIN never has its own password: promote the oldest chosen workspace without one,
                // or add an empty default workspace (its database is created on the first start).
                let promote = all.iter().filter(|w| workspace_ids.contains(&w.id) && !w.has_password).min_by_key(|w| w.created_at);
                match promote {
                    Some(w) => {
                        conn.execute("UPDATE workspaces SET is_main = 1 WHERE id = ?", &[w.id.as_str().into()])?;
                    }
                    None => {
                        let id = if workspace_ids.iter().any(|id| id == "default") { crypto::random_id() } else { "default".into() };
                        let now = now_ms();
                        conn.execute(
                            "INSERT INTO workspaces (id, name, hasPassword, biometric_enabled, is_main, preferences, created_at, updated_at) VALUES (?, 'Default Workspace', 0, 0, 1, '{}', ?, ?)",
                            &[id.as_str().into(), now.into(), now.into()],
                        )?;
                    }
                }
            }
        }
        let mut files = vec![(BundleFile { name: "main.db".into(), size: 0 }, main_copy)];
        for id in workspace_ids {
            let copy = staging.0.join(format!("workspace_{id}.db"));
            let source = self.workspace_path(id);
            self.with_workspace(id, |conn| {
                conn.checkpoint_truncate()?;
                fs::copy(&source, &copy)?;
                Ok(())
            })?;
            files.push((BundleFile { name: format!("workspace_{id}.db"), size: 0 }, copy));
        }
        for name in SIDE_FILES {
            let source = self.base().join(name);
            if source.is_file() {
                let copy = staging.0.join(name);
                fs::copy(&source, &copy)?;
                files.push((BundleFile { name: (*name).into(), size: 0 }, copy));
            }
        }
        for (entry, file) in &mut files {
            entry.size = fs::metadata(file)?.len();
        }

        let mut scopes = vec![self.keystore().export_scope(APP)?];
        for id in workspace_ids {
            scopes.push(self.keystore().export_scope(&format!("ws:{id}"))?);
        }
        let payload_key = crypto::random_key();
        let keys = KeyBlock {
            payload_key: B64(payload_key.to_vec()),
            scopes: scopes.into_iter().map(|s: ScopeExport| ExportedScope { scope_id: s.scope_id, key: B64(s.key.to_vec()), version: s.version }).collect(),
            workspaces,
            files: files.iter().map(|(f, _)| f.clone()).collect(),
        };

        let salt: [u8; 16] = crypto::random_array();
        let params = self.keystore().argon2_params();
        let header = Header {
            format_version: FORMAT_VERSION,
            created_at: now_ms(),
            app_version: app_version.chars().take(64).collect(),
            kdf: Kdf { algorithm: "argon2id".into(), m_kib: params.m_kib, t: params.t, p: params.p, salt: B64(salt.to_vec()) },
            chunk_size: CHUNK as u32,
        };
        let header_bytes = serde_json::to_vec(&header).map_err(|e| StoreError::new(Code::Internal, e.to_string()))?;
        let mut prefix = Vec::new();
        prefix.extend_from_slice(MAGIC);
        prefix.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
        prefix.extend_from_slice(&(header_bytes.len() as u32).to_le_bytes());
        prefix.extend_from_slice(&header_bytes);
        let digest: [u8; 32] = Sha256::digest(&prefix).into();
        let kek = kek(password, &header.kdf)?;
        let key_plain = Zeroizing::new(serde_json::to_vec(&keys).map_err(|e| StoreError::new(Code::Internal, e.to_string()))?);
        let sealed = crypto::seal(&kek, &key_plain, &prefix);

        let partial = path.with_file_name(format!(
            ".{}.partial-{}",
            path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            crypto::random_id()
        ));
        let written = (|| -> StoreResult<u64> {
            let mut out = File::create(&partial)?;
            restrict(&partial, 0o600)?;
            out.write_all(&prefix)?;
            out.write_all(&((NONCE + sealed.ciphertext.len()) as u32).to_le_bytes())?;
            out.write_all(&sealed.nonce)?;
            out.write_all(&sealed.ciphertext)?;
            let mut writer = ChunkWriter { out, key: &payload_key, digest, buffer: Zeroizing::new(Vec::with_capacity(CHUNK)), index: 0, written: 0 };
            let mut buffer = Zeroizing::new(vec![0u8; CHUNK]);
            for (_, file) in &files {
                let mut input = File::open(file)?;
                loop {
                    let n = input.read(&mut buffer)?;
                    if n == 0 {
                        break;
                    }
                    writer.write(&buffer[..n])?;
                }
            }
            let (out, payload) = writer.finish()?;
            out.sync_all()?;
            Ok(prefix.len() as u64 + 4 + (NONCE + sealed.ciphertext.len()) as u64 + payload)
        })();
        let bytes = match written {
            Ok(bytes) => bytes,
            Err(error) => {
                let _ = fs::remove_file(&partial);
                return Err(error);
            }
        };
        fs::rename(&partial, path)?;
        Ok(ExportReport { path: path.to_path_buf(), workspace_ids: workspace_ids.to_vec(), bytes })
    }

    pub fn inspect_bundle(&self, path: &Path, password: &str) -> StoreResult<BundleInfo> {
        let opened = open_bundle(path, password)?;
        Ok(BundleInfo {
            format_version: opened.header.format_version,
            created_at: opened.header.created_at,
            app_version: opened.header.app_version.clone(),
            workspaces: opened.keys.workspaces.clone(),
        })
    }

    /// Replaces all data with the bundle. The current directory is first renamed to a timestamped
    /// backup next to it. Afterwards this store refuses every call: the app must restart.
    pub fn import_bundle(&self, path: &Path, password: &str, device: D) -> StoreResult<ImportReport> {
        // Replacing data is a settings action: a locked app must be unlocked first.
        if !self.app_state().ready {
            return Err(StoreError::locked("app"));
        }
        let mut opened = open_bundle(path, password)?;
        let staging = Staging(sibling_dir(self.base(), "import")?);
        {
            let payload_key = key32(&opened.keys.payload_key.0);
            let mut reader = ChunkReader {
                input: std::io::BufReader::new(&mut opened.file),
                key: &payload_key,
                digest: opened.digest,
                plain: Zeroizing::new(Vec::new()),
                position: 0,
                index: 0,
                done: false,
            };
            for entry in &opened.keys.files {
                let target = staging.0.join(&entry.name);
                let mut out = File::create(&target)?;
                restrict(&target, 0o600)?;
                reader.read_exact(&mut out, entry.size)?;
                out.sync_all()?;
            }
            reader.finish()?;
        }
        if !staging.0.join("main.db").is_file() {
            return Err(corrupt("no main database"));
        }

        // A keyring holding the exported versions, with this computer's device routes.
        let staged_ks = Keystore::open(device, staging.0.join("keyring.json"))?;
        let scopes = opened
            .keys
            .scopes
            .iter()
            .map(|s| ScopeExport { scope_id: s.scope_id.clone(), key: key32(&s.key.0), version: s.version.clone() })
            .collect();
        staged_ks.initialize_from_export(scopes)?;
        // Every database must open with its key and pass an integrity check before anything moves.
        let mut workspace_ids = Vec::new();
        for entry in &opened.keys.files {
            let scope = if entry.name == "main.db" {
                APP.to_string()
            } else if let Some(id) = entry.name.strip_prefix("workspace_").and_then(|r| r.strip_suffix(".db")) {
                workspace_ids.push(id.to_string());
                format!("ws:{id}")
            } else {
                continue;
            };
            let key = staged_ks.database_key(&scope, DATABASE_LABEL, false).map_err(|_| corrupt("a database has no key"))?;
            let conn = Connection::open(&staging.0.join(&entry.name), &Key::Raw(&key), Mode::ReadWrite).map_err(|_| corrupt("a database does not open"))?;
            if !conn.integrity_check()? {
                return Err(corrupt("a database fails its integrity check"));
            }
            conn.execute_batch("PRAGMA journal_mode = WAL")?;
        }
        drop(staged_ks);

        // Swap the directories. From here on this store must not touch the old files.
        self.mark_replaced();
        let base = self.base().to_path_buf();
        let stamp = chrono_like_stamp();
        let backup = base.with_file_name(format!("{}-backup-{stamp}", base.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
        let backup = if backup.exists() { backup.with_file_name(format!("{}-{}", backup.file_name().unwrap().to_string_lossy(), crypto::random_id())) } else { backup };
        fs::rename(&base, &backup)?;
        if let Err(error) = fs::rename(&staging.0, &base) {
            let _ = fs::rename(&backup, &base);
            return Err(error.into());
        }
        // Keep what the bundle does not carry (plugins, logs, a side file it lacks, …) from the old
        // directory, but no database, key file or 2.x leftover: those belong to the old data.
        let belongs_to_old_data = |name: &str| {
            name == "keyring.json"
                || LEGACY_KEY_FILES.contains(&name)
                || [".db", "-wal", "-shm", "-journal"].iter().any(|suffix| name.ends_with(suffix))
                || name.starts_with('.')
        };
        for entry in fs::read_dir(&backup)?.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !belongs_to_old_data(&name) && !base.join(&name).exists() {
                let _ = copy_recursive(&entry.path(), &base.join(&name));
            }
        }
        Ok(ImportReport { workspace_ids, backup_path: Some(backup) })
    }
}

fn copy_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    let meta = fs::symlink_metadata(from)?;
    if meta.is_dir() {
        fs::create_dir_all(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
    } else if meta.is_file() {
        fs::copy(from, to)?;
    }
    Ok(())
}

/// YYYYMMDD-HHMMSS in UTC, without a date library.
fn chrono_like_stamp() -> String {
    let secs = (now_ms() / 1000).max(0);
    let (days, rem) = (secs / 86_400, secs % 86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!("{year:04}{month:02}{day:02}-{:02}{:02}{:02}", rem / 3600, (rem % 3600) / 60, rem % 60)
}


#[cfg(test)]
mod tests {
    use super::*;

    const DIGEST: [u8; 32] = [7u8; 32];

    fn data(size: usize) -> Vec<u8> {
        (0..size).map(|i| (i % 251) as u8).collect()
    }

    fn write_stream(key: &Key32, size: usize) -> Vec<u8> {
        let mut writer = ChunkWriter { out: Vec::new(), key, digest: DIGEST, buffer: Zeroizing::new(Vec::new()), index: 0, written: 0 };
        writer.write(&data(size)).unwrap();
        let (stream, written) = writer.finish().unwrap();
        assert_eq!(written as usize, stream.len());
        stream
    }

    fn read_stream(key: &Key32, stream: &[u8], size: usize) -> StoreResult<Vec<u8>> {
        let mut reader = ChunkReader { input: stream, key, digest: DIGEST, plain: Zeroizing::new(Vec::new()), position: 0, index: 0, done: false };
        let mut out = Vec::new();
        reader.read_exact(&mut out, size as u64)?;
        reader.finish()?;
        Ok(out)
    }

    #[test]
    fn chunk_boundaries_round_trip() {
        let key = crypto::random_key();
        for size in [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK] {
            let stream = write_stream(&key, size);
            // Every full chunk is followed by a shorter final one, which may be empty.
            assert_eq!(stream.len(), size + (size / CHUNK + 1) * (4 + NONCE + TAG), "{size}");
            assert_eq!(read_stream(&key, &stream, size).unwrap(), data(size), "{size}");
        }
    }

    #[test]
    fn a_stream_cut_after_a_full_chunk_is_refused() {
        let key = crypto::random_key();
        let stream = write_stream(&key, 2 * CHUNK);
        let one_chunk = 4 + NONCE + CHUNK + TAG;
        for cut in [one_chunk, 2 * one_chunk] {
            let error = read_stream(&key, &stream[..cut], 2 * CHUNK).err().unwrap();
            assert_eq!(error.code, Code::Corrupt, "{cut}");
        }
        // Reading fewer bytes than were written leaves data before the end.
        assert_eq!(read_stream(&key, &stream, 2 * CHUNK - 1).err().unwrap().code, Code::Corrupt);
    }

    #[test]
    fn the_stamp_is_a_utc_date() {
        let stamp = chrono_like_stamp();
        assert_eq!(stamp.len(), 15);
        assert!(stamp.starts_with("20") && stamp.as_bytes()[8] == b'-');
    }
}
