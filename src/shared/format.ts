/** Small, dependency-free formatting helpers shared by main and renderer. */

/** Format a byte count as a human-readable string (e.g. "1.2 GB"). */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  const digits = i === 0 ? 0 : decimals
  return `${value.toFixed(digits)} ${units[i]}`
}

/** Relative time like "just now", "3m ago", "2h ago", "Yesterday", or a date. */
export function formatRelativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'Never'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 'Never'
  const diff = Math.max(0, now - t)
  const sec = Math.floor(diff / 1000)
  if (sec < 10) return 'Just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

/** Pluralise a noun for a count: pluralize(1,'app') -> "1 app". */
export function pluralize(count: number, noun: string, plural?: string): string {
  const word = count === 1 ? noun : plural ?? `${noun}s`
  return `${count} ${word}`
}
