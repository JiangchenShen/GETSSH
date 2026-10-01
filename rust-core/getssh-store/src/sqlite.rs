//! A small safe wrapper over the vendored SQLite3 Multiple Ciphers engine (vendor/sqlite3mc).
//!
//! Every GETSSH database uses the SQLCipher scheme (SQLCipher 4 format). Keys reach the engine
//! only through `sqlite3_key` / `sqlite3_rekey` from zeroized buffers, never through SQL text, so
//! they cannot end up in a statement, an error message or a log.

use std::ffi::{c_int, c_void, CStr, CString};
use std::fmt;
use std::path::Path;
use std::ptr::{self, NonNull};

use zeroize::Zeroizing;

#[allow(non_camel_case_types)]
mod ffi {
    use std::ffi::{c_char, c_int, c_void};

    pub enum sqlite3 {}
    pub enum sqlite3_stmt {}
    pub type Destructor = isize;

    pub const OK: c_int = 0;
    pub const ROW: c_int = 100;
    pub const DONE: c_int = 101;
    pub const NOTADB: c_int = 26;

    pub const OPEN_READONLY: c_int = 0x0000_0001;
    pub const OPEN_READWRITE: c_int = 0x0000_0002;
    pub const OPEN_CREATE: c_int = 0x0000_0004;
    pub const OPEN_NOMUTEX: c_int = 0x0000_8000;
    pub const OPEN_EXRESCODE: c_int = 0x0200_0000;

    pub const INTEGER: c_int = 1;
    pub const FLOAT: c_int = 2;
    pub const TEXT: c_int = 3;
    pub const BLOB: c_int = 4;
    pub const NULL: c_int = 5;

    /// SQLITE_TRANSIENT: SQLite copies the bound value before the call returns.
    pub const TRANSIENT: Destructor = -1;

    extern "C" {
        pub fn sqlite3_open_v2(filename: *const c_char, db: *mut *mut sqlite3, flags: c_int, vfs: *const c_char) -> c_int;
        pub fn sqlite3_close_v2(db: *mut sqlite3) -> c_int;
        pub fn sqlite3_exec(
            db: *mut sqlite3,
            sql: *const c_char,
            callback: *const c_void,
            arg: *mut c_void,
            errmsg: *mut *mut c_char,
        ) -> c_int;
        pub fn sqlite3_key(db: *mut sqlite3, key: *const c_void, n: c_int) -> c_int;
        pub fn sqlite3_rekey(db: *mut sqlite3, key: *const c_void, n: c_int) -> c_int;
        pub fn sqlite3_busy_timeout(db: *mut sqlite3, ms: c_int) -> c_int;
        pub fn sqlite3_prepare_v2(
            db: *mut sqlite3,
            sql: *const c_char,
            n: c_int,
            stmt: *mut *mut sqlite3_stmt,
            tail: *mut *const c_char,
        ) -> c_int;
        pub fn sqlite3_step(stmt: *mut sqlite3_stmt) -> c_int;
        pub fn sqlite3_finalize(stmt: *mut sqlite3_stmt) -> c_int;
        pub fn sqlite3_bind_parameter_count(stmt: *mut sqlite3_stmt) -> c_int;
        pub fn sqlite3_bind_null(stmt: *mut sqlite3_stmt, i: c_int) -> c_int;
        pub fn sqlite3_bind_int64(stmt: *mut sqlite3_stmt, i: c_int, v: i64) -> c_int;
        pub fn sqlite3_bind_double(stmt: *mut sqlite3_stmt, i: c_int, v: f64) -> c_int;
        pub fn sqlite3_bind_text(stmt: *mut sqlite3_stmt, i: c_int, v: *const c_char, n: c_int, d: Destructor) -> c_int;
        pub fn sqlite3_bind_blob(stmt: *mut sqlite3_stmt, i: c_int, v: *const c_void, n: c_int, d: Destructor) -> c_int;
        pub fn sqlite3_column_count(stmt: *mut sqlite3_stmt) -> c_int;
        pub fn sqlite3_column_name(stmt: *mut sqlite3_stmt, i: c_int) -> *const c_char;
        pub fn sqlite3_column_type(stmt: *mut sqlite3_stmt, i: c_int) -> c_int;
        pub fn sqlite3_column_int64(stmt: *mut sqlite3_stmt, i: c_int) -> i64;
        pub fn sqlite3_column_double(stmt: *mut sqlite3_stmt, i: c_int) -> f64;
        pub fn sqlite3_column_text(stmt: *mut sqlite3_stmt, i: c_int) -> *const u8;
        pub fn sqlite3_column_blob(stmt: *mut sqlite3_stmt, i: c_int) -> *const c_void;
        pub fn sqlite3_column_bytes(stmt: *mut sqlite3_stmt, i: c_int) -> c_int;
        pub fn sqlite3_changes(db: *mut sqlite3) -> c_int;
        pub fn sqlite3_errmsg(db: *mut sqlite3) -> *const c_char;
        pub fn sqlite3_extended_errcode(db: *mut sqlite3) -> c_int;
        pub fn sqlite3_errstr(code: c_int) -> *const c_char;
        pub fn sqlite3_libversion() -> *const c_char;
    }
}

