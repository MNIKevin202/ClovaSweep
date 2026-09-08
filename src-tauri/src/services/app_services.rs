//! Application services facade.
//!
//! The single high-level API the Tauri commands talk to. It ties together
//! the persistent store, the platform abstraction, the pure filter/analytics
//! and the sweep executor, and is the only place cleanup deletions happen
//! (always gated by the tested `cleanup_safety` guards).

use crate::core::analytics::{aggregate_analytics, AggregateOptions};
use crate::core::cleanup_safety::{can_delete_path, filter_deletable, DeleteGuardContext};
use crate::core::filter::{build_preview, classify_apps, ClassifyInput};
use crate::core::identity::{derive_app_id, normalize_running_apps, to_app_identity};
use crate::core::migrations::CleanupPrefs;
use crate::platform::fsutil::size_of_path;
use crate::platform::PlatformServices;
use crate::services::store::Store;
use crate::types::{
    AnalyticsSummary, AppIdentity, CleanupFailure, CleanupItem, CleanupResult, CleanupScan, OverviewSnapshot, Platform,
    ProtectedApp, RunningApp, Settings, SweepPreview, SweepResult,
};
use chrono::Utc;
use std::collections::HashSet;

pub struct AppServicesOptions {
    pub self_bundle_id: Option<String>,
    pub self_name: Option<String>,
    pub own_pids: HashSet<u32>,
    pub platform: Platform,
}

pub struct AppServices {
    store: Store,
    platform: PlatformServices,
    platform_name: Platform,
    self_ids: HashSet<String>,
    own_pids: HashSet<u32>,
}

impl AppServices {
    pub fn new(store: Store, platform: PlatformServices, opts: AppServicesOptions) -> Self {
        let mut self_ids: HashSet<String> = HashSet::from(["bundle:com.clova.clovasweep".to_string(), "name:clovasweep".to_string()]);
        if let Some(b) = opts.self_bundle_id {
            self_ids.insert(format!("bundle:{}", b.to_lowercase()));
        }
        if let Some(n) = opts.self_name {
            self_ids.insert(format!("name:{}", n.to_lowercase()));
        }
        AppServices { store, platform, platform_name: opts.platform, self_ids, own_pids: opts.own_pids }
    }

    fn protected_sets(&self) -> (HashSet<String>, HashSet<String>) {
        let mut ids = HashSet::new();
        let mut secondary = HashSet::new();
        for p in self.store.get_protected() {
            ids.insert(p.id.clone());
            if let Some(b) = &p.bundle_id {
                secondary.insert(format!("bundle:{}", b.to_lowercase()));
            }
            if let Some(path) = &p.path {
                secondary.insert(format!("path:{path}"));
            }
        }
        (ids, secondary)
    }

    fn classify(&self) -> (Vec<RunningApp>, HashSet<String>, HashSet<String>, crate::core::filter::Classification) {
        let raw = self.platform.discovery.list().unwrap_or_default();
        let mut apps = normalize_running_apps(raw, self.platform_name);
        apps.retain(|a| !a.pids.iter().any(|p| self.own_pids.contains(p)));
        let (protected_ids, protected_secondary) = self.protected_sets();
        let settings = self.store.get_settings();
        let classification = classify_apps(ClassifyInput {
            apps: apps.clone(),
            protected_ids: &protected_ids,
            protected_secondary: &protected_secondary,
            self_ids: &self.self_ids,
            settings: &settings,
            platform: self.platform_name,
        });
        (apps, protected_ids, protected_secondary, classification)
    }

    pub fn list_running_apps(&self) -> Vec<RunningApp> {
        let (_, _, _, c) = self.classify();
        let mut all: Vec<RunningApp> = c
            .would_close
            .into_iter()
            .chain(c.protected_running)
            .chain(c.system_excluded.into_iter().filter(|a| !a.is_self))
            .collect();
        all.sort_by_key(|a| a.name.to_lowercase());
        all
    }

    pub fn get_sweep_preview(&self) -> SweepPreview {
        let (apps, protected_ids, protected_secondary, _) = self.classify();
        let settings = self.store.get_settings();
        build_preview(ClassifyInput {
            apps,
            protected_ids: &protected_ids,
            protected_secondary: &protected_secondary,
            self_ids: &self.self_ids,
            settings: &settings,
            platform: self.platform_name,
        })
    }

