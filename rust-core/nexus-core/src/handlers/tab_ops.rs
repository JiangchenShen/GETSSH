use napi::bindgen_prelude::Result;
use crate::core::globals::GLOBAL_WORKSPACE;
use crate::core::broadcaster::broadcast_state;

#[napi]
pub async fn request_close_tab(tab_id: String) -> Result<String> {
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;
    let closed = ws.close_tab(&tab_id);
    drop(ws);
    Ok(if closed { "success".to_string() } else { "not_found".to_string() })
}

#[napi]
pub async fn register_tab(tab_id: String, root_pane_id: String, session_id: String, pane_type: String, config_json: String, title: String) -> Result<String> {
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    // Provide config as Value
    let config = serde_json::from_str(&config_json).unwrap_or(serde_json::json!({}));

    let root_pane = crate::state::pane::PaneNode::Leaf {
        pane_id: root_pane_id,
        pane_type,
        session_id: Some(session_id),
        config,
        is_disconnected: None,
        is_zoomed: None,
    };

    let tab = crate::state::workspace::TabNode {
        tab_id: tab_id.clone(),
        title,
        pane_tree: root_pane,
        is_torn_off: false,
    };

    // Auto-create a default window if none
    if ws.windows.is_empty() {
        ws.windows.insert("main".to_string(), crate::state::workspace::NativeWindowNode {
            window_id: "main".to_string(),
            tabs: vec![],
            active_tab_id: tab_id.clone(),
        });
    }

    if let Some(win) = ws.windows.get_mut("main") {
        win.tabs.push(tab);
    }
    
    drop(ws);
    broadcast_state().await;

    Ok("success".to_string())
}
