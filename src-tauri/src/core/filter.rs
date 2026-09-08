//! Sweep filtering — the decision layer.
//!
//! Given the running apps, the user's protected set, ClovaSweep's own identity
//! and the current settings, decide exactly which apps a sweep would close and
//! why the rest are excluded. This is the single source of truth for "what
//! would a sweep do", used both by the live preview and by the sweep
//! executor, so the preview can never disagree with the action.
//!
//! Pure module — fully unit-testable, identical behaviour on every platform.

use super::identity::is_protected;
use super::safety::{is_file_manager, is_system_critical};
use crate::types::{Platform, RunningApp, Settings, SweepPreview};
use std::collections::HashSet;

pub struct ClassifyInput<'a> {
    pub apps: Vec<RunningApp>,
    pub protected_ids: &'a HashSet<String>,
    pub protected_secondary: &'a HashSet<String>,
    /// Stable ids (and lower-cased names) that identify ClovaSweep itself.
    pub self_ids: &'a HashSet<String>,
    pub settings: &'a Settings,
    pub platform: Platform,
}

pub struct Classification {
    pub would_close: Vec<RunningApp>,
    pub protected_running: Vec<RunningApp>,
    pub system_excluded: Vec<RunningApp>,
    pub file_managers: Vec<RunningApp>,
}

/// Decide whether an app is ClovaSweep itself.
pub fn is_self(app: &RunningApp, self_ids: &HashSet<String>) -> bool {
    if self_ids.contains(&app.id) {
        return true;
    }
    if let Some(b) = &app.bundle_id {
        if self_ids.contains(&format!("bundle:{}", b.to_lowercase())) {
            return true;
        }
    }
    self_ids.contains(&format!("name:{}", app.name.to_lowercase()))
}

/// Classify every running app into exactly one bucket, annotating each app
/// with its flags (protected/system/isSelf) so the UI can render status
/// directly.
pub fn classify_apps(input: ClassifyInput) -> Classification {
    let mut would_close = Vec::new();
    let mut protected_running = Vec::new();
    let mut system_excluded = Vec::new();
    let mut file_managers = Vec::new();

    for raw in input.apps {
        let mut app = raw;
        app.protected = false;
        app.system = false;
        app.is_self = false;

        if is_self(&app, input.self_ids) {
            app.is_self = true;
            app.system = true;
            system_excluded.push(app);
            continue;
        }

        let file_manager = is_file_manager(&app, input.platform);
        if file_manager {
            app.is_file_manager = true;
        }

        if is_system_critical(&app, input.platform) {
            app.system = true;
            if file_manager {
                file_managers.push(app.clone());
            }
            system_excluded.push(app);
            continue;
        }

        if is_protected(&app, input.protected_ids, input.protected_secondary) {
            app.protected = true;
            protected_running.push(app);
            continue;
        }

        if input.settings.close_user_apps {
            would_close.push(app);
        } else {
            system_excluded.push(app);
        }
    }

    Classification { would_close, protected_running, system_excluded, file_managers }
}

