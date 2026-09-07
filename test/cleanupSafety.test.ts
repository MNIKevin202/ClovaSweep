import { describe, expect, it } from 'vitest'
import {
  canDeletePath,
  criticalRoots,
  filterDeletable,
  isSmartEligible,
  isStrictlyWithin,
  type DeleteGuardContext
} from '../src/main/core/cleanupSafety'

describe('isStrictlyWithin', () => {
  it('true for a child inside the parent', () => {
    expect(isStrictlyWithin('/Users/me/Downloads/file.zip', '/Users/me/Downloads', 'darwin')).toBe(true)
  })
  it('false for the parent itself', () => {
    expect(isStrictlyWithin('/Users/me/Downloads', '/Users/me/Downloads', 'darwin')).toBe(false)
  })
  it('false for a path that escapes via ..', () => {
    expect(isStrictlyWithin('/Users/me/Downloads/../../etc/passwd', '/Users/me/Downloads', 'darwin')).toBe(false)
  })
  it('false for a sibling directory', () => {
    expect(isStrictlyWithin('/Users/me/Documents/x', '/Users/me/Downloads', 'darwin')).toBe(false)
  })
  it('is case-insensitive on Windows', () => {
    expect(isStrictlyWithin('C:\\Users\\Me\\Downloads\\A.txt', 'c:\\users\\me\\downloads', 'win32')).toBe(true)
  })
})

describe('canDeletePath', () => {
  const ctx: DeleteGuardContext = {
    allowedRoots: ['/Users/me/Downloads', '/Users/me/Desktop'],
    home: '/Users/me',
    platform: 'darwin'
  }

  it('allows a file strictly inside an allowed root', () => {
    expect(canDeletePath('/Users/me/Downloads/old.dmg', ctx)).toBe(true)
    expect(canDeletePath('/Users/me/Desktop/screenshot.png', ctx)).toBe(true)
  })

  it('refuses to delete an allowed root itself (no recursive wipe)', () => {
    expect(canDeletePath('/Users/me/Downloads', ctx)).toBe(false)
    expect(canDeletePath('/Users/me/Desktop/', ctx)).toBe(false)
  })

  it('refuses paths outside every allowed root', () => {
    expect(canDeletePath('/Users/me/Documents/important.txt', ctx)).toBe(false)
    expect(canDeletePath('/etc/hosts', ctx)).toBe(false)
  })

  it('refuses .. escape attempts', () => {
    expect(canDeletePath('/Users/me/Downloads/../.ssh/id_rsa', ctx)).toBe(false)
  })

  it('refuses the home directory and other critical roots', () => {
    expect(canDeletePath('/Users/me', ctx)).toBe(false)
    expect(canDeletePath('/System', { ...ctx, allowedRoots: ['/System'] })).toBe(false)
  })

  it('handles Windows roots case-insensitively', () => {
    const winCtx: DeleteGuardContext = {
      allowedRoots: ['C:\\Users\\Me\\Downloads'],
      home: 'C:\\Users\\Me',
      platform: 'win32'
    }
    expect(canDeletePath('c:\\users\\me\\downloads\\setup.exe', winCtx)).toBe(true)
    expect(canDeletePath('C:\\Users\\Me\\Downloads', winCtx)).toBe(false)
    expect(canDeletePath('C:\\Windows\\System32\\evil.dll', winCtx)).toBe(false)
  })
})

describe('filterDeletable', () => {
  it('partitions safe and rejected paths', () => {
    const ctx: DeleteGuardContext = { allowedRoots: ['/tmp/cache'], home: '/Users/me', platform: 'darwin' }
    const { safe, rejected } = filterDeletable(
      ['/tmp/cache/a', '/tmp/cache/b', '/etc/passwd', '/tmp/cache'],
      ctx
    )
    expect(safe).toEqual(['/tmp/cache/a', '/tmp/cache/b'])
    expect(rejected).toEqual(['/etc/passwd', '/tmp/cache'])
  })
})

describe('criticalRoots', () => {
  it('includes the home dir and system roots on macOS', () => {
    const roots = criticalRoots('/Users/me', 'darwin')
    expect(roots).toContain('/Users/me')
    expect(roots).toContain('/System')
    expect(roots).toContain('/Users/me/Library')
  })
})

describe('isSmartEligible', () => {
  it('allows safe and system, forbids review', () => {
    expect(isSmartEligible('safe')).toBe(true)
    expect(isSmartEligible('system')).toBe(true)
    expect(isSmartEligible('review')).toBe(false)
  })
})
