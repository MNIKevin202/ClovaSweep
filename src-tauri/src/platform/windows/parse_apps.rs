//! Pure parser for the Windows discovery PowerShell output. Separated from IO
//! so it is unit-tested with captured fixtures on any platform (including the
//! macOS CI runner).
//!
//! Expected shape (compact JSON, one object per windowed process):
//!   { "n": processName, "id": pid, "p": exePath|null, "pr": product|null, "t": title|null }

use crate::core::safety::{base_name, WIN_EXPLORER};
use crate::types::RawApp;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct RawWinEntry {
    n: Option<String>,
    id: Option<Value>,
    p: Option<String>,
    pr: Option<String>,
}

/// Choose the best display name: product name, else a prettified process name.
pub fn display_name(process_name: &str, product: Option<&str>) -> String {
    if let Some(p) = product {
        if !p.trim().is_empty() {
            return p.trim().to_string();
        }
    }
    let base = process_name.strip_suffix(".exe").or_else(|| process_name.strip_suffix(".EXE")).unwrap_or(process_name);
    if base == base.to_lowercase() {
        base.split(|c: char| c.is_whitespace() || c == '_' || c == '-')
            .filter(|w| !w.is_empty())
            .map(|w| {
                let mut chars = w.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => String::new(),
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        base.to_string()
    }
}

pub fn parse_windows_apps(json: &str) -> Vec<RawApp> {
    let Ok(value) = serde_json::from_str::<Value>(json) else { return Vec::new() };
    // ConvertTo-Json returns a single object when there is exactly one item.
    let entries: Vec<RawWinEntry> = match value {
        Value::Array(_) => serde_json::from_value(value).unwrap_or_default(),
        Value::Object(_) => serde_json::from_value(value).map(|e| vec![e]).unwrap_or_default(),
        _ => Vec::new(),
    };

    let mut out = Vec::new();
    for e in entries {
        let pid = e.id.as_ref().and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))).unwrap_or(0) as u32;
        if pid == 0 {
            continue;
        }
        let Some(process_name) = e.n.filter(|s| !s.is_empty()) else { continue };
        let path = e.p.filter(|s| !s.trim().is_empty());
        out.push(RawApp {
            name: display_name(&process_name, e.pr.as_deref()),
            pid,
            bundle_id: None,
            path,
            package_id: None,
            is_file_manager: base_name(&process_name) == WIN_EXPLORER,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_name_prefers_product() {
        assert_eq!(display_name("chrome", Some("Google Chrome")), "Google Chrome");
    }

    #[test]
    fn display_name_title_cases_lowercase_process() {
        assert_eq!(display_name("slack", None), "Slack");
        assert_eq!(display_name("code", None), "Code");
    }

    #[test]
    fn display_name_leaves_already_cased_names() {
        assert_eq!(display_name("WhatsApp", None), "WhatsApp");
    }

    #[test]
    fn parses_array_payload_and_flags_explorer() {
        let json = r#"[
            {"n":"chrome","id":100,"p":"C:\\Program Files\\Google\\Chrome\\chrome.exe","pr":"Google Chrome","t":"New Tab"},
            {"n":"explorer","id":200,"p":"C:\\Windows\\explorer.exe","pr":"Windows Explorer","t":"Downloads"}
        ]"#;
        let apps = parse_windows_apps(json);
        assert_eq!(apps.len(), 2);
        assert_eq!(apps.iter().find(|a| a.name == "Google Chrome").unwrap().path.as_deref(), Some("C:\\Program Files\\Google\\Chrome\\chrome.exe"));
        assert_eq!(apps.iter().find(|a| a.is_file_manager).unwrap().name, "Windows Explorer");
    }

    #[test]
    fn handles_single_object_payload() {
        let json = r#"{"n":"notepad","id":5,"p":"C:\\Windows\\System32\\notepad.exe","pr":null,"t":"Untitled"}"#;
        let apps = parse_windows_apps(json);
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].name, "Notepad");
    }

    #[test]
    fn skips_entries_without_pid_or_name() {
        let json = r#"[{"n":"","id":5},{"n":"x","id":0},{"n":"ok","id":7}]"#;
        let apps = parse_windows_apps(json);
        assert_eq!(apps.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), vec!["Ok"]);
    }
}
