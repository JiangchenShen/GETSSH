use serde::{Deserialize, Serialize};


#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum PaneNode {
    #[serde(rename = "leaf")]
    Leaf {
        #[serde(rename = "paneId")]
        pane_id: String,
        #[serde(rename = "paneType")]
        pane_type: String, // "welcome", "terminal", "plugin"
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
        config: serde_json::Value,
        #[serde(rename = "isDisconnected", skip_serializing_if = "Option::is_none")]
        is_disconnected: Option<bool>,
        #[serde(rename = "isZoomed", skip_serializing_if = "Option::is_none")]
        is_zoomed: Option<bool>,
    },
    #[serde(rename = "hsplit")]
    HSplit {
        #[serde(rename = "paneId")]
        pane_id: String,
        children: Box<[PaneNode; 2]>,
        sizes: [u8; 2],
    },
    #[serde(rename = "vsplit")]
    VSplit {
        #[serde(rename = "paneId")]
        pane_id: String,
        children: Box<[PaneNode; 2]>,
        sizes: [u8; 2],
    },
}

impl PaneNode {
    pub fn pane_id(&self) -> &str {
        match self {
            PaneNode::Leaf { pane_id, .. } => pane_id,
            PaneNode::HSplit { pane_id, .. } => pane_id,
            PaneNode::VSplit { pane_id, .. } => pane_id,
        }
    }

