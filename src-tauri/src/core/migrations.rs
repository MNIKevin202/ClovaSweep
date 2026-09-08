//! Persistence schema + migrations.
//!
//! The on-disk store is a single JSON document. All reads go through these
//! pure migration/validation functions so a corrupt, partial, or older file
//! can never crash ClovaSweep — it is repaired into a valid, current-version
//! state.
//!
//! Pure module — fully unit-testable.

use crate::types::{ProtectedApp, Settings, SweepAppOutcome, SweepAppResult, SweepRecord, ThemePreference, UnresponsiveBehavior, SETTINGS_SCHEMA_VERSION};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Top-level persisted store version (bump + migrate when the shape changes).
pub const STORE_VERSION: u32 = 1;
/// Maximum number of sweep records retained for history/analytics.
pub const MAX_SWEEP_HISTORY: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPrefs {
    pub disabled_smart_categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedState {
    pub version: u32,
    pub settings: Settings,
    pub protected_apps: Vec<ProtectedApp>,
    pub sweeps: Vec<SweepRecord>,
    pub cleanup: CleanupPrefs,
}

impl Default for PersistedState {
    fn default() -> Self {
        PersistedState {
            version: STORE_VERSION,
            settings: Settings::default(),
            protected_apps: Vec::new(),
            sweeps: Vec::new(),
            cleanup: CleanupPrefs::default(),
        }
    }
}

fn as_bool(v: Option<&Value>, fallback: bool) -> bool {
    v.and_then(Value::as_bool).unwrap_or(fallback)
}

fn as_clamped_u64(v: Option<&Value>, fallback: u64, min: u64, max: u64) -> u64 {
    let n = v.and_then(Value::as_u64).unwrap_or(fallback);
    n.clamp(min, max)
}

fn as_theme(v: Option<&Value>, fallback: ThemePreference) -> ThemePreference {
    match v.and_then(Value::as_str) {
        Some("system") => ThemePreference::System,
        Some("light") => ThemePreference::Light,
        Some("dark") => ThemePreference::Dark,
        _ => fallback,
    }
}

fn as_unresponsive(v: Option<&Value>, fallback: UnresponsiveBehavior) -> UnresponsiveBehavior {
    match v.and_then(Value::as_str) {
        Some("skip") => UnresponsiveBehavior::Skip,
        Some("force") => UnresponsiveBehavior::Force,
        _ => fallback,
    }
}

/// Validate & migrate an arbitrary JSON value into a complete Settings.
pub fn migrate_settings(raw: &Value) -> Settings {
    let d = Settings::default();
    let obj = raw.as_object();
    let get = |k: &str| obj.and_then(|o| o.get(k));

    Settings {
        launch_at_login: as_bool(get("launchAtLogin"), d.launch_at_login),
        start_minimized: as_bool(get("startMinimized"), d.start_minimized),
        show_notification_after_sweep: as_bool(get("showNotificationAfterSweep"), d.show_notification_after_sweep),
        confirm_before_sweep: as_bool(get("confirmBeforeSweep"), d.confirm_before_sweep),
        click_opens_dashboard: as_bool(get("clickOpensDashboard"), d.click_opens_dashboard),
        close_user_apps: as_bool(get("closeUserApps"), d.close_user_apps),
        close_finder_windows: as_bool(get("closeFinderWindows"), d.close_finder_windows),
        close_explorer_windows: as_bool(get("closeExplorerWindows"), d.close_explorer_windows),
        graceful_timeout_ms: as_clamped_u64(get("gracefulTimeoutMs"), d.graceful_timeout_ms, 500, 60000),
        unresponsive_behavior: as_unresponsive(get("unresponsiveBehavior"), d.unresponsive_behavior),
        theme: as_theme(get("theme"), d.theme),
        schema_version: SETTINGS_SCHEMA_VERSION,
    }
}

fn migrate_protected_apps(raw: &Value) -> Vec<ProtectedApp> {
    let Some(arr) = raw.as_array() else { return Vec::new() };
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for item in arr {
        let Some(obj) = item.as_object() else { continue };
        let Some(id) = obj.get("id").and_then(Value::as_str) else { continue };
        let Some(name) = obj.get("name").and_then(Value::as_str) else { continue };
        if !seen.insert(id.to_string()) {
            continue;
        }
        out.push(ProtectedApp {
            id: id.to_string(),
            name: name.to_string(),
            bundle_id: obj.get("bundleId").and_then(Value::as_str).map(String::from),
            path: obj.get("path").and_then(Value::as_str).map(String::from),
            package_id: obj.get("packageId").and_then(Value::as_str).map(String::from),
            added_at: obj.get("addedAt").and_then(Value::as_str).map(String::from).unwrap_or_else(|| Utc::now().to_rfc3339()),
        });
    }
    out
}

fn migrate_sweeps(raw: &Value) -> Vec<SweepRecord> {
    let Some(arr) = raw.as_array() else { return Vec::new() };
    let mut out = Vec::new();
    for item in arr {
        let Some(obj) = item.as_object() else { continue };
        let Some(id) = obj.get("id").and_then(Value::as_str) else { continue };
        let Some(timestamp) = obj.get("timestamp").and_then(Value::as_str) else { continue };
        let results = obj
            .get("results")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|r| {
                        let ro = r.as_object()?;
                        let id = ro.get("id")?.as_str()?.to_string();
                        let name = ro.get("name")?.as_str()?.to_string();
                        let outcome = match ro.get("outcome").and_then(Value::as_str) {
                            Some("closed") => SweepAppOutcome::Closed,
                            Some("failed") => SweepAppOutcome::Failed,
                            Some("timeout") => SweepAppOutcome::Timeout,
                            Some("skipped") => SweepAppOutcome::Skipped,
                            _ => SweepAppOutcome::Closed,
                        };
                        Some(SweepAppResult {
                            id,
                            name,
                            bundle_id: ro.get("bundleId").and_then(Value::as_str).map(String::from),
                            path: ro.get("path").and_then(Value::as_str).map(String::from),
                            outcome,
                            detail: ro.get("detail").and_then(Value::as_str).map(String::from),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        out.push(SweepRecord {
            id: id.to_string(),
            timestamp: timestamp.to_string(),
            duration_ms: obj.get("durationMs").and_then(Value::as_i64).unwrap_or(0),
            closed_count: obj.get("closedCount").and_then(Value::as_u64).unwrap_or(0) as usize,
            dry_run: as_bool(obj.get("dryRun"), false),
            results,
        });
    }
    out.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    out.truncate(MAX_SWEEP_HISTORY);
    out
}

fn migrate_cleanup(raw: &Value) -> CleanupPrefs {
    let disabled = raw
        .as_object()
        .and_then(|o| o.get("disabledSmartCategories"))
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    CleanupPrefs { disabled_smart_categories: disabled }
}

/// Migrate an arbitrary parsed JSON value into a valid, current
/// PersistedState. Never panics.
pub fn migrate_state(raw: &Value) -> PersistedState {
    let obj = raw.as_object();
    let get = |k: &str| obj.and_then(|o| o.get(k)).cloned().unwrap_or(Value::Null);

    PersistedState {
        version: STORE_VERSION,
        settings: migrate_settings(&get("settings")),
        protected_apps: migrate_protected_apps(&get("protectedApps")),
        sweeps: migrate_sweeps(&get("sweeps")),
        cleanup: migrate_cleanup(&get("cleanup")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn garbage_input_yields_defaults() {
        assert_eq!(migrate_settings(&Value::Null), Settings::default());
        assert_eq!(migrate_settings(&json!("nope")), Settings::default());
        assert_eq!(migrate_settings(&json!(42)), Settings::default());
    }

    #[test]
    fn preserves_valid_values_fills_gaps() {
        let s = migrate_settings(&json!({ "theme": "dark", "confirmBeforeSweep": true }));
        assert_eq!(s.theme, ThemePreference::Dark);
        assert!(s.confirm_before_sweep);
        assert_eq!(s.close_user_apps, Settings::default().close_user_apps);
        assert_eq!(s.schema_version, SETTINGS_SCHEMA_VERSION);
    }

    #[test]
    fn rejects_invalid_enums_and_clamps_numbers() {
        let s = migrate_settings(&json!({ "theme": "purple", "unresponsiveBehavior": "nuke", "gracefulTimeoutMs": 9_000_000u64 }));
        assert_eq!(s.theme, ThemePreference::System);
        assert_eq!(s.unresponsive_behavior, UnresponsiveBehavior::Skip);
        assert_eq!(s.graceful_timeout_ms, 60000);
    }

    #[test]
    fn clamps_too_small_timeout_up() {
        assert_eq!(migrate_settings(&json!({ "gracefulTimeoutMs": 1 })).graceful_timeout_ms, 500);
    }

    #[test]
    fn empty_state_from_nothing() {
        let s = migrate_state(&Value::Null);
        assert_eq!(s.version, STORE_VERSION);
        assert!(s.protected_apps.is_empty());
        assert!(s.sweeps.is_empty());
    }

    #[test]
    fn dedupes_protected_apps_and_drops_invalid() {
        let s = migrate_state(&json!({
            "protectedApps": [
                { "id": "bundle:a", "name": "A", "addedAt": "2026-01-01T00:00:00Z" },
                { "id": "bundle:a", "name": "A dup" },
                { "id": "bundle:b", "name": "B" },
                { "name": "no id" },
                null
            ]
        }));
        let ids: Vec<&str> = s.protected_apps.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["bundle:a", "bundle:b"]);
        assert!(!s.protected_apps[1].added_at.is_empty());
    }

    #[test]
    fn keeps_sweeps_newest_first_and_drops_malformed_results() {
        let s = migrate_state(&json!({
            "sweeps": [
                { "id": "old", "timestamp": "2026-01-01T00:00:00Z", "closedCount": 1, "results": [{ "id": "x", "name": "X", "outcome": "closed" }] },
                { "id": "new", "timestamp": "2026-06-01T00:00:00Z", "closedCount": 2, "results": [{ "bad": true }] },
                { "missing": "fields" }
            ]
        }));
        let ids: Vec<&str> = s.sweeps.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["new", "old"]);
        assert!(s.sweeps[0].results.is_empty());
    }

    #[test]
    fn round_trips_a_valid_state() {
        let mut original = PersistedState::default();
        original.settings.theme = ThemePreference::Dark;
        original.protected_apps.push(ProtectedApp {
            id: "bundle:z".into(),
            name: "Z".into(),
            bundle_id: None,
            path: None,
            package_id: None,
            added_at: "2026-01-01T00:00:00Z".into(),
        });
        let json_val = serde_json::to_value(&original).unwrap();
        let migrated = migrate_state(&json_val);
        assert_eq!(migrated.settings.theme, ThemePreference::Dark);
        assert_eq!(migrated.protected_apps.len(), 1);
        assert_eq!(migrated.protected_apps[0].id, "bundle:z");
    }
}
