/**
 * Persistent JSON store.
 *
 * A single JSON document holds settings, protected apps, sweep history and
 * cleanup prefs. Reads go through the pure migration layer so a corrupt or
 * outdated file is repaired rather than fatal. Writes are atomic (temp file +
 * rename) so a crash mid-write can never leave a truncated document.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ProtectedApp, Settings, SweepRecord } from '@shared/types'
import { MAX_SWEEP_HISTORY } from '@shared/defaults'
import { emptyState, migrateSettings, migrateState, type CleanupPrefs, type PersistedState } from '../core/migrations'

export class Store {
  private state: PersistedState
  private readonly file: string

  constructor(filePath: string) {
    this.file = filePath
    this.state = this.load()
  }

  private load(): PersistedState {
    try {
      if (!existsSync(this.file)) return emptyState()
      const raw = readFileSync(this.file, 'utf8')
      return migrateState(JSON.parse(raw))
    } catch {
      // Corrupt file: back it up (best-effort) and start clean so we never crash.
      try {
        if (existsSync(this.file)) renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch {
        /* ignore */
      }
      return emptyState()
    }
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.file)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch {
      // A failed write must not crash the app; state stays in memory.
    }
  }

  // --- Settings ---
  getSettings(): Settings {
    return { ...this.state.settings }
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.state.settings = migrateSettings({ ...this.state.settings, ...patch })
    this.persist()
    return this.getSettings()
  }

  // --- Protected apps ---
  getProtected(): ProtectedApp[] {
    return this.state.protectedApps.map((p) => ({ ...p }))
  }

  addProtected(app: ProtectedApp): ProtectedApp[] {
    if (!this.state.protectedApps.some((p) => p.id === app.id)) {
      this.state.protectedApps.push(app)
      this.persist()
    }
    return this.getProtected()
  }

  removeProtected(id: string): ProtectedApp[] {
    const before = this.state.protectedApps.length
    this.state.protectedApps = this.state.protectedApps.filter((p) => p.id !== id)
    if (this.state.protectedApps.length !== before) this.persist()
    return this.getProtected()
  }

  // --- Sweeps ---
  getSweeps(): SweepRecord[] {
    return this.state.sweeps.map((s) => ({ ...s }))
  }

  addSweep(record: SweepRecord): void {
    this.state.sweeps.unshift(record)
    if (this.state.sweeps.length > MAX_SWEEP_HISTORY) {
      this.state.sweeps = this.state.sweeps.slice(0, MAX_SWEEP_HISTORY)
    }
    this.persist()
  }

  clearSweeps(): void {
    this.state.sweeps = []
    this.persist()
  }

  // --- Cleanup prefs ---
  getCleanupPrefs(): CleanupPrefs {
    return { ...this.state.cleanup, disabledSmartCategories: [...this.state.cleanup.disabledSmartCategories] }
  }

  setCleanupPrefs(prefs: CleanupPrefs): void {
    this.state.cleanup = { disabledSmartCategories: [...prefs.disabledSmartCategories] }
    this.persist()
  }

  /** Full path of the backing file (for diagnostics). */
  get filePath(): string {
    return this.file
  }
}
