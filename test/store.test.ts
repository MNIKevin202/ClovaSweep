import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../src/main/services/store'
import type { ProtectedApp, SweepRecord } from '../src/shared/types'
import { MAX_SWEEP_HISTORY } from '../src/shared/defaults'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'clova-store-'))
  file = path.join(dir, 'state.json')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const prot = (id: string, name: string): ProtectedApp => ({ id, name, addedAt: '2026-01-01T00:00:00Z' })
const sweep = (id: string, ts: string): SweepRecord => ({
  id,
  timestamp: ts,
  durationMs: 10,
  closedCount: 1,
  dryRun: false,
  results: [{ id: 'bundle:a', name: 'A', outcome: 'closed' }]
})

describe('Store persistence', () => {
  it('persists settings across instances', () => {
    const s1 = new Store(file)
    s1.updateSettings({ theme: 'dark', gracefulTimeoutMs: 8000 })
    const s2 = new Store(file)
    expect(s2.getSettings().theme).toBe('dark')
    expect(s2.getSettings().gracefulTimeoutMs).toBe(8000)
  })

  it('persists protected apps and de-dupes by id', () => {
    const s1 = new Store(file)
    s1.addProtected(prot('bundle:a', 'A'))
    s1.addProtected(prot('bundle:a', 'A again'))
    s1.addProtected(prot('bundle:b', 'B'))
    expect(s1.getProtected()).toHaveLength(2)
    const s2 = new Store(file)
    expect(s2.getProtected().map((p) => p.id).sort()).toEqual(['bundle:a', 'bundle:b'])
  })

  it('removes protection', () => {
    const s = new Store(file)
    s.addProtected(prot('bundle:a', 'A'))
    s.removeProtected('bundle:a')
    expect(s.getProtected()).toHaveLength(0)
  })

  it('keeps sweep history newest-first and caps its length', () => {
    const s = new Store(file)
    for (let i = 0; i < MAX_SWEEP_HISTORY + 25; i++) {
      s.addSweep(sweep(`s${i}`, new Date(2026, 0, 1, 0, i).toISOString()))
    }
    const sweeps = s.getSweeps()
    expect(sweeps.length).toBe(MAX_SWEEP_HISTORY)
    expect(sweeps[0].id).toBe(`s${MAX_SWEEP_HISTORY + 24}`) // most recently added is first
  })

  it('recovers from a corrupt file without throwing', () => {
    writeFileSync(file, '{ this is not valid json ')
    const s = new Store(file)
    expect(s.getProtected()).toEqual([])
    expect(s.getSettings().theme).toBe('system')
    // The corrupt file is backed up and a fresh one can be written.
    s.updateSettings({ theme: 'light' })
    expect(new Store(file).getSettings().theme).toBe('light')
  })

  it('clears sweep history', () => {
    const s = new Store(file)
    s.addSweep(sweep('x', '2026-01-01T00:00:00Z'))
    s.clearSweeps()
    expect(s.getSweeps()).toEqual([])
  })
})
