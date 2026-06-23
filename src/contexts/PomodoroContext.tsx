import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react'
import { useDiary } from './DiaryContext'
import { useCurrentLocalDateKey } from './LocalDateContext'
import { coerceBoolean } from '../utils/helpers'
import { getLocalDateKey, toLocalDateTimeString } from '../utils/dateKey'
import { logger } from '../utils/logger'
import type { StudyTask, Subject, PomodoroStat } from '../types'

interface PomodoroMode {
  id: string
  label: string
  time: number
  color: string
}

interface CountdownFocusSettlementPreview {
  elapsedSeconds: number
  roundedMinutes: number
  capturedAtMs: number
}

interface PomodoroTimerValue {
  mode: PomodoroMode
  timeLeft: number
  isRunning: boolean
  hasActiveTimerSession: boolean
  countdownElapsedSeconds: number
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
    completionKind: PomodoroCompletionKind
    duration: number
    todayTotal: number
    showSettlementActions: boolean
    subjectName: string | null
    taskSettlement: FocusTaskSettlement | null
    settlementError: string | null
    isSettlingTask: boolean
    pendingReviewEntryCreation: PendingReviewEntryCreation | null
  }
  isSavingInterruptedFocus: boolean
  todayTasks: StudyTask[]
  selectedTaskId: number | null
  selectedTask: StudyTask | null
  taskError: string | null
}

