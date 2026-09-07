import { useCallback, useEffect, useRef, useState } from 'react'

/** Run an async function, exposing data/loading/error and a manual reload. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  // Keep the latest fn without making it a dependency.
  const fnRef = useRef(fn)
  fnRef.current = fn

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const result = await fnRef.current()
      if (mounted.current) {
        setData(result)
        setError(null)
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      if (mounted.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    mounted.current = true
    reload()
    return () => {
      mounted.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error, reload }
}

/** Subscribe to main-process "data changed" notifications. */
export function useDataChanged(cb: () => void) {
  const cbRef = useRef(cb)
  cbRef.current = cb
  useEffect(() => {
    return window.clova.onDataChanged(() => cbRef.current())
  }, [])
}

/** Subscribe to sweep-complete events. */
export function useSweepComplete(cb: (closed: number) => void) {
  const cbRef = useRef(cb)
  cbRef.current = cb
  useEffect(() => {
    return window.clova.onSweepComplete((r) => cbRef.current(r.record.closedCount))
  }, [])
}
