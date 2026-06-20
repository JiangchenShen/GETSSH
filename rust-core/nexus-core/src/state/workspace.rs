use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::state::pane::PaneNode;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TabNode {
    pub tab_id: String,
    pub title: String,
    pub pane_tree: PaneNode,
    #[serde(default)]
    pub is_torn_off: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NativeWindowNode {
    pub window_id: String,
    pub tabs: Vec<TabNode>,
    pub active_tab_id: String,
}

pub struct NexusWorkspace {
    pub windows: HashMap<String, NativeWindowNode>,
}

impl NexusWorkspace {
    pub fn new() -> Self {
        Self {
            windows: HashMap::new(),
        }
    }

    pub fn split_pane(&mut self, target_pane_id: &str, direction: &str, new_pane_id: String) -> Option<(String, PaneNode)> {
        for window in self.windows.values_mut() {
            for tab in &mut window.tabs {
                if tab.pane_tree.count_leaves() >= 4 {
                    // Refuse to split if already 4 leaves
                    return None;
                }
                
                if tab.pane_tree.split_pane(target_pane_id, direction, new_pane_id.clone(), None) {
                    return Some((tab.tab_id.clone(), tab.pane_tree.clone()));
                }
            }
        }
        None
    }

    pub fn toggle_zoom(&mut self, target_pane_id: &str) -> Option<(String, PaneNode)> {
        for window in self.windows.values_mut() {
            for tab in &mut window.tabs {
                if tab.pane_tree.toggle_zoom(target_pane_id) {
                    return Some((tab.tab_id.clone(), tab.pane_tree.clone()));
                }
            }
        }
        None
    }

    pub fn close_pane(&mut self, target_pane_id: &str) -> Option<(String, Option<PaneNode>)> {
        for window in self.windows.values_mut() {
            let mut result = None;
            for (idx, tab) in window.tabs.iter_mut().enumerate() {
                let new_tree = tab.pane_tree.clone().close_pane(target_pane_id);
                if new_tree.is_none() || new_tree.as_ref().unwrap().pane_id() != tab.pane_tree.pane_id() || format!("{:?}", new_tree) != format!("{:?}", tab.pane_tree) {
                      if let Some(t) = new_tree.clone() {
                          tab.pane_tree = t;
                      }
                      result = Some((idx, tab.tab_id.clone(), new_tree));
                      break;
                }
            }
            if let Some((idx, tab_id, new_tree)) = result {
                if new_tree.is_none() {
                    window.tabs.remove(idx);
                }
                return Some((tab_id, new_tree));
            }
        }
        None
    }

    pub fn replace_pane(&mut self, target_pane_id: &str, new_pane_type: String, new_session_id: Option<String>, new_config: serde_json::Value) -> Option<(String, PaneNode)> {
        for window in self.windows.values_mut() {
            for tab in &mut window.tabs {
                if tab.pane_tree.replace_pane(target_pane_id, new_pane_type.clone(), new_session_id.clone(), new_config.clone()) {
                    return Some((tab.tab_id.clone(), tab.pane_tree.clone()));
                }
            }
        }
        None
    }

    pub fn update_sizes(&mut self, target_pane_id: &str, sizes: [u8; 2]) -> Option<(String, PaneNode)> {
        for window in self.windows.values_mut() {
            for tab in &mut window.tabs {
                if tab.pane_tree.update_sizes(target_pane_id, sizes) {
                    return Some((tab.tab_id.clone(), tab.pane_tree.clone()));
                }
            }
        }
        None
    }

    pub fn set_disconnected(&mut self, target_pane_id: &str, disconnected: bool) -> Option<(String, PaneNode)> {
        for window in self.windows.values_mut() {
            for tab in &mut window.tabs {
                if tab.pane_tree.set_disconnected(target_pane_id, disconnected) {
                    return Some((tab.tab_id.clone(), tab.pane_tree.clone()));
                }
            }
        }
        None
    }

    pub fn close_tab(&mut self, target_tab_id: &str) -> bool {
        let mut found = false;
        for window in self.windows.values_mut() {
            if let Some(idx) = window.tabs.iter().position(|t| t.tab_id == target_tab_id) {
                window.tabs.remove(idx);
                found = true;
                break;
            }
        }
        found
    }

    pub fn tear_off_pane(&mut self, target_pane_id: &str) -> Option<(String, Option<PaneNode>, String, PaneNode)> {
        println!("[Nexus Core] tear_off_pane called for {}", target_pane_id);
        // Find the node first
        let mut torn_node: Option<PaneNode> = None;
        let mut old_title = "Torn Pane".to_string();
        for window in self.windows.values() {
            for tab in &window.tabs {
                if let Some(node) = tab.pane_tree.find_node(target_pane_id) {
                    println!("[Nexus Core] tear_off_pane found node in tab {}", tab.tab_id);
                    torn_node = Some(node);
                    old_title = tab.title.clone();
                    break;
                }
            }
            if torn_node.is_some() { break; }
        }

        if torn_node.is_none() {
            println!("[Nexus Core] tear_off_pane FAILED: torn_node not found in any tab!");
            return None;
        }

        let torn_node = torn_node.unwrap();
        
        // Now close the pane from its original tab (which gives us the updated old tree)
        if let Some((old_tab_id, new_tree)) = self.close_pane(target_pane_id) {
            // Now create a NEW tab with this torn_node
            let new_tab_id = format!("tab-{}", uuid::Uuid::new_v4().to_string());
            let new_tab = TabNode {
                tab_id: new_tab_id.clone(),
                title: old_title,
                pane_tree: torn_node.clone(),
                is_torn_off: true,
            };
            
            // Add it to the active window (assuming "main" window for now)
            if let Some(window) = self.windows.get_mut("main") {
                window.tabs.push(new_tab);
                println!("[Nexus Core] tear_off_pane SUCCESS! Added new tab to main window.");
            } else {
                println!("[Nexus Core] tear_off_pane WARNING: 'main' window not found!");
            }
            
            return Some((old_tab_id, new_tree, new_tab_id, torn_node));
        } else {
            println!("[Nexus Core] tear_off_pane FAILED: close_pane returned None!");
        }

        None
    }

    pub fn tear_in_pane(&mut self, target_pane_id: &str) -> Option<(String, PaneNode)> {
        // Find the torn tab that contains this pane and set is_torn_off to false
        for window in self.windows.values_mut() {
            for tab in &mut window.tabs {
                if tab.is_torn_off {
                    if let Some(_leaf) = tab.pane_tree.find_leaf(target_pane_id) {
                        tab.is_torn_off = false;
                        return Some((tab.tab_id.clone(), tab.pane_tree.clone()));
                    }
                }
            }
        }
        None
    }
}
