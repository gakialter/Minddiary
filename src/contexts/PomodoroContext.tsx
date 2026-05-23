import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react'
import { useDiary } from './DiaryContext'
import { coerceBoolean } from '../utils/helpers'
import { getDelayUntilNextLocalDate, getLocalDateKey, toLocalDateTimeString } from '../utils/dateKey'
import { logger } from '../utils/logger'
import type { Subject, PomodoroStat } from '../types'

interface PomodoroMode {
  id: string
  label: string
  time: number
  color: string
}

interface PomodoroTimerValue {
  mode: PomodoroMode
  timeLeft: number
  isRunning: boolean
  hasActiveTimerSession: boolean
  progress: number
  circleCircumference: number
  miniCircumference: number
  dynamicModes: Record<string, PomodoroMode>
}

interface PomodoroDataValue {
  subjects: Subject[]
  selectedSubject: number | null
  todayStats: PomodoroStat[]
  todayTotal: number
  customMinutes: number
  alertState: {
    visible: boolean
    isWorkComplete: boolean
    duration: number
    todayTotal: number
  }
}

interface PomodoroActionsValue {
  setMode: React.Dispatch<React.SetStateAction<PomodoroMode>>
  setSelectedSubject: React.Dispatch<React.SetStateAction<number | null>>
  setCustomMinutes: React.Dispatch<React.SetStateAction<number>>
  toggleTimer: () => void
  resetTimer: () => void
  formatTime: (seconds: number) => string
  loadSubjects: () => Promise<void>
  loadTodayStats: (dateKey?: string) => Promise<void>
  setOnBreakStart: (cb: (() => void) | null) => void
  dismissAlert: () => void
}

// Separate contexts for optimized re-renders
const TimerContext = createContext<PomodoroTimerValue | null>(null)
const DataContext = createContext<PomodoroDataValue | null>(null)
const ActionsContext = createContext<PomodoroActionsValue | null>(null)

const ACTIVE_POMODORO_SESSION_STORAGE_KEY = 'pomodoro-active-session-v1'
const ACTIVE_SESSION_STALE_MS = 12 * 60 * 60 * 1000
const RESTORE_CLOCK_SKEW_MS = 5 * 60 * 1000
const MAX_POMODORO_MODE_SECONDS = 24 * 60 * 60

type PomodoroModeId = 'work' | 'custom' | 'short_break' | 'long_break'

type PersistedPomodoroSession = {
  version: 1
  modeId: PomodoroModeId
  modeTime: number
  customMinutes: number
  selectedSubject: number | null
  timeLeft: number
  isRunning: boolean
  startedAtMs: number | null
  endTimeMs: number | null
  savedAtMs: number
}

type PersistedSessionRestore =
  | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'stale' }
  | { status: 'paused'; session: PersistedPomodoroSession; timeLeft: number }
  | { status: 'running'; session: PersistedPomodoroSession; timeLeft: number }
  | { status: 'expired'; session: PersistedPomodoroSession }

function isPomodoroModeId(value: unknown): value is PomodoroModeId {
  return value === 'work' || value === 'custom' || value === 'short_break' || value === 'long_break'
}

function isFocusModeId(value: string): boolean {
  return value === 'work' || value === 'custom'
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isValidPositiveSeconds(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value > 0
    && value <= MAX_POMODORO_MODE_SECONDS
}

function clampSeconds(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(Math.ceil(value), max))
}

function clearPersistedActiveSession() {
  try {
    localStorage.removeItem(ACTIVE_POMODORO_SESSION_STORAGE_KEY)
  } catch { /* ignore */ }
}

function writePersistedActiveSession(session: PersistedPomodoroSession) {
  try {
    localStorage.setItem(ACTIVE_POMODORO_SESSION_STORAGE_KEY, JSON.stringify(session))
  } catch { /* ignore */ }
}

function getModeFromPersistedSession(
  session: PersistedPomodoroSession,
  dynamicModes: Record<string, PomodoroMode>,
): PomodoroMode | null {
  const baseMode = Object.values(dynamicModes).find(candidate => candidate.id === session.modeId)
  return baseMode ? { ...baseMode, time: session.modeTime } : null
}

