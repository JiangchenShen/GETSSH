//! Runbooks, AI chat sessions, the encrypted local AI memory and the audit log: one function per
//! DatabaseManager.ts method. Validation follows store.fake.js, which store.conformance.mjs compares
//! against; the tables are the ones DatabaseManager created (schema.rs).

use std::collections::HashSet;

use getssh_keystore::device::Device;

use crate::error::{StoreError, StoreResult};
use crate::folders::{has_control, js_len};
use crate::sqlite::{Row, SqlResult, Value};
use crate::store::{now_ms, Store};

const MAX_ROW_ID_UNITS: usize = 256;
/// getAiMemoryVectors / getRecentAiMessagesForMemory never return more rows than this.
const MAX_MEMORY_ROWS: f64 = 2000.0;
const MAX_MEMORY_IDS: usize = 32;
const DEFAULT_AUDIT_LIMIT: i64 = 50;
/// listAiSessions / getAiMessages: the most a page holds.
pub const MAX_AI_SESSION_PAGE: f64 = 200.0;
pub const MAX_AI_MESSAGE_PAGE: f64 = 1000.0;
/// Message text (content plus raw_content, in UTF-8) in one page. A page has at least one message.
pub const MAX_AI_MESSAGE_PAGE_BYTES: i64 = 8 * 1024 * 1024;
/// Characters of the first reply in a chat's summary.
const AI_PREVIEW_CHARS: i64 = 120;

#[derive(Debug, Clone, PartialEq)]
pub struct Runbook {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub script: String,
    pub risk_level: String,
    pub created_at: f64,
}

#[derive(Debug, Clone)]
pub struct RunbookInput {
    pub id: String,
    pub title: String,
    pub script: String,
    pub risk_level: Option<String>,
    pub created_at: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AiMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub raw_content: Option<String>,
    pub timestamp: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AiSession {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub created_at: f64,
    pub updated_at: f64,
    pub messages: Vec<AiMessage>,
}

/// A chat in the list, without its messages.
#[derive(Debug, Clone, PartialEq)]
pub struct AiSessionSummary {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub created_at: f64,
    pub updated_at: f64,
    pub message_count: u32,
    /// The start of the first assistant message.
    pub preview: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AiSessionPage {
    pub sessions: Vec<AiSessionSummary>,
    /// Passed back to list the next, older page; None after the last one.
    pub next: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AiMessagePage {
    /// Oldest first.
    pub messages: Vec<AiMessage>,
    /// Passed back to read the messages before these; None when there are none.
    pub before: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AiMemoryVector {
    pub workspace_id: String,
    pub message_id: String,
    pub session_id: String,
    pub role: String,
    pub embedding: Vec<u8>,
    pub dimensions: f64,
    pub content_hash: String,
    pub timestamp: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AiMemoryMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuditLog {
    pub id: String,
    pub workspace_id: String,
    pub action: String,
    pub target: String,
    pub details: String,
    pub created_at: f64,
}

/// Ids of runbooks, sessions and messages: non-empty, at most 256 UTF-16 units, no control characters.
fn check_row_id(value: &str, what: &str) -> StoreResult<()> {
    if value.is_empty() || js_len(value) > MAX_ROW_ID_UNITS || has_control(value) {
        return Err(StoreError::invalid(format!("{what} must be a non-empty string without control characters")));
    }
    Ok(())
}

fn finite(value: f64, what: &str) -> StoreResult<f64> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(StoreError::invalid(format!("{what} must be a finite number")))
    }
}

/// 1 to 2000 rows, as DatabaseManager bounded them.
fn bounded_limit(limit: f64) -> StoreResult<i64> {
    Ok(finite(limit, "limit")?.trunc().clamp(1.0, MAX_MEMORY_ROWS) as i64)
}

fn page_limit(limit: f64, max: f64) -> StoreResult<i64> {
    Ok(finite(limit, "limit")?.trunc().clamp(1.0, max) as i64)
}

/// A position in a list ordered by a number and then rowid, both descending: "<number>:<rowid>".
/// Opaque to callers; it only has to come back to the same function.
fn encode_cursor(value: f64, rowid: i64) -> String {
    format!("{value}:{rowid}")
}

fn decode_cursor(cursor: &str) -> StoreResult<(Value, i64)> {
    let bad = || StoreError::invalid("invalid page cursor");
    let (value, rowid) = cursor.split_once(':').ok_or_else(bad)?;
    let value: f64 = value.parse().map_err(|_| bad())?;
    let rowid: i64 = rowid.parse().map_err(|_| bad())?;
    if !value.is_finite() {
        return Err(bad());
    }
    Ok((number(value), rowid))
}

/// JavaScript numbers: whole ones are stored as INTEGER, the rest as REAL (as better-sqlite3 did).
fn number(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        Value::Integer(value as i64)
    } else {
        Value::Real(value)
    }
}

fn read_number(row: &Row<'_, '_>, index: usize) -> SqlResult<f64> {
    Ok(match row.value(index)? {
        Value::Integer(v) => v as f64,
        Value::Real(v) => v,
        Value::Text(v) => v.parse().unwrap_or(0.0),
        _ => 0.0,
    })
}

fn is_memory_role(role: &str) -> bool {
    role == "user" || role == "assistant"
}

const MESSAGE_COLUMNS: &str = "id, session_id, role, content, raw_content, timestamp";

fn read_message(row: &Row<'_, '_>) -> SqlResult<AiMessage> {
    Ok(AiMessage {
        id: row.text(0)?.unwrap_or_default(),
        session_id: row.text(1)?.unwrap_or_default(),
        role: row.text(2)?.unwrap_or_default(),
        content: row.text(3)?.unwrap_or_default(),
        raw_content: row.text(4)?.filter(|v| !v.is_empty()),
        timestamp: read_number(row, 5)?,
    })
}

fn read_memory_message(row: &Row<'_, '_>) -> SqlResult<AiMemoryMessage> {
    Ok(AiMemoryMessage {
        id: row.text(0)?.unwrap_or_default(),
        session_id: row.text(1)?.unwrap_or_default(),
        role: row.text(2)?.unwrap_or_default(),
        content: row.text(3)?.unwrap_or_default(),
        timestamp: read_number(row, 4)?,
    })
}

impl<D: Device> Store<D> {
    // ───────────────────────────── runbooks ─────────────────────────────

