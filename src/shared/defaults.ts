import type { Settings } from './types'

/** Current settings schema version. Bump when the shape changes + add a migration. */
export const SETTINGS_SCHEMA_VERSION = 1

export const DEFAULT_SETTINGS: Settings = {
  // General
  launchAtLogin: false,
  startMinimized: true,
  showNotificationAfterSweep: true,
  confirmBeforeSweep: false,
  clickOpensDashboard: false,

  // Sweep behaviour
  closeUserApps: true,
  closeFinderWindows: false,
  closeExplorerWindows: false,
  gracefulTimeoutMs: 4000,
  unresponsiveBehavior: 'skip',

  // Appearance
  theme: 'system',

  // Meta
  schemaVersion: SETTINGS_SCHEMA_VERSION
}

/** Maximum number of sweep records we retain for history/analytics. */
export const MAX_SWEEP_HISTORY = 200

/** Product identity. */
export const APP_ID = 'com.clova.clovasweep'
export const PRODUCT_NAME = 'ClovaSweep'
