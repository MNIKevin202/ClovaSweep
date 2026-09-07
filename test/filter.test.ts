import { describe, expect, it } from 'vitest'
import { buildPreview, classifyApps, isSelf, type ClassifyInput } from '../src/main/core/filter'
import { DEFAULT_SETTINGS } from '../src/shared/defaults'
import type { RunningApp } from '../src/shared/types'

const app = (over: Partial<RunningApp> & { id: string; name: string }): RunningApp => ({
  pids: [1],
  ...over
})

function baseInput(apps: RunningApp[], over: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    apps,
    protectedIds: over.protectedIds ?? new Set(),
    protectedSecondary: over.protectedSecondary ?? new Set(),
    selfIds: over.selfIds ?? new Set(['bundle:com.clova.clovasweep', 'name:clovasweep', 'name:electron']),
    settings: over.settings ?? DEFAULT_SETTINGS,
    platform: over.platform ?? 'darwin'
  }
}

describe('classifyApps', () => {
  const apps: RunningApp[] = [
    app({ id: 'bundle:com.spotify.client', name: 'Spotify', bundleId: 'com.spotify.client' }),
    app({ id: 'bundle:com.google.chrome', name: 'Google Chrome', bundleId: 'com.google.Chrome' }),
    app({ id: 'bundle:com.apple.finder', name: 'Finder', bundleId: 'com.apple.finder' }),
    app({ id: 'bundle:com.slack.slack', name: 'Slack', bundleId: 'com.slack.Slack' }),
    app({ id: 'bundle:com.clova.clovasweep', name: 'ClovaSweep', bundleId: 'com.clova.clovasweep' })
  ]

  it('closes ordinary user apps', () => {
    const c = classifyApps(baseInput(apps))
    expect(c.wouldClose.map((a) => a.name).sort()).toEqual(['Google Chrome', 'Slack', 'Spotify'])
  })

  it('excludes protected apps and annotates them', () => {
    const c = classifyApps(baseInput(apps, { protectedIds: new Set(['bundle:com.slack.slack']) }))
    expect(c.wouldClose.map((a) => a.name).sort()).toEqual(['Google Chrome', 'Spotify'])
    expect(c.protectedRunning.map((a) => a.name)).toEqual(['Slack'])
    expect(c.protectedRunning[0].protected).toBe(true)
  })

  it('never sweeps Finder (system-critical file manager)', () => {
    const c = classifyApps(baseInput(apps))
    expect(c.wouldClose.find((a) => a.name === 'Finder')).toBeUndefined()
    expect(c.systemExcluded.find((a) => a.name === 'Finder')).toBeDefined()
    expect(c.fileManagers.map((a) => a.name)).toEqual(['Finder'])
  })

  it('never sweeps ClovaSweep itself', () => {
    const c = classifyApps(baseInput(apps))
    expect(c.wouldClose.find((a) => a.name === 'ClovaSweep')).toBeUndefined()
    const self = c.systemExcluded.find((a) => a.name === 'ClovaSweep')
    expect(self?.isSelf).toBe(true)
  })

  it('closes nothing when closeUserApps is disabled', () => {
    const c = classifyApps(baseInput(apps, { settings: { ...DEFAULT_SETTINGS, closeUserApps: false } }))
    expect(c.wouldClose).toHaveLength(0)
  })

  it('Windows: excludes the shell and system-path apps, closes the rest', () => {
    const winApps: RunningApp[] = [
      app({ id: 'path:c:\\program files\\google\\chrome\\chrome.exe', name: 'chrome.exe', path: 'C:\\Program Files\\Google\\Chrome\\chrome.exe' }),
      app({ id: 'path:c:\\windows\\explorer.exe', name: 'explorer.exe', path: 'C:\\Windows\\explorer.exe' }),
      app({ id: 'path:c:\\windows\\system32\\systemsettings.exe', name: 'SystemSettings.exe', path: 'C:\\Windows\\System32\\SystemSettings.exe' })
    ]
    const c = classifyApps(baseInput(winApps, { platform: 'win32' }))
    expect(c.wouldClose.map((a) => a.name)).toEqual(['chrome.exe'])
    expect(c.fileManagers.map((a) => a.name)).toEqual(['explorer.exe'])
  })
})

describe('buildPreview', () => {
  it('does not surface ClovaSweep itself in systemExcluded', () => {
    const apps: RunningApp[] = [
      app({ id: 'bundle:com.clova.clovasweep', name: 'ClovaSweep', bundleId: 'com.clova.clovasweep' }),
      app({ id: 'bundle:com.apple.finder', name: 'Finder', bundleId: 'com.apple.finder' })
    ]
    const preview = buildPreview(baseInput(apps))
    expect(preview.systemExcluded.find((a) => a.name === 'ClovaSweep')).toBeUndefined()
    expect(preview.systemExcluded.find((a) => a.name === 'Finder')).toBeDefined()
  })
})

describe('isSelf', () => {
  it('matches by id, bundle, and name', () => {
    const ids = new Set(['bundle:com.clova.clovasweep'])
    expect(isSelf(app({ id: 'bundle:com.clova.clovasweep', name: 'ClovaSweep' }), ids)).toBe(true)
    expect(isSelf(app({ id: 'x', name: 'ClovaSweep', bundleId: 'com.clova.clovasweep' }), ids)).toBe(true)
    expect(isSelf(app({ id: 'y', name: 'Other' }), ids)).toBe(false)
  })
})
