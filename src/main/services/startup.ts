/**
 * Launch-at-login management.
 *
 * Uses Electron's cross-platform login-item API, which registers a macOS login
 * item / Windows Run key without any extra native code. Failures are swallowed
 * (some managed machines forbid it) and surfaced only via getEnabled().
 */
import { app } from 'electron'

export class StartupManager {
  isSupported(): boolean {
    return process.platform === 'darwin' || process.platform === 'win32'
  }

  getEnabled(): boolean {
    if (!this.isSupported()) return false
    try {
      return app.getLoginItemSettings().openAtLogin
    } catch {
      return false
    }
  }

  /** Apply the desired state. Returns the effective state after applying. */
  setEnabled(enabled: boolean, startMinimized: boolean): boolean {
    if (!this.isSupported()) return false
    try {
      if (process.platform === 'win32') {
        app.setLoginItemSettings({
          openAtLogin: enabled,
          path: process.execPath,
          args: startMinimized ? ['--hidden'] : []
        })
      } else {
        app.setLoginItemSettings({
          openAtLogin: enabled,
          openAsHidden: startMinimized
        })
      }
    } catch {
      /* not permitted */
    }
    return this.getEnabled()
  }
}
