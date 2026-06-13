use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

pub fn get_getssh_root() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let mut path = PathBuf::from(home);
    path.push(".getssh");
    path
}

pub fn initialize_root() -> std::io::Result<()> {
    let root = get_getssh_root();
    if !root.exists() {
        fs::create_dir_all(&root)?;
        let mut perms = fs::metadata(&root)?.permissions();
        perms.set_mode(0o700);
        fs::set_permissions(&root, perms)?;
    }
    
    let config_path = root.join("app-config.json");
    if !config_path.exists() {
        fs::write(&config_path, "{}")?;
        let mut perms = fs::metadata(&config_path)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&config_path, perms)?;
    }
    
    Ok(())
}

pub fn create_workspace(workspace_id: &str) -> std::io::Result<()> {
    initialize_root()?;
    
    let getssh_root = get_getssh_root();
    let workspaces_dir = getssh_root.join("workspaces");
    
    if !workspaces_dir.exists() {
        fs::create_dir_all(&workspaces_dir)?;
        let mut perms = fs::metadata(&workspaces_dir)?.permissions();
        perms.set_mode(0o700);
        fs::set_permissions(&workspaces_dir, perms)?;
    }

    let ws_path = workspaces_dir.join(workspace_id);
    
    // 1. Create workspace root dir with 0o700
    if !ws_path.exists() {
        fs::create_dir_all(&ws_path)?;
        let mut perms = fs::metadata(&ws_path)?.permissions();
        perms.set_mode(0o700);
        fs::set_permissions(&ws_path, perms)?;
    }
    
    // 2. Create subdirs with 0o700
    let subdirs = vec!["audit_recordings", "ai_context/lancedb"];
    for dir in subdirs {
        let dir_path = ws_path.join(dir);
        if !dir_path.exists() {
            fs::create_dir_all(&dir_path)?;
            let mut perms = fs::metadata(&dir_path)?.permissions();
            perms.set_mode(0o700);
            fs::set_permissions(&dir_path, perms)?;
        }
    }
    
    // 3. Create json files with 0o600
    let files = vec!["profiles.json", "network_proxy.json", "runbooks.json"];
    for file in files {
        let file_path = ws_path.join(file);
        if !file_path.exists() {
            fs::write(&file_path, "{}")?;
            let mut perms = fs::metadata(&file_path)?.permissions();
            perms.set_mode(0o600);
            fs::set_permissions(&file_path, perms)?;
        }
    }
    
    println!("[Nexus Core] Workspace sandbox '{}' securely bootstrapped at {:?}", workspace_id, ws_path);
    
    Ok(())
}
