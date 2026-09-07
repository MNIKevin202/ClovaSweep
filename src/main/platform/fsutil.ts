/**
 * Filesystem helpers for the cleanup scanners. Sizing is bounded (entry cap +
 * depth cap) so scanning a huge tree can never hang the UI or spike CPU — a
 * tiny utility should feel tiny.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CleanupItem } from '@shared/types'

const MAX_ENTRIES = 20000
const MAX_DEPTH = 12

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Recursively sum file sizes under `root`, bounded for performance. */
export async function directorySize(root: string): Promise<number> {
  let total = 0
  let visited = 0
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || visited > MAX_ENTRIES) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (visited > MAX_ENTRIES) return
      visited += 1
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
      } else if (entry.isFile()) {
        try {
          const st = await fs.stat(full)
          total += st.size
        } catch {
          /* skip unreadable */
        }
      }
    }
  }
  await walk(root, 0)
  return total
}

/** Size + top-level item count of a directory. */
export async function directoryStats(root: string): Promise<{ sizeBytes: number; itemCount: number }> {
  if (!(await pathExists(root))) return { sizeBytes: 0, itemCount: 0 }
  let itemCount = 0
  try {
    const entries = await fs.readdir(root)
    itemCount = entries.length
  } catch {
    return { sizeBytes: 0, itemCount: 0 }
  }
  const sizeBytes = await directorySize(root)
  return { sizeBytes, itemCount }
}

/** List the top-level entries of a directory as CleanupItems (sized). */
export async function listTopLevelItems(root: string, categoryId: string): Promise<CleanupItem[]> {
  if (!(await pathExists(root))) return []
  let names: string[]
  try {
    names = await fs.readdir(root)
  } catch {
    return []
  }
  const items: CleanupItem[] = []
  for (const name of names) {
    if (name === '.DS_Store' || name === 'desktop.ini') continue
    const full = path.join(root, name)
    try {
      const st = await fs.lstat(full)
      if (st.isSymbolicLink()) continue
      const isDirectory = st.isDirectory()
      const sizeBytes = isDirectory ? await directorySize(full) : st.size
      items.push({
        path: full,
        name,
        sizeBytes,
        isDirectory,
        modifiedAt: st.mtime.toISOString(),
        categoryId
      })
    } catch {
      /* skip unreadable */
    }
  }
  // Largest first — the most impactful items to review.
  return items.sort((a, b) => b.sizeBytes - a.sizeBytes)
}
