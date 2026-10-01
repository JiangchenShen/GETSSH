//! Errors cross into JavaScript as "[store:<code>] <message>" (StoreErrorCode in store.d.ts).
//! Messages name what failed, never a key, a password or a decrypted value.

use std::fmt;

use getssh_keystore::KsError;

use crate::sqlite::SqlError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Code {
    NotConfigured,
    Locked,
    NeedsPassword,
    WrongPassword,
    RateLimited,
    NotFound,
    InvalidArgument,
    Corrupt,
    Unavailable,
    Cancelled,
    Io,
    Busy,
    RotationPending,
    MustChangeMasterPassword,
    Internal,
}

impl Code {
    pub fn as_str(self) -> &'static str {
        match self {
            Code::NotConfigured => "not_configured",
            Code::Locked => "locked",
            Code::NeedsPassword => "needs_password",
            Code::WrongPassword => "wrong_password",
            Code::RateLimited => "rate_limited",
            Code::NotFound => "not_found",
            Code::InvalidArgument => "invalid_argument",
            Code::Corrupt => "corrupt",
            Code::Unavailable => "unavailable",
            Code::Cancelled => "cancelled",
            Code::Io => "io",
            Code::Busy => "busy",
            Code::RotationPending => "rotation_pending",
            Code::MustChangeMasterPassword => "must_change_master_password",
            Code::Internal => "internal",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreError {
    pub code: Code,
    pub message: String,
}

pub type StoreResult<T> = Result<T, StoreError>;

impl StoreError {
    pub fn new(code: Code, message: impl Into<String>) -> Self {
        StoreError { code, message: message.into() }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(Code::InvalidArgument, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(Code::NotFound, message)
    }

    pub fn locked(what: impl Into<String>) -> Self {
        Self::new(Code::Locked, what)
    }
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.message.is_empty() {
            write!(f, "[store:{}]", self.code.as_str())
        } else {
            write!(f, "[store:{}] {}", self.code.as_str(), self.message)
        }
    }
}

impl std::error::Error for StoreError {}

impl From<KsError> for StoreError {
    fn from(error: KsError) -> Self {
        let (code, message) = match error {
            KsError::NotConfigured | KsError::NotInitialized => (Code::NotConfigured, String::new()),
            KsError::AlreadyInitialized | KsError::NoRotation(_) => (Code::Internal, error.to_string()),
            KsError::UnknownScope(scope) => (Code::NotFound, scope),
            KsError::ScopeExists(scope) => (Code::InvalidArgument, format!("{scope} already exists")),
            KsError::Locked(scope) => (Code::Locked, scope),
            KsError::NoPassword(scope) => (Code::InvalidArgument, format!("{scope} has no password")),
            KsError::WrongPassword => (Code::WrongPassword, String::new()),
            KsError::RateLimited(ms) => (Code::RateLimited, format!("retry in {ms} ms")),
            KsError::Cancelled => (Code::Cancelled, String::new()),
            KsError::Unavailable(detail) => (Code::Unavailable, detail),
            KsError::DeviceKeyLost => (Code::Unavailable, "the device key of this computer is gone".into()),
            KsError::InvalidRecoveryCode => (Code::WrongPassword, "invalid recovery code".into()),
            KsError::RevealLocked => (Code::Locked, "the reveal window is closed".into()),
            KsError::RotationPending(scope) => (Code::RotationPending, scope),
            KsError::InvalidArgument(detail) => (Code::InvalidArgument, detail),
            KsError::Corrupt(detail) => (Code::Corrupt, detail),
            KsError::Io(detail) => (Code::Io, detail),
        };
        StoreError { code, message }
    }
}

impl From<SqlError> for StoreError {
    fn from(error: SqlError) -> Self {
        let code = match error.code & 0xff {
            5 | 6 => Code::Busy,           // SQLITE_BUSY, SQLITE_LOCKED
            11 | 26 => Code::Corrupt,      // SQLITE_CORRUPT, SQLITE_NOTADB
            8 | 10 | 13 | 14 => Code::Io,  // READONLY, IOERR, FULL, CANTOPEN
            19 => Code::InvalidArgument,   // SQLITE_CONSTRAINT
            _ => Code::Internal,
        };
        StoreError { code, message: error.to_string() }
    }
}

impl From<std::io::Error> for StoreError {
    fn from(error: std::io::Error) -> Self {
        StoreError::new(Code::Io, error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_carry_the_code_prefix() {
        assert_eq!(StoreError::locked("ws:a").to_string(), "[store:locked] ws:a");
        assert_eq!(StoreError::from(KsError::WrongPassword).to_string(), "[store:wrong_password]");
        assert_eq!(StoreError::from(KsError::DeviceKeyLost).code, Code::Unavailable);
        assert_eq!(StoreError::from(SqlError { code: 26, message: "file is not a database".into() }).code, Code::Corrupt);
    }
}
