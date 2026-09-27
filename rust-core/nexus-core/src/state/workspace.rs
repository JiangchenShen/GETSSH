use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::state::pane::{normalize_sizes, PaneNode};
use crate::state::reason;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TabNode {
    pub tab_id: String,
    pub title: String,
    pub pane_tree: PaneNode,
    #[serde(default)]
    pub is_torn_off: bool,
    #[serde(default)]
    pub workspace_id: Option<String>,
    // Set on a tab created by tearing off a non-root subtree: where tear-in puts that subtree back
    #[serde(default)]
    pub origin: Option<Origin>,
}

// The split a torn subtree was detached from. `sibling_pane_id` is the node that took the collapsed split's place.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Origin {
    pub tab_id: String,
    pub sibling_pane_id: String,
    pub direction: String, // "hsplit" | "vsplit"
    pub position: usize,   // index of the torn subtree in the split: 0 or 1
    pub sizes: [f64; 2],
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NativeWindowNode {
    pub window_id: String,
    pub tabs: Vec<TabNode>,
    pub active_tab_id: String,
}

pub type OpResult<T> = Result<T, &'static str>;

pub struct ClosePaneOutcome {
    pub tab_id: String,
    pub tab_closed: bool,
    // Sessions no remaining leaf refers to; the main process disconnects them
    pub removed_session_ids: Vec<String>,
}

pub struct ReplacePaneOutcome {
    pub tab_id: String,
    pub previous_session_id: Option<String>,
}

pub struct TearOffOutcome {
    // The torn tab (equals source_tab_id when the whole tab was torn off)
    pub tab_id: String,
    pub source_tab_id: String,
    pub session_ids: Vec<String>,
}

pub struct TearInOutcome {
    // The torn tab (removed when it was re-docked)
    pub tab_id: String,
    pub redocked: bool,
    // The tab now showing the panes: the origin tab when re-docked, else the torn tab itself
    pub target_tab_id: String,
    // First leaf of the panes that came back
    pub pane_id: String,
}

pub struct NexusWorkspace {
    pub windows: HashMap<String, NativeWindowNode>,
}

impl Default for NexusWorkspace {
    fn default() -> Self {
        Self::new()
    }
}

impl NexusWorkspace {
    pub fn new() -> Self {
        Self {
            windows: HashMap::new(),
        }
    }

    fn tabs(&self) -> impl Iterator<Item = &TabNode> {
        self.windows.values().flat_map(|w| w.tabs.iter())
    }

    fn tabs_mut(&mut self) -> impl Iterator<Item = &mut TabNode> {
        self.windows.values_mut().flat_map(|w| w.tabs.iter_mut())
    }

    pub fn tab(&self, tab_id: &str) -> Option<&TabNode> {
        self.tabs().find(|t| t.tab_id == tab_id)
    }

    fn tab_mut(&mut self, tab_id: &str) -> Option<&mut TabNode> {
        self.tabs_mut().find(|t| t.tab_id == tab_id)
    }

    // Every node lookup resolves the tab that actually contains the node
    pub fn tab_containing(&self, node_id: &str) -> Option<&TabNode> {
        self.tabs().find(|t| t.pane_tree.contains(node_id))
    }

    fn tab_containing_mut(&mut self, node_id: &str) -> Option<&mut TabNode> {
        self.tabs_mut().find(|t| t.pane_tree.contains(node_id))
    }

    fn remove_tab(&mut self, tab_id: &str) -> Option<TabNode> {
        for window in self.windows.values_mut() {
            if let Some(idx) = window.tabs.iter().position(|t| t.tab_id == tab_id) {
                return Some(window.tabs.remove(idx));
            }
        }
        None
    }

    fn is_session_referenced(&self, session_id: &str) -> bool {
        self.tabs().any(|t| t.pane_tree.session_ids().iter().any(|id| id == session_id))
    }

    // Keep only the sessions that no remaining leaf still shows, so a live session is never terminated
    fn unreferenced(&self, session_ids: Vec<String>) -> Vec<String> {
        session_ids.into_iter().filter(|id| !self.is_session_referenced(id)).collect()
    }

    pub fn register_tab(&mut self, tab: TabNode) -> OpResult<()> {
        if self.tab(&tab.tab_id).is_some() {
            return Err(reason::TAB_EXISTS);
        }
        // Auto-create a default window if none
        let window = self.windows.entry("main".to_string()).or_insert_with(|| NativeWindowNode {
            window_id: "main".to_string(),
            tabs: vec![],
            active_tab_id: tab.tab_id.clone(),
        });
        window.tabs.push(tab);
        Ok(())
    }

    // Returns (tab id, new pane id)
    pub fn split_pane(&mut self, target_pane_id: &str, direction: &str) -> OpResult<(String, String)> {
        if direction != "horizontal" && direction != "vertical" {
            return Err(reason::INVALID_DIRECTION);
        }
        let tab = self.tab_containing_mut(target_pane_id).ok_or(reason::NOT_FOUND)?;
        if !tab.pane_tree.find_node(target_pane_id).is_some_and(|n| n.is_leaf()) {
            return Err(reason::NOT_LEAF);
        }
        // The 4-leaf cap applies to the tab that holds the target only
        if tab.pane_tree.count_leaves() >= 4 {
            return Err(reason::MAX_PANES);
        }

        let new_pane_id = format!("pane-{}", uuid::Uuid::new_v4());
        let split_id = format!("split-{}", uuid::Uuid::new_v4());
        tab.pane_tree.split_pane(target_pane_id, direction, &new_pane_id, &split_id, None)?;
        tab.pane_tree.clear_zoom();
        Ok((tab.tab_id.clone(), new_pane_id))
    }

