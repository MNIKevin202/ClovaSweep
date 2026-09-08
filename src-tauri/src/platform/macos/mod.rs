pub mod discovery;
pub mod icons;
pub mod parse_apps;
pub mod storage;
pub mod terminator;

use crate::platform::PlatformError;
use std::process::Command;

/// Run a JavaScript-for-Automation (JXA) script via `osascript`.
pub fn run_jxa(script: &str) -> Result<String, PlatformError> {
    let output = Command::new("osascript")
        .arg("-l")
        .arg("JavaScript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| PlatformError(format!("failed to spawn osascript: {e}")))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Run a plain AppleScript one-liner via `osascript -e`.
pub fn run_applescript(script: &str) -> Result<String, PlatformError> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| PlatformError(format!("failed to spawn osascript: {e}")))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
