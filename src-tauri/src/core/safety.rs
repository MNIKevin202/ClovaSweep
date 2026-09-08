//! System-safety classification.
//!
//! ClovaSweep must never behave like "enumerate every process and kill
//! everything". The primary defence is *discovery* — on each platform we only
//! ever enumerate user-facing applications (macOS: regular activation policy;
//! Windows: processes owning a visible top-level window). This module is the
//! second line of defence: given an app that slipped through discovery,
//! decide whether it is a system-critical shell component that must never be
//! swept.
//!
//! Pure module — fully unit-testable.

use crate::types::{Platform, RunningApp};
use once_cell::sync::Lazy;
use std::collections::HashSet;

pub const MAC_FINDER: &str = "com.apple.finder";
pub const WIN_EXPLORER: &str = "explorer";

/// macOS bundle ids that are user-facing (regular policy) yet are shell/system
/// components we must never quit. Most OS agents are accessory-policy and are
/// already excluded at discovery; this is a conservative backstop.
static MAC_CRITICAL_BUNDLES: Lazy<HashSet<&'static str>> = Lazy::new(|| {
    HashSet::from([
        "com.apple.finder",
        "com.apple.loginwindow",
        "com.apple.dock",
        "com.apple.systemuiserver",
        "com.apple.controlcenter",
        "com.apple.notificationcenterui",
        "com.apple.wallpaper.agent",
        "com.apple.windowmanager",
        "com.apple.spotlight",
        "com.apple.coreservices.uiagent",
        "com.apple.universalcontrol",
        "com.apple.textinputmenuagent",
        "com.apple.powerchime",
    ])
});

/// Windows process names (lower-case, no extension) that are session/shell
/// critical. Killing any of these can log the user out or break the desktop.
static WIN_CRITICAL_NAMES: Lazy<HashSet<&'static str>> = Lazy::new(|| {
    HashSet::from([
        "system", "idle", "registry", "memory compression",
        "csrss", "wininit", "winlogon", "services", "lsass", "smss",
        "svchost", "fontdrvhost", "dwm", "spoolsv", "taskhostw", "taskhost",
        "sihost", "ctfmon", "conhost", "dllhost", "rundll32", "wmiprvse",
        "werfault", "werfaultsecure", "audiodg", "logonui", "wudfhost",
        "explorer",
        "shellexperiencehost", "startmenuexperiencehost", "searchhost",
        "searchapp", "searchui", "textinputhost", "applicationframehost",
        "systemsettings", "lockapp", "runtimebroker", "widgets",
        "widgetservice", "phoneexperiencehost", "useroobebroker",
        "backgroundtaskhost", "gamebar", "gamebarftserver",
        "securityhealthsystray", "securityhealthservice", "msmpeng", "nissrv",
    ])
});

/// Strip a trailing `.exe`/`.app` and lower-case a process/app name.
pub fn base_name(name: &str) -> String {
    let trimmed = name.trim().to_lowercase();
    trimmed
        .strip_suffix(".exe")
        .or_else(|| trimmed.strip_suffix(".app"))
        .unwrap_or(&trimmed)
        .to_string()
}

/// True when a Windows executable path is inside an OS system location.
/// User-installed apps live in Program Files, AppData, or WindowsApps (Store),
/// none of which match here.
pub fn is_windows_system_path(path: Option<&str>) -> bool {
    let Some(path) = path else { return false };
    let p = path.replace('/', "\\").to_lowercase();
    if p.contains("\\windowsapps\\") {
        return false;
    }
    if p.contains("\\windows\\system32\\") || p.contains("\\windows\\syswow64\\") || p.contains("\\windows\\systemapps\\") {
        return true;
    }
    // Directly inside the Windows directory, e.g. C:\Windows\explorer.exe
    if let Some(idx) = p.find("\\windows\\") {
        let after = &p[idx + "\\windows\\".len()..];
        if !after.is_empty() && !after.contains('\\') && after.ends_with(".exe") {
            return true;
        }
    }
    false
}