    pub fn get_runbooks(&self, workspace_id: &str) -> StoreResult<Vec<Runbook>> {
        self.with_workspace(workspace_id, |conn| {
            Ok(conn.query_map(
                "SELECT id, workspace_id, title, script, riskLevel, created_at FROM runbooks WHERE workspace_id = ? ORDER BY created_at ASC, rowid ASC",
                &[workspace_id.into()],
                |r| {
                    Ok(Runbook {
                        id: r.text(0)?.unwrap_or_default(),
                        workspace_id: r.text(1)?.unwrap_or_default(),
                        title: r.text(2)?.unwrap_or_default(),
                        script: r.text(3)?.unwrap_or_default(),
                        risk_level: r.text(4)?.filter(|v| !v.is_empty()).unwrap_or_else(|| "LOW".into()),
                        created_at: read_number(r, 5)?,
                    })
                },
            )?)
        })
    }

    /// Replaces the workspace's runbooks. A missing risk level is LOW; a missing (or zero)
    /// created_at is now, as DatabaseManager did with `rb.created_at || Date.now()`.
    pub fn save_runbooks(&self, workspace_id: &str, runbooks: &[RunbookInput]) -> StoreResult<()> {
        self.with_workspace(workspace_id, |conn| {
            let mut seen = HashSet::new();
            let mut rows = Vec::with_capacity(runbooks.len());
            for rb in runbooks {
                check_row_id(&rb.id, "runbook id")?;
                if !seen.insert(rb.id.as_str()) {
                    return Err(StoreError::invalid(format!("duplicate runbook id {}", rb.id)));
                }
                let risk = rb.risk_level.clone().filter(|v| !v.is_empty()).unwrap_or_else(|| "LOW".into());
                let created_at = match rb.created_at {
                    // JavaScript treats 0 and NaN as "not given".
                    Some(v) if v != 0.0 && !v.is_nan() => number(finite(v, "created_at")?),
                    _ => now_ms().into(),
                };
                rows.push((rb, risk, created_at));
            }
            conn.transaction(|c| {
                c.execute("DELETE FROM runbooks WHERE workspace_id = ?", &[workspace_id.into()])?;
                for (rb, risk, created_at) in &rows {
                    c.execute(
                        "INSERT INTO runbooks (id, workspace_id, title, script, riskLevel, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                        &[rb.id.as_str().into(), workspace_id.into(), rb.title.as_str().into(), rb.script.as_str().into(), risk.as_str().into(), created_at.clone()],
                    )?;
                }
                Ok(())
            })?;
            Ok(())
        })
    }

