//! App-wide secrets: AI provider keys, plugin secrets, MCP server tokens. They replace the
//! safeStorage files the main process wrote, whose synchronous Keychain access blocked the main
//! thread. Each value is sealed with the app scope's field key ("gk1:…", bound to its name) in
//! main.db, so an export carries them and a master password protects them like everything else.

use getssh_keystore::device::Device;
use getssh_keystore::keyring::APP;
use zeroize::Zeroizing;

use crate::error::{StoreError, StoreResult};
use crate::folders::{has_control, js_len};
use crate::store::{now_ms, Store};

const MAX_NAME_UNITS: usize = 256;

fn context(name: &str) -> String {
    format!("app_secret|{name}")
}

fn check_name(name: &str) -> StoreResult<()> {
    if name.is_empty() || js_len(name) > MAX_NAME_UNITS || has_control(name) {
        return Err(StoreError::invalid("secret name must have 1 to 256 characters and no control characters"));
    }
    Ok(())
}

impl<D: Device> Store<D> {
    /// Sets a secret, or deletes it with `None`.
    pub fn set_app_secret(&self, name: &str, value: Option<&str>) -> StoreResult<()> {
        self.with_main(|_| Ok(()))?;
        check_name(name)?;
        let sealed = match value {
            Some(value) => Some(self.keystore().seal_field(APP, &context(name), value.as_bytes())?),
            None => None,
        };
        self.with_main(|conn| {
            match &sealed {
                Some(sealed) => {
                    conn.execute(
                        "INSERT INTO app_secrets (name, value, updated_at) VALUES (?, ?, ?) \
                         ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                        &[name.into(), sealed.as_str().into(), now_ms().into()],
                    )?;
                }
                None => {
                    conn.execute_batch("PRAGMA secure_delete = ON")?;
                    conn.execute("DELETE FROM app_secrets WHERE name = ?", &[name.into()])?;
                }
            }
            Ok(())
        })
    }

    /// The secret's bytes, or `None` when it is not set. Main process only.
    pub fn get_app_secret(&self, name: &str) -> StoreResult<Option<Zeroizing<Vec<u8>>>> {
        self.with_main(|_| Ok(()))?;
        check_name(name)?;
        let sealed = self.with_main(|conn| Ok(conn.query_optional("SELECT value FROM app_secrets WHERE name = ?", &[name.into()], |r| r.text(0))?.flatten()))?;
        match sealed {
            Some(sealed) => Ok(Some(self.keystore().open_field(APP, &context(name), &Zeroizing::new(sealed))?)),
            None => Ok(None),
        }
    }

    /// Names only, sorted as JavaScript sorts strings (by UTF-16 code units).
    pub fn list_app_secret_names(&self, prefix: Option<&str>) -> StoreResult<Vec<String>> {
        let mut names = self.with_main(|conn| Ok(conn.query_map("SELECT name FROM app_secrets", &[], |r| Ok(r.text(0)?.unwrap_or_default()))?))?;
        if let Some(prefix) = prefix.filter(|p| !p.is_empty()) {
            names.retain(|name| name.starts_with(prefix));
        }
        names.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        Ok(names)
    }
}
