//! Filesystem helpers for the cleanup scanners. Sizing is bounded (entry cap +
//! depth cap) so scanning a huge tree can never hang the UI or spike CPU — a
//! tiny utility should feel tiny.

use crate::types::CleanupItem;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

const MAX_ENTRIES: usize = 20_000;
const MAX_DEPTH: usize = 12;

pub fn path_exists(p: &str) -> bool {
    Path::new(p).exists()
}

/// Recursively sum file sizes under `root`, bounded for performance.
pub fn directory_size(root: &str) -> u64 {
    let mut total = 0u64;
    let mut visited = 0usize;
    walk(Path::new(root), 0, &mut total, &mut visited);
    total
}

fn walk(dir: &Path, depth: usize, total: &mut u64, visited: &mut usize) {
    if depth > MAX_DEPTH || *visited > MAX_ENTRIES {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if *visited > MAX_ENTRIES {
            return;
        }
        *visited += 1;
        let Ok(file_type) = entry.file_type() else { continue };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            walk(&entry.path(), depth + 1, total, visited);
        } else if file_type.is_file() {
            if let Ok(meta) = entry.metadata() {
                *total += meta.len();
            }
        }
    }
}

pub struct DirStats {
    pub size_bytes: u64,
    pub item_count: usize,
}

/// Size + top-level item count of a directory.
pub fn directory_stats(root: &str) -> DirStats {
    if !path_exists(root) {
        return DirStats { size_bytes: 0, item_count: 0 };
    }
    let item_count = fs::read_dir(root).map(|it| it.count()).unwrap_or(0);
    let size_bytes = directory_size(root);
    DirStats { size_bytes, item_count }
}

fn iso_from_system_time(t: std::time::SystemTime) -> Option<String> {
    let dur = t.duration_since(UNIX_EPOCH).ok()?;
    let dt = chrono::DateTime::<chrono::Utc>::from_timestamp(dur.as_secs() as i64, dur.subsec_nanos())?;
    Some(dt.to_rfc3339())
}

/// List the top-level entries of a directory as CleanupItems (sized),
/// largest-first.
pub fn list_top_level_items(root: &str, category_id: &str) -> Vec<CleanupItem> {
    if !path_exists(root) {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
    let mut items = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".DS_Store" || name == "desktop.ini" {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_symlink() {
            continue;
        }
        let full = entry.path();
        let is_directory = meta.is_dir();
        let size_bytes = if is_directory { directory_size(&full.to_string_lossy()) } else { meta.len() };
        items.push(CleanupItem {
            path: full.to_string_lossy().to_string(),
            name,
            size_bytes,
            is_directory,
            modified_at: meta.modified().ok().and_then(iso_from_system_time),
            category_id: category_id.to_string(),
        });
    }
    items.sort_by_key(|a| std::cmp::Reverse(a.size_bytes));
    items
}

/// Size of a single path (recursive for directories, file size otherwise).
pub fn size_of_path(p: &str) -> u64 {
    let path = Path::new(p);
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_symlink() => 0,
        Ok(meta) if meta.is_dir() => directory_size(p),
        Ok(meta) => meta.len(),
        Err(_) => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, write};
    use tempfile::tempdir;

    #[test]
    fn directory_stats_of_missing_dir_is_zero() {
        let s = directory_stats("/does/not/exist/at/all");
        assert_eq!(s.size_bytes, 0);
        assert_eq!(s.item_count, 0);
    }

    #[test]
    fn directory_size_sums_nested_files() {
        let dir = tempdir().unwrap();
        write(dir.path().join("a.txt"), b"hello").unwrap();
        create_dir_all(dir.path().join("sub")).unwrap();
        write(dir.path().join("sub").join("b.txt"), b"world!").unwrap();
        let size = directory_size(dir.path().to_str().unwrap());
        assert_eq!(size, 5 + 6);
    }

    #[test]
    fn list_top_level_items_sorts_largest_first_and_skips_junk() {
        let dir = tempdir().unwrap();
        write(dir.path().join("small.txt"), vec![0u8; 10]).unwrap();
        write(dir.path().join("big.txt"), vec![0u8; 1000]).unwrap();
        write(dir.path().join(".DS_Store"), b"junk").unwrap();
        let items = list_top_level_items(dir.path().to_str().unwrap(), "cat");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].name, "big.txt");
        assert_eq!(items[1].name, "small.txt");
        assert!(items.iter().all(|i| i.category_id == "cat"));
    }

    #[test]
    fn size_of_path_handles_file_and_dir() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("f.bin");
        write(&file, vec![0u8; 42]).unwrap();
        assert_eq!(size_of_path(file.to_str().unwrap()), 42);
        assert_eq!(size_of_path(dir.path().to_str().unwrap()), 42);
        assert_eq!(size_of_path("/definitely/not/here"), 0);
    }
}
