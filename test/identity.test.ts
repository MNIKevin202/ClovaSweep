import { describe, expect, it } from 'vitest'
import {
  deriveAppId,
  isProtected,
  normalizePath,
  normalizeRunningApps,
  toAppIdentity,
  type RawApp
} from '../src/main/core/identity'

describe('deriveAppId', () => {
  it('prefers macOS bundle id over path and name', () => {
    expect(deriveAppId({ name: 'Spotify', bundleId: 'com.spotify.client', path: '/Applications/Spotify.app' }, 'darwin')).toBe(
      'bundle:com.spotify.client'
    )
  })

  it('falls back to path when no bundle id on macOS', () => {
    expect(deriveAppId({ name: 'Thing', path: '/Applications/Thing.app' }, 'darwin')).toBe('path:/Applications/Thing.app')
  })

  it('prefers Windows package id, then path (case-insensitive), then name', () => {
    expect(deriveAppId({ name: 'X', packageId: 'Contoso.App_8wekyb', path: 'C:\\a.exe' }, 'win32')).toBe('pkg:contoso.app_8wekyb')
    expect(deriveAppId({ name: 'Chrome', path: 'C:\\Program Files\\Chrome\\chrome.exe' }, 'win32')).toBe(
      'path:c:\\program files\\chrome\\chrome.exe'
    )
    expect(deriveAppId({ name: 'Mystery' }, 'win32')).toBe('name:mystery')
  })

  it('gives two apps that share a display name distinct ids (the ChatGPT case)', () => {
    const a = deriveAppId({ name: 'ChatGPT', bundleId: 'com.openai.chat' }, 'darwin')
    const b = deriveAppId({ name: 'ChatGPT', bundleId: 'com.openai.codex' }, 'darwin')
    expect(a).not.toBe(b)
  })
})

describe('normalizePath', () => {
  it('lower-cases and backslash-normalises on Windows', () => {
    expect(normalizePath('C:/Program Files/App/', 'win32')).toBe('c:\\program files\\app')
  })
  it('preserves case on macOS and strips trailing slash', () => {
    expect(normalizePath('/Applications/App.app/', 'darwin')).toBe('/Applications/App.app')
  })
  it('returns undefined for empty', () => {
    expect(normalizePath('   ', 'darwin')).toBeUndefined()
    expect(normalizePath(undefined, 'darwin')).toBeUndefined()
  })
})

describe('normalizeRunningApps', () => {
  it('merges processes of the same app and collects pids', () => {
    const raw: RawApp[] = [
      { name: 'Chrome', pid: 1, bundleId: 'com.google.Chrome' },
      { name: 'Chrome', pid: 2, bundleId: 'com.google.Chrome' },
      { name: 'Chrome', pid: 2, bundleId: 'com.google.Chrome' } // duplicate pid ignored
    ]
    const apps = normalizeRunningApps(raw, 'darwin')
    expect(apps).toHaveLength(1)
    expect(apps[0].pids.sort()).toEqual([1, 2])
  })

  it('keeps same-named apps with different identities separate', () => {
    const raw: RawApp[] = [
      { name: 'ChatGPT', pid: 10, bundleId: 'com.openai.chat' },
      { name: 'ChatGPT', pid: 11, bundleId: 'com.openai.codex' }
    ]
    const apps = normalizeRunningApps(raw, 'darwin')
    expect(apps).toHaveLength(2)
    expect(new Set(apps.map((a) => a.id)).size).toBe(2)
  })

  it('sorts results by name and skips invalid entries', () => {
    const raw = [
      { name: 'Zed', pid: 3, bundleId: 'dev.zed.Zed' },
      { name: 'Arc', pid: 4, bundleId: 'company.thebrowser.Browser' },
      { name: 'Bad' } as unknown as RawApp
    ]
    const apps = normalizeRunningApps(raw, 'darwin')
    expect(apps.map((a) => a.name)).toEqual(['Arc', 'Zed'])
  })
})

describe('toAppIdentity', () => {
  it('derives an id and normalises the path', () => {
    const id = toAppIdentity({ name: 'App', path: 'C:/Games/App/app.exe' }, 'win32')
    expect(id.id).toBe('path:c:\\games\\app\\app.exe')
    expect(id.path).toBe('c:\\games\\app\\app.exe')
  })
})

describe('isProtected', () => {
  const app = { id: 'bundle:com.slack.slack', name: 'Slack', pids: [1], bundleId: 'com.slack.Slack' }
  it('matches by primary id', () => {
    expect(isProtected(app, new Set(['bundle:com.slack.slack']), new Set())).toBe(true)
  })
  it('matches by secondary bundle key when id differs', () => {
    expect(isProtected(app, new Set(), new Set(['bundle:com.slack.slack']))).toBe(true)
  })
  it('returns false when not protected', () => {
    expect(isProtected(app, new Set(['bundle:other']), new Set())).toBe(false)
  })
})
