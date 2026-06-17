import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { getDelayUntilNextLocalDate, getLocalDateKey } from '../utils/dateKey'

interface LocalDateContextValue {
  currentDateKey: string
  refreshCurrentDateKey: () => string
}

interface LocalDateProviderProps {
  children: ReactNode
  getNow?: () => Date
}

const LocalDateContext = createContext<LocalDateContextValue | null>(null)

export function LocalDateProvider({ children, getNow = () => new Date() }: LocalDateProviderProps) {
  const getCurrentDateKey = useCallback(() => getLocalDateKey(getNow()), [getNow])
  const [currentDateKey, setCurrentDateKey] = useState(getCurrentDateKey)
  const currentDateKeyRef = useRef(currentDateKey)

  const refreshCurrentDateKey = useCallback(() => {
    const nextDateKey = getCurrentDateKey()
    if (nextDateKey !== currentDateKeyRef.current) {
      currentDateKeyRef.current = nextDateKey
      setCurrentDateKey(nextDateKey)
    }
    return nextDateKey
  }, [getCurrentDateKey])

  useEffect(() => {
    if (typeof window === 'undefined') return

    let timeout: number | null = null
    let disposed = false

    const clearScheduledRollover = () => {
      if (timeout !== null) {
        window.clearTimeout(timeout)
        timeout = null
      }
    }

    const scheduleRollover = () => {
      if (disposed) return
      clearScheduledRollover()
      timeout = window.setTimeout(() => {
        refreshCurrentDateKey()
        scheduleRollover()
      }, getDelayUntilNextLocalDate(getNow()))
    }

    const refreshAndReschedule = () => {
      refreshCurrentDateKey()
      scheduleRollover()
    }

    const handleVisibilityChange = () => {
      if (typeof document === 'undefined' || !document.hidden) {
        refreshAndReschedule()
      }
    }

    scheduleRollover()
    window.addEventListener('focus', refreshAndReschedule)
    window.addEventListener('pageshow', refreshAndReschedule)
    document?.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      disposed = true
      clearScheduledRollover()
      window.removeEventListener('focus', refreshAndReschedule)
      window.removeEventListener('pageshow', refreshAndReschedule)
      document?.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [getNow, refreshCurrentDateKey])

  return (
    <LocalDateContext.Provider value={{ currentDateKey, refreshCurrentDateKey }}>
      {children}
    </LocalDateContext.Provider>
  )
}

export function useCurrentLocalDate() {
  const context = useContext(LocalDateContext)
  if (context) return context

  const currentDateKey = getLocalDateKey()
  return {
    currentDateKey,
    refreshCurrentDateKey: () => currentDateKey,
  }
}

export function useCurrentLocalDateKey() {
  return useCurrentLocalDate().currentDateKey
}
