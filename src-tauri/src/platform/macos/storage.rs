//! macOS storage + cleanup provider.
//!
//! Cleanup is deliberately conservative: only Trash, per-user Caches and the
//! system temp dir are Smart-eligible; Downloads and Desktop are review-only.
//! Actual removal (in the app-services executor) moves items to the Trash —
//! nothing is permanently destroyed except the explicit "Empty Trash" action.

use super::run_applescript;
use crate::platform::fsutil::{directory_stats, list_top_level_items, path_exists};
use crate::platform::{EmptyTrashResult, PResult, PlatformError, StorageProvider};
use crate::types::{CleanupCategory, CleanupItem, CleanupRisk, StorageInfo};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

pub struct MacStorage {
    home: String,
}

impl Default for MacStorage {
    fn default() -> Self {
        Self::new()
    }
}

impl MacStorage {
    pub fn new() -> Self {
        MacStorage { home: std::env::var("HOME").unwrap_or_default() }
    }
    fn trash(&self) -> PathBuf {
        PathBuf::from(&self.home).join(".Trash")
    }
    fn caches(&self) -> PathBuf {
        PathBuf::from(&self.home).join("Library").join("Caches")
    }
    fn downloads(&self) -> PathBuf {
        PathBuf::from(&self.home).join("Downloads")
    }
    fn desktop(&self) -> PathBuf {
        PathBuf::from(&self.home).join("Desktop")
    }
    fn temp(&self) -> String {
        std::env::temp_dir().to_string_lossy().to_string()
    }
}

impl StorageProvider for MacStorage {
    fn volume(&self) -> String {
        "/".to_string()
    }
    fn home(&self) -> String {
        self.home.clone()
    }

    fn get_storage(&self) -> PResult<StorageInfo> {
        // `df -k /` prints: Filesystem 1K-blocks Used Available Capacity Mounted-on
        let output = Command::new("df")
            .args(["-k", "/"])
            .output()
            .map_err(|e| PlatformError(format!("df failed: {e}")))?;
        let text = String::from_utf8_lossy(&output.stdout);
        let line = text.lines().nth(1).ok_or_else(|| PlatformError("unexpected df output".into()))?;
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 4 {
            return Err(PlatformError("unexpected df columns".into()));
        }
        let total_kb: u64 = cols[1].parse().unwrap_or(0);
        let used_kb: u64 = cols[2].parse().unwrap_or(0);
        let free_kb: u64 = cols[3].parse().unwrap_or(0);
        Ok(StorageInfo {
            total_bytes: total_kb * 1024,
            used_bytes: used_kb * 1024,
            free_bytes: free_kb * 1024,
            volume: "Macintosh HD".to_string(),
        })
    }

    fn allowed_roots_for(&self, category_id: &str) -> Vec<String> {
        match category_id {
            "caches" => vec![self.caches().to_string_lossy().to_string()],
            "downloads" => vec![self.downloads().to_string_lossy().to_string()],
            "desktop" => vec![self.desktop().to_string_lossy().to_string()],
            "temp" => vec![self.temp()],
            _ => Vec::new(),
        }
    }

    fn scan_categories(&self) -> PResult<Vec<CleanupCategory>> {
        let trash = directory_stats(&self.trash().to_string_lossy());
        let caches = directory_stats(&self.caches().to_string_lossy());
        let downloads = directory_stats(&self.downloads().to_string_lossy());
        let desktop = directory_stats(&self.desktop().to_string_lossy());
        let temp = directory_stats(&self.temp());

        Ok(vec![
            CleanupCategory {
                id: "trash".into(),
                title: "Trash".into(),
                description: "Permanently remove everything currently in the Trash.".into(),
                risk: CleanupRisk::System,
                smart_eligible: true,
                size_bytes: trash.size_bytes,
                item_count: trash.item_count,
                unavailable: false,
                detail: None,
            },
            CleanupCategory {
                id: "caches".into(),
                title: "Application Caches".into(),
                description: "Rebuildable caches in your user Library. Apps recreate these as needed.".into(),
                risk: CleanupRisk::Safe,
                smart_eligible: true,
                size_bytes: caches.size_bytes,
                item_count: caches.item_count,
                unavailable: false,
                detail: None,
            },
            CleanupCategory {
                id: "temp".into(),
                title: "Temporary Files".into(),
                description: "Leftover temporary files from your current session.".into(),
                risk: CleanupRisk::Safe,
                smart_eligible: true,
                size_bytes: temp.size_bytes,
                item_count: temp.item_count,
                unavailable: false,
                detail: None,
            },
            CleanupCategory {
                id: "downloads".into(),
                title: "Downloads".into(),
                description: "Review large or old downloads. Nothing is removed without your say-so.".into(),
                risk: CleanupRisk::Review,
                smart_eligible: false,
                size_bytes: downloads.size_bytes,
                item_count: downloads.item_count,
                unavailable: false,
                detail: None,
            },
            CleanupCategory {
                id: "desktop".into(),
                title: "Desktop".into(),
                description: "Review clutter on your Desktop before moving it to the Trash.".into(),
                risk: CleanupRisk::Review,
                smart_eligible: false,
                size_bytes: desktop.size_bytes,
                item_count: desktop.item_count,
                unavailable: false,
                detail: None,
            },
        ])
    }

    fn list_items(&self, category_id: &str) -> PResult<Vec<CleanupItem>> {
        Ok(match category_id {
            "trash" => list_top_level_items(&self.trash().to_string_lossy(), category_id),
            "caches" => list_top_level_items(&self.caches().to_string_lossy(), category_id),
            "downloads" => list_top_level_items(&self.downloads().to_string_lossy(), category_id),
            "desktop" => list_top_level_items(&self.desktop().to_string_lossy(), category_id),
            "temp" => list_top_level_items(&self.temp(), category_id),
            _ => Vec::new(),
        })
    }

    fn empty_trash(&self) -> PResult<EmptyTrashResult> {
        let trash_path = self.trash();
        let before = directory_stats(&trash_path.to_string_lossy());
        if before.item_count == 0 {
            return Ok(EmptyTrashResult { reclaimed_bytes: 0, removed_count: 0 });
        }
        if run_applescript(r#"tell application "Finder" to empty trash"#).is_err() {
            // Fall back to removing Trash contents directly if Finder automation is denied.
            if path_exists(&trash_path.to_string_lossy()) {
                if let Ok(entries) = fs::read_dir(&trash_path) {
                    for entry in entries.flatten() {
                        let _ = fs::remove_dir_all(entry.path()).or_else(|_| fs::remove_file(entry.path()));
                    }
                }
            }
        }
        Ok(EmptyTrashResult { reclaimed_bytes: before.size_bytes, removed_count: before.item_count })
    }
}
