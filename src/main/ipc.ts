/**
 * IPC surface. Every renderer-facing capability is a typed ipcMain.handle here,
 * delegating to AppServices. Handlers are defensive: a failure returns a safe
 * value rather than rejecting into an unhandled renderer error.
 */
import { app, ipcMain, nativeTheme } from 'electron'
import type { AppIdentity, Settings, SweepResult, ThemePreference } from '@shared/types'
import type { AppServices } from './services/appServices'
import type { StartupManager } from './services/startup'

export interface IpcContext {
  services: AppServices
  startup: StartupManager
  performSweep: (opts: { dryRun?: boolean; confirm?: boolean }) => Promise<SweepResult>
  openDashboard: (section?: string) => void
  quit: () => void
}

export function applyTheme(theme: ThemePreference): void {
  nativeTheme.themeSource = theme
}

export function registerIpc(ctx: IpcContext): void {
  const { services, startup } = ctx

  ipcMain.handle('clova:getVersion', () => app.getVersion())

  ipcMain.handle('clova:listRunningApps', () => services.listRunningApps())
  ipcMain.handle('clova:getSweepPreview', () => services.getSweepPreview())
  ipcMain.handle('clova:getOverview', () => services.getOverview())

  ipcMain.handle('clova:sweep', (_e, options?: { dryRun?: boolean }) =>
    ctx.performSweep({ dryRun: options?.dryRun, confirm: false })
  )

  ipcMain.handle('clova:getProtectedApps', () => services.getProtectedApps())
  ipcMain.handle('clova:protectApp', (_e, appId: AppIdentity) => services.protectApp(appId))
  ipcMain.handle('clova:unprotectApp', (_e, id: string) => services.unprotectApp(id))

  ipcMain.handle('clova:getAppIcon', (_e, appRef: { id: string; path?: string; bundleId?: string }) =>
    services.getAppIcon(appRef)
  )

  ipcMain.handle('clova:getSettings', () => services.getSettings())
  ipcMain.handle('clova:updateSettings', (_e, patch: Partial<Settings>) => {
    let settings = services.updateSettings(patch)
    if ('launchAtLogin' in patch || 'startMinimized' in patch) {
      const effective = startup.setEnabled(settings.launchAtLogin, settings.startMinimized)
      if (effective !== settings.launchAtLogin) settings = services.updateSettings({ launchAtLogin: effective })
    }
    if ('theme' in patch) applyTheme(settings.theme)
    return settings
  })

  ipcMain.handle('clova:getAnalytics', () => services.getAnalytics())
  ipcMain.handle('clova:resetAnalytics', () => services.resetAnalytics())

  ipcMain.handle('clova:scanCleanup', () => services.scanCleanup())
  ipcMain.handle('clova:listCleanupItems', (_e, categoryId: string) => services.listCleanupItems(categoryId))
  ipcMain.handle('clova:runSmartCleanup', () => services.runSmartCleanup())
  ipcMain.handle('clova:runCleanup', (_e, payload: { categoryId: string; paths: string[] }) =>
    services.runCleanup(payload)
  )
  ipcMain.handle('clova:emptyTrash', () => services.emptyTrash())
  ipcMain.handle('clova:setSmartCategory', (_e, payload: { categoryId: string; enabled: boolean }) => {
    services.setSmartCategoryEnabled(payload.categoryId, payload.enabled)
    return services.getCleanupPrefs()
  })

  ipcMain.on('clova:openDashboard', (_e, section?: string) => ctx.openDashboard(section))
  ipcMain.on('clova:quitApp', () => ctx.quit())
}