    // ───────────────────────────── AI chat sessions ─────────────────────────────

    /// Newest session first; each with its messages, oldest first.
    pub fn get_ai_sessions(&self, workspace_id: &str) -> StoreResult<Vec<AiSession>> {
        self.with_workspace(workspace_id, |conn| {
            let sessions = conn.query_map(
                "SELECT id, workspace_id, title, created_at, updated_at FROM ai_sessions WHERE workspace_id = ? ORDER BY updated_at DESC, rowid DESC",
                &[workspace_id.into()],
                |r| {
                    Ok(AiSession {
                        id: r.text(0)?.unwrap_or_default(),
                        workspace_id: r.text(1)?.unwrap_or_default(),
                        title: r.text(2)?.unwrap_or_default(),
                        created_at: read_number(r, 3)?,
                        updated_at: read_number(r, 4)?,
                        messages: Vec::new(),
                    })
                },
            )?;
            let mut out = Vec::with_capacity(sessions.len());
            for mut session in sessions {
                session.messages = conn.query_map(
                    &format!("SELECT {MESSAGE_COLUMNS} FROM ai_messages WHERE session_id = ? ORDER BY timestamp ASC, rowid ASC"),
                    &[session.id.as_str().into()],
                    read_message,
                )?;
                out.push(session);
            }
            Ok(out)
        })
    }

    /// One page of chats, most recently updated first, without their messages.
    pub fn list_ai_sessions(&self, workspace_id: &str, limit: f64, cursor: Option<&str>) -> StoreResult<AiSessionPage> {
        let limit = page_limit(limit, MAX_AI_SESSION_PAGE)?;
        let after = cursor.filter(|c| !c.is_empty()).map(decode_cursor).transpose()?;
        self.with_workspace(workspace_id, |conn| {
            let (filter, mut params): (&str, Vec<Value>) = match after {
                Some((updated_at, rowid)) => (
                    "AND (s.updated_at < ? OR (s.updated_at = ? AND s.rowid < ?))",
                    vec![workspace_id.into(), updated_at.clone(), updated_at, rowid.into()],
                ),
                None => ("", vec![workspace_id.into()]),
            };
            params.push((limit + 1).into());
            let mut rows = conn.query_map(
                &format!(
                    "SELECT s.rowid, s.id, s.workspace_id, s.title, s.created_at, s.updated_at, \
                       (SELECT COUNT(*) FROM ai_messages m WHERE m.session_id = s.id), \
                       (SELECT substr(m.content, 1, {AI_PREVIEW_CHARS}) FROM ai_messages m WHERE m.session_id = s.id AND m.role = 'assistant' \
                          ORDER BY m.timestamp ASC, m.rowid ASC LIMIT 1) \
                     FROM ai_sessions s WHERE s.workspace_id = ? {filter} ORDER BY s.updated_at DESC, s.rowid DESC LIMIT ?"
                ),
                &params,
                |r| {
                    Ok((
                        r.integer(0)?,
                        AiSessionSummary {
                            id: r.text(1)?.unwrap_or_default(),
                            workspace_id: r.text(2)?.unwrap_or_default(),
                            title: r.text(3)?.unwrap_or_default(),
                            created_at: read_number(r, 4)?,
                            updated_at: read_number(r, 5)?,
                            message_count: u32::try_from(r.integer(6)?).unwrap_or(u32::MAX),
                            preview: r.text(7)?.filter(|v| !v.is_empty()),
                        },
                    ))
                },
            )?;
            let more = rows.len() as i64 > limit;
            rows.truncate(limit as usize);
            let next = if more { rows.last().map(|(rowid, s)| encode_cursor(s.updated_at, *rowid)) } else { None };
            Ok(AiSessionPage { sessions: rows.into_iter().map(|(_, s)| s).collect(), next })
        })
    }