interface PomodoroActionsValue {
  setMode: React.Dispatch<React.SetStateAction<PomodoroMode>>
  setSelectedSubject: React.Dispatch<React.SetStateAction<number | null>>
  selectFocusTask: (taskId: number | null) => void
  setCustomMinutes: React.Dispatch<React.SetStateAction<number>>
  toggleTimer: () => Promise<boolean>
  resetTimer: () => void
  loadTodayTasks: (dateKey?: string) => Promise<void>
  settleFocusTask: (options: FocusTaskSettlementOptions) => Promise<boolean>
  resolveFocusReviewEntryCreation: (createEntry: boolean) => Promise<boolean>
  getCountdownFocusSettlementPreview: () => CountdownFocusSettlementPreview | null
  finishCountdownFocusSession: (preview?: CountdownFocusSettlementPreview) => Promise<boolean>
  finishStopwatchSession: () => Promise<boolean>
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

const FALLBACK_TASKS_API = {
  getByDate: async () => [],
  startFocus: async () => { throw new Error('Tasks API unavailable') },
  complete: async () => { throw new Error('Tasks API unavailable') },
  update: async () => { throw new Error('Tasks API unavailable') },
}

const FALLBACK_ENTRIES_API = {
  getByDate: async () => null,
  create: async () => { throw new Error('Entries API unavailable') },
  update: async () => { throw new Error('Entries API unavailable') },
}

const FALLBACK_SUBJECT_CHAPTERS_API = {
  getBySubject: async () => [],
  toggleCompleted: async () => { throw new Error('Subject chapters API unavailable') },
}

const noopRequestDataRefresh = () => {}

type PomodoroModeId = 'work' | 'custom' | 'short_break' | 'long_break' | 'stopwatch'
type PomodoroCompletionKind = 'completed' | 'interrupted'

interface FocusTaskSettlement {
  id: number
  title: string
  subjectName: string | null
  status: StudyTask['status']
  duration: number
  dateKey: string
  completedAt: string
  settlementKey: string
  relatedChapterId: number | null
  chapterTitle: string | null
  chapterCompleted: boolean
}

interface FocusTaskSettlementOptions {
  completeTask: boolean
  completeChapter?: boolean
  reviewText: string
}

interface PendingReviewEntryCreation {
  reviewText: string
}

type PersistedPomodoroSession = {
  version: 1
  modeId: PomodoroModeId
  modeTime: number
  customMinutes: number
  selectedSubject: number | null
  selectedTaskId: number | null
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
  return value === 'work' || value === 'custom' || value === 'short_break' || value === 'long_break' || value === 'stopwatch'
}

function isFocusModeId(value: string): boolean {
  return value === 'work' || value === 'custom' || value === 'stopwatch'
}

function isCountdownFocusModeId(value: string): boolean {
  return value === 'work' || value === 'custom'
}

function isStopwatchModeId(value: string): boolean {
  return value === 'stopwatch'
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

function isValidNonNegativeSeconds(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= MAX_POMODORO_MODE_SECONDS
}

function clampSeconds(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(Math.ceil(value), max))
}

function getIdleDisplaySeconds(mode: PomodoroMode): number {
  return isStopwatchModeId(mode.id) ? 0 : mode.time
}

function getRoundedElapsedMinutes(elapsedSeconds: number): number {
  return Math.max(1, Math.round(elapsedSeconds / 60))
}

function clearPersistedActiveSession() {
  try {
    localStorage.removeItem(ACTIVE_POMODORO_SESSION_STORAGE_KEY)
  } catch { /* ignore */ }
}

function writePersistedActiveSession(session: PersistedPomodoroSession): boolean {
  try {
    localStorage.setItem(ACTIVE_POMODORO_SESSION_STORAGE_KEY, JSON.stringify(session))
    return true
  } catch {
    return false
  }
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
  const candidateModeId = candidate.modeId
  if (!isPomodoroModeId(candidateModeId)) return { status: 'invalid' }
  const candidateTimeLeftIsValid = isStopwatchModeId(candidateModeId)
    ? isValidNonNegativeSeconds(candidate.timeLeft)
    : isValidPositiveSeconds(candidate.timeLeft)

  if (
    candidate.version !== 1
    || !isValidPositiveSeconds(candidate.modeTime)
    || !candidateTimeLeftIsValid
    || (
      typeof candidate.timeLeft === 'number'
      && typeof candidate.modeTime === 'number'
      && candidate.timeLeft > candidate.modeTime
    )
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
    || (
      candidate.selectedTaskId !== undefined
      && candidate.selectedTaskId !== null
      && (
        typeof candidate.selectedTaskId !== 'number'
        || !Number.isInteger(candidate.selectedTaskId)
        || candidate.selectedTaskId <= 0
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
  } else if (isFocusModeId(candidateModeId)) {
    return { status: 'invalid' }
  }

  const modeTime = candidate.modeTime as number
  const timeLeft = candidate.timeLeft as number
  const customMinutesForSession = candidate.customMinutes as number
  const isRunningForSession = candidate.isRunning as boolean
  const savedAtMs = candidate.savedAtMs as number

  const session: PersistedPomodoroSession = {
    version: 1,
    modeId: candidateModeId,
    modeTime,
    customMinutes: customMinutesForSession,
    selectedSubject: candidate.selectedSubject ?? null,
    selectedTaskId: candidate.selectedTaskId ?? null,
    timeLeft,
    isRunning: isRunningForSession,
    startedAtMs: candidate.startedAtMs ?? null,
    endTimeMs: candidate.endTimeMs ?? null,
    savedAtMs,
  }

  if (!session.isRunning) {
    return { status: 'paused', session, timeLeft: clampSeconds(session.timeLeft, session.modeTime) }
  }

  if (isStopwatchModeId(session.modeId)) {
    const elapsedSinceSaveSeconds = Math.max(0, (nowMs - session.savedAtMs) / 1000)
    return {
      status: 'running',
      session,
      timeLeft: clampSeconds(session.timeLeft + elapsedSinceSaveSeconds, session.modeTime),
    }
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
  LONG_BREAK: { id: 'long_break', label: '长休', time: 15 * 60, color: 'var(--info)' },
  STOPWATCH: { id: 'stopwatch', label: '正计时', time: MAX_POMODORO_MODE_SECONDS, color: 'var(--info)' }
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const diary = useDiary()
  const currentDateKey = useCurrentLocalDateKey()
  const {
    settingsData,
    subjects: subjectsAPI,
    pomodoro: pomodoroAPI,
    notification: notificationAPI,
  } = diary
  const tasksAPI = diary.tasks ?? FALLBACK_TASKS_API
  const entriesAPI = diary.entries ?? FALLBACK_ENTRIES_API
  const subjectChaptersAPI = diary.subjectChapters ?? FALLBACK_SUBJECT_CHAPTERS_API
  const requestDataRefresh = typeof diary.requestDataRefresh === 'function' ? diary.requestDataRefresh : noopRequestDataRefresh
  const dataRefreshVersion = diary.dataRefreshVersion ?? 0
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
  const [selectedSubject, setSelectedSubjectState] = useState<number | null>(null)
  const [todayTasks, setTodayTasks] = useState<StudyTask[]>([])
  const [selectedTaskId, setSelectedTaskIdState] = useState<number | null>(null)
  const [activeTaskSnapshot, setActiveTaskSnapshotState] = useState<StudyTask | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [todayStats, setTodayStats] = useState<PomodoroStat[]>([])
  const [todayTotal, setTodayTotal] = useState(0)
  const [todayDateKey, setTodayDateKey] = useState(currentDateKey)
  const todayDateKeyRef = useRef(todayDateKey)
  const sessionStartedAtRef = useRef<Date | null>(null)
  const selectedTaskIdRef = useRef<number | null>(null)
  const todayTasksRef = useRef<StudyTask[]>([])
  const activeTaskSnapshotRef = useRef<StudyTask | null>(null)
  const manualSubjectOverrideRef = useRef(false)
  const onBreakStartRef = useRef<(() => void) | null>(null)
  const setOnBreakStart = useCallback((cb: (() => void) | null) => {
    onBreakStartRef.current = cb
  }, [])

  // Alert modal state
  const [alertState, setAlertState] = useState({
    visible: false, isWorkComplete: true, completionKind: 'completed' as PomodoroCompletionKind, duration: 0, todayTotal: 0,
    showSettlementActions: false, subjectName: null as string | null,
    taskSettlement: null as FocusTaskSettlement | null,
    settlementError: null as string | null,
    isSettlingTask: false,
    pendingReviewEntryCreation: null as PendingReviewEntryCreation | null,
  })
  const [isSavingInterruptedFocus, setIsSavingInterruptedFocus] = useState(false)

  const dismissAlert = useCallback(() => setAlertState(s => ({
    ...s,
    visible: false,
    settlementError: null,
    isSettlingTask: false,
    pendingReviewEntryCreation: null,
  })), [])

  const getSubjectName = useCallback((subjectId: number | null) => {
    if (subjectId === null) return null
    return subjects.find(subject => subject.id === subjectId)?.name ?? null
  }, [subjects])

  const setActiveTaskSnapshot = useCallback((task: StudyTask | null) => {
    activeTaskSnapshotRef.current = task
    setActiveTaskSnapshotState(task)
  }, [])

  const buildTaskSettlement = useCallback(async (
    taskId: number | null,
    duration: number,
    completedAt: Date,
    startedAt: Date,
    taskSnapshot: StudyTask | null = activeTaskSnapshotRef.current,
  ): Promise<FocusTaskSettlement | null> => {
    if (taskId === null) return null
    const task = taskSnapshot?.id === taskId
      ? taskSnapshot
      : todayTasksRef.current.find(candidate => candidate.id === taskId)
    if (!task) return null
    const dateKey = getLocalDateKey(startedAt)
    let relatedChapterId = task.related_chapter_id ?? null
    let chapterTitle: string | null = null
    let chapterCompleted = false
    if (relatedChapterId !== null && task.subject_id !== null) {
      try {
        const chapters = await subjectChaptersAPI.getBySubject(task.subject_id)
        const chapter = (chapters || []).find(candidate => candidate.id === relatedChapterId)
        if (chapter) {
          chapterTitle = chapter.title
          chapterCompleted = chapter.completed
        } else {
          relatedChapterId = null
        }
      } catch (error) {
        logger.warn('Failed to resolve task chapter attribution:', error)
        relatedChapterId = null
      }
    }
    return {
      id: task.id,
      title: task.title,
      subjectName: getSubjectName(task.subject_id),
      status: task.status,
      duration,
      dateKey,
      completedAt: toLocalDateTimeString(completedAt),
      settlementKey: `${task.id}:${startedAt.getTime()}:${completedAt.getTime()}:${duration}`,
      relatedChapterId,
      chapterTitle,
      chapterCompleted,
    }
  }, [getSubjectName, subjectChaptersAPI])

  const endTimeRef = useRef<number | null>(null)
  const activeSessionRef = useRef(false)
  const [hasActiveTimerSession, setHasActiveTimerSession] = useState(false)
  const restoreAttemptedRef = useRef(false)
  const skipNextPersistWriteRef = useRef(false)
  const modeRef = useRef(mode)
  const lastTickRemainingRef = useRef(timeLeft)
  const stopwatchElapsedBeforeRunRef = useRef(0)
  const stopwatchRunStartedAtRef = useRef<number | null>(null)
  const sessionSettlementInFlightRef = useRef(false)
  const taskSettlementInFlightRef = useRef(false)
  const reviewSettlementKeysRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    todayDateKeyRef.current = todayDateKey
  }, [todayDateKey])

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId
  }, [selectedTaskId])

