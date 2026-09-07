import { describe, expect, it } from 'vitest'
import {
  baseName,
  isFileManager,
  isSystemCritical,
  isWindowsSystemPath
} from '../src/main/core/safety'
import type { RunningApp } from '../src/shared/types'

const app = (over: Partial<RunningApp>): RunningApp => ({
  id: over.id ?? 'x',
  name: over.name ?? 'X',
  pids: over.pids ?? [1],
  ...over
})

describe('baseName', () => {
  it('strips extension and lower-cases', () => {
    expect(baseName('Explorer.EXE')).toBe('explorer')
    expect(baseName('Finder.app')).toBe('finder')
    expect(baseName('  Google Chrome ')).toBe('google chrome')
  })
})

describe('isWindowsSystemPath', () => {
  it('flags System32 / SysWOW64 / SystemApps', () => {
    expect(isWindowsSystemPath('C:\\Windows\\System32\\dwm.exe')).toBe(true)
    expect(isWindowsSystemPath('C:\\Windows\\SysWOW64\\thing.exe')).toBe(true)
    expect(isWindowsSystemPath('C:\\Windows\\SystemApps\\ShellExperienceHost\\x.exe')).toBe(true)
  })
  it('flags executables directly in the Windows dir (e.g. explorer.exe)', () => {
    expect(isWindowsSystemPath('C:\\Windows\\explorer.exe')).toBe(true)
  })
  it('does NOT flag Store apps under WindowsApps', () => {
    expect(isWindowsSystemPath('C:\\Program Files\\WindowsApps\\Spotify_1.2\\Spotify.exe')).toBe(false)
  })
  it('does NOT flag normal user apps', () => {
    expect(isWindowsSystemPath('C:\\Program Files\\Google\\Chrome\\chrome.exe')).toBe(false)
    expect(isWindowsSystemPath('C:\\Users\\me\\AppData\\Local\\Slack\\slack.exe')).toBe(false)
  })
})

describe('isSystemCritical — macOS', () => {
  it('protects Finder and the Dock', () => {
    expect(isSystemCritical(app({ bundleId: 'com.apple.finder' }), 'darwin')).toBe(true)
    expect(isSystemCritical(app({ bundleId: 'com.apple.dock' }), 'darwin')).toBe(true)
  })
  it('does NOT treat ordinary Apple apps as critical (they may be swept)', () => {
    expect(isSystemCritical(app({ bundleId: 'com.apple.Safari' }), 'darwin')).toBe(false)
    expect(isSystemCritical(app({ bundleId: 'com.apple.MobileSMS' }), 'darwin')).toBe(false)
    expect(isSystemCritical(app({ bundleId: 'com.apple.Notes' }), 'darwin')).toBe(false)
  })
})

describe('isSystemCritical — Windows', () => {
  it('protects the shell and session-critical processes by name', () => {
    for (const n of ['explorer', 'csrss.exe', 'winlogon', 'lsass.exe', 'dwm', 'SearchHost.exe']) {
      expect(isSystemCritical(app({ name: n }), 'win32')).toBe(true)
    }
  })
  it('protects anything running from a system path', () => {
    expect(isSystemCritical(app({ name: 'Random', path: 'C:\\Windows\\System32\\random.exe' }), 'win32')).toBe(true)
  })
  it('does NOT protect normal user apps', () => {
    expect(isSystemCritical(app({ name: 'chrome', path: 'C:\\Program Files\\Google\\Chrome\\chrome.exe' }), 'win32')).toBe(
      false
    )
  })
})

describe('isFileManager', () => {
  it('detects Finder on macOS', () => {
    expect(isFileManager(app({ bundleId: 'com.apple.finder' }), 'darwin')).toBe(true)
    expect(isFileManager(app({ bundleId: 'com.apple.Safari' }), 'darwin')).toBe(false)
  })
  it('detects Explorer on Windows', () => {
    expect(isFileManager(app({ name: 'explorer.exe' }), 'win32')).toBe(true)
    expect(isFileManager(app({ name: 'chrome.exe' }), 'win32')).toBe(false)
  })
})