    pub fn sweep(&self, dry_run: bool) -> SweepResult {
        let (protected_ids, protected_secondary) = self.protected_sets();
        let settings = self.store.get_settings();
        let result = crate::services::sweep_service::execute_sweep(crate::services::sweep_service::SweepDeps {
            discovery: self.platform.discovery.as_ref(),
            terminator: self.platform.terminator.as_ref(),
            settings: &settings,
            protected_ids: &protected_ids,
            protected_secondary: &protected_secondary,
            self_ids: &self.self_ids,
            platform: self.platform_name,
            own_pids: &self.own_pids,
            dry_run,
            sleep_fn: None,
        });
        if !result.record.dry_run {
            self.store.add_sweep(result.record.clone());
        }
        result
    }

    pub fn get_protected_apps(&self) -> Vec<ProtectedApp> {
        self.store.get_protected()
    }

    pub fn protect_app(&self, identity: AppIdentity) -> Vec<ProtectedApp> {
        let resolved = to_app_identity(identity.clone(), self.platform_name);
        let id = if resolved.id.is_empty() {
            derive_app_id(&identity.name, identity.bundle_id.as_deref(), identity.path.as_deref(), identity.package_id.as_deref(), self.platform_name)
        } else {
            resolved.id
        };
        self.store.add_protected(ProtectedApp {
            id,
            name: resolved.name,
            bundle_id: resolved.bundle_id,
            path: resolved.path,
            package_id: resolved.package_id,
            added_at: Utc::now().to_rfc3339(),
        })
    }

    pub fn unprotect_app(&self, id: &str) -> Vec<ProtectedApp> {
        self.store.remove_protected(id)
    }

    pub fn get_app_icon(&self, path: Option<&str>, bundle_id: Option<&str>) -> Option<String> {
        self.platform.icons.get_icon(path, bundle_id)
    }

    pub fn get_settings(&self) -> Settings {
        self.store.get_settings()
    }

    pub fn update_settings(&self, patch: serde_json::Value) -> Settings {
        self.store.update_settings(patch)
    }

    pub fn get_analytics(&self) -> AnalyticsSummary {
        aggregate_analytics(&self.store.get_sweeps(), AggregateOptions::default())
    }

    pub fn reset_analytics(&self) -> AnalyticsSummary {
        self.store.clear_sweeps();
        aggregate_analytics(&self.store.get_sweeps(), AggregateOptions::default())
    }

    pub fn get_overview(&self) -> OverviewSnapshot {
        let (apps, protected_ids, protected_secondary, _) = self.classify();
        let settings = self.store.get_settings();
        let preview = build_preview(ClassifyInput {
            apps,
            protected_ids: &protected_ids,
            protected_secondary: &protected_secondary,
            self_ids: &self.self_ids,
            settings: &settings,
            platform: self.platform_name,
        });
        let analytics = self.get_analytics();
        let storage = self.platform.storage.get_storage().ok();
        let protected_running_count = preview.protected_running.len();
        OverviewSnapshot {
            running_count: preview.would_close.len() + protected_running_count + preview.system_excluded.len(),
            protected_running_count,
            would_close_count: preview.would_close.len(),
            preview,
            last_sweep_at: analytics.last_sweep_at.clone(),
            last_sweep_closed: analytics.last_sweep_closed,
            analytics,
            storage,
            settings,
            platform: self.platform_name,
        }
    }

    pub fn scan_cleanup(&self) -> CleanupScan {
        let storage = self.platform.storage.get_storage().unwrap_or(crate::types::StorageInfo { total_bytes: 0, used_bytes: 0, free_bytes: 0, volume: "?".into() });
        let categories = self.platform.storage.scan_categories().unwrap_or_default();
        CleanupScan {
            storage,
            categories,
            disabled_smart_categories: self.store.get_cleanup_prefs().disabled_smart_categories,
            scanned_at: Utc::now().to_rfc3339(),
        }
    }

    pub fn list_cleanup_items(&self, category_id: &str) -> Vec<CleanupItem> {
        self.platform.storage.list_items(category_id).unwrap_or_default()
    }

    /// Review cleanup: move the selected items to the Trash/Recycle Bin
    /// (reversible), gated by the tested deletion safety guard.
    pub fn run_cleanup(&self, category_id: &str, paths: Vec<String>) -> CleanupResult {
        let roots = self.platform.storage.allowed_roots_for(category_id);
        let home = self.platform.storage.home();
        let ctx = DeleteGuardContext { allowed_roots: &roots, home: &home, platform: self.platform_name };
        let filtered = filter_deletable(&paths, &ctx);

        let mut result = CleanupResult {
            reclaimed_bytes: 0,
            removed_count: 0,
            failed: filtered.rejected.into_iter().map(|p| CleanupFailure { path: p, reason: "Outside the allowed cleanup area".into() }).collect(),
        };
        for p in filtered.safe {
            let size = size_of_path(&p);
            match trash::delete(&p) {
                Ok(()) => {
                    result.reclaimed_bytes += size;
                    result.removed_count += 1;
                }
                Err(e) => result.failed.push(CleanupFailure { path: p, reason: e.to_string() }),
            }
        }
        result
    }

