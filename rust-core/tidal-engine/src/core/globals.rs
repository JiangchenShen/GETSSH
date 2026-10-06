use lazy_static::lazy_static;
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::state::TidalWorkspace;

lazy_static! {
    pub static ref GLOBAL_WORKSPACE: Arc<Mutex<TidalWorkspace>> = Arc::new(Mutex::new(TidalWorkspace::new()));
}
