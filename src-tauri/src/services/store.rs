//! Persistent JSON store.
//!
//! A single JSON document holds settings, protected apps, sweep history and
//! cleanup prefs. Reads go through the pure migration layer so a corrupt or
//! outdated file is repaired rather than fatal. Writes are atomic (temp file
//! + rename) so a crash mid-write can never leave a truncated document.

use crate::core::migrations::{migrate_settings, migrate_state, CleanupPrefs, PersistedState, MAX_SWEEP_HISTORY};
use crate::types::{ProtectedApp, Settings, SweepRecord};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Store {
    state: Mutex<PersistedState>,
    file: PathBuf,
}

impl Store {
    pub fn new(file: PathBuf) -> Self {
        let state = Self::load(&file);
        Store { state: Mutex::new(state), file }
    }

    fn load(file: &Path) -> PersistedState {
        match fs::read_to_string(file) {
            Ok(raw) => match serde_json::from_str::<serde_json::Value>(&raw) {
                Ok(v) => migrate_state(&v),
                Err(_) => {
                    let _ = fs::rename(file, file.with_extension(format!("corrupt-{}", chrono::Utc::now().timestamp())));
                    PersistedState::default()
                }
            },
            Err(_) => PersistedState::default(),
        }
    }

    fn persist(&self, state: &PersistedState) {
        if let Some(dir) = self.file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let tmp = self.file.with_extension("tmp");
        if let Ok(json) = serde_json::to_string_pretty(state) {
            if fs::write(&tmp, json).is_ok() {
                let _ = fs::rename(&tmp, &self.file);
            }
        }
    }

    pub fn get_settings(&self) -> Settings {
        self.state.lock().unwrap().settings.clone()
    }

    pub fn update_settings(&self, patch: serde_json::Value) -> Settings {
        let mut state = self.state.lock().unwrap();
        let mut current = serde_json::to_value(&state.settings).unwrap_or_default();
        if let (Some(current_obj), Some(patch_obj)) = (current.as_object_mut(), patch.as_object()) {
            for (k, v) in patch_obj {
                current_obj.insert(k.clone(), v.clone());
            }
        }
        state.settings = migrate_settings(&current);
        let settings = state.settings.clone();
        self.persist(&state);
        settings
    }

    pub fn get_protected(&self) -> Vec<ProtectedApp> {
        self.state.lock().unwrap().protected_apps.clone()
    }

    pub fn add_protected(&self, app: ProtectedApp) -> Vec<ProtectedApp> {
        let mut state = self.state.lock().unwrap();
        if !state.protected_apps.iter().any(|p| p.id == app.id) {
            state.protected_apps.push(app);
            self.persist(&state);
        }
        state.protected_apps.clone()
    }

    pub fn remove_protected(&self, id: &str) -> Vec<ProtectedApp> {
        let mut state = self.state.lock().unwrap();
        let before = state.protected_apps.len();
        state.protected_apps.retain(|p| p.id != id);
        if state.protected_apps.len() != before {
            self.persist(&state);
        }
        state.protected_apps.clone()
    }

    pub fn get_sweeps(&self) -> Vec<SweepRecord> {
        self.state.lock().unwrap().sweeps.clone()
    }

    pub fn add_sweep(&self, record: SweepRecord) {
        let mut state = self.state.lock().unwrap();
        state.sweeps.insert(0, record);
        if state.sweeps.len() > MAX_SWEEP_HISTORY {
            state.sweeps.truncate(MAX_SWEEP_HISTORY);
        }
        self.persist(&state);
    }

    pub fn clear_sweeps(&self) {
        let mut state = self.state.lock().unwrap();
        state.sweeps.clear();
        self.persist(&state);
    }

    pub fn get_cleanup_prefs(&self) -> CleanupPrefs {
        self.state.lock().unwrap().cleanup.clone()
    }

    pub fn set_cleanup_prefs(&self, prefs: CleanupPrefs) {
        let mut state = self.state.lock().unwrap();
        state.cleanup = prefs;
        self.persist(&state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{SweepAppOutcome, SweepAppResult};
    use tempfile::tempdir;

    fn prot(id: &str, name: &str) -> ProtectedApp {
        ProtectedApp { id: id.into(), name: name.into(), bundle_id: None, path: None, package_id: None, added_at: "2026-01-01T00:00:00Z".into() }
    }
    fn sweep(id: &str, ts: &str) -> SweepRecord {
        SweepRecord {
            id: id.into(),
            timestamp: ts.into(),
            duration_ms: 10,
            closed_count: 1,
            dry_run: false,
            results: vec![SweepAppResult { id: "bundle:a".into(), name: "A".into(), bundle_id: None, path: None, outcome: SweepAppOutcome::Closed, detail: None }],
        }
    }

    #[test]
    fn persists_settings_across_instances() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("state.json");
        let s1 = Store::new(file.clone());
        s1.update_settings(serde_json::json!({ "theme": "dark", "gracefulTimeoutMs": 8000 }));
        let s2 = Store::new(file);
        assert_eq!(s2.get_settings().theme, crate::types::ThemePreference::Dark);
        assert_eq!(s2.get_settings().graceful_timeout_ms, 8000);
    }

    #[test]
    fn persists_protected_apps_and_dedupes() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("state.json");
        let s1 = Store::new(file.clone());
        s1.add_protected(prot("bundle:a", "A"));
        s1.add_protected(prot("bundle:a", "A again"));
        s1.add_protected(prot("bundle:b", "B"));
        assert_eq!(s1.get_protected().len(), 2);
        let s2 = Store::new(file);
        let mut ids: Vec<String> = s2.get_protected().into_iter().map(|p| p.id).collect();
        ids.sort();
        assert_eq!(ids, vec!["bundle:a".to_string(), "bundle:b".to_string()]);
    }

    #[test]
    fn removes_protection() {
        let dir = tempdir().unwrap();
        let s = Store::new(dir.path().join("state.json"));
        s.add_protected(prot("bundle:a", "A"));
        s.remove_protected("bundle:a");
        assert!(s.get_protected().is_empty());
    }

    #[test]
    fn keeps_sweep_history_newest_first_and_caps_length() {
        let dir = tempdir().unwrap();
        let s = Store::new(dir.path().join("state.json"));
        for i in 0..(MAX_SWEEP_HISTORY + 25) {
            s.add_sweep(sweep(&format!("s{i}"), &format!("2026-01-01T00:{:02}:00Z", i % 60)));
        }
        let sweeps = s.get_sweeps();
        assert_eq!(sweeps.len(), MAX_SWEEP_HISTORY);
        assert_eq!(sweeps[0].id, format!("s{}", MAX_SWEEP_HISTORY + 24));
    }

    #[test]
    fn recovers_from_corrupt_file() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("state.json");
        fs::write(&file, "{ not valid json ").unwrap();
        let s = Store::new(file.clone());
        assert!(s.get_protected().is_empty());
        assert_eq!(s.get_settings().theme, crate::types::ThemePreference::System);
        s.update_settings(serde_json::json!({ "theme": "light" }));
        assert_eq!(Store::new(file).get_settings().theme, crate::types::ThemePreference::Light);
    }

    #[test]
    fn clears_sweep_history() {
        let dir = tempdir().unwrap();
        let s = Store::new(dir.path().join("state.json"));
        s.add_sweep(sweep("x", "2026-01-01T00:00:00Z"));
        s.clear_sweeps();
        assert!(s.get_sweeps().is_empty());
    }
}