  useEffect(() => {
    todayTasksRef.current = todayTasks
  }, [todayTasks])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  const getCurrentStopwatchElapsedSeconds = useCallback((nowMs = Date.now()) => {
    const runStartedAtMs = stopwatchRunStartedAtRef.current
    if (!runStartedAtMs) {
      return clampSeconds(stopwatchElapsedBeforeRunRef.current, MAX_POMODORO_MODE_SECONDS)
    }
    if (runStartedAtMs - nowMs > RESTORE_CLOCK_SKEW_MS) {
      return clampSeconds(stopwatchElapsedBeforeRunRef.current, MAX_POMODORO_MODE_SECONDS)
    }
    return clampSeconds(
      stopwatchElapsedBeforeRunRef.current + ((nowMs - runStartedAtMs) / 1000),
      MAX_POMODORO_MODE_SECONDS,
    )
  }, [])

  const getCurrentCountdownRemainingSeconds = useCallback((nowMs = Date.now()) => {
    const currentMode = modeRef.current
    if (!isCountdownFocusModeId(currentMode.id)) return 0

    const modeTime = Math.max(1, currentMode.time)
    if (isRunning && endTimeRef.current) {
      let remaining = clampSeconds((endTimeRef.current - nowMs) / 1000, modeTime)
      const previousRemaining = clampSeconds(lastTickRemainingRef.current, modeTime)
      if (remaining > previousRemaining) {
        remaining = previousRemaining
      }
      return remaining
    }

    return clampSeconds(timeLeft, modeTime)
  }, [isRunning, timeLeft])

  const getCurrentCountdownElapsedSeconds = useCallback((nowMs = Date.now()) => {
    const currentMode = modeRef.current
    if (!isCountdownFocusModeId(currentMode.id)) return 0

    const modeTime = Math.max(1, currentMode.time)
    const remaining = getCurrentCountdownRemainingSeconds(nowMs)
    return Math.max(0, Math.min(modeTime, modeTime - remaining))
  }, [getCurrentCountdownRemainingSeconds])

  const getCountdownFocusSettlementPreview = useCallback((): CountdownFocusSettlementPreview | null => {
    const currentMode = modeRef.current
    if (!isCountdownFocusModeId(currentMode.id) || !activeSessionRef.current) return null
    if (sessionSettlementInFlightRef.current) return null

    const capturedAtMs = Date.now()
    const elapsedSeconds = getCurrentCountdownElapsedSeconds(capturedAtMs)
    return {
      elapsedSeconds,
      roundedMinutes: getRoundedElapsedMinutes(elapsedSeconds),
      capturedAtMs,
    }
  }, [getCurrentCountdownElapsedSeconds])

  const loadSubjects = useCallback(async () => {
    try {
      const data = await subjectsAPI.getAll()
      setSubjects(data || [])
    } catch (e) { logger.error(e) }
  }, [subjectsAPI])

  const loadTodayStats = useCallback(async (dateKey = currentDateKey) => {
    setTodayDateKey(dateKey)
    todayDateKeyRef.current = dateKey
    try {
      const stats = await pomodoroAPI.getStats(dateKey)
      setTodayStats(stats || [])
      const total = await pomodoroAPI.getDailyTotal(dateKey)
      setTodayTotal(total || 0)
    } catch (e) { logger.error(e) }
  }, [currentDateKey, pomodoroAPI])

  const loadTodayTasks = useCallback(async (dateKey = currentDateKey) => {
    setTaskError(null)
    try {
      const tasks = await tasksAPI.getByDate(dateKey)
      setTodayTasks(tasks || [])
      todayTasksRef.current = tasks || []

      const selectedId = selectedTaskIdRef.current
      const visibleSelectedTask = selectedId === null
        ? null
        : (tasks || []).find(task => task.id === selectedId) ?? null
      if (visibleSelectedTask && activeSessionRef.current) {
        setActiveTaskSnapshot(visibleSelectedTask)
      }
      if (selectedId !== null && !visibleSelectedTask && !activeSessionRef.current) {
        selectedTaskIdRef.current = null
        setSelectedTaskIdState(null)
      }
    } catch (error) {
      logger.error(error)
      setTaskError(error instanceof Error ? error.message : String(error))
    }
  }, [currentDateKey, setActiveTaskSnapshot, tasksAPI])

  const setSelectedSubject = useCallback<React.Dispatch<React.SetStateAction<number | null>>>((nextSubjectAction) => {
    manualSubjectOverrideRef.current = true
    setSelectedSubjectState(nextSubjectAction)
  }, [])

  const selectFocusTask = useCallback((taskId: number | null) => {
    setTaskError(null)
    selectedTaskIdRef.current = taskId
    setSelectedTaskIdState(taskId)
    const task = taskId === null ? null : todayTasksRef.current.find(candidate => candidate.id === taskId) ?? null
    if (task?.subject_id && !manualSubjectOverrideRef.current) {
      setSelectedSubjectState(task.subject_id)
    }
  }, [])

  const resolveSessionTask = useCallback(async (
    taskId: number | null,
    dateKey: string,
  ): Promise<{ taskId: number | null; task: StudyTask | null }> => {
    if (taskId === null) return { taskId: null, task: null }
    try {
      const tasks = await tasksAPI.getByDate(dateKey)
      const task = (tasks || []).find(candidate => candidate.id === taskId) ?? null
      return { taskId: task ? task.id : null, task }
    } catch (error) {
      logger.warn('Failed to resolve restored pomodoro task:', error)
      return { taskId, task: null }
    }
  }, [tasksAPI])