    /// The newest messages of a chat before `before` (from the end when None), oldest first. A page
    /// stops at `limit` messages or MAX_AI_MESSAGE_PAGE_BYTES of text, whichever comes first.
    pub fn get_ai_messages(&self, workspace_id: &str, session_id: &str, limit: f64, before: Option<&str>) -> StoreResult<AiMessagePage> {
        check_row_id(session_id, "session id")?;
        let limit = page_limit(limit, MAX_AI_MESSAGE_PAGE)?;
        let before = before.filter(|c| !c.is_empty()).map(decode_cursor).transpose()?;
        self.with_workspace(workspace_id, |conn| {
            let session = conn.query_optional(
                "SELECT 1 FROM ai_sessions WHERE id = ? AND workspace_id = ?",
                &[session_id.into(), workspace_id.into()],
                |_| Ok(()),
            )?;
            if session.is_none() {
                return Err(StoreError::not_found(format!("AI session {session_id} does not exist")));
            }
            let (filter, mut params): (&str, Vec<Value>) = match before {
                Some((timestamp, rowid)) => (
                    "AND (timestamp < ? OR (timestamp = ? AND rowid < ?))",
                    vec![session_id.into(), timestamp.clone(), timestamp, rowid.into()],
                ),
                None => ("", vec![session_id.into()]),
            };
            let order = "ORDER BY timestamp DESC, rowid DESC LIMIT ?";
            // Sizes first, so a page of long messages is never read whole before it is cut.
            let mut size_params = params.clone();
            size_params.push((limit + 1).into());
            let sizes = conn.query_map(
                &format!(
                    "SELECT length(CAST(content AS BLOB)) + ifnull(length(CAST(raw_content AS BLOB)), 0) \
                     FROM ai_messages WHERE session_id = ? {filter} {order}"
                ),
                &size_params,
                |r| r.integer(0),
            )?;
            let mut take = 0i64;
            let mut bytes = 0i64;
            for size in sizes.iter().take(limit as usize) {
                if take > 0 && bytes + size > MAX_AI_MESSAGE_PAGE_BYTES {
                    break;
                }
                bytes += size;
                take += 1;
            }
            let more = (sizes.len() as i64) > take;
            params.push(take.into());
            let mut rows = conn.query_map(
                &format!("SELECT rowid, {MESSAGE_COLUMNS} FROM ai_messages WHERE session_id = ? {filter} {order}"),
                &params,
                |r| {
                    Ok((
                        r.integer(0)?,
                        AiMessage {
                            id: r.text(1)?.unwrap_or_default(),
                            session_id: r.text(2)?.unwrap_or_default(),
                            role: r.text(3)?.unwrap_or_default(),
                            content: r.text(4)?.unwrap_or_default(),
                            raw_content: r.text(5)?.filter(|v| !v.is_empty()),
                            timestamp: read_number(r, 6)?,
                        },
                    ))
                },
            )?;
            let before = if more { rows.last().map(|(rowid, m)| encode_cursor(m.timestamp, *rowid)) } else { None };
            rows.reverse();
            Ok(AiMessagePage { messages: rows.into_iter().map(|(_, m)| m).collect(), before })
        })
    }

