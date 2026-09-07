/**
 * Dashboard window manager.
 *
 * ClovaSweep lives in the tray/menu bar, so the dashboard window is created
 * lazily and merely hidden on close (never destroyed) — the app keeps running.
 * Uses native-feeling chrome per platform: inset traffic lights on macOS and a
 * Windows 11 title-bar overlay on Windows.
 */
import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { resourcePath } from './paths'

export class WindowManager {
  private win: BrowserWindow | null = null
  private pendingSection: string | null = null

  constructor(
    private readonly isQuitting: () => boolean,
    private readonly onVisibility?: (visible: boolean) => void
  ) {}

  private create(): BrowserWindow {
    const isMac = process.platform === 'darwin'
    const iconPath = process.platform === 'win32' ? resourcePath('icon.ico') : resourcePath('icon.png')

    const win = new BrowserWindow({
      width: 1060,
      height: 730,
      minWidth: 900,
      minHeight: 620,
      show: false,
      title: 'ClovaSweep',
      backgroundColor: '#17090f',
      icon: existsSync(iconPath) ? iconPath : undefined,
      titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
      trafficLightPosition: isMac ? { x: 18, y: 20 } : undefined,
      titleBarOverlay: isMac
        ? undefined
        : { color: '#1e0d14', symbolColor: '#f4e6d6', height: 48 },
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false
      }
    })

    win.on('ready-to-show', () => {
      win.show()
      win.focus()
      if (this.pendingSection) {
        win.webContents.send('clova:navigate', this.pendingSection)
        this.pendingSection = null
      }
    })

    // Keep ClovaSweep alive in the tray: hide instead of close.
    win.on('close', (e) => {
      if (!this.isQuitting()) {
        e.preventDefault()
        win.hide()
      }
    })

    win.on('show', () => this.onVisibility?.(true))
    win.on('hide', () => this.onVisibility?.(false))

    win.on('closed', () => {
      this.onVisibility?.(false)
      this.win = null
    })

    // Open external links in the user's browser, never in-app.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http')) shell.openExternal(url)
      return { action: 'deny' }
    })

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      win.loadURL(devUrl)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'))
    }

    this.win = win
    return win
  }

  show(section?: string): void {
    if (section) this.pendingSection = section
    if (!this.win) {
      this.create()
      return
    }
    if (this.win.isMinimized()) this.win.restore()
    this.win.show()
    this.win.focus()
    if (section) {
      this.win.webContents.send('clova:navigate', section)
      this.pendingSection = null
    }
  }

  broadcast(channel: string, ...args: unknown[]): void {
    this.win?.webContents.send(channel, ...args)
  }

  get current(): BrowserWindow | null {
    return this.win
  }
}
