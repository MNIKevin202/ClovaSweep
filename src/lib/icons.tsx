/** Inline stroke icons (currentColor). No external icon font — CSP friendly. */
import type { CSSProperties } from 'react'

export type IconName =
  | 'overview'
  | 'shield'
  | 'broom'
  | 'sparkles'
  | 'chart'
  | 'settings'
  | 'refresh'
  | 'plus'
  | 'close'
  | 'check'
  | 'power'
  | 'clock'
  | 'app'
  | 'trash'
  | 'disk'
  | 'chevron'
  | 'lock'
  | 'bolt'
  | 'info'

const paths: Record<IconName, JSX.Element> = {
  overview: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  broom: (
    <>
      <path d="M19.5 4.5l-8 8" />
      <path d="M14.5 9.5l-8 3.2c-.7.3-1 1.1-.6 1.8l2.4 4.2c.4.7 1.3.9 1.9.4l6.6-5.3" />
      <path d="M4 20l3-1.5" />
      <path d="M8.5 21l1.5-3" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
      <path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <rect x="7" y="12" width="3" height="5" rx="1" />
      <rect x="12" y="8" width="3" height="9" rx="1" />
      <rect x="17" y="5" width="3" height="12" rx="1" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a7.8 7.8 0 000-2l1.9-1.5-2-3.4-2.3.9a7.6 7.6 0 00-1.7-1L14.9 2h-4l-.4 2.5a7.6 7.6 0 00-1.7 1L6.5 4.6l-2 3.4L6.4 9.5a7.8 7.8 0 000 2l-1.9 1.5 2 3.4 2.3-.9c.5.4 1.1.8 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.3.9 2-3.4-1.9-1.5z" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 10-.6 4" />
      <path d="M20 5v6h-6" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12M18 6L6 18" />
    </>
  ),
  check: (
    <>
      <path d="M5 12l4.5 4.5L19 7" />
    </>
  ),
  power: (
    <>
      <path d="M12 4v8" />
      <path d="M7.5 7a7 7 0 109 0" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  app: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M9 9h6v6H9z" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
      <path d="M6 7l1 12a1 1 0 001 1h8a1 1 0 001-1l1-12" />
    </>
  ),
  disk: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  chevron: (
    <>
      <path d="M9 6l6 6-6 6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  bolt: (
    <>
      <path d="M13 3L5 13h5l-1 8 8-10h-5l1-8z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  )
}

export function Icon({
  name,
  size = 20,
  className,
  style
}: {
  name: IconName
  size?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}
