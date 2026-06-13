use serde::{Deserialize, Serialize};
use std::sync::RwLock;
use lazy_static::lazy_static;
use std::fs;
use crate::workspace::get_getssh_root;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProxyType {
    Socks5,
    Http,
    Https,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    pub proxy_type: ProxyType,
    pub host: String,
    pub port: u16,
    pub auth_user: Option<String>,
    pub auth_pass: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RouteRule {
    pub pattern: String,
    pub strategy: String, // e.g., "Direct", "Proxy"
    pub proxy: Option<ProxyConfig>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkTopology {
    pub default_strategy: String,
    pub default_proxy: Option<ProxyConfig>,
    #[serde(default)]
    pub rules: Vec<RouteRule>,
}

lazy_static! {
    // 全局、线程安全的路由管理器 (Global Network Router)
    // 掌握真正的网络交通调度权
    pub static ref GLOBAL_NETWORK_ROUTER: RwLock<NetworkTopology> = RwLock::new(NetworkTopology::default());
}

/**
 * 动态加载并热更新工作区的代理拓扑结构
 */
pub fn apply_workspace_network(workspace_id: &str) -> Result<(), String> {
    let mut path = get_getssh_root();
    // 兼容可能存在的 workspaces/ 层级或者直接挂在根目录
    path.push(workspace_id);
    path.push("network_proxy.json");

    if !path.exists() {
        // 尝试备选路径 ~/.getssh/workspaces/[id]/
        let mut alt_path = get_getssh_root();
        alt_path.push("workspaces");
        alt_path.push(workspace_id);
        alt_path.push("network_proxy.json");
        
        if alt_path.exists() {
            path = alt_path;
        } else {
            return Err(format!("network_proxy.json not found in sandbox: {}", workspace_id));
        }
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read network_proxy.json: {}", e))?;

    // 如果是空的 `{}`，则回退默认
    let topology: NetworkTopology = if content.trim().is_empty() || content.trim() == "{}" {
        NetworkTopology {
            default_strategy: "Direct".to_string(),
            default_proxy: None,
            rules: vec![],
        }
    } else {
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse network_proxy.json: {}", e))?
    };

    let mut router = GLOBAL_NETWORK_ROUTER.write().map_err(|_| "Failed to lock GLOBAL_NETWORK_ROUTER")?;
    *router = topology;

    println!("[Nexus Core] Dynamic network topology applied for workspace: {}", workspace_id);
    Ok(())
}

/**
 * 供工作区切换时，安全地清空路由规则，阻断流量
 */
pub fn clear_network_topology() -> Result<(), String> {
    let mut router = GLOBAL_NETWORK_ROUTER.write().map_err(|_| "Failed to lock GLOBAL_NETWORK_ROUTER")?;
    *router = NetworkTopology {
        default_strategy: "Direct".to_string(),
        default_proxy: None,
        rules: vec![],
    };
    println!("[Nexus Core] Global network router completely flushed and secured.");
    Ok(())
}
