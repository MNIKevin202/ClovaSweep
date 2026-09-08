//! macOS application termination.
//!
//! Graceful quit uses `NSRunningApplication.terminate()`, which posts a
//! proper "quit" request (equivalent to Cmd+Q) so apps can save state and
//! close windows cleanly — far better than signalling the process directly.
//! Force quit is a last resort, only used when the user explicitly opts in
//! for unresponsive apps. The Finder shell is never quit; its windows are
//! closed via AppleScript.

use super::{run_applescript, run_jxa};
use crate::platform::ApplicationTerminator;
use crate::types::RunningApp;

fn quit_script(pids: &[u32], force: bool) -> String {
    let pids_json = serde_json::to_string(pids).unwrap_or_else(|_| "[]".into());
    let method = if force { "app.forceTerminate" } else { "app.terminate" };
    format!(
        r#"
ObjC.import('AppKit');
(function () {{
  const pids = {pids_json};
  for (const pid of pids) {{
    const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
    if (!app || app.isNil() || app.isTerminated) continue;
    {method};
  }}
  return '';
}})();
"#
    )
}

pub struct MacTerminator;

impl ApplicationTerminator for MacTerminator {
    fn request_quit(&self, app: &RunningApp) {
        if app.pids.is_empty() {
            return;
        }
        if run_jxa(&quit_script(&app.pids, false)).is_err() {
            // Fall back to a polite SIGTERM if the bridge is unavailable.
            for &pid in &app.pids {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
            }
        }
    }

    fn force_quit(&self, app: &RunningApp) {
        if app.pids.is_empty() {
            return;
        }
        if run_jxa(&quit_script(&app.pids, true)).is_err() {
            for &pid in &app.pids {
                unsafe {
                    libc::kill(pid as i32, libc::SIGKILL);
                }
            }
        }
    }

    fn close_file_manager_windows(&self) {
        let _ = run_applescript(r#"tell application "Finder" to close every window"#);
    }
}
