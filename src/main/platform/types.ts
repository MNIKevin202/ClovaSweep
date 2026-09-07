/**
 * Platform abstraction interfaces.
 *
 * All OS-specific behaviour lives behind these interfaces so the sweep,
 * cleanup and icon services never branch on `process.platform`. macOS and
 * Windows provide concrete implementations; `getPlatformServices()` selects
 * the right set at runtime.
 */
import type {
  CleanupCategory,
  CleanupItem,
  RunningApp,
  StorageInfo,
  SweepAppResult
} from '@shared/types'
import type { RawApp } from '../core/identity'

/** Enumerates user-facing running applications (never daemons/agents). */
export interface ApplicationDiscovery {
  list(): Promise<RawApp[]>
}

export interface TerminateOptions {
  timeoutMs: number
  force: boolean
}

/** Gracefully closes applications, escalating only when explicitly allowed. */
export interface ApplicationTerminator {
  /** Send a graceful quit request to every process backing the app. */
  requestQuit(app: RunningApp): Promise<void>
  /** Forcefully terminate every process backing the app. */
  forceQuit(app: RunningApp): Promise<void>
  /** Close the file manager's windows without quitting the shell. */
  closeFileManagerWindows(): Promise<void>
}

/** Disk usage + safe cleanup categories. */
export interface StorageProvider {
  /** Root volume path used for disk-usage reporting ("/" or "C:\\"). */
  readonly volume: string
  /** The user's home directory (used by the deletion safety guard). */
  readonly home: string
  /** Total / used / free disk usage for the primary volume. */
  getStorage(): Promise<StorageInfo>
  /** Discover cleanup categories with best-effort sizes. */
  scanCategories(): Promise<CleanupCategory[]>
  /** The allowed deletion roots for a category (used by the safety guard). */
  allowedRootsFor(categoryId: string): string[]
  /** List the discrete items inside a category (for review). */
  listItems(categoryId: string): Promise<CleanupItem[]>
  /** Empty the OS trash / recycle bin. */
  emptyTrash(): Promise<{ reclaimedBytes: number; removedCount: number }>
}

/** Extracts application icons as PNG data URLs. */
export interface IconProvider {
  getIcon(app: { id: string; path?: string; bundleId?: string }): Promise<string | null>
}

export interface PlatformServices {
  discovery: ApplicationDiscovery
  terminator: ApplicationTerminator
  storage: StorageProvider
  icons: IconProvider
}

/** Convenience alias for terminator implementations. */
export type { SweepAppResult, CleanupCategory, CleanupItem }