    /// Smart cleanup: clear rebuildable safe categories and empty the OS bin.
    pub fn run_smart_cleanup(&self) -> CleanupResult {
        let prefs = self.store.get_cleanup_prefs();
        let disabled: HashSet<String> = prefs.disabled_smart_categories.into_iter().collect();
        let categories = self.platform.storage.scan_categories().unwrap_or_default();
        let home = self.platform.storage.home();
        let mut result = CleanupResult::default();

        for cat in categories {
            if !cat.smart_eligible || disabled.contains(&cat.id) || cat.unavailable {
                continue;
            }
            match cat.risk {
                crate::types::CleanupRisk::System => match self.platform.storage.empty_trash() {
                    Ok(r) => {
                        result.reclaimed_bytes += r.reclaimed_bytes;
                        result.removed_count += r.removed_count;
                    }
                    Err(e) => result.failed.push(CleanupFailure { path: cat.title, reason: e.to_string() }),
                },
                crate::types::CleanupRisk::Safe => {
                    let roots = self.platform.storage.allowed_roots_for(&cat.id);
                    let items = self.platform.storage.list_items(&cat.id).unwrap_or_default();
                    let ctx = DeleteGuardContext { allowed_roots: &roots, home: &home, platform: self.platform_name };
                    for item in items {
                        if !can_delete_path(&item.path, &ctx) {
                            result.failed.push(CleanupFailure { path: item.path, reason: "Blocked by safety guard".into() });
                            continue;
                        }
                        let remove_result = if item.is_directory { std::fs::remove_dir_all(&item.path) } else { std::fs::remove_file(&item.path) };
                        match remove_result {
                            Ok(()) => {
                                result.reclaimed_bytes += item.size_bytes;
                                result.removed_count += 1;
                            }
                            Err(e) => result.failed.push(CleanupFailure { path: item.path, reason: e.to_string() }),
                        }
                    }
                }
                crate::types::CleanupRisk::Review => {}
            }
        }
        result
    }

    pub fn empty_trash(&self) -> CleanupResult {
        match self.platform.storage.empty_trash() {
            Ok(r) => CleanupResult { reclaimed_bytes: r.reclaimed_bytes, removed_count: r.removed_count, failed: Vec::new() },
            Err(e) => CleanupResult { reclaimed_bytes: 0, removed_count: 0, failed: vec![CleanupFailure { path: "trash".into(), reason: e.to_string() }] },
        }
    }

    pub fn get_cleanup_prefs(&self) -> CleanupPrefs {
        self.store.get_cleanup_prefs()
    }

