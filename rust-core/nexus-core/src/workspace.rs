use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

pub fn get_getssh_root() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().to_string());
    let mut path = PathBuf::from(home);
    path.push(".getssh");
    path
}

fn set_permissions_mode(path: &Path, mode: u32) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        let mut perms = fs::metadata(path)?.permissions();
        perms.set_mode(mode);
        fs::set_permissions(path, perms)?;
    }
    #[cfg(not(unix))]
    {
        let _ = (path, mode);
    }
    Ok(())
}

pub fn initialize_root() -> std::io::Result<()> {
    let root = get_getssh_root();
    if !root.exists() {
        fs::create_dir_all(&root)?;
        set_permissions_mode(&root, 0o700)?;
    }
    
    let config_path = root.join("app-config.json");
    if !config_path.exists() {
        fs::write(&config_path, "{}")?;
        set_permissions_mode(&config_path, 0o600)?;
    }
    
    Ok(())
}

/// Workspace ids are used as directory names under ~/.getssh/workspaces, so an id such as ".." or
/// "../.." must never reach `join`. Mirrors apps/getssh-client/electron/main/utils/workspaceId.ts:
/// no path separators, reserved or control characters, no leading/trailing dot or whitespace, and no
/// Windows device names. CJK names and inner spaces stay valid.
pub fn is_valid_workspace_id(id: &str) -> bool {
    if id.is_empty() || id.chars().count() > 128 {
        return false;
    }
    if id != id.trim() || id.starts_with('.') || id.ends_with('.') {
        return false;
    }
    if id
        .chars()
        .any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control())
    {
        return false;
    }
    let stem = id.split('.').next().unwrap_or("").to_ascii_lowercase();
    let reserved = matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || ((stem.starts_with("com") || stem.starts_with("lpt"))
            && stem.len() == 4
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    !reserved
}

pub fn create_workspace(workspace_id: &str) -> std::io::Result<()> {
    if !is_valid_workspace_id(workspace_id) {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid workspace id"));
    }
    initialize_root()?;
    
    let getssh_root = get_getssh_root();
    let workspaces_dir = getssh_root.join("workspaces");
    
    if !workspaces_dir.exists() {
        fs::create_dir_all(&workspaces_dir)?;
        set_permissions_mode(&workspaces_dir, 0o700)?;
    }

    let ws_path = workspaces_dir.join(workspace_id);
    // Defence in depth: the workspace must be a direct child of the workspaces directory.
    if ws_path.parent() != Some(workspaces_dir.as_path()) {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid workspace id"));
    }
    
    // 1. Create workspace root dir with 0o700
    if !ws_path.exists() {
        fs::create_dir_all(&ws_path)?;
        set_permissions_mode(&ws_path, 0o700)?;
    }
    
    // 2. Create subdirs with 0o700
    let subdirs = vec!["audit_recordings", "ai_context/lancedb"];
    for dir in subdirs {
        let dir_path = ws_path.join(dir);
        if !dir_path.exists() {
            fs::create_dir_all(&dir_path)?;
            set_permissions_mode(&dir_path, 0o700)?;
        }
    }
    
    // 3. Create json files with 0o600
    let files = vec!["profiles.json", "network_proxy.json", "runbooks.json"];
    for file in files {
        let file_path = ws_path.join(file);
        if !file_path.exists() {
            fs::write(&file_path, "{}")?;
            set_permissions_mode(&file_path, 0o600)?;
        }
    }
    
    println!("[Nexus Core] Workspace sandbox '{}' securely bootstrapped at {:?}", workspace_id, ws_path);
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_valid_workspace_id;

    #[test]
    fn accepts_ordinary_names() {
        for id in ["default", "prod-db", "生产环境", "team a", "v1.2", "COM10", "console"] {
            assert!(is_valid_workspace_id(id), "{id} should be valid");
        }
    }

    #[test]
    fn rejects_traversal_and_unportable_names() {
        for id in [
            "", ".", "..", "../..", "../x", "..\\x", "a/b", "a\\b", "/abs", ".hidden", "trailing.",
            " padded", "padded ", "a:b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b", "a\u{0}b", "a\nb",
            "con", "CON", "nul.txt", "com1", "LPT9",
        ] {
            assert!(!is_valid_workspace_id(id), "{id:?} should be rejected");
        }
        assert!(!is_valid_workspace_id(&"x".repeat(129)));
    }
}
