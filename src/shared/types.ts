/**
 * Shared type contract between the Electron main process, preload bridge and
 * the React renderer. These types are platform-neutral; platform-specific
 * details are normalised into these shapes before crossing the IPC boundary.
 */

export type Platform = 'darwin' | 'win32' | 'linux'

/**
 * A running, user-facing application as ClovaSweep understands it.
 *
 * `id` is the *stable* identity used everywhere (protection, analytics,
 * de-duplication). It is derived from the most durable platform identifier
 * available (macOS bundle id, Windows executable path) — never from the
 * display name alone, so two apps that share a display name (e.g. two
 * "ChatGPT" builds with different bundle ids) remain distinct.
 */
export interface RunningApp {
  /** Stable, platform-appropriate identity (see AppIdentity.id). */
  id: string
  /** Human-facing display name. */
  name: string
  /** All process ids currently backing this application (an app can have many). */
  pids: number[]
  /** macOS bundle identifier, when known. */
  bundleId?: string
  /** Filesystem path to the .app bundle (macOS) or .exe (Windows). */
  path?: string
  /** Windows-only: MSIX/UWP package family name, when the app is packaged. */
  packageId?: string
  /** True when this is the OS shell/file manager (Finder / File Explorer). */
  isFileManager?: boolean
  /** True when ClovaSweep classifies this as a protected-by-user app. */
  protected?: boolean
  /** True when ClovaSweep classifies this as system-critical (never swept). */
  system?: boolean
  /** True when this app is ClovaSweep itself. */
  isSelf?: boolean
}

/** The durable identity of an application, independent of a single run. */
export interface AppIdentity {
  id: string
  name: string
  bundleId?: string
  path?: string
  packageId?: string
}

/** A user-protected application, persisted between launches. */
export interface ProtectedApp extends AppIdentity {
  /** ISO timestamp of when protection was added. */
  addedAt: string
}

/** How a single application fared during a sweep. */
export type SweepAppOutcome = 'closed' | 'failed' | 'timeout' | 'skipped'

export interface SweepAppResult {
  id: string
  name: string
  bundleId?: string
  path?: string
  outcome: SweepAppOutcome
  /** Human-readable reason for a non-'closed' outcome. */
  detail?: string
}

/** A recorded sweep, persisted for history & analytics. */
export interface SweepRecord {
  id: string
  /** ISO timestamp when the sweep started. */
  timestamp: string
  /** Milliseconds the sweep took end to end. */
  durationMs: number
  /** Number of apps successfully closed. */
  closedCount: number
  /** Per-app results. */
  results: SweepAppResult[]
  /** Whether this was a dry run (nothing was actually terminated). */
  dryRun: boolean
}

/** Result returned to the UI immediately after a sweep. */
export interface SweepResult {
  record: SweepRecord
  /** Apps that were skipped because they are protected. */
  protectedSkipped: number
  /** Apps that were skipped because they are system/self. */
  systemSkipped: number
}

/** What the next sweep *would* do, computed without side effects. */
export interface SweepPreview {
  wouldClose: RunningApp[]
  protectedRunning: RunningApp[]
  systemExcluded: RunningApp[]
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type ThemePreference = 'system' | 'light' | 'dark'
export type UnresponsiveBehavior = 'skip' | 'force'

export interface Settings {
  // General
  launchAtLogin: boolean
  startMinimized: boolean
  showNotificationAfterSweep: boolean
  confirmBeforeSweep: boolean
  /** When true, a left-click on the tray opens the dashboard instead of sweeping. */
  clickOpensDashboard: boolean

  // Sweep behaviour
  closeUserApps: boolean
  /** macOS: close Finder windows during a sweep (Finder app itself is never quit). */
  closeFinderWindows: boolean
  /** Windows: close File Explorer windows during a sweep (Explorer shell is never killed). */
  closeExplorerWindows: boolean
  /** Milliseconds to wait for a graceful quit before deciding an app is unresponsive. */
  gracefulTimeoutMs: number
  /** What to do with apps that do not quit gracefully within the timeout. */
  unresponsiveBehavior: UnresponsiveBehavior

  // Appearance
  theme: ThemePreference

