import { useState } from 'react'
import type { AnalyticsSummary } from '@shared/types'
import { formatRelativeTime, pluralize } from '@shared/format'
import { Icon } from '../lib/icons'
import { useAsync, useDataChanged } from '../lib/hooks'
import { EmptyState, Modal, StatCard } from '../components/common'
import { useToast } from '../components/Toast'

export function Analytics() {
  const { data, reload } = useAsync<AnalyticsSummary>(() => window.clova.getAnalytics())
  const [resetOpen, setResetOpen] = useState(false)
  const toast = useToast()
  useDataChanged(() => reload(true))

  const reset = async () => {
    setResetOpen(false)
    await window.clova.resetAnalytics()
    toast('Analytics reset.')
    reload(true)
  }

  const maxCount = Math.max(1, ...(data?.mostClosed.map((m) => m.count) ?? [1]))
  const hasData = (data?.totalSweeps ?? 0) > 0

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Analytics</div>
          <div className="page-sub">Local only — your sweep stats never leave this device.</div>
        </div>
        {hasData && (
          <button className="btn btn-ghost btn-sm" onClick={() => setResetOpen(true)}>
            <Icon name="trash" size={15} /> Reset
          </button>
        )}
      </div>

      {!hasData ? (
        <div className="card card-pad">
          <EmptyState
            icon="chart"
            title="No sweeps recorded yet"
            desc="Once you start sweeping, ClovaSweep tracks how much clutter you clear — all stored locally."
          />
        </div>
      ) : (
        <>
          <div className="grid grid-3" style={{ marginBottom: 16 }}>
            <StatCard value={data!.totalAppsClosed} label="Total apps closed" icon="broom" accent />
            <StatCard value={data!.totalSweeps} label="Sweeps run" icon="bolt" />
            <StatCard value={data!.averagePerSweep} label="Avg apps per sweep" icon="chart" />
          </div>
          <div className="grid grid-3" style={{ marginBottom: 16 }}>
            <StatCard value={data!.uniqueAppsClosed} label="Unique apps closed" icon="app" />
            <StatCard value={data!.estimatedClutterReduced} label="Windows-worth of clutter cleared" icon="sparkles" />
            <StatCard
              value={formatRelativeTime(data!.lastSweepAt)}
              label="Last sweep"
              hint={data!.lastSweepClosed != null ? `Closed ${pluralize(data!.lastSweepClosed, 'app')}` : undefined}
              icon="clock"
            />
          </div>

          <div className="grid grid-2">
            <div className="card card-pad">
              <div className="card-title">
                <Icon name="chart" size={16} /> Most-closed apps
              </div>
              {data!.mostClosed.length === 0 ? (
                <EmptyState icon="app" title="No data yet" />
              ) : (
                <div className="bars">
                  {data!.mostClosed.map((m) => (
                    <div className="bar-row" key={m.id}>
                      <span className="bar-name" title={m.name}>
                        {m.name}
                      </span>
                      <span className="bar-track">
                        <span className="bar-fill" style={{ width: `${(m.count / maxCount) * 100}%` }} />
                      </span>
                      <span className="bar-val">{m.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card card-pad">
              <div className="card-title">
                <Icon name="clock" size={16} /> Sweep history
              </div>
              <div className="scroll-list">
                {data!.recent.map((rec) => (
                  <div className="app-row" key={rec.id}>
                    <span className="app-icon placeholder" aria-hidden="true">
                      <Icon name="broom" size={15} />
                    </span>
                    <div className="app-meta">
                      <div className="app-name">{pluralize(rec.closedCount, 'app')} closed</div>
                      <div className="app-sub">{formatRelativeTime(rec.timestamp)}</div>
                    </div>
                    <span className="chip">{(rec.durationMs / 1000).toFixed(1)}s</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {resetOpen && (
        <Modal
          title="Reset analytics?"
          onClose={() => setResetOpen(false)}
          actions={
            <>
              <button className="btn btn-ghost" onClick={() => setResetOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={reset}>
                <Icon name="trash" size={16} /> Reset all stats
              </button>
            </>
          }
        >
          <p>This clears your entire sweep history and all statistics. This can’t be undone.</p>
        </Modal>
      )}
    </div>
  )
}
