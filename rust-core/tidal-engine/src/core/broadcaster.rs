use napi::bindgen_prelude::Result;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use lazy_static::lazy_static;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use crate::state::TidalWorkspace;

lazy_static! {
    // A plain std mutex so registration is stored synchronously, before any later emit can run
    pub static ref SYNC_TREE_TSFN: Mutex<Option<ThreadsafeFunction<String>>> = Mutex::new(None);
}

// Global payload revision: starts at 1 and is bumped once per emitted payload
static NEXT_REV: AtomicU64 = AtomicU64::new(1);

#[napi]
pub fn register_sync_tree_callback(
    #[napi(ts_arg_type = "(err: Error | null, payloadJson: string) => void")]
    callback: ThreadsafeFunction<String>,
) -> Result<()> {
    let tsfn = callback;

    let mut guard = SYNC_TREE_TSFN.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(tsfn);
    println!("[Tidal Engine] State broadcasting channel registered.");

    Ok(())
}

// The rev of the last emitted payload (0 before the first emit). Read it under the workspace lock.
pub fn current_rev() -> u64 {
    NEXT_REV.load(Ordering::SeqCst) - 1
}

// Emits one sync payload per tab id and returns the payloads. Taking `&TidalWorkspace` means the caller
// holds the workspace lock, so revs and delivery order follow mutation order.
pub fn emit_tabs(ws: &TidalWorkspace, tab_ids: &[&str]) -> Vec<serde_json::Value> {
    let guard = SYNC_TREE_TSFN.lock().unwrap_or_else(|e| e.into_inner());
    tab_ids
        .iter()
        .map(|tab_id| {
            let payload = ws.tab_payload(tab_id, NEXT_REV.fetch_add(1, Ordering::SeqCst));
            if let Some(tsfn) = &*guard {
                tsfn.call(Ok(payload.to_string()), ThreadsafeFunctionCallMode::NonBlocking);
            }
            payload
        })
        .collect()
}
