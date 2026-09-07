/**
 * Application services facade.
 *
 * The single high-level API the IPC layer talks to. It ties together the
 * persistent store, the platform abstraction, the pure filter/analytics and the
 * sweep executor, and is the only place cleanup deletions happen (always gated
 * by the tested `cleanupSafety` guards).
 */
import { promises as fs } from 'node:fs'
import { shell } from 'electron'
import type {
  AnalyticsSummary,
  AppIdentity,
  CleanupItem,
  CleanupResult,
  CleanupScan,
  OverviewSnapshot,
  Platform,
  ProtectedApp,
  RunningApp,
  Settings,
  SweepPreview,
  SweepResult
} from '@shared/types'
import { aggregateAnalytics } from '../core/analytics'
import { buildPreview, classifyApps } from '../core/filter'
import { canDeletePath, filterDeletable } from '../core/cleanupSafety'
import { deriveAppId, normalizeRunningApps, toAppIdentity } from '../core/identity'
import { sizeOfPath } from '../platform/fsutil'
import type { PlatformServices } from '../platform'
import { executeSweep } from './sweepService'
import type { Store } from './store'

export interface AppServicesOptions {
  selfBundleId?: string
  selfName?: string
  ownPids?: number[]
}

export class AppServices {
  readonly platformName: Platform
  private readonly selfIds: Set<string>
  private readonly ownPids: Set<number>

  constructor(
    private readonly store: Store,
    private readonly platform: PlatformServices,
    opts: AppServicesOptions = {}
  ) {
    this.platformName = process.platform as Platform
    this.selfIds = new Set(
      [
        opts.selfBundleId ? `bundle:${opts.selfBundleId.toLowerCase()}` : undefined,
        'bundle:com.clova.clovasweep',
        'bundle:com.github.electron', // dev
        opts.selfName ? `name:${opts.selfName.toLowerCase()}` : undefined,
        'name:clovasweep',
        'name:electron'
      ].filter((x): x is string => Boolean(x))
    )
    this.ownPids = new Set(opts.ownPids ?? [process.pid])
  }

  // --- Protected sets ---
  private protectedSets(): { protectedIds: Set<string>; protectedSecondary: Set<string> } {
    const protectedIds = new Set<string>()
    const protectedSecondary = new Set<string>()
    for (const p of this.store.getProtected()) {
      protectedIds.add(p.id)
      if (p.bundleId) protectedSecondary.add(`bundle:${p.bundleId.toLowerCase()}`)
      if (p.path) protectedSecondary.add(`path:${p.path}`)
    }
    return { protectedIds, protectedSecondary }
  }

  // --- Discovery + classification (single source of truth) ---
  private async classify() {
    const raw = await this.platform.discovery.list()
    let apps = normalizeRunningApps(raw, this.platformName)
    apps = apps.filter((a) => !a.pids.some((p) => this.ownPids.has(p)))
    const { protectedIds, protectedSecondary } = this.protectedSets()
    const classification = classifyApps({
      apps,
      protectedIds,
      protectedSecondary,
      selfIds: this.selfIds,
      settings: this.store.getSettings(),
      platform: this.platformName
    })
    return { apps, classification, protectedIds, protectedSecondary }
  }

  async listRunningApps(): Promise<RunningApp[]> {
    const { classification } = await this.classify()
    const all = [
      ...classification.wouldClose,
      ...classification.protectedRunning,
      ...classification.systemExcluded.filter((a) => !a.isSelf)
    ]
    return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }

  async getSweepPreview(): Promise<SweepPreview> {
    const { apps, protectedIds, protectedSecondary } = await this.classify()
    return buildPreview({
      apps,
      protectedIds,
      protectedSecondary,
      selfIds: this.selfIds,
      settings: this.store.getSettings(),
      platform: this.platformName
    })
  }

  async sweep(options: { dryRun?: boolean } = {}): Promise<SweepResult> {
    const { protectedIds, protectedSecondary } = this.protectedSets()
    const result = await executeSweep({
      discovery: this.platform.discovery,
      terminator: this.platform.terminator,
      settings: this.store.getSettings(),
      protectedIds,
      protectedSecondary,
      selfIds: this.selfIds,
      platform: this.platformName,
      ownPids: this.ownPids,
      dryRun: options.dryRun
    })
    if (!result.record.dryRun) this.store.addSweep(result.record)
    return result
  }

  // --- Protected apps ---
  getProtectedApps(): ProtectedApp[] {
    return this.store.getProtected()
  }

  protectApp(app: AppIdentity): ProtectedApp[] {
    const identity = toAppIdentity({ ...app, name: app.name }, this.platformName)
    const id = identity.id || deriveAppId(app, this.platformName)
    return this.store.addProtected({ ...identity, id, addedAt: new Date().toISOString() })
  }

  unprotectApp(id: string): ProtectedApp[] {
    return this.store.removeProtected(id)
  }

  // --- Icons ---
  getAppIcon(app: { id: string; path?: string; bundleId?: string }): Promise<string | null> {
    return this.platform.icons.getIcon(app)
  }

  // --- Settings ---
  getSettings(): Settings {
    return this.store.getSettings()
  }

