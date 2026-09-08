//! Pure parser for the macOS discovery JXA output. Separated from IO so it is
//! unit-tested with captured fixtures independent of the actual osascript call.

use crate::core::safety::MAC_FINDER;
use crate::types::RawApp;
use serde::Deserialize;

#[derive(Deserialize)]
struct RawMacEntry {
    name: Option<String>,
    #[serde(rename = "bundleId")]
    bundle_id: Option<String>,
    pid: Option<serde_json::Value>,
    path: Option<String>,
}

pub fn parse_mac_apps(json: &str) -> Vec<RawApp> {
    let Ok(entries) = serde_json::from_str::<Vec<RawMacEntry>>(json) else { return Vec::new() };
    let mut out = Vec::new();
    for entry in entries {
        let pid = entry
            .pid
            .as_ref()
            .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
            .unwrap_or(0) as u32;
        if pid == 0 {
            continue;
        }
        let name = entry.name.filter(|s| !s.trim().is_empty());
        let bundle_id = entry.bundle_id.filter(|s| !s.trim().is_empty());
        let path = entry.path.filter(|s| !s.trim().is_empty());
        if name.is_none() && bundle_id.is_none() && path.is_none() {
            continue;
        }
        let is_file_manager = bundle_id.as_deref().map(|b| b.to_lowercase()) == Some(MAC_FINDER.to_string());
        out.push(RawApp {
            name: name.or_else(|| bundle_id.clone()).unwrap_or_else(|| "Unknown".to_string()),
            pid,
            bundle_id,
            path,
            package_id: None,
            is_file_manager,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_realistic_payload_and_flags_finder() {
        let json = r#"[
            {"name":"Finder","bundleId":"com.apple.finder","pid":368,"path":"/System/Library/CoreServices/Finder.app"},
            {"name":"Spotify","bundleId":"com.spotify.client","pid":726,"path":"/Applications/Spotify.app"},
            {"name":"ChatGPT","bundleId":"com.openai.chat","pid":1,"path":"/Applications/ChatGPT Classic.app"},
            {"name":"ChatGPT","bundleId":"com.openai.codex","pid":2,"path":"/Applications/ChatGPT.app"}
        ]"#;
        let apps = parse_mac_apps(json);
        assert_eq!(apps.len(), 4);
        assert!(apps.iter().find(|a| a.bundle_id.as_deref() == Some("com.apple.finder")).unwrap().is_file_manager);
        assert!(!apps.iter().find(|a| a.bundle_id.as_deref() == Some("com.spotify.client")).unwrap().is_file_manager);
    }

    #[test]
    fn drops_entries_with_invalid_pid_or_no_identity() {
        let json = r#"[
            {"name":"Bad","pid":0},
            {"name":null,"bundleId":null,"pid":5,"path":null},
            {"name":"Good","bundleId":"com.good","pid":9}
        ]"#;
        let apps = parse_mac_apps(json);
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].name, "Good");
    }

    #[test]
    fn malformed_json_returns_empty() {
        assert!(parse_mac_apps("not json").is_empty());
        assert!(parse_mac_apps(r#"{"not":"array"}"#).is_empty());
    }
}
