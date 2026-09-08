/**
 * Tauri bridge — implements the same `ClovaApi` shape the app has always
 * used (`window.clova`), backed by `invoke`/`listen` instead of Electron's
 * contextBridge. Every page/component keeps working unmodified; only this
 * file and `main.tsx` (which awaits `initClovaBridge()` before rendering)
 * know the backend is Tauri.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  AnalyticsSummary,
  AppIdentity,
  ClovaApi,
  CleanupItem,
  CleanupResult,
  CleanupScan,
  OverviewSnapshot,
  Platform,
  ProtectedApp,
  RunningApp,
  Settings,
  SweepPreview,
  SweepResult
} from '@shared/types'

function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  let unlisten: (() => void) | undefined
  let cancelled = false
  listen<T>(event, (e) => cb(e.payload)).then((fn) => {
    if (cancelled) fn()
    else unlisten = fn
  })
  return () => {
    cancelled = true
    unlisten?.()
  }
}

/** Fetch the platform once and build the full `window.clova` API around it. */
export async function initClovaBridge(): Promise<void> {
  const platform = await invoke<Platform>('get_platform')

  const api: ClovaApi = {
    platform,
    getVersion: () => invoke('get_version'),

    listRunningApps: () => invoke<RunningApp[]>('list_running_apps'),
    getSweepPreview: () => invoke<SweepPreview>('get_sweep_preview'),
    sweep: (options) => invoke<SweepResult>('sweep', { options }),
    getOverview: () => invoke<OverviewSnapshot>('get_overview'),

    getProtectedApps: () => invoke<ProtectedApp[]>('get_protected_apps'),
    protectApp: (app: AppIdentity) => invoke<ProtectedApp[]>('protect_app', { app }),
    unprotectApp: (id: string) => invoke<ProtectedApp[]>('unprotect_app', { id }),

    getAppIcon: (appRef) => invoke<string | null>('get_app_icon', { app: appRef }),

    getSettings: () => invoke<Settings>('get_settings'),
    updateSettings: (patch: Partial<Settings>) => invoke<Settings>('update_settings', { patch }),

    getAnalytics: () => invoke<AnalyticsSummary>('get_analytics'),
    resetAnalytics: () => invoke<AnalyticsSummary>('reset_analytics'),

    scanCleanup: () => invoke<CleanupScan>('scan_cleanup'),
    listCleanupItems: (categoryId: string) => invoke<CleanupItem[]>('list_cleanup_items', { categoryId }),
    runSmartCleanup: () => invoke<CleanupResult>('run_smart_cleanup'),
    runCleanup: (payload) => invoke<CleanupResult>('run_cleanup', { payload }),
    emptyTrash: () => invoke<CleanupResult>('empty_trash'),
    setSmartCategory: (payload) => invoke('set_smart_category', { payload }),

    openDashboard: (section?: string) => void invoke('open_dashboard', { section }),
    quitApp: () => void invoke('quit_app'),

    onNavigate: (cb) => subscribe<string>('clova://navigate', cb),
    onSweepComplete: (cb) => subscribe<SweepResult>('clova://sweep-complete', cb),
    onDataChanged: (cb) => subscribe<void>('clova://data-changed', () => cb())
  }

  window.clova = api
}
