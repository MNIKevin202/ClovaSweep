//! Sweep executor.
//!
//! Orchestrates a sweep on top of the platform abstraction and the pure
//! filter. Written against the `ApplicationDiscovery`/`ApplicationTerminator`
//! traits (not concrete platform types) so the full graceful -> re-check ->
//! optional-force flow can be unit-tested with fakes, guaranteeing
//! protected/system/self apps are never terminated.

use crate::core::filter::{classify_apps, ClassifyInput};
use crate::core::identity::normalize_running_apps;
use crate::platform::{ApplicationDiscovery, ApplicationTerminator};
use crate::types::{Platform, RunningApp, Settings, SweepAppOutcome, SweepAppResult, SweepRecord, SweepResult, UnresponsiveBehavior};
use chrono::Utc;
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread::sleep;
use std::time::{Duration, Instant};

static COUNTER: AtomicU64 = AtomicU64::new(0);

pub struct SweepDeps<'a> {
    pub discovery: &'a dyn ApplicationDiscovery,
    pub terminator: &'a dyn ApplicationTerminator,
    pub settings: &'a Settings,
    pub protected_ids: &'a HashSet<String>,
    pub protected_secondary: &'a HashSet<String>,
    pub self_ids: &'a HashSet<String>,
    pub platform: Platform,
    /// Pids that belong to ClovaSweep's own process tree (always excluded).
    pub own_pids: &'a HashSet<u32>,
    pub dry_run: bool,
    /// Overridable for tests: sleep and the "still running" re-check.
    pub sleep_fn: Option<&'a dyn Fn(u64)>,
}

fn still_running_ids(discovery: &dyn ApplicationDiscovery, platform: Platform) -> HashSet<String> {
    let raw = discovery.list().unwrap_or_default();
    normalize_running_apps(raw, platform).into_iter().map(|a| a.id).collect()
}

fn gen_id() -> String {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("sweep-{}-{n}", Utc::now().timestamp_millis())
}