  useEffect(() => {
    loadSubjects()
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [loadSubjects])

  useEffect(() => {
    setTodayStats([])
    setTodayTotal(0)
    todayDateKeyRef.current = currentDateKey
    void loadTodayStats(currentDateKey)
    void loadTodayTasks(currentDateKey)
  }, [currentDateKey, loadTodayStats, loadTodayTasks])

  useEffect(() => {
    void loadTodayTasks(todayDateKeyRef.current)
  }, [dataRefreshVersion, loadTodayTasks])

  const clearActiveSessionState = useCallback(() => {
    activeSessionRef.current = false
    setHasActiveTimerSession(false)
    endTimeRef.current = null
    sessionStartedAtRef.current = null
    stopwatchElapsedBeforeRunRef.current = 0
    stopwatchRunStartedAtRef.current = null
    setActiveTaskSnapshot(null)
    clearPersistedActiveSession()
  }, [setActiveTaskSnapshot])

  const setIdleMode = useCallback((nextMode: PomodoroMode) => {
    const idleSeconds = getIdleDisplaySeconds(nextMode)
    modeRef.current = nextMode
    lastTickRemainingRef.current = idleSeconds
    endTimeRef.current = null
    stopwatchElapsedBeforeRunRef.current = idleSeconds
    stopwatchRunStartedAtRef.current = null
    setModeState(nextMode)
    setTimeLeft(idleSeconds)
    setIsRunning(false)
  }, [])

  const setMode = useCallback<React.Dispatch<React.SetStateAction<PomodoroMode>>>((nextModeAction) => {
    if (sessionSettlementInFlightRef.current) return

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
    taskId,
    startedAt,
    completedAt,
  }: {
    durationSeconds: number
    subjectId: number | null
    taskId: number | null
    startedAt: Date
    completedAt: Date
  }) => {
    const dateKey = getLocalDateKey(startedAt)
    await pomodoroAPI.addSession({
      subject_id: subjectId,
      task_id: taskId,
      duration: durationSeconds / 60,
      date_key: dateKey,
      started_at: toLocalDateTimeString(startedAt),
      completed_at: toLocalDateTimeString(completedAt),
    })
    loadTodayStats()
    requestDataRefresh()
  }, [pomodoroAPI, loadTodayStats, requestDataRefresh])

  const appendFocusReviewToTodayEntry = useCallback(async (
    settlement: FocusTaskSettlement,
    reviewText: string,
    options: { createEntryIfMissing?: boolean } = {},
  ): Promise<'skipped' | 'written' | 'needs-entry-confirmation'> => {
    const trimmedReview = reviewText.trim()
    if (!trimmedReview) return 'skipped'
    if (reviewSettlementKeysRef.current.has(settlement.settlementKey)) return 'skipped'

    const completedAt = new Date(settlement.completedAt.replace(' ', 'T'))
    const timeLabel = Number.isNaN(completedAt.getTime())
      ? settlement.completedAt.slice(11, 16)
      : `${completedAt.getHours().toString().padStart(2, '0')}:${completedAt.getMinutes().toString().padStart(2, '0')}`
    const subjectLine = settlement.subjectName ?? '未选择科目'
    const reviewBlock = [
      '## 专注复盘',
      '',
      `- 时间：${timeLabel}`,
      `- 任务：${settlement.title}`,
      `- 科目：${subjectLine}`,
      `- 专注：${settlement.duration} 分钟`,
      `- 结果：${trimmedReview}`,
    ].join('\n')

    const reviewDateKey = settlement.dateKey
    const existing = await entriesAPI.getByDate(reviewDateKey)
    if (existing) {
      const content = existing.content.trim()
        ? `${existing.content.trimEnd()}\n\n${reviewBlock}`
        : reviewBlock
      await entriesAPI.update(existing.id, { content })
    } else if (options.createEntryIfMissing) {
      await entriesAPI.create({
        date: reviewDateKey,
        title: '专注复盘',
        content: reviewBlock,
        mood: null,
      })
    } else {
      return 'needs-entry-confirmation'
    }

    reviewSettlementKeysRef.current.add(settlement.settlementKey)
    requestDataRefresh()
    return 'written'
  }, [entriesAPI, requestDataRefresh])

  const settleFocusTask = useCallback(async ({ completeTask, completeChapter = false, reviewText }: FocusTaskSettlementOptions) => {
    if (taskSettlementInFlightRef.current) return false
    if (completeChapter && !completeTask) {
      setAlertState(current => ({ ...current, settlementError: '完成章节时必须同时完成任务。' }))
      return false
    }
    const settlement = alertState.taskSettlement
    if (!settlement) {
      setAlertState(current => ({
        ...current,
        visible: false,
        settlementError: null,
        isSettlingTask: false,
        pendingReviewEntryCreation: null,
      }))
      return true
    }

    taskSettlementInFlightRef.current = true
    setAlertState(current => ({ ...current, settlementError: null, isSettlingTask: true }))

    try {
      const latestTasks = await tasksAPI.getByDate(settlement.dateKey)
      if (settlement.dateKey === todayDateKeyRef.current) {
        setTodayTasks(latestTasks || [])
        todayTasksRef.current = latestTasks || []
      }
      const latestTask = (latestTasks || []).find(task => task.id === settlement.id)
      if (!latestTask) {
        setAlertState(current => ({
          ...current,
          taskSettlement: null,
          settlementError: '绑定任务已不存在，专注记录已保留。可直接关闭本次结算。',
          isSettlingTask: false,
          pendingReviewEntryCreation: null,
        }))
        void loadTodayTasks(todayDateKeyRef.current)
        requestDataRefresh()
        return false
      }

      if (completeTask && latestTask.status !== 'done') {
        let updatedTask: StudyTask
        try {
          updatedTask = await tasksAPI.complete(settlement.id)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (message.includes('Task not found')) {
            setAlertState(current => ({
              ...current,
              taskSettlement: null,
              settlementError: '绑定任务已不存在，专注记录已保留。可直接关闭本次结算。',
              isSettlingTask: false,
              pendingReviewEntryCreation: null,
            }))
            void loadTodayTasks(todayDateKeyRef.current)
            requestDataRefresh()
            return false
          }
          throw error
        }
        if (settlement.dateKey === todayDateKeyRef.current) {
          setTodayTasks(current => current.map(task => task.id === updatedTask.id ? updatedTask : task))
          todayTasksRef.current = todayTasksRef.current.map(task => task.id === updatedTask.id ? updatedTask : task)
        }
        if (selectedTaskIdRef.current === updatedTask.id) {
          selectedTaskIdRef.current = null
          setSelectedTaskIdState(null)
        }
      }

      if (
        completeChapter
        && settlement.relatedChapterId !== null
        && latestTask.related_chapter_id === settlement.relatedChapterId
        && latestTask.subject_id !== null
      ) {
        const chapters = await subjectChaptersAPI.getBySubject(latestTask.subject_id)
        const chapter = (chapters || []).find(candidate => candidate.id === settlement.relatedChapterId)
        if (chapter && !chapter.completed) {
          await subjectChaptersAPI.toggleCompleted(chapter.id, true)
        }
      }

      const reviewResult = await appendFocusReviewToTodayEntry(settlement, reviewText)
      if (reviewResult === 'needs-entry-confirmation') {
        void loadTodayTasks(todayDateKeyRef.current)
        requestDataRefresh()
        setAlertState(current => ({
          ...current,
          pendingReviewEntryCreation: { reviewText },
          settlementError: null,
          isSettlingTask: false,
        }))
        return false
      }
      void loadTodayTasks(todayDateKeyRef.current)
      requestDataRefresh()
      setAlertState(current => ({
        ...current,
        visible: false,
        settlementError: null,
        isSettlingTask: false,
        pendingReviewEntryCreation: null,
      }))
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAlertState(current => ({ ...current, settlementError: message, isSettlingTask: false }))
      return false
    } finally {
      taskSettlementInFlightRef.current = false
    }
  }, [
    alertState.taskSettlement,
    appendFocusReviewToTodayEntry,
    loadTodayTasks,
    requestDataRefresh,
    subjectChaptersAPI,
    tasksAPI,
  ])