    pub fn create_ai_session(&self, workspace_id: &str, id: &str, title: &str, timestamp: f64) -> StoreResult<()> {
        self.with_workspace(workspace_id, |conn| {
            check_row_id(id, "session id")?;
            let timestamp = number(finite(timestamp, "timestamp")?);
            if conn.query_optional("SELECT 1 FROM ai_sessions WHERE id = ?", &[id.into()], |_| Ok(()))?.is_some() {
                return Err(StoreError::invalid(format!("AI session {id} already exists")));
            }
            conn.execute(
                "INSERT INTO ai_sessions (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                &[id.into(), workspace_id.into(), title.into(), timestamp.clone(), timestamp],
            )?;
            Ok(())
        })
    }

    /// Adds a message, or updates the text of an existing one; the session's updated_at follows.
    pub fn save_ai_message(&self, workspace_id: &str, message: &AiMessage) -> StoreResult<()> {
        self.with_workspace(workspace_id, |conn| {
            check_row_id(&message.id, "message id")?;
            check_row_id(&message.session_id, "session_id")?;
            let timestamp = number(finite(message.timestamp, "timestamp")?);
            let raw: Value = message.raw_content.as_deref().filter(|v| !v.is_empty()).into();
            let exists = conn.query_optional("SELECT 1 FROM ai_messages WHERE id = ?", &[message.id.as_str().into()], |_| Ok(()))?.is_some();
            if !exists {
                let session = conn.query_optional(
                    "SELECT 1 FROM ai_sessions WHERE id = ? AND workspace_id = ?",
                    &[message.session_id.as_str().into(), workspace_id.into()],
                    |_| Ok(()),
                )?;
                if session.is_none() {
                    return Err(StoreError::not_found(format!("AI session {} does not exist", message.session_id)));
                }
            }
            conn.transaction(|c| {
                if exists {
                    c.execute("UPDATE ai_messages SET content = ?, raw_content = ? WHERE id = ?", &[message.content.as_str().into(), raw.clone(), message.id.as_str().into()])?;
                } else {
                    c.execute(
                        &format!("INSERT INTO ai_messages ({MESSAGE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)"),
                        &[
                            message.id.as_str().into(),
                            message.session_id.as_str().into(),
                            message.role.as_str().into(),
                            message.content.as_str().into(),
                            raw.clone(),
                            timestamp.clone(),
                        ],
                    )?;
                }
                c.execute(
                    "UPDATE ai_sessions SET updated_at = ? WHERE id = ? AND workspace_id = ?",
                    &[timestamp.clone(), message.session_id.as_str().into(), workspace_id.into()],
                )?;
                Ok(())
            })?;
            Ok(())
        })
    }

    /// Does nothing when the session does not exist.
    pub fn update_ai_session_title(&self, workspace_id: &str, id: &str, title: &str) -> StoreResult<()> {
        self.with_workspace(workspace_id, |conn| {
            conn.execute("UPDATE ai_sessions SET title = ? WHERE id = ? AND workspace_id = ?", &[title.into(), id.into(), workspace_id.into()])?;
            Ok(())
        })
    }

    /// Deletes the session and its messages; their pages are wiped (chats may contain secrets).
    pub fn delete_ai_session(&self, workspace_id: &str, id: &str) -> StoreResult<()> {
        self.with_workspace(workspace_id, |conn| {
            conn.execute_batch("PRAGMA secure_delete = ON")?;
            conn.transaction(|c| {
                c.execute("DELETE FROM ai_messages WHERE session_id = ?", &[id.into()])?;
                c.execute("DELETE FROM ai_sessions WHERE id = ? AND workspace_id = ?", &[id.into(), workspace_id.into()])?;
                Ok(())
            })?;
            Ok(())
        })
    }

    // ───────────────────────── local AI memory (main.db) ─────────────────────────

    /// Whether main.db is open, so memory can be read and written. Never an error while locked.
    pub fn is_encrypted_ai_memory_available(&self) -> StoreResult<bool> {
        self.check_live()?;
        Ok(self.is_started() && self.is_main_open())
    }

