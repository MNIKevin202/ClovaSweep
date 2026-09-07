import { useMemo, useState } from 'react'
import type { ProtectedApp, RunningApp } from '@shared/types'
import { Icon } from '../lib/icons'
import { useAsync, useDataChanged } from '../lib/hooks'
import { AppIconImage, Badge, EmptyState } from '../components/common'
import { useToast } from '../components/Toast'

interface Data {
  protectedApps: ProtectedApp[]
  running: RunningApp[]
}

export function ProtectedApps() {
  const { data, loading, reload } = useAsync<Data>(async () => {
    const [protectedApps, running] = await Promise.all([
      window.clova.getProtectedApps(),
      window.clova.listRunningApps()
    ])
    return { protectedApps, running }
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const toast = useToast()

  useDataChanged(() => reload(true))

  const protectedIds = useMemo(() => new Set(data?.protectedApps.map((p) => p.id) ?? []), [data])
  const runningIds = useMemo(() => new Set(data?.running.map((r) => r.id) ?? []), [data])

  const addable = useMemo(() => {
    const list = (data?.running ?? []).filter((r) => !r.system && !r.isSelf && !protectedIds.has(r.id))
    if (!query.trim()) return list
    const q = query.toLowerCase()
    return list.filter((r) => r.name.toLowerCase().includes(q) || (r.bundleId ?? '').toLowerCase().includes(q))
  }, [data, protectedIds, query])

  const protect = async (app: RunningApp) => {
    setBusy(app.id)
    try {
      await window.clova.protectApp({
        id: app.id,
        name: app.name,
        bundleId: app.bundleId,
        path: app.path,
        packageId: app.packageId
      })
      toast(`${app.name} is now protected.`)
      await reload(true)
    } finally {
      setBusy(null)
    }
  }

  const unprotect = async (app: ProtectedApp) => {
    setBusy(app.id)
    try {
      await window.clova.unprotectApp(app.id)
      toast(`Protection removed from ${app.name}.`)
      await reload(true)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Protected Apps</div>
          <div className="page-sub">Apps ClovaSweep will never close during a sweep.</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => reload()} aria-label="Refresh running apps">
          <Icon name="refresh" size={15} /> Refresh
        </button>
      </div>

      {/* Protected list */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-title">
          <Icon name="shield" size={16} /> Protected
          <span className="count">· {data?.protectedApps.length ?? 0}</span>
        </div>
        {(data?.protectedApps.length ?? 0) === 0 ? (
          <EmptyState
            icon="shield"
            title="Nothing protected yet"
            desc="Protect the apps you always want to keep open — like your browser, chat, or music — and sweeps will leave them alone."
          />
        ) : (
          <div className="scroll-list">
            {data!.protectedApps.map((app) => {
              const running = runningIds.has(app.id)
              return (
                <div className="app-row" key={app.id}>
                  <AppIconImage app={app} />
                  <div className="app-meta">
                    <div className="app-name">{app.name}</div>
                    <div className="app-sub">{app.bundleId ?? app.path ?? 'Application'}</div>
                  </div>
                  <div className="app-actions">
                    <Badge kind={running ? 'running' : 'idle'}>{running ? 'Running' : 'Not running'}</Badge>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => unprotect(app)}
                      disabled={busy === app.id}
                      aria-label={`Remove protection from ${app.name}`}
                    >
                      {busy === app.id ? <span className="spinner" /> : <Icon name="close" size={15} />} Remove
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add protection */}
      <div className="card card-pad">
        <div className="row between" style={{ marginBottom: 14 }}>
          <div className="card-title" style={{ margin: 0 }}>
            <Icon name="app" size={16} /> Running apps
            <span className="count">· {addable.length}</span>
          </div>
          {(data?.running.length ?? 0) > 6 && (
            <input
              className="select"
              style={{ minWidth: 180 }}
              placeholder="Filter apps…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter running apps"
            />
          )}
        </div>
        {loading && !data ? (
          <div className="scroll-list">
            {[0, 1, 2, 3].map((i) => (
              <div className="app-row" key={i}>
                <span className="app-icon skeleton" />
                <div className="app-meta">
                  <div className="skeleton" style={{ height: 12, width: '40%', marginBottom: 6 }} />
                  <div className="skeleton" style={{ height: 10, width: '60%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : addable.length === 0 ? (
          <EmptyState
            icon="check"
            title={query ? 'No matches' : 'Everything is already protected'}
            desc={query ? 'Try a different search.' : 'All your running apps are already on the protected list.'}
          />
        ) : (
          <div className="scroll-list">
            {addable.map((app) => (
              <div className="app-row" key={app.id}>
                <AppIconImage app={app} />
                <div className="app-meta">
                  <div className="app-name">{app.name}</div>
                  <div className="app-sub">{app.bundleId ?? app.path ?? 'Application'}</div>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => protect(app)}
                  disabled={busy === app.id}
                  aria-label={`Protect ${app.name}`}
                >
                  {busy === app.id ? <span className="spinner" /> : <Icon name="plus" size={15} />} Protect
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          <Icon name="info" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          System apps and ClovaSweep itself are always kept safe automatically.
        </div>
      </div>
    </div>
  )
}
