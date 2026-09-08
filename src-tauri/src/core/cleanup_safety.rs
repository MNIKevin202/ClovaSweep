//! Cleanup safety.
//!
//! Cleanup is the highest-risk feature, so every deletion is gated by these
//! pure guards. A path may only be removed if it is *strictly inside* one of
//! the explicitly allowed roots for its category, is not the root itself, and
//! is not a known-critical location. This makes "recursively wipe Downloads
//! because a button was pressed" structurally impossible: the executor
//! deletes only the specific item paths that pass `can_delete_path`, never a
//! root directory.
//!
//! Pure module — fully unit-testable.

use crate::types::{CleanupRisk, Platform};
use std::path::{Path, PathBuf};

fn sep(platform: Platform) -> char {
    if platform == Platform::Win32 { '\\' } else { '/' }
}

/// Normalise a path for comparison (case-insensitive + backslash on Windows).
pub fn normalize_compare_path(p: &str, platform: Platform) -> String {
    let mut out = if platform == Platform::Win32 { p.replace('/', "\\") } else { p.to_string() };
    let s = sep(platform);
    while out.len() > 1 && out.ends_with(s) {
        out.pop();
    }
    if platform == Platform::Win32 {
        out = out.to_lowercase();
    }
    out
}

/// Lexical (non-IO) path resolution: collapse `.` and `..` segments without
/// touching the filesystem, so this stays pure and unit-testable everywhere.
fn lexical_normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in p.components() {
        use std::path::Component::*;
        match comp {
            CurDir => {}
            ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// True when `child` is strictly contained within `parent` (not equal to it).
pub fn is_strictly_within(child: &str, parent: &str, platform: Platform) -> bool {
    let c = lexical_normalize(Path::new(child));
    let par = lexical_normalize(Path::new(parent));
    let c_norm = normalize_compare_path(&c.to_string_lossy(), platform);
    let par_norm = normalize_compare_path(&par.to_string_lossy(), platform);
    if c_norm == par_norm {
        return false;
    }
    let prefix = format!("{par_norm}{}", sep(platform));
    c_norm.starts_with(&prefix)
}

/// Critical locations that must never be deleted regardless of allowed roots.
pub fn critical_roots(home: &str, platform: Platform) -> Vec<String> {
    let s = sep(platform);
    let mut roots = vec![home.to_string()];
    match platform {
        Platform::Darwin => {
            roots.extend(["/".to_string(), "/System".to_string(), "/Library".to_string(), "/Applications".to_string(), "/Users".to_string(), "/private".to_string()]);
            roots.push(format!("{home}{s}Library"));
            roots.push(format!("{home}{s}Documents"));
        }
        Platform::Win32 => {
            roots.extend([
                "c:\\".to_string(),
                "c:\\windows".to_string(),
                "c:\\program files".to_string(),
                "c:\\program files (x86)".to_string(),
                "c:\\users".to_string(),
            ]);
            roots.push(format!("{home}{s}documents"));
        }
        Platform::Linux => {
            roots.extend(["/".to_string(), "/etc".to_string(), "/usr".to_string(), "/bin".to_string(), "/home".to_string()]);
        }
    }
    roots.into_iter().map(|r| normalize_compare_path(&r, platform)).collect()
}

pub struct DeleteGuardContext<'a> {
    pub allowed_roots: &'a [String],
    pub home: &'a str,
    pub platform: Platform,
}

/// Decide whether a specific item path may be deleted.
///
/// Rules (all must hold):
///  - the path is strictly inside at least one allowed root
///  - the path is not itself an allowed root
///  - the path is not a critical/system location
pub fn can_delete_path(target: &str, ctx: &DeleteGuardContext) -> bool {
    if target.is_empty() {
        return false;
    }
    let norm = normalize_compare_path(target, ctx.platform);

    let criticals = critical_roots(ctx.home, ctx.platform);
    if criticals.iter().any(|c| c == &norm) {
        return false;
    }
    for root in ctx.allowed_roots {
        if norm == normalize_compare_path(root, ctx.platform) {
            return false;
        }
    }

    ctx.allowed_roots.iter().any(|root| is_strictly_within(target, root, ctx.platform))
}

pub struct FilterResult {
    pub safe: Vec<String>,
    pub rejected: Vec<String>,
}

/// Filter a list of candidate paths to only those that are safe to delete.
pub fn filter_deletable(targets: &[String], ctx: &DeleteGuardContext) -> FilterResult {
    let mut safe = Vec::new();
    let mut rejected = Vec::new();
    for t in targets {
        if can_delete_path(t, ctx) {
            safe.push(t.clone());
        } else {
            rejected.push(t.clone());
        }
    }
    FilterResult { safe, rejected }
}

/// Whether a category's risk permits inclusion in Smart/Quick cleanup.
pub fn is_smart_eligible(risk: CleanupRisk) -> bool {
    matches!(risk, CleanupRisk::Safe | CleanupRisk::System)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strictly_within_basic_cases() {
        assert!(is_strictly_within("/Users/me/Downloads/file.zip", "/Users/me/Downloads", Platform::Darwin));
        assert!(!is_strictly_within("/Users/me/Downloads", "/Users/me/Downloads", Platform::Darwin));
        assert!(!is_strictly_within("/Users/me/Downloads/../../etc/passwd", "/Users/me/Downloads", Platform::Darwin));
        assert!(!is_strictly_within("/Users/me/Documents/x", "/Users/me/Downloads", Platform::Darwin));
        assert!(is_strictly_within("C:\\Users\\Me\\Downloads\\A.txt", "c:\\users\\me\\downloads", Platform::Win32));
    }

    #[test]
    fn can_delete_path_rules() {
        let roots = vec!["/Users/me/Downloads".to_string(), "/Users/me/Desktop".to_string()];
        let ctx = DeleteGuardContext { allowed_roots: &roots, home: "/Users/me", platform: Platform::Darwin };

        assert!(can_delete_path("/Users/me/Downloads/old.dmg", &ctx));
        assert!(can_delete_path("/Users/me/Desktop/screenshot.png", &ctx));
        assert!(!can_delete_path("/Users/me/Downloads", &ctx));
        assert!(!can_delete_path("/Users/me/Desktop/", &ctx));
        assert!(!can_delete_path("/Users/me/Documents/important.txt", &ctx));
        assert!(!can_delete_path("/etc/hosts", &ctx));
        assert!(!can_delete_path("/Users/me/Downloads/../.ssh/id_rsa", &ctx));
        assert!(!can_delete_path("/Users/me", &ctx));
    }

    #[test]
    fn can_delete_path_windows() {
        let roots = vec!["C:\\Users\\Me\\Downloads".to_string()];
        let ctx = DeleteGuardContext { allowed_roots: &roots, home: "C:\\Users\\Me", platform: Platform::Win32 };
        assert!(can_delete_path("c:\\users\\me\\downloads\\setup.exe", &ctx));
        assert!(!can_delete_path("C:\\Users\\Me\\Downloads", &ctx));
        assert!(!can_delete_path("C:\\Windows\\System32\\evil.dll", &ctx));
    }

    #[test]
    fn filter_deletable_partitions() {
        let roots = vec!["/tmp/cache".to_string()];
        let ctx = DeleteGuardContext { allowed_roots: &roots, home: "/Users/me", platform: Platform::Darwin };
        let targets = vec!["/tmp/cache/a".to_string(), "/tmp/cache/b".to_string(), "/etc/passwd".to_string(), "/tmp/cache".to_string()];
        let r = filter_deletable(&targets, &ctx);
        assert_eq!(r.safe, vec!["/tmp/cache/a".to_string(), "/tmp/cache/b".to_string()]);
        assert_eq!(r.rejected, vec!["/etc/passwd".to_string(), "/tmp/cache".to_string()]);
    }

    #[test]
    fn critical_roots_include_home_and_system() {
        let roots = critical_roots("/Users/me", Platform::Darwin);
        assert!(roots.contains(&"/users/me".to_string()) || roots.contains(&"/Users/me".to_string()));
        assert!(roots.iter().any(|r| r.eq_ignore_ascii_case("/system")));
        assert!(roots.iter().any(|r| r.to_lowercase().ends_with("library")));
    }

    #[test]
    fn smart_eligible_rules() {
        assert!(is_smart_eligible(CleanupRisk::Safe));
        assert!(is_smart_eligible(CleanupRisk::System));
        assert!(!is_smart_eligible(CleanupRisk::Review));
    }
}