    pub fn toggle_zoom(&mut self, target_pane_id: &str) -> OpResult<String> {
        let tab = self.tab_containing_mut(target_pane_id).ok_or(reason::NOT_FOUND)?;
        let zoom = match tab.pane_tree.find_node(target_pane_id) {
            Some(PaneNode::Leaf { is_zoomed, .. }) => !is_zoomed.unwrap_or(false),
            _ => return Err(reason::NOT_LEAF),
        };
        tab.pane_tree.set_zoom_exclusive(target_pane_id, zoom);
        Ok(tab.tab_id.clone())
    }

    // Closes any node (leaf or split). Closing the root closes the tab.
    pub fn close_pane(&mut self, target_pane_id: &str) -> OpResult<ClosePaneOutcome> {
        let tab = self.tab_containing_mut(target_pane_id).ok_or(reason::NOT_FOUND)?;
        let tab_id = tab.tab_id.clone();
        let session_ids = tab.pane_tree.find_node(target_pane_id).map(|n| n.session_ids()).unwrap_or_default();

        let tab_closed = match tab.pane_tree.clone().close_pane(target_pane_id) {
            Some(tree) => {
                tab.pane_tree = tree;
                false
            }
            None => true,
        };
        if tab_closed {
            self.remove_tab(&tab_id);
        }

        Ok(ClosePaneOutcome { tab_id, tab_closed, removed_session_ids: self.unreferenced(session_ids) })
    }

    // Returns the session ids that were held by the closed tab
    pub fn close_tab(&mut self, target_tab_id: &str) -> OpResult<Vec<String>> {
        let tab = self.remove_tab(target_tab_id).ok_or(reason::NOT_FOUND)?;
        Ok(self.unreferenced(tab.pane_tree.session_ids()))
    }

    pub fn replace_pane(&mut self, target_pane_id: &str, new_pane_type: String, new_session_id: Option<String>, new_config: serde_json::Value) -> OpResult<ReplacePaneOutcome> {
        let tab = self.tab_containing_mut(target_pane_id).ok_or(reason::NOT_FOUND)?;
        let tab_id = tab.tab_id.clone();
        let previous = match tab.pane_tree.find_node_mut(target_pane_id) {
            Some(PaneNode::Leaf { pane_type, session_id, config, is_disconnected, .. }) => {
                *pane_type = new_pane_type;
                *config = new_config;
                *is_disconnected = None;
                std::mem::replace(session_id, new_session_id)
            }
            _ => return Err(reason::NOT_LEAF),
        };
        // Report the old session only when nothing shows it any more (the new id may even be the same one)
        let previous_session_id = previous.filter(|id| !id.is_empty() && !self.is_session_referenced(id));
        Ok(ReplacePaneOutcome { tab_id, previous_session_id })
    }

    pub fn update_sizes(&mut self, target_pane_id: &str, sizes: &[f64]) -> OpResult<String> {
        let sizes = normalize_sizes(sizes).ok_or(reason::INVALID_SIZES)?;
        let tab = self.tab_containing_mut(target_pane_id).ok_or(reason::NOT_FOUND)?;
        match tab.pane_tree.find_node_mut(target_pane_id) {
            Some(PaneNode::HSplit { sizes: current, .. }) | Some(PaneNode::VSplit { sizes: current, .. }) => *current = sizes,
            _ => return Err(reason::NOT_SPLIT),
        }
        Ok(tab.tab_id.clone())
    }

    pub fn set_disconnected(&mut self, target_pane_id: &str, disconnected: bool) -> OpResult<String> {
        let tab = self.tab_containing_mut(target_pane_id).ok_or(reason::NOT_FOUND)?;
        match tab.pane_tree.find_node_mut(target_pane_id) {
            Some(PaneNode::Leaf { is_disconnected, .. }) => *is_disconnected = Some(disconnected),
            _ => return Err(reason::NOT_LEAF),
        }
        Ok(tab.tab_id.clone())
    }

    // Flags every leaf showing `session_id` as disconnected, in any tab (torn or not).
    // Returns the number of leaves and the tabs that hold them.
    pub fn mark_session_disconnected(&mut self, session_id: &str) -> (usize, Vec<String>) {
        let mut count = 0;
        let mut tab_ids = Vec::new();
        if session_id.is_empty() {
            return (count, tab_ids);
        }
        for tab in self.tabs_mut() {
            let hits = tab.pane_tree.mark_session_disconnected(session_id);
            if hits > 0 {
                count += hits;
                tab_ids.push(tab.tab_id.clone());
            }
        }
        (count, tab_ids)
    }

    // Tearing off the root marks the whole tab torn; any other node is detached into a new torn tab.
    pub fn tear_off(&mut self, target_pane_id: &str) -> OpResult<TearOffOutcome> {
        let source = self.tab_containing(target_pane_id).ok_or(reason::NOT_FOUND)?;
        if source.is_torn_off {
            return Err(reason::ALREADY_TORN);
        }
        let node = source.pane_tree.find_node(target_pane_id).ok_or(reason::NOT_FOUND)?;
        if !node.all_terminal() {
            return Err(reason::NOT_TERMINAL);
        }
        let session_ids = node.session_ids();
        let source_tab_id = source.tab_id.clone();

        if source.pane_tree.pane_id() == target_pane_id {
            if let Some(tab) = self.tab_mut(&source_tab_id) {
                tab.is_torn_off = true;
                // A whole tab has nowhere to be re-docked into
                tab.origin = None;
            }
            return Ok(TearOffOutcome { tab_id: source_tab_id.clone(), source_tab_id, session_ids });
        }

        // Remember the split the subtree leaves, so tear-in can put it back
        let origin = source.pane_tree.find_parent(target_pane_id).and_then(|(parent, position)| {
            let (children, sizes) = match parent {
                PaneNode::HSplit { children, sizes, .. } | PaneNode::VSplit { children, sizes, .. } => (children, sizes),
                PaneNode::Leaf { .. } => return None,
            };
            Some(Origin {
                tab_id: source_tab_id.clone(),
                sibling_pane_id: children[1 - position].pane_id().to_string(),
                direction: parent.split_kind()?.to_string(),
                position,
                sizes: *sizes,
            })
        });
        let subtree = node.clone();
        let new_tab_id = format!("tab-{}", uuid::Uuid::new_v4());
        for window in self.windows.values_mut() {
            if let Some(idx) = window.tabs.iter().position(|t| t.tab_id == source_tab_id) {
                let source = &mut window.tabs[idx];
                // A non-root node always leaves a tree behind
                if let Some(tree) = source.pane_tree.clone().close_pane(target_pane_id) {
                    source.pane_tree = tree;
                }
                let torn = TabNode {
                    tab_id: new_tab_id.clone(),
                    title: source.title.clone(),
                    pane_tree: subtree,
                    is_torn_off: true,
                    workspace_id: source.workspace_id.clone(),
                    origin,
                };
                window.tabs.insert(idx + 1, torn);
                break;
            }
        }

        Ok(TearOffOutcome { tab_id: new_tab_id, source_tab_id, session_ids })
    }

