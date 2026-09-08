//! Data types shared across the Rust backend and (via serde/JSON over the
//! Tauri IPC bridge) the React frontend. Field names are camelCase on the
//! wire to match `src/shared/types.ts` exactly, so the frontend requires no
//! changes when talking to this backend instead of the old Electron one.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Darwin,
    Win32,
    Linux,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            Platform::Darwin
        } else if cfg!(target_os = "windows") {
            Platform::Win32
        } else {
            Platform::Linux
        }
    }
}

/// A running, user-facing application as ClovaSweep understands it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunningApp {
    pub id: String,
    pub name: String,
    pub pids: Vec<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_id: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_file_manager: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub protected: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub system: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_self: bool,
}

/// The durable identity of an application, independent of a single run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppIdentity {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_id: Option<String>,
}

/// A user-protected application, persisted between launches.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedApp {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_id: Option<String>,
    pub added_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SweepAppOutcome {
    Closed,
    Failed,
    Timeout,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SweepAppResult {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub outcome: SweepAppOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SweepRecord {
    pub id: String,
    pub timestamp: String,
    pub duration_ms: i64,
    pub closed_count: usize,
    pub results: Vec<SweepAppResult>,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepResult {
    pub record: SweepRecord,
    pub protected_skipped: usize,
    pub system_skipped: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SweepPreview {
    pub would_close: Vec<RunningApp>,
    pub protected_running: Vec<RunningApp>,
    pub system_excluded: Vec<RunningApp>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UnresponsiveBehavior {
    Skip,
    Force,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub launch_at_login: bool,
    pub start_minimized: bool,
    pub show_notification_after_sweep: bool,
    pub confirm_before_sweep: bool,
    pub click_opens_dashboard: bool,

    pub close_user_apps: bool,
    pub close_finder_windows: bool,
    pub close_explorer_windows: bool,
    pub graceful_timeout_ms: u64,
    pub unresponsive_behavior: UnresponsiveBehavior,

    pub theme: ThemePreference,

    pub schema_version: u32,
}

pub const SETTINGS_SCHEMA_VERSION: u32 = 1;

impl Default for Settings {
    fn default() -> Self {
        Settings {
            launch_at_login: false,
            start_minimized: true,
            show_notification_after_sweep: true,
            confirm_before_sweep: false,
            click_opens_dashboard: false,
            close_user_apps: true,
            close_finder_windows: false,
            close_explorer_windows: false,
            graceful_timeout_ms: 4000,
            unresponsive_behavior: UnresponsiveBehavior::Skip,
            theme: ThemePreference::System,
            schema_version: SETTINGS_SCHEMA_VERSION,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppCloseStat {
    pub id: String,
    pub name: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsSummary {
    pub total_sweeps: usize,
    pub total_apps_closed: usize,
    pub average_per_sweep: f64,
    pub unique_apps_closed: usize,
    pub most_closed: Vec<AppCloseStat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sweep_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sweep_closed: Option<usize>,
    pub estimated_clutter_reduced: usize,
    pub recent: Vec<SweepRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub free_bytes: u64,
    pub volume: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CleanupRisk {
    Safe,
    Review,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupCategory {
    pub id: String,
    pub title: String,
    pub description: String,
    pub risk: CleanupRisk,
    pub smart_eligible: bool,
    pub size_bytes: u64,
    pub item_count: usize,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unavailable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupItem {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
    pub is_directory: bool,
    pub category_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupScan {
    pub storage: StorageInfo,
    pub categories: Vec<CleanupCategory>,
    pub disabled_smart_categories: Vec<String>,
    pub scanned_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CleanupFailure {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub reclaimed_bytes: u64,
    pub removed_count: usize,
    pub failed: Vec<CleanupFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewSnapshot {
    pub running_count: usize,
    pub protected_running_count: usize,
    pub would_close_count: usize,
    pub preview: SweepPreview,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sweep_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sweep_closed: Option<usize>,
    pub analytics: AnalyticsSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage: Option<StorageInfo>,
    pub settings: Settings,
    pub platform: Platform,
}

/// A raw discovery entry before de-duplication (platform layer -> core).
#[derive(Debug, Clone)]
pub struct RawApp {
    pub name: String,
    pub pid: u32,
    pub bundle_id: Option<String>,
    pub path: Option<String>,
    pub package_id: Option<String>,
    pub is_file_manager: bool,
}

/// Convenience: build a HashSet<String> from an iterator of &str/String.
pub fn set_of<I, S>(items: I) -> HashSet<String>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    items.into_iter().map(Into::into).collect()
}
