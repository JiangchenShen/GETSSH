//! Asset folders: the tree in the host sidebar. A folder exists when a row of asset_folders names
//! it or a profile's groupName points into it; parents are implied. Ported from DatabaseManager.ts
//! (assertFolderPath, folderPaths and the four mutations) and checked against store.fake.js.

use std::collections::BTreeSet;

use getssh_keystore::device::Device;

use crate::error::{StoreError, StoreResult};
use crate::sqlite::{Connection, SqlResult};
use crate::store::{now_ms, Store};

const MAX_PATH_UNITS: usize = 512;
const MAX_SEGMENT_UNITS: usize = 128;
const MAX_MOVED_PROFILES: usize = 500;
const MAX_PROFILE_ID_UNITS: usize = 256;

/// The folder list after a change, plus the new folder of every profile the change moved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderSnapshot {
    pub folders: Vec<String>,
    pub memberships: Vec<(String, Option<String>)>,
}

/// Lengths are counted the way the TypeScript code counted them (UTF-16 code units).
pub(crate) fn js_len(value: &str) -> usize {
    value.encode_utf16().count()
}

pub(crate) fn has_control(value: &str) -> bool {
    value.chars().any(|c| (c as u32) < 0x20 || c == '\u{7f}')
}

/// `!part.trim()` in JavaScript: empty or only whitespace (JavaScript also trims U+FEFF).
fn blank(value: &str) -> bool {
    value.chars().all(|c| c.is_whitespace() || c == '\u{feff}')
}

pub fn is_folder_path(value: &str) -> bool {
    let len = js_len(value);
    len > 0
        && len <= MAX_PATH_UNITS
        && value
            .split('/')
            .all(|part| js_len(part) <= MAX_SEGMENT_UNITS && !blank(part) && part != "." && part != ".." && !has_control(part))
}

fn check_path(value: &str) -> StoreResult<()> {
    if is_folder_path(value) {
        Ok(())
    } else {
        Err(StoreError::invalid("invalid folder path"))
    }
}

fn check_name(value: &str) -> StoreResult<()> {
    if value.contains('/') {
        return Err(StoreError::invalid("invalid folder name"));
    }
    check_path(value)
}

fn inside(candidate: &str, folder: &str) -> bool {
    candidate == folder || candidate.strip_prefix(folder).is_some_and(|rest| rest.starts_with('/'))
}

/// Case-insensitive, lowercase first. DatabaseManager sorted with the user's localeCompare; the
/// main process re-sorts for display, so this only has to be stable and close to it.
fn sort_folders(folders: &mut [String]) {
    folders.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()).then_with(|| b.cmp(a)));
}

