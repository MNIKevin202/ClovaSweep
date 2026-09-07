/**
 * macOS application termination.
 *
 * Graceful quit uses `NSRunningApplication.terminate()`, which posts a proper
 * "quit" request (equivalent to ⌘Q) so apps can save state and close windows
 * cleanly — far better than signalling the process directly. Force quit is a
 * last resort, only used when the user explicitly opts in for unresponsive
 * apps. The Finder shell is never quit; its windows are closed via AppleScript.
 */
import type { RunningApp } from '@shared/types'
import type { ApplicationTerminator } from '../types'
import { run, runJxa, safeJsonForSource } from '../util'

function quitScript(pids: number[], force: boolean): string {
  return `
ObjC.import('AppKit');
(function () {
  const pids = ${safeJsonForSource(pids)};
  const results = [];
  for (const pid of pids) {
    const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
    if (!app || app.isNil()) { results.push([pid, 'gone']); continue; }
    if (app.isTerminated) { results.push([pid, 'gone']); continue; }
    const ok = ${force ? 'app.forceTerminate' : 'app.terminate'};
    results.push([pid, ok ? 'requested' : 'failed']);
  }
  return JSON.stringify(results);
})();
`
}

export class MacTerminator implements ApplicationTerminator {
  async requestQuit(app: RunningApp): Promise<void> {
    if (!app.pids.length) return
    try {
      await runJxa(quitScript(app.pids, false), { timeoutMs: 8000 })
    } catch {
      // Fall back to a polite SIGTERM if the bridge is unavailable.
      for (const pid of app.pids) {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          /* already gone */
        }
      }
    }
  }

  async forceQuit(app: RunningApp): Promise<void> {
    if (!app.pids.length) return
    try {
      await runJxa(quitScript(app.pids, true), { timeoutMs: 8000 })
    } catch {
      for (const pid of app.pids) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* already gone */
        }
      }
    }
  }

  async closeFileManagerWindows(): Promise<void> {
    try {
      await run('osascript', ['-e', 'tell application "Finder" to close every window'], { timeoutMs: 6000 })
    } catch {
      // Automation permission may be denied; closing Finder windows is optional.
    }
  }
}
