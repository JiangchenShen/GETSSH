use napi::bindgen_prelude::Result;
use serde_json::json;
use crate::core::globals::GLOBAL_WORKSPACE;
use crate::core::broadcaster::emit_tabs;
use crate::handlers::refused;

// All handlers emit the affected tabs while still holding the workspace lock, so a later mutation can
// never be delivered before an earlier one.

#[napi]
pub async fn request_split(pane_id: String, direction: String) -> Result<String> {
    println!("[Nexus Core] Dispatching SPLIT_PANE for {} in direction {}", pane_id, direction);
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    Ok(match ws.split_pane(&pane_id, &direction) {
        Ok((tab_id, new_pane_id)) => {
            emit_tabs(&ws, &[&tab_id]);
            json!({ "ok": true, "tabId": tab_id, "newPaneId": new_pane_id }).to_string()
        }
        Err(reason) => refused(reason),
    })
}

#[napi]
pub async fn request_replace_pane(pane_id: String, pane_type: String, session_id: Option<String>, config_json: String) -> Result<String> {
    println!("[Nexus Core] Dispatching REPLACE_PANE for {} to type {}", pane_id, pane_type);
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    let config = serde_json::from_str(&config_json).unwrap_or(serde_json::json!({}));
    let session_id = session_id.filter(|id| !id.is_empty());

    Ok(match ws.replace_pane(&pane_id, pane_type, session_id, config) {
        Ok(outcome) => {
            emit_tabs(&ws, &[&outcome.tab_id]);
            json!({ "ok": true, "tabId": outcome.tab_id, "previousSessionId": outcome.previous_session_id }).to_string()
        }
        Err(reason) => refused(reason),
    })
}

#[napi]
pub async fn request_close_pane(pane_id: String) -> Result<String> {
    println!("[Nexus Core] Dispatching CLOSE_PANE for {}", pane_id);
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    Ok(match ws.close_pane(&pane_id) {
        Ok(outcome) => {
            // A closed tab is emitted with `tree: null`
            emit_tabs(&ws, &[&outcome.tab_id]);
            json!({
                "ok": true,
                "tabId": outcome.tab_id,
                "tabClosed": outcome.tab_closed,
                "removedSessionIds": outcome.removed_session_ids,
            }).to_string()
        }
        Err(reason) => refused(reason),
    })
}

#[napi]
pub async fn request_toggle_zoom(pane_id: String) -> Result<String> {
    println!("[Nexus Core] Dispatching TOGGLE_ZOOM for {}", pane_id);
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    Ok(match ws.toggle_zoom(&pane_id) {
        Ok(tab_id) => {
            emit_tabs(&ws, &[&tab_id]);
            json!({ "ok": true }).to_string()
        }
        Err(reason) => refused(reason),
    })
}

#[napi]
pub async fn request_update_sizes(pane_id: String, sizes: Vec<f64>) -> Result<String> {
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    Ok(match ws.update_sizes(&pane_id, &sizes) {
        Ok(tab_id) => {
            emit_tabs(&ws, &[&tab_id]);
            json!({ "ok": true }).to_string()
        }
        Err(reason) => refused(reason),
    })
}

#[napi]
pub async fn request_patch_leaf(pane_id: String, disconnected: bool) -> Result<String> {
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    Ok(match ws.set_disconnected(&pane_id, disconnected) {
        Ok(tab_id) => {
            emit_tabs(&ws, &[&tab_id]);
            json!({ "ok": true }).to_string()
        }
        Err(reason) => refused(reason),
    })
}

#[napi]
pub async fn request_tear_off(pane_id: String) -> Result<String> {
    println!("[Nexus Core] Dispatching TEAR_OFF for {}", pane_id);
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    Ok(match ws.tear_off(&pane_id) {
        Ok(outcome) => {
            // Source first (the pane leaves it), then the torn tab; a torn root is a single tab
            let mut tab_ids = vec![outcome.source_tab_id.as_str()];
            if outcome.tab_id != outcome.source_tab_id {
                tab_ids.push(outcome.tab_id.as_str());
            }
            let snapshot = emit_tabs(&ws, &tab_ids).pop();
            json!({
                "ok": true,
                "tabId": outcome.tab_id,
                "sourceTabId": outcome.source_tab_id,
                "sessionIds": outcome.session_ids,
                "snapshot": snapshot,
            }).to_string()
        }
        Err(reason) => refused(reason),
    })
}

#[napi]
pub async fn request_tear_in(tab_id: String) -> Result<String> {
    println!("[Nexus Core] Dispatching TEAR_IN for {}", tab_id);
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    Ok(match ws.tear_in(&tab_id) {
        Ok(outcome) => {
            // Re-docked: the origin tab gains the panes first, then the torn tab goes away (`tree: null`)
            let mut tab_ids = Vec::new();
            if outcome.redocked {
                tab_ids.push(outcome.target_tab_id.as_str());
            }
            tab_ids.push(outcome.tab_id.as_str());
            emit_tabs(&ws, &tab_ids);
            json!({
                "ok": true,
                "tabId": outcome.tab_id,
                "redocked": outcome.redocked,
                "targetTabId": outcome.target_tab_id,
                "paneId": outcome.pane_id,
            }).to_string()
        }
        Err(reason) => refused(reason),
    })
}

// Called by the main process when a session ends on its own: every leaf showing it gets the disconnected overlay
#[napi]
pub async fn request_mark_session_disconnected(session_id: String) -> Result<String> {
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    let (count, tab_ids) = ws.mark_session_disconnected(&session_id);
    if !tab_ids.is_empty() {
        let tab_ids: Vec<&str> = tab_ids.iter().map(String::as_str).collect();
        emit_tabs(&ws, &tab_ids);
    }
    Ok(json!({ "ok": true, "count": count }).to_string())
}
