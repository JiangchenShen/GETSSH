use napi::bindgen_prelude::{Buffer, Result};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy};
use std::io::Read;
use crate::core::globals::GLOBAL_SSH_POOL;

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
