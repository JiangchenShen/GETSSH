use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

/// Upper bounds for one plugin archive. They leave generous room for real plugins while keeping a
/// hostile archive (a zip bomb, or millions of tiny entries) from filling the disk.
const MAX_ENTRIES: usize = 50_000;
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;

const S_IFMT: u32 = 0o170000;
const S_IFLNK: u32 = 0o120000;

/// Extracts `zip_path` into `target_dir`.
///
/// `target_dir` must be an existing, empty, real directory (not a symlink): nothing that was there
/// before can be overwritten, followed or deleted. On any error, everything this call created is
/// removed again and `target_dir` itself is left in place for the caller to dispose of.
#[napi(js_name = "extractPlugin")]
pub async fn extract_plugin(zip_path: String, target_dir: String) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        extract_into(Path::new(&zip_path), Path::new(&target_dir), MAX_ENTRIES, MAX_TOTAL_BYTES)
    })
    .await
    .map_err(|e| Error::new(Status::GenericFailure, format!("Async task failed: {}", e)))?
    .map_err(|e| Error::new(Status::GenericFailure, e))
}

fn extract_into(zip_path: &Path, target: &Path, max_entries: usize, max_bytes: u64) -> std::result::Result<(), String> {
    let meta = fs::symlink_metadata(target).map_err(|e| format!("Extraction target is not accessible: {}", e))?;
    if !meta.file_type().is_dir() || meta.file_type().is_symlink() {
        return Err("[Security] Extraction target must be a real directory, not a file or a link.".to_string());
    }
    let mut listing = fs::read_dir(target).map_err(|e| format!("Extraction target is not readable: {}", e))?;
    if listing.next().is_some() {
        return Err("[Security] Extraction target must be empty; refusing to extract over existing files.".to_string());
    }

    let file = fs::File::open(zip_path).map_err(|e| format!("Failed to open zip: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid zip format: {}", e))?;
    if archive.len() > max_entries {
        return Err(format!("[Security] Archive has {} entries; the limit is {}.", archive.len(), max_entries));
    }

    let mut created = Vec::new();
    let result = extract_entries(&mut archive, target, max_bytes, &mut created);
    if result.is_err() {
        remove_created(&created);
    }
    result
}

fn extract_entries(
    archive: &mut zip::ZipArchive<fs::File>,
    target: &Path,
    max_bytes: u64,
    created: &mut Vec<PathBuf>,
) -> std::result::Result<(), String> {
    let mut remaining = max_bytes;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Failed to read zip entry: {}", e))?;
        let raw_name = entry.name().to_string();

        let relative = entry.enclosed_name().ok_or_else(|| {
            format!("[Security] Zip Slip Vulnerability Detected: entry '{}' is attempting path traversal. Extraction aborted.", raw_name)
        })?;
        if entry.unix_mode().is_some_and(|mode| mode & S_IFMT == S_IFLNK) {
            return Err(format!("[Security] Archive entry '{}' is a symbolic link; plugin archives may not contain links.", raw_name));
        }

        let mut parts = Vec::new();
        for component in relative.components() {
            match component {
                Component::Normal(part) => parts.push(part.to_os_string()),
                Component::CurDir => {}
                _ => return Err(format!("[Security] Archive entry '{}' has an unsafe path.", raw_name)),
            }
        }
        let Some(file_name) = (if entry.is_dir() { None } else { parts.pop() }) else {
            // A directory entry: create each level; an empty name ("./") creates nothing.
            let mut dir = target.to_path_buf();
            for part in &parts {
                dir.push(part);
                ensure_real_dir(&dir, created)?;
            }
            continue;
        };

        // Parents are created one level at a time and every existing level must be a real
        // directory, so no path can be redirected through a link.
        let mut path = target.to_path_buf();
        for part in &parts {
            path.push(part);
            ensure_real_dir(&path, created)?;
        }
        path.push(file_name);

        // create_new fails if anything, including a dangling link, already has this name.
        let mut out = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| format!("Failed to create file '{}': {}", raw_name, e))?;
        created.push(path);

        // Count the bytes actually written instead of trusting the sizes in the zip headers.
        let written = io::copy(&mut (&mut entry).take(remaining + 1), &mut out)
            .map_err(|e| format!("Failed to extract file '{}': {}", raw_name, e))?;
        if written > remaining {
            return Err(format!(
                "[Security] Archive expands beyond the {} MiB limit; extraction aborted.",
                max_bytes / (1024 * 1024)
            ));
        }
        remaining -= written;
    }

    Ok(())
}

fn ensure_real_dir(path: &Path, created: &mut Vec<PathBuf>) -> std::result::Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_dir() && !meta.file_type().is_symlink() => Ok(()),
        Ok(_) => Err(format!("[Security] '{}' already exists and is not a directory.", path.display())),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(|e| format!("Failed to create dir '{}': {}", path.display(), e))?;
            created.push(path.to_path_buf());
            Ok(())
        }
        Err(e) => Err(format!("Failed to inspect '{}': {}", path.display(), e)),
    }
}