    /// The vectors live in main.db, but they belong to a workspace: it must be open too.
    fn require_open_workspace(&self, workspace_id: &str) -> StoreResult<()> {
        self.with_workspace(workspace_id, |_| Ok(()))
    }

    pub fn upsert_ai_memory_vector(&self, row: &AiMemoryVector) -> StoreResult<()> {
        self.with_main(|_| Ok(()))?;
        self.require_open_workspace(&row.workspace_id)?;
        check_row_id(&row.message_id, "message_id")?;
        check_row_id(&row.session_id, "session_id")?;
        if !is_memory_role(&row.role) {
            return Err(StoreError::invalid("role must be 'user' or 'assistant'"));
        }
        if !row.dimensions.is_finite() || row.dimensions < 0.0 || row.dimensions.fract() != 0.0 {
            return Err(StoreError::invalid("dimensions must be a non-negative integer"));
        }
        let timestamp = number(finite(row.timestamp, "timestamp")?);
        self.with_main(|conn| {
            // Delete and insert rather than update: a rewritten vector counts as the newest one.
            conn.transaction(|c| {
                c.execute("DELETE FROM ai_memory_vectors WHERE workspace_id = ? AND message_id = ?", &[row.workspace_id.as_str().into(), row.message_id.as_str().into()])?;
                c.execute(
                    "INSERT INTO ai_memory_vectors (workspace_id, message_id, session_id, role, embedding, dimensions, content_hash, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    &[
                        row.workspace_id.as_str().into(),
                        row.message_id.as_str().into(),
                        row.session_id.as_str().into(),
                        row.role.as_str().into(),
                        Value::Blob(row.embedding.clone()),
                        (row.dimensions as i64).into(),
                        row.content_hash.as_str().into(),
                        timestamp.clone(),
                    ],
                )?;
                Ok(())
            })?;
            Ok(())
        })
    }

    /// Newest first, at most `limit` (1 to 2000) rows; `exclude_session` leaves one session out.
    pub fn get_ai_memory_vectors(&self, workspace_id: &str, limit: f64, exclude_session: Option<&str>) -> StoreResult<Vec<AiMemoryVector>> {
        self.require_open_workspace(workspace_id)?;
        let limit = bounded_limit(limit)?;
        let exclude = exclude_session.filter(|s| !s.is_empty());
        self.with_main(|conn| {
            let (filter, params): (&str, Vec<Value>) = match exclude {
                Some(session) => ("AND session_id <> ?", vec![workspace_id.into(), session.into(), limit.into()]),
                None => ("", vec![workspace_id.into(), limit.into()]),
            };
            Ok(conn.query_map(
                &format!(
                    "SELECT workspace_id, message_id, session_id, role, embedding, dimensions, content_hash, timestamp FROM ai_memory_vectors \
                     WHERE workspace_id = ? {filter} ORDER BY timestamp DESC, rowid DESC LIMIT ?"
                ),
                &params,
                |r| {
                    Ok(AiMemoryVector {
                        workspace_id: r.text(0)?.unwrap_or_default(),
                        message_id: r.text(1)?.unwrap_or_default(),
                        session_id: r.text(2)?.unwrap_or_default(),
                        role: r.text(3)?.unwrap_or_default(),
                        embedding: r.blob(4)?.unwrap_or_default(),
                        dimensions: read_number(r, 5)?,
                        content_hash: r.text(6)?.unwrap_or_default(),
                        timestamp: read_number(r, 7)?,
                    })
                },
            )?)
        })
    }

    pub fn delete_ai_memory_message(&self, workspace_id: &str, message_id: &str) -> StoreResult<()> {
        self.require_open_workspace(workspace_id)?;
        self.with_main(|conn| {
            conn.execute("DELETE FROM ai_memory_vectors WHERE workspace_id = ? AND message_id = ?", &[workspace_id.into(), message_id.into()])?;
            Ok(())
        })
    }

