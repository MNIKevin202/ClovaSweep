/**
 * Windows application termination.
 *
 * Graceful quit sends WM_CLOSE via CloseMainWindow(), the proper way to ask a
 * Windows app to close (it may prompt to save). Force quit uses Stop-Process
 * and is only used when the user opts in for unresponsive apps. The Explorer
 * shell is never killed; its windows are closed via the Shell.Application COM
 * object so the taskbar/desktop stay intact.
 */
import type { RunningApp } from '@shared/types'
import type { ApplicationTerminator } from '../types'
import { runPowershell } from '../util'

/** Sanitise pids to a safe comma-separated numeric list for interpolation. */
function pidList(pids: number[]): string {
  return pids.filter((p) => Number.isInteger(p) && p > 0).join(',')
}

export class WindowsTerminator implements ApplicationTerminator {
  async requestQuit(app: RunningApp): Promise<void> {
    const ids = pidList(app.pids)
    if (!ids) return
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
foreach ($id in @(${ids})) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p) { [void]$p.CloseMainWindow() }
}
`
    try {
      await runPowershell(script, { timeoutMs: 8000 })
    } catch {
      /* best effort; sweep service re-checks liveness */
    }
  }

  async forceQuit(app: RunningApp): Promise<void> {
    const ids = pidList(app.pids)
    if (!ids) return
    const script = `Stop-Process -Id @(${ids}) -Force -ErrorAction SilentlyContinue`
    try {
      await runPowershell(script, { timeoutMs: 8000 })
    } catch {
      /* best effort */
    }
  }

  async closeFileManagerWindows(): Promise<void> {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$shell = New-Object -ComObject Shell.Application
foreach ($w in @($shell.Windows())) {
  try {
    $name = $w.Name
    if ($name -eq 'File Explorer' -or $name -eq 'Windows Explorer') { $w.Quit() }
  } catch {}
}
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
`
    try {
      await runPowershell(script, { timeoutMs: 8000 })
    } catch {
      /* optional */
    }
  }
}
