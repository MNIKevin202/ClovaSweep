//! Launch-at-login management.
//!
//! Backed by the official `tauri-plugin-autostart`, which registers a macOS
//! login item / Windows Run-key entry without any hand-rolled native code.
//! Failures are swallowed (some managed machines forbid it) and surfaced
//! only via `is_enabled`.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

pub fn is_enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Apply the desired state. Returns the effective state after applying.
pub fn set_enabled(app: &AppHandle, enabled: bool) -> bool {
    let mgr = app.autolaunch();
    let _ = if enabled { mgr.enable() } else { mgr.disable() };
    is_enabled(app)
}