/// An error from the SQLite engine. The message never contains key material.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SqlError {
    /// The extended result code.
    pub code: i32,
    pub message: String,
}

impl SqlError {
    /// The key does not open the file, or the file is not a database at all.
    pub fn is_not_a_database(&self) -> bool {
        self.code & 0xff == ffi::NOTADB
    }

    fn misuse(message: impl Into<String>) -> Self {
        SqlError { code: 21, message: message.into() }
    }
}

impl fmt::Display for SqlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} (SQLite {})", self.message, self.code)
    }
}

impl std::error::Error for SqlError {}

pub type SqlResult<T> = Result<T, SqlError>;

/// How a database file is keyed.
pub enum Key<'a> {
    /// A 32-byte key used directly as the SQLCipher key (no KDF): every database since 3.0.
    Raw(&'a [u8; 32]),
    /// A passphrase run through SQLCipher's PBKDF2 (2.x workspace passwords and the legacy app key).
    Passphrase(&'a [u8]),
    /// An unencrypted database (2.x workspaces without a password).
    Plain,
}

impl Key<'_> {
    /// The bytes handed to sqlite3_key: `x'<64 hex>'` for a raw key.
    fn material(&self) -> Option<Zeroizing<Vec<u8>>> {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        match self {
            Key::Raw(key) => {
                let mut out = Zeroizing::new(Vec::with_capacity(3 + 64));
                out.extend_from_slice(b"x'");
                for byte in key.iter() {
                    out.push(HEX[(byte >> 4) as usize]);
                    out.push(HEX[(byte & 0x0f) as usize]);
                }
                out.push(b'\'');
                Some(out)
            }
            Key::Passphrase(bytes) => Some(Zeroizing::new(bytes.to_vec())),
            Key::Plain => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    ReadOnly,
    ReadWrite,
    /// Read-write, creating the file if it does not exist.
    Create,
}

/// A value bound to, or read from, a statement.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

impl From<i64> for Value {
    fn from(v: i64) -> Self {
        Value::Integer(v)
    }
}
impl From<bool> for Value {
    fn from(v: bool) -> Self {
        Value::Integer(v as i64)
    }
}
impl From<f64> for Value {
    fn from(v: f64) -> Self {
        Value::Real(v)
    }
}
impl From<&str> for Value {
    fn from(v: &str) -> Self {
        Value::Text(v.to_string())
    }
}
impl From<String> for Value {
    fn from(v: String) -> Self {
        Value::Text(v)
    }
}
impl From<Vec<u8>> for Value {
    fn from(v: Vec<u8>) -> Self {
        Value::Blob(v)
    }
}
impl<T: Into<Value>> From<Option<T>> for Value {
    fn from(v: Option<T>) -> Self {
        v.map_or(Value::Null, Into::into)
    }
}

/// The SQLite engine version, e.g. "3.53.2".
pub fn engine_version() -> String {
    unsafe { CStr::from_ptr(ffi::sqlite3_libversion()) }.to_string_lossy().into_owned()
}

/// One open database connection. SQLite is built with SQLITE_THREADSAFE=2: a connection may move
/// between threads but must not be used by two at once, so it is `Send` but not `Sync`; callers
/// keep it behind a Mutex.
pub struct Connection {
    db: NonNull<ffi::sqlite3>,
}

unsafe impl Send for Connection {}

impl Drop for Connection {
    fn drop(&mut self) {
        unsafe { ffi::sqlite3_close_v2(self.db.as_ptr()) };
    }
}

impl Connection {
    /// Opens `path` with `key` and proves the key works by reading the schema. A wrong key, or a
    /// file that is not a database, fails with an error for which `is_not_a_database()` is true.
    pub fn open(path: &Path, key: &Key<'_>, mode: Mode) -> SqlResult<Connection> {
        let c_path = CString::new(path.to_string_lossy().as_bytes()).map_err(|_| SqlError::misuse("database path contains a NUL byte"))?;
        let flags = ffi::OPEN_NOMUTEX
            | ffi::OPEN_EXRESCODE
            | match mode {
                Mode::ReadOnly => ffi::OPEN_READONLY,
                Mode::ReadWrite => ffi::OPEN_READWRITE,
                Mode::Create => ffi::OPEN_READWRITE | ffi::OPEN_CREATE,
            };
        let mut raw = ptr::null_mut();
        let rc = unsafe { ffi::sqlite3_open_v2(c_path.as_ptr(), &mut raw, flags, ptr::null()) };
        let Some(db) = NonNull::new(raw) else {
            return Err(SqlError { code: rc, message: errstr(rc) });
        };
        let conn = Connection { db };
        if rc != ffi::OK {
            return Err(conn.error(rc));
        }
        unsafe { ffi::sqlite3_busy_timeout(conn.db.as_ptr(), 5_000) };
        if let Some(material) = key.material() {
            conn.execute_batch("PRAGMA cipher = 'sqlcipher'")?;
            let rc = unsafe { ffi::sqlite3_key(conn.db.as_ptr(), material.as_ptr().cast(), material.len() as c_int) };
            if rc != ffi::OK {
                return Err(conn.error(rc));
            }
        }
        // The first read decrypts page 1; this is where a wrong key shows up.
        conn.query_row("SELECT count(*) FROM sqlite_master", &[], |row| row.integer(0))?;
        Ok(conn)
    }

    fn error(&self, rc: c_int) -> SqlError {
        let code = unsafe { ffi::sqlite3_extended_errcode(self.db.as_ptr()) };
        let message = unsafe { CStr::from_ptr(ffi::sqlite3_errmsg(self.db.as_ptr())) }.to_string_lossy().into_owned();
        SqlError { code: if code != 0 { code } else { rc }, message }
    }

    /// Runs one or more statements without parameters.
    pub fn execute_batch(&self, sql: &str) -> SqlResult<()> {
        let c_sql = CString::new(sql).map_err(|_| SqlError::misuse("SQL contains a NUL byte"))?;
        let rc = unsafe { ffi::sqlite3_exec(self.db.as_ptr(), c_sql.as_ptr(), ptr::null(), ptr::null_mut(), ptr::null_mut()) };
        if rc != ffi::OK {
            return Err(self.error(rc));
        }
        Ok(())
    }

    pub fn prepare(&self, sql: &str) -> SqlResult<Statement<'_>> {
        let c_sql = CString::new(sql).map_err(|_| SqlError::misuse("SQL contains a NUL byte"))?;
        let mut raw = ptr::null_mut();
        let mut tail = ptr::null();
        let rc = unsafe { ffi::sqlite3_prepare_v2(self.db.as_ptr(), c_sql.as_ptr(), -1, &mut raw, &mut tail) };
        if rc != ffi::OK {
            return Err(self.error(rc));
        }
        let Some(stmt) = NonNull::new(raw) else {
            return Err(SqlError::misuse("empty statement"));
        };
        let statement = Statement { conn: self, stmt };
        if !tail.is_null() && !unsafe { CStr::from_ptr(tail) }.to_bytes().iter().all(|b| b.is_ascii_whitespace() || *b == b';') {
            return Err(SqlError::misuse("prepare() takes exactly one statement"));
        }
        Ok(statement)
    }

    /// Runs one statement and returns the number of changed rows.
    pub fn execute(&self, sql: &str, params: &[Value]) -> SqlResult<usize> {
        let mut stmt = self.prepare(sql)?;
        stmt.bind(params)?;
        while stmt.step()?.is_some() {}
        Ok(unsafe { ffi::sqlite3_changes(self.db.as_ptr()) } as usize)
    }

    /// Runs a query and maps every row.
    pub fn query_map<T>(&self, sql: &str, params: &[Value], mut map: impl FnMut(&Row<'_, '_>) -> SqlResult<T>) -> SqlResult<Vec<T>> {
        let mut stmt = self.prepare(sql)?;
        stmt.bind(params)?;
        let mut out = Vec::new();
        while let Some(row) = stmt.step()? {
            out.push(map(&row)?);
        }
        Ok(out)
    }

    /// The first row of a query, or `None`.
    pub fn query_optional<T>(&self, sql: &str, params: &[Value], map: impl FnOnce(&Row<'_, '_>) -> SqlResult<T>) -> SqlResult<Option<T>> {
        let mut stmt = self.prepare(sql)?;
        stmt.bind(params)?;
        match stmt.step()? {
            Some(row) => map(&row).map(Some),
            None => Ok(None),
        }
    }

    /// The first row of a query; no row is an error.
    pub fn query_row<T>(&self, sql: &str, params: &[Value], map: impl FnOnce(&Row<'_, '_>) -> SqlResult<T>) -> SqlResult<T> {
        self.query_optional(sql, params, map)?.ok_or_else(|| SqlError::misuse("query returned no rows"))
    }

    /// Runs `f` inside `BEGIN IMMEDIATE … COMMIT`, rolling back if it fails.
    pub fn transaction<T>(&self, f: impl FnOnce(&Connection) -> SqlResult<T>) -> SqlResult<T> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        match f(self) {
            Ok(value) => match self.execute_batch("COMMIT") {
                Ok(()) => Ok(value),
                Err(error) => {
                    let _ = self.execute_batch("ROLLBACK");
                    Err(error)
                }
            },
            Err(error) => {
                let _ = self.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Re-encrypts the database under `key` (`Key::Plain` removes encryption). The caller switches
    /// the journal to DELETE first and keeps a verified copy (see the keystore rekey flow).
    pub fn rekey(&self, key: &Key<'_>) -> SqlResult<()> {
        let material = key.material().unwrap_or_else(|| Zeroizing::new(Vec::new()));
        let rc = unsafe { ffi::sqlite3_rekey(self.db.as_ptr(), material.as_ptr().cast(), material.len() as c_int) };
        if rc != ffi::OK {
            return Err(self.error(rc));
        }
        Ok(())
    }

    /// Writes every WAL frame back into the main file and truncates the WAL (before copying or
    /// exporting a database).
    pub fn checkpoint_truncate(&self) -> SqlResult<()> {
        self.query_row("PRAGMA wal_checkpoint(TRUNCATE)", &[], |row| {
            if row.integer(0)? != 0 {
                return Err(SqlError::misuse("the WAL checkpoint was blocked by another connection"));
            }
            Ok(())
        })
    }

    pub fn integrity_check(&self) -> SqlResult<bool> {
        self.query_row("PRAGMA integrity_check", &[], |row| Ok(row.text(0)?.as_deref() == Some("ok")))
    }
}

/// A prepared statement. Finalized on drop.
pub struct Statement<'c> {
    conn: &'c Connection,
    stmt: NonNull<ffi::sqlite3_stmt>,
}

impl Drop for Statement<'_> {
    fn drop(&mut self) {
        unsafe { ffi::sqlite3_finalize(self.stmt.as_ptr()) };
    }
}

impl<'c> Statement<'c> {
    /// Binds every parameter; the count must match the statement exactly.
    pub fn bind(&mut self, params: &[Value]) -> SqlResult<()> {
        let expected = unsafe { ffi::sqlite3_bind_parameter_count(self.stmt.as_ptr()) } as usize;
        if expected != params.len() {
            return Err(SqlError::misuse(format!("statement takes {expected} parameters, got {}", params.len())));
        }
        for (i, value) in params.iter().enumerate() {
            let index = i as c_int + 1;
            let stmt = self.stmt.as_ptr();
            let rc = unsafe {
                match value {
                    Value::Null => ffi::sqlite3_bind_null(stmt, index),
                    Value::Integer(v) => ffi::sqlite3_bind_int64(stmt, index, *v),
                    Value::Real(v) => ffi::sqlite3_bind_double(stmt, index, *v),
                    Value::Text(v) => {
                        let len = c_int::try_from(v.len()).map_err(|_| SqlError::misuse("text value is too large"))?;
                        ffi::sqlite3_bind_text(stmt, index, v.as_ptr().cast(), len, ffi::TRANSIENT)
                    }
                    Value::Blob(v) => {
                        let len = c_int::try_from(v.len()).map_err(|_| SqlError::misuse("blob value is too large"))?;
                        // A zero-length blob must not be bound as NULL.
                        let data: *const c_void = if v.is_empty() { b"".as_ptr().cast() } else { v.as_ptr().cast() };
                        ffi::sqlite3_bind_blob(stmt, index, data, len, ffi::TRANSIENT)
                    }
                }
            };
            if rc != ffi::OK {
                return Err(self.conn.error(rc));
            }
        }
        Ok(())
    }

    /// The next row, or `None` when the statement is done.
    pub fn step(&mut self) -> SqlResult<Option<Row<'_, 'c>>> {
        match unsafe { ffi::sqlite3_step(self.stmt.as_ptr()) } {
            ffi::ROW => Ok(Some(Row { stmt: self })),
            ffi::DONE => Ok(None),
            rc => Err(self.conn.error(rc)),
        }
    }

    pub fn column_names(&self) -> Vec<String> {
        let count = unsafe { ffi::sqlite3_column_count(self.stmt.as_ptr()) };
        (0..count)
            .map(|i| {
                let name = unsafe { ffi::sqlite3_column_name(self.stmt.as_ptr(), i) };
                if name.is_null() { String::new() } else { unsafe { CStr::from_ptr(name) }.to_string_lossy().into_owned() }
            })
            .collect()
    }
}

/// The current row of a statement.
pub struct Row<'s, 'c> {
    stmt: &'s Statement<'c>,
}

impl Row<'_, '_> {
    fn checked(&self, index: usize) -> SqlResult<c_int> {
        let count = unsafe { ffi::sqlite3_column_count(self.stmt.stmt.as_ptr()) } as usize;
        if index >= count {
            return Err(SqlError::misuse(format!("column {index} out of range ({count} columns)")));
        }
        Ok(index as c_int)
    }

    pub fn value(&self, index: usize) -> SqlResult<Value> {
        let i = self.checked(index)?;
        let stmt = self.stmt.stmt.as_ptr();
        Ok(unsafe {
            match ffi::sqlite3_column_type(stmt, i) {
                ffi::INTEGER => Value::Integer(ffi::sqlite3_column_int64(stmt, i)),
                ffi::FLOAT => Value::Real(ffi::sqlite3_column_double(stmt, i)),
                ffi::TEXT => {
                    let data = ffi::sqlite3_column_text(stmt, i);
                    let len = ffi::sqlite3_column_bytes(stmt, i) as usize;
                    let bytes = if data.is_null() { &[][..] } else { std::slice::from_raw_parts(data, len) };
                    Value::Text(String::from_utf8_lossy(bytes).into_owned())
                }
                ffi::BLOB => {
                    let data = ffi::sqlite3_column_blob(stmt, i);
                    let len = ffi::sqlite3_column_bytes(stmt, i) as usize;
                    Value::Blob(if data.is_null() { Vec::new() } else { std::slice::from_raw_parts(data.cast::<u8>(), len).to_vec() })
                }
                ffi::NULL => Value::Null,
                other => return Err(SqlError::misuse(format!("unknown column type {other}"))),
            }
        })
    }

    pub fn integer(&self, index: usize) -> SqlResult<i64> {
        match self.value(index)? {
            Value::Integer(v) => Ok(v),
            Value::Real(v) => Ok(v as i64),
            other => Err(SqlError::misuse(format!("column {index} is not an integer: {}", kind(&other)))),
        }
    }

    pub fn optional_integer(&self, index: usize) -> SqlResult<Option<i64>> {
        match self.value(index)? {
            Value::Null => Ok(None),
            _ => self.integer(index).map(Some),
        }
    }

    /// Text, or `None` for NULL.
    pub fn text(&self, index: usize) -> SqlResult<Option<String>> {
        match self.value(index)? {
            Value::Null => Ok(None),
            Value::Text(v) => Ok(Some(v)),
            Value::Integer(v) => Ok(Some(v.to_string())),
            Value::Real(v) => Ok(Some(v.to_string())),
            Value::Blob(_) => Err(SqlError::misuse(format!("column {index} is a blob, not text"))),
        }
    }

    /// Bytes, or `None` for NULL.
    pub fn blob(&self, index: usize) -> SqlResult<Option<Vec<u8>>> {
        match self.value(index)? {
            Value::Null => Ok(None),
            Value::Blob(v) => Ok(Some(v)),
            Value::Text(v) => Ok(Some(v.into_bytes())),
            other => Err(SqlError::misuse(format!("column {index} is not a blob: {}", kind(&other)))),
        }
    }
}

fn kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "NULL",
        Value::Integer(_) => "integer",
        Value::Real(_) => "real",
        Value::Text(_) => "text",
        Value::Blob(_) => "blob",
    }
}

