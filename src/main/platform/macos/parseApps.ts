/**
 * Pure parser for the macOS discovery JXA output. Separated from the IO so it
 * can be unit-tested with captured fixtures on any platform.
 */
import type { RawApp } from '../../core/identity'
import { MAC_FINDER } from '../../core/safety'

interface RawMacEntry {
  name?: unknown
  bundleId?: unknown
  pid?: unknown
  path?: unknown
}

export function parseMacApps(json: string): RawApp[] {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []

  const out: RawApp[] = []
  for (const entry of data as RawMacEntry[]) {
    if (!entry || typeof entry !== 'object') continue
    const pid = typeof entry.pid === 'number' ? entry.pid : Number(entry.pid)
    if (!Number.isFinite(pid) || pid <= 0) continue
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : undefined
    const bundleId = typeof entry.bundleId === 'string' && entry.bundleId.trim() ? entry.bundleId.trim() : undefined
    const path = typeof entry.path === 'string' && entry.path.trim() ? entry.path.trim() : undefined
    if (!name && !bundleId && !path) continue
    out.push({
      name: name ?? bundleId ?? 'Unknown',
      pid,
      bundleId,
      path,
      isFileManager: (bundleId ?? '').toLowerCase() === MAC_FINDER
    })
  }
  return out
}