function parsePersistedActiveSession(nowMs: number): PersistedSessionRestore {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(ACTIVE_POMODORO_SESSION_STORAGE_KEY)
  } catch {
    return { status: 'missing' }
  }

  if (!raw) return { status: 'missing' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: 'invalid' }
  }

  if (!parsed || typeof parsed !== 'object') return { status: 'invalid' }
  const candidate = parsed as Partial<PersistedPomodoroSession>

  if (
    candidate.version !== 1
    || !isPomodoroModeId(candidate.modeId)
    || !isValidPositiveSeconds(candidate.modeTime)
    || !isValidPositiveSeconds(candidate.timeLeft)
    || candidate.timeLeft > candidate.modeTime
    || typeof candidate.isRunning !== 'boolean'
    || !isValidTimestamp(candidate.savedAtMs)
    || typeof candidate.customMinutes !== 'number'
    || !Number.isFinite(candidate.customMinutes)
    || candidate.customMinutes < 1
    || candidate.customMinutes > 120
    || (
      candidate.selectedSubject !== null
      && (
        typeof candidate.selectedSubject !== 'number'
        || !Number.isInteger(candidate.selectedSubject)
        || candidate.selectedSubject < 0
      )
    )
  ) {
    return { status: 'invalid' }
  }

  if (
    nowMs - candidate.savedAtMs > ACTIVE_SESSION_STALE_MS
    || candidate.savedAtMs - nowMs > RESTORE_CLOCK_SKEW_MS
  ) {
    return { status: 'stale' }
  }

  if (candidate.startedAtMs !== null) {
    if (!isValidTimestamp(candidate.startedAtMs)) return { status: 'invalid' }
    if (candidate.startedAtMs - nowMs > RESTORE_CLOCK_SKEW_MS) return { status: 'stale' }
  } else if (isFocusModeId(candidate.modeId)) {
    return { status: 'invalid' }
  }

  const session: PersistedPomodoroSession = {
    version: 1,
    modeId: candidate.modeId,
    modeTime: candidate.modeTime,
    customMinutes: candidate.customMinutes,
    selectedSubject: candidate.selectedSubject ?? null,
    timeLeft: candidate.timeLeft,
    isRunning: candidate.isRunning,
    startedAtMs: candidate.startedAtMs ?? null,
    endTimeMs: candidate.endTimeMs ?? null,
    savedAtMs: candidate.savedAtMs,
  }

  if (!session.isRunning) {
    return { status: 'paused', session, timeLeft: clampSeconds(session.timeLeft, session.modeTime) }
  }

  if (!isValidTimestamp(session.endTimeMs)) return { status: 'invalid' }

  if (session.endTimeMs - nowMs > session.modeTime * 1000 + RESTORE_CLOCK_SKEW_MS) {
    return { status: 'stale' }
  }

  const overdueMs = nowMs - session.endTimeMs
  if (overdueMs > ACTIVE_SESSION_STALE_MS) return { status: 'stale' }
  if (overdueMs >= 0) return { status: 'expired', session }

  return {
    status: 'running',
    session,
    timeLeft: Math.max(1, clampSeconds((session.endTimeMs - nowMs) / 1000, session.modeTime)),
  }
}

