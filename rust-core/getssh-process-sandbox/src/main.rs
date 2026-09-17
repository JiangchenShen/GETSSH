use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

const CONFIG_VERSION: u32 = 1;
const MAX_CONFIG_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ARGUMENTS: usize = 512;
const MAX_ARGUMENT_CHARS: usize = 65_536;
const MAX_ENVIRONMENT_ENTRIES: usize = 512;
const MAX_PATHS_PER_CLASS: usize = 128;

#[derive(Debug, Deserialize)]
#[cfg_attr(not(windows), allow(dead_code))]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SandboxConfig {
    version: u32,
    parent_pid: u32,
    profile_name: String,
    command: PathBuf,
    #[serde(default)]
    args: Vec<String>,
    cwd: PathBuf,
    #[serde(default)]
    env: BTreeMap<String, String>,
    #[serde(default)]
    readonly_paths: Vec<PathBuf>,
    #[serde(default)]
    readwrite_paths: Vec<PathBuf>,
    #[serde(default)]
    denied_paths: Vec<PathBuf>,
    network: bool,
    allow_child_processes: bool,
    max_processes: u32,
    journal_dir: PathBuf,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(not(windows), allow(dead_code))]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CleanupJournal {
    version: u32,
    launcher_pid: u32,
    profile_name: String,
    paths: Vec<PathBuf>,
}

fn valid_profile_name(value: &str) -> bool {
    let len = value.len();
    (8..=64).contains(&len)
        && value.starts_with("getssh.")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-')
}

fn validate_config(config: &SandboxConfig) -> Result<(), String> {
    if config.version != CONFIG_VERSION {
        return Err(format!(
            "unsupported sandbox configuration version {}",
            config.version
        ));
    }
    if config.parent_pid == 0 {
        return Err("parentPid must be a positive process ID".into());
    }
    if !valid_profile_name(&config.profile_name) {
        return Err("profileName is invalid".into());
    }
    if !config.command.is_absolute()
        || !config.cwd.is_absolute()
        || !config.journal_dir.is_absolute()
    {
        return Err("command, cwd, and journalDir must be absolute".into());
    }
    if !config.command.is_file() {
        return Err(format!(
            "sandbox target is not a file: {}",
            config.command.display()
        ));
    }
    if !config.cwd.is_dir() {
        return Err(format!(
            "sandbox cwd is not a directory: {}",
            config.cwd.display()
        ));
    }
    if !config.journal_dir.is_dir() {
        return Err(format!(
            "sandbox journal directory is unavailable: {}",
            config.journal_dir.display()
        ));
    }
    if config.args.len() > MAX_ARGUMENTS
        || config
            .args
            .iter()
            .any(|value| value.len() > MAX_ARGUMENT_CHARS || value.contains('\0'))
    {
        return Err("sandbox arguments exceed their bounds or contain NUL".into());
    }
    if config.env.len() > MAX_ENVIRONMENT_ENTRIES {
        return Err("sandbox environment contains too many entries".into());
    }
    let mut environment_keys = std::collections::BTreeSet::new();
    for (key, value) in &config.env {
        if key.is_empty()
            || key.contains('=')
            || key.contains('\0')
            || value.contains('\0')
            || key.len() > 256
            || value.len() > MAX_ARGUMENT_CHARS
        {
            return Err("sandbox environment contains an invalid entry".into());
        }
        if !environment_keys.insert(key.to_ascii_uppercase()) {
            return Err("sandbox environment contains case-insensitive duplicate keys".into());
        }
    }
    for paths in [
        &config.readonly_paths,
        &config.readwrite_paths,
        &config.denied_paths,
    ] {
        if paths.len() > MAX_PATHS_PER_CLASS {
            return Err("sandbox filesystem policy contains too many paths".into());
        }
        for candidate in paths {
            if !candidate.is_absolute() || !candidate.exists() {
                return Err(format!(
                    "sandbox filesystem policy path is unavailable: {}",
                    candidate.display()
                ));
            }
        }
    }
    if !(1..=256).contains(&config.max_processes) {
        return Err("maxProcesses must be between 1 and 256".into());
    }
    if !config.allow_child_processes && config.max_processes != 1 {
        return Err("child-process-disabled sandboxes must set maxProcesses to 1".into());
    }
    Ok(())
}

fn read_config() -> Result<SandboxConfig, String> {
    let mut args = std::env::args_os();
    let _program = args.next();
    let config_path = args
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| "usage: getssh-sandbox <absolute-config-path>".to_string())?;
    if args.next().is_some() || !config_path.is_absolute() {
        return Err("usage: getssh-sandbox <absolute-config-path>".into());
    }

    let metadata = std::fs::metadata(&config_path)
        .map_err(|error| format!("cannot inspect sandbox configuration: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_CONFIG_BYTES {
        return Err("sandbox configuration is not a bounded regular file".into());
    }
    let bytes = std::fs::read(&config_path)
        .map_err(|error| format!("cannot read sandbox configuration: {error}"))?;
    // The target must never be able to recover its launch policy or host-only
    // paths from the temporary runtime directory.
    let _ = std::fs::remove_file(&config_path);
    let config: SandboxConfig = serde_json::from_slice(&bytes)
        .map_err(|error| format!("invalid sandbox configuration: {error}"))?;
    validate_config(&config)?;
    Ok(config)
}

#[cfg(windows)]
mod windows;

#[cfg(windows)]
fn main() {
    let result = read_config().and_then(windows::run);
    match result {
        Ok(exit_code) => std::process::exit(exit_code as i32),
        Err(error) => {
            eprintln!("GETSSH Windows sandbox refused to launch: {error}");
            std::process::exit(125);
        }
    }
}

#[cfg(not(windows))]
fn main() {
    let _ = read_config();
    eprintln!("GETSSH AppContainer launcher is only available on Windows.");
    std::process::exit(125);
}

#[cfg(test)]
mod tests {
    use super::valid_profile_name;

    #[test]
    fn profile_names_are_strict_and_bounded() {
        assert!(valid_profile_name("getssh.0123456789abcdef"));
        assert!(!valid_profile_name("other.0123456789abcdef"));
        assert!(!valid_profile_name("getssh.has_underscore"));
        assert!(!valid_profile_name("getssh.path\\escape"));
        assert!(!valid_profile_name(&format!("getssh.{}", "a".repeat(80))));
    }
}
