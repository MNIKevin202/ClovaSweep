/**
 * System-safety classification.
 *
 * ClovaSweep must never behave like "enumerate every process and kill
 * everything". The primary defence is *discovery* — on each platform we only
 * ever enumerate user-facing applications (macOS: regular activation policy;
 * Windows: processes owning a visible top-level window). This module is the
 * second line of defence: given an app that slipped through discovery, decide
 * whether it is a system-critical shell component that must never be swept.
 *
 * We prefer robust identification (bundle-id namespace, executable location)
 * over a giant hardcoded list, but keep a small, well-understood backstop set
 * of names for the handful of windowed OS components.
 *
 * Pure module — no Electron / OS access — fully unit-testable.
 */
import type { Platform, RunningApp } from '@shared/types'

/**
 * macOS bundle ids that are user-facing (regular policy) yet are shell/system
 * components we must never quit. Most OS agents are accessory-policy and are
 * already excluded at discovery; this is a conservative backstop.
 */
export const MAC_CRITICAL_BUNDLES: ReadonlySet<string> = new Set([
  'com.apple.finder', // file manager — special handling (windows only)
  'com.apple.loginwindow',
  'com.apple.dock',
  'com.apple.systemuiserver',
  'com.apple.controlcenter',
  'com.apple.notificationcenterui',
  'com.apple.wallpaper.agent',
  'com.apple.windowmanager',
  'com.apple.spotlight',
  'com.apple.coreservices.uiagent',
  'com.apple.universalcontrol',
  'com.apple.textinputmenuagent',
  'com.apple.powerchime'
])

/** macOS file manager bundle id. */
export const MAC_FINDER = 'com.apple.finder'

/**
 * Windows process names (lower-case, no extension) that are session/shell
 * critical. Killing any of these can log the user out or break the desktop.
 */
export const WIN_CRITICAL_NAMES: ReadonlySet<string> = new Set([
  // Session / kernel-adjacent
  'system', 'idle', 'registry', 'memory compression',
  'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'smss',
  'svchost', 'fontdrvhost', 'dwm', 'spoolsv', 'taskhostw', 'taskhost',
  'sihost', 'ctfmon', 'conhost', 'dllhost', 'rundll32', 'wmiprvse',
  'werfault', 'werfaultsecure', 'audiodg', 'logonui', 'wudfhost',
  // Shell / UI hosts
  'explorer', // file manager — special handling (windows only)
  'shellexperiencehost', 'startmenuexperiencehost', 'searchhost',
  'searchapp', 'searchui', 'textinputhost', 'applicationframehost',
  'systemsettings', 'lockapp', 'runtimebroker', 'widgets',
  'widgetservice', 'phoneexperiencehost', 'useroobebroker',
  'backgroundtaskhost', 'gamebar', 'gamebarftserver',
  // Security surface
  'securityhealthsystray', 'securityhealthservice', 'msmpeng', 'nissrv'
])

/** Windows file manager process name. */
export const WIN_EXPLORER = 'explorer'

/** Strip a trailing `.exe`/`.app` and lower-case a process/app name. */
export function baseName(name: string): string {
  return name.trim().toLowerCase().replace(/\.(exe|app)$/i, '')
}

/**
 * True when a Windows executable path is inside an OS system location.
 * User-installed apps live in Program Files, AppData, or WindowsApps (Store),
 * none of which match here.
 */
export function isWindowsSystemPath(path: string | undefined): boolean {
  if (!path) return false
  const p = path.replace(/\//g, '\\').toLowerCase()
  // WindowsApps (Store apps) live under Program Files and are user-facing.
  if (p.includes('\\windowsapps\\')) return false
  return (
    /(^|\\)windows\\system32\\/.test(p) ||
    /(^|\\)windows\\syswow64\\/.test(p) ||
    /(^|\\)windows\\systemapps\\/.test(p) ||
    // Directly inside the Windows directory (e.g. C:\Windows\explorer.exe)
    /(^|[a-z]:)\\windows\\[^\\]+\.exe$/.test(p)
  )
}

/** Is this app the OS file manager (Finder / Explorer)? */
export function isFileManager(app: RunningApp, platform: Platform): boolean {
  if (app.isFileManager) return true
  if (platform === 'darwin') return (app.bundleId ?? '').toLowerCase() === MAC_FINDER
  if (platform === 'win32') return baseName(app.name) === WIN_EXPLORER
  return false
}

/**
 * Classify whether an app is system-critical (must never be terminated by a
 * sweep). File managers are considered system-critical for *termination*, but
 * the sweep service may still close their windows when the user opts in.
 */
export function isSystemCritical(app: RunningApp, platform: Platform): boolean {
  if (platform === 'darwin') {
    const bid = (app.bundleId ?? '').toLowerCase()
    if (bid && MAC_CRITICAL_BUNDLES.has(bid)) return true
    // Never touch things running from the immutable system volume core.
    return false
  }
  if (platform === 'win32') {
    if (WIN_CRITICAL_NAMES.has(baseName(app.name))) return true
    if (isWindowsSystemPath(app.path)) return true
    return false
  }
  return false
}
