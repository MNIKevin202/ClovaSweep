//! Pure parser for the Windows Recycle Bin stats PowerShell output. Kept
//! separate from IO so it is unit-tested on any platform.

use serde_json::Value;

pub struct RecycleBinStats {
    pub size: u64,
    pub count: u64,
}

pub fn parse_recycle_bin(json: &str) -> RecycleBinStats {
    let Ok(value) = serde_json::from_str::<Value>(json) else {
        return RecycleBinStats { size: 0, count: 0 };
    };
    let get_u64 = |key: &str| -> u64 {
        value
            .get(key)
            .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).or_else(|| v.as_i64().map(|i| i.max(0) as u64)))
            .unwrap_or(0)
    };
    RecycleBinStats { size: get_u64("size"), count: get_u64("count") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_size_and_count() {
        let s = parse_recycle_bin(r#"{"size":1024,"count":3}"#);
        assert_eq!(s.size, 1024);
        assert_eq!(s.count, 3);
    }

    #[test]
    fn coerces_string_numbers_and_defaults_garbage() {
        let s = parse_recycle_bin(r#"{"size":"2048","count":"1"}"#);
        assert_eq!(s.size, 2048);
        assert_eq!(s.count, 1);
        let g = parse_recycle_bin("garbage");
        assert_eq!(g.size, 0);
        assert_eq!(g.count, 0);
    }
}
