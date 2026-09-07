import { describe, expect, it } from 'vitest'
import { aggregateAnalytics } from '../src/main/core/analytics'
import type { SweepRecord } from '../src/shared/types'

const rec = (over: Partial<SweepRecord>): SweepRecord => ({
  id: over.id ?? Math.random().toString(36),
  timestamp: over.timestamp ?? new Date().toISOString(),
  durationMs: over.durationMs ?? 100,
  closedCount: over.closedCount ?? 0,
  dryRun: over.dryRun ?? false,
  results: over.results ?? []
})

describe('aggregateAnalytics', () => {
  it('returns zeroed summary for no records', () => {
    const s = aggregateAnalytics([])
    expect(s.totalSweeps).toBe(0)
    expect(s.totalAppsClosed).toBe(0)
    expect(s.averagePerSweep).toBe(0)
    expect(s.uniqueAppsClosed).toBe(0)
    expect(s.mostClosed).toEqual([])
    expect(s.lastSweepAt).toBeUndefined()
  })

  it('counts closed apps and computes averages', () => {
    const records = [
      rec({
        timestamp: '2026-01-01T10:00:00Z',
        closedCount: 2,
        results: [
          { id: 'bundle:a', name: 'A', outcome: 'closed' },
          { id: 'bundle:b', name: 'B', outcome: 'closed' }
        ]
      }),
      rec({
        timestamp: '2026-01-02T10:00:00Z',
        closedCount: 1,
        results: [
          { id: 'bundle:a', name: 'A', outcome: 'closed' },
          { id: 'bundle:c', name: 'C', outcome: 'failed' }
        ]
      })
    ]
    const s = aggregateAnalytics(records)
    expect(s.totalSweeps).toBe(2)
    expect(s.totalAppsClosed).toBe(3)
    expect(s.averagePerSweep).toBe(1.5)
    expect(s.uniqueAppsClosed).toBe(2) // A and B (C failed, not counted)
    expect(s.mostClosed[0]).toEqual({ id: 'bundle:a', name: 'A', count: 2 })
    expect(s.estimatedClutterReduced).toBe(3)
  })

  it('does not double-count the same app across sweeps by id', () => {
    const records = [
      rec({ results: [{ id: 'bundle:x', name: 'X', outcome: 'closed' }] }),
      rec({ results: [{ id: 'bundle:x', name: 'X', outcome: 'closed' }] }),
      rec({ results: [{ id: 'bundle:x', name: 'X', outcome: 'closed' }] })
    ]
    const s = aggregateAnalytics(records)
    expect(s.uniqueAppsClosed).toBe(1)
    expect(s.mostClosed[0].count).toBe(3)
  })

  it('excludes dry runs from all statistics', () => {
    const records = [
      rec({ dryRun: true, closedCount: 5, results: [{ id: 'bundle:a', name: 'A', outcome: 'closed' }] }),
      rec({ dryRun: false, closedCount: 1, results: [{ id: 'bundle:b', name: 'B', outcome: 'closed' }] })
    ]
    const s = aggregateAnalytics(records)
    expect(s.totalSweeps).toBe(1)
    expect(s.totalAppsClosed).toBe(1)
    expect(s.mostClosed.map((m) => m.id)).toEqual(['bundle:b'])
  })

  it('reports the most recent sweep and orders recent newest-first', () => {
    const records = [
      rec({ id: 'old', timestamp: '2026-01-01T00:00:00Z', closedCount: 1 }),
      rec({ id: 'new', timestamp: '2026-03-01T00:00:00Z', closedCount: 4 })
    ]
    const s = aggregateAnalytics(records)
    expect(s.lastSweepAt).toBe('2026-03-01T00:00:00Z')
    expect(s.lastSweepClosed).toBe(4)
    expect(s.recent[0].id).toBe('new')
  })
})
