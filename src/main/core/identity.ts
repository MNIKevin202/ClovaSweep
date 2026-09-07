/**
 * Application identity.
 *
 * ClovaSweep must never rely on an app's *display name* for identity: two
 * different apps can share a name (e.g. two "ChatGPT" builds with bundle ids
 * `com.openai.chat` and `com.openai.codex`), and one app can appear under
 * several process instances. We derive a stable id from the most durable
 * platform identifier available, and merge running processes by that id.
 *
 * This module is pure (no Electron / OS access) so it is fully unit-testable.
 */
import type { AppIdentity, Platform, RunningApp } from '@shared/types'

/** Normalise a filesystem path for comparison (Windows is case-insensitive). */
export function normalizePath(p: string | undefined, platform: Platform): string | undefined {
  if (!p) return undefined
  let out = p.trim()
  if (out.length === 0) return undefined
  // Strip a single trailing separator.
  out = out.replace(/[\\/]+$/, '')
  if (platform === 'win32') {
    out = out.replace(/\//g, '\\').toLowerCase()
  }
  return out
}

/**
 * Derive the canonical, stable identity string for an application.
 *
 * Priority:
 *  - macOS:   bundle id  >  bundle path  >  name
 *  - Windows: package family name  >  executable path  >  name
 *  - other:   path  >  name
 *
 * The returned id is prefixed by its kind so ids never collide across kinds.
 */
export function deriveAppId(app: Partial<AppIdentity>, platform: Platform): string {
  if (platform === 'darwin') {
    if (app.bundleId && app.bundleId.trim()) return `bundle:${app.bundleId.trim().toLowerCase()}`
    const p = normalizePath(app.path, platform)
    if (p) return `path:${p}`
  } else if (platform === 'win32') {
    if (app.packageId && app.packageId.trim()) return `pkg:${app.packageId.trim().toLowerCase()}`
    const p = normalizePath(app.path, platform)
    if (p) return `path:${p}`
  } else {
    const p = normalizePath(app.path, platform)
    if (p) return `path:${p}`
  }
  return `name:${(app.name ?? 'unknown').trim().toLowerCase()}`
}

/** Build a fully-resolved AppIdentity (with derived id) from partial info. */
export function toAppIdentity(app: Partial<AppIdentity> & { name: string }, platform: Platform): AppIdentity {
  return {
    id: app.id ?? deriveAppId(app, platform),
    name: app.name,
    bundleId: app.bundleId,
    path: normalizePath(app.path, platform) ?? app.path,
    packageId: app.packageId
  }
}

/** A raw discovery entry before de-duplication. */
export interface RawApp {
  name: string
  pid: number
  bundleId?: string
  path?: string
  packageId?: string
  isFileManager?: boolean
}

/**
 * Merge raw discovery entries into unique RunningApps keyed by stable id.
 * Processes that resolve to the same identity are combined (pids collected);
 * apps that merely share a display name remain distinct.
 */
export function normalizeRunningApps(raw: RawApp[], platform: Platform): RunningApp[] {
  const byId = new Map<string, RunningApp>()
  for (const r of raw) {
    if (!r || typeof r.pid !== 'number') continue
    const id = deriveAppId(r, platform)
    const existing = byId.get(id)
    if (existing) {
      if (!existing.pids.includes(r.pid)) existing.pids.push(r.pid)
      // Prefer a non-empty name / path / bundle if the first entry lacked one.
      if (!existing.name && r.name) existing.name = r.name
      if (!existing.path && r.path) existing.path = normalizePath(r.path, platform)
      if (!existing.bundleId && r.bundleId) existing.bundleId = r.bundleId
      if (r.isFileManager) existing.isFileManager = true
    } else {
      byId.set(id, {
        id,
        name: r.name || id,
        pids: [r.pid],
        bundleId: r.bundleId,
        path: normalizePath(r.path, platform),
        packageId: r.packageId,
        isFileManager: r.isFileManager
      })
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/**
 * Given a set of protected identities and running apps, decide whether a given
 * running app is protected. Matching is by stable id first, then by a
 * secondary key (bundleId / normalized path) so protection survives small
 * changes (e.g. an app that reports a path in one run and a bundle id later).
 */
export function isProtected(app: RunningApp, protectedIds: Set<string>, protectedSecondary: Set<string>): boolean {
  if (protectedIds.has(app.id)) return true
  if (app.bundleId && protectedSecondary.has(`bundle:${app.bundleId.toLowerCase()}`)) return true
  if (app.path && protectedSecondary.has(`path:${app.path}`)) return true
  return false
}
