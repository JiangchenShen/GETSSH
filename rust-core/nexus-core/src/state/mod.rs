pub mod pane;
pub mod workspace;

pub use pane::PaneNode;
pub use workspace::{NexusWorkspace, TabNode, NativeWindowNode};

// Refusal reasons returned to JS as `{ ok: false, reason }`
pub mod reason {
    pub const NOT_FOUND: &str = "not_found";
    pub const NOT_LEAF: &str = "not_leaf";
    pub const NOT_SPLIT: &str = "not_split";
    pub const MAX_PANES: &str = "max_panes";
    pub const DIRECTION_NOT_ALLOWED: &str = "direction_not_allowed";
    pub const INVALID_DIRECTION: &str = "invalid_direction";
    pub const INVALID_SIZES: &str = "invalid_sizes";
    pub const TAB_EXISTS: &str = "tab_exists";
    pub const ALREADY_TORN: &str = "already_torn";
    pub const NOT_TERMINAL: &str = "not_terminal";
    pub const NOT_TORN: &str = "not_torn";
}
