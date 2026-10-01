use std::fmt;

/// Errors surfaced to the main process. `code()` is stable and parsed by the TypeScript wrapper.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KsError {
    NotConfigured,
    NotInitialized,
    AlreadyInitialized,
    UnknownScope(String),
    ScopeExists(String),
    /// The scope is protected and its key is not in memory.
    Locked(String),
    /// The scope has no password of its own (or no master password, for "app").
    NoPassword(String),
    WrongPassword,
    /// Too many wrong passwords; retry after this many milliseconds.
    RateLimited(u64),
    Cancelled,
    /// The OS facility is missing or failed transiently.
    Unavailable(String),
    /// The device key no longer works on this machine (moved to another computer, reset).
    DeviceKeyLost,
    InvalidRecoveryCode,
    RevealLocked,
    RotationPending(String),
    NoRotation(String),
    InvalidArgument(String),
    Corrupt(String),
    Io(String),
}

impl KsError {
    pub fn code(&self) -> &'static str {
        match self {
            KsError::NotConfigured => "not_configured",
            KsError::NotInitialized => "not_initialized",
            KsError::AlreadyInitialized => "already_initialized",
            KsError::UnknownScope(_) => "unknown_scope",
            KsError::ScopeExists(_) => "scope_exists",
            KsError::Locked(_) => "locked",
            KsError::NoPassword(_) => "no_password",
            KsError::WrongPassword => "wrong_password",
            KsError::RateLimited(_) => "rate_limited",
            KsError::Cancelled => "cancelled",
            KsError::Unavailable(_) => "unavailable",
            KsError::DeviceKeyLost => "device_key_lost",
            KsError::InvalidRecoveryCode => "invalid_recovery_code",
            KsError::RevealLocked => "reveal_locked",
            KsError::RotationPending(_) => "rotation_pending",
            KsError::NoRotation(_) => "no_rotation",
            KsError::InvalidArgument(_) => "invalid_argument",
            KsError::Corrupt(_) => "corrupt",
            KsError::Io(_) => "io",
        }
    }

    fn detail(&self) -> String {
        match self {
            KsError::UnknownScope(s)
            | KsError::ScopeExists(s)
            | KsError::Locked(s)
            | KsError::NoPassword(s)
            | KsError::Unavailable(s)
            | KsError::RotationPending(s)
            | KsError::NoRotation(s)
            | KsError::InvalidArgument(s)
            | KsError::Corrupt(s)
            | KsError::Io(s) => s.clone(),
            KsError::RateLimited(ms) => ms.to_string(),
            _ => String::new(),
        }
    }
}

impl fmt::Display for KsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let detail = self.detail();
        if detail.is_empty() {
            write!(f, "[keystore:{}]", self.code())
        } else {
            write!(f, "[keystore:{}] {}", self.code(), detail)
        }
    }
}

impl std::error::Error for KsError {}

impl From<std::io::Error> for KsError {
    fn from(error: std::io::Error) -> Self {
        KsError::Io(error.to_string())
    }
}
