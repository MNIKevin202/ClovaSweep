/**
 * macOS storage + cleanup provider.
 *
 * Cleanup is deliberately conservative: only Trash, per-user Caches and the
 * user's temp dir are Smart-eligible; Downloads and Desktop are review-only.
 * Actual removal (in the sweep/cleanup executor) moves items to the Trash via
 * Electron's shell.trashItem — nothing is permanently destroyed except the
 * explicit "Empty Trash" action.
 */
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { CleanupCategory, CleanupItem, StorageInfo } from '@shared/types'
import type { StorageProvider } from '../types'
import { directoryStats, listTopLevelItems, pathExists } from '../fsutil'
import { run } from '../util'

export class MacStorage implements StorageProvider {
  readonly volume = '/'
  readonly home = os.homedir()

  private get trash() {
    return path.join(this.home, '.Trash')
  }
  private get caches() {
    return path.join(this.home, 'Library', 'Caches')
  }
  private get downloads() {
    return path.join(this.home, 'Downloads')
  }
  private get desktop() {
    return path.join(this.home, 'Desktop')
  }

  async getStorage(): Promise<StorageInfo> {
    try {
      const st = await fs.statfs(this.volume)
      const totalBytes = st.blocks * st.bsize
      const freeBytes = st.bavail * st.bsize
      return { totalBytes, usedBytes: totalBytes - freeBytes, freeBytes, volume: 'Macintosh HD' }
    } catch {
      return { totalBytes: 0, usedBytes: 0, freeBytes: 0, volume: this.volume }
    }
  }

  allowedRootsFor(categoryId: string): string[] {
    switch (categoryId) {
      case 'caches':
        return [this.caches]
      case 'downloads':
        return [this.downloads]
      case 'desktop':
        return [this.desktop]
      case 'temp':
        return [os.tmpdir()]
      default:
        return []
    }
  }

  async scanCategories(): Promise<CleanupCategory[]> {
    const [trash, caches, downloads, desktop, temp] = await Promise.all([
      directoryStats(this.trash),
      directoryStats(this.caches),
      directoryStats(this.downloads),
      directoryStats(this.desktop),
      directoryStats(os.tmpdir())
    ])

    return [
      {
        id: 'trash',
        title: 'Trash',
        description: 'Permanently remove everything currently in the Trash.',
        risk: 'system',
        smartEligible: true,
        sizeBytes: trash.sizeBytes,
        itemCount: trash.itemCount
      },
      {
        id: 'caches',
        title: 'Application Caches',
        description: 'Rebuildable caches in your user Library. Apps recreate these as needed.',
        risk: 'safe',
        smartEligible: true,
        sizeBytes: caches.sizeBytes,
        itemCount: caches.itemCount
      },
      {
        id: 'temp',
        title: 'Temporary Files',
        description: 'Leftover temporary files from your current session.',
        risk: 'safe',
        smartEligible: true,
        sizeBytes: temp.sizeBytes,
        itemCount: temp.itemCount
      },
      {
        id: 'downloads',
        title: 'Downloads',
        description: 'Review large or old downloads. Nothing is removed without your say-so.',
        risk: 'review',
        smartEligible: false,
        sizeBytes: downloads.sizeBytes,
        itemCount: downloads.itemCount
      },
      {
        id: 'desktop',
        title: 'Desktop',
        description: 'Review clutter on your Desktop before moving it to the Trash.',
        risk: 'review',
        smartEligible: false,
        sizeBytes: desktop.sizeBytes,
        itemCount: desktop.itemCount
      }
    ]
  }

  async listItems(categoryId: string): Promise<CleanupItem[]> {
    switch (categoryId) {
      case 'trash':
        return listTopLevelItems(this.trash, categoryId)
      case 'caches':
        return listTopLevelItems(this.caches, categoryId)
      case 'downloads':
        return listTopLevelItems(this.downloads, categoryId)
      case 'desktop':
        return listTopLevelItems(this.desktop, categoryId)
      case 'temp':
        return listTopLevelItems(os.tmpdir(), categoryId)
      default:
        return []
    }
  }

  async emptyTrash(): Promise<{ reclaimedBytes: number; removedCount: number }> {
    const before = await directoryStats(this.trash)
    if (before.itemCount === 0) return { reclaimedBytes: 0, removedCount: 0 }
    try {
      await run('osascript', ['-e', 'tell application "Finder" to empty trash'], { timeoutMs: 30000 })
    } catch {
      // Fall back to removing Trash contents directly if Finder automation is denied.
      if (await pathExists(this.trash)) {
        try {
          const entries = await fs.readdir(this.trash)
          await Promise.all(
            entries.map((e) => fs.rm(path.join(this.trash, e), { recursive: true, force: true }).catch(() => {}))
          )
        } catch {
          /* best effort */
        }
      }
    }
    return { reclaimedBytes: before.sizeBytes, removedCount: before.itemCount }
  }
}
