use napi::bindgen_prelude::{Buffer, Result};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy};
use lazy_static::lazy_static;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::io::Read;
use crate::state::NexusWorkspace;
use crate::ssh::NexusConnectionPool;

lazy_static! {
    pub static ref GLOBAL_WORKSPACE: Arc<Mutex<NexusWorkspace>> = Arc::new(Mutex::new(NexusWorkspace::new()));
    pub static ref GLOBAL_SSH_POOL: Arc<NexusConnectionPool> = Arc::new(NexusConnectionPool::new());
    pub static ref SYNC_TREE_TSFN: Arc<Mutex<Option<ThreadsafeFunction<String, ErrorStrategy::CalleeHandled>>>> = Arc::new(Mutex::new(None));
}

#[napi]
pub fn register_sync_tree_callback(
    #[napi(ts_arg_type = "(err: Error | null, treeJson: string, tabId: string) => void")]
    callback: napi::JsFunction,
) -> Result<()> {
    let tsfn: ThreadsafeFunction<String, ErrorStrategy::CalleeHandled> = callback
        .create_threadsafe_function(
            0,
            |ctx| Ok(vec![ctx.value]),
        )?;
    
    let tsfn_arc = SYNC_TREE_TSFN.clone();
    tokio::spawn(async move {
        let mut guard = tsfn_arc.lock().await;
        *guard = Some(tsfn);
        println!("[Nexus Core] State broadcasting channel registered.");
    });

    Ok(())
}

async fn broadcast_tree(tab_id: String, new_tree: crate::state::PaneNode) {
    let tsfn_arc = SYNC_TREE_TSFN.clone();
    let guard = tsfn_arc.lock().await;
    if let Some(tsfn) = &*guard {
        let payload = serde_json::json!({
            "tabId": tab_id,
            "tree": new_tree
        });
        tsfn.call(Ok(payload.to_string()), ThreadsafeFunctionCallMode::NonBlocking);
    }
}

pub async fn broadcast_state() {
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let ws = workspace_ref.lock().await;

    for (_, win) in ws.windows.iter() {
        for tab in win.tabs.iter() {
            broadcast_tree(tab.tab_id.clone(), tab.pane_tree.clone()).await;
        }
    }
}

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
        broadcast_tree(tab_id, new_tree).await;
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
        broadcast_tree(tab_id, new_tree).await;
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
        if let Some(t) = opt_tree {
            broadcast_tree(tab_id, t).await;
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
pub async fn request_toggle_zoom(pane_id: String) -> Result<String> {
    println!("[Nexus Core] Dispatching TOGGLE_ZOOM for {}", pane_id);
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    let mut tree_to_broadcast = None;
    if let Some((tab_id, new_tree)) = ws.toggle_zoom(&pane_id) {
        tree_to_broadcast = Some((tab_id, new_tree));
    }
    
    drop(ws);
    
    if let Some((tab_id, new_tree)) = tree_to_broadcast {
        broadcast_tree(tab_id, new_tree).await;
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
        tree_to_broadcast = Some((tab_id, new_tree));
    }
    drop(ws);
    if let Some((tab_id, new_tree)) = tree_to_broadcast {
        broadcast_tree(tab_id, new_tree).await;
    }
    Ok("success".to_string())
}

#[napi]
pub async fn request_patch_leaf(pane_id: String, disconnected: bool) -> Result<String> {
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;
    let mut tree_to_broadcast = None;
    if let Some((tab_id, new_tree)) = ws.set_disconnected(&pane_id, disconnected) {
        tree_to_broadcast = Some((tab_id, new_tree));
    }
    drop(ws);
    if let Some((tab_id, new_tree)) = tree_to_broadcast {
        broadcast_tree(tab_id, new_tree).await;
    }
    Ok("success".to_string())
}

#[napi]
pub async fn request_close_tab(tab_id: String) -> Result<String> {
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;
    let closed = ws.close_tab(&tab_id);
    drop(ws);
    Ok(if closed { "success".to_string() } else { "not_found".to_string() })
}

#[napi]
pub async fn request_tear_off(pane_id: String) -> Result<String> {
    println!("[Nexus Core] Dispatching TEAR_OFF for {}", pane_id);
    
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;
    
    let mut trees_to_broadcast = Vec::new();
    
    if let Some((old_tab_id, old_tree, new_tab_id, new_tree)) = ws.tear_off_pane(&pane_id) {
        trees_to_broadcast.push((old_tab_id, old_tree));
        trees_to_broadcast.push((new_tab_id, Some(new_tree)));
    }
    
    drop(ws);
    
    for (tab_id, opt_tree) in trees_to_broadcast {
        if let Some(t) = opt_tree {
            broadcast_tree(tab_id, t).await;
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
pub fn subscribe_pty_stream(
    session_id: String,
    pane_id: String,
    #[napi(ts_arg_type = "(err: Error | null, data: Buffer) => void")]
    callback: napi::JsFunction,
) -> Result<()> {
    println!("[Nexus Core] Subscribing PTY stream for session: {}, pane: {}", session_id, pane_id);

    let tsfn: ThreadsafeFunction<Buffer, ErrorStrategy::CalleeHandled> = callback
        .create_threadsafe_function(
            0,
            |ctx| Ok(vec![ctx.value]),
        )?;

    let pool_ref = GLOBAL_SSH_POOL.clone();

    tokio::spawn(async move {
        match pool_ref.split_fission(&session_id).await {
            Ok(mut pty_channel) => {
                println!("[Nexus Core] PTY Fission established for pane: {}", pane_id);
                
                tokio::task::spawn_blocking(move || {
                    let mut buf = [0u8; 8192];
                    loop {
                        match pty_channel.read(&mut buf) {
                            Ok(0) => {
                                println!("[Nexus Core] PTY Channel closed for pane: {}", pane_id);
                                break;
                            }
                            Ok(n) => {
                                let chunk = buf[..n].to_vec();
                                let status = tsfn.call(Ok(chunk.into()), ThreadsafeFunctionCallMode::Blocking);
                                if status != napi::Status::Ok {
                                    println!("[Nexus Core] Failed to forward PTY data to Node.js: {:?}", status);
                                    break;
                                }
                            }
                            Err(e) => {
                                println!("[Nexus Core] PTY Read Error for pane {}: {}", pane_id, e);
                                break;
                            }
                        }
                    }
                });
            }
            Err(e) => {
                println!("[Nexus Core] Fission failed for pane {}: {}", pane_id, e);
            }
        }
    });

    Ok(())
}

#[napi]
pub async fn init_nexus_core() -> Result<String> {
    println!("[Nexus Core] Boot sequence initiated...");
    // Future initialization logic
    Ok("Nexus Core Active".to_string())
}

#[napi]
pub async fn register_tab(tab_id: String, root_pane_id: String, session_id: String, pane_type: String, config_json: String, title: String) -> Result<String> {
    let workspace_ref = GLOBAL_WORKSPACE.clone();
    let mut ws = workspace_ref.lock().await;

    // Provide config as Value
    let config = serde_json::from_str(&config_json).unwrap_or(serde_json::json!({}));

    let root_pane = crate::state::PaneNode::Leaf {
        pane_id: root_pane_id,
        pane_type,
        session_id: Some(session_id),
        config,
        is_disconnected: None,
        is_zoomed: None,
    };

    let tab = crate::state::TabNode {
        tab_id: tab_id.clone(),
        title,
        pane_tree: root_pane,
    };

    // Auto-create a default window if none
    if ws.windows.is_empty() {
        ws.windows.insert("main".to_string(), crate::state::NativeWindowNode {
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