/// Every folder of the workspace: the stored ones and every profile group, with their parents.
/// Malformed legacy rows and labels are left out (the labels stay on their profiles).
fn folder_paths(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<String>> {
    let mut paths = BTreeSet::new();
    let mut include = |path: &str| {
        if !is_folder_path(path) {
            return;
        }
        let segments: Vec<&str> = path.split('/').collect();
        for i in 1..=segments.len() {
            paths.insert(segments[..i].join("/"));
        }
    };
    for path in conn.query_map("SELECT path FROM asset_folders", &[], |r| r.text(0))?.into_iter().flatten() {
        include(&path);
    }
    for group in conn
        .query_map("SELECT DISTINCT groupName FROM profiles WHERE workspace_id = ? AND groupName IS NOT NULL", &[workspace_id.into()], |r| r.text(0))?
        .into_iter()
        .flatten()
    {
        include(&group);
    }
    let mut folders: Vec<String> = paths.into_iter().collect();
    sort_folders(&mut folders);
    Ok(folders)
}

fn snapshot(conn: &Connection, workspace_id: &str, changed: &[String]) -> SqlResult<FolderSnapshot> {
    let mut memberships = Vec::with_capacity(changed.len());
    for id in changed {
        let group = conn
            .query_optional("SELECT groupName FROM profiles WHERE id = ? AND workspace_id = ?", &[id.as_str().into(), workspace_id.into()], |r| r.text(0))?
            .flatten();
        memberships.push((id.clone(), group));
    }
    Ok(FolderSnapshot { folders: folder_paths(conn, workspace_id)?, memberships })
}

impl<D: Device> Store<D> {
    pub fn get_asset_folders(&self, workspace_id: &str) -> StoreResult<Vec<String>> {
        self.with_workspace(workspace_id, |conn| Ok(folder_paths(conn, workspace_id)?))
    }

    /// Creates the folder and every missing parent.
    pub fn create_asset_folder(&self, workspace_id: &str, folder: &str) -> StoreResult<FolderSnapshot> {
        check_path(folder)?;
        self.with_workspace(workspace_id, |conn| {
            let parts: Vec<&str> = folder.split('/').collect();
            let now = now_ms();
            conn.transaction(|c| {
                for i in 1..=parts.len() {
                    c.execute("INSERT OR IGNORE INTO asset_folders (path, created_at) VALUES (?, ?)", &[parts[..i].join("/").into(), now.into()])?;
                }
                Ok(())
            })?;
            Ok(snapshot(conn, workspace_id, &[])?)
        })
    }

    /// Renames the last segment of `folder`; subfolders and the profiles inside move along.
    pub fn rename_asset_folder(&self, workspace_id: &str, folder: &str, new_name: &str) -> StoreResult<FolderSnapshot> {
        check_path(folder)?;
        check_name(new_name)?;
        self.with_workspace(workspace_id, |conn| {
            let mut segments: Vec<&str> = folder.split('/').collect();
            segments.pop();
            segments.push(new_name);
            let next = segments.join("/");
            check_path(&next)?;
            let all = folder_paths(conn, workspace_id)?;
            if !all.iter().any(|f| f == folder) {
                return Err(StoreError::not_found("folder does not exist"));
            }
            if next == folder {
                return Ok(snapshot(conn, workspace_id, &[])?);
            }
            let source: Vec<&String> = all.iter().filter(|f| inside(f, folder)).collect();
            let target: Vec<String> = source.iter().map(|f| format!("{next}{}", &f[folder.len()..])).collect();
            for path in &target {
                check_path(path)?;
            }
            if target.iter().any(|t| all.contains(t) && !source.contains(&t)) {
                return Err(StoreError::invalid("destination folder already exists"));
            }
            let stored = conn.query_map("SELECT path, created_at FROM asset_folders", &[], |r| Ok((r.text(0)?.unwrap_or_default(), r.value(1)?)))?;
            let groups = conn.query_map(
                "SELECT id, groupName FROM profiles WHERE workspace_id = ? AND groupName IS NOT NULL ORDER BY rowid",
                &[workspace_id.into()],
                |r| Ok((r.text(0)?.unwrap_or_default(), r.text(1)?.unwrap_or_default())),
            )?;
            let mut changed = Vec::new();
            conn.transaction(|c| {
                let moved: Vec<_> = stored.iter().filter(|(path, _)| inside(path, folder)).collect();
                for (path, _) in &moved {
                    c.execute("DELETE FROM asset_folders WHERE path = ?", &[path.as_str().into()])?;
                }
                for (path, created_at) in &moved {
                    c.execute(
                        "INSERT INTO asset_folders (path, created_at) VALUES (?, ?)",
                        &[format!("{next}{}", &path[folder.len()..]).into(), created_at.clone()],
                    )?;
                }
                for (id, group) in &groups {
                    if inside(group, folder) {
                        c.execute(
                            "UPDATE profiles SET groupName = ? WHERE id = ? AND workspace_id = ?",
                            &[format!("{next}{}", &group[folder.len()..]).into(), id.as_str().into(), workspace_id.into()],
                        )?;
                        changed.push(id.clone());
                    }
                }
                Ok(())
            })?;
            Ok(snapshot(conn, workspace_id, &changed)?)
        })
    }

    /// Removes an empty folder: no subfolders and no profiles inside.
    pub fn remove_asset_folder(&self, workspace_id: &str, folder: &str) -> StoreResult<FolderSnapshot> {
        check_path(folder)?;
        self.with_workspace(workspace_id, |conn| {
            let all = folder_paths(conn, workspace_id)?;
            if !all.iter().any(|f| f == folder) {
                return Err(StoreError::not_found("folder does not exist"));
            }
            if all.iter().any(|f| f.strip_prefix(folder).is_some_and(|rest| rest.starts_with('/'))) {
                return Err(StoreError::invalid("move child folders first"));
            }
            let groups = conn.query_map(
                "SELECT groupName FROM profiles WHERE workspace_id = ? AND groupName IS NOT NULL",
                &[workspace_id.into()],
                |r| Ok(r.text(0)?.unwrap_or_default()),
            )?;
            if groups.iter().any(|g| inside(g, folder)) {
                return Err(StoreError::invalid("move hosts out of this folder first"));
            }
            conn.execute("DELETE FROM asset_folders WHERE path = ?", &[folder.into()])?;
            Ok(snapshot(conn, workspace_id, &[])?)
        })
    }

    /// Moves profiles into `folder`, or out of every folder with `None`.
    pub fn move_profiles_to_asset_folder(&self, workspace_id: &str, profile_ids: &[String], folder: Option<&str>) -> StoreResult<FolderSnapshot> {
        let mut seen = std::collections::HashSet::new();
        let valid_ids = !profile_ids.is_empty()
            && profile_ids.len() <= MAX_MOVED_PROFILES
            && profile_ids.iter().all(|id| !id.is_empty() && js_len(id) <= MAX_PROFILE_ID_UNITS && !has_control(id) && seen.insert(id.as_str()));
        if !valid_ids {
            return Err(StoreError::invalid("invalid profile ids"));
        }
        if let Some(folder) = folder {
            check_path(folder)?;
        }
        self.with_workspace(workspace_id, |conn| {
            if let Some(folder) = folder {
                if !folder_paths(conn, workspace_id)?.iter().any(|f| f == folder) {
                    return Err(StoreError::not_found("destination folder does not exist"));
                }
            }
            let mut current = Vec::with_capacity(profile_ids.len());
            for id in profile_ids {
                let group = conn
                    .query_optional("SELECT groupName FROM profiles WHERE id = ? AND workspace_id = ?", &[id.as_str().into(), workspace_id.into()], |r| r.text(0))?
                    .ok_or_else(|| StoreError::not_found("saved host does not exist in this workspace"))?;
                current.push(group);
            }
            let mut changed = Vec::new();
            conn.transaction(|c| {
                for (id, group) in profile_ids.iter().zip(&current) {
                    if group.as_deref() != folder {
                        c.execute("UPDATE profiles SET groupName = ? WHERE id = ? AND workspace_id = ?", &[folder.into(), id.as_str().into(), workspace_id.into()])?;
                        changed.push(id.clone());
                    }
                }
                if let Some(folder) = folder {
                    c.execute("INSERT OR IGNORE INTO asset_folders (path, created_at) VALUES (?, ?)", &[folder.into(), now_ms().into()])?;
                }
                Ok(())
            })?;
            Ok(snapshot(conn, workspace_id, &changed)?)
        })
    }
}
