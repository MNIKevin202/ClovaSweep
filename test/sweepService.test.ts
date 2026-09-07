import { describe, expect, it } from 'vitest'
import { executeSweep, type SweepDeps } from '../src/main/services/sweepService'
import type { ApplicationDiscovery, ApplicationTerminator } from '../src/main/platform/types'
import type { RawApp } from '../src/main/core/identity'
import type { RunningApp } from '../src/shared/types'
import { DEFAULT_SETTINGS } from '../src/shared/defaults'

/** A discovery + terminator pair backed by one shared "running" set. */
function harness(initial: RawApp[], opts: { stubborn?: string[]; dieOnForce?: boolean } = {}) {
  const running = new Map<number, RawApp>()
  for (const a of initial) running.set(a.pid, a)
  const stubborn = new Set(opts.stubborn ?? [])
  const dieOnForce = opts.dieOnForce ?? true
  const quitCalls: string[] = []
  const forceCalls: string[] = []
  const finderClosed = { count: 0 }

  const discovery: ApplicationDiscovery = {
    async list() {
      return [...running.values()]
    }
  }
  const terminator: ApplicationTerminator = {
    async requestQuit(app: RunningApp) {
      quitCalls.push(app.id)
      for (const pid of app.pids) {
        const found = running.get(pid)
        if (found && !stubborn.has(found.bundleId ?? found.name)) running.delete(pid)
      }
    },
    async forceQuit(app: RunningApp) {
      forceCalls.push(app.id)
      if (dieOnForce) for (const pid of app.pids) running.delete(pid)
    },
    async closeFileManagerWindows() {
      finderClosed.count += 1
    }
  }
  return { discovery, terminator, quitCalls, forceCalls, finderClosed, running }
}

function deps(over: Partial<SweepDeps> & Pick<SweepDeps, 'discovery' | 'terminator'>): SweepDeps {
  return {
    settings: DEFAULT_SETTINGS,
    protectedIds: new Set(),
    protectedSecondary: new Set(),
    selfIds: new Set(['bundle:com.clova.clovasweep', 'name:clovasweep']),
    platform: 'darwin',
    sleep: async () => {},
    now: (() => {
      let t = 1000
      return () => (t += 5)
    })(),
    ...over
  }
}

const APPS: RawApp[] = [
  { name: 'Spotify', pid: 1, bundleId: 'com.spotify.client' },
  { name: 'Slack', pid: 2, bundleId: 'com.slack.Slack' },
  { name: 'Finder', pid: 3, bundleId: 'com.apple.finder', isFileManager: true },
  { name: 'ClovaSweep', pid: 4, bundleId: 'com.clova.clovasweep' }
]

describe('executeSweep — safety', () => {
  it('closes user apps and never quits protected, system, or self', async () => {
    const h = harness(APPS)
    const res = await executeSweep(deps({ ...h, protectedIds: new Set(['bundle:com.slack.slack']) }))
    // Only Spotify should be quit (Slack protected, Finder system, ClovaSweep self).
    expect(h.quitCalls).toEqual(['bundle:com.spotify.client'])
    expect(res.record.closedCount).toBe(1)
    expect(res.protectedSkipped).toBe(1)
    // Finder is counted as a system exclusion, ClovaSweep (self) is not surfaced.
    expect(res.systemSkipped).toBe(1)
  })

  it('marks gracefully-closed apps as closed', async () => {
    const h = harness([APPS[0], APPS[1]])
    const res = await executeSweep(deps({ ...h }))
    expect(res.record.results.every((r) => r.outcome === 'closed')).toBe(true)
    expect(res.record.closedCount).toBe(2)
  })

  it('reports timeout and does NOT force-quit when behavior is skip', async () => {
    const h = harness([APPS[0]], { stubborn: ['com.spotify.client'] })
    const res = await executeSweep(deps({ ...h, settings: { ...DEFAULT_SETTINGS, unresponsiveBehavior: 'skip' } }))
    expect(h.forceCalls).toEqual([])
    expect(res.record.results[0].outcome).toBe('timeout')
    expect(res.record.closedCount).toBe(0)
  })

  it('escalates to force-quit for unresponsive apps when allowed', async () => {
    const h = harness([APPS[0]], { stubborn: ['com.spotify.client'], dieOnForce: true })
    const res = await executeSweep(deps({ ...h, settings: { ...DEFAULT_SETTINGS, unresponsiveBehavior: 'force' } }))
    expect(h.forceCalls).toEqual(['bundle:com.spotify.client'])
    expect(res.record.results[0].outcome).toBe('closed')
    expect(res.record.results[0].detail).toBe('Force quit')
  })

  it('reports failed when an app survives even a force-quit', async () => {
    const h = harness([APPS[0]], { stubborn: ['com.spotify.client'], dieOnForce: false })
    const res = await executeSweep(deps({ ...h, settings: { ...DEFAULT_SETTINGS, unresponsiveBehavior: 'force' } }))
    expect(res.record.results[0].outcome).toBe('failed')
  })

  it('dry run terminates nothing', async () => {
    const h = harness([APPS[0], APPS[1]])
    const res = await executeSweep(deps({ ...h, dryRun: true }))
    expect(h.quitCalls).toEqual([])
    expect(h.forceCalls).toEqual([])
    expect(res.record.dryRun).toBe(true)
    expect(res.record.results.every((r) => r.outcome === 'skipped')).toBe(true)
  })

  it('closes Finder windows when the setting is on, without quitting Finder', async () => {
    const h = harness(APPS)
    await executeSweep(deps({ ...h, settings: { ...DEFAULT_SETTINGS, closeFinderWindows: true } }))
    expect(h.finderClosed.count).toBe(1)
    expect(h.quitCalls).not.toContain('bundle:com.apple.finder')
  })

  it('excludes ClovaSweep own pids', async () => {
    const h = harness([{ name: 'Spotify', pid: 1, bundleId: 'com.spotify.client' }, { name: 'X', pid: 99 }])
    const res = await executeSweep(deps({ ...h, ownPids: new Set([99]) }))
    expect(res.record.results.map((r) => r.name)).toEqual(['Spotify'])
  })
})
