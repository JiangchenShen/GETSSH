use napi::bindgen_prelude::Result;
use serde_json::json;
use crate::core::globals::GLOBAL_WORKSPACE;
use crate::core::broadcaster::{current_rev, emit_tabs};
use crate::handlers::refused;

#[napi]
pub async fn request_close_tab(tab_id: String) -> Result<String> {
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    Ok(match ws.close_tab(&tab_id) {
        Ok(removed_session_ids) => {
            // Every window drops the tab on the `tree: null` payload
            emit_tabs(&ws, &[&tab_id]);
            json!({ "ok": true, "removedSessionIds": removed_session_ids }).to_string()
        }
        Err(reason) => refused(reason),
    })
}

// `session_id` "" means the root pane has no session
#[napi]
pub async fn register_tab(tab_id: String, root_pane_id: String, session_id: String, pane_type: String, config_json: String, title: String, workspace_id: Option<String>) -> Result<String> {
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    // Provide config as Value
    let config = serde_json::from_str(&config_json).unwrap_or(serde_json::json!({}));

    let root_pane = crate::state::pane::PaneNode::Leaf {
        pane_id: root_pane_id,
        pane_type,
        session_id: Some(session_id).filter(|id| !id.is_empty()),
        config,
        is_disconnected: None,
        is_zoomed: None,
    };

    let tab = crate::state::workspace::TabNode {
        tab_id: tab_id.clone(),
        title,
        pane_tree: root_pane,
        is_torn_off: false,
        workspace_id: workspace_id.filter(|id| !id.is_empty()),
        origin: None,
    };

    Ok(match ws.register_tab(tab) {
        Ok(()) => {
            emit_tabs(&ws, &[&tab_id]);
            json!({ "ok": true }).to_string()
        }
        Err(reason) => refused(reason),
    })
}

// Current payload of one tab (stamped with the current rev, which is not bumped) or `null`
#[napi]
pub async fn get_tab_snapshot(tab_id: String) -> Result<String> {
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let ws = workspace_ref.lock().await;

    Ok(match ws.tab(&tab_id) {
        Some(_) => ws.tab_payload(&tab_id, current_rev()).to_string(),
        None => "null".to_string(),
    })
}
