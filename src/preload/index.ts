/**
 * Preload bridge. Exposes a minimal, typed, promise-based API on `window.clova`
 * via contextBridge — the renderer never touches ipcRenderer or Node directly.
 */
import { contextBridge, ipcRenderer } from 'electron'
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

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: ClovaApi = {
  platform: process.platform as Platform,
  getVersion: () => ipcRenderer.invoke('clova:getVersion'),

  listRunningApps: () => ipcRenderer.invoke('clova:listRunningApps') as Promise<RunningApp[]>,
  getSweepPreview: () => ipcRenderer.invoke('clova:getSweepPreview') as Promise<SweepPreview>,
  sweep: (options) => ipcRenderer.invoke('clova:sweep', options) as Promise<SweepResult>,
  getOverview: () => ipcRenderer.invoke('clova:getOverview') as Promise<OverviewSnapshot>,

  getProtectedApps: () => ipcRenderer.invoke('clova:getProtectedApps') as Promise<ProtectedApp[]>,
  protectApp: (appIdentity: AppIdentity) => ipcRenderer.invoke('clova:protectApp', appIdentity) as Promise<ProtectedApp[]>,
  unprotectApp: (id: string) => ipcRenderer.invoke('clova:unprotectApp', id) as Promise<ProtectedApp[]>,

  getAppIcon: (appRef) => ipcRenderer.invoke('clova:getAppIcon', appRef) as Promise<string | null>,

  getSettings: () => ipcRenderer.invoke('clova:getSettings') as Promise<Settings>,
  updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('clova:updateSettings', patch) as Promise<Settings>,

  getAnalytics: () => ipcRenderer.invoke('clova:getAnalytics') as Promise<AnalyticsSummary>,
  resetAnalytics: () => ipcRenderer.invoke('clova:resetAnalytics') as Promise<AnalyticsSummary>,

  scanCleanup: () => ipcRenderer.invoke('clova:scanCleanup') as Promise<CleanupScan>,
  listCleanupItems: (categoryId: string) => ipcRenderer.invoke('clova:listCleanupItems', categoryId) as Promise<CleanupItem[]>,
  runSmartCleanup: () => ipcRenderer.invoke('clova:runSmartCleanup') as Promise<CleanupResult>,
  runCleanup: (payload) => ipcRenderer.invoke('clova:runCleanup', payload) as Promise<CleanupResult>,
  emptyTrash: () => ipcRenderer.invoke('clova:emptyTrash') as Promise<CleanupResult>,
  setSmartCategory: (payload) =>
    ipcRenderer.invoke('clova:setSmartCategory', payload) as Promise<{ disabledSmartCategories: string[] }>,

  openDashboard: (section?: string) => ipcRenderer.send('clova:openDashboard', section),
  quitApp: () => ipcRenderer.send('clova:quitApp'),

  onNavigate: (cb) => subscribe<[string]>('clova:navigate', cb),
  onSweepComplete: (cb) => subscribe<[SweepResult]>('clova:sweep-complete', cb),
  onDataChanged: (cb) => subscribe<[]>('clova:data-changed', cb)
}

contextBridge.exposeInMainWorld('clova', api)
