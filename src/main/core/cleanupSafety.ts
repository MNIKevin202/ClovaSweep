/**
 * Cleanup safety.
 *
 * Cleanup is the highest-risk feature, so every deletion is gated by these
 * pure guards. A path may only be removed if it is *strictly inside* one of the
 * explicitly allowed roots for its category, is not the root itself, and is not
 * a known-critical location. This makes "recursively wipe Downloads because a
 * button was pressed" structurally impossible: the executor deletes only the
 * specific item paths that pass `canDeletePath`, never a root directory.
 *
 * Pure module — fully unit-testable.
 */
import path from 'node:path'
import type { CleanupRisk, Platform } from '@shared/types'

function P(platform: Platform) {
  return platform === 'win32' ? path.win32 : path.posix
}

/** Normalise a path for comparison. */
export function normalizeComparePath(p: string, platform: Platform): string {
  const pp = P(platform)
  let out = pp.normalize(p)
  out = out.replace(/[\\/]+$/, '') || out // drop trailing sep
  if (platform === 'win32') out = out.toLowerCase()
  return out
}

/**
 * True when `child` is strictly contained within `parent` (not equal to it).
 */
export function isStrictlyWithin(child: string, parent: string, platform: Platform): boolean {
  const pp = P(platform)
  const c = normalizeComparePath(pp.resolve(child), platform)
  const par = normalizeComparePath(pp.resolve(parent), platform)
  if (c === par) return false
  const rel = pp.relative(par, c)
  return rel.length > 0 && !rel.startsWith('..' + pp.sep) && rel !== '..' && !pp.isAbsolute(rel)
}

/**
 * Critical locations that must never be deleted regardless of allowed roots.
 * `home` is the user's home directory; the rest are derived from it.
 */
export function criticalRoots(home: string, platform: Platform): string[] {
  const pp = P(platform)
  const roots = [home]
  if (platform === 'darwin') {
    roots.push('/', '/System', '/Library', '/Applications', '/Users', '/private')
    roots.push(pp.join(home, 'Library'), pp.join(home, 'Documents'))
  } else if (platform === 'win32') {
    roots.push('c:\\', 'c:\\windows', 'c:\\program files', 'c:\\program files (x86)', 'c:\\users')
    roots.push(pp.join(home, 'documents'))
  } else {
    roots.push('/', '/etc', '/usr', '/bin', '/home')
  }
  return roots.map((r) => normalizeComparePath(r, platform))
}

export interface DeleteGuardContext {
  allowedRoots: string[]
  home: string
  platform: Platform
}

/**
 * Decide whether a specific item path may be deleted.
 *
 * Rules (all must hold):
 *  - the path is strictly inside at least one allowed root
 *  - the path is not itself an allowed root
 *  - the path is not a critical/system location
 */
export function canDeletePath(target: string, ctx: DeleteGuardContext): boolean {
  if (!target || typeof target !== 'string') return false
  const norm = normalizeComparePath(target, ctx.platform)

  // Never a critical root, and never equal to an allowed root.
  const criticals = new Set(criticalRoots(ctx.home, ctx.platform))
  if (criticals.has(norm)) return false
  for (const root of ctx.allowedRoots) {
    if (norm === normalizeComparePath(root, ctx.platform)) return false
  }

  // Must be strictly within some allowed root.
  return ctx.allowedRoots.some((root) => isStrictlyWithin(target, root, ctx.platform))
}

/** Filter a list of candidate paths to only those that are safe to delete. */
export function filterDeletable(targets: string[], ctx: DeleteGuardContext): {
  safe: string[]
  rejected: string[]
} {
  const safe: string[] = []
  const rejected: string[] = []
  for (const t of targets) {
    if (canDeletePath(t, ctx)) safe.push(t)
    else rejected.push(t)
  }
  return { safe, rejected }
}

/** Whether a category's risk permits inclusion in Smart/Quick cleanup. */
export function isSmartEligible(risk: CleanupRisk): boolean {
  return risk === 'safe' || risk === 'system'
}
