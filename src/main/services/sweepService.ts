/**
 * Sweep executor.
 *
 * Orchestrates a sweep on top of the platform abstraction and the pure filter.
 * Written with injected dependencies (discovery, terminator, clock, sleep) so
 * the full graceful → re-check → optional-force flow can be unit-tested with
 * fakes, guaranteeing protected/system/self apps are never terminated.
 */
import type {
  Platform,
  RunningApp,
  Settings,
  SweepAppResult,
  SweepRecord,
  SweepResult
} from '@shared/types'
import type { ApplicationDiscovery, ApplicationTerminator } from '../platform/types'
import { normalizeRunningApps } from '../core/identity'
import { classifyApps } from '../core/filter'

export interface SweepDeps {
  discovery: ApplicationDiscovery
  terminator: ApplicationTerminator
  settings: Settings
  protectedIds: Set<string>
  protectedSecondary: Set<string>
  selfIds: Set<string>
  platform: Platform
  /** Pids that belong to ClovaSweep's own process tree (always excluded). */
  ownPids?: Set<number>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  genId?: () => string
  dryRun?: boolean
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function idsStillRunning(discovery: ApplicationDiscovery, platform: Platform): Promise<Set<string>> {
  const raw = await discovery.list()
  return new Set(normalizeRunningApps(raw, platform).map((a) => a.id))
}

export async function executeSweep(deps: SweepDeps): Promise<SweepResult> {
  const sleep = deps.sleep ?? defaultSleep
  const now = deps.now ?? Date.now
  const genId = deps.genId ?? (() => `sweep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const started = now()

  const rawApps = await deps.discovery.list()
  let apps = normalizeRunningApps(rawApps, deps.platform)
  if (deps.ownPids && deps.ownPids.size) {
    apps = apps.filter((a) => !a.pids.some((p) => deps.ownPids!.has(p)))
  }

  const classification = classifyApps({
    apps,
    protectedIds: deps.protectedIds,
    protectedSecondary: deps.protectedSecondary,
    selfIds: deps.selfIds,
    settings: deps.settings,
    platform: deps.platform
  })

  const targets = classification.wouldClose
  const results: SweepAppResult[] = []

  const resultFor = (app: RunningApp, outcome: SweepAppResult['outcome'], detail?: string): SweepAppResult => ({
    id: app.id,
    name: app.name,
    bundleId: app.bundleId,
    path: app.path,
    outcome,
    detail
  })

  if (deps.dryRun) {
    for (const app of targets) results.push(resultFor(app, 'skipped', 'Dry run'))
  } else if (targets.length > 0) {
    // Phase 1 — graceful quit for every target.
    await Promise.all(targets.map((app) => deps.terminator.requestQuit(app).catch(() => {})))

    // Optionally close file-manager windows (never quits the shell itself).
    const wantFinder = deps.platform === 'darwin' && deps.settings.closeFinderWindows
    const wantExplorer = deps.platform === 'win32' && deps.settings.closeExplorerWindows
    if (wantFinder || wantExplorer) {
      await deps.terminator.closeFileManagerWindows().catch(() => {})
    }

    // Phase 2 — wait for graceful shutdown, then re-check liveness.
    await sleep(deps.settings.gracefulTimeoutMs)
    const aliveAfterGrace = await idsStillRunning(deps.discovery, deps.platform)

    const stillRunning = targets.filter((app) => aliveAfterGrace.has(app.id))
    const closedGracefully = targets.filter((app) => !aliveAfterGrace.has(app.id))
    for (const app of closedGracefully) results.push(resultFor(app, 'closed'))

    if (stillRunning.length > 0 && deps.settings.unresponsiveBehavior === 'force') {
      // Phase 3 — escalate only for the unresponsive ones.
      await Promise.all(stillRunning.map((app) => deps.terminator.forceQuit(app).catch(() => {})))
      await sleep(800)
      const aliveAfterForce = await idsStillRunning(deps.discovery, deps.platform)
      for (const app of stillRunning) {
        if (aliveAfterForce.has(app.id)) results.push(resultFor(app, 'failed', 'Did not respond to force quit'))
        else results.push(resultFor(app, 'closed', 'Force quit'))
      }
    } else {
      for (const app of stillRunning) {
        results.push(resultFor(app, 'timeout', 'Did not quit in time'))
      }
    }
  }

  const closedCount = results.filter((r) => r.outcome === 'closed').length
  const record: SweepRecord = {
    id: genId(),
    timestamp: new Date(started).toISOString(),
    durationMs: now() - started,
    closedCount,
    results,
    dryRun: Boolean(deps.dryRun)
  }

  return {
    record,
    protectedSkipped: classification.protectedRunning.length,
    systemSkipped: classification.systemExcluded.filter((a) => !a.isSelf).length
  }
}
