use lazy_static::lazy_static;
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::state::NexusWorkspace;
use crate::ssh::NexusConnectionPool;

lazy_static! {
    pub static ref GLOBAL_WORKSPACE: Arc<Mutex<NexusWorkspace>> = Arc::new(Mutex::new(NexusWorkspace::new()));
    pub static ref GLOBAL_SSH_POOL: Arc<NexusConnectionPool> = Arc::new(NexusConnectionPool::new());
}
