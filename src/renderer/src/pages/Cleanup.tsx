import { useEffect, useMemo, useState } from 'react'
import type { CleanupCategory, CleanupItem, CleanupScan } from '@shared/types'
import { formatBytes, formatRelativeTime, pluralize } from '@shared/format'
import { Icon } from '../lib/icons'
import { useAsync } from '../lib/hooks'
import { Badge, EmptyState, Modal, Toggle } from '../components/common'
import { useToast } from '../components/Toast'

const riskLabel: Record<string, string> = { safe: 'Safe', review: 'Review', system: 'Bin' }

export function Cleanup() {
  const { data, loading, reload } = useAsync<CleanupScan>(() => window.clova.scanCleanup())
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [smartConfirm, setSmartConfirm] = useState(false)
  const [emptyConfirm, setEmptyConfirm] = useState<CleanupCategory | null>(null)
  const [review, setReview] = useState<CleanupCategory | null>(null)
  const toast = useToast()

  useEffect(() => {
    if (data) setDisabled(new Set(data.disabledSmartCategories))
  }, [data])

  const storage = data?.storage
  const usedPct = storage && storage.totalBytes > 0 ? (storage.usedBytes / storage.totalBytes) * 100 : 0

  const smartCats = useMemo(
    () => (data?.categories ?? []).filter((c) => c.smartEligible && !c.unavailable),
    [data]
  )
  const reviewCats = useMemo(() => (data?.categories ?? []).filter((c) => c.risk === 'review'), [data])
  const reclaimable = useMemo(
    () => smartCats.filter((c) => !disabled.has(c.id)).reduce((sum, c) => sum + c.sizeBytes, 0),
    [smartCats, disabled]
  )

  const toggleSmart = async (id: string) => {
    const next = new Set(disabled)
    const enabled = next.has(id) // currently disabled -> enabling
    if (enabled) next.delete(id)
    else next.add(id)
    setDisabled(next)
    await window.clova.setSmartCategory({ categoryId: id, enabled })
  }

  const runSmart = async () => {
    setSmartConfirm(false)
    setBusy(true)
    try {
      const res = await window.clova.runSmartCleanup()
      toast(
        res.removedCount === 0
          ? 'Nothing to clean — you’re already tidy.'
          : `Reclaimed ${formatBytes(res.reclaimedBytes)} · removed ${pluralize(res.removedCount, 'item')}.`
      )
      await reload(true)
    } catch {
      toast('Cleanup could not complete.')
    } finally {
      setBusy(false)
    }
  }

  const emptyBin = async (cat: CleanupCategory) => {
    setEmptyConfirm(null)
    setBusy(true)
    try {
      const res = await window.clova.emptyTrash()
      toast(res.removedCount === 0 ? `${cat.title} is already empty.` : `Emptied ${cat.title} · ${formatBytes(res.reclaimedBytes)}.`)
      await reload(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Cleanup</div>
          <div className="page-sub">
            Reclaim space safely. {data && <span className="muted">Scanned {formatRelativeTime(data.scannedAt)}.</span>}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => reload()} disabled={loading}>
          <Icon name="refresh" size={15} /> Rescan
        </button>
      </div>

      {/* Storage */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-title">
          <Icon name="disk" size={16} /> {storage?.volume ?? 'Disk'}
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
                <span className="k">Total</span>
                <span className="v">{formatBytes(storage.totalBytes)}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="skeleton" style={{ height: 12 }} />
        )}
      </div>

      {/* Smart Cleanup */}
      <div className="card sweep-hero" style={{ marginBottom: 16, padding: '22px 24px' }}>
        <div className="sweep-hero-info">
          <div className="sweep-hero-title">Smart Cleanup</div>
          <div className="sweep-hero-sub">
            Clears rebuildable caches &amp; temporary files and empties the bin. Your personal files are never touched.
          </div>
          <div style={{ marginTop: 12, fontSize: 26, fontWeight: 720, letterSpacing: '-0.03em' }} className="gradient-text">
            {formatBytes(reclaimable)}
            <span style={{ fontSize: 13, fontWeight: 600 }} className="muted">
              {' '}
              reclaimable
            </span>
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setSmartConfirm(true)}
          disabled={busy || reclaimable === 0}
          style={{ alignSelf: 'center', padding: '13px 22px' }}
        >
          {busy ? <span className="spinner" /> : <Icon name="bolt" size={17} />} Clean Up
        </button>
      </div>

      {/* Smart categories with include toggles */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-title">
          <Icon name="sparkles" size={16} /> Included in Smart Cleanup
        </div>
        {smartCats.length === 0 ? (
          <EmptyState icon="check" title="Nothing to clean" desc="No safe cleanup candidates were found." />
        ) : (
          smartCats.map((cat) => (
            <div className="setting" key={cat.id}>
              <div className="setting-main">
                <div className="row" style={{ gap: 8 }}>
                  <span className="setting-title">{cat.title}</span>
                  <Badge kind={`risk-${cat.risk}`}>{riskLabel[cat.risk]}</Badge>
                </div>
                <div className="setting-desc">
                  {cat.description} · {formatBytes(cat.sizeBytes)}
                  {cat.itemCount > 0 && ` · ${pluralize(cat.itemCount, 'item')}`}
                </div>
              </div>
              {cat.risk === 'system' && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setEmptyConfirm(cat)}
                  disabled={busy || cat.itemCount === 0}
                >
                  <Icon name="trash" size={15} /> Empty
                </button>
              )}
              <Toggle
                checked={!disabled.has(cat.id)}
                onChange={() => toggleSmart(cat.id)}
                label={`Include ${cat.title} in Smart Cleanup`}
              />
            </div>
          ))
        )}
      </div>

      {/* Review categories */}
      <div className="card card-pad">
        <div className="card-title">
          <Icon name="app" size={16} /> Review &amp; remove
        </div>
        <div className="setting-desc" style={{ marginBottom: 8 }}>
          These may contain personal files, so you review and choose what to remove. Selected items are moved to the{' '}
          {data?.storage.volume?.startsWith('C') ? 'Recycle Bin' : 'Trash'} (reversible).
        </div>
        {reviewCats.map((cat) => (
          <div className="setting" key={cat.id}>
            <div className="setting-main">
              <div className="row" style={{ gap: 8 }}>
                <span className="setting-title">{cat.title}</span>
                <Badge kind="risk-review">Review</Badge>
              </div>
              <div className="setting-desc">
                {formatBytes(cat.sizeBytes)} · {pluralize(cat.itemCount, 'item')}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setReview(cat)} disabled={cat.itemCount === 0}>
              Review <Icon name="chevron" size={14} />
            </button>
          </div>
        ))}
      </div>

      {smartConfirm && (
        <Modal
          title="Run Smart Cleanup?"
          onClose={() => setSmartConfirm(false)}
          actions={
            <>
              <button className="btn btn-ghost" onClick={() => setSmartConfirm(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={runSmart}>
                <Icon name="bolt" size={16} /> Clean {formatBytes(reclaimable)}
              </button>
            </>
          }
        >
          <p>
            This clears rebuildable caches and temporary files and empties the bin — about {formatBytes(reclaimable)}.
            Documents, Downloads and Desktop files are never removed by Smart Cleanup.
          </p>
        </Modal>
      )}

      {emptyConfirm && (
        <Modal
          title={`Empty ${emptyConfirm.title}?`}
          onClose={() => setEmptyConfirm(null)}
          actions={
            <>
              <button className="btn btn-ghost" onClick={() => setEmptyConfirm(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => emptyBin(emptyConfirm)}>
                <Icon name="trash" size={16} /> Empty permanently
              </button>
            </>
          }
        >
          <p>
            This permanently removes {pluralize(emptyConfirm.itemCount, 'item')} ({formatBytes(emptyConfirm.sizeBytes)}).
            This can’t be undone.
          </p>
        </Modal>
      )}

      {review && <ReviewModal category={review} onClose={() => setReview(null)} onDone={() => reload(true)} />}
    </div>
  )
}

function ReviewModal({
  category,
  onClose,
  onDone
}: {
  category: CleanupCategory
  onClose: () => void
  onDone: () => void
}) {
  const [items, setItems] = useState<CleanupItem[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    let alive = true
    window.clova.listCleanupItems(category.id).then((list) => alive && setItems(list))
    return () => {
      alive = false
    }
  }, [category.id])

  const toggle = (path: string) => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const selectedSize = useMemo(
    () => (items ?? []).filter((i) => selected.has(i.path)).reduce((sum, i) => sum + i.sizeBytes, 0),
    [items, selected]
  )

  const remove = async () => {
    setBusy(true)
    try {
      const res = await window.clova.runCleanup({ categoryId: category.id, paths: [...selected] })
      toast(
        res.removedCount === 0
          ? 'Nothing was removed.'
          : `Moved ${pluralize(res.removedCount, 'item')} to the bin · ${formatBytes(res.reclaimedBytes)}.`
      )
      onDone()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Review ${category.title}`}
        style={{ maxWidth: 560 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="row between">
          <h3>Review {category.title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="close" size={15} />
          </button>
        </div>
        <p>Choose items to move to the bin. Largest items are listed first.</p>

        <div className="scroll-list" style={{ maxHeight: 320, marginTop: 12 }}>
          {items === null ? (
            [0, 1, 2, 3, 4].map((i) => <div className="app-row skeleton" key={i} style={{ height: 44 }} />)
          ) : items.length === 0 ? (
            <EmptyState icon="check" title="Empty" desc={`Nothing in ${category.title}.`} />
          ) : (
            items.map((item) => (
              <label className="app-row" key={item.path} style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selected.has(item.path)}
                  onChange={() => toggle(item.path)}
                  style={{ width: 17, height: 17, accentColor: 'var(--brand-coral)' }}
                />
                <span className="app-icon placeholder" aria-hidden="true">
                  <Icon name={item.isDirectory ? 'app' : 'app'} size={15} />
                </span>
                <div className="app-meta">
                  <div className="app-name">{item.name}</div>
                  <div className="app-sub">
                    {formatBytes(item.sizeBytes)} · {formatRelativeTime(item.modifiedAt)}
                  </div>
                </div>
              </label>
            ))
          )}
        </div>

        <div className="modal-actions">
          <span className="muted" style={{ marginRight: 'auto', fontSize: 12.5 }}>
            {selected.size > 0 ? `${pluralize(selected.size, 'item')} · ${formatBytes(selectedSize)}` : 'Nothing selected'}
          </span>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={remove} disabled={busy || selected.size === 0}>
            {busy ? <span className="spinner" /> : <Icon name="trash" size={16} />} Move to bin
          </button>
        </div>
      </div>
    </div>
  )
}
