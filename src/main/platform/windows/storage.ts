/**
 * Windows storage + cleanup provider.
 *
 * Mirrors the macOS conservatism: Recycle Bin and the user's Temp dir are
 * Smart-eligible; Downloads and Desktop are review-only. Removal (in the
 * executor) moves items to the Recycle Bin via shell.trashItem — only the
 * explicit "Empty Recycle Bin" action destroys anything.
 */
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { CleanupCategory, CleanupItem, StorageInfo } from '@shared/types'
import type { StorageProvider } from '../types'
import { directoryStats, listTopLevelItems } from '../fsutil'
import { parseJsonSafe, runPowershell } from '../util'

const RECYCLE_STATS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$shell = New-Object -ComObject Shell.Application
$bin = $shell.NameSpace(0xA)
$items = @($bin.Items())
$size = 0
foreach ($i in $items) { try { $size += [int64]$i.Size } catch {} }
[PSCustomObject]@{ size = $size; count = $items.Count } | ConvertTo-Json -Compress
`

export function parseRecycleBin(json: string): { size: number; count: number } {
  const parsed = parseJsonSafe<{ size?: unknown; count?: unknown }>(json, {})
  const size = typeof parsed.size === 'number' ? parsed.size : Number(parsed.size) || 0
  const count = typeof parsed.count === 'number' ? parsed.count : Number(parsed.count) || 0
  return { size: Math.max(0, size), count: Math.max(0, count) }
}

export class WindowsStorage implements StorageProvider {
  readonly home = os.homedir()
  readonly volume = path.parse(os.homedir()).root || 'C:\\'

  private get downloads() {
    return path.join(this.home, 'Downloads')
  }
  private get desktop() {
    return path.join(this.home, 'Desktop')
  }
  private get temp() {
    return os.tmpdir()
  }

  async getStorage(): Promise<StorageInfo> {
    try {
      const st = await fs.statfs(this.volume)
      const totalBytes = st.blocks * st.bsize
      const freeBytes = st.bavail * st.bsize
      return { totalBytes, usedBytes: totalBytes - freeBytes, freeBytes, volume: this.volume.replace(/\\$/, '') }
    } catch {
      return { totalBytes: 0, usedBytes: 0, freeBytes: 0, volume: this.volume }
    }
  }

  allowedRootsFor(categoryId: string): string[] {
    switch (categoryId) {
      case 'temp':
        return [this.temp]
      case 'downloads':
        return [this.downloads]
      case 'desktop':
        return [this.desktop]
      default:
        return []
    }
  }

  private async recycleStats(): Promise<{ size: number; count: number; unavailable: boolean }> {
    try {
      const out = await runPowershell(RECYCLE_STATS_SCRIPT, { timeoutMs: 10000 })
      const { size, count } = parseRecycleBin(out)
      return { size, count, unavailable: false }
    } catch {
      return { size: 0, count: 0, unavailable: true }
    }
  }

  async scanCategories(): Promise<CleanupCategory[]> {
    const [recycle, temp, downloads, desktop] = await Promise.all([
      this.recycleStats(),
      directoryStats(this.temp),
      directoryStats(this.downloads),
      directoryStats(this.desktop)
    ])

    return [
      {
        id: 'recyclebin',
        title: 'Recycle Bin',
        description: 'Permanently remove everything currently in the Recycle Bin.',
        risk: 'system',
        smartEligible: true,
        sizeBytes: recycle.size,
        itemCount: recycle.count,
        unavailable: recycle.unavailable,
        detail: recycle.unavailable ? 'Recycle Bin could not be read.' : undefined
      },
      {
        id: 'temp',
        title: 'Temporary Files',
        description: 'Leftover temporary files in your user Temp folder.',
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
        description: 'Review clutter on your Desktop before sending it to the Recycle Bin.',
        risk: 'review',
        smartEligible: false,
        sizeBytes: desktop.sizeBytes,
        itemCount: desktop.itemCount
      }
    ]
  }

  async listItems(categoryId: string): Promise<CleanupItem[]> {
    switch (categoryId) {
      case 'temp':
        return listTopLevelItems(this.temp, categoryId)
      case 'downloads':
        return listTopLevelItems(this.downloads, categoryId)
      case 'desktop':
        return listTopLevelItems(this.desktop, categoryId)
      default:
        return []
    }
  }

  async emptyTrash(): Promise<{ reclaimedBytes: number; removedCount: number }> {
    const before = await this.recycleStats()
    if (before.count === 0) return { reclaimedBytes: 0, removedCount: 0 }
    try {
      await runPowershell(`Clear-RecycleBin -Force -ErrorAction SilentlyContinue`, { timeoutMs: 30000 })
    } catch {
      /* best effort */
    }
    return { reclaimedBytes: before.size, removedCount: before.count }
  }
}
