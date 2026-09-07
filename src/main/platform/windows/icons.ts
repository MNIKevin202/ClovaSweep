/**
 * Windows icon provider.
 *
 * Extracts the executable's associated icon via System.Drawing and returns a
 * PNG data URL, cached by stable id.
 */
import type { IconProvider } from '../types'
import { runPowershell } from '../util'

function script(exePath: string): string {
  // The path is embedded as a single-quoted PowerShell string; escape quotes.
  const safe = exePath.replace(/'/g, "''")
  return `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Drawing
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon('${safe}')
  if ($null -eq $icon) { '' ; return }
  $bmp = $icon.ToBitmap()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  [Convert]::ToBase64String($ms.ToArray())
  $ms.Dispose(); $bmp.Dispose(); $icon.Dispose()
} catch { '' }
`
}

export class WindowsIcons implements IconProvider {
  private cache = new Map<string, string | null>()

  async getIcon(app: { id: string; path?: string; bundleId?: string }): Promise<string | null> {
    if (this.cache.has(app.id)) return this.cache.get(app.id) ?? null
    if (!app.path) {
      this.cache.set(app.id, null)
      return null
    }
    try {
      const b64 = (await runPowershell(script(app.path), { timeoutMs: 6000 })).trim()
      const value = b64 ? `data:image/png;base64,${b64}` : null
      this.cache.set(app.id, value)
      return value
    } catch {
      this.cache.set(app.id, null)
      return null
    }
  }
}
