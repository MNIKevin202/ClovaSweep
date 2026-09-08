//! Windows icon provider.
//!
//! Extracts the executable's associated icon via System.Drawing and returns a
//! PNG data URL, cached by stable id.

use super::run_powershell;
use crate::platform::IconProvider;
use std::collections::HashMap;
use std::sync::Mutex;

fn script(exe_path: &str) -> String {
    let safe = exe_path.replace('\'', "''");
    format!(
        r#"
$ErrorActionPreference = 'Stop'
try {{
  Add-Type -AssemblyName System.Drawing
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon('{safe}')
  if ($null -eq $icon) {{ '' ; return }}
  $bmp = $icon.ToBitmap()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  [Convert]::ToBase64String($ms.ToArray())
  $ms.Dispose(); $bmp.Dispose(); $icon.Dispose()
}} catch {{ '' }}
"#
    )
}

pub struct WindowsIcons {
    cache: Mutex<HashMap<String, Option<String>>>,
}

impl Default for WindowsIcons {
    fn default() -> Self {
        Self::new()
    }
}

impl WindowsIcons {
    pub fn new() -> Self {
        WindowsIcons { cache: Mutex::new(HashMap::new()) }
    }
}

impl IconProvider for WindowsIcons {
    fn get_icon(&self, path: Option<&str>, _bundle_id: Option<&str>) -> Option<String> {
        let path = path?;
        if let Some(cached) = self.cache.lock().unwrap().get(path) {
            return cached.clone();
        }
        let value = match run_powershell(&script(path)) {
            Ok(b64) if !b64.trim().is_empty() => Some(format!("data:image/png;base64,{}", b64.trim())),
            _ => None,
        };
        self.cache.lock().unwrap().insert(path.to_string(), value.clone());
        value
    }
}
