use napi::bindgen_prelude::*;
use napi_derive::napi;
use rusqlite::{Connection, Result as SqlResult, OptionalExtension};
use std::fs;

// Note: Using Multi-DB architecture (one db file per plugin)

fn open_db(db_path: &str) -> Result<Connection> {
    let conn = Connection::open(db_path).map_err(|e| Error::new(Status::GenericFailure, format!("Failed to open DB: {}", e)))?;
    conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| Error::new(Status::GenericFailure, format!("Failed to set WAL: {}", e)))?;
    conn.pragma_update(None, "synchronous", "NORMAL").map_err(|e| Error::new(Status::GenericFailure, format!("Failed to set synchronous: {}", e)))?;
    Ok(conn)
}

#[napi]
pub fn init_db(db_path: String) -> Result<()> {
    let conn = open_db(&db_path)?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS kv (
            key TEXT PRIMARY KEY,
            value TEXT
        )",
        [],
    ).map_err(|e| Error::new(Status::GenericFailure, format!("Failed to create table: {}", e)))?;
    Ok(())
}

#[napi]
pub fn get_val(db_path: String, key: String) -> Result<Option<String>> {
    let conn = open_db(&db_path)?;
    let mut stmt = conn.prepare("SELECT value FROM kv WHERE key = ?1").map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    
    let result: SqlResult<String> = stmt.query_row([&key], |row| row.get(0));
    
    match result.optional() {
        Ok(val) => Ok(val),
        Err(e) => Err(Error::new(Status::GenericFailure, e.to_string())),
    }
}

#[napi]
pub fn set_val(db_path: String, key: String, value: String) -> Result<()> {
    let conn = open_db(&db_path)?;
    conn.execute(
        "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [&key, &value],
    ).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    Ok(())
}

#[napi]
pub fn delete_val(db_path: String, key: String) -> Result<()> {
    let conn = open_db(&db_path)?;
    conn.execute("DELETE FROM kv WHERE key = ?1", [&key]).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    Ok(())
}

#[napi]
pub fn clear_val(db_path: String) -> Result<()> {
    let conn = open_db(&db_path)?;
    conn.execute("DELETE FROM kv", []).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    // Optionally vacuum to reclaim space
    conn.execute("VACUUM", []).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    Ok(())
}

#[napi]
pub fn get_storage_size(db_path: String) -> Result<u32> {
    // Get file size in bytes
    match fs::metadata(&db_path) {
        Ok(metadata) => Ok(metadata.len() as u32),
        Err(_) => Ok(0), // If file doesn't exist, size is 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn get_temp_db_path(test_name: &str) -> String {
        let counter = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let mut path = env::temp_dir();
        path.push(format!("getssh_kv_test_{}_{}.db", test_name, counter));
        path.to_string_lossy().into_owned()
    }

    fn cleanup_db(db_path: &str) {
        let _ = fs::remove_file(db_path);
        let _ = fs::remove_file(format!("{}-shm", db_path));
        let _ = fs::remove_file(format!("{}-wal", db_path));
    }

    #[test]
    fn test_init_db() {
        let db_path = get_temp_db_path("init");

        // Ensure clean state
        cleanup_db(&db_path);

        let result = init_db(db_path.clone());
        assert!(result.is_ok(), "init_db should succeed");

        // Verify file was created
        assert!(fs::metadata(&db_path).is_ok(), "DB file should exist");

        cleanup_db(&db_path);
    }

    #[test]
    fn test_set_and_get_val() {
        let db_path = get_temp_db_path("set_get");
        init_db(db_path.clone()).unwrap();

        let key = "test_key".to_string();
        let val1 = "test_value_1".to_string();
        let val2 = "test_value_2".to_string();

        // Initially should be None
        let get1 = get_val(db_path.clone(), key.clone()).unwrap();
        assert_eq!(get1, None, "Value should not exist initially");

        // Set value
        let set1 = set_val(db_path.clone(), key.clone(), val1.clone());
        assert!(set1.is_ok(), "set_val should succeed");

        // Get value
        let get2 = get_val(db_path.clone(), key.clone()).unwrap();
        assert_eq!(get2, Some(val1.clone()), "Retrieved value should match set value");

        // Update value
        let set2 = set_val(db_path.clone(), key.clone(), val2.clone());
        assert!(set2.is_ok(), "set_val (update) should succeed");

        // Get updated value
        let get3 = get_val(db_path.clone(), key.clone()).unwrap();
        assert_eq!(get3, Some(val2), "Retrieved value should match updated value");

        cleanup_db(&db_path);
    }

    #[test]
    fn test_delete_val() {
        let db_path = get_temp_db_path("delete");
        init_db(db_path.clone()).unwrap();

        let key = "test_key".to_string();
        let val = "test_value".to_string();

        set_val(db_path.clone(), key.clone(), val).unwrap();

        let delete = delete_val(db_path.clone(), key.clone());
        assert!(delete.is_ok(), "delete_val should succeed");

        let get = get_val(db_path.clone(), key.clone()).unwrap();
        assert_eq!(get, None, "Value should be None after deletion");

        cleanup_db(&db_path);
    }

    #[test]
    fn test_clear_val() {
        let db_path = get_temp_db_path("clear");
        init_db(db_path.clone()).unwrap();

        set_val(db_path.clone(), "key1".to_string(), "val1".to_string()).unwrap();
        set_val(db_path.clone(), "key2".to_string(), "val2".to_string()).unwrap();

        let clear = clear_val(db_path.clone());
        assert!(clear.is_ok(), "clear_val should succeed");

        let get1 = get_val(db_path.clone(), "key1".to_string()).unwrap();
        assert_eq!(get1, None, "key1 should be None after clear");

        let get2 = get_val(db_path.clone(), "key2".to_string()).unwrap();
        assert_eq!(get2, None, "key2 should be None after clear");

        cleanup_db(&db_path);
    }

    #[test]
    fn test_get_storage_size() {
        let db_path = get_temp_db_path("size");

        // Non-existent DB
        let size_none = get_storage_size(db_path.clone()).unwrap();
        assert_eq!(size_none, 0, "Size should be 0 for non-existent DB");

        init_db(db_path.clone()).unwrap();

        // Empty DB
        let size_empty = get_storage_size(db_path.clone()).unwrap();
        assert!(size_empty > 0, "Size should be > 0 for initialized DB");

        // DB with data
        set_val(db_path.clone(), "key".to_string(), "a_very_long_string_to_increase_size_significantly".repeat(100)).unwrap();
        let size_data = get_storage_size(db_path.clone()).unwrap();
        assert!(size_data > size_empty, "Size should increase after adding data");

        cleanup_db(&db_path);
    }
}
