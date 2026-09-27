use serde::{Deserialize, Serialize};
use crate::state::reason;


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
        sizes: [f64; 2],
    },
    #[serde(rename = "vsplit")]
    VSplit {
        #[serde(rename = "paneId")]
        pane_id: String,
        children: Box<[PaneNode; 2]>,
        sizes: [f64; 2],
    },
}

// Divider sizes from the renderer: exactly two finite numbers. The first is clamped to [10, 90] and the
// second is derived from it, so the pair always sums to 100.
pub fn normalize_sizes(sizes: &[f64]) -> Option<[f64; 2]> {
    if sizes.len() != 2 || !sizes.iter().all(|s| s.is_finite()) {
        return None;
    }
    let first = sizes[0].clamp(10.0, 90.0);
    Some([first, 100.0 - first])
}

impl PaneNode {
    pub fn pane_id(&self) -> &str {
        match self {
            PaneNode::Leaf { pane_id, .. } => pane_id,
            PaneNode::HSplit { pane_id, .. } => pane_id,
            PaneNode::VSplit { pane_id, .. } => pane_id,
        }
    }

    pub fn is_leaf(&self) -> bool {
        matches!(self, PaneNode::Leaf { .. })
    }

    pub fn count_leaves(&self) -> usize {
        match self {
            PaneNode::Leaf { .. } => 1,
            PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } => {
                children[0].count_leaves() + children[1].count_leaves()
            }
        }
    }

    pub fn leaves(&self) -> Vec<&PaneNode> {
        match self {
            PaneNode::Leaf { .. } => vec![self],
            PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } => {
                children.iter().flat_map(|c| c.leaves()).collect()
            }
        }
    }

    fn for_each_leaf_mut(&mut self, f: &mut dyn FnMut(&mut PaneNode)) {
        match self {
            PaneNode::Leaf { .. } => f(self),
            PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } => {
                for child in children.iter_mut() {
                    child.for_each_leaf_mut(f);
                }
            }
        }
    }

    // True when every leaf of this subtree is a terminal pane (the only kind a torn window can host)
    pub fn all_terminal(&self) -> bool {
        self.leaves().iter().all(|leaf| matches!(leaf, PaneNode::Leaf { pane_type, .. } if pane_type == "terminal"))
    }

    // Session ids held by the leaves of this subtree, in tree order, without duplicates or empty ids
    pub fn session_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = Vec::new();
        for leaf in self.leaves() {
            if let PaneNode::Leaf { session_id: Some(id), .. } = leaf {
                if !id.is_empty() && !ids.contains(id) {
                    ids.push(id.clone());
                }
            }
        }
        ids
    }

    // "hsplit" / "vsplit" for a split node, None for a leaf
    pub fn split_kind(&self) -> Option<&'static str> {
        match self {
            PaneNode::HSplit { .. } => Some("hsplit"),
            PaneNode::VSplit { .. } => Some("vsplit"),
            PaneNode::Leaf { .. } => None,
        }
    }

    pub fn first_leaf_id(&self) -> &str {
        match self {
            PaneNode::Leaf { pane_id, .. } => pane_id,
            PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } => children[0].first_leaf_id(),
        }
    }

    // The split directly holding `target_pane_id` and the target's index in it (0 or 1).
    // None when the target is this node itself or is not in this subtree.
    pub fn find_parent(&self, target_pane_id: &str) -> Option<(&PaneNode, usize)> {
        match self {
            PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } => {
                if let Some(position) = children.iter().position(|c| c.pane_id() == target_pane_id) {
                    return Some((self, position));
                }
                children.iter().find_map(|c| c.find_parent(target_pane_id))
            }
            PaneNode::Leaf { .. } => None,
        }
    }

    // Flags every leaf showing `target_session_id` as disconnected and returns how many there were
    pub fn mark_session_disconnected(&mut self, target_session_id: &str) -> usize {
        let mut count = 0;
        self.for_each_leaf_mut(&mut |leaf| {
            if let PaneNode::Leaf { session_id: Some(id), is_disconnected, .. } = leaf {
                if id == target_session_id {
                    *is_disconnected = Some(true);
                    count += 1;
                }
            }
        });
        count
    }

    pub fn contains(&self, target_pane_id: &str) -> bool {
        self.find_node(target_pane_id).is_some()
    }

    pub fn find_node(&self, target_pane_id: &str) -> Option<&PaneNode> {
        if self.pane_id() == target_pane_id {
            return Some(self);
        }
        match self {
            PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } => {
                children.iter().find_map(|c| c.find_node(target_pane_id))
            }
            PaneNode::Leaf { .. } => None,
        }
    }

    pub fn find_node_mut(&mut self, target_pane_id: &str) -> Option<&mut PaneNode> {
        if self.pane_id() == target_pane_id {
            return Some(self);
        }
        match self {
            PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } => {
                children.iter_mut().find_map(|c| c.find_node_mut(target_pane_id))
            }
            PaneNode::Leaf { .. } => None,
        }
    }

    // Split the leaf `target_pane_id` into a split node holding the original leaf and a new welcome leaf.
    // Ok(false) means the target is not in this subtree.
    pub fn split_pane(&mut self, target_pane_id: &str, direction: &str, new_pane_id: &str, split_id: &str, parent_type: Option<&str>) -> Result<bool, &'static str> {
        if self.pane_id() == target_pane_id {
            if !self.is_leaf() {
                return Err(reason::NOT_LEAF);
            }
            // Enforce alternating splits (2x2 grid max, prevent 4 columns or 4 rows)
            if let Some(pt) = parent_type {
                if pt == "hsplit" && direction == "horizontal" { return Err(reason::DIRECTION_NOT_ALLOWED); }
                if pt == "vsplit" && direction == "vertical" { return Err(reason::DIRECTION_NOT_ALLOWED); }
            }
            // The original leaf keeps its flags (a dead session must keep its disconnected overlay)
            let original_leaf = std::mem::replace(self, PaneNode::Leaf {
                pane_id: String::new(),
                pane_type: String::new(),
                session_id: None,
                config: serde_json::Value::Null,
                is_disconnected: None,
                is_zoomed: None,
            });
            let new_leaf = PaneNode::Leaf {
                pane_id: new_pane_id.to_string(),
                pane_type: "welcome".to_string(),
                session_id: None,
                config: serde_json::json!({}),
                is_disconnected: None,
                is_zoomed: None,
            };

            let children = Box::new([original_leaf, new_leaf]);
            let sizes = [50.0, 50.0];
            let pane_id = split_id.to_string();

            if direction == "horizontal" {
                *self = PaneNode::HSplit { pane_id, children, sizes };
            } else {
                *self = PaneNode::VSplit { pane_id, children, sizes };
            }
            return Ok(true);
        }

        // Search recursively
        let child_parent = match self {
            PaneNode::HSplit { .. } => "hsplit",
            PaneNode::VSplit { .. } => "vsplit",
            PaneNode::Leaf { .. } => return Ok(false),
        };
        if let PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } = self {
            for child in children.iter_mut() {
                if child.split_pane(target_pane_id, direction, new_pane_id, split_id, Some(child_parent))? {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    // Zoom is exclusive within a tree: every leaf is un-zoomed, then the target is zoomed when `zoom` is set
    pub fn set_zoom_exclusive(&mut self, target_pane_id: &str, zoom: bool) {
        self.for_each_leaf_mut(&mut |leaf| {
            if let PaneNode::Leaf { pane_id, is_zoomed, .. } = leaf {
                *is_zoomed = if zoom && pane_id == target_pane_id { Some(true) } else { None };
            }
        });
    }

    pub fn clear_zoom(&mut self) {
        self.set_zoom_exclusive("", false);
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
