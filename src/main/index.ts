/**
 * ClovaSweep — Electron main entry point.
 *
 * Boots the tray/menu-bar controller, the lazily-created dashboard window and
 * the IPC surface. ClovaSweep is a tray-first utility: closing the window hides
 * it, and the app keeps running until the user explicitly quits.
 */
import { app, dialog, Menu, Notification } from 'electron'
import path from 'node:path'
import { APP_ID, PRODUCT_NAME } from '@shared/defaults'
import type { SweepResult } from '@shared/types'
import { getPlatformServices } from './platform'
import { Store } from './services/store'
import { AppServices } from './services/appServices'
import { StartupManager } from './services/startup'
import { WindowManager } from './windows'
import { TrayController } from './tray'
import { applyTheme, registerIpc } from './ipc'

let isQuitting = false
let tray: TrayController | null = null
let windows: WindowManager
let services: AppServices
let startup: StartupManager

function quit(): void {
  isQuitting = true
  tray?.destroy()
  tray = null
  app.quit()
}

function syncDock(visible: boolean): void {
  if (process.platform !== 'darwin' || !app.dock) return
  try {
    if (visible) app.dock.show()
    else app.dock.hide()
  } catch {
    /* dock control is best-effort */
  }
}

function cancelledResult(): SweepResult {
  return {
    record: {
      id: `cancelled-${Date.now()}`,
      timestamp: new Date().toISOString(),
      durationMs: 0,
      closedCount: 0,
      results: [],
      dryRun: false
    },
    protectedSkipped: 0,
    systemSkipped: 0
  }
}

function notificationBody(result: SweepResult): string {
  const { closedCount } = result.record
  if (closedCount === 0) return 'Nothing to sweep — your workspace is already clear.'
  const kept = result.protectedSkipped
  const base = `Closed ${closedCount} app${closedCount === 1 ? '' : 's'}`
  return kept > 0 ? `${base} · kept ${kept} protected` : base
}

async function performSweep(opts: { dryRun?: boolean; confirm?: boolean }): Promise<SweepResult> {
  const settings = services.getSettings()
  if (!opts.dryRun && opts.confirm && settings.confirmBeforeSweep) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Sweep Now', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      icon: undefined,
      message: 'Sweep now?',
      detail: 'ClovaSweep will gracefully close your running apps, except the ones you have protected.'
    })
    if (response !== 0) return cancelledResult()
  }

  tray?.setBusy(true)
  try {
    const result = await services.sweep({ dryRun: opts.dryRun })
    if (!result.record.dryRun) {
      tray?.flashResult(result.record.closedCount)
      if (settings.showNotificationAfterSweep && Notification.isSupported()) {
        new Notification({ title: 'ClovaSweep', body: notificationBody(result), silent: false }).show()
      }
      windows?.broadcast('clova:sweep-complete', result)
      windows?.broadcast('clova:data-changed')
    }
    return result
  } finally {
    tray?.setBusy(false)
  }
}

function buildApplicationMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  const menu = Menu.buildFromTemplate([
    {
      label: PRODUCT_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Sweep Now',
          accelerator: 'Cmd+Shift+S',
          click: () => performSweep({ confirm: true })
        },
        {
          label: 'Open Dashboard',
          accelerator: 'Cmd+,',
          click: () => windows.show('overview')
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { label: 'Quit ClovaSweep', accelerator: 'Cmd+Q', click: () => quit() }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { label: 'Close', accelerator: 'Cmd+W', click: () => windows.current?.hide() }
      ]
    }
  ])
  Menu.setApplicationMenu(menu)
}

function bootstrap(): void {
  app.setName(PRODUCT_NAME)
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID)

  const store = new Store(path.join(app.getPath('userData'), 'clovasweep-state.json'))
  const platform = getPlatformServices()
  services = new AppServices(store, platform, { selfName: PRODUCT_NAME, ownPids: [process.pid] })
  startup = new StartupManager()

  const settings = store.getSettings()
  applyTheme(settings.theme)
  // Only reconcile the login item when it actually differs, so we don't make an
  // unnecessary (and sometimes permission-denied) OS call on every launch.
  if (startup.getEnabled() !== settings.launchAtLogin) {
    startup.setEnabled(settings.launchAtLogin, settings.startMinimized)
  }

  windows = new WindowManager(() => isQuitting, syncDock)
  tray = new TrayController({
    onSweep: () => void performSweep({ confirm: true }),
    onOpen: (section) => windows.show(section ?? 'overview'),
    onQuit: () => quit(),
    clickOpensDashboard: () => services.getSettings().clickOpensDashboard
  })
  tray.init()

  registerIpc({
    services,
    startup,
    performSweep,
    openDashboard: (section) => windows.show(section ?? 'overview'),
    quit
  })

  buildApplicationMenu()

  // In development (unpackaged) always show the window; packaged builds honour
  // the user's "start minimized" preference and the --hidden login argument.
  const startHidden = app.isPackaged && (settings.startMinimized || process.argv.includes('--hidden'))
  if (startHidden) {
    syncDock(false)
  } else {
    syncDock(true)
    windows.show('overview')
  }

  app.on('activate', () => windows.show('overview'))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => windows?.show('overview'))
  // Keep running in the tray when all windows are closed.
  app.on('window-all-closed', () => {
    /* intentionally do not quit */
  })
  app.on('before-quit', () => {
    isQuitting = true
  })
  app.whenReady().then(bootstrap)
}
