/**
 * Sweep filtering — the decision layer.
 *
 * Given the running apps, the user's protected set, ClovaSweep's own identity
 * and the current settings, decide exactly which apps a sweep would close and
 * why the rest are excluded. This is the single source of truth for "what
 * would a sweep do", used both by the live preview and by the sweep executor,
 * so the preview can never disagree with the action.
 *
 * Pure module — fully unit-testable, identical behaviour on every platform.
 */
import type { Platform, RunningApp, Settings, SweepPreview } from '@shared/types'
import { isProtected } from './identity'
import { isFileManager, isSystemCritical } from './safety'

export interface ClassifyInput {
  apps: RunningApp[]
  protectedIds: Set<string>
  protectedSecondary: Set<string>
  /** Stable ids (and lower-cased names) that identify ClovaSweep itself. */
  selfIds: Set<string>
  settings: Settings
  platform: Platform
}

export interface Classification {
  /** Apps a sweep would actually request to quit. */
  wouldClose: RunningApp[]
  /** Running apps excluded because the user protected them. */
  protectedRunning: RunningApp[]
  /** Apps excluded for system-safety (system-critical, file manager, or self). */
  systemExcluded: RunningApp[]
  /** File managers whose windows may be closed (subject to settings). */
  fileManagers: RunningApp[]
}

/** Decide whether an app is ClovaSweep itself. */
export function isSelf(app: RunningApp, selfIds: Set<string>): boolean {
  if (selfIds.has(app.id)) return true
  const bid = app.bundleId?.toLowerCase()
  if (bid && selfIds.has(`bundle:${bid}`)) return true
  if (selfIds.has(`name:${app.name.toLowerCase()}`)) return true
  return false
}

/**
 * Classify every running app into exactly one bucket, annotating each app with
 * its flags (protected/system/isSelf) so the UI can render status directly.
 */
export function classifyApps(input: ClassifyInput): Classification {
  const { apps, protectedIds, protectedSecondary, selfIds, settings, platform } = input
  const wouldClose: RunningApp[] = []
  const protectedRunning: RunningApp[] = []
  const systemExcluded: RunningApp[] = []
  const fileManagers: RunningApp[] = []

  for (const raw of apps) {
    const app: RunningApp = { ...raw, protected: false, system: false, isSelf: false }

    if (isSelf(app, selfIds)) {
      app.isSelf = true
      app.system = true
      systemExcluded.push(app)
      continue
    }

    const fileManager = isFileManager(app, platform)
    if (fileManager) app.isFileManager = true

    if (isSystemCritical(app, platform)) {
      app.system = true
      systemExcluded.push(app)
      if (fileManager) fileManagers.push(app)
      continue
    }

    if (isProtected(app, protectedIds, protectedSecondary)) {
      app.protected = true
      protectedRunning.push(app)
      continue
    }

    if (settings.closeUserApps) {
      wouldClose.push(app)
    } else {
      // User has disabled closing apps entirely — treat as excluded.
      systemExcluded.push(app)
    }
  }

  return { wouldClose, protectedRunning, systemExcluded, fileManagers }
}

/** Build the SweepPreview shape returned to the renderer. */
export function buildPreview(input: ClassifyInput): SweepPreview {
  const c = classifyApps(input)
  return {
    wouldClose: c.wouldClose,
    protectedRunning: c.protectedRunning,
    systemExcluded: c.systemExcluded.filter((a) => !a.isSelf) // don't surface ClovaSweep itself
  }
}
