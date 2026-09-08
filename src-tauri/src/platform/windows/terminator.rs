//! Windows application termination.
//!
//! Graceful quit sends WM_CLOSE via CloseMainWindow(), the proper way to ask
//! a Windows app to close (it may prompt to save). Force quit uses
//! Stop-Process and is only used when the user opts in for unresponsive
//! apps. The Explorer shell is never killed; its windows are closed via the
//! Shell.Application COM object so the taskbar/desktop stay intact.

use super::run_powershell;
use crate::platform::ApplicationTerminator;
use crate::types::RunningApp;

fn pid_list(pids: &[u32]) -> String {
    pids.iter().map(u32::to_string).collect::<Vec<_>>().join(",")
}

pub struct WindowsTerminator;

impl ApplicationTerminator for WindowsTerminator {
    fn request_quit(&self, app: &RunningApp) {
        let ids = pid_list(&app.pids);
        if ids.is_empty() {
            return;
        }
        let script = format!(
            r#"
$ErrorActionPreference = 'SilentlyContinue'
foreach ($id in @({ids})) {{
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p) {{ [void]$p.CloseMainWindow() }}
}}
"#
        );
        let _ = run_powershell(&script);
    }

    fn force_quit(&self, app: &RunningApp) {
        let ids = pid_list(&app.pids);
        if ids.is_empty() {
            return;
        }
        let script = format!("Stop-Process -Id @({ids}) -Force -ErrorAction SilentlyContinue");
        let _ = run_powershell(&script);
    }

    fn close_file_manager_windows(&self) {
        let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$shell = New-Object -ComObject Shell.Application
foreach ($w in @($shell.Windows())) {
  try {
    $name = $w.Name
    if ($name -eq 'File Explorer' -or $name -eq 'Windows Explorer') { $w.Quit() }
  } catch {}
}
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
"#;
        let _ = run_powershell(script);
    }
}
