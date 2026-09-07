/**
 * Platform selection. Chooses the concrete macOS or Windows implementations at
 * runtime; unsupported platforms get safe no-op services so nothing crashes.
 */
import os from 'node:os'
import { promises as fs } from 'node:fs'
import type { CleanupCategory, CleanupItem, RunningApp, StorageInfo } from '@shared/types'
import type {
  ApplicationDiscovery,
  ApplicationTerminator,
  IconProvider,
  PlatformServices,
  StorageProvider
} from './types'
import type { RawApp } from '../core/identity'

import { MacDiscovery } from './macos/discovery'
import { MacTerminator } from './macos/terminator'
import { MacStorage } from './macos/storage'
import { MacIcons } from './macos/icons'

import { WindowsDiscovery } from './windows/discovery'
import { WindowsTerminator } from './windows/terminator'
import { WindowsStorage } from './windows/storage'
import { WindowsIcons } from './windows/icons'

class NoopDiscovery implements ApplicationDiscovery {
  async list(): Promise<RawApp[]> {
    return []
  }
}
class NoopTerminator implements ApplicationTerminator {
  async requestQuit(_app: RunningApp): Promise<void> {}
  async forceQuit(_app: RunningApp): Promise<void> {}
  async closeFileManagerWindows(): Promise<void> {}
}
class NoopStorage implements StorageProvider {
  readonly volume = '/'
  readonly home = os.homedir()
  async getStorage(): Promise<StorageInfo> {
    try {
      const st = await fs.statfs('/')
      const totalBytes = st.blocks * st.bsize
      const freeBytes = st.bavail * st.bsize
      return { totalBytes, usedBytes: totalBytes - freeBytes, freeBytes, volume: '/' }
    } catch {
      return { totalBytes: 0, usedBytes: 0, freeBytes: 0, volume: '/' }
    }
  }
  allowedRootsFor(): string[] {
    return []
  }
  async scanCategories(): Promise<CleanupCategory[]> {
    return []
  }
  async listItems(): Promise<CleanupItem[]> {
    return []
  }
  async emptyTrash(): Promise<{ reclaimedBytes: number; removedCount: number }> {
    return { reclaimedBytes: 0, removedCount: 0 }
  }
}
class NoopIcons implements IconProvider {
  async getIcon(): Promise<string | null> {
    return null
  }
}

let cached: PlatformServices | null = null

export function getPlatformServices(): PlatformServices {
  if (cached) return cached
  if (process.platform === 'darwin') {
    cached = {
      discovery: new MacDiscovery(),
      terminator: new MacTerminator(),
      storage: new MacStorage(),
      icons: new MacIcons()
    }
  } else if (process.platform === 'win32') {
    cached = {
      discovery: new WindowsDiscovery(),
      terminator: new WindowsTerminator(),
      storage: new WindowsStorage(),
      icons: new WindowsIcons()
    }
  } else {
    cached = {
      discovery: new NoopDiscovery(),
      terminator: new NoopTerminator(),
      storage: new NoopStorage(),
      icons: new NoopIcons()
    }
  }
  return cached
}

export type { PlatformServices }