/// Build the SweepPreview shape returned to the frontend.
pub fn build_preview(input: ClassifyInput) -> SweepPreview {
    let c = classify_apps(input);
    SweepPreview {
        would_close: c.would_close,
        protected_running: c.protected_running,
        // Don't surface ClovaSweep itself.
        system_excluded: c.system_excluded.into_iter().filter(|a| !a.is_self).collect(),
    }
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;
    use crate::types::set_of;

    fn app(id: &str, name: &str, bundle_id: Option<&str>) -> RunningApp {
        RunningApp {
            id: id.into(),
            name: name.into(),
            pids: vec![1],
            bundle_id: bundle_id.map(String::from),
            path: None,
            package_id: None,
            is_file_manager: false,
            protected: false,
            system: false,
            is_self: false,
        }
    }

    fn win_app(id: &str, name: &str, path: &str) -> RunningApp {
        RunningApp {
            id: id.into(),
            name: name.into(),
            pids: vec![1],
            bundle_id: None,
            path: Some(path.into()),
            package_id: None,
            is_file_manager: false,
            protected: false,
            system: false,
            is_self: false,
        }
    }

    fn self_ids() -> HashSet<String> {
        set_of(["bundle:com.clova.clovasweep", "name:clovasweep", "name:clovasweep_lib"])
    }

    #[test]
    fn closes_ordinary_user_apps_and_excludes_protected_system_self() {
        let apps = vec![
            app("bundle:com.spotify.client", "Spotify", Some("com.spotify.client")),
            app("bundle:com.google.chrome", "Google Chrome", Some("com.google.Chrome")),
            app("bundle:com.apple.finder", "Finder", Some("com.apple.finder")),
            app("bundle:com.slack.slack", "Slack", Some("com.slack.Slack")),
            app("bundle:com.clova.clovasweep", "ClovaSweep", Some("com.clova.clovasweep")),
        ];
        let settings = Settings::default();
        let sids = self_ids();
        let c = classify_apps(ClassifyInput {
            apps: apps.clone(),
            protected_ids: &set_of(["bundle:com.slack.slack"]),
            protected_secondary: &set_of::<[&str; 0], _>([]),
            self_ids: &sids,
            settings: &settings,
            platform: Platform::Darwin,
        });

        let mut closed: Vec<&str> = c.would_close.iter().map(|a| a.name.as_str()).collect();
        closed.sort();
        assert_eq!(closed, vec!["Google Chrome", "Spotify"]);
        assert_eq!(c.protected_running.len(), 1);
        assert_eq!(c.protected_running[0].name, "Slack");
        assert!(c.protected_running[0].protected);

        assert!(c.system_excluded.iter().any(|a| a.name == "Finder"));
        assert_eq!(c.file_managers.len(), 1);
        let self_app = c.system_excluded.iter().find(|a| a.name == "ClovaSweep").unwrap();
        assert!(self_app.is_self);
    }

    #[test]
    fn closes_nothing_when_close_user_apps_disabled() {
        let apps = vec![app("bundle:com.spotify.client", "Spotify", Some("com.spotify.client"))];
        let mut settings = Settings::default();
        settings.close_user_apps = false;
        let c = classify_apps(ClassifyInput {
            apps,
            protected_ids: &set_of::<[&str; 0], _>([]),
            protected_secondary: &set_of::<[&str; 0], _>([]),
            self_ids: &self_ids(),
            settings: &settings,
            platform: Platform::Darwin,
        });
        assert!(c.would_close.is_empty());
    }

    #[test]
    fn windows_excludes_shell_and_system_path_apps() {
        let apps = vec![
            win_app("path:c:\\program files\\google\\chrome\\chrome.exe", "chrome.exe", "C:\\Program Files\\Google\\Chrome\\chrome.exe"),
            win_app("path:c:\\windows\\explorer.exe", "explorer.exe", "C:\\Windows\\explorer.exe"),
            win_app("path:c:\\windows\\system32\\systemsettings.exe", "SystemSettings.exe", "C:\\Windows\\System32\\SystemSettings.exe"),
        ];
        let settings = Settings::default();
        let c = classify_apps(ClassifyInput {
            apps,
            protected_ids: &set_of::<[&str; 0], _>([]),
            protected_secondary: &set_of::<[&str; 0], _>([]),
            self_ids: &self_ids(),
            settings: &settings,
            platform: Platform::Win32,
        });
        assert_eq!(c.would_close.len(), 1);
        assert_eq!(c.would_close[0].name, "chrome.exe");
        assert_eq!(c.file_managers.len(), 1);
        assert_eq!(c.file_managers[0].name, "explorer.exe");
    }

    #[test]
    fn preview_never_surfaces_self() {
        let apps = vec![
            app("bundle:com.clova.clovasweep", "ClovaSweep", Some("com.clova.clovasweep")),
            app("bundle:com.apple.finder", "Finder", Some("com.apple.finder")),
        ];
        let settings = Settings::default();
        let preview = build_preview(ClassifyInput {
            apps,
            protected_ids: &set_of::<[&str; 0], _>([]),
            protected_secondary: &set_of::<[&str; 0], _>([]),
            self_ids: &self_ids(),
            settings: &settings,
            platform: Platform::Darwin,
        });
        assert!(!preview.system_excluded.iter().any(|a| a.name == "ClovaSweep"));
        assert!(preview.system_excluded.iter().any(|a| a.name == "Finder"));
    }

    #[test]
    fn is_self_matches_id_bundle_and_name() {
        let sids = set_of(["bundle:com.clova.clovasweep"]);
        assert!(is_self(&app("bundle:com.clova.clovasweep", "ClovaSweep", None), &sids));
        assert!(is_self(&app("x", "ClovaSweep", Some("com.clova.clovasweep")), &sids));
        assert!(!is_self(&app("y", "Other", None), &sids));
    }
}