/// Is this app the OS file manager (Finder / Explorer)?
pub fn is_file_manager(app: &RunningApp, platform: Platform) -> bool {
    if app.is_file_manager {
        return true;
    }
    match platform {
        Platform::Darwin => app.bundle_id.as_deref().map(|b| b.to_lowercase()) == Some(MAC_FINDER.to_string()),
        Platform::Win32 => base_name(&app.name) == WIN_EXPLORER,
        Platform::Linux => false,
    }
}

/// Classify whether an app is system-critical (must never be terminated by a
/// sweep). File managers are considered system-critical for *termination*,
/// but the sweep service may still close their windows when the user opts in.
pub fn is_system_critical(app: &RunningApp, platform: Platform) -> bool {
    match platform {
        Platform::Darwin => {
            if let Some(bid) = app.bundle_id.as_deref() {
                let lower = bid.to_lowercase();
                if MAC_CRITICAL_BUNDLES.contains(lower.as_str()) {
                    return true;
                }
            }
            false
        }
        Platform::Win32 => {
            if WIN_CRITICAL_NAMES.contains(base_name(&app.name).as_str()) {
                return true;
            }
            is_windows_system_path(app.path.as_deref())
        }
        Platform::Linux => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(name: &str, bundle_id: Option<&str>, path: Option<&str>) -> RunningApp {
        RunningApp {
            id: "x".into(),
            name: name.into(),
            pids: vec![1],
            bundle_id: bundle_id.map(String::from),
            path: path.map(String::from),
            package_id: None,
            is_file_manager: false,
            protected: false,
            system: false,
            is_self: false,
        }
    }

    #[test]
    fn base_name_strips_extension_and_lowercases() {
        assert_eq!(base_name("Explorer.EXE"), "explorer");
        assert_eq!(base_name("Finder.app"), "finder");
        assert_eq!(base_name("  Google Chrome "), "google chrome");
    }

    #[test]
    fn windows_system_path_detection() {
        assert!(is_windows_system_path(Some("C:\\Windows\\System32\\dwm.exe")));
        assert!(is_windows_system_path(Some("C:\\Windows\\SysWOW64\\thing.exe")));
        assert!(is_windows_system_path(Some("C:\\Windows\\SystemApps\\ShellExperienceHost\\x.exe")));
        assert!(is_windows_system_path(Some("C:\\Windows\\explorer.exe")));
        assert!(!is_windows_system_path(Some("C:\\Program Files\\WindowsApps\\Spotify_1.2\\Spotify.exe")));
        assert!(!is_windows_system_path(Some("C:\\Program Files\\Google\\Chrome\\chrome.exe")));
        assert!(!is_windows_system_path(Some("C:\\Users\\me\\AppData\\Local\\Slack\\slack.exe")));
    }

    #[test]
    fn mac_critical_bundles() {
        assert!(is_system_critical(&app("Finder", Some("com.apple.finder"), None), Platform::Darwin));
        assert!(is_system_critical(&app("Dock", Some("com.apple.dock"), None), Platform::Darwin));
        assert!(!is_system_critical(&app("Safari", Some("com.apple.Safari"), None), Platform::Darwin));
        assert!(!is_system_critical(&app("Messages", Some("com.apple.MobileSMS"), None), Platform::Darwin));
        assert!(!is_system_critical(&app("Notes", Some("com.apple.Notes"), None), Platform::Darwin));
    }

    #[test]
    fn windows_critical_by_name_and_path() {
        for n in ["explorer", "csrss.exe", "winlogon", "lsass.exe", "dwm", "SearchHost.exe"] {
            assert!(is_system_critical(&app(n, None, None), Platform::Win32), "{n} should be critical");
        }
        assert!(is_system_critical(&app("Random", None, Some("C:\\Windows\\System32\\random.exe")), Platform::Win32));
        assert!(!is_system_critical(
            &app("chrome", None, Some("C:\\Program Files\\Google\\Chrome\\chrome.exe")),
            Platform::Win32
        ));
    }

    #[test]
    fn file_manager_detection() {
        assert!(is_file_manager(&app("Finder", Some("com.apple.finder"), None), Platform::Darwin));
        assert!(!is_file_manager(&app("Safari", Some("com.apple.Safari"), None), Platform::Darwin));
        assert!(is_file_manager(&app("explorer.exe", None, None), Platform::Win32));
        assert!(!is_file_manager(&app("chrome.exe", None, None), Platform::Win32));
    }
}
