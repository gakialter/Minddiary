import { useCallback, useEffect, useRef } from 'react'
import { logger } from '../utils/logger'
import type { ActiveAppInfo, FocusWhitelistItem } from '../types'

const REMINDER_THROTTLE_MS = 30 * 1000
const DEFAULT_IGNORE_MS = 5 * 60 * 1000
const BUILT_IN_ALLOWED = ['minddiary', 'mind diary', 'electron']

interface UseFocusGuardOptions {
  isRunning: boolean
  modeId: string
  whitelist: FocusWhitelistItem[]
  enabled: boolean
  intervalSec: number
  onViolation: (app: ActiveAppInfo) => void
}

function normalizeToken(value: string | undefined): string {
  return (value || '').trim().toLowerCase()
}

function basenameOnly(value: string | undefined): string {
  if (!value) return ''
  const normalized = value.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop()?.toLowerCase() || normalizeToken(value)
}

function activeAppKey(app: ActiveAppInfo): string {
  return normalizeToken(app.processName) || basenameOnly(app.executable) || normalizeToken(app.name)
}

function isBuiltInAllowedApp(app: ActiveAppInfo): boolean {
  const values = [app.name, app.processName, basenameOnly(app.executable)].map(normalizeToken)
  return values.some(value => BUILT_IN_ALLOWED.some(allowed => value.includes(allowed)))
}

export function isFocusAppAllowed(app: ActiveAppInfo, whitelist: FocusWhitelistItem[]): boolean {
  if (isBuiltInAllowedApp(app)) return true

  const appProcess = normalizeToken(app.processName)
  const appExecutable = basenameOnly(app.executable)
  const appName = normalizeToken(app.name)

  return whitelist.some(item => {
    if (!item.enabled) return false
    const itemProcess = normalizeToken(item.processName)
    if (itemProcess && appProcess && itemProcess === appProcess) return true

    const itemExecutable = basenameOnly(item.executable)
    if (itemExecutable && appExecutable && itemExecutable === appExecutable) return true

    const itemName = normalizeToken(item.name)
    return !!itemName && !!appName && itemName === appName
  })
}

export function useFocusGuard({
  isRunning,
  modeId,
  whitelist,
  enabled,
  intervalSec,
  onViolation,
}: UseFocusGuardOptions) {
  const lastNoticeAtRef = useRef<Map<string, number>>(new Map())
  const ignoredUntilRef = useRef<Map<string, number>>(new Map())
  const onViolationRef = useRef(onViolation)
  const isCheckingRef = useRef(false)
  const consecutiveErrorsRef = useRef(0)

  useEffect(() => {
    onViolationRef.current = onViolation
  }, [onViolation])

  const ignoreAppFor = useCallback((app: ActiveAppInfo, durationMs = DEFAULT_IGNORE_MS) => {
    ignoredUntilRef.current.set(activeAppKey(app), Date.now() + durationMs)
  }, [])

  useEffect(() => {
    const shouldRun = enabled && isRunning && (modeId === 'work' || modeId === 'custom')
    if (!shouldRun) return

    const safeIntervalMs = Math.max(3, Math.min(30, Number(intervalSec) || 5)) * 1000

    const checkActiveApp = async () => {
      if (isCheckingRef.current) return
      isCheckingRef.current = true
      try {
        const app = await window.api?.focusGuard?.getActiveApp?.()
        consecutiveErrorsRef.current = 0
        if (!app) return
        const allowed = isFocusAppAllowed(app, whitelist)
        if (allowed) return

        const key = activeAppKey(app)
        const now = Date.now()
        const ignoredUntil = ignoredUntilRef.current.get(key) || 0
        if (ignoredUntil > now) return

        const lastNoticeAt = lastNoticeAtRef.current.get(key) || 0
        if (now - lastNoticeAt < REMINDER_THROTTLE_MS) return

        lastNoticeAtRef.current.set(key, now)
        onViolationRef.current(app)
      } catch (error) {
        consecutiveErrorsRef.current++
        const errCount = consecutiveErrorsRef.current
        if (errCount === 1 || errCount % 10 === 0) {
          logger.warn(`[focusGuard] Active app check failed (count: ${errCount}):`, error instanceof Error ? error.message : String(error))
        }
      } finally {
        isCheckingRef.current = false
      }
    }

    void checkActiveApp()
    const timer = window.setInterval(() => {
      void checkActiveApp()
    }, safeIntervalMs)

    return () => window.clearInterval(timer)
  }, [enabled, intervalSec, isRunning, modeId, whitelist])

  return { ignoreAppFor }
}
