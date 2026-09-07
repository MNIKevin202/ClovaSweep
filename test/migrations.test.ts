import { describe, expect, it } from 'vitest'
import { emptyState, migrateSettings, migrateState, STORE_VERSION } from '../src/main/core/migrations'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../src/shared/defaults'

describe('migrateSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(migrateSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(migrateSettings(42)).toEqual(DEFAULT_SETTINGS)
  })

  it('preserves valid values and fills gaps with defaults', () => {
    const s = migrateSettings({ theme: 'dark', confirmBeforeSweep: true })
    expect(s.theme).toBe('dark')
    expect(s.confirmBeforeSweep).toBe(true)
    expect(s.closeUserApps).toBe(DEFAULT_SETTINGS.closeUserApps)
    expect(s.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
  })

  it('rejects invalid enums and clamps numbers', () => {
    const s = migrateSettings({ theme: 'purple', unresponsiveBehavior: 'nuke', gracefulTimeoutMs: 9_000_000 })
    expect(s.theme).toBe('system')
    expect(s.unresponsiveBehavior).toBe('skip')
    expect(s.gracefulTimeoutMs).toBe(60000)
  })

  it('clamps a too-small timeout up to the minimum', () => {
    expect(migrateSettings({ gracefulTimeoutMs: 1 }).gracefulTimeoutMs).toBe(500)
  })
})

describe('migrateState', () => {
  it('produces a valid empty state from nothing', () => {
    const s = migrateState(undefined)
    expect(s).toEqual(emptyState())
    expect(s.version).toBe(STORE_VERSION)
  })

  it('de-duplicates protected apps by id and drops invalid ones', () => {
    const s = migrateState({
      protectedApps: [
        { id: 'bundle:a', name: 'A', addedAt: '2026-01-01T00:00:00Z' },
        { id: 'bundle:a', name: 'A dup' },
        { id: 'bundle:b', name: 'B' },
        { name: 'no id' },
        null
      ]
    })
    expect(s.protectedApps.map((p) => p.id)).toEqual(['bundle:a', 'bundle:b'])
    // Missing addedAt is backfilled.
    expect(typeof s.protectedApps[1].addedAt).toBe('string')
  })

  it('keeps sweep history newest-first and drops malformed results', () => {
    const s = migrateState({
      sweeps: [
        { id: 'old', timestamp: '2026-01-01T00:00:00Z', closedCount: 1, results: [{ id: 'x', name: 'X', outcome: 'closed' }] },
        { id: 'new', timestamp: '2026-06-01T00:00:00Z', closedCount: 2, results: [{ bad: true }] },
        { missing: 'fields' }
      ]
    })
    expect(s.sweeps.map((r) => r.id)).toEqual(['new', 'old'])
    expect(s.sweeps[0].results).toEqual([]) // malformed result dropped
  })

  it('round-trips a valid state', () => {
    const original = emptyState()
    original.settings.theme = 'dark'
    original.protectedApps.push({ id: 'bundle:z', name: 'Z', addedAt: '2026-01-01T00:00:00Z' })
    const migrated = migrateState(JSON.parse(JSON.stringify(original)))
    expect(migrated.settings.theme).toBe('dark')
    expect(migrated.protectedApps).toEqual(original.protectedApps)
  })
})
