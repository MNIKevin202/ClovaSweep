import { useEffect, useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../lib/icons'

export function Toggle({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    />
  )
}

export function StatCard({
  value,
  label,
  hint,
  icon,
  accent
}: {
  value: ReactNode
  label: string
  hint?: string
  icon?: IconName
  accent?: boolean
}) {
  return (
    <div className={`card stat${accent ? ' accent' : ''}`}>
      {icon && <Icon name={icon} size={20} className="stat-ico" />}
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}

export function Badge({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <span className={`badge badge-${kind}`}>
      {(kind === 'running' || kind === 'idle') && <span className="badge-dot" />}
      {children}
    </span>
  )
}

export function EmptyState({
  icon = 'sparkles',
  title,
  desc,
  action
}: {
  icon?: IconName
  title: string
  desc?: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty-ico">
        <Icon name={icon} size={26} />
      </div>
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
      {action}
    </div>
  )
}

/** Lazily loads an app icon by id; shows a monogram placeholder meanwhile. */
export function AppIconImage({
  app,
  size = 30
}: {
  app: { id: string; name: string; path?: string; bundleId?: string }
  size?: number
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setSrc(null)
    setFailed(false)
    window.clova
      .getAppIcon({ id: app.id, path: app.path, bundleId: app.bundleId })
      .then((data) => {
        if (alive) {
          if (data) setSrc(data)
          else setFailed(true)
        }
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [app.id, app.path, app.bundleId])

  const style = { width: size, height: size }
  if (src) return <img className="app-icon" src={src} alt="" style={style} />
  if (failed)
    return (
      <span className="app-icon placeholder" style={style} aria-hidden="true">
        {app.name.charAt(0).toUpperCase()}
      </span>
    )
  return <span className="app-icon skeleton" style={style} aria-hidden="true" />
}

export function Modal({
  title,
  children,
  onClose,
  actions
}: {
  title: string
  children: ReactNode
  onClose: () => void
  actions: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div>{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  )
}

export function IconButton({
  icon,
  label,
  onClick,
  spinning,
  disabled
}: {
  icon: IconName
  label: string
  onClick: () => void
  spinning?: boolean
  disabled?: boolean
}) {
  return (
    <button className="btn btn-ghost btn-sm" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      {spinning ? <span className="spinner" /> : <Icon name={icon} size={16} />}
    </button>
  )
}
