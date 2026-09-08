//! Application identity.
//!
//! ClovaSweep must never rely on an app's *display name* for identity: two
//! different apps can share a name (e.g. two "ChatGPT" builds with bundle ids
//! `com.openai.chat` and `com.openai.codex`), and one app can appear under
//! several process instances. We derive a stable id from the most durable
//! platform identifier available, and merge running processes by that id.
//!
//! Pure module (no OS access) — fully unit-testable.

use crate::types::{AppIdentity, Platform, RawApp, RunningApp};
use std::collections::{HashMap, HashSet};

/// Normalise a filesystem path for comparison (Windows is case-insensitive).
pub fn normalize_path(p: Option<&str>, platform: Platform) -> Option<String> {
    let p = p?.trim();
    if p.is_empty() {
        return None;
    }
    // Strip a single trailing separator.
    let mut out = p.trim_end_matches(['\\', '/']).to_string();
    if out.is_empty() {
        out = p.to_string();
    }
    if platform == Platform::Win32 {
        out = out.replace('/', "\\").to_lowercase();
    }
    Some(out)
}

/// Derive the canonical, stable identity string for an application.
///
/// Priority:
///  - macOS:   bundle id  >  bundle path  >  name
///  - Windows: package family name  >  executable path  >  name
///  - other:   path  >  name
pub fn derive_app_id(
    name: &str,
    bundle_id: Option<&str>,
    path: Option<&str>,
    package_id: Option<&str>,
    platform: Platform,
) -> String {
    match platform {
        Platform::Darwin => {
            if let Some(b) = bundle_id.map(str::trim).filter(|s| !s.is_empty()) {
                return format!("bundle:{}", b.to_lowercase());
            }
            if let Some(p) = normalize_path(path, platform) {
                return format!("path:{p}");
            }
        }
        Platform::Win32 => {
            if let Some(pkg) = package_id.map(str::trim).filter(|s| !s.is_empty()) {
                return format!("pkg:{}", pkg.to_lowercase());
            }
            if let Some(p) = normalize_path(path, platform) {
                return format!("path:{p}");
            }
        }
        Platform::Linux => {
            if let Some(p) = normalize_path(path, platform) {
                return format!("path:{p}");
            }
        }
    }
    format!("name:{}", name.trim().to_lowercase())
}

/// Build a fully-resolved AppIdentity (with derived id) from partial info.
pub fn to_app_identity(mut identity: AppIdentity, platform: Platform) -> AppIdentity {
    identity.path = normalize_path(identity.path.as_deref(), platform).or(identity.path);
    if identity.id.is_empty() {
        identity.id = derive_app_id(
            &identity.name,
            identity.bundle_id.as_deref(),
            identity.path.as_deref(),
            identity.package_id.as_deref(),
            platform,
        );
    }
    identity
}

/// Merge raw discovery entries into unique RunningApps keyed by stable id.
/// Processes that resolve to the same identity are combined (pids collected);
/// apps that merely share a display name remain distinct.
pub fn normalize_running_apps(raw: Vec<RawApp>, platform: Platform) -> Vec<RunningApp> {
    let mut by_id: HashMap<String, RunningApp> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for r in raw {
        if r.pid == 0 {
            continue;
        }
        let id = derive_app_id(
            &r.name,
            r.bundle_id.as_deref(),
            r.path.as_deref(),
            r.package_id.as_deref(),
            platform,
        );
        let norm_path = normalize_path(r.path.as_deref(), platform);

        match by_id.get_mut(&id) {
            Some(existing) => {
                if !existing.pids.contains(&r.pid) {
                    existing.pids.push(r.pid);
                }
                if existing.name.is_empty() && !r.name.is_empty() {
                    existing.name = r.name.clone();
                }
                if existing.path.is_none() {
                    existing.path = norm_path.clone();
                }
                if existing.bundle_id.is_none() {
                    existing.bundle_id = r.bundle_id.clone();
                }
                if r.is_file_manager {
                    existing.is_file_manager = true;
                }
            }
            None => {
                let name = if r.name.is_empty() { id.clone() } else { r.name.clone() };
                by_id.insert(
                    id.clone(),
                    RunningApp {
                        id: id.clone(),
                        name,
                        pids: vec![r.pid],
                        bundle_id: r.bundle_id.clone(),
                        path: norm_path,
                        package_id: r.package_id.clone(),
                        is_file_manager: r.is_file_manager,
                        protected: false,
                        system: false,
                        is_self: false,
                    },
                );
                order.push(id);
            }
        }
    }

    let mut apps: Vec<RunningApp> = order.into_iter().filter_map(|id| by_id.remove(&id)).collect();
    apps.sort_by_key(|a| a.name.to_lowercase());
    apps
}