  // Meta
  /** Schema version for migrations. */
  schemaVersion: number
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface AppCloseStat {
  id: string
  name: string
  count: number
}

export interface AnalyticsSummary {
  totalSweeps: number
  totalAppsClosed: number
  averagePerSweep: number
  uniqueAppsClosed: number
  mostClosed: AppCloseStat[]
  lastSweepAt?: string
  lastSweepClosed?: number
  /** Rough estimate of workspace clutter reduced (closed windows-worth). */
  estimatedClutterReduced: number
  recent: SweepRecord[]
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export interface StorageInfo {
  totalBytes: number
  usedBytes: number
  freeBytes: number
  /** Filesystem/volume the numbers describe (e.g. "/" or "C:"). */
  volume: string
}

/**
 * How risky a cleanup category is. This drives the UI safety affordances:
 * - `safe`     : can be included in Smart Cleanup without individual review.
 * - `review`   : must be reviewed item-by-item before anything is removed.
 * - `system`   : hands off to the OS (e.g. empty Trash / Recycle Bin).
 */
export type CleanupRisk = 'safe' | 'review' | 'system'

export interface CleanupCategory {
  id: string
  title: string
  description: string
  risk: CleanupRisk
  /** Whether this category is eligible for Smart/Quick cleanup by default. */
  smartEligible: boolean
  /** Bytes reclaimable, best-effort. */
  sizeBytes: number
  /** Number of discrete items (files/folders) in this category. */
  itemCount: number
  /** True when the category could not be scanned (permission, unavailable). */
  unavailable?: boolean
  detail?: string
}

export interface CleanupItem {
  /** Absolute path (review categories) or an opaque handle (system categories). */
  path: string
  name: string
  sizeBytes: number
  modifiedAt?: string
  isDirectory: boolean
  categoryId: string
}

export interface CleanupScan {
  storage: StorageInfo
  categories: CleanupCategory[]
  scannedAt: string
}

export interface CleanupResult {
  reclaimedBytes: number
  removedCount: number
  failed: { path: string; reason: string }[]
}

// ---------------------------------------------------------------------------
// IPC surface (exposed to the renderer via the preload bridge)
// ---------------------------------------------------------------------------

export interface OverviewSnapshot {
  runningCount: number
  protectedRunningCount: number
  wouldCloseCount: number
  preview: SweepPreview
  lastSweepAt?: string
  lastSweepClosed?: number
  analytics: AnalyticsSummary
  storage?: StorageInfo
  settings: Settings
  platform: Platform
}

/** The typed API surfaced on `window.clova`. */
export interface ClovaApi {
  platform: Platform
  getVersion(): Promise<string>

  // Apps & sweep
  listRunningApps(): Promise<RunningApp[]>
  getSweepPreview(): Promise<SweepPreview>
  sweep(options?: { dryRun?: boolean }): Promise<SweepResult>
  getOverview(): Promise<OverviewSnapshot>

  // Protected apps
  getProtectedApps(): Promise<ProtectedApp[]>
  protectApp(app: AppIdentity): Promise<ProtectedApp[]>
  unprotectApp(id: string): Promise<ProtectedApp[]>

  // Icons
  getAppIcon(app: { id: string; path?: string; bundleId?: string }): Promise<string | null>

  // Settings
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>

  // Analytics
  getAnalytics(): Promise<AnalyticsSummary>
  resetAnalytics(): Promise<AnalyticsSummary>

  // Cleanup
  scanCleanup(): Promise<CleanupScan>
  listCleanupItems(categoryId: string): Promise<CleanupItem[]>
  runSmartCleanup(): Promise<CleanupResult>
  runCleanup(payload: { categoryId: string; paths: string[] }): Promise<CleanupResult>
  emptyTrash(): Promise<CleanupResult>

  // Window
  openDashboard(section?: string): void
  quitApp(): void

  // Events (main -> renderer)
  onNavigate(cb: (section: string) => void): () => void
  onSweepComplete(cb: (result: SweepResult) => void): () => void
  onDataChanged(cb: () => void): () => void
}

declare global {
  interface Window {
    clova: ClovaApi
  }
}