pub fn execute_sweep(deps: SweepDeps) -> SweepResult {
    let started = Instant::now();
    let started_at = Utc::now();

    let raw = deps.discovery.list().unwrap_or_default();
    let mut apps = normalize_running_apps(raw, deps.platform);
    apps.retain(|a| !a.pids.iter().any(|p| deps.own_pids.contains(p)));

    let classification = classify_apps(ClassifyInput {
        apps,
        protected_ids: deps.protected_ids,
        protected_secondary: deps.protected_secondary,
        self_ids: deps.self_ids,
        settings: deps.settings,
        platform: deps.platform,
    });

    let targets = classification.would_close;
    let mut results: Vec<SweepAppResult> = Vec::new();

    let result_for = |app: &RunningApp, outcome: SweepAppOutcome, detail: Option<&str>| SweepAppResult {
        id: app.id.clone(),
        name: app.name.clone(),
        bundle_id: app.bundle_id.clone(),
        path: app.path.clone(),
        outcome,
        detail: detail.map(String::from),
    };

    let do_sleep = |ms: u64| match deps.sleep_fn {
        Some(f) => f(ms),
        None => sleep(Duration::from_millis(ms)),
    };

    if deps.dry_run {
        for app in &targets {
            results.push(result_for(app, SweepAppOutcome::Skipped, Some("Dry run")));
        }
    } else if !targets.is_empty() {
        // Phase 1 — graceful quit for every target.
        for app in &targets {
            deps.terminator.request_quit(app);
        }

        let want_finder = deps.platform == Platform::Darwin && deps.settings.close_finder_windows;
        let want_explorer = deps.platform == Platform::Win32 && deps.settings.close_explorer_windows;
        if want_finder || want_explorer {
            deps.terminator.close_file_manager_windows();
        }

        // Phase 2 — wait for graceful shutdown, then re-check liveness.
        do_sleep(deps.settings.graceful_timeout_ms);
        let alive_after_grace = still_running_ids(deps.discovery, deps.platform);

        let still_running: Vec<&RunningApp> = targets.iter().filter(|a| alive_after_grace.contains(&a.id)).collect();
        let closed_gracefully: Vec<&RunningApp> = targets.iter().filter(|a| !alive_after_grace.contains(&a.id)).collect();
        for app in closed_gracefully {
            results.push(result_for(app, SweepAppOutcome::Closed, None));
        }

        if !still_running.is_empty() && deps.settings.unresponsive_behavior == UnresponsiveBehavior::Force {
            // Phase 3 — escalate only for the unresponsive ones.
            for app in &still_running {
                deps.terminator.force_quit(app);
            }
            do_sleep(800);
            let alive_after_force = still_running_ids(deps.discovery, deps.platform);
            for app in still_running {
                if alive_after_force.contains(&app.id) {
                    results.push(result_for(app, SweepAppOutcome::Failed, Some("Did not respond to force quit")));
                } else {
                    results.push(result_for(app, SweepAppOutcome::Closed, Some("Force quit")));
                }
            }
        } else {
            for app in still_running {
                results.push(result_for(app, SweepAppOutcome::Timeout, Some("Did not quit in time")));
            }
        }
    }

    let closed_count = results.iter().filter(|r| r.outcome == SweepAppOutcome::Closed).count();
    let record = SweepRecord {
        id: gen_id(),
        timestamp: started_at.to_rfc3339(),
        duration_ms: started.elapsed().as_millis() as i64,
        closed_count,
        results,
        dry_run: deps.dry_run,
    };

    SweepResult {
        record,
        protected_skipped: classification.protected_running.len(),
        system_skipped: classification.system_excluded.iter().filter(|a| !a.is_self).count(),
    }
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;
    use crate::platform::PResult;
    use crate::types::{set_of, RawApp};
    use std::collections::HashMap;
    use std::sync::Mutex;

    struct FakeDiscovery {
        running: Mutex<HashMap<u32, RawApp>>,
    }
    impl ApplicationDiscovery for FakeDiscovery {
        fn list(&self) -> PResult<Vec<RawApp>> {
            Ok(self.running.lock().unwrap().values().cloned().collect())
        }
    }

    struct FakeTerminator<'a> {
        discovery: &'a FakeDiscovery,
        stubborn: HashSet<String>,
        die_on_force: bool,
        quit_calls: Mutex<Vec<String>>,
        force_calls: Mutex<Vec<String>>,
        finder_closed: Mutex<u32>,
    }
    impl<'a> ApplicationTerminator for FakeTerminator<'a> {
        fn request_quit(&self, app: &RunningApp) {
            self.quit_calls.lock().unwrap().push(app.id.clone());
            let key = app.bundle_id.clone().unwrap_or_else(|| app.name.clone());
            if self.stubborn.contains(&key) {
                return;
            }
            let mut running = self.discovery.running.lock().unwrap();
            for pid in &app.pids {
                running.remove(pid);
            }
        }
        fn force_quit(&self, app: &RunningApp) {
            self.force_calls.lock().unwrap().push(app.id.clone());
            if self.die_on_force {
                let mut running = self.discovery.running.lock().unwrap();
                for pid in &app.pids {
                    running.remove(pid);
                }
            }
        }
        fn close_file_manager_windows(&self) {
            *self.finder_closed.lock().unwrap() += 1;
        }
    }

    fn raw(name: &str, pid: u32, bundle_id: Option<&str>, is_fm: bool) -> RawApp {
        RawApp { name: name.into(), pid, bundle_id: bundle_id.map(String::from), path: None, package_id: None, is_file_manager: is_fm }
    }

    fn self_ids() -> HashSet<String> {
        set_of(["bundle:com.clova.clovasweep", "name:clovasweep"])
    }

    fn noop_sleep(_ms: u64) {}

    #[test]
    fn closes_user_apps_never_protected_system_self() {
        let discovery = FakeDiscovery {
            running: Mutex::new(HashMap::from([
                (1, raw("Spotify", 1, Some("com.spotify.client"), false)),
                (2, raw("Slack", 2, Some("com.slack.Slack"), false)),
                (3, raw("Finder", 3, Some("com.apple.finder"), true)),
                (4, raw("ClovaSweep", 4, Some("com.clova.clovasweep"), false)),
            ])),
        };
        let terminator = FakeTerminator { discovery: &discovery, stubborn: HashSet::new(), die_on_force: true, quit_calls: Mutex::new(vec![]), force_calls: Mutex::new(vec![]), finder_closed: Mutex::new(0) };
        let settings = Settings::default();
        let sleep_fn: &dyn Fn(u64) = &noop_sleep;
        let res = execute_sweep(SweepDeps {
            discovery: &discovery,
            terminator: &terminator,
            settings: &settings,
            protected_ids: &set_of(["bundle:com.slack.slack"]),
            protected_secondary: &set_of::<[&str; 0], _>([]),
            self_ids: &self_ids(),
            platform: Platform::Darwin,
            own_pids: &HashSet::new(),
            dry_run: false,
            sleep_fn: Some(sleep_fn),
        });
        assert_eq!(*terminator.quit_calls.lock().unwrap(), vec!["bundle:com.spotify.client".to_string()]);
        assert_eq!(res.record.closed_count, 1);
        assert_eq!(res.protected_skipped, 1);
        assert_eq!(res.system_skipped, 1);
    }

    #[test]
    fn reports_timeout_and_does_not_force_when_skip() {
        let discovery = FakeDiscovery { running: Mutex::new(HashMap::from([(1, raw("Spotify", 1, Some("com.spotify.client"), false))])) };
        let terminator = FakeTerminator { discovery: &discovery, stubborn: set_of(["com.spotify.client"]), die_on_force: true, quit_calls: Mutex::new(vec![]), force_calls: Mutex::new(vec![]), finder_closed: Mutex::new(0) };
        let mut settings = Settings::default();
        settings.unresponsive_behavior = UnresponsiveBehavior::Skip;
        let sleep_fn: &dyn Fn(u64) = &noop_sleep;
        let res = execute_sweep(SweepDeps {
            discovery: &discovery,
            terminator: &terminator,
            settings: &settings,
            protected_ids: &set_of::<[&str; 0], _>([]),
            protected_secondary: &set_of::<[&str; 0], _>([]),
            self_ids: &self_ids(),
            platform: Platform::Darwin,
            own_pids: &HashSet::new(),
            dry_run: false,
            sleep_fn: Some(sleep_fn),
        });
        assert!(terminator.force_calls.lock().unwrap().is_empty());
        assert_eq!(res.record.results[0].outcome, SweepAppOutcome::Timeout);
        assert_eq!(res.record.closed_count, 0);
    }

    #[test]
    fn escalates_to_force_quit_when_allowed() {
        let discovery = FakeDiscovery { running: Mutex::new(HashMap::from([(1, raw("Spotify", 1, Some("com.spotify.client"), false))])) };
        let terminator = FakeTerminator { discovery: &discovery, stubborn: set_of(["com.spotify.client"]), die_on_force: true, quit_calls: Mutex::new(vec![]), force_calls: Mutex::new(vec![]), finder_closed: Mutex::new(0) };
        let mut settings = Settings::default();
        settings.unresponsive_behavior = UnresponsiveBehavior::Force;
        let sleep_fn: &dyn Fn(u64) = &noop_sleep;
        let res = execute_sweep(SweepDeps {
            discovery: &discovery,
            terminator: &terminator,
            settings: &settings,
            protected_ids: &set_of::<[&str; 0], _>([]),
            protected_secondary: &set_of::<[&str; 0], _>([]),
            self_ids: &self_ids(),
            platform: Platform::Darwin,
            own_pids: &HashSet::new(),
            dry_run: false,
            sleep_fn: Some(sleep_fn),
        });
        assert_eq!(*terminator.force_calls.lock().unwrap(), vec!["bundle:com.spotify.client".to_string()]);
        assert_eq!(res.record.results[0].outcome, SweepAppOutcome::Closed);
        assert_eq!(res.record.results[0].detail.as_deref(), Some("Force quit"));
    }

    #[test]
    fn reports_failed_when_survives_force_quit() {
        let discovery = FakeDiscovery { running: Mutex::new(HashMap::from([(1, raw("Spotify", 1, Some("com.spotify.client"), false))])) };
        let terminator = FakeTerminator { discovery: &discovery, stubborn: set_of(["com.spotify.client"]), die_on_force: false, quit_calls: Mutex::new(vec![]), force_calls: Mutex::new(vec![]), finder_closed: Mutex::new(0) };
        let mut settings = Settings::default();
        settings.unresponsive_behavior = UnresponsiveBehavior::Force;
        let sleep_fn: &dyn Fn(u64) = &noop_sleep;
        let res = execute_sweep(SweepDeps {
            discovery: &discovery,
            terminator: &terminator,
            settings: &settings,
            protected_ids: &set_of::<[&str; 0], _>([]),
            protected_secondary: &set_of::<[&str; 0], _>([]),
            self_ids: &self_ids(),
            platform: Platform::Darwin,
            own_pids: &HashSet::new(),
            dry_run: false,
            sleep_fn: Some(sleep_fn),
        });
        assert_eq!(res.record.results[0].outcome, SweepAppOutcome::Failed);
    }

    #[test]
    fn dry_run_terminates_nothing() {
        let discovery = FakeDiscovery { running: Mutex::new(HashMap::from([(1, raw("Spotify", 1, Some("com.spotify.client"), false))])) };
        let terminator = FakeTerminator { discovery: &discovery, stubborn: HashSet::new(), die_on_force: true, quit_calls: Mutex::new(vec![]), force_calls: Mutex::new(vec![]), finder_closed: Mutex::new(0) };
        let settings = Settings::default();
        let sleep_fn: &dyn Fn(u64) = &noop_sleep;
        let res = execute_sweep(SweepDeps {
            discovery: &discovery,
            terminator: &terminator,
            settings: &settings,
            protected_ids: &set_of::<[&str; 0], _>([]),
            protected_secondary: &set_of::<[&str; 0], _>([]),
            self_ids: &self_ids(),
            platform: Platform::Darwin,
            own_pids: &HashSet::new(),
            dry_run: true,
            sleep_fn: Some(sleep_fn),
        });
        assert!(terminator.quit_calls.lock().unwrap().is_empty());
        assert!(res.record.dry_run);
        assert!(res.record.results.iter().all(|r| r.outcome == SweepAppOutcome::Skipped));
    }

    #[test]
    fn closes_finder_windows_without_quitting_finder() {
        let discovery = FakeDiscovery {
            running: Mutex::new(HashMap::from([
                (1, raw("Spotify", 1, Some("com.spotify.client"), false)),
                (3, raw("Finder", 3, Some("com.apple.finder"), true)),
            ])),
        };
        let terminator = FakeTerminator { discovery: &discovery, stubborn: HashSet::new(), die_on_force: true, quit_calls: Mutex::new(vec![]), force_calls: Mutex::new(vec![]), finder_closed: Mutex::new(0) };
        let mut settings = Settings::default();
        settings.close_finder_windows = true;
        let sleep_fn: &dyn Fn(u64) = &noop_sleep;
        execute_sweep(SweepDeps {
            discovery: &discovery,
            terminator: &terminator,
            settings: &settings,
            protected_ids: &set_of::<[&str; 0], _>([]),
            protected_secondary: &set_of::<[&str; 0], _>([]),
            self_ids: &self_ids(),
            platform: Platform::Darwin,
            own_pids: &HashSet::new(),
            dry_run: false,
            sleep_fn: Some(sleep_fn),
        });
        assert_eq!(*terminator.finder_closed.lock().unwrap(), 1);
        assert!(!terminator.quit_calls.lock().unwrap().contains(&"bundle:com.apple.finder".to_string()));
    }

    #[test]
    fn excludes_own_pids() {
        let discovery = FakeDiscovery { running: Mutex::new(HashMap::from([(1, raw("Spotify", 1, Some("com.spotify.client"), false)), (99, raw("X", 99, None, false))])) };
        let terminator = FakeTerminator { discovery: &discovery, stubborn: HashSet::new(), die_on_force: true, quit_calls: Mutex::new(vec![]), force_calls: Mutex::new(vec![]), finder_closed: Mutex::new(0) };
        let settings = Settings::default();
        let sleep_fn: &dyn Fn(u64) = &noop_sleep;
        let res = execute_sweep(SweepDeps {
            discovery: &discovery,
            terminator: &terminator,
            settings: &settings,
            protected_ids: &set_of::<[&str; 0], _>([]),
            protected_secondary: &set_of::<[&str; 0], _>([]),
            self_ids: &self_ids(),
            platform: Platform::Darwin,
            own_pids: &HashSet::from([99]),
            dry_run: false,
            sleep_fn: Some(sleep_fn),
        });
        assert_eq!(res.record.results.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), vec!["Spotify"]);
    }
}