const MODES: Record<string, PomodoroMode> = {
  WORK: { id: 'work', label: '专注', time: 25 * 60, color: 'var(--accent)' },
  SHORT_BREAK: { id: 'short_break', label: '短休', time: 5 * 60, color: 'var(--success)' },
  LONG_BREAK: { id: 'long_break', label: '长休', time: 15 * 60, color: 'var(--info)' }
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const { settingsData, subjects: subjectsAPI, pomodoro: pomodoroAPI, notification: notificationAPI } = useDiary()
  const customWorkTime = (Number(settingsData?.pomodoroMinutes) || 25) * 60

  const [customMinutes, setCustomMinutes] = useState(() => {
    try {
      const saved = localStorage.getItem('pomodoro-custom-minutes')
      if (saved) return Number(saved)
    } catch { /* ignore */ }
    return 30
  })

  useEffect(() => {
    try { localStorage.setItem('pomodoro-custom-minutes', customMinutes.toString()) } catch { /* ignore */ }
  }, [customMinutes])

  const dynamicModes = useMemo((): Record<string, PomodoroMode> => ({
    ...MODES,
    WORK: { ...MODES.WORK!, time: customWorkTime },
    CUSTOM: { id: 'custom', label: '自定义', time: customMinutes * 60, color: 'var(--warning)' }
  }), [customWorkTime, customMinutes])

  const [mode, setModeState] = useState<PomodoroMode>(dynamicModes.WORK!)
  const [timeLeft, setTimeLeft] = useState<number>(dynamicModes.WORK!.time)
  const [isRunning, setIsRunning] = useState(false)

  // Subject and stats state
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [selectedSubject, setSelectedSubject] = useState<number | null>(null)
  const [todayStats, setTodayStats] = useState<PomodoroStat[]>([])
  const [todayTotal, setTodayTotal] = useState(0)
  const [todayDateKey, setTodayDateKey] = useState(() => getLocalDateKey())
  const todayDateKeyRef = useRef(todayDateKey)
  const sessionStartedAtRef = useRef<Date | null>(null)
  const onBreakStartRef = useRef<(() => void) | null>(null)
  const setOnBreakStart = useCallback((cb: (() => void) | null) => {
    onBreakStartRef.current = cb
  }, [])

  // Alert modal state
  const [alertState, setAlertState] = useState({
    visible: false, isWorkComplete: true, duration: 0, todayTotal: 0,
  })

  const dismissAlert = useCallback(() => setAlertState(s => ({ ...s, visible: false })), [])

  const endTimeRef = useRef<number | null>(null)
  const activeSessionRef = useRef(false)
  const [hasActiveTimerSession, setHasActiveTimerSession] = useState(false)
  const restoreAttemptedRef = useRef(false)
  const skipNextPersistWriteRef = useRef(false)
  const modeRef = useRef(mode)
  const lastTickRemainingRef = useRef(timeLeft)

  useEffect(() => {
    todayDateKeyRef.current = todayDateKey
  }, [todayDateKey])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  const loadSubjects = useCallback(async () => {
    try {
      const data = await subjectsAPI.getAll()
      setSubjects(data || [])
    } catch (e) { logger.error(e) }
  }, [subjectsAPI])

  const loadTodayStats = useCallback(async (dateKey = getLocalDateKey()) => {
    setTodayDateKey(dateKey)
    todayDateKeyRef.current = dateKey
    try {
      const stats = await pomodoroAPI.getStats(dateKey)
      setTodayStats(stats || [])
      const total = await pomodoroAPI.getDailyTotal(dateKey)
      setTodayTotal(total || 0)
    } catch (e) { logger.error(e) }
  }, [pomodoroAPI])

  useEffect(() => {
    loadSubjects()
    loadTodayStats()
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [loadSubjects, loadTodayStats])

  useEffect(() => {
    let timeout: number
    const scheduleRolloverCheck = () => {
      timeout = window.setTimeout(() => {
        const nextDateKey = getLocalDateKey()
        const previousDateKey = todayDateKeyRef.current
        if (nextDateKey !== previousDateKey) {
          setTodayStats([])
          setTodayTotal(0)
          todayDateKeyRef.current = nextDateKey
          void loadTodayStats(nextDateKey)
        }
        scheduleRolloverCheck()
      }, getDelayUntilNextLocalDate())
    }

    scheduleRolloverCheck()
    return () => window.clearTimeout(timeout)
  }, [loadTodayStats])

  const clearActiveSessionState = useCallback(() => {
    activeSessionRef.current = false
    setHasActiveTimerSession(false)
    endTimeRef.current = null
    sessionStartedAtRef.current = null
    clearPersistedActiveSession()
  }, [])

  const setIdleMode = useCallback((nextMode: PomodoroMode) => {
    modeRef.current = nextMode
    lastTickRemainingRef.current = nextMode.time
    endTimeRef.current = null
    setModeState(nextMode)
    setTimeLeft(nextMode.time)
    setIsRunning(false)
  }, [])

  const setMode = useCallback<React.Dispatch<React.SetStateAction<PomodoroMode>>>((nextModeAction) => {
    const nextMode = typeof nextModeAction === 'function'
      ? nextModeAction(modeRef.current)
      : nextModeAction
    clearActiveSessionState()
    setIdleMode(nextMode)
  }, [clearActiveSessionState, setIdleMode])

  // Update work/custom time if settings change while idle.
  // Paused focus sessions keep their original duration until reset or mode change.
  useEffect(() => {
    if (isRunning || activeSessionRef.current || sessionStartedAtRef.current) return
    if (mode.id === 'work') {
      setIdleMode(dynamicModes.WORK!)
    } else if (mode.id === 'custom') {
      setIdleMode(dynamicModes.CUSTOM!)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customWorkTime, customMinutes, isRunning, setIdleMode])

  const addPomodoroSessionRecord = useCallback(async ({
    durationSeconds,
    subjectId,
    startedAt,
    completedAt,
  }: {
    durationSeconds: number
    subjectId: number | null
    startedAt: Date
    completedAt: Date
  }) => {
    const dateKey = getLocalDateKey(startedAt)
    await pomodoroAPI.addSession({
      subject_id: subjectId,
      duration: durationSeconds / 60,
      date_key: dateKey,
      started_at: toLocalDateTimeString(startedAt),
      completed_at: toLocalDateTimeString(completedAt),
    })
    loadTodayStats()
  }, [pomodoroAPI, loadTodayStats])

  // Phase-complete handler
  const handlePhaseComplete = useCallback(async () => {
    const completedMode = mode
    const completedSubject = selectedSubject
    const startedAtForRecord = sessionStartedAtRef.current

    clearActiveSessionState()
    setIsRunning(false)
    endTimeRef.current = null

    // ── Notification sound (Web Audio API beep, no external file needed) ──
    try {
      const soundEnabled = coerceBoolean(settingsData?.pomodoroSound, true)
      const alertEnabled = coerceBoolean(settingsData?.pomodoroAlert, true)

      if (soundEnabled) {
        const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        const ctx = AudioCtx ? new AudioCtx() : null
        if (ctx) {
          const gainNode = ctx.createGain()
          gainNode.gain.setValueAtTime(0.35, ctx.currentTime)
          gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2)
          gainNode.connect(ctx.destination)
          // Two-tone chime
          const tones = [880, 1046]
          tones.forEach((freq, i) => {
            const osc = ctx.createOscillator()
            osc.type = 'sine'
            osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.18)
            osc.connect(gainNode)
            osc.start(ctx.currentTime + i * 0.18)
            osc.stop(ctx.currentTime + i * 0.18 + 1.0)
          })
          setTimeout(() => ctx.close(), 2000)
        }
      }

      // ── Alert modal ──
      if (alertEnabled) {
        const alertDateKey = getLocalDateKey()
        const newTotal = await pomodoroAPI.getDailyTotal(alertDateKey).catch(() => todayTotal)
        setAlertState({
          visible: true,
          isWorkComplete: completedMode.id === 'work',
          duration: Math.round(completedMode.time / 60),
          todayTotal: newTotal,
        })
      }
    } catch (e) {
      logger.warn('Pomodoro notification error:', e)
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('番茄钟提醒', {
        body: completedMode.id === 'work' ? '专注完成，休息一下吧！' : '休息结束，准备专注！',
        icon: '/favicon.ico'
      })
    }

    if (completedMode.id === 'work' || completedMode.id === 'custom') {
      try {
        const completedAt = new Date()
        const startedAt = startedAtForRecord ?? new Date(completedAt.getTime() - completedMode.time * 1000)
        await addPomodoroSessionRecord({
          durationSeconds: completedMode.time,
          subjectId: completedSubject,
          startedAt,
          completedAt,
        })
        await notificationAPI.show('番茄钟完成！', '干得漂亮，休息几分钟吧～')
      } catch (e) { logger.error(e) }
      // Fire break-start callback so App can show BreakReviewModal
      if (onBreakStartRef.current) {
        onBreakStartRef.current()
      }
      setIdleMode(dynamicModes.SHORT_BREAK!)
    } else {
      await notificationAPI.show('休息结束', '精力充沛，继续加油！').catch(() => { })
      setIdleMode(dynamicModes.WORK!)
    }
  }, [
    mode,
    selectedSubject,
    todayTotal,
    settingsData,
    notificationAPI,
    dynamicModes,
    addPomodoroSessionRecord,
    clearActiveSessionState,
    setIdleMode,
  ])

  useEffect(() => {
    if (restoreAttemptedRef.current) return
    restoreAttemptedRef.current = true

    const nowMs = Date.now()
    const restore = parsePersistedActiveSession(nowMs)

    if (restore.status === 'missing') return

    if (restore.status === 'invalid' || restore.status === 'stale') {
      clearActiveSessionState()
      return
    }

    if (restore.status === 'expired') {
      clearActiveSessionState()
      const nextMode = isFocusModeId(restore.session.modeId)
        ? dynamicModes.SHORT_BREAK!
        : dynamicModes.WORK!
      setIdleMode(nextMode)

      if (isFocusModeId(restore.session.modeId) && restore.session.startedAtMs && restore.session.endTimeMs) {
        void addPomodoroSessionRecord({
          durationSeconds: restore.session.modeTime,
          subjectId: restore.session.selectedSubject,
          startedAt: new Date(restore.session.startedAtMs),
          completedAt: new Date(restore.session.endTimeMs),
        }).catch(error => logger.error(error))
      }
      return
    }

    const restoredMode = getModeFromPersistedSession(restore.session, dynamicModes)
    if (!restoredMode) {
      clearActiveSessionState()
      return
    }

    skipNextPersistWriteRef.current = true
    activeSessionRef.current = true
    setHasActiveTimerSession(true)
    sessionStartedAtRef.current = restore.session.startedAtMs
      ? new Date(restore.session.startedAtMs)
      : null
    lastTickRemainingRef.current = restore.timeLeft
    endTimeRef.current = restore.status === 'running'
      ? nowMs + restore.timeLeft * 1000
      : null
    modeRef.current = restoredMode

    setCustomMinutes(restore.session.customMinutes)
    setSelectedSubject(restore.session.selectedSubject)
    setModeState(restoredMode)
    setTimeLeft(restore.timeLeft)
    setIsRunning(restore.status === 'running')
  }, [
    addPomodoroSessionRecord,
    clearActiveSessionState,
    dynamicModes,
    setIdleMode,
  ])

  // Main Timer Loop
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    if (isRunning) {
      if (!endTimeRef.current) {
        endTimeRef.current = Date.now() + timeLeft * 1000
      }
      lastTickRemainingRef.current = timeLeft
      interval = setInterval(() => {
        if (endTimeRef.current && Date.now() - endTimeRef.current > ACTIVE_SESSION_STALE_MS) {
          clearInterval(interval!)
          clearActiveSessionState()
          setIdleMode(dynamicModes.WORK!)
          return
        }

        const modeTime = Math.max(1, modeRef.current.time)
        const previousRemaining = lastTickRemainingRef.current
        let remaining = clampSeconds((endTimeRef.current! - Date.now()) / 1000, modeTime)
        if (remaining > previousRemaining) {
          remaining = previousRemaining
          endTimeRef.current = Date.now() + previousRemaining * 1000
        }
        lastTickRemainingRef.current = remaining
        setTimeLeft(remaining)
        if (remaining <= 0) {
          clearInterval(interval!)
          handlePhaseComplete()
        }
      }, 1000)
    } else {
      endTimeRef.current = null
    }
    return () => { if (interval) clearInterval(interval) }
  }, [clearActiveSessionState, dynamicModes, handlePhaseComplete, isRunning, setIdleMode])

  useEffect(() => {
    if (!activeSessionRef.current || !isPomodoroModeId(mode.id)) return
    if (skipNextPersistWriteRef.current) {
      skipNextPersistWriteRef.current = false
      return
    }

    const persistedTimeLeft = Math.max(1, clampSeconds(timeLeft, mode.time))
    const startedAtMs = sessionStartedAtRef.current?.getTime() ?? null
    const endTimeMs = isRunning
      ? endTimeRef.current ?? Date.now() + persistedTimeLeft * 1000
      : null

    writePersistedActiveSession({
      version: 1,
      modeId: mode.id,
      modeTime: mode.time,
      customMinutes,
      selectedSubject,
      timeLeft: persistedTimeLeft,
      isRunning,
      startedAtMs,
      endTimeMs,
      savedAtMs: Date.now(),
    })
  }, [customMinutes, isRunning, mode, selectedSubject, timeLeft])

  const toggleTimer = useCallback(() => {
    const nextIsRunning = !isRunning
    activeSessionRef.current = true
    setHasActiveTimerSession(true)
    lastTickRemainingRef.current = timeLeft

    if (nextIsRunning) {
      if ((mode.id === 'work' || mode.id === 'custom') && !sessionStartedAtRef.current && timeLeft === mode.time) {
        sessionStartedAtRef.current = new Date()
      }
      endTimeRef.current = Date.now() + timeLeft * 1000
    } else {
      endTimeRef.current = null
    }

    setIsRunning(nextIsRunning)
  }, [isRunning, mode.id, mode.time, timeLeft])

  const resetTimer = useCallback(() => {
    const resetMode = mode.id === 'custom'
      ? dynamicModes.CUSTOM!
      : mode.id === 'work'
        ? dynamicModes.WORK!
        : mode

    clearActiveSessionState()
    setIdleMode(resetMode)
  }, [clearActiveSessionState, dynamicModes, mode, setIdleMode])

  const formatTime = useCallback((seconds: number): string => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }, [])

  const progress = mode.time > 0
    ? Math.max(0, Math.min(1, 1 - (timeLeft / mode.time)))
    : 0
  const circleCircumference = 2 * Math.PI * 90
  const miniCircumference = 2 * Math.PI * 18

  // Context Values
  const timerValue = useMemo((): PomodoroTimerValue => ({
    mode, timeLeft, isRunning, hasActiveTimerSession, progress, circleCircumference, miniCircumference, dynamicModes
  }), [mode, timeLeft, isRunning, hasActiveTimerSession, progress, circleCircumference, miniCircumference, dynamicModes])

  const dataValue = useMemo((): PomodoroDataValue => ({
    subjects, selectedSubject, todayStats, todayTotal, customMinutes, alertState
  }), [subjects, selectedSubject, todayStats, todayTotal, customMinutes, alertState])

  const actionsValue = useMemo((): PomodoroActionsValue => ({
    setMode, setSelectedSubject, setCustomMinutes, toggleTimer, resetTimer, formatTime, 
    loadSubjects, loadTodayStats, dismissAlert,
    setOnBreakStart,
  }), [toggleTimer, resetTimer, formatTime, loadSubjects, loadTodayStats, dismissAlert, setOnBreakStart])

  return (
    <TimerContext.Provider value={timerValue}>
      <DataContext.Provider value={dataValue}>
        <ActionsContext.Provider value={actionsValue}>
          {children}
        </ActionsContext.Provider>
      </DataContext.Provider>
    </TimerContext.Provider>
  )
}

// Specific hooks
export function usePomodoroTimer() {
  const ctx = useContext(TimerContext)
  if (!ctx) throw new Error('usePomodoroTimer must be used within PomodoroProvider')
  return ctx
}

export function usePomodoroData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('usePomodoroData must be used within PomodoroProvider')
  return ctx
}

export function usePomodoroActions() {
  const ctx = useContext(ActionsContext)
  if (!ctx) throw new Error('usePomodoroActions must be used within PomodoroProvider')
  return ctx
}

/**
 * @deprecated Use `usePomodoroTimer`, `usePomodoroData`, and `usePomodoroActions` instead.
 * This combined hook re-renders on ANY context change and defeats the split optimization.
 */
// Legacy combined hook (re-renders on any change)
export function usePomodoroContext() {
  const timer = usePomodoroTimer()
  const data = usePomodoroData()
  const actions = usePomodoroActions()
  return useMemo(() => ({ ...timer, ...data, ...actions }), [timer, data, actions])
}
