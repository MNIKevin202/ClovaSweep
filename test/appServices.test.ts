import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// AppServices imports `shell` from electron for trashItem; mock it so the
// facade can be exercised without a real Electron runtime. vi.hoisted lets the
// mock factory (hoisted above imports) reference the spy safely.
const { trashItem } = vi.hoisted(() => ({ trashItem: vi.fn(async (_p?: string) => {}) }))
vi.mock('electron', () => ({ shell: { trashItem } }))

import { AppServices } from '../src/main/services/appServices'
import { Store } from '../src/main/services/store'
import type { RawApp } from '../src/main/core/identity'
import type { CleanupCategory, CleanupItem, RunningApp, StorageInfo } from '../src/shared/types'
import type { PlatformServices } from '../src/main/platform'

let dir: string
let storeFile: string

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'clova-svc-'))
  storeFile = path.join(dir, 'state.json')
  trashItem.mockClear()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** A fake platform whose terminator actually removes apps from discovery. */
function makeFakePlatform(initial: RawApp[], opts: { home?: string; categories?: CleanupCategory[] } = {}) {
  const running = [...initial]
  const emptyTrash = vi.fn(async () => ({ reclaimedBytes: 1000, removedCount: 2 }))
  const platform: PlatformServices = {
    discovery: { list: async () => [...running] },
    terminator: {
      requestQuit: async (app: RunningApp) => {
        for (const pid of app.pids) {
          const i = running.findIndex((r) => r.pid === pid)
          if (i >= 0) running.splice(i, 1)
        }
      },
      forceQuit: async () => {},
      closeFileManagerWindows: async () => {}
    },
    storage: {
      volume: '/',
      home: opts.home ?? dir,
      getStorage: async (): Promise<StorageInfo> => ({
        totalBytes: 1000,
        usedBytes: 400,
        freeBytes: 600,
        volume: 'Test'
      }),
      allowedRootsFor: (categoryId: string) => (categoryId === 'safe' ? [path.join(dir, 'safe')] : categoryId === 'downloads' ? [path.join(dir, 'downloads')] : []),
      scanCategories: async () => opts.categories ?? [],
      listItems: async (categoryId: string): Promise<CleanupItem[]> => {
        if (categoryId === 'safe') {
          return [
            { path: path.join(dir, 'safe', 'a.tmp'), name: 'a.tmp', sizeBytes: 10, isDirectory: false, categoryId },
            { path: path.join(dir, 'safe', 'b.tmp'), name: 'b.tmp', sizeBytes: 20, isDirectory: false, categoryId }
          ]
        }
        return []
      },
      emptyTrash
    },
    icons: { getIcon: async () => null }
  }
  return { platform, running, emptyTrash }
}

const APPS: RawApp[] = [
  { name: 'Spotify', pid: 1, bundleId: 'com.spotify.client' },
  { name: 'Slack', pid: 2, bundleId: 'com.slack.Slack' },
  { name: 'Finder', pid: 3, bundleId: 'com.apple.finder', isFileManager: true }
]

