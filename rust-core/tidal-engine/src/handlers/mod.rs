pub mod pane_ops;
pub mod tab_ops;
pub mod workspace_ops;

// Every request resolves to a JSON string: `{ ok: true, ... }` or `{ ok: false, reason }`
pub(crate) fn refused(reason: &str) -> String {
    serde_json::json!({ "ok": false, "reason": reason }).to_string()
}