    pub fn set_smart_category_enabled(&self, category_id: &str, enabled: bool) -> CleanupPrefs {
        let prefs = self.store.get_cleanup_prefs();
        let mut set: HashSet<String> = prefs.disabled_smart_categories.into_iter().collect();
        if enabled {
            set.remove(category_id);
        } else {
            set.insert(category_id.to_string());
        }
        let next = CleanupPrefs { disabled_smart_categories: set.into_iter().collect() };
        self.store.set_cleanup_prefs(next.clone());
        next
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::{ApplicationDiscovery, ApplicationTerminator, EmptyTrashResult, IconProvider, PResult, StorageProvider};
    use crate::types::{CleanupCategory, CleanupRisk, RawApp, StorageInfo};
    use std::collections::HashMap;
    use std::fs;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    /// Running-apps map shared between the fake discovery and terminator, so
    /// a `request_quit` call is actually observable on the next `list()`.
    struct Shared(Mutex<HashMap<u32, RawApp>>);

    struct FakeDiscovery(Arc<Shared>);
    impl ApplicationDiscovery for FakeDiscovery {
        fn list(&self) -> PResult<Vec<RawApp>> {
            Ok(self.0 .0.lock().unwrap().values().cloned().collect())
        }
    }

    struct FakeTerminator(Arc<Shared>);
    impl ApplicationTerminator for FakeTerminator {
        fn request_quit(&self, app: &RunningApp) {
            let mut running = self.0 .0.lock().unwrap();
            for pid in &app.pids {
                running.remove(pid);
            }
        }
        fn force_quit(&self, _app: &RunningApp) {}
        fn close_file_manager_windows(&self) {}
    }

    struct FakeStorage {
        home: String,
        categories: Vec<CleanupCategory>,
        empty_trash_calls: Mutex<u32>,
    }
    impl StorageProvider for FakeStorage {
        fn volume(&self) -> String {
            "/".into()
        }
        fn home(&self) -> String {
            self.home.clone()
        }
        fn get_storage(&self) -> PResult<StorageInfo> {
            Ok(StorageInfo { total_bytes: 1000, used_bytes: 400, free_bytes: 600, volume: "Test".into() })
        }
        fn allowed_roots_for(&self, category_id: &str) -> Vec<String> {
            match category_id {
                "safe" => vec![format!("{}/safe", self.home)],
                "downloads" => vec![format!("{}/downloads", self.home)],
                _ => Vec::new(),
            }
        }
        fn scan_categories(&self) -> PResult<Vec<CleanupCategory>> {
            Ok(self.categories.clone())
        }
        fn list_items(&self, category_id: &str) -> PResult<Vec<CleanupItem>> {
            if category_id != "safe" {
                return Ok(Vec::new());
            }
            let dir = format!("{}/safe", self.home);
            let items = fs::read_dir(&dir)
                .map(|it| {
                    it.flatten()
                        .map(|e| CleanupItem {
                            path: e.path().to_string_lossy().to_string(),
                            name: e.file_name().to_string_lossy().to_string(),
                            size_bytes: e.metadata().map(|m| m.len()).unwrap_or(0),
                            is_directory: false,
                            modified_at: None,
                            category_id: category_id.to_string(),
                        })
                        .collect()
                })
                .unwrap_or_default();
            Ok(items)
        }
        fn empty_trash(&self) -> PResult<EmptyTrashResult> {
            *self.empty_trash_calls.lock().unwrap() += 1;
            Ok(EmptyTrashResult { reclaimed_bytes: 1000, removed_count: 2 })
        }
    }

    struct FakeIcons;
    impl IconProvider for FakeIcons {
        fn get_icon(&self, _path: Option<&str>, _bundle_id: Option<&str>) -> Option<String> {
            None
        }
    }

    fn raw(name: &str, pid: u32, bundle_id: Option<&str>, is_fm: bool) -> RawApp {
        RawApp { name: name.into(), pid, bundle_id: bundle_id.map(String::from), path: None, package_id: None, is_file_manager: is_fm }
    }

    /// Build an AppServices wired to fakes, plus the backing tempdir (kept
    /// alive by the caller for the duration of the test) and store file path.
    ///
    /// `platform` must match the convention of `home` and any paths derived
    /// from it: `Platform::Darwin` for the synthetic macOS-style fixture
    /// paths used by the classification tests below (which never touch the
    /// real filesystem), or `Platform::current()` for tests that use a real
    /// `tempdir()` path (whose separators follow the actual host OS).
    fn build(apps: Vec<RawApp>, home: &str, categories: Vec<CleanupCategory>, platform: Platform) -> (AppServices, tempfile::TempDir, std::path::PathBuf) {
        let dir = tempdir().unwrap();
        let store_file = dir.path().join("state.json");
        let shared = Arc::new(Shared(Mutex::new(apps.into_iter().map(|a| (a.pid, a)).collect())));
        let platform_services = PlatformServices {
            discovery: Box::new(FakeDiscovery(shared.clone())),
            terminator: Box::new(FakeTerminator(shared)),
            storage: Box::new(FakeStorage { home: home.to_string(), categories, empty_trash_calls: Mutex::new(0) }),
            icons: Box::new(FakeIcons),
        };
        let store = Store::new(store_file.clone());
        let opts = AppServicesOptions { self_bundle_id: None, self_name: Some("ClovaSweep".into()), own_pids: HashSet::new(), platform };
        (AppServices::new(store, platform_services, opts), dir, store_file)
    }

    const APPS_FIXTURE: fn() -> Vec<RawApp> = || {
        vec![
            raw("Spotify", 1, Some("com.spotify.client"), false),
            raw("Slack", 2, Some("com.slack.Slack"), false),
            raw("Finder", 3, Some("com.apple.finder"), true),
        ]
    };

    #[test]
    fn protects_an_app_persists_and_annotates_running_list() {
        let (svc, _dir, store_file) = build(APPS_FIXTURE(), "/tmp/does-not-matter", vec![], Platform::Darwin);
        svc.protect_app(AppIdentity { id: String::new(), name: "Slack".into(), bundle_id: Some("com.slack.Slack".into()), path: None, package_id: None });
        assert!(svc.get_protected_apps().iter().any(|p| p.id == "bundle:com.slack.slack"));

        // Survives a fresh Store instance (persistence).
        let reloaded = Store::new(store_file);
        assert!(reloaded.get_protected().iter().any(|p| p.id == "bundle:com.slack.slack"));

        let list = svc.list_running_apps();
        assert!(list.iter().find(|a| a.name == "Slack").unwrap().protected);
        assert!(list.iter().find(|a| a.name == "Finder").unwrap().system);
    }

    #[test]
    fn sweeps_non_protected_apps_records_sweep_updates_analytics() {
        let (svc, _dir, _file) = build(APPS_FIXTURE(), "/tmp/x", vec![], Platform::Darwin);
        svc.update_settings(serde_json::json!({ "gracefulTimeoutMs": 500 }));
        svc.protect_app(AppIdentity { id: String::new(), name: "Slack".into(), bundle_id: Some("com.slack.Slack".into()), path: None, package_id: None });

        let result = svc.sweep(false);
        assert_eq!(result.record.results.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), vec!["Spotify"]);
        assert_eq!(result.record.closed_count, 1);

        let analytics = svc.get_analytics();
        assert_eq!(analytics.total_sweeps, 1);
        assert_eq!(analytics.total_apps_closed, 1);
        assert_eq!(analytics.most_closed[0].name, "Spotify");

        // A dry run does not add to history.
        svc.sweep(true);
        assert_eq!(svc.get_analytics().total_sweeps, 1);
    }

