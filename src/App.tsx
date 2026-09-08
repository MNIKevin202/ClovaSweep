import { useEffect, useState } from 'react'
import type { Platform, ThemePreference } from '@shared/types'
import iconUrl from './assets/clova-icon.png'
import { Icon, type IconName } from './lib/icons'
import { ToastProvider } from './components/Toast'
import { Overview } from './pages/Overview'
import { ProtectedApps } from './pages/ProtectedApps'
import { Cleanup } from './pages/Cleanup'
import { Analytics } from './pages/Analytics'
import { Settings } from './pages/Settings'

type Section = 'overview' | 'protected' | 'cleanup' | 'analytics' | 'settings'

const NAV: { id: Section; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'protected', label: 'Protected Apps', icon: 'shield' },
  { id: 'cleanup', label: 'Cleanup', icon: 'sparkles' },
  { id: 'analytics', label: 'Analytics', icon: 'chart' },
  { id: 'settings', label: 'Settings', icon: 'settings' }
]

function applyTheme(theme: ThemePreference) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export default function App() {
  const [section, setSection] = useState<Section>('overview')
  const [version, setVersion] = useState('')
  const platform = window.clova.platform as Platform

  useEffect(() => {
    document.body.classList.add(`platform-${platform}`)
    window.clova.getVersion().then(setVersion)
    window.clova.getSettings().then((s) => applyTheme(s.theme))
    const off = window.clova.onNavigate((s) => {
      if (NAV.some((n) => n.id === s)) setSection(s as Section)
    })
    return off
  }, [platform])

  return (
    <ToastProvider>
      <div className="titlebar-drag" />
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <img className="brand-mark" src={iconUrl} alt="" />
            <div>
              <div className="brand-name">ClovaSweep</div>
              <div className="brand-suite">Clova Suite</div>
            </div>
          </div>

          <nav className="nav" aria-label="Primary">
            {NAV.map((item) => (
              <button
                key={item.id}
                className={`nav-item${section === item.id ? ' active' : ''}`}
                onClick={() => setSection(item.id)}
                aria-current={section === item.id ? 'page' : undefined}
              >
                <Icon name={item.icon} size={18} className="nav-icon" />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="sidebar-spacer" />

          <div className="sidebar-footer">
            <span className="version">v{version || '—'}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => window.clova.quitApp()}
              aria-label="Quit ClovaSweep"
            >
              <Icon name="power" size={15} /> Quit
            </button>
          </div>
        </aside>

        <main className="main">
          {section === 'overview' && <Overview navigate={(s) => setSection(s as Section)} />}
          {section === 'protected' && <ProtectedApps />}
          {section === 'cleanup' && <Cleanup />}
          {section === 'analytics' && <Analytics />}
          {section === 'settings' && <Settings platform={platform} onThemeChange={applyTheme} />}
        </main>
      </div>
    </ToastProvider>
  )
}
