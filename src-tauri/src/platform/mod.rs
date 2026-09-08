//! Platform abstraction. All OS-specific behaviour lives behind these traits
//! so the sweep/cleanup/icon services never branch on `cfg!(target_os)`.
//! macOS and Windows provide concrete implementations; [`current`] selects
//! the right set at compile time.

pub mod fsutil;
#[cfg(target_os = "macos")]
pub mod macos;

// The Windows platform implementation uses Windows-only APIs (process
// creation flags, etc.) and only compiles there. Its pure JSON parser
// (`parse_apps`) has no OS dependency, so it stays available on every
// platform to be unit-tested in ordinary `cargo test` runs (e.g. on the
// macOS CI runner), not only on the Windows runner.
#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(not(target_os = "windows"))]
pub mod windows {
    pub mod parse_apps;
    pub mod parse_recycle;
}

use crate::types::{CleanupCategory, CleanupItem, RawApp, RunningApp, StorageInfo};
use std::error::Error;
use std::fmt;

#[derive(Debug)]
pub struct PlatformError(pub String);
impl fmt::Display for PlatformError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl Error for PlatformError {}
impl From<std::io::Error> for PlatformError {
    fn from(e: std::io::Error) -> Self {
        PlatformError(e.to_string())
    }
}
pub type PResult<T> = Result<T, PlatformError>;

/// Enumerates user-facing running applications (never daemons/agents).
pub trait ApplicationDiscovery: Send + Sync {
    fn list(&self) -> PResult<Vec<RawApp>>;
}

/// Gracefully closes applications, escalating only when explicitly allowed.
pub trait ApplicationTerminator: Send + Sync {
    fn request_quit(&self, app: &RunningApp);
    fn force_quit(&self, app: &RunningApp);
    fn close_file_manager_windows(&self);
}

pub struct EmptyTrashResult {
    pub reclaimed_bytes: u64,
    pub removed_count: usize,
}

/// Disk usage + safe cleanup categories.
pub trait StorageProvider: Send + Sync {
    fn volume(&self) -> String;
    fn home(&self) -> String;
    fn get_storage(&self) -> PResult<StorageInfo>;
    fn scan_categories(&self) -> PResult<Vec<CleanupCategory>>;
    fn allowed_roots_for(&self, category_id: &str) -> Vec<String>;
    fn list_items(&self, category_id: &str) -> PResult<Vec<CleanupItem>>;
    fn empty_trash(&self) -> PResult<EmptyTrashResult>;
}

/// Extracts application icons as PNG data URLs.
pub trait IconProvider: Send + Sync {
    fn get_icon(&self, path: Option<&str>, bundle_id: Option<&str>) -> Option<String>;
}

pub struct PlatformServices {
    pub discovery: Box<dyn ApplicationDiscovery>,
    pub terminator: Box<dyn ApplicationTerminator>,
    pub storage: Box<dyn StorageProvider>,
    pub icons: Box<dyn IconProvider>,
}

#[cfg(target_os = "macos")]
pub fn current() -> PlatformServices {
    PlatformServices {
        discovery: Box::new(macos::discovery::MacDiscovery),
        terminator: Box::new(macos::terminator::MacTerminator),
        storage: Box::new(macos::storage::MacStorage::new()),
        icons: Box::new(macos::icons::MacIcons::new()),
    }
}

#[cfg(target_os = "windows")]
pub fn current() -> PlatformServices {
    PlatformServices {
        discovery: Box::new(windows::discovery::WindowsDiscovery),
        terminator: Box::new(windows::terminator::WindowsTerminator),
        storage: Box::new(windows::storage::WindowsStorage::new()),
        icons: Box::new(windows::icons::WindowsIcons::new()),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn current() -> PlatformServices {
    struct Noop;
    impl ApplicationDiscovery for Noop {
        fn list(&self) -> PResult<Vec<RawApp>> {
            Ok(Vec::new())
        }
    }
    impl ApplicationTerminator for Noop {
        fn request_quit(&self, _app: &RunningApp) {}
        fn force_quit(&self, _app: &RunningApp) {}
        fn close_file_manager_windows(&self) {}
    }
    impl StorageProvider for Noop {
        fn volume(&self) -> String {
            "/".into()
        }
        fn home(&self) -> String {
            std::env::var("HOME").unwrap_or_default()
        }
        fn get_storage(&self) -> PResult<StorageInfo> {
            Ok(StorageInfo { total_bytes: 0, used_bytes: 0, free_bytes: 0, volume: "/".into() })
        }
        fn scan_categories(&self) -> PResult<Vec<CleanupCategory>> {
            Ok(Vec::new())
        }
        fn allowed_roots_for(&self, _category_id: &str) -> Vec<String> {
            Vec::new()
        }
        fn list_items(&self, _category_id: &str) -> PResult<Vec<CleanupItem>> {
            Ok(Vec::new())
        }
        fn empty_trash(&self) -> PResult<EmptyTrashResult> {
            Ok(EmptyTrashResult { reclaimed_bytes: 0, removed_count: 0 })
        }
    }
    impl IconProvider for Noop {
        fn get_icon(&self, _path: Option<&str>, _bundle_id: Option<&str>) -> Option<String> {
            None
        }
    }
    PlatformServices { discovery: Box::new(Noop), terminator: Box::new(Noop), storage: Box::new(Noop), icons: Box::new(Noop) }
}
