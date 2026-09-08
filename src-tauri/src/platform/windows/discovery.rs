//! Windows application discovery.
//!
//! Enumerates processes that own a visible top-level window
//! (MainWindowHandle), which is the closest Windows analogue to macOS's
//! "regular" apps: background services and most system processes have no
//! window and are never returned. System components that *do* have a window
//! (Explorer, Settings, Search host…) are filtered by the shared safety
//! layer, not here.

use super::{parse_apps::parse_windows_apps, run_powershell};
use crate::platform::{ApplicationDiscovery, PResult};
use crate::types::RawApp;

const DISCOVERY_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 }
$list = foreach ($p in $procs) {
  [PSCustomObject]@{
    n  = $p.ProcessName
    id = $p.Id
    p  = $p.Path
    pr = $p.Product
    t  = $p.MainWindowTitle
  }
}
@($list) | ConvertTo-Json -Compress -Depth 3
"#;

pub struct WindowsDiscovery;

impl ApplicationDiscovery for WindowsDiscovery {
    fn list(&self) -> PResult<Vec<RawApp>> {
        match run_powershell(DISCOVERY_SCRIPT) {
            Ok(json) => Ok(parse_windows_apps(&json)),
            Err(_) => Ok(Vec::new()),
        }
    }
}
