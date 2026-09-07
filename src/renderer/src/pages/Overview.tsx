import { useState } from 'react'
import type { OverviewSnapshot } from '@shared/types'
import { formatBytes, formatRelativeTime, pluralize } from '@shared/format'
import { Icon } from '../lib/icons'
import { useAsync, useDataChanged } from '../lib/hooks'
import { AppIconImage, Badge, EmptyState, Modal, StatCard } from '../components/common'
import { useToast } from '../components/Toast'

export function Overview({ navigate }: { navigate: (section: string) => void }) {
  const { data, loading, reload } = useAsync<OverviewSnapshot>(() => window.clova.getOverview())
  const [sweeping, setSweeping] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const toast = useToast()

  useDataChanged(() => reload(true))

  const runSweep = async () => {
    setConfirmOpen(false)
    setSweeping(true)
    try {
      const result = await window.clova.sweep()
      const n = result.record.closedCount
      toast(n === 0 ? 'Nothing to sweep — already clear.' : `Swept ${pluralize(n, 'app')} away.`)
    } catch {
      toast('Sweep failed. Please try again.')
    } finally {
      setSweeping(false)
      reload(true)
    }
  }

  const onSweepClick = () => {
    if (data?.settings.confirmBeforeSweep) setConfirmOpen(true)
    else void runSweep()
  }

  const wouldClose = data?.preview.wouldClose ?? []
  const storage = data?.storage
  const usedPct = storage && storage.totalBytes > 0 ? (storage.usedBytes / storage.totalBytes) * 100 : 0

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Overview</div>
          <div className="page-sub">Your workspace at a glance.</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => reload()} aria-label="Refresh">
          <Icon name="refresh" size={15} /> Refresh
        </button>
      </div>

      {/* Sweep hero */}
      <div className="card sweep-hero" style={{ marginBottom: 16 }}>
        <div className="sweep-hero-info">
          <div className="sweep-hero-title">Ready to sweep</div>
          <div className="sweep-hero-sub">
            {loading && !data ? (
              'Scanning your running apps…'
            ) : wouldClose.length === 0 ? (
              'No apps need closing right now — your workspace is clear.'
            ) : (
              <>
                <span className="sweep-count">{pluralize(wouldClose.length, 'app')}</span> will close.{' '}
                {data!.protectedRunningCount > 0 && (
                  <>Keeping {pluralize(data!.protectedRunningCount, 'protected app')} open.</>
                )}
              </>
            )}
          </div>
          <div className="row wrap" style={{ marginTop: 16, gap: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('protected')}>
              <Icon name="shield" size={15} /> Protected Apps
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('cleanup')}>
              <Icon name="sparkles" size={15} /> Cleanup
            </button>
          </div>
        </div>

        <button
          className="sweep-button"
          onClick={onSweepClick}
          disabled={sweeping}
          aria-label="Sweep now"
        >
          {!sweeping && <span className="ring" />}
          {sweeping ? (
            <span className="spinner" />
          ) : (
            <>
              <Icon name="broom" size={40} className="sweep-ico" />
              <span className="sweep-label">Sweep</span>
              <span className="sweep-hint">{wouldClose.length > 0 ? `${wouldClose.length} apps` : 'Now'}</span>
            </>
          )}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <StatCard value={data?.runningCount ?? '—'} label="Apps running" icon="app" />
        <StatCard value={data?.protectedRunningCount ?? '—'} label="Protected & running" icon="shield" />
        <StatCard value={data?.wouldCloseCount ?? '—'} label="Next sweep closes" icon="broom" accent />
        <StatCard
          value={formatRelativeTime(data?.lastSweepAt)}
          label="Last sweep"
          hint={data?.lastSweepClosed != null ? `Closed ${pluralize(data.lastSweepClosed, 'app')}` : 'No sweeps yet'}
          icon="clock"
        />
      </div>

      <div className="grid grid-2">
        {/* Would-close list */}
        <div className="card card-pad">
          <div className="card-title">
            <Icon name="broom" size={16} /> Next sweep
            <span className="count">· {wouldClose.length}</span>
          </div>
          {wouldClose.length === 0 ? (
            <EmptyState icon="check" title="All clear" desc="Nothing would close on the next sweep." />
          ) : (
            <div className="scroll-list">
              {wouldClose.map((app) => (
                <div className="app-row" key={app.id}>
                  <AppIconImage app={app} />
                  <div className="app-meta">
                    <div className="app-name">{app.name}</div>
                    <div className="app-sub">{app.bundleId ?? app.path ?? 'Application'}</div>
                  </div>
                  <Badge kind="running">Running</Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent sweeps */}
        <div className="card card-pad">
          <div className="card-title">
            <Icon name="clock" size={16} /> Recent sweeps
          </div>
          {(data?.analytics.recent.length ?? 0) === 0 ? (
            <EmptyState
              icon="broom"
              title="No sweeps yet"
              desc="Hit Sweep to instantly close your open apps. Your history shows up here."
            />
          ) : (
            <div className="scroll-list">
              {data!.analytics.recent.map((rec) => (
                <div className="app-row" key={rec.id}>
                  <span className="app-icon placeholder" aria-hidden="true">
                    <Icon name="broom" size={16} />
                  </span>
                  <div className="app-meta">
                    <div className="app-name">{pluralize(rec.closedCount, 'app')} closed</div>
                    <div className="app-sub">{formatRelativeTime(rec.timestamp)}</div>
                  </div>
                  <span className="chip">{(rec.durationMs / 1000).toFixed(1)}s</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Storage */}
      <div className="card card-pad" style={{ marginTop: 16 }}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <div className="card-title" style={{ margin: 0 }}>
            <Icon name="disk" size={16} /> Storage
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('cleanup')}>
            Open Cleanup <Icon name="chevron" size={14} />
          </button>
        </div>
        {storage ? (
          <>
            <div className="storage-bar" aria-hidden="true">
              <div className="storage-fill" style={{ width: `${usedPct}%` }} />
            </div>
            <div className="storage-legend">
              <div className="item">
                <span className="k">Used</span>
                <span className="v">{formatBytes(storage.usedBytes)}</span>
              </div>
              <div className="item">
                <span className="k">Free</span>
                <span className="v">{formatBytes(storage.freeBytes)}</span>
              </div>
              <div className="item">
                <span className="k">Total · {storage.volume}</span>
                <span className="v">{formatBytes(storage.totalBytes)}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="muted">Storage information is unavailable.</div>
        )}
      </div>

      {confirmOpen && (
        <Modal
          title="Sweep now?"
          onClose={() => setConfirmOpen(false)}
          actions={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={runSweep}>
                <Icon name="broom" size={16} /> Sweep {wouldClose.length > 0 ? pluralize(wouldClose.length, 'app') : ''}
              </button>
            </>
          }
        >
          <p>
            ClovaSweep will gracefully close your running apps, except the {data?.protectedRunningCount ?? 0} you have
            protected. Nothing is force-quit unless you enabled it in Settings.
          </p>
        </Modal>
      )}
    </div>
  )
}