    pub fn delete_ai_memory_session(&self, workspace_id: &str, session_id: &str) -> StoreResult<()> {
        self.require_open_workspace(workspace_id)?;
        self.with_main(|conn| {
            conn.execute("DELETE FROM ai_memory_vectors WHERE workspace_id = ? AND session_id = ?", &[workspace_id.into(), session_id.into()])?;
            Ok(())
        })
    }

    /// The newest user and assistant messages of the workspace, at most `limit` (1 to 2000).
    pub fn get_recent_ai_messages_for_memory(&self, workspace_id: &str, limit: f64) -> StoreResult<Vec<AiMemoryMessage>> {
        self.with_workspace(workspace_id, |conn| {
            let limit = bounded_limit(limit)?;
            Ok(conn.query_map(
                "SELECT m.id, m.session_id, m.role, m.content, m.timestamp FROM ai_messages m JOIN ai_sessions s ON s.id = m.session_id \
                 WHERE s.workspace_id = ? AND m.role IN ('user', 'assistant') ORDER BY m.timestamp DESC, m.rowid DESC LIMIT ?",
                &[workspace_id.into(), limit.into()],
                read_memory_message,
            )?)
        })
    }

    /// At most 32 distinct ids are looked up; messages come back in the order they were saved.
    pub fn get_ai_messages_by_ids(&self, workspace_id: &str, message_ids: &[String]) -> StoreResult<Vec<AiMemoryMessage>> {
        self.with_workspace(workspace_id, |conn| {
            let mut seen = HashSet::new();
            let ids: Vec<&String> = message_ids.iter().filter(|id| seen.insert(id.as_str())).take(MAX_MEMORY_IDS).collect();
            if ids.is_empty() {
                return Ok(Vec::new());
            }
            let placeholders = vec!["?"; ids.len()].join(", ");
            let mut params: Vec<Value> = vec![workspace_id.into()];
            params.extend(ids.iter().map(|id| Value::from(id.as_str())));
            Ok(conn.query_map(
                &format!(
                    "SELECT m.id, m.session_id, m.role, m.content, m.timestamp FROM ai_messages m JOIN ai_sessions s ON s.id = m.session_id \
                     WHERE s.workspace_id = ? AND m.id IN ({placeholders}) ORDER BY m.rowid"
                ),
                &params,
                read_memory_message,
            )?)
        })
    }

    // ───────────────────────────── audit log ─────────────────────────────

    pub fn log_audit(&self, workspace_id: &str, action: &str, target: Option<&str>, details: Option<&str>) -> StoreResult<()> {
        self.with_workspace(workspace_id, |conn| {
            conn.execute(
                "INSERT INTO audit_logs (id, workspace_id, action, target, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                &[
                    getssh_keystore::crypto::random_id().into(),
                    workspace_id.into(),
                    action.into(),
                    target.unwrap_or("").into(),
                    details.unwrap_or("").into(),
                    now_ms().into(),
                ],
            )?;
            Ok(())
        })
    }

    /// Newest first; 50 rows by default, every row for a negative limit.
    pub fn get_audit_logs(&self, workspace_id: &str, limit: Option<f64>) -> StoreResult<Vec<AuditLog>> {
        self.with_workspace(workspace_id, |conn| {
            let limit = match limit {
                None => DEFAULT_AUDIT_LIMIT,
                Some(v) => finite(v, "limit")?.trunc().max(-1.0).min(i64::MAX as f64) as i64,
            };
            Ok(conn.query_map(
                "SELECT id, workspace_id, action, target, details, created_at FROM audit_logs WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
                &[workspace_id.into(), limit.into()],
                |r| {
                    Ok(AuditLog {
                        id: r.text(0)?.unwrap_or_default(),
                        workspace_id: r.text(1)?.unwrap_or_default(),
                        action: r.text(2)?.unwrap_or_default(),
                        target: r.text(3)?.unwrap_or_default(),
                        details: r.text(4)?.unwrap_or_default(),
                        created_at: read_number(r, 5)?,
                    })
                },
            )?)
        })
    }
}
