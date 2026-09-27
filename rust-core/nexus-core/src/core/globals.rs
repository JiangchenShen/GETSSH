use lazy_static::lazy_static;
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::state::NexusWorkspace;

lazy_static! {
    pub static ref GLOBAL_WORKSPACE: Arc<Mutex<NexusWorkspace>> = Arc::new(Mutex::new(NexusWorkspace::new()));
}
