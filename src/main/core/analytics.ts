/**
 * Analytics aggregation.
 *
 * All metrics are derived from the persisted sweep history — we never invent
 * numbers. App identity is taken from the stable sweep-result id, so the same
 * application is never double-counted because a path or process changed.
 *
 * Pure module — fully unit-testable.
 */
import type { AnalyticsSummary, AppCloseStat, SweepRecord } from '@shared/types'

export interface AggregateOptions {
  /** How many "most closed" apps to return. */
  topN?: number
  /** How many recent records to include. */
  recentN?: number
}

/**
 * Aggregate a list of sweep records (any order) into a summary. Dry-run
 * records are excluded from all statistics.
 */
export function aggregateAnalytics(records: SweepRecord[], opts: AggregateOptions = {}): AnalyticsSummary {
  const topN = opts.topN ?? 5
  const recentN = opts.recentN ?? 10

  const real = records.filter((r) => !r.dryRun)
  const sorted = [...real].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  const totalSweeps = real.length
  let totalAppsClosed = 0
  const perApp = new Map<string, AppCloseStat>()

  for (const rec of real) {
    for (const res of rec.results) {
      if (res.outcome !== 'closed') continue
      totalAppsClosed += 1
      const existing = perApp.get(res.id)
      if (existing) {
        existing.count += 1
        if (!existing.name && res.name) existing.name = res.name
      } else {
        perApp.set(res.id, { id: res.id, name: res.name || res.id, count: 1 })
      }
    }
  }

  const mostClosed = [...perApp.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, topN)

  const averagePerSweep = totalSweeps === 0 ? 0 : totalAppsClosed / totalSweeps
  const last = sorted[0]

  return {
    totalSweeps,
    totalAppsClosed,
    averagePerSweep: Math.round(averagePerSweep * 10) / 10,
    uniqueAppsClosed: perApp.size,
    mostClosed,
    lastSweepAt: last?.timestamp,
    lastSweepClosed: last?.closedCount,
    // Each closed app is roughly one window-worth of workspace clutter removed.
    estimatedClutterReduced: totalAppsClosed,
    recent: sorted.slice(0, recentN)
  }
}