    // `id` is normally a tab id; if no tab has it, it is treated as a node id inside a torn tab.
    // A detached subtree goes back into the split it came from when every re-dock condition holds;
    // otherwise the torn tab simply becomes a docked tab again.
    pub fn tear_in(&mut self, id: &str) -> OpResult<TearInOutcome> {
        let tab_id = match self.tab(id).or_else(|| self.tab_containing(id)) {
            Some(tab) => tab.tab_id.clone(),
            None => return Err(reason::NOT_FOUND),
        };
        if !self.tab(&tab_id).ok_or(reason::NOT_FOUND)?.is_torn_off {
            return Err(reason::NOT_TORN);
        }

        if let Some((target_tab_id, pane_id)) = self.redock(&tab_id) {
            return Ok(TearInOutcome { tab_id, redocked: true, target_tab_id, pane_id });
        }

        let tab = self.tab_mut(&tab_id).ok_or(reason::NOT_FOUND)?;
        tab.is_torn_off = false;
        tab.origin = None;
        let pane_id = tab.pane_tree.first_leaf_id().to_string();
        Ok(TearInOutcome { tab_id: tab_id.clone(), redocked: false, target_tab_id: tab_id, pane_id })
    }

    // Re-dock conditions: the origin tab still exists and is docked, the sibling is still in it, the new split
    // would not sit directly inside or directly around a split of the same direction, and the merged tab stays
    // within the 4-leaf cap.
    fn can_redock(&self, torn: &TabNode) -> bool {
        let Some(origin) = &torn.origin else { return false };
        if origin.direction != "hsplit" && origin.direction != "vsplit" {
            return false;
        }
        let Some(target) = self.tab(&origin.tab_id) else { return false };
        if target.is_torn_off {
            return false;
        }
        let Some(sibling) = target.pane_tree.find_node(&origin.sibling_pane_id) else { return false };
        if sibling.split_kind() == Some(origin.direction.as_str()) {
            return false;
        }
        if let Some((parent, _)) = target.pane_tree.find_parent(&origin.sibling_pane_id) {
            if parent.split_kind() == Some(origin.direction.as_str()) {
                return false;
            }
        }
        target.pane_tree.count_leaves() + torn.pane_tree.count_leaves() <= 4
    }

    // Replaces the origin sibling with a new split holding the sibling and the torn subtree, then removes the
    // torn tab. Returns (origin tab id, first leaf of the re-docked subtree), or None (nothing changed) when
    // any re-dock condition fails.
    fn redock(&mut self, torn_tab_id: &str) -> Option<(String, String)> {
        let torn = self.tab(torn_tab_id)?;
        if !self.can_redock(torn) {
            return None;
        }
        let origin = torn.origin.clone()?;
        let subtree = torn.pane_tree.clone();
        let pane_id = subtree.first_leaf_id().to_string();

        let target = self.tab_mut(&origin.tab_id)?;
        let slot = target.pane_tree.find_node_mut(&origin.sibling_pane_id)?;
        let sibling = std::mem::replace(slot, PaneNode::Leaf {
            pane_id: String::new(),
            pane_type: String::new(),
            session_id: None,
            config: serde_json::Value::Null,
            is_disconnected: None,
            is_zoomed: None,
        });
        let children = Box::new(if origin.position == 0 { [subtree, sibling] } else { [sibling, subtree] });
        let split_id = format!("split-{}", uuid::Uuid::new_v4());
        *slot = if origin.direction == "hsplit" {
            PaneNode::HSplit { pane_id: split_id, children, sizes: origin.sizes }
        } else {
            PaneNode::VSplit { pane_id: split_id, children, sizes: origin.sizes }
        };
        // Both trees may carry a zoomed leaf; like a split, re-docking leaves the tab un-zoomed
        target.pane_tree.clear_zoom();

        self.remove_tab(torn_tab_id);
        Some((origin.tab_id, pane_id))
    }

