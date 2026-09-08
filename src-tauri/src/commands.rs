//! Tauri command surface. Every renderer-facing capability is a thin,
//! synchronous wrapper around `AppServices` — Tauri runs plain (non-async)
//! commands on a blocking-safe worker thread automatically, which is exactly
//! what the shell-heavy discovery/termination/storage calls need.

use crate::services::app_services::AppServices;
use crate::services::startup;
use crate::types::{AnalyticsSummary, AppIdentity, CleanupItem, CleanupResult, CleanupScan, OverviewSnapshot, Platform, ProtectedApp, RunningApp, Settings, SweepPreview, SweepResult};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
pub fn get_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn get_platform() -> Platform {
    Platform::current()
}

#[tauri::command]
pub fn list_running_apps(services: State<'_, AppServices>) -> Vec<RunningApp> {
    services.list_running_apps()
}

#[tauri::command]
pub fn get_sweep_preview(services: State<'_, AppServices>) -> SweepPreview {
    services.get_sweep_preview()
}

#[derive(Deserialize)]
pub struct SweepOptions {
    #[serde(default, rename = "dryRun")]
    pub dry_run: bool,
}

#[tauri::command]
pub fn sweep(app: AppHandle, services: State<'_, AppServices>, options: Option<SweepOptions>) -> SweepResult {
    let dry_run = options.map(|o| o.dry_run).unwrap_or(false);
    let result = services.sweep(dry_run);
    if !result.record.dry_run {
        let _ = app.emit("clova://sweep-complete", &result);
        let _ = app.emit("clova://data-changed", ());
    }
    result
}

#[tauri::command]
pub fn get_overview(services: State<'_, AppServices>) -> OverviewSnapshot {
    services.get_overview()
}

#[tauri::command]
pub fn get_protected_apps(services: State<'_, AppServices>) -> Vec<ProtectedApp> {
    services.get_protected_apps()
}

#[tauri::command]
pub fn protect_app(services: State<'_, AppServices>, app: AppIdentity) -> Vec<ProtectedApp> {
    services.protect_app(app)
}

#[tauri::command]
pub fn unprotect_app(services: State<'_, AppServices>, id: String) -> Vec<ProtectedApp> {
    services.unprotect_app(&id)
}

#[derive(Deserialize)]
pub struct AppIconRef {
    #[allow(dead_code)]
    pub id: String,
    pub path: Option<String>,
    #[serde(rename = "bundleId")]
    pub bundle_id: Option<String>,
}

#[tauri::command]
pub fn get_app_icon(services: State<'_, AppServices>, app: AppIconRef) -> Option<String> {
    services.get_app_icon(app.path.as_deref(), app.bundle_id.as_deref())
}

#[tauri::command]
pub fn get_settings(services: State<'_, AppServices>) -> Settings {
    services.get_settings()
}

#[tauri::command]
pub fn update_settings(app: AppHandle, services: State<'_, AppServices>, patch: serde_json::Value) -> Settings {
    let mut settings = services.update_settings(patch.clone());

    if patch.get("launchAtLogin").is_some() {
        let effective = startup::set_enabled(&app, settings.launch_at_login);
        if effective != settings.launch_at_login {
            settings = services.update_settings(serde_json::json!({ "launchAtLogin": effective }));
        }
    }
    if let Some(theme) = patch.get("theme") {
        apply_theme(&app, theme.as_str().unwrap_or("system"));
    }
    settings
}

pub fn apply_theme(app: &AppHandle, theme: &str) {
    let mode = match theme {
        "light" => Some(tauri::Theme::Light),
        "dark" => Some(tauri::Theme::Dark),
        _ => None,
    };
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_theme(mode);
    }
}

#[tauri::command]
pub fn get_analytics(services: State<'_, AppServices>) -> AnalyticsSummary {
    services.get_analytics()
}

#[tauri::command]
pub fn reset_analytics(services: State<'_, AppServices>) -> AnalyticsSummary {
    services.reset_analytics()
}

#[tauri::command]
pub fn scan_cleanup(services: State<'_, AppServices>) -> CleanupScan {
    services.scan_cleanup()
}

#[tauri::command]
pub fn list_cleanup_items(services: State<'_, AppServices>, category_id: String) -> Vec<CleanupItem> {
    services.list_cleanup_items(&category_id)
}

#[tauri::command]
pub fn run_smart_cleanup(services: State<'_, AppServices>) -> CleanupResult {
    services.run_smart_cleanup()
}

#[derive(Deserialize)]
pub struct RunCleanupPayload {
    #[serde(rename = "categoryId")]
    pub category_id: String,
    pub paths: Vec<String>,
}

#[tauri::command]
pub fn run_cleanup(services: State<'_, AppServices>, payload: RunCleanupPayload) -> CleanupResult {
    services.run_cleanup(&payload.category_id, payload.paths)
}

#[tauri::command]
pub fn empty_trash(services: State<'_, AppServices>) -> CleanupResult {
    services.empty_trash()
}

#[derive(Serialize)]
pub struct SmartCategoryPrefs {
    #[serde(rename = "disabledSmartCategories")]
    pub disabled_smart_categories: Vec<String>,
}

#[derive(Deserialize)]
pub struct SetSmartCategoryPayload {
    #[serde(rename = "categoryId")]
    pub category_id: String,
    pub enabled: bool,
}

#[tauri::command]
pub fn set_smart_category(services: State<'_, AppServices>, payload: SetSmartCategoryPayload) -> SmartCategoryPrefs {
    let prefs = services.set_smart_category_enabled(&payload.category_id, payload.enabled);
    SmartCategoryPrefs { disabled_smart_categories: prefs.disabled_smart_categories }
}

#[tauri::command]
pub fn open_dashboard(app: AppHandle, section: Option<String>) {
    crate::show_dashboard(&app, section.as_deref());
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    crate::quit(&app);
}
