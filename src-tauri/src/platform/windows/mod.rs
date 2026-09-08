pub mod discovery;
pub mod icons;
pub mod parse_apps;
pub mod parse_recycle;
pub mod storage;
pub mod terminator;

use crate::platform::PlatformError;
use std::os::windows::process::CommandExt;
use std::process::Command;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Execute a PowerShell script and return its stdout. Uses -NoProfile for
/// speed and -ExecutionPolicy Bypass so it runs regardless of machine policy.
pub fn run_powershell(script: &str) -> Result<String, PlatformError> {
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| PlatformError(format!("failed to spawn powershell: {e}")))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
