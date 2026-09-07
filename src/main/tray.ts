/**
 * Tray / menu-bar controller — the primary ClovaSweep experience.
 *
 * A normal (left) click performs a Sweep immediately (or opens the dashboard if
 * the user prefers). A right click opens a compact, native context menu. The
 * macOS menu bar uses a monochrome template image that adapts to light/dark;
 * Windows uses the full-colour icon.
 */
import { Menu, Tray, nativeImage, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { resourcePath } from './paths'

export interface TrayCallbacks {
  onSweep: () => void
  onOpen: (section?: string) => void
  onQuit: () => void
  /** Whether a left-click should open the dashboard instead of sweeping. */
  clickOpensDashboard: () => boolean
}

function loadTrayIcon(): NativeImage {
  const isMac = process.platform === 'darwin'
  const candidates = isMac
    ? ['trayTemplate.png', 'tray.png', 'icon.png']
    : ['tray.ico', 'icon.ico', 'tray.png', 'icon.png']
  for (const name of candidates) {
    const p = resourcePath(name)
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) {
        if (isMac && name.includes('Template')) img.setTemplateImage(true)
        return isMac ? img.resize({ width: 18, height: 18 }) : img
      }
    }
  }
  return nativeImage.createEmpty()
}

export class TrayController {
  private tray: Tray | null = null

  constructor(private readonly cb: TrayCallbacks) {}

  init(): void {
    if (this.tray) return
    this.tray = new Tray(loadTrayIcon())
    this.tray.setToolTip('ClovaSweep — click to sweep')

    this.tray.on('click', () => {
      if (this.cb.clickOpensDashboard()) this.cb.onOpen('overview')
      else this.cb.onSweep()
    })

    // Windows/Linux right-click, and macOS control/right-click.
    this.tray.on('right-click', () => this.popupMenu())

    // On Windows a double-click commonly opens the main window.
    this.tray.on('double-click', () => this.cb.onOpen('overview'))
  }

  private buildMenu(): Menu {
    return Menu.buildFromTemplate([
      { label: 'Sweep Now', click: () => this.cb.onSweep() },
      { type: 'separator' },
      { label: 'Open ClovaSweep', click: () => this.cb.onOpen('overview') },
      { label: 'Protected Apps', click: () => this.cb.onOpen('protected') },
      { label: 'Cleanup', click: () => this.cb.onOpen('cleanup') },
      { label: 'Settings', click: () => this.cb.onOpen('settings') },
      { type: 'separator' },
      { label: 'Quit ClovaSweep', click: () => this.cb.onQuit() }
    ])
  }

  private popupMenu(): void {
    this.tray?.popUpContextMenu(this.buildMenu())
  }

  /** Briefly reflect sweep state in the tooltip. */
  setBusy(busy: boolean): void {
    this.tray?.setToolTip(busy ? 'ClovaSweep — sweeping…' : 'ClovaSweep — click to sweep')
  }

  flashResult(closed: number): void {
    if (!this.tray) return
    this.tray.setToolTip(`ClovaSweep — closed ${closed} app${closed === 1 ? '' : 's'}`)
    setTimeout(() => this.tray?.setToolTip('ClovaSweep — click to sweep'), 4000)
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