describe('AppServices facade', () => {
  it('protects an app, persists it, and annotates the running list', async () => {
    const { platform } = makeFakePlatform(APPS)
    const store = new Store(storeFile)
    const svc = new AppServices(store, platform, { selfName: 'ClovaSweep', ownPids: [] })

    svc.protectApp({ id: 'bundle:com.slack.slack', name: 'Slack', bundleId: 'com.slack.Slack' })
    expect(svc.getProtectedApps().map((p) => p.id)).toContain('bundle:com.slack.slack')
    // Survives a fresh Store instance (persistence).
    expect(new Store(storeFile).getProtected().map((p) => p.id)).toContain('bundle:com.slack.slack')

    const list = await svc.listRunningApps()
    expect(list.find((a) => a.name === 'Slack')?.protected).toBe(true)
    expect(list.find((a) => a.name === 'Finder')?.system).toBe(true)
  })

  it('sweeps non-protected apps, records the sweep, and updates analytics', async () => {
    const { platform } = makeFakePlatform(APPS)
    const store = new Store(storeFile)
    store.updateSettings({ gracefulTimeoutMs: 500 }) // keep the test fast (min clamp)
    const svc = new AppServices(store, platform, { selfName: 'ClovaSweep', ownPids: [] })
    svc.protectApp({ id: 'bundle:com.slack.slack', name: 'Slack', bundleId: 'com.slack.Slack' })

    const result = await svc.sweep()
    // Spotify closes; Slack protected; Finder system.
    expect(result.record.results.map((r) => r.name)).toEqual(['Spotify'])
    expect(result.record.closedCount).toBe(1)

    const analytics = svc.getAnalytics()
    expect(analytics.totalSweeps).toBe(1)
    expect(analytics.totalAppsClosed).toBe(1)
    expect(analytics.mostClosed[0].name).toBe('Spotify')

    // A dry run does not add to history.
    await svc.sweep({ dryRun: true })
    expect(svc.getAnalytics().totalSweeps).toBe(1)
  })

  it('runCleanup only trashes paths inside the allowed root', async () => {
    mkdirSync(path.join(dir, 'downloads'), { recursive: true })
    const inside = path.join(dir, 'downloads', 'old.dmg')
    const outside = path.join(dir, 'secret.txt')
    writeFileSync(inside, 'x')
    writeFileSync(outside, 'y')

    const { platform } = makeFakePlatform(APPS)
    const svc = new AppServices(new Store(storeFile), platform, { selfName: 'ClovaSweep', ownPids: [] })

    const res = await svc.runCleanup({ categoryId: 'downloads', paths: [inside, outside] })
    expect(trashItem).toHaveBeenCalledTimes(1)
    expect(trashItem).toHaveBeenCalledWith(inside)
    expect(res.removedCount).toBe(1)
    expect(res.failed.map((f) => f.path)).toContain(outside)
  })

  it('runSmartCleanup clears safe categories and empties the bin', async () => {
    mkdirSync(path.join(dir, 'safe'), { recursive: true })
    writeFileSync(path.join(dir, 'safe', 'a.tmp'), 'aaaa')
    writeFileSync(path.join(dir, 'safe', 'b.tmp'), 'bbbb')

    const categories: CleanupCategory[] = [
      { id: 'bin', title: 'Trash', description: '', risk: 'system', smartEligible: true, sizeBytes: 1000, itemCount: 2 },
      { id: 'safe', title: 'Caches', description: '', risk: 'safe', smartEligible: true, sizeBytes: 30, itemCount: 2 }
    ]
    const { platform, emptyTrash } = makeFakePlatform(APPS, { categories })
    const svc = new AppServices(new Store(storeFile), platform, { selfName: 'ClovaSweep', ownPids: [] })

    const res = await svc.runSmartCleanup()
    expect(emptyTrash).toHaveBeenCalledTimes(1)
    // Both safe files removed from disk.
    expect(existsSync(path.join(dir, 'safe', 'a.tmp'))).toBe(false)
    expect(existsSync(path.join(dir, 'safe', 'b.tmp'))).toBe(false)
    expect(res.removedCount).toBe(4) // 2 from bin + 2 safe files
  })

  it('respects disabled smart categories', async () => {
    mkdirSync(path.join(dir, 'safe'), { recursive: true })
    writeFileSync(path.join(dir, 'safe', 'a.tmp'), 'aaaa')
    writeFileSync(path.join(dir, 'safe', 'b.tmp'), 'bbbb')
    const categories: CleanupCategory[] = [
      { id: 'safe', title: 'Caches', description: '', risk: 'safe', smartEligible: true, sizeBytes: 30, itemCount: 2 }
    ]
    const { platform } = makeFakePlatform(APPS, { categories })
    const store = new Store(storeFile)
    const svc = new AppServices(store, platform, { selfName: 'ClovaSweep', ownPids: [] })

    svc.setSmartCategoryEnabled('safe', false)
    const res = await svc.runSmartCleanup()
    expect(res.removedCount).toBe(0)
    expect(existsSync(path.join(dir, 'safe', 'a.tmp'))).toBe(true)
  })
})
