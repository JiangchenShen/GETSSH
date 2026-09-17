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

pub fn create_workspace(workspace_id: &str) -> std::io::Result<()> {
    initialize_root()?;
    
    let getssh_root = get_getssh_root();
    let workspaces_dir = getssh_root.join("workspaces");
    
    if !workspaces_dir.exists() {
        fs::create_dir_all(&workspaces_dir)?;
        set_permissions_mode(&workspaces_dir, 0o700)?;
    }

    let ws_path = workspaces_dir.join(workspace_id);
    
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
