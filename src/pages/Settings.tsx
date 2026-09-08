import type { Platform, Settings as SettingsType, ThemePreference } from '@shared/types'
import { Icon } from '../lib/icons'
import { useAsync } from '../lib/hooks'
import { Toggle } from '../components/common'

const TIMEOUTS = [
  { v: 2000, label: '2 seconds' },
  { v: 4000, label: '4 seconds' },
  { v: 6000, label: '6 seconds' },
  { v: 10000, label: '10 seconds' }
]

export function Settings({
  platform,
  onThemeChange
}: {
  platform: Platform
  onThemeChange: (t: ThemePreference) => void
}) {
  const { data, reload } = useAsync<SettingsType>(() => window.clova.getSettings())

  const update = async (patch: Partial<SettingsType>) => {
    const next = await window.clova.updateSettings(patch)
    if (patch.theme) onThemeChange(next.theme)
    reload(true)
  }

  const s = data
  const isMac = platform === 'darwin'
  const isWin = platform === 'win32'

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-sub">Tune how ClovaSweep behaves.</div>
        </div>
      </div>

      {/* General */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-title">
          <Icon name="settings" size={16} /> General
        </div>
        <SettingRow
          title="Launch at login"
          desc="Start ClovaSweep automatically when you sign in."
        >
          <Toggle checked={!!s?.launchAtLogin} onChange={(v) => update({ launchAtLogin: v })} label="Launch at login" />
        </SettingRow>
        <SettingRow
          title={isMac ? 'Start in the menu bar' : 'Start in the system tray'}
          desc="Launch quietly without opening the dashboard window."
        >
          <Toggle checked={!!s?.startMinimized} onChange={(v) => update({ startMinimized: v })} label="Start minimized" />
        </SettingRow>
        <SettingRow
          title={isMac ? 'Menu-bar click opens dashboard' : 'Tray click opens dashboard'}
          desc={`A normal click ${s?.clickOpensDashboard ? 'opens the dashboard' : 'runs a sweep immediately'}. Right-click always shows the menu.`}
        >
          <Toggle
            checked={!!s?.clickOpensDashboard}
            onChange={(v) => update({ clickOpensDashboard: v })}
            label="Click opens dashboard"
          />
        </SettingRow>
        <SettingRow title="Notify after a sweep" desc="Show a notification summarising what was closed.">
          <Toggle
            checked={!!s?.showNotificationAfterSweep}
            onChange={(v) => update({ showNotificationAfterSweep: v })}
            label="Notify after sweep"
          />
        </SettingRow>
        <SettingRow title="Confirm before sweeping" desc="Ask for confirmation before a sweep runs.">
          <Toggle
            checked={!!s?.confirmBeforeSweep}
            onChange={(v) => update({ confirmBeforeSweep: v })}
            label="Confirm before sweep"
          />
        </SettingRow>
      </div>

      {/* Sweep behaviour */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-title">
          <Icon name="broom" size={16} /> Sweep behavior
        </div>
        <SettingRow title="Close applications" desc="Gracefully quit your running apps during a sweep.">
          <Toggle checked={!!s?.closeUserApps} onChange={(v) => update({ closeUserApps: v })} label="Close applications" />
        </SettingRow>
        {isMac && (
          <SettingRow title="Close Finder windows" desc="Close open Finder windows (Finder itself keeps running).">
            <Toggle
              checked={!!s?.closeFinderWindows}
              onChange={(v) => update({ closeFinderWindows: v })}
              label="Close Finder windows"
            />
          </SettingRow>
        )}
        {isWin && (
          <SettingRow
            title="Close File Explorer windows"
            desc="Close open File Explorer windows (the desktop &amp; taskbar stay intact)."
          >
            <Toggle
              checked={!!s?.closeExplorerWindows}
              onChange={(v) => update({ closeExplorerWindows: v })}
              label="Close File Explorer windows"
            />
          </SettingRow>
        )}
        <SettingRow title="Wait for graceful quit" desc="How long to let an app close on its own before it’s considered stuck.">
          <select
            className="select"
            value={s?.gracefulTimeoutMs ?? 4000}
            onChange={(e) => update({ gracefulTimeoutMs: Number(e.target.value) })}
          >
            {TIMEOUTS.map((t) => (
              <option key={t.v} value={t.v}>
                {t.label}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow title="If an app won’t close" desc="Skip stubborn apps, or force-quit them (may lose unsaved work).">
          <div className="segmented" role="group" aria-label="Unresponsive app behavior">
            <button
              className={s?.unresponsiveBehavior === 'skip' ? 'active' : ''}
              onClick={() => update({ unresponsiveBehavior: 'skip' })}
            >
              Skip
            </button>
            <button
              className={s?.unresponsiveBehavior === 'force' ? 'active' : ''}
              onClick={() => update({ unresponsiveBehavior: 'force' })}
            >
              Force quit
            </button>
          </div>
        </SettingRow>
      </div>

      {/* Appearance */}
      <div className="card card-pad">
        <div className="card-title">
          <Icon name="sparkles" size={16} /> Appearance
        </div>
        <SettingRow title="Theme" desc="Match your system, or pick light or dark.">
          <div className="segmented" role="group" aria-label="Theme">
            {(['system', 'light', 'dark'] as ThemePreference[]).map((t) => (
              <button key={t} className={s?.theme === t ? 'active' : ''} onClick={() => update({ theme: t })}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </SettingRow>
      </div>
    </div>
  )
}

function SettingRow({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-main">
        <div className="setting-title">{title}</div>
        <div className="setting-desc">{desc}</div>
      </div>
      {children}
    </div>
  )
}