    #[test]
    fn run_cleanup_only_trashes_paths_inside_allowed_root() {
        let dir = tempdir().unwrap();
        let home = dir.path().to_string_lossy().to_string();
        fs::create_dir_all(format!("{home}/downloads")).unwrap();
        let inside = format!("{home}/downloads/old.txt");
        let outside = format!("{home}/secret.txt");
        fs::write(&inside, "x").unwrap();
        fs::write(&outside, "y").unwrap();

        let (svc, _store_dir, _file) = build(APPS_FIXTURE(), &home, vec![], Platform::current());
        let res = svc.run_cleanup("downloads", vec![inside.clone(), outside.clone()]);
        assert_eq!(res.removed_count, 1);
        assert!(!std::path::Path::new(&inside).exists(), "allowed file should be trashed");
        assert!(std::path::Path::new(&outside).exists(), "disallowed file must survive");
        assert!(res.failed.iter().any(|f| f.path == outside));
    }

    #[test]
    fn run_smart_cleanup_clears_safe_categories_and_empties_bin() {
        let dir = tempdir().unwrap();
        let home = dir.path().to_string_lossy().to_string();
        fs::create_dir_all(format!("{home}/safe")).unwrap();
        fs::write(format!("{home}/safe/a.tmp"), "aaaa").unwrap();
        fs::write(format!("{home}/safe/b.tmp"), "bbbb").unwrap();

        let categories = vec![
            CleanupCategory { id: "bin".into(), title: "Trash".into(), description: String::new(), risk: CleanupRisk::System, smart_eligible: true, size_bytes: 1000, item_count: 2, unavailable: false, detail: None },
            CleanupCategory { id: "safe".into(), title: "Caches".into(), description: String::new(), risk: CleanupRisk::Safe, smart_eligible: true, size_bytes: 8, item_count: 2, unavailable: false, detail: None },
        ];
        let (svc, _store_dir, _file) = build(APPS_FIXTURE(), &home, categories, Platform::current());

        let res = svc.run_smart_cleanup();
        assert!(!std::path::Path::new(&format!("{home}/safe/a.tmp")).exists());
        assert!(!std::path::Path::new(&format!("{home}/safe/b.tmp")).exists());
        assert_eq!(res.removed_count, 4); // 2 from bin (fake) + 2 safe files
    }

    #[test]
    fn respects_disabled_smart_categories() {
        let dir = tempdir().unwrap();
        let home = dir.path().to_string_lossy().to_string();
        fs::create_dir_all(format!("{home}/safe")).unwrap();
        fs::write(format!("{home}/safe/a.tmp"), "aaaa").unwrap();

        let categories = vec![CleanupCategory { id: "safe".into(), title: "Caches".into(), description: String::new(), risk: CleanupRisk::Safe, smart_eligible: true, size_bytes: 4, item_count: 1, unavailable: false, detail: None }];
        let (svc, _store_dir, _file) = build(APPS_FIXTURE(), &home, categories, Platform::current());

        svc.set_smart_category_enabled("safe", false);
        let res = svc.run_smart_cleanup();
        assert_eq!(res.removed_count, 0);
        assert!(std::path::Path::new(&format!("{home}/safe/a.tmp")).exists());
    }
}