  const resolveFocusReviewEntryCreation = useCallback(async (createEntry: boolean) => {
    const settlement = alertState.taskSettlement
    const pendingReviewEntryCreation = alertState.pendingReviewEntryCreation
    if (!settlement || !pendingReviewEntryCreation) {
      setAlertState(current => ({
        ...current,
        visible: false,
        settlementError: null,
        isSettlingTask: false,
        pendingReviewEntryCreation: null,
      }))
      return true
    }

    setAlertState(current => ({ ...current, settlementError: null, isSettlingTask: true }))
    try {
      if (createEntry) {
        await appendFocusReviewToTodayEntry(
          settlement,
          pendingReviewEntryCreation.reviewText,
          { createEntryIfMissing: true },
        )
      }
      void loadTodayTasks(todayDateKeyRef.current)
      requestDataRefresh()
      setAlertState(current => ({
        ...current,
        visible: false,
        settlementError: null,
        isSettlingTask: false,
        pendingReviewEntryCreation: null,
      }))
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAlertState(current => ({ ...current, settlementError: message, isSettlingTask: false }))
      return false
    }
  }, [
    alertState.pendingReviewEntryCreation,
    alertState.taskSettlement,
    appendFocusReviewToTodayEntry,
    loadTodayTasks,
    requestDataRefresh,
  ])

