use napi::bindgen_prelude::Result;
use crate::core::globals::GLOBAL_WORKSPACE;
use crate::core::broadcaster::{broadcast_tree, SYNC_TREE_TSFN};

#[napi]
pub async fn request_split(pane_id: String, direction: String) -> Result<String> {
    println!("[Nexus Core] Dispatching SPLIT_PANE for {} in direction {}", pane_id, direction);
    
    // Simulate generation of new pane id
    let new_pane_id = format!("pane-{}-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(), uuid::Uuid::new_v4().to_string().chars().take(6).collect::<String>());

    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    // Mutate
    let mut tree_to_broadcast = None;
    if let Some((tab_id, new_tree)) = ws.split_pane(&pane_id, &direction, new_pane_id) {
        tree_to_broadcast = Some((tab_id, new_tree));
    }
    
    drop(ws);
    
    if let Some((tab_id, new_tree)) = tree_to_broadcast {
        broadcast_tree(tab_id, new_tree, false).await;
    }

    Ok("success".to_string())
}

#[napi]
pub async fn request_replace_pane(pane_id: String, pane_type: String, session_id: Option<String>, config_json: String) -> Result<String> {
    println!("[Nexus Core] Dispatching REPLACE_PANE for {} to type {}", pane_id, pane_type);
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    let config = serde_json::from_str(&config_json).unwrap_or(serde_json::json!({}));
    
    let mut tree_to_broadcast = None;
    if let Some((tab_id, new_tree)) = ws.replace_pane(&pane_id, pane_type, session_id, config) {
        tree_to_broadcast = Some((tab_id, new_tree));
    }
    
    drop(ws);
    
    if let Some((tab_id, new_tree)) = tree_to_broadcast {
        broadcast_tree(tab_id, new_tree, false).await;
    }

    Ok("success".to_string())
}

#[napi]
pub async fn request_close_pane(pane_id: String) -> Result<String> {
    println!("[Nexus Core] Dispatching CLOSE_PANE for {}", pane_id);
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    let mut tree_to_broadcast = None;
    if let Some((tab_id, new_tree)) = ws.close_pane(&pane_id) {
        if let Some(t) = new_tree {
             tree_to_broadcast = Some((tab_id, Some(t)));
        } else {
             println!("[Nexus Core] Root pane closed, broadcasting null tree");
             tree_to_broadcast = Some((tab_id, None));
        }
    }
    
    drop(ws);
    
    if let Some((tab_id, opt_tree)) = tree_to_broadcast {
        let is_torn_off = false; // Close pane doesn't tear off
        if let Some(t) = opt_tree {
            broadcast_tree(tab_id, t, is_torn_off).await;
        } else {
            let bridge_func = SYNC_TREE_TSFN.lock().await;
            if let Some(func) = &*bridge_func {
                let payload = serde_json::json!({
                    "tabId": tab_id,
                    "tree": null,
                    "is_torn_off": is_torn_off
                });
                func.call(Ok(payload.to_string()), napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking);
            }
        }
    }

    Ok("success".to_string())
}

#[napi]
pub async fn request_toggle_zoom(pane_id: String) -> Result<String> {
    println!("[Nexus Core] Dispatching TOGGLE_ZOOM for {}", pane_id);
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    let mut tree_to_broadcast = None;
    if let Some((tab_id, new_tree)) = ws.toggle_zoom(&pane_id) {
        let is_torn_off = ws.windows.values().find_map(|w| w.tabs.iter().find(|t| t.tab_id == tab_id)).map(|t| t.is_torn_off).unwrap_or_default();
        tree_to_broadcast = Some((tab_id, new_tree, is_torn_off));
    }
    
    drop(ws);
    
    if let Some((tab_id, new_tree, is_torn_off)) = tree_to_broadcast {
        broadcast_tree(tab_id, new_tree, is_torn_off).await;
    }

    Ok("success".to_string())
}

#[napi]
pub async fn request_update_sizes(pane_id: String, sizes: Vec<u8>) -> Result<String> {
    if sizes.len() != 2 {
        return Ok("invalid sizes".to_string());
    }
    let s = [sizes[0], sizes[1]];
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;
    let mut tree_to_broadcast = None;
    if let Some((tab_id, new_tree)) = ws.update_sizes(&pane_id, s) {
        let is_torn_off = ws.windows.values().find_map(|w| w.tabs.iter().find(|t| t.tab_id == tab_id)).map(|t| t.is_torn_off).unwrap_or_default();
        tree_to_broadcast = Some((tab_id, new_tree, is_torn_off));
    }
    drop(ws);
    if let Some((tab_id, new_tree, is_torn_off)) = tree_to_broadcast {
        broadcast_tree(tab_id, new_tree, is_torn_off).await;
    }
    Ok("success".to_string())
}

#[napi]
pub async fn request_patch_leaf(pane_id: String, disconnected: bool) -> Result<String> {
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;
    let mut tree_to_broadcast = None;
    if let Some((tab_id, new_tree)) = ws.set_disconnected(&pane_id, disconnected) {
        let is_torn_off = ws.windows.values().find_map(|w| w.tabs.iter().find(|t| t.tab_id == tab_id)).map(|t| t.is_torn_off).unwrap_or_default();
        tree_to_broadcast = Some((tab_id, new_tree, is_torn_off));
    }
    drop(ws);
    if let Some((tab_id, new_tree, is_torn_off)) = tree_to_broadcast {
        broadcast_tree(tab_id, new_tree, is_torn_off).await;
    }
    Ok("success".to_string())
}

#[napi]
pub async fn request_tear_off(pane_id: String) -> Result<String> {
    println!("[Nexus Core] Dispatching TEAR_OFF for {}", pane_id);
    
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;
    
    let mut trees_to_broadcast = Vec::new();
    
    if let Some((old_tab_id, old_tree, new_tab_id, new_tree)) = ws.tear_off_pane(&pane_id) {
        trees_to_broadcast.push((old_tab_id, old_tree, false));
        trees_to_broadcast.push((new_tab_id, Some(new_tree), true));
    }
    
    drop(ws);
    
    for (tab_id, opt_tree, is_torn_off) in trees_to_broadcast {
        if let Some(t) = opt_tree {
            broadcast_tree(tab_id, t, is_torn_off).await;
        } else {
            let bridge_func = SYNC_TREE_TSFN.lock().await;
            if let Some(func) = &*bridge_func {
                let payload = format!(r#"{{"tabId":"{}","tree":null}}"#, tab_id);
                func.call(Ok(payload), napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking);
            }
        }
    }

    Ok("success".to_string())
}

#[napi]
pub async fn request_tear_in(pane_id: String) -> Result<String> {
    println!("[Nexus Core] Dispatching TEAR_IN for {}", pane_id);
    
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;
    
    let mut tree_to_broadcast = None;
    
    if let Some((tab_id, new_tree)) = ws.tear_in_pane(&pane_id) {
        tree_to_broadcast = Some((tab_id, new_tree, false));
    }
    
    drop(ws);
    
    if let Some((tab_id, new_tree, is_torn_off)) = tree_to_broadcast {
        broadcast_tree(tab_id, new_tree, is_torn_off).await;
    }
    
    Ok("success".to_string())
}
