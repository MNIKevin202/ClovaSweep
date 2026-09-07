import { describe, expect, it } from 'vitest'
import { parseMacApps } from '../src/main/platform/macos/parseApps'
import { displayName, parseWindowsApps } from '../src/main/platform/windows/parseApps'
import { parseRecycleBin } from '../src/main/platform/windows/storage'

describe('parseMacApps', () => {
  it('parses a realistic JXA payload and flags Finder', () => {
    const json = JSON.stringify([
      { name: 'Finder', bundleId: 'com.apple.finder', pid: 368, path: '/System/Library/CoreServices/Finder.app' },
      { name: 'Spotify', bundleId: 'com.spotify.client', pid: 726, path: '/Applications/Spotify.app' },
      { name: 'ChatGPT', bundleId: 'com.openai.chat', pid: 1, path: '/Applications/ChatGPT Classic.app' },
      { name: 'ChatGPT', bundleId: 'com.openai.codex', pid: 2, path: '/Applications/ChatGPT.app' }
    ])
    const apps = parseMacApps(json)
    expect(apps).toHaveLength(4)
    expect(apps.find((a) => a.bundleId === 'com.apple.finder')?.isFileManager).toBe(true)
    expect(apps.find((a) => a.bundleId === 'com.spotify.client')?.isFileManager).toBe(false)
  })

  it('drops entries with an invalid pid or no identity', () => {
    const json = JSON.stringify([
      { name: 'Bad', pid: 0 },
      { name: null, bundleId: null, pid: 5, path: null },
      { name: 'Good', bundleId: 'com.good', pid: 9 }
    ])
    const apps = parseMacApps(json)
    expect(apps.map((a) => a.name)).toEqual(['Good'])
  })

  it('returns empty for malformed JSON', () => {
    expect(parseMacApps('not json')).toEqual([])
    expect(parseMacApps('{"not":"array"}')).toEqual([])
  })
})

describe('displayName (Windows)', () => {
  it('prefers the product name', () => {
    expect(displayName('chrome', 'Google Chrome')).toBe('Google Chrome')
  })
  it('title-cases a bare lower-case process name', () => {
    expect(displayName('slack')).toBe('Slack')
    expect(displayName('code')).toBe('Code')
  })
  it('leaves already-cased names alone', () => {
    expect(displayName('WhatsApp')).toBe('WhatsApp')
  })
})

describe('parseWindowsApps', () => {
  it('parses an array payload and flags explorer', () => {
    const json = JSON.stringify([
      { n: 'chrome', id: 100, p: 'C:\\Program Files\\Google\\Chrome\\chrome.exe', pr: 'Google Chrome', t: 'New Tab' },
      { n: 'explorer', id: 200, p: 'C:\\Windows\\explorer.exe', pr: 'Windows Explorer', t: 'Downloads' }
    ])
    const apps = parseWindowsApps(json)
    expect(apps).toHaveLength(2)
    expect(apps.find((a) => a.name === 'Google Chrome')?.path).toBe('C:\\Program Files\\Google\\Chrome\\chrome.exe')
    expect(apps.find((a) => a.isFileManager)?.name).toBe('Windows Explorer')
  })

  it('handles a single-object payload (ConvertTo-Json quirk)', () => {
    const json = JSON.stringify({ n: 'notepad', id: 5, p: 'C:\\Windows\\System32\\notepad.exe', pr: null, t: 'Untitled' })
    const apps = parseWindowsApps(json)
    expect(apps).toHaveLength(1)
    expect(apps[0].name).toBe('Notepad')
  })

  it('skips entries without a pid or process name', () => {
    const json = JSON.stringify([{ n: '', id: 5 }, { n: 'x', id: 0 }, { n: 'ok', id: 7 }])
    expect(parseWindowsApps(json).map((a) => a.name)).toEqual(['Ok'])
  })
})

describe('parseRecycleBin', () => {
  it('parses size and count', () => {
    expect(parseRecycleBin('{"size":1024,"count":3}')).toEqual({ size: 1024, count: 3 })
  })
  it('coerces string numbers and clamps negatives', () => {
    expect(parseRecycleBin('{"size":"2048","count":"1"}')).toEqual({ size: 2048, count: 1 })
    expect(parseRecycleBin('garbage')).toEqual({ size: 0, count: 0 })
  })
})