    pub fn count_leaves(&self) -> usize {
        match self {
            PaneNode::Leaf { .. } => 1,
            PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } => {
                children[0].count_leaves() + children[1].count_leaves()
            }
        }
    }

    // Attempt to split this node if it's a leaf
    pub fn split_pane(&mut self, target_pane_id: &str, direction: &str, new_pane_id: String, parent_type: Option<&str>) -> bool {
        if self.pane_id() == target_pane_id {
            // Enforce alternating splits (2x2 grid max, prevent 4 columns or 4 rows)
            if let Some(pt) = parent_type {
                if pt == "hsplit" && direction == "horizontal" { return false; }
                if pt == "vsplit" && direction == "vertical" { return false; }
            }
            // We found the node. We can only split a leaf node currently
            if let PaneNode::Leaf { pane_id, pane_type, session_id, config, .. } = self {
                let original_leaf = PaneNode::Leaf {
                    pane_id: pane_id.clone(),
                    pane_type: pane_type.clone(),
                    session_id: session_id.clone(),
                    config: config.clone(),
                    is_disconnected: None,
                    is_zoomed: None,
                };
                let new_leaf = PaneNode::Leaf {
                    pane_id: new_pane_id,
                    pane_type: "welcome".to_string(),
                    session_id: None,
                    config: serde_json::json!({}),
                    is_disconnected: None,
                    is_zoomed: None,
                };
                
                let children = Box::new([original_leaf, new_leaf]);
                let sizes = [50, 50];
                let split_id = format!("split-{}", pane_id);
                
                if direction == "horizontal" {
                    *self = PaneNode::HSplit {
                        pane_id: split_id,
                        children,
                        sizes,
                    };
                } else {
                    *self = PaneNode::VSplit {
                        pane_id: split_id,
                        children,
                        sizes,
                    };
                }
                return true;
            }
            return false;
        }

        // Search recursively
        match self {
            PaneNode::HSplit { children, .. } => {
                if children[0].split_pane(target_pane_id, direction, new_pane_id.clone(), Some("hsplit")) {
                    return true;
                }
                if children[1].split_pane(target_pane_id, direction, new_pane_id, Some("hsplit")) {
                    return true;
                }
            }
            PaneNode::VSplit { children, .. } => {
                if children[0].split_pane(target_pane_id, direction, new_pane_id.clone(), Some("vsplit")) {
                    return true;
                }
                if children[1].split_pane(target_pane_id, direction, new_pane_id, Some("vsplit")) {
                    return true;
                }
            }
            _ => {}
        }
        false
    }

    pub fn replace_pane(&mut self, target_pane_id: &str, new_pane_type: String, new_session_id: Option<String>, new_config: serde_json::Value) -> bool {
        if self.pane_id() == target_pane_id {
            if let PaneNode::Leaf { pane_type, session_id, config, .. } = self {
                *pane_type = new_pane_type;
                *session_id = new_session_id;
                *config = new_config;
                return true;
            }
        }
        match self {
            PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } => {
                if children[0].replace_pane(target_pane_id, new_pane_type.clone(), new_session_id.clone(), new_config.clone()) {
                    return true;
                }
                if children[1].replace_pane(target_pane_id, new_pane_type, new_session_id, new_config) {
                    return true;
                }
            }
            _ => {}
        }
        false
    }

    // Toggle zoom on a leaf
    pub fn toggle_zoom(&mut self, target_pane_id: &str) -> bool {
        if self.pane_id() == target_pane_id {
            if let PaneNode::Leaf { is_zoomed, .. } = self {
                let current = is_zoomed.unwrap_or(false);
                *is_zoomed = Some(!current);
                return true;
            }
        }
        match self {
            PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } => {
                if children[0].toggle_zoom(target_pane_id) {
                    return true;
                }
                if children[1].toggle_zoom(target_pane_id) {
                    return true;
                }
            }
            _ => {}
        }
        false
    }

    pub fn update_sizes(&mut self, target_pane_id: &str, new_sizes: [u8; 2]) -> bool {
        if self.pane_id() == target_pane_id {
            if let PaneNode::HSplit { ref mut sizes, .. } | PaneNode::VSplit { ref mut sizes, .. } = self {
                *sizes = new_sizes;
                return true;
            }
        }
        match self {
            PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } => {
                if children[0].update_sizes(target_pane_id, new_sizes) { return true; }
                if children[1].update_sizes(target_pane_id, new_sizes) { return true; }
            }
            _ => {}
        }
        false
    }

    pub fn set_disconnected(&mut self, target_pane_id: &str, disconnected: bool) -> bool {
        if self.pane_id() == target_pane_id {
            if let PaneNode::Leaf { is_disconnected, .. } = self {
                *is_disconnected = Some(disconnected);
                return true;
            }
        }
        match self {
            PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } => {
                if children[0].set_disconnected(target_pane_id, disconnected) { return true; }
                if children[1].set_disconnected(target_pane_id, disconnected) { return true; }
            }
            _ => {}
        }
        false
    }

    pub fn find_leaf(&self, target_pane_id: &str) -> Option<PaneNode> {
        if self.pane_id() == target_pane_id {
            if let PaneNode::Leaf { .. } = self {
                return Some(self.clone());
            }
        }
        match self {
            PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } => {
                if let Some(leaf) = children[0].find_leaf(target_pane_id) {
                    return Some(leaf);
                }
                if let Some(leaf) = children[1].find_leaf(target_pane_id) {
                    return Some(leaf);
                }
            }
            _ => {}
        }
        None
    }

    pub fn find_node(&self, target_pane_id: &str) -> Option<PaneNode> {
        if self.pane_id() == target_pane_id {
            return Some(self.clone());
        }
        match self {
            PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } => {
                if let Some(node) = children[0].find_node(target_pane_id) {
                    return Some(node);
                }
                if let Some(node) = children[1].find_node(target_pane_id) {
                    return Some(node);
                }
            }
            _ => {}
        }
        None
    }

    // Returns a PaneNode if it should replace itself (e.g., when a child is deleted)
    pub fn close_pane(self, target_pane_id: &str) -> Option<PaneNode> {
        if self.pane_id() == target_pane_id {
            return None; // Delete self
        }

        match self {
            PaneNode::HSplit { pane_id, mut children, sizes } => {
                let left_exists = children[0].pane_id() != target_pane_id;
                let right_exists = children[1].pane_id() != target_pane_id;

                if !left_exists {
                    // Left is deleted, replace self with right
                    return Some(std::mem::replace(&mut children[1], PaneNode::Leaf {
                        pane_id: "".to_string(),
                        pane_type: "".to_string(),
                        session_id: None,
                        config: serde_json::Value::Null,
                        is_disconnected: None,
                        is_zoomed: None,
                    }));
                }
                if !right_exists {
                    // Right is deleted, replace self with left
                    return Some(std::mem::replace(&mut children[0], PaneNode::Leaf {
                        pane_id: "".to_string(),
                        pane_type: "".to_string(),
                        session_id: None,
                        config: serde_json::Value::Null,
                        is_disconnected: None,
                        is_zoomed: None,
                    }));
                }

                // Recursive check
                let mut c = *children;
                if let Some(new_left) = c[0].clone().close_pane(target_pane_id) {
                    c[0] = new_left;
                } else {
                    return Some(c[1].clone());
                }

                if let Some(new_right) = c[1].clone().close_pane(target_pane_id) {
                    c[1] = new_right;
                } else {
                    return Some(c[0].clone());
                }

                Some(PaneNode::HSplit { pane_id, children: Box::new(c), sizes })
            }
            PaneNode::VSplit { pane_id, mut children, sizes } => {
                let left_exists = children[0].pane_id() != target_pane_id;
                let right_exists = children[1].pane_id() != target_pane_id;

                if !left_exists {
                    return Some(std::mem::replace(&mut children[1], PaneNode::Leaf {
                        pane_id: "".to_string(),
                        pane_type: "".to_string(),
                        session_id: None,
                        config: serde_json::Value::Null,
                        is_disconnected: None,
                        is_zoomed: None,
                    }));
                }
                if !right_exists {
                    return Some(std::mem::replace(&mut children[0], PaneNode::Leaf {
                        pane_id: "".to_string(),
                        pane_type: "".to_string(),
                        session_id: None,
                        config: serde_json::Value::Null,
                        is_disconnected: None,
                        is_zoomed: None,
                    }));
                }

                let mut c = *children;
                if let Some(new_left) = c[0].clone().close_pane(target_pane_id) {
                    c[0] = new_left;
                } else {
                    return Some(c[1].clone());
                }

                if let Some(new_right) = c[1].clone().close_pane(target_pane_id) {
                    c[1] = new_right;
                } else {
                    return Some(c[0].clone());
                }

                Some(PaneNode::VSplit { pane_id, children: Box::new(c), sizes })
            }
            _ => Some(self),
        }
    }
}
