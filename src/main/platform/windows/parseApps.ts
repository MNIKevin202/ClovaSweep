/**
 * Pure parser for the Windows discovery PowerShell output. Separated from IO so
 * it can be unit-tested with captured fixtures on any platform.
 *
 * Expected shape (compact JSON, one object per windowed process):
 *   { n: processName, id: pid, p: exePath|null, pr: product|null, t: title|null }
 */
import type { RawApp } from '../../core/identity'
import { WIN_EXPLORER, baseName } from '../../core/safety'

interface RawWinEntry {
  n?: unknown
  id?: unknown
  p?: unknown
  pr?: unknown
  t?: unknown
}

/** Choose the best display name: product name, else a prettified process name. */
export function displayName(processName: string, product?: string): string {
  if (product && product.trim()) return product.trim()
  const base = processName.replace(/\.exe$/i, '')
  // Prettify: "google chrome" style words -> Title Case if it looks lower-case.
  if (base === base.toLowerCase()) {
    return base
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  }
  return base
}

export function parseWindowsApps(json: string): RawApp[] {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return []
  }
  // ConvertTo-Json returns a single object when there is one item.
  const arr: RawWinEntry[] = Array.isArray(data) ? (data as RawWinEntry[]) : [data as RawWinEntry]

  const out: RawApp[] = []
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue
    const pid = typeof e.id === 'number' ? e.id : Number(e.id)
    if (!Number.isFinite(pid) || pid <= 0) continue
    const processName = typeof e.n === 'string' ? e.n : ''
    if (!processName) continue
    const product = typeof e.pr === 'string' ? e.pr : undefined
    const path = typeof e.p === 'string' && e.p.trim() ? e.p.trim() : undefined
    out.push({
      name: displayName(processName, product),
      pid,
      path,
      isFileManager: baseName(processName) === WIN_EXPLORER
    })
  }
  return out
}
