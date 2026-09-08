//! Windows storage + cleanup provider.
//!
//! Mirrors the macOS conservatism: Recycle Bin and the user's Temp dir are
//! Smart-eligible; Downloads and Desktop are review-only. Removal (in the
//! app-services executor) moves items to the Recycle Bin — only the explicit
//! "Empty Recycle Bin" action destroys anything.

use super::parse_recycle::parse_recycle_bin;
use super::run_powershell;
use crate::platform::fsutil::{directory_stats, list_top_level_items};
use crate::platform::{EmptyTrashResult, PResult, PlatformError, StorageProvider};
use crate::types::{CleanupCategory, CleanupItem, CleanupRisk, StorageInfo};
use std::path::PathBuf;

const RECYCLE_STATS_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$shell = New-Object -ComObject Shell.Application
$bin = $shell.NameSpace(0xA)
$items = @($bin.Items())
$size = 0
foreach ($i in $items) { try { $size += [int64]$i.Size } catch {} }
[PSCustomObject]@{ size = $size; count = $items.Count } | ConvertTo-Json -Compress
"#;

pub struct WindowsStorage {
    home: String,
}

impl Default for WindowsStorage {
    fn default() -> Self {
        Self::new()
    }
}

impl WindowsStorage {
    pub fn new() -> Self {
        WindowsStorage { home: std::env::var("USERPROFILE").unwrap_or_default() }
    }
    fn temp(&self) -> String {
        std::env::temp_dir().to_string_lossy().to_string()
    }
    fn downloads(&self) -> PathBuf {
        PathBuf::from(&self.home).join("Downloads")
    }
    fn desktop(&self) -> PathBuf {
        PathBuf::from(&self.home).join("Desktop")
    }

    fn recycle_stats(&self) -> (u64, u64, bool) {
        match run_powershell(RECYCLE_STATS_SCRIPT) {
            Ok(out) => {
                let s = parse_recycle_bin(&out);
                (s.size, s.count, false)
            }
            Err(_) => (0, 0, true),
        }
    }
}

impl StorageProvider for WindowsStorage {
    fn volume(&self) -> String {
        "C:\\".to_string()
    }
    fn home(&self) -> String {
        self.home.clone()
    }

    fn get_storage(&self) -> PResult<StorageInfo> {
        let script = r#"
$d = Get-PSDrive -Name (Get-Location).Drive.Name
[PSCustomObject]@{ used = $d.Used; free = $d.Free } | ConvertTo-Json -Compress
"#;
        let out = run_powershell(script).map_err(|e| PlatformError(e.0))?;
        let v: serde_json::Value = serde_json::from_str(&out).map_err(|e| PlatformError(e.to_string()))?;
        let used = v.get("used").and_then(|x| x.as_u64()).unwrap_or(0);
        let free = v.get("free").and_then(|x| x.as_u64()).unwrap_or(0);
        Ok(StorageInfo { total_bytes: used + free, used_bytes: used, free_bytes: free, volume: "C:".to_string() })
    }

    fn allowed_roots_for(&self, category_id: &str) -> Vec<String> {
        match category_id {
            "temp" => vec![self.temp()],
            "downloads" => vec![self.downloads().to_string_lossy().to_string()],
            "desktop" => vec![self.desktop().to_string_lossy().to_string()],
            _ => Vec::new(),
        }
    }

    fn scan_categories(&self) -> PResult<Vec<CleanupCategory>> {
        let (recycle_size, recycle_count, recycle_unavailable) = self.recycle_stats();
        let temp = directory_stats(&self.temp());
        let downloads = directory_stats(&self.downloads().to_string_lossy());
        let desktop = directory_stats(&self.desktop().to_string_lossy());

        Ok(vec![
            CleanupCategory {
                id: "recyclebin".into(),
                title: "Recycle Bin".into(),
                description: "Permanently remove everything currently in the Recycle Bin.".into(),
                risk: CleanupRisk::System,
                smart_eligible: true,
                size_bytes: recycle_size,
                item_count: recycle_count as usize,
                unavailable: recycle_unavailable,
                detail: if recycle_unavailable { Some("Recycle Bin could not be read.".into()) } else { None },
            },
            CleanupCategory {
                id: "temp".into(),
                title: "Temporary Files".into(),
                description: "Leftover temporary files in your user Temp folder.".into(),
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
                description: "Review clutter on your Desktop before sending it to the Recycle Bin.".into(),
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
            "temp" => list_top_level_items(&self.temp(), category_id),
            "downloads" => list_top_level_items(&self.downloads().to_string_lossy(), category_id),
            "desktop" => list_top_level_items(&self.desktop().to_string_lossy(), category_id),
            _ => Vec::new(),
        })
    }

    fn empty_trash(&self) -> PResult<EmptyTrashResult> {
        let (size, count, _) = self.recycle_stats();
        if count == 0 {
            return Ok(EmptyTrashResult { reclaimed_bytes: 0, removed_count: 0 });
        }
        let _ = run_powershell("Clear-RecycleBin -Force -ErrorAction SilentlyContinue");
        Ok(EmptyTrashResult { reclaimed_bytes: size, removed_count: count as usize })
    }
}