  // Phase-complete handler
  const handlePhaseComplete = useCallback(async () => {
    if (sessionSettlementInFlightRef.current) return
    sessionSettlementInFlightRef.current = true
    try {
    const completedMode = mode
    const completedSubject = selectedSubject
    const completedTaskId = selectedTaskIdRef.current
    const completedTaskSnapshot = activeTaskSnapshotRef.current
    const startedAtForRecord = sessionStartedAtRef.current

    clearActiveSessionState()
    setIsRunning(false)
    endTimeRef.current = null

    // ── Notification sound (Web Audio API beep, no external file needed) ──
    try {
      const soundEnabled = coerceBoolean(settingsData?.pomodoroSound, true)
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
          taskId: completedTaskId,
          startedAt,
          completedAt,
        })
        const taskSettlement = await buildTaskSettlement(
          completedTaskId,
          Math.round(completedMode.time / 60),
          completedAt,
          startedAt,
          completedTaskSnapshot,
        )
        if (coerceBoolean(settingsData?.pomodoroAlert, true) || taskSettlement) {
          const alertDateKey = getLocalDateKey(startedAt)
          const newTotal = await pomodoroAPI.getDailyTotal(alertDateKey).catch(() => todayTotal)
          setAlertState({
            visible: true,
            isWorkComplete: true,
            completionKind: 'completed',
            duration: Math.round(completedMode.time / 60),
            todayTotal: newTotal,
            showSettlementActions: true,
            subjectName: getSubjectName(completedSubject),
            taskSettlement,
            settlementError: null,
            isSettlingTask: false,
            pendingReviewEntryCreation: null,
          })
        }
        await notificationAPI.show('番茄钟完成！', '干得漂亮，休息几分钟吧～')
      } catch (e) { logger.error(e) }
      // Fire break-start callback so App can show BreakReviewModal
      if (onBreakStartRef.current) {
        onBreakStartRef.current()
      }
      setIdleMode(dynamicModes.SHORT_BREAK!)
    } else {
      if (coerceBoolean(settingsData?.pomodoroAlert, true)) {
        const alertDateKey = currentDateKey
        const newTotal = await pomodoroAPI.getDailyTotal(alertDateKey).catch(() => todayTotal)
        setAlertState({
          visible: true,
          isWorkComplete: false,
          completionKind: 'completed',
          duration: Math.round(completedMode.time / 60),
          todayTotal: newTotal,
          showSettlementActions: false,
          subjectName: null,
          taskSettlement: null,
          settlementError: null,
          isSettlingTask: false,
          pendingReviewEntryCreation: null,
        })
      }
      await notificationAPI.show('休息结束', '精力充沛，继续加油！').catch(() => { })
      setIdleMode(dynamicModes.WORK!)
    }
    } finally {
      sessionSettlementInFlightRef.current = false
    }
  }, [
    mode,
    selectedSubject,
    todayTotal,
    currentDateKey,
    settingsData,
    notificationAPI,
    dynamicModes,
    addPomodoroSessionRecord,
    buildTaskSettlement,
    clearActiveSessionState,
    getSubjectName,
    pomodoroAPI,
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
        void (async () => {
          const startedAt = new Date(restore.session.startedAtMs!)
          const completedAt = new Date(restore.session.endTimeMs!)
          const resolvedTask = await resolveSessionTask(restore.session.selectedTaskId, getLocalDateKey(startedAt))
          await addPomodoroSessionRecord({
            durationSeconds: restore.session.modeTime,
            subjectId: restore.session.selectedSubject,
            taskId: resolvedTask.taskId,
            startedAt,
            completedAt,
          })
          try {
            const duration = Math.round(restore.session.modeTime / 60)
            const taskSettlement = await buildTaskSettlement(
              resolvedTask.taskId,
              duration,
              completedAt,
              startedAt,
              resolvedTask.task,
            )
            if (!taskSettlement) return

            const alertDateKey = getLocalDateKey(startedAt)
            const newTotal = await pomodoroAPI.getDailyTotal(alertDateKey).catch(() => todayTotal)
            setAlertState({
              visible: true,
              isWorkComplete: true,
              completionKind: 'completed',
              duration,
              todayTotal: newTotal,
              showSettlementActions: true,
              subjectName: getSubjectName(restore.session.selectedSubject),
              taskSettlement,
              settlementError: null,
              isSettlingTask: false,
              pendingReviewEntryCreation: null,
            })
          } catch (error) {
            logger.warn('Failed to show restored expired focus settlement:', error)
          }
        })().catch(error => logger.error(error))
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
    if (isStopwatchModeId(restoredMode.id)) {
      stopwatchElapsedBeforeRunRef.current = restore.timeLeft
      stopwatchRunStartedAtRef.current = restore.status === 'running' ? nowMs : null
      endTimeRef.current = null
    } else {
      stopwatchElapsedBeforeRunRef.current = 0
      stopwatchRunStartedAtRef.current = null
      endTimeRef.current = restore.status === 'running'
        ? nowMs + restore.timeLeft * 1000
        : null
    }
    modeRef.current = restoredMode

    setCustomMinutes(restore.session.customMinutes)
    setSelectedSubjectState(restore.session.selectedSubject)
    selectedTaskIdRef.current = restore.session.selectedTaskId
    setSelectedTaskIdState(restore.session.selectedTaskId)
    if (restore.session.selectedTaskId !== null && restore.session.startedAtMs) {
      void resolveSessionTask(restore.session.selectedTaskId, getLocalDateKey(new Date(restore.session.startedAtMs)))
        .then(({ taskId, task }) => {
          if (taskId === null) {
            selectedTaskIdRef.current = null
            setSelectedTaskIdState(null)
            setActiveTaskSnapshot(null)
          } else if (task) {
            setActiveTaskSnapshot(task)
          }
        })
    }
    setModeState(restoredMode)
    setTimeLeft(restore.timeLeft)
    setIsRunning(restore.status === 'running')
  }, [
    addPomodoroSessionRecord,
    buildTaskSettlement,
    clearActiveSessionState,
    dynamicModes,
    getSubjectName,
    pomodoroAPI,
    resolveSessionTask,
    setActiveTaskSnapshot,
    setIdleMode,
    todayTotal,
  ])

  // Main Timer Loop
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    if (isRunning) {
      if (isStopwatchModeId(modeRef.current.id)) {
        if (!stopwatchRunStartedAtRef.current) {
          stopwatchElapsedBeforeRunRef.current = timeLeft
          stopwatchRunStartedAtRef.current = Date.now()
        }
        lastTickRemainingRef.current = timeLeft
        interval = setInterval(() => {
          const previousElapsed = lastTickRemainingRef.current
          let elapsed = getCurrentStopwatchElapsedSeconds()
          if (elapsed < previousElapsed) {
            elapsed = previousElapsed
            stopwatchElapsedBeforeRunRef.current = previousElapsed
            stopwatchRunStartedAtRef.current = Date.now()
          }
          lastTickRemainingRef.current = elapsed
          setTimeLeft(elapsed)
          if (elapsed >= MAX_POMODORO_MODE_SECONDS) {
            clearInterval(interval!)
            stopwatchElapsedBeforeRunRef.current = elapsed
            stopwatchRunStartedAtRef.current = null
            setIsRunning(false)
          }
        }, 1000)
      } else {
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
      }
    } else {
      endTimeRef.current = null
    }
    return () => { if (interval) clearInterval(interval) }
  }, [clearActiveSessionState, dynamicModes, getCurrentStopwatchElapsedSeconds, handlePhaseComplete, isRunning, setIdleMode])

  useEffect(() => {
    if (!activeSessionRef.current || !isPomodoroModeId(mode.id)) return
    if (skipNextPersistWriteRef.current) {
      skipNextPersistWriteRef.current = false
      return
    }

    const isStopwatch = isStopwatchModeId(mode.id)
    const persistedTimeLeft = isStopwatch
      ? clampSeconds(timeLeft, mode.time)
      : Math.max(1, clampSeconds(timeLeft, mode.time))
    const startedAtMs = sessionStartedAtRef.current?.getTime() ?? null
    const endTimeMs = isRunning && !isStopwatch
      ? endTimeRef.current ?? Date.now() + persistedTimeLeft * 1000
      : null

    writePersistedActiveSession({
      version: 1,
      modeId: mode.id,
      modeTime: mode.time,
      customMinutes,
      selectedSubject,
      selectedTaskId,
      timeLeft: persistedTimeLeft,
      isRunning,
      startedAtMs,
      endTimeMs,
      savedAtMs: Date.now(),
    })
  }, [customMinutes, isRunning, mode, selectedSubject, selectedTaskId, timeLeft])

  const toggleTimer = useCallback(async () => {
    if (sessionSettlementInFlightRef.current) return false

    const currentMode = modeRef.current
    if (!isPomodoroModeId(currentMode.id)) return false

    const nowMs = Date.now()
    const nextIsRunning = !isRunning
    const isStopwatch = isStopwatchModeId(currentMode.id)
    const isStartingNewFocusSession = nextIsRunning && isFocusModeId(currentMode.id) && !activeSessionRef.current
    const taskIdForSession = selectedTaskIdRef.current
    const originalTask = taskIdForSession === null
      ? null
      : todayTasksRef.current.find(task => task.id === taskIdForSession) ?? null
    let taskSnapshotForSession: StudyTask | null = taskIdForSession === null ? null : activeTaskSnapshotRef.current

    if (isStartingNewFocusSession && taskIdForSession !== null) {
      try {
        const updatedTask = await tasksAPI.startFocus(taskIdForSession, todayDateKeyRef.current)
        const startedTask = originalTask ? { ...originalTask, ...updatedTask } : updatedTask
        taskSnapshotForSession = startedTask
        setTodayTasks(current => current.map(task => task.id === updatedTask.id ? startedTask : task))
        todayTasksRef.current = todayTasksRef.current.map(task => task.id === updatedTask.id ? startedTask : task)
        requestDataRefresh()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setTaskError(message)
        return false
      }
    }

    let nextTimeLeft = timeLeft
    let nextStartedAt = sessionStartedAtRef.current
    let nextEndTimeMs: number | null = null
    let nextStopwatchElapsedBeforeRun = stopwatchElapsedBeforeRunRef.current
    let nextStopwatchRunStartedAt: number | null = stopwatchRunStartedAtRef.current

    if (nextIsRunning) {
      if (isStopwatch) {
        nextStartedAt = nextStartedAt ?? new Date(nowMs)
        nextStopwatchElapsedBeforeRun = timeLeft
        nextStopwatchRunStartedAt = nowMs
      } else {
        nextStartedAt = isFocusModeId(currentMode.id)
          ? nextStartedAt ?? new Date(nowMs)
          : nextStartedAt
        nextEndTimeMs = nowMs + timeLeft * 1000
      }
    } else if (isStopwatch) {
      nextTimeLeft = getCurrentStopwatchElapsedSeconds(nowMs)
      nextStopwatchElapsedBeforeRun = nextTimeLeft
      nextStopwatchRunStartedAt = null
    }

    const persistedTimeLeft = isStopwatch
      ? clampSeconds(nextTimeLeft, currentMode.time)
      : Math.max(1, clampSeconds(nextTimeLeft, currentMode.time))
    const persistedSession: PersistedPomodoroSession = {
      version: 1,
      modeId: currentMode.id,
      modeTime: currentMode.time,
      customMinutes,
      selectedSubject,
      selectedTaskId: taskIdForSession,
      timeLeft: persistedTimeLeft,
      isRunning: nextIsRunning,
      startedAtMs: nextStartedAt?.getTime() ?? null,
      endTimeMs: nextIsRunning && !isStopwatch ? nextEndTimeMs : null,
      savedAtMs: nowMs,
    }

    if (!writePersistedActiveSession(persistedSession)) {
      if (isStartingNewFocusSession && originalTask?.status === 'todo') {
        try {
          const rolledBackTask = await tasksAPI.update(originalTask.id, { status: 'todo' })
          setTodayTasks(current => current.map(task => task.id === rolledBackTask.id ? rolledBackTask : task))
          todayTasksRef.current = todayTasksRef.current.map(task => task.id === rolledBackTask.id ? rolledBackTask : task)
          requestDataRefresh()
        } catch (rollbackError) {
          logger.warn('Failed to roll back task after active session persistence failure:', rollbackError)
        }
      }
      setTaskError('Unable to persist the active focus session. Timer was not started.')
      return false
    }

    activeSessionRef.current = true
    setHasActiveTimerSession(true)
    lastTickRemainingRef.current = nextTimeLeft
    sessionStartedAtRef.current = nextStartedAt
    stopwatchElapsedBeforeRunRef.current = nextStopwatchElapsedBeforeRun
    stopwatchRunStartedAtRef.current = nextStopwatchRunStartedAt
    endTimeRef.current = nextEndTimeMs
    if (isStartingNewFocusSession) {
      setActiveTaskSnapshot(taskSnapshotForSession)
    }
    setTaskError(null)

    if (!nextIsRunning && isStopwatch) {
      setTimeLeft(nextTimeLeft)
    }
    setIsRunning(nextIsRunning)
    return true
  }, [
    customMinutes,
    getCurrentStopwatchElapsedSeconds,
    isRunning,
    requestDataRefresh,
    selectedSubject,
    setActiveTaskSnapshot,
    tasksAPI,
    timeLeft,
  ])

  const resetTimer = useCallback(() => {
    if (sessionSettlementInFlightRef.current) return

    const resetMode = mode.id === 'custom'
      ? dynamicModes.CUSTOM!
      : mode.id === 'work'
        ? dynamicModes.WORK!
        : mode

    clearActiveSessionState()
    setIdleMode(resetMode)
  }, [clearActiveSessionState, dynamicModes, mode, setIdleMode])

  const finishCountdownFocusSession = useCallback(async (preview?: CountdownFocusSettlementPreview) => {
    const currentMode = modeRef.current
    if (!isCountdownFocusModeId(currentMode.id) || !activeSessionRef.current) return false
    if (sessionSettlementInFlightRef.current) return false

    const settlementPreview = preview ?? getCountdownFocusSettlementPreview()
    if (!settlementPreview || !Number.isFinite(settlementPreview.capturedAtMs)) return false

    const modeTime = Math.max(1, currentMode.time)
    const elapsedSeconds = Math.max(0, Math.min(modeTime, settlementPreview.elapsedSeconds))
    const remainingSeconds = clampSeconds(modeTime - elapsedSeconds, modeTime)
    if (elapsedSeconds < 60) return false

    sessionSettlementInFlightRef.current = true
    setIsSavingInterruptedFocus(true)

    endTimeRef.current = null
    lastTickRemainingRef.current = remainingSeconds
    setTimeLeft(remainingSeconds)
    setIsRunning(false)

    const roundedMinutes = settlementPreview.roundedMinutes
    const completedAt = new Date(settlementPreview.capturedAtMs)
    const startedAt = sessionStartedAtRef.current
      ?? new Date(completedAt.getTime() - elapsedSeconds * 1000)
    const completedSubject = selectedSubject
    const completedTaskId = selectedTaskIdRef.current
    const completedTaskSnapshot = activeTaskSnapshotRef.current
    const idleMode = currentMode.id === 'custom' ? dynamicModes.CUSTOM! : dynamicModes.WORK!

    try {
      await addPomodoroSessionRecord({
        durationSeconds: roundedMinutes * 60,
        subjectId: completedSubject,
        taskId: completedTaskId,
        startedAt,
        completedAt,
      })
      const taskSettlement = await buildTaskSettlement(
        completedTaskId,
        roundedMinutes,
        completedAt,
        startedAt,
        completedTaskSnapshot,
      )

      clearActiveSessionState()
      setIdleMode(idleMode)

      if (coerceBoolean(settingsData?.pomodoroAlert, true) || taskSettlement) {
        try {
          const alertDateKey = getLocalDateKey(startedAt)
          const newTotal = await pomodoroAPI.getDailyTotal(alertDateKey).catch(error => {
            logger.warn('Failed to refresh pomodoro total after interrupted save:', error)
            return todayTotal
          })
          setAlertState({
            visible: true,
            isWorkComplete: true,
            completionKind: 'interrupted',
            duration: roundedMinutes,
            todayTotal: newTotal,
            showSettlementActions: true,
            subjectName: getSubjectName(completedSubject),
            taskSettlement,
            settlementError: null,
            isSettlingTask: false,
            pendingReviewEntryCreation: null,
          })
        } catch (error) {
          logger.warn('Failed to show interrupted focus alert:', error)
        }
      }

      notificationAPI.show('专注已保存', `本次实际专注 ${roundedMinutes} 分钟已计入统计。`)
        .catch(error => logger.warn('Failed to show interrupted focus notification:', error))

      return true
    } catch (error) {
      logger.error(error)
      return false
    } finally {
      sessionSettlementInFlightRef.current = false
      setIsSavingInterruptedFocus(false)
    }
  }, [
    addPomodoroSessionRecord,
    buildTaskSettlement,
    clearActiveSessionState,
    dynamicModes,
    getCountdownFocusSettlementPreview,
    getSubjectName,
    notificationAPI,
    pomodoroAPI,
    selectedSubject,
    setIdleMode,
    settingsData,
    todayTotal,
  ])

  const finishStopwatchSession = useCallback(async () => {
    if (!isStopwatchModeId(mode.id) || !activeSessionRef.current) return false

    const elapsedSeconds = isRunning
      ? getCurrentStopwatchElapsedSeconds()
      : clampSeconds(timeLeft, MAX_POMODORO_MODE_SECONDS)

    stopwatchElapsedBeforeRunRef.current = elapsedSeconds
    stopwatchRunStartedAtRef.current = null
    lastTickRemainingRef.current = elapsedSeconds
    setTimeLeft(elapsedSeconds)
    setIsRunning(false)

    if (elapsedSeconds < 60) return false

    const roundedMinutes = getRoundedElapsedMinutes(elapsedSeconds)

    const completedAt = new Date()
    const startedAt = sessionStartedAtRef.current
      ?? new Date(completedAt.getTime() - elapsedSeconds * 1000)
    const completedTaskId = selectedTaskIdRef.current
    const completedTaskSnapshot = activeTaskSnapshotRef.current

    try {
      await addPomodoroSessionRecord({
        durationSeconds: roundedMinutes * 60,
        subjectId: selectedSubject,
        taskId: completedTaskId,
        startedAt,
        completedAt,
      })
      const taskSettlement = await buildTaskSettlement(
        completedTaskId,
        roundedMinutes,
        completedAt,
        startedAt,
        completedTaskSnapshot,
      )
      if (coerceBoolean(settingsData?.pomodoroAlert, true) || taskSettlement) {
        const alertDateKey = getLocalDateKey(startedAt)
        const newTotal = await pomodoroAPI.getDailyTotal(alertDateKey).catch(() => todayTotal)
        setAlertState({
          visible: true,
          isWorkComplete: true,
          completionKind: 'completed',
          duration: roundedMinutes,
          todayTotal: newTotal,
          showSettlementActions: true,
          subjectName: getSubjectName(selectedSubject),
          taskSettlement,
          settlementError: null,
          isSettlingTask: false,
          pendingReviewEntryCreation: null,
        })
      }
      await notificationAPI.show('正计时已保存', '本次专注已记录到学习统计。').catch(() => { })
      clearActiveSessionState()
      setIdleMode(dynamicModes.STOPWATCH!)
      return true
    } catch (error) {
      logger.error(error)
      return false
    }
  }, [
    addPomodoroSessionRecord,
    clearActiveSessionState,
    dynamicModes,
    getCurrentStopwatchElapsedSeconds,
    getSubjectName,
    isRunning,
    mode.id,
    notificationAPI,
    pomodoroAPI,
    selectedSubject,
    setIdleMode,
    settingsData,
    todayTotal,
    timeLeft,
  ])

  const formatTime = useCallback((seconds: number): string => {
    const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
    const m = Math.floor(safeSeconds / 60).toString().padStart(2, '0')
    const s = (safeSeconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }, [])

  const progress = isStopwatchModeId(mode.id)
    ? Math.max(0, Math.min(1, timeLeft / (60 * 60)))
    : mode.time > 0
      ? Math.max(0, Math.min(1, 1 - (timeLeft / mode.time)))
    : 0
  const countdownElapsedSeconds = isCountdownFocusModeId(mode.id)
    ? Math.max(0, Math.min(mode.time, mode.time - clampSeconds(timeLeft, mode.time)))
    : 0
  const circleCircumference = 2 * Math.PI * 90
  const miniCircumference = 2 * Math.PI * 18
  const selectedTask = useMemo(
    () => {
      if (selectedTaskId === null) return null
      return todayTasks.find(task => task.id === selectedTaskId)
        ?? (hasActiveTimerSession && activeTaskSnapshot?.id === selectedTaskId ? activeTaskSnapshot : null)
    },
    [activeTaskSnapshot, hasActiveTimerSession, selectedTaskId, todayTasks],
  )

  // Context Values
  const timerValue = useMemo((): PomodoroTimerValue => ({
    mode, timeLeft, isRunning, hasActiveTimerSession, countdownElapsedSeconds, progress, circleCircumference, miniCircumference, dynamicModes
  }), [mode, timeLeft, isRunning, hasActiveTimerSession, countdownElapsedSeconds, progress, circleCircumference, miniCircumference, dynamicModes])

  const dataValue = useMemo((): PomodoroDataValue => ({
    subjects, selectedSubject, todayStats, todayTotal, customMinutes, alertState, isSavingInterruptedFocus,
    todayTasks, selectedTaskId, selectedTask, taskError,
  }), [subjects, selectedSubject, todayStats, todayTotal, customMinutes, alertState, isSavingInterruptedFocus, todayTasks, selectedTaskId, selectedTask, taskError])

  const actionsValue = useMemo((): PomodoroActionsValue => ({
    setMode, setSelectedSubject, selectFocusTask, setCustomMinutes, toggleTimer, resetTimer, loadTodayTasks, settleFocusTask, resolveFocusReviewEntryCreation, getCountdownFocusSettlementPreview, finishCountdownFocusSession, finishStopwatchSession, formatTime,
    loadSubjects, loadTodayStats, dismissAlert,
    setOnBreakStart,
  }), [setMode, setSelectedSubject, selectFocusTask, setCustomMinutes, toggleTimer, resetTimer, loadTodayTasks, settleFocusTask, resolveFocusReviewEntryCreation, getCountdownFocusSettlementPreview, finishCountdownFocusSession, finishStopwatchSession, formatTime, loadSubjects, loadTodayStats, dismissAlert, setOnBreakStart])

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