/// Given a set of protected identities and a running app, decide whether the
/// app is protected. Matching is by stable id first, then by a secondary key
/// (bundleId / normalized path) so protection survives small changes.
pub fn is_protected(
    app: &RunningApp,
    protected_ids: &HashSet<String>,
    protected_secondary: &HashSet<String>,
) -> bool {
    if protected_ids.contains(&app.id) {
        return true;
    }
    if let Some(b) = &app.bundle_id {
        if protected_secondary.contains(&format!("bundle:{}", b.to_lowercase())) {
            return true;
        }
    }
    if let Some(p) = &app.path {
        if protected_secondary.contains(&format!("path:{p}")) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::set_of;

    fn raw(name: &str, pid: u32, bundle_id: Option<&str>, path: Option<&str>) -> RawApp {
        RawApp {
            name: name.to_string(),
            pid,
            bundle_id: bundle_id.map(String::from),
            path: path.map(String::from),
            package_id: None,
            is_file_manager: false,
        }
    }

    #[test]
    fn derive_app_id_prefers_mac_bundle_id() {
        assert_eq!(
            derive_app_id("Spotify", Some("com.spotify.client"), Some("/Applications/Spotify.app"), None, Platform::Darwin),
            "bundle:com.spotify.client"
        );
    }

    #[test]
    fn derive_app_id_falls_back_to_path_on_mac() {
        assert_eq!(
            derive_app_id("Thing", None, Some("/Applications/Thing.app"), None, Platform::Darwin),
            "path:/Applications/Thing.app"
        );
    }

    #[test]
    fn derive_app_id_windows_priority() {
        assert_eq!(
            derive_app_id("X", None, Some("C:\\a.exe"), Some("Contoso.App_8wekyb"), Platform::Win32),
            "pkg:contoso.app_8wekyb"
        );
        assert_eq!(
            derive_app_id("Chrome", None, Some("C:\\Program Files\\Chrome\\chrome.exe"), None, Platform::Win32),
            "path:c:\\program files\\chrome\\chrome.exe"
        );
        assert_eq!(derive_app_id("Mystery", None, None, None, Platform::Win32), "name:mystery");
    }

    #[test]
    fn two_apps_sharing_a_display_name_get_distinct_ids() {
        let a = derive_app_id("ChatGPT", Some("com.openai.chat"), None, None, Platform::Darwin);
        let b = derive_app_id("ChatGPT", Some("com.openai.codex"), None, None, Platform::Darwin);
        assert_ne!(a, b);
    }

    #[test]
    fn normalize_path_lowercases_on_windows() {
        assert_eq!(
            normalize_path(Some("C:/Program Files/App/"), Platform::Win32),
            Some("c:\\program files\\app".to_string())
        );
    }

    #[test]
    fn normalize_path_preserves_case_on_mac() {
        assert_eq!(
            normalize_path(Some("/Applications/App.app/"), Platform::Darwin),
            Some("/Applications/App.app".to_string())
        );
    }

    #[test]
    fn normalize_path_empty_is_none() {
        assert_eq!(normalize_path(Some("   "), Platform::Darwin), None);
        assert_eq!(normalize_path(None, Platform::Darwin), None);
    }

    #[test]
    fn merges_processes_of_the_same_app() {
        let raws = vec![
            raw("Chrome", 1, Some("com.google.Chrome"), None),
            raw("Chrome", 2, Some("com.google.Chrome"), None),
            raw("Chrome", 2, Some("com.google.Chrome"), None), // duplicate pid ignored
        ];
        let apps = normalize_running_apps(raws, Platform::Darwin);
        assert_eq!(apps.len(), 1);
        let mut pids = apps[0].pids.clone();
        pids.sort();
        assert_eq!(pids, vec![1, 2]);
    }

    #[test]
    fn keeps_same_named_apps_with_different_identities_separate() {
        let raws = vec![
            raw("ChatGPT", 10, Some("com.openai.chat"), None),
            raw("ChatGPT", 11, Some("com.openai.codex"), None),
        ];
        let apps = normalize_running_apps(raws, Platform::Darwin);
        assert_eq!(apps.len(), 2);
        assert_ne!(apps[0].id, apps[1].id);
    }

    #[test]
    fn sorts_by_name_and_skips_invalid_entries() {
        let raws = vec![
            raw("Zed", 3, Some("dev.zed.Zed"), None),
            raw("Arc", 4, Some("company.thebrowser.Browser"), None),
            raw("Bad", 0, None, None), // invalid pid, skipped
        ];
        let apps = normalize_running_apps(raws, Platform::Darwin);
        let names: Vec<&str> = apps.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, vec!["Arc", "Zed"]);
    }

    #[test]
    fn is_protected_matches_by_primary_id() {
        let app = RunningApp {
            id: "bundle:com.slack.slack".into(),
            name: "Slack".into(),
            pids: vec![1],
            bundle_id: Some("com.slack.Slack".into()),
            path: None,
            package_id: None,
            is_file_manager: false,
            protected: false,
            system: false,
            is_self: false,
        };
        assert!(is_protected(&app, &set_of(["bundle:com.slack.slack"]), &set_of::<[&str; 0], _>([])));
        assert!(is_protected(&app, &set_of::<[&str; 0], _>([]), &set_of(["bundle:com.slack.slack"])));
        assert!(!is_protected(&app, &set_of(["bundle:other"]), &set_of::<[&str; 0], _>([])));
    }

    #[test]
    fn to_app_identity_derives_and_normalizes() {
        let id = to_app_identity(
            AppIdentity { id: String::new(), name: "App".into(), path: Some("C:/Games/App/app.exe".into()), bundle_id: None, package_id: None },
            Platform::Win32,
        );
        assert_eq!(id.id, "path:c:\\games\\app\\app.exe");
        assert_eq!(id.path.as_deref(), Some("c:\\games\\app\\app.exe"));
    }
}
