/**
 * Persistence schema + migrations.
 *
 * The on-disk store is a single JSON document. All reads go through these pure
 * migration/validation functions so a corrupt, partial, or older file can
 * never crash ClovaSweep — it is repaired into a valid, current-version state.
 *
 * Pure module — fully unit-testable.
 */
import type { ProtectedApp, Settings, SweepRecord } from '@shared/types'
import { DEFAULT_SETTINGS, MAX_SWEEP_HISTORY, SETTINGS_SCHEMA_VERSION } from '@shared/defaults'

/** Top-level persisted store version (bump + migrate when the shape changes). */
export const STORE_VERSION = 1

export interface CleanupPrefs {
  /** Category ids the user has opted OUT of Smart Cleanup. */
  disabledSmartCategories: string[]
}

export interface PersistedState {
  version: number
  settings: Settings
  protectedApps: ProtectedApp[]
  sweeps: SweepRecord[]
  cleanup: CleanupPrefs
}

export function emptyState(): PersistedState {
  return {
    version: STORE_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    protectedApps: [],
    sweeps: [],
    cleanup: { disabledSmartCategories: [] }
  }
}

function coerceBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function coerceNumber(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.min(max, Math.max(min, n))
}

function coerceEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

/** Validate & migrate an arbitrary object into a complete Settings. */
export function migrateSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  return {
    launchAtLogin: coerceBool(r.launchAtLogin, d.launchAtLogin),
    startMinimized: coerceBool(r.startMinimized, d.startMinimized),
    showNotificationAfterSweep: coerceBool(r.showNotificationAfterSweep, d.showNotificationAfterSweep),
    confirmBeforeSweep: coerceBool(r.confirmBeforeSweep, d.confirmBeforeSweep),
    clickOpensDashboard: coerceBool(r.clickOpensDashboard, d.clickOpensDashboard),
    closeUserApps: coerceBool(r.closeUserApps, d.closeUserApps),
    closeFinderWindows: coerceBool(r.closeFinderWindows, d.closeFinderWindows),
    closeExplorerWindows: coerceBool(r.closeExplorerWindows, d.closeExplorerWindows),
    gracefulTimeoutMs: coerceNumber(r.gracefulTimeoutMs, d.gracefulTimeoutMs, 500, 60000),
    unresponsiveBehavior: coerceEnum(r.unresponsiveBehavior, ['skip', 'force'] as const, d.unresponsiveBehavior),
    theme: coerceEnum(r.theme, ['system', 'light', 'dark'] as const, d.theme),
    schemaVersion: SETTINGS_SCHEMA_VERSION
  }
}

function migrateProtectedApps(raw: unknown): ProtectedApp[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ProtectedApp[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : undefined
    const name = typeof r.name === 'string' ? r.name : undefined
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name,
      bundleId: typeof r.bundleId === 'string' ? r.bundleId : undefined,
      path: typeof r.path === 'string' ? r.path : undefined,
      packageId: typeof r.packageId === 'string' ? r.packageId : undefined,
      addedAt: typeof r.addedAt === 'string' ? r.addedAt : new Date().toISOString()
    })
  }
  return out
}

function migrateSweeps(raw: unknown): SweepRecord[] {
  if (!Array.isArray(raw)) return []
  const out: SweepRecord[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'string' || typeof r.timestamp !== 'string') continue
    out.push({
      id: r.id,
      timestamp: r.timestamp,
      durationMs: typeof r.durationMs === 'number' ? r.durationMs : 0,
      closedCount: typeof r.closedCount === 'number' ? r.closedCount : 0,
      dryRun: coerceBool(r.dryRun, false),
      results: Array.isArray(r.results)
        ? (r.results as unknown[]).flatMap((x) => {
            if (!x || typeof x !== 'object') return []
            const rr = x as Record<string, unknown>
            if (typeof rr.id !== 'string' || typeof rr.name !== 'string') return []
            return [{
              id: rr.id,
              name: rr.name,
              bundleId: typeof rr.bundleId === 'string' ? rr.bundleId : undefined,
              path: typeof rr.path === 'string' ? rr.path : undefined,
              outcome: coerceEnum(rr.outcome, ['closed', 'failed', 'timeout', 'skipped'] as const, 'closed'),
              detail: typeof rr.detail === 'string' ? rr.detail : undefined
            }]
          })
        : []
    })
  }
  // Keep only the most recent MAX_SWEEP_HISTORY, newest first.
  return out
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, MAX_SWEEP_HISTORY)
}

function migrateCleanup(raw: unknown): CleanupPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const disabled = Array.isArray(r.disabledSmartCategories)
    ? r.disabledSmartCategories.filter((x): x is string => typeof x === 'string')
    : []
  return { disabledSmartCategories: disabled }
}

/**
 * Migrate an arbitrary parsed JSON value into a valid, current PersistedState.
 * Never throws.
 */
export function migrateState(raw: unknown): PersistedState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    version: STORE_VERSION,
    settings: migrateSettings(r.settings),
    protectedApps: migrateProtectedApps(r.protectedApps),
    sweeps: migrateSweeps(r.sweeps),
    cleanup: migrateCleanup(r.cleanup)
  }
}
