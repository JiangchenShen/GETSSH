use napi::bindgen_prelude::Result;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy};
use lazy_static::lazy_static;
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::state::PaneNode;
use crate::core::globals::GLOBAL_WORKSPACE;

lazy_static! {
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

pub async fn broadcast_tree(tab_id: String, new_tree: PaneNode, is_torn_off: bool) {
    let mut title = String::new();
    {
        let workspace_ref = GLOBAL_WORKSPACE.clone();
        let ws = workspace_ref.lock().await;
        for window in ws.windows.values() {
            if let Some(tab) = window.tabs.iter().find(|t| t.tab_id == tab_id) {
                title = tab.title.clone();
                break;
            }
        }
    }

    let tsfn_arc = SYNC_TREE_TSFN.clone();
    let guard = tsfn_arc.lock().await;
    if let Some(tsfn) = &*guard {
        let payload = serde_json::json!({
            "tabId": tab_id,
            "title": title,
            "tree": new_tree,
            "is_torn_off": is_torn_off
        });
        tsfn.call(Ok(payload.to_string()), ThreadsafeFunctionCallMode::NonBlocking);
    }
}

pub async fn broadcast_state() {
    let mut trees = Vec::new();
    {
        let workspace_ref = GLOBAL_WORKSPACE.clone();
        let ws = workspace_ref.lock().await;
        for (_, win) in ws.windows.iter() {
            for tab in win.tabs.iter() {
                trees.push((tab.tab_id.clone(), tab.pane_tree.clone(), tab.is_torn_off));
            }
        }
    }

    for (tab_id, tree, is_torn_off) in trees {
        broadcast_tree(tab_id, tree, is_torn_off).await;
    }
}
