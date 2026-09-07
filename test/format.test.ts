import { describe, expect, it } from 'vitest'
import { formatBytes, formatRelativeTime, pluralize } from '../src/shared/format'

describe('formatBytes', () => {
  it('formats common sizes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5.0 GB')
  })
  it('handles negatives and NaN', () => {
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(NaN)).toBe('0 B')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-06-01T12:00:00Z').getTime()
  it('handles missing values', () => {
    expect(formatRelativeTime(undefined, now)).toBe('Never')
    expect(formatRelativeTime('not-a-date', now)).toBe('Never')
  })
  it('reports recent times', () => {
    expect(formatRelativeTime('2026-06-01T11:59:57Z', now)).toBe('Just now')
    expect(formatRelativeTime('2026-06-01T11:58:00Z', now)).toBe('2m ago')
    expect(formatRelativeTime('2026-06-01T09:00:00Z', now)).toBe('3h ago')
    expect(formatRelativeTime('2026-05-31T12:00:00Z', now)).toBe('Yesterday')
  })
})

describe('pluralize', () => {
  it('pluralises correctly', () => {
    expect(pluralize(1, 'app')).toBe('1 app')
    expect(pluralize(0, 'app')).toBe('0 apps')
    expect(pluralize(3, 'app')).toBe('3 apps')
    expect(pluralize(2, 'category', 'categories')).toBe('2 categories')
  })
})
