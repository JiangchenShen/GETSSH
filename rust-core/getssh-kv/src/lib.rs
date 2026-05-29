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
