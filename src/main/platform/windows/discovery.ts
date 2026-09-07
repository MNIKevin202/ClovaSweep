/**
 * Windows application discovery.
 *
 * Enumerates processes that own a visible top-level window (MainWindowHandle),
 * which is the closest Windows analogue to macOS's "regular" apps: background
 * services and most system processes have no window and are never returned.
 * System components that *do* have a window (Explorer, Settings, Search host…)
 * are filtered by the shared safety layer, not here.
 */
import type { ApplicationDiscovery } from '../types'
import type { RawApp } from '../../core/identity'
import { runPowershell } from '../util'
import { parseWindowsApps } from './parseApps'

const DISCOVERY_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 }
$list = foreach ($p in $procs) {
  [PSCustomObject]@{
    n  = $p.ProcessName
    id = $p.Id
    p  = $p.Path
    pr = $p.Product
    t  = $p.MainWindowTitle
  }
}
@($list) | ConvertTo-Json -Compress -Depth 3
`

export class WindowsDiscovery implements ApplicationDiscovery {
  async list(): Promise<RawApp[]> {
    try {
      const json = await runPowershell(DISCOVERY_SCRIPT, { timeoutMs: 12000 })
      return parseWindowsApps(json)
    } catch {
      return []
    }
  }
}