  updateSettings(patch: Partial<Settings>): Settings {
    return this.store.updateSettings(patch)
  }

  // --- Analytics ---
  getAnalytics(): AnalyticsSummary {
    return aggregateAnalytics(this.store.getSweeps())
  }

  resetAnalytics(): AnalyticsSummary {
    this.store.clearSweeps()
    return aggregateAnalytics(this.store.getSweeps())
  }

  // --- Overview ---
  async getOverview(): Promise<OverviewSnapshot> {
    const [{ apps, protectedIds, protectedSecondary }, storage] = await Promise.all([
      this.classify(),
      this.platform.storage.getStorage().catch(() => undefined)
    ])
    const settings = this.store.getSettings()
    const preview = buildPreview({
      apps,
      protectedIds,
      protectedSecondary,
      selfIds: this.selfIds,
      settings,
      platform: this.platformName
    })
    const analytics = this.getAnalytics()
    const protectedRunningCount = preview.protectedRunning.length
    return {
      runningCount: preview.wouldClose.length + protectedRunningCount + preview.systemExcluded.length,
      protectedRunningCount,
      wouldCloseCount: preview.wouldClose.length,
      preview,
      lastSweepAt: analytics.lastSweepAt,
      lastSweepClosed: analytics.lastSweepClosed,
      analytics,
      storage,
      settings,
      platform: this.platformName
    }
  }

  // --- Cleanup ---
  async scanCleanup(): Promise<CleanupScan> {
    const [storage, categories] = await Promise.all([
      this.platform.storage.getStorage(),
      this.platform.storage.scanCategories()
    ])
    return {
      storage,
      categories,
      disabledSmartCategories: this.store.getCleanupPrefs().disabledSmartCategories,
      scannedAt: new Date().toISOString()
    }
  }

  listCleanupItems(categoryId: string): Promise<CleanupItem[]> {
    return this.platform.storage.listItems(categoryId)
  }

  /** Review cleanup: move the selected items to the Trash/Recycle Bin (reversible). */
  async runCleanup(payload: { categoryId: string; paths: string[] }): Promise<CleanupResult> {
    const roots = this.platform.storage.allowedRootsFor(payload.categoryId)
    const home = this.platform.storage.home
    const { safe, rejected } = filterDeletable(payload.paths, { allowedRoots: roots, home, platform: this.platformName })
    const result: CleanupResult = {
      reclaimedBytes: 0,
      removedCount: 0,
      failed: rejected.map((p) => ({ path: p, reason: 'Outside the allowed cleanup area' }))
    }
    for (const p of safe) {
      try {
        const size = await sizeOfPath(p)
        await shell.trashItem(p)
        result.reclaimedBytes += size
        result.removedCount += 1
      } catch (err) {
        result.failed.push({ path: p, reason: err instanceof Error ? err.message : 'Failed to move to Trash' })
      }
    }
    return result
  }

  /** Smart cleanup: clear rebuildable safe categories and empty the OS bin. */
  async runSmartCleanup(): Promise<CleanupResult> {
    const prefs = this.store.getCleanupPrefs()
    const disabled = new Set(prefs.disabledSmartCategories)
    const categories = await this.platform.storage.scanCategories()
    const home = this.platform.storage.home
    const result: CleanupResult = { reclaimedBytes: 0, removedCount: 0, failed: [] }

    for (const cat of categories) {
      if (!cat.smartEligible || disabled.has(cat.id) || cat.unavailable) continue

      if (cat.risk === 'system') {
        try {
          const r = await this.platform.storage.emptyTrash()
          result.reclaimedBytes += r.reclaimedBytes
          result.removedCount += r.removedCount
        } catch (err) {
          result.failed.push({ path: cat.title, reason: err instanceof Error ? err.message : 'Failed' })
        }
        continue
      }

      if (cat.risk === 'safe') {
        const roots = this.platform.storage.allowedRootsFor(cat.id)
        const items = await this.platform.storage.listItems(cat.id)
        for (const item of items) {
          if (!canDeletePath(item.path, { allowedRoots: roots, home, platform: this.platformName })) {
            result.failed.push({ path: item.path, reason: 'Blocked by safety guard' })
            continue
          }
          try {
            await fs.rm(item.path, { recursive: true, force: true })
            result.reclaimedBytes += item.sizeBytes
            result.removedCount += 1
          } catch (err) {
            result.failed.push({ path: item.path, reason: err instanceof Error ? err.message : 'Failed to remove' })
          }
        }
      }
    }
    return result
  }

  async emptyTrash(): Promise<CleanupResult> {
    const r = await this.platform.storage.emptyTrash()
    return { reclaimedBytes: r.reclaimedBytes, removedCount: r.removedCount, failed: [] }
  }

  // --- Cleanup prefs ---
  getCleanupPrefs() {
    return this.store.getCleanupPrefs()
  }

  setSmartCategoryEnabled(categoryId: string, enabled: boolean): void {
    const prefs = this.store.getCleanupPrefs()
    const set = new Set(prefs.disabledSmartCategories)
    if (enabled) set.delete(categoryId)
    else set.add(categoryId)
    this.store.setCleanupPrefs({ disabledSmartCategories: [...set] })
  }
}