    // The sync payload for one tab. A tab that no longer exists yields `tree: null`.
    pub fn tab_payload(&self, tab_id: &str, rev: u64) -> serde_json::Value {
        match self.tab(tab_id) {
            Some(tab) => serde_json::json!({
                "tabId": tab.tab_id,
                "rev": rev,
                "tree": tab.pane_tree,
                "title": tab.title,
                "isTornOff": tab.is_torn_off,
                "workspaceId": tab.workspace_id,
            }),
            None => serde_json::json!({
                "tabId": tab_id,
                "rev": rev,
                "tree": null,
                "title": "",
                "isTornOff": false,
                "workspaceId": null,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf(pane_id: &str, pane_type: &str, session_id: Option<&str>) -> PaneNode {
        PaneNode::Leaf {
            pane_id: pane_id.to_string(),
            pane_type: pane_type.to_string(),
            session_id: session_id.map(str::to_string),
            config: serde_json::json!({}),
            is_disconnected: None,
            is_zoomed: None,
        }
    }

    fn tab(tab_id: &str, tree: PaneNode) -> TabNode {
        TabNode {
            tab_id: tab_id.to_string(),
            title: format!("title-{}", tab_id),
            pane_tree: tree,
            is_torn_off: false,
            workspace_id: Some("ws-1".to_string()),
            origin: None,
        }
    }

    // Workspace with one terminal tab per (tab id, pane id, session id)
    fn workspace(tabs: &[(&str, &str, &str)]) -> NexusWorkspace {
        let mut ws = NexusWorkspace::new();
        for (tab_id, pane_id, session_id) in tabs {
            ws.register_tab(tab(tab_id, leaf(pane_id, "terminal", Some(session_id)))).unwrap();
        }
        ws
    }

    // Replace the welcome leaf created by a split with a terminal holding `session_id`
    fn connect(ws: &mut NexusWorkspace, pane_id: &str, session_id: &str) {
        ws.replace_pane(pane_id, "terminal".to_string(), Some(session_id.to_string()), serde_json::json!({})).unwrap();
    }

    fn sizes_of(ws: &NexusWorkspace, node_id: &str) -> [f64; 2] {
        match ws.tab_containing(node_id).unwrap().pane_tree.find_node(node_id).unwrap() {
            PaneNode::HSplit { sizes, .. } | PaneNode::VSplit { sizes, .. } => *sizes,
            _ => panic!("not a split"),
        }
    }

    fn zoomed(ws: &NexusWorkspace, tab_id: &str) -> Vec<String> {
        ws.tab(tab_id).unwrap().pane_tree.leaves().iter().filter_map(|l| match l {
            PaneNode::Leaf { pane_id, is_zoomed: Some(true), .. } => Some(pane_id.clone()),
            _ => None,
        }).collect()
    }

    fn term(pane_id: &str) -> PaneNode {
        leaf(pane_id, "terminal", Some(format!("s-{}", pane_id).as_str()))
    }

    fn hsplit(pane_id: &str, first: PaneNode, second: PaneNode) -> PaneNode {
        PaneNode::HSplit { pane_id: pane_id.to_string(), children: Box::new([first, second]), sizes: [50.0, 50.0] }
    }

    fn vsplit(pane_id: &str, first: PaneNode, second: PaneNode) -> PaneNode {
        PaneNode::VSplit { pane_id: pane_id.to_string(), children: Box::new([first, second]), sizes: [50.0, 50.0] }
    }

    fn disconnected(ws: &NexusWorkspace, pane_id: &str) -> Option<bool> {
        match ws.tab_containing(pane_id).unwrap().pane_tree.find_node(pane_id).unwrap() {
            PaneNode::Leaf { is_disconnected, .. } => *is_disconnected,
            _ => panic!("not a leaf"),
        }
    }

    // Round-1 tear-in: the torn tab stays, docked and without an origin, and is its own target
    fn assert_fell_back(ws: &mut NexusWorkspace, torn: &str, first_leaf: &str) {
        let out = ws.tear_in(torn).unwrap();
        assert!(!out.redocked);
        assert_eq!(out.tab_id, torn);
        assert_eq!(out.target_tab_id, torn);
        assert_eq!(out.pane_id, first_leaf);
        let tab = ws.tab(torn).unwrap();
        assert!(!tab.is_torn_off);
        assert!(tab.origin.is_none());
    }

    #[test]
    fn register_rejects_duplicate_tab() {
        let mut ws = workspace(&[("t1", "p1", "s1")]);
        assert_eq!(ws.register_tab(tab("t1", leaf("px", "terminal", None))).err(), Some(reason::TAB_EXISTS));
    }

    #[test]
    fn split_cap_applies_to_target_tab_only() {
        let mut ws = workspace(&[("t1", "a", "s1"), ("t2", "b", "s2")]);
        let (_, p2) = ws.split_pane("a", "horizontal").unwrap();
        let (_, p3) = ws.split_pane("a", "vertical").unwrap();
        ws.split_pane(&p2, "vertical").unwrap();
        assert_eq!(ws.tab("t1").unwrap().pane_tree.count_leaves(), 4);
        assert_eq!(ws.split_pane(&p3, "horizontal").err(), Some(reason::MAX_PANES));

        let (tab_id, _) = ws.split_pane("b", "horizontal").unwrap();
        assert_eq!(tab_id, "t2");
        assert_eq!(ws.tab("t2").unwrap().pane_tree.count_leaves(), 2);
    }

    #[test]
    fn split_refusals() {
        let mut ws = workspace(&[("t1", "a", "s1")]);
        assert_eq!(ws.split_pane("a", "diagonal").err(), Some(reason::INVALID_DIRECTION));
        assert_eq!(ws.split_pane("nope", "horizontal").err(), Some(reason::NOT_FOUND));
        let (_, p2) = ws.split_pane("a", "horizontal").unwrap();
        // Alternation: a child of an hsplit cannot split horizontally again
        assert_eq!(ws.split_pane(&p2, "horizontal").err(), Some(reason::DIRECTION_NOT_ALLOWED));
        let root_id = ws.tab("t1").unwrap().pane_tree.pane_id().to_string();
        assert_eq!(ws.split_pane(&root_id, "vertical").err(), Some(reason::NOT_LEAF));
    }

    #[test]
    fn nested_split_ids_are_unique_after_close_and_resplit() {
        let mut ws = workspace(&[("t1", "x", "s1")]);
        let (_, p2) = ws.split_pane("x", "horizontal").unwrap();
        ws.split_pane("x", "vertical").unwrap();
        ws.close_pane(&p2).unwrap();
        ws.split_pane("x", "horizontal").unwrap();

        let mut ids = Vec::new();
        fn collect(node: &PaneNode, ids: &mut Vec<String>) {
            ids.push(node.pane_id().to_string());
            if let PaneNode::HSplit { children, .. } | PaneNode::VSplit { children, .. } = node {
                children.iter().for_each(|c| collect(c, ids));
            }
        }
        collect(&ws.tab("t1").unwrap().pane_tree, &mut ids);
        let mut unique = ids.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(ids.len(), unique.len(), "duplicate node ids: {:?}", ids);
        assert!(ids.iter().filter(|id| id.starts_with("split-")).count() == 2);
    }

    #[test]
    fn split_keeps_disconnected_and_clears_zoom() {
        let mut ws = workspace(&[("t1", "a", "s1")]);
        let (_, b) = ws.split_pane("a", "horizontal").unwrap();
        ws.toggle_zoom(&b).unwrap();
        ws.set_disconnected("a", true).unwrap();
        ws.split_pane("a", "vertical").unwrap();

        match ws.tab("t1").unwrap().pane_tree.find_node("a").unwrap() {
            PaneNode::Leaf { is_disconnected, .. } => assert_eq!(*is_disconnected, Some(true)),
            _ => panic!("a must stay a leaf"),
        }
        assert!(zoomed(&ws, "t1").is_empty());
    }

    #[test]
    fn close_pane_in_second_tab() {
        let mut ws = workspace(&[("t1", "a", "s1"), ("t2", "b", "s2")]);
        let (_, c) = ws.split_pane("b", "horizontal").unwrap();
        connect(&mut ws, &c, "s3");

        let out = ws.close_pane(&c).unwrap();
        assert_eq!(out.tab_id, "t2");
        assert!(!out.tab_closed);
        assert_eq!(out.removed_session_ids, vec!["s3".to_string()]);
        assert_eq!(ws.tab("t2").unwrap().pane_tree.pane_id(), "b");
        assert_eq!(ws.tab("t1").unwrap().pane_tree.pane_id(), "a");

        let out = ws.close_pane("b").unwrap();
        assert_eq!(out.tab_id, "t2");
        assert!(out.tab_closed);
        assert_eq!(out.removed_session_ids, vec!["s2".to_string()]);
        assert!(ws.tab("t2").is_none());
        assert!(ws.tab("t1").is_some());
        assert_eq!(ws.close_pane("b").err(), Some(reason::NOT_FOUND));
    }

    #[test]
    fn close_split_node_removes_its_whole_subtree() {
        let mut ws = workspace(&[("t1", "a", "s1")]);
        let (_, b) = ws.split_pane("a", "horizontal").unwrap();
        connect(&mut ws, &b, "s2");
        let (_, c) = ws.split_pane(&b, "vertical").unwrap();
        connect(&mut ws, &c, "s3");
        let inner = ws.tab("t1").unwrap().pane_tree.leaves().len();
        assert_eq!(inner, 3);

        let inner_split = match &ws.tab("t1").unwrap().pane_tree {
            PaneNode::HSplit { children, .. } => children[1].pane_id().to_string(),
            _ => panic!("root must be an hsplit"),
        };
        let out = ws.close_pane(&inner_split).unwrap();
        assert_eq!(out.removed_session_ids, vec!["s2".to_string(), "s3".to_string()]);
        assert_eq!(ws.tab("t1").unwrap().pane_tree.pane_id(), "a");
    }

    #[test]
    fn close_tab_reports_sessions() {
        let mut ws = workspace(&[("t1", "a", "s1")]);
        let (_, b) = ws.split_pane("a", "horizontal").unwrap();
        connect(&mut ws, &b, "s2");
        assert_eq!(ws.close_tab("t1").unwrap(), vec!["s1".to_string(), "s2".to_string()]);
        assert_eq!(ws.close_tab("t1").err(), Some(reason::NOT_FOUND));
    }

    #[test]
    fn removed_sessions_skip_sessions_still_shown_elsewhere() {
        let mut ws = workspace(&[("t1", "a", "shared"), ("t2", "b", "shared")]);
        assert!(ws.close_tab("t1").unwrap().is_empty());
        assert_eq!(ws.close_tab("t2").unwrap(), vec!["shared".to_string()]);
    }

    #[test]
    fn replace_reports_previous_session_and_resets_disconnected() {
        let mut ws = workspace(&[("t1", "a", "s1")]);
        ws.set_disconnected("a", true).unwrap();
        let out = ws.replace_pane("a", "terminal".to_string(), Some("s9".to_string()), serde_json::json!({})).unwrap();
        assert_eq!(out.tab_id, "t1");
        assert_eq!(out.previous_session_id.as_deref(), Some("s1"));
        match ws.tab("t1").unwrap().pane_tree.find_node("a").unwrap() {
            PaneNode::Leaf { is_disconnected, session_id, .. } => {
                assert_eq!(*is_disconnected, None);
                assert_eq!(session_id.as_deref(), Some("s9"));
            }
            _ => panic!("a must stay a leaf"),
        }
        // Replacing with the same session reports nothing to terminate
        let out = ws.replace_pane("a", "terminal".to_string(), Some("s9".to_string()), serde_json::json!({})).unwrap();
        assert_eq!(out.previous_session_id, None);
    }

    #[test]
    fn zoom_is_exclusive_within_a_tab() {
        let mut ws = workspace(&[("t1", "a", "s1"), ("t2", "z", "s9")]);
        let (_, b) = ws.split_pane("a", "horizontal").unwrap();
        ws.toggle_zoom("z").unwrap();
        ws.toggle_zoom("a").unwrap();
        assert_eq!(zoomed(&ws, "t1"), vec!["a".to_string()]);
        ws.toggle_zoom(&b).unwrap();
        assert_eq!(zoomed(&ws, "t1"), vec![b.clone()]);
        ws.toggle_zoom(&b).unwrap();
        assert!(zoomed(&ws, "t1").is_empty());
        // Other tabs are untouched
        assert_eq!(zoomed(&ws, "t2"), vec!["z".to_string()]);
    }

    #[test]
    fn sizes_are_clamped_and_validated() {
        let mut ws = workspace(&[("t1", "a", "s1")]);
        ws.split_pane("a", "horizontal").unwrap();
        let split = ws.tab("t1").unwrap().pane_tree.pane_id().to_string();

        ws.update_sizes(&split, &[33.7, 66.3]).unwrap();
        let s = sizes_of(&ws, &split);
        assert_eq!(s[0], 33.7);
        assert!((s[0] + s[1] - 100.0).abs() < 1e-9);

        ws.update_sizes(&split, &[3.0, 97.0]).unwrap();
        assert_eq!(sizes_of(&ws, &split), [10.0, 90.0]);
        ws.update_sizes(&split, &[99.5, 0.5]).unwrap();
        assert_eq!(sizes_of(&ws, &split), [90.0, 10.0]);

        assert_eq!(ws.update_sizes(&split, &[50.0]).err(), Some(reason::INVALID_SIZES));
        assert_eq!(ws.update_sizes(&split, &[f64::NAN, 50.0]).err(), Some(reason::INVALID_SIZES));
        assert_eq!(ws.update_sizes(&split, &[50.0, f64::INFINITY]).err(), Some(reason::INVALID_SIZES));
        assert_eq!(ws.update_sizes("a", &[50.0, 50.0]).err(), Some(reason::NOT_SPLIT));
        assert_eq!(sizes_of(&ws, &split), [90.0, 10.0]);
    }

    #[test]
    fn tear_off_root_marks_tab_torn() {
        let mut ws = workspace(&[("t1", "a", "s1"), ("t2", "b", "s2")]);
        let out = ws.tear_off("b").unwrap();
        assert_eq!(out.tab_id, "t2");
        assert_eq!(out.source_tab_id, "t2");
        assert_eq!(out.session_ids, vec!["s2".to_string()]);
        let t2 = ws.tab("t2").unwrap();
        assert!(t2.is_torn_off);
        assert_eq!(t2.title, "title-t2");
        assert!(!ws.tab("t1").unwrap().is_torn_off);
        assert_eq!(ws.tear_off("b").err(), Some(reason::ALREADY_TORN));
    }

    #[test]
    fn tear_off_subtree_moves_it_to_a_new_tab() {
        let mut ws = workspace(&[("t1", "x", "s0"), ("t2", "a", "s1")]);
        let (_, b) = ws.split_pane("a", "horizontal").unwrap();
        connect(&mut ws, &b, "s2");

        let out = ws.tear_off(&b).unwrap();
        assert_eq!(out.source_tab_id, "t2");
        assert!(out.tab_id.starts_with("tab-"));
        assert_eq!(out.session_ids, vec!["s2".to_string()]);

        let source = ws.tab("t2").unwrap();
        assert!(!source.is_torn_off);
        assert_eq!(source.pane_tree.pane_id(), "a");
        let torn = ws.tab(&out.tab_id).unwrap();
        assert!(torn.is_torn_off);
        assert_eq!(torn.pane_tree.pane_id(), b);
        assert_eq!(torn.title, "title-t2");
        assert_eq!(torn.workspace_id.as_deref(), Some("ws-1"));
        assert_eq!(ws.tab_containing(&b).unwrap().tab_id, out.tab_id);

        // Anything inside a torn tab is refused
        assert_eq!(ws.tear_off(&b).err(), Some(reason::ALREADY_TORN));
        assert_eq!(ws.tear_off("nope").err(), Some(reason::NOT_FOUND));
    }

    #[test]
    fn tear_off_requires_terminal_leaves() {
        let mut ws = workspace(&[("t1", "a", "s1")]);
        let (_, b) = ws.split_pane("a", "horizontal").unwrap();
        // `b` is still a welcome pane, so neither it nor the whole tree can be torn off
        assert_eq!(ws.tear_off(&b).err(), Some(reason::NOT_TERMINAL));
        let root = ws.tab("t1").unwrap().pane_tree.pane_id().to_string();
        assert_eq!(ws.tear_off(&root).err(), Some(reason::NOT_TERMINAL));
        assert!(ws.tear_off("a").is_ok());
    }

    #[test]
    fn tear_in_by_tab_id_or_node_id() {
        let mut ws = workspace(&[("t1", "a", "s1"), ("t2", "b", "s2")]);
        ws.tear_off("a").unwrap();
        assert_eq!(ws.tear_in("t1").unwrap().tab_id, "t1");
        assert!(!ws.tab("t1").unwrap().is_torn_off);
        assert_eq!(ws.tear_in("t1").err(), Some(reason::NOT_TORN));

        ws.tear_off("b").unwrap();
        assert_eq!(ws.tear_in("b").unwrap().tab_id, "t2");
        assert!(!ws.tab("t2").unwrap().is_torn_off);
        assert_eq!(ws.tear_in("missing").err(), Some(reason::NOT_FOUND));
    }

    #[test]
    fn payload_reflects_real_tab_state() {
        let mut ws = workspace(&[("t1", "a", "s1")]);
        ws.tear_off("a").unwrap();
        let p = ws.tab_payload("t1", 7);
        assert_eq!(p["tabId"], "t1");
        assert_eq!(p["rev"], 7);
        assert_eq!(p["isTornOff"], true);
        assert_eq!(p["workspaceId"], "ws-1");
        assert_eq!(p["title"], "title-t1");
        assert_eq!(p["tree"]["paneId"], "a");

        ws.close_tab("t1").unwrap();
        let p = ws.tab_payload("t1", 8);
        assert!(p["tree"].is_null());
        assert_eq!(p["isTornOff"], false);
        assert!(p["workspaceId"].is_null());
    }

    #[test]
    fn split_sizes_serialize_as_numbers() {
        let mut ws = workspace(&[("t1", "a", "s1")]);
        ws.split_pane("a", "vertical").unwrap();
        let split = ws.tab("t1").unwrap().pane_tree.pane_id().to_string();
        ws.update_sizes(&split, &[47.3, 52.7]).unwrap();
        let p = ws.tab_payload("t1", 1);
        assert_eq!(p["tree"]["type"], "vsplit");
        assert_eq!(p["tree"]["sizes"][0].as_f64(), Some(47.3));
        assert!(p["tree"]["sizes"][1].is_number());
    }

    #[test]
    fn tear_off_records_origin_only_for_a_subtree() {
        let mut ws = NexusWorkspace::new();
        ws.register_tab(tab("t1", hsplit("h", term("a"), vsplit("v", term("b"), term("c"))))).unwrap();
        ws.update_sizes("v", &[30.0, 70.0]).unwrap();

        let out = ws.tear_off("b").unwrap();
        let origin = ws.tab(&out.tab_id).unwrap().origin.clone().unwrap();
        assert_eq!(origin.tab_id, "t1");
        assert_eq!(origin.sibling_pane_id, "c");
        assert_eq!(origin.direction, "vsplit");
        assert_eq!(origin.position, 0);
        assert_eq!(origin.sizes, [30.0, 70.0]);
        // The sibling took the collapsed split's place
        assert_eq!(ws.tab("t1").unwrap().pane_tree.find_parent("c").unwrap().0.pane_id(), "h");

        // A whole-tab tear-off has no origin
        ws.tear_off("h").unwrap();
        let t1 = ws.tab("t1").unwrap();
        assert!(t1.is_torn_off);
        assert!(t1.origin.is_none());
    }

    #[test]
    fn tear_in_redocks_a_leaf_into_its_nested_split() {
        let mut ws = NexusWorkspace::new();
        ws.register_tab(tab("t1", hsplit("h", term("a"), vsplit("v", term("b"), term("c"))))).unwrap();
        ws.update_sizes("v", &[30.0, 70.0]).unwrap();
        ws.toggle_zoom("a").unwrap();
        let torn = ws.tear_off("b").unwrap().tab_id;

        let out = ws.tear_in(&torn).unwrap();
        assert!(out.redocked);
        assert_eq!(out.tab_id, torn);
        assert_eq!(out.target_tab_id, "t1");
        assert_eq!(out.pane_id, "b");
        assert!(ws.tab(&torn).is_none());

        let tree = &ws.tab("t1").unwrap().pane_tree;
        let (parent, position) = tree.find_parent("b").unwrap();
        assert_eq!(position, 0);
        match parent {
            PaneNode::VSplit { pane_id, children, sizes } => {
                assert!(pane_id.starts_with("split-"));
                assert_eq!(children[1].pane_id(), "c");
                assert_eq!(*sizes, [30.0, 70.0]);
            }
            _ => panic!("b must be back in a vsplit"),
        }
        assert_eq!(tree.find_parent(parent.pane_id()).unwrap().0.pane_id(), "h");
        assert_eq!(tree.count_leaves(), 3);
        assert_eq!(ws.tab_containing("b").unwrap().tab_id, "t1");
        assert!(zoomed(&ws, "t1").is_empty());
        assert_eq!(ws.tear_in(&torn).err(), Some(reason::NOT_FOUND));
    }

    #[test]
    fn tear_in_redocks_a_subtree_next_to_the_root() {
        let mut ws = NexusWorkspace::new();
        ws.register_tab(tab("t1", hsplit("h", term("a"), vsplit("v", term("b"), term("c"))))).unwrap();
        ws.update_sizes("h", &[40.0, 60.0]).unwrap();
        let torn = ws.tear_off("v").unwrap().tab_id;
        assert_eq!(ws.tab("t1").unwrap().pane_tree.pane_id(), "a");

        let out = ws.tear_in(&torn).unwrap();
        assert!(out.redocked);
        assert_eq!(out.target_tab_id, "t1");
        // First leaf of the re-docked subtree
        assert_eq!(out.pane_id, "b");
        match &ws.tab("t1").unwrap().pane_tree {
            PaneNode::HSplit { pane_id, children, sizes } => {
                assert!(pane_id.starts_with("split-"));
                assert_eq!(children[0].pane_id(), "a");
                assert_eq!(children[1].pane_id(), "v");
                assert_eq!(*sizes, [40.0, 60.0]);
            }
            _ => panic!("root must be an hsplit again"),
        }
        assert!(ws.tab(&torn).is_none());
    }

    #[test]
    fn tear_in_without_origin_falls_back() {
        let mut ws = NexusWorkspace::new();
        ws.register_tab(tab("t1", hsplit("h", term("a"), term("b")))).unwrap();
        ws.tear_off("h").unwrap();
        assert_fell_back(&mut ws, "t1", "a");
        assert_eq!(ws.tab("t1").unwrap().pane_tree.pane_id(), "h");
    }

    #[test]
    fn tear_in_falls_back_when_the_origin_tab_is_gone() {
        let mut ws = NexusWorkspace::new();
        ws.register_tab(tab("t1", hsplit("h", term("a"), term("b")))).unwrap();
        let torn = ws.tear_off("b").unwrap().tab_id;
        ws.close_tab("t1").unwrap();
        assert_fell_back(&mut ws, &torn, "b");
    }

    #[test]
    fn tear_in_falls_back_when_the_origin_tab_is_torn() {
        let mut ws = NexusWorkspace::new();
        ws.register_tab(tab("t1", hsplit("h", term("a"), term("b")))).unwrap();
        let torn = ws.tear_off("b").unwrap().tab_id;
        ws.tear_off("a").unwrap();
        assert_fell_back(&mut ws, &torn, "b");
        assert!(ws.tab("t1").unwrap().is_torn_off);
        assert_eq!(ws.tab("t1").unwrap().pane_tree.pane_id(), "a");
    }

    #[test]
    fn tear_in_falls_back_when_the_sibling_is_gone() {
        let mut ws = NexusWorkspace::new();
        ws.register_tab(tab("t1", hsplit("h", term("a"), vsplit("v", term("b"), term("c"))))).unwrap();
        let torn = ws.tear_off("a").unwrap().tab_id;
        // Closing b collapses the sibling split `v` into c
        ws.close_pane("b").unwrap();
        assert_fell_back(&mut ws, &torn, "a");
        assert_eq!(ws.tab("t1").unwrap().pane_tree.pane_id(), "c");
    }

    #[test]
    fn tear_in_falls_back_when_the_sibling_is_a_split_of_the_same_direction() {
        let mut ws = NexusWorkspace::new();
        // Nested same-direction splits appear after a collapse
        ws.register_tab(tab("t1", hsplit("h", term("a"), hsplit("h2", term("b"), term("c"))))).unwrap();
        let torn = ws.tear_off("a").unwrap().tab_id;
        assert_eq!(ws.tab(&torn).unwrap().origin.as_ref().unwrap().sibling_pane_id, "h2");
        assert_fell_back(&mut ws, &torn, "a");
        assert_eq!(ws.tab("t1").unwrap().pane_tree.pane_id(), "h2");
    }

    #[test]
    fn tear_in_checks_the_direction_of_the_siblings_parent() {
        // The sibling now sits in a split of the origin direction: fall back
        let mut ws = NexusWorkspace::new();
        ws.register_tab(tab("t1", hsplit("h", term("a"), term("b")))).unwrap();
        let torn = ws.tear_off("a").unwrap().tab_id;
        ws.split_pane("b", "horizontal").unwrap();
        assert_fell_back(&mut ws, &torn, "a");
        assert_eq!(ws.tab("t1").unwrap().pane_tree.count_leaves(), 2);

        // A parent of the other direction is fine
        let mut ws = NexusWorkspace::new();
        ws.register_tab(tab("t1", hsplit("h", term("a"), term("b")))).unwrap();
        let torn = ws.tear_off("a").unwrap().tab_id;
        ws.split_pane("b", "vertical").unwrap();
        let out = ws.tear_in(&torn).unwrap();
        assert!(out.redocked);
        let tree = &ws.tab("t1").unwrap().pane_tree;
        assert_eq!(tree.split_kind(), Some("vsplit"));
        let (parent, position) = tree.find_parent("a").unwrap();
        assert_eq!((parent.split_kind(), position), (Some("hsplit"), 0));
    }

    #[test]
    fn tear_in_respects_the_leaf_cap() {
        // Origin tab ends up with `origin_leaves` leaves; the torn subtree has 2
        fn setup(origin_leaves: usize) -> (NexusWorkspace, String) {
            let mut ws = NexusWorkspace::new();
            ws.register_tab(tab("t1", hsplit("h", term("a"), vsplit("v", term("b"), term("c"))))).unwrap();
            let torn = ws.tear_off("v").unwrap().tab_id;
            let (_, n1) = ws.split_pane("a", "vertical").unwrap();
            if origin_leaves == 3 {
                ws.split_pane(&n1, "horizontal").unwrap();
            }
            assert_eq!(ws.tab("t1").unwrap().pane_tree.count_leaves(), origin_leaves);
            (ws, torn)
        }

        let (mut ws, torn) = setup(2);
        let out = ws.tear_in(&torn).unwrap();
        assert!(out.redocked);
        assert_eq!(ws.tab("t1").unwrap().pane_tree.count_leaves(), 4);

        let (mut ws, torn) = setup(3);
        assert_fell_back(&mut ws, &torn, "b");
        assert_eq!(ws.tab("t1").unwrap().pane_tree.count_leaves(), 3);
    }

    #[test]
    fn a_fallen_back_tab_is_not_redocked_later() {
        let mut ws = NexusWorkspace::new();
        ws.register_tab(tab("t1", hsplit("h", term("a"), term("b")))).unwrap();
        let torn = ws.tear_off("b").unwrap().tab_id;
        ws.tear_off("a").unwrap();
        assert_fell_back(&mut ws, &torn, "b");
        ws.tear_in("t1").unwrap();
        // The origin tab is docked again, but the fallen-back tab is a plain tab now
        ws.tear_off("b").unwrap();
        assert_fell_back(&mut ws, &torn, "b");
    }

    #[test]
    fn mark_session_disconnected_flags_every_leaf_showing_it() {
        let mut ws = workspace(&[("t1", "a", "shared"), ("t2", "b", "other")]);
        let (_, c) = ws.split_pane("b", "horizontal").unwrap();
        connect(&mut ws, &c, "shared");
        let torn = ws.tear_off(&c).unwrap().tab_id;

        let (count, mut tab_ids) = ws.mark_session_disconnected("shared");
        assert_eq!(count, 2);
        tab_ids.sort();
        let mut expected = vec!["t1".to_string(), torn];
        expected.sort();
        assert_eq!(tab_ids, expected);
        assert_eq!(disconnected(&ws, "a"), Some(true));
        assert_eq!(disconnected(&ws, &c), Some(true));
        assert_eq!(disconnected(&ws, "b"), None);

        assert_eq!(ws.mark_session_disconnected("missing"), (0, vec![]));
        assert_eq!(ws.mark_session_disconnected(""), (0, vec![]));
        assert_eq!(disconnected(&ws, "b"), None);
    }
}