/// Removes exactly the paths this extraction created, newest first, so directories are empty by the
/// time they are removed. Anything else in the target is never touched.
fn remove_created(created: &[PathBuf]) {
    for path in created.iter().rev() {
        match fs::symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_dir() => {
                let _ = fs::remove_dir(path);
            }
            Ok(_) => {
                let _ = fs::remove_file(path);
            }
            Err(_) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use zip::write::SimpleFileOptions;

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "getssh-unarchive-test-{}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst),
            label
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    enum Entry<'a> {
        File(&'a str, &'a [u8]),
        Dir(&'a str),
        Link(&'a str, &'a str),
    }

    fn write_zip(path: &Path, entries: &[Entry]) {
        let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for entry in entries {
            match entry {
                Entry::File(name, data) => {
                    zip.start_file(*name, options).unwrap();
                    zip.write_all(data).unwrap();
                }
                Entry::Dir(name) => zip.add_directory(*name, options).unwrap(),
                Entry::Link(name, target) => zip.add_symlink(*name, *target, options).unwrap(),
            }
        }
        zip.finish().unwrap();
    }

    fn fresh_target(root: &Path) -> PathBuf {
        let target = root.join("target");
        fs::create_dir(&target).unwrap();
        target
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    #[test]
    fn extracts_files_and_nested_directories() {
        let root = scratch("ok");
        let zip = root.join("ok.zip");
        write_zip(&zip, &[Entry::Dir("pkg/"), Entry::File("pkg/package.json", b"{}"), Entry::File("pkg/lib/index.js", b"x")]);
        let target = fresh_target(&root);
        extract_into(&zip, &target, MAX_ENTRIES, MAX_TOTAL_BYTES).unwrap();
        assert_eq!(fs::read(target.join("pkg/package.json")).unwrap(), b"{}");
        assert_eq!(fs::read(target.join("pkg/lib/index.js")).unwrap(), b"x");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn refuses_non_empty_target_and_keeps_its_files() {
        let root = scratch("nonempty");
        let zip = root.join("slip.zip");
        write_zip(&zip, &[Entry::File("../../slip.txt", b"EVIL")]);
        let target = fresh_target(&root);
        fs::write(target.join("core_plugin.js"), b"keep").unwrap();
        let err = extract_into(&zip, &target, MAX_ENTRIES, MAX_TOTAL_BYTES).unwrap_err();
        assert!(err.contains("must be empty"), "{}", err);
        assert_eq!(fs::read(target.join("core_plugin.js")).unwrap(), b"keep");
        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_target_that_is_a_link() {
        let root = scratch("linktarget");
        let zip = root.join("ok.zip");
        write_zip(&zip, &[Entry::File("a.txt", b"x")]);
        let real = root.join("real");
        fs::create_dir(&real).unwrap();
        let link = root.join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(extract_into(&zip, &link, MAX_ENTRIES, MAX_TOTAL_BYTES).is_err());
        assert!(names(&real).is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn traversal_entry_removes_only_what_this_call_created() {
        let root = scratch("slip");
        let zip = root.join("slip.zip");
        write_zip(&zip, &[Entry::File("pkg/package.json", b"{}"), Entry::File("../../slip.txt", b"EVIL")]);
        let target = fresh_target(&root);
        let err = extract_into(&zip, &target, MAX_ENTRIES, MAX_TOTAL_BYTES).unwrap_err();
        assert!(err.contains("Zip Slip"), "{}", err);
        assert!(target.is_dir(), "the target directory itself must survive");
        assert!(names(&target).is_empty(), "partial output must be cleaned up");
        assert!(!root.join("slip.txt").exists() && !root.parent().unwrap().join("slip.txt").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn rejects_link_entries_without_writing_outside() {
        let root = scratch("linkentry");
        let outside = root.join("outside");
        fs::create_dir(&outside).unwrap();
        let zip = root.join("sym.zip");
        write_zip(&zip, &[Entry::Link("link", outside.to_str().unwrap()), Entry::File("link/escaped.txt", b"PWNED")]);
        let target = fresh_target(&root);
        let err = extract_into(&zip, &target, MAX_ENTRIES, MAX_TOTAL_BYTES).unwrap_err();
        assert!(err.contains("symbolic link"), "{}", err);
        assert!(names(&outside).is_empty());
        assert!(names(&target).is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn rejects_duplicate_and_conflicting_entries() {
        let root = scratch("dup");
        let dup = root.join("dup.zip");
        // The zip crate already rejects byte-identical names; these two differ but resolve to one path.
        write_zip(&dup, &[Entry::File("a.txt", b"1"), Entry::File("./a.txt", b"2")]);
        let target = fresh_target(&root);
        assert!(extract_into(&dup, &target, MAX_ENTRIES, MAX_TOTAL_BYTES).is_err());
        assert!(names(&target).is_empty());

        let conflict = root.join("conflict.zip");
        write_zip(&conflict, &[Entry::File("a", b"file"), Entry::File("a/b.txt", b"x")]);
        let err = extract_into(&conflict, &target, MAX_ENTRIES, MAX_TOTAL_BYTES).unwrap_err();
        assert!(err.contains("not a directory"), "{}", err);
        assert!(names(&target).is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn enforces_size_and_entry_limits_by_actual_bytes() {
        let root = scratch("bomb");
        let zip = root.join("bomb.zip");
        let zeros = vec![0u8; 64 * 1024];
        write_zip(&zip, &[Entry::File("a.bin", &zeros), Entry::File("b.bin", &zeros)]);
        let target = fresh_target(&root);
        let err = extract_into(&zip, &target, MAX_ENTRIES, 100 * 1024).unwrap_err();
        assert!(err.contains("limit"), "{}", err);
        assert!(names(&target).is_empty());

        let err = extract_into(&zip, &target, 1, MAX_TOTAL_BYTES).unwrap_err();
        assert!(err.contains("entries"), "{}", err);
        extract_into(&zip, &target, 2, 128 * 1024).unwrap();
        fs::remove_dir_all(&root).unwrap();
    }
}