fn errstr(rc: c_int) -> String {
    unsafe { CStr::from_ptr(ffi::sqlite3_errstr(rc)) }.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            static N: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!("getssh-store-sqlite-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
        fn file(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const KEY: [u8; 32] = [7; 32];
    const OTHER: [u8; 32] = [8; 32];

    fn sample(conn: &Connection) {
        conn.execute_batch("PRAGMA journal_mode = WAL; CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, score REAL, data BLOB)").unwrap();
        conn.transaction(|c| {
            for i in 0..100 {
                c.execute("INSERT INTO t (name, score, data) VALUES (?, ?, ?)", &[format!("row {i}").into(), (i as f64 / 2.0).into(), vec![i as u8; 4].into()])?;
            }
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn the_engine_is_the_vendored_sqlite3mc() {
        assert_eq!(engine_version(), "3.53.2");
    }

    #[test]
    fn a_raw_key_round_trips_and_the_file_is_encrypted() {
        let dir = TempDir::new();
        let path = dir.file("raw.db");
        sample(&Connection::open(&path, &Key::Raw(&KEY), Mode::Create).unwrap());
        let header = std::fs::read(&path).unwrap();
        assert_ne!(&header[..16], b"SQLite format 3\0", "the file is encrypted");
        let conn = Connection::open(&path, &Key::Raw(&KEY), Mode::ReadOnly).unwrap();
        assert_eq!(conn.query_row("SELECT count(*) FROM t", &[], |r| r.integer(0)).unwrap(), 100);
        assert!(conn.integrity_check().unwrap());
    }

    #[test]
    fn a_wrong_key_or_a_missing_key_is_not_a_database() {
        let dir = TempDir::new();
        let path = dir.file("raw.db");
        sample(&Connection::open(&path, &Key::Raw(&KEY), Mode::Create).unwrap());
        let wrong = Connection::open(&path, &Key::Raw(&OTHER), Mode::ReadOnly).err().unwrap();
        assert!(wrong.is_not_a_database(), "{wrong}");
        assert!(Connection::open(&path, &Key::Plain, Mode::ReadOnly).err().unwrap().is_not_a_database());
        assert!(Connection::open(&path, &Key::Passphrase(b"guess"), Mode::ReadOnly).err().unwrap().is_not_a_database());
    }

    #[test]
    fn errors_never_contain_the_key() {
        let dir = TempDir::new();
        let path = dir.file("raw.db");
        sample(&Connection::open(&path, &Key::Raw(&KEY), Mode::Create).unwrap());
        let error = Connection::open(&path, &Key::Raw(&OTHER), Mode::ReadOnly).err().unwrap().to_string();
        assert!(!error.contains("0808"), "{error}");
        assert!(!error.contains("x'"), "{error}");
    }

    #[test]
    fn passphrase_and_plain_databases_open() {
        let dir = TempDir::new();
        let pass = dir.file("pass.db");
        sample(&Connection::open(&pass, &Key::Passphrase("pässword".as_bytes()), Mode::Create).unwrap());
        Connection::open(&pass, &Key::Passphrase("pässword".as_bytes()), Mode::ReadOnly).unwrap();
        let plain = dir.file("plain.db");
        sample(&Connection::open(&plain, &Key::Plain, Mode::Create).unwrap());
        assert_eq!(&std::fs::read(&plain).unwrap()[..16], b"SQLite format 3\0");
    }

    #[test]
    fn rekey_moves_a_database_to_a_new_key() {
        let dir = TempDir::new();
        let path = dir.file("rekey.db");
        {
            let conn = Connection::open(&path, &Key::Passphrase(b"old-password"), Mode::Create).unwrap();
            sample(&conn);
            conn.execute_batch("PRAGMA journal_mode = DELETE").unwrap();
            conn.rekey(&Key::Raw(&KEY)).unwrap();
        }
        assert!(Connection::open(&path, &Key::Passphrase(b"old-password"), Mode::ReadOnly).is_err());
        let conn = Connection::open(&path, &Key::Raw(&KEY), Mode::ReadOnly).unwrap();
        assert_eq!(conn.query_row("SELECT count(*) FROM t", &[], |r| r.integer(0)).unwrap(), 100);
    }

    #[test]
    fn wal_frames_survive_and_checkpoint_truncates() {
        let dir = TempDir::new();
        let path = dir.file("wal.db");
        let conn = Connection::open(&path, &Key::Raw(&KEY), Mode::Create).unwrap();
        sample(&conn);
        conn.execute_batch("PRAGMA wal_autocheckpoint = 0").unwrap();
        conn.execute("UPDATE t SET name = ? WHERE id = 1", &["changed".into()]).unwrap();
        let wal = dir.file("wal.db-wal");
        assert!(std::fs::metadata(&wal).unwrap().len() > 0);
        let other = Connection::open(&path, &Key::Raw(&KEY), Mode::ReadOnly).unwrap();
        assert_eq!(other.query_row("SELECT name FROM t WHERE id = 1", &[], |r| r.text(0)).unwrap().as_deref(), Some("changed"));
        drop(other);
        conn.checkpoint_truncate().unwrap();
        assert_eq!(std::fs::metadata(&wal).unwrap().len(), 0);
    }

    #[test]
    fn values_round_trip() {
        let dir = TempDir::new();
        let conn = Connection::open(&dir.file("v.db"), &Key::Raw(&KEY), Mode::Create).unwrap();
        conn.execute_batch("CREATE TABLE v (a, b, c, d, e, f)").unwrap();
        let row = [Value::Null, Value::Integer(i64::MIN), Value::Real(1.5), Value::Text("日本語 ✓".into()), Value::Blob(vec![0, 1, 2]), Value::Blob(vec![])];
        conn.execute("INSERT INTO v VALUES (?, ?, ?, ?, ?, ?)", &row).unwrap();
        let back = conn.query_row("SELECT a, b, c, d, e, f FROM v", &[], |r| (0..6).map(|i| r.value(i)).collect::<SqlResult<Vec<_>>>()).unwrap();
        assert_eq!(back, row);
    }

    #[test]
    fn failed_transactions_roll_back() {
        let dir = TempDir::new();
        let conn = Connection::open(&dir.file("tx.db"), &Key::Raw(&KEY), Mode::Create).unwrap();
        sample(&conn);
        let result: SqlResult<()> = conn.transaction(|c| {
            c.execute("DELETE FROM t", &[])?;
            Err(SqlError::misuse("stop"))
        });
        assert!(result.is_err());
        assert_eq!(conn.query_row("SELECT count(*) FROM t", &[], |r| r.integer(0)).unwrap(), 100);
    }

    #[test]
    fn misuse_is_reported_not_undefined() {
        let dir = TempDir::new();
        let conn = Connection::open(&dir.file("m.db"), &Key::Raw(&KEY), Mode::Create).unwrap();
        sample(&conn);
        assert!(conn.execute("SELECT ?", &[]).is_err(), "missing parameter");
        assert!(conn.execute("SELECT 1", &[1i64.into()]).is_err(), "extra parameter");
        assert!(conn.prepare("SELECT 1; SELECT 2").is_err(), "two statements");
        assert!(conn.query_row("SELECT name FROM t WHERE id = 1", &[], |r| r.text(5)).is_err(), "column out of range");
        assert!(conn.prepare("SELECT * FROM missing").is_err());
    }

    #[test]
    fn a_read_only_connection_cannot_write() {
        let dir = TempDir::new();
        let path = dir.file("ro.db");
        sample(&Connection::open(&path, &Key::Raw(&KEY), Mode::Create).unwrap());
        let ro = Connection::open(&path, &Key::Raw(&KEY), Mode::ReadOnly).unwrap();
        assert!(ro.execute("DELETE FROM t", &[]).is_err());
        assert!(Connection::open(&dir.file("absent.db"), &Key::Raw(&KEY), Mode::ReadWrite).is_err(), "ReadWrite does not create");
    }

    /// Databases written by better-sqlite3-multiple-ciphers 12 (the engine GETSSH used before
    /// getssh-store). Point GETSSH_BSMC_FIXTURES at a directory made by the spike's make-dbs.cjs:
    /// raw.db and pending-copy.db with key.hex, and pass.db with the passphrase below.
    #[test]
    fn databases_written_by_bsmc_open() {
        let Ok(dir) = std::env::var("GETSSH_BSMC_FIXTURES") else {
            eprintln!("GETSSH_BSMC_FIXTURES not set; skipped");
            return;
        };
        let dir = PathBuf::from(dir);
        let hex = std::fs::read_to_string(dir.join("key.hex")).unwrap();
        let mut key = [0u8; 32];
        for (i, chunk) in hex.trim().as_bytes().chunks(2).enumerate() {
            key[i] = u8::from_str_radix(std::str::from_utf8(chunk).unwrap(), 16).unwrap();
        }
        for file in ["raw.db", "pending-copy.db"] {
            let conn = Connection::open(&dir.join(file), &Key::Raw(&key), Mode::ReadOnly).unwrap();
            assert!(conn.integrity_check().unwrap());
            assert_eq!(conn.query_row("SELECT count(*) FROM profiles", &[], |r| r.integer(0)).unwrap(), 2000);
        }
        let pass = Connection::open(&dir.join("pass.db"), &Key::Passphrase("legacy-passphrase-é".as_bytes()), Mode::ReadOnly).unwrap();
        assert!(pass.integrity_check().unwrap());
    }
}
