import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react'
import { useDiary } from './DiaryContext'
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
  onBreakStart: (() => void) | null
}

interface PomodoroActionsValue {
  setMode: React.Dispatch<React.SetStateAction<PomodoroMode>>
  setSelectedSubject: React.Dispatch<React.SetStateAction<number | null>>
  setCustomMinutes: React.Dispatch<React.SetStateAction<number>>
  toggleTimer: () => void
  resetTimer: () => void
  formatTime: (seconds: number) => string
  loadSubjects: () => Promise<void>
  loadTodayStats: () => Promise<void>
  setOnBreakStart: (cb: (() => void) | null) => void
  dismissAlert: () => void
}

// Separate contexts for optimized re-renders
const TimerContext = createContext<PomodoroTimerValue | null>(null)
const DataContext = createContext<PomodoroDataValue | null>(null)
const ActionsContext = createContext<PomodoroActionsValue | null>(null)

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

  const [mode, setMode] = useState<PomodoroMode>(dynamicModes.WORK!)
  const [timeLeft, setTimeLeft] = useState<number>(dynamicModes.WORK!.time)
  const [isRunning, setIsRunning] = useState(false)

  // Subject and stats state
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [selectedSubject, setSelectedSubject] = useState<number | null>(null)
  const [todayStats, setTodayStats] = useState<PomodoroStat[]>([])
  const [todayTotal, setTodayTotal] = useState(0)
  const [onBreakStart, setOnBreakStart] = useState<(() => void) | null>(null)
  const onBreakStartRef = useRef<(() => void) | null>(null)

  // Alert modal state
  const [alertState, setAlertState] = useState({
    visible: false, isWorkComplete: true, duration: 0, todayTotal: 0,
  })

  const dismissAlert = useCallback(() => setAlertState(s => ({ ...s, visible: false })), [])

  const endTimeRef = useRef<number | null>(null)

  const loadSubjects = useCallback(async () => {
    try {
      const data = await subjectsAPI.getAll()
      setSubjects(data || [])
    } catch (e) { console.error(e) }
  }, [subjectsAPI])

  const loadTodayStats = useCallback(async () => {
    const today = new Date().toISOString().split('T')[0]!
    try {
      const stats = await pomodoroAPI.getStats(today)
      setTodayStats(stats || [])
      const total = await pomodoroAPI.getDailyTotal(today)
      setTodayTotal(total || 0)
    } catch (e) { console.error(e) }
  }, [pomodoroAPI])

  useEffect(() => {
    loadSubjects()
    loadTodayStats()
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [loadSubjects, loadTodayStats])

  // Reset timer when mode changes manually
  useEffect(() => {
    setTimeLeft(mode.time)
    setIsRunning(false)
    endTimeRef.current = null
  }, [mode])

  // Update work/custom time if settings change while idle
  useEffect(() => {
    if (isRunning) return
    if (mode.id === 'work') {
      setMode(dynamicModes.WORK!)
    } else if (mode.id === 'custom') {
      setMode(dynamicModes.CUSTOM!)
      setTimeLeft(customMinutes * 60)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customWorkTime, customMinutes, isRunning])

  // Phase-complete handler
  const handlePhaseComplete = useCallback(async () => {
    setIsRunning(false)
    endTimeRef.current = null

    // ── Notification sound (Web Audio API beep, no external file needed) ──
    try {
      const soundEnabled = String(settingsData?.pomodoroSound ?? 'true') !== 'false'
      const alertEnabled = String(settingsData?.pomodoroAlert ?? 'true') !== 'false'

      if (soundEnabled) {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
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

      // ── Alert modal ──
      if (alertEnabled) {
        const newTotal = await pomodoroAPI.getDailyTotal(
          new Date().toISOString().split('T')[0]!
        ).catch(() => todayTotal)
        setAlertState({
          visible: true,
          isWorkComplete: mode.id === 'work',
          duration: Math.round(mode.time / 60),
          todayTotal: newTotal,
        })
      }
    } catch (e) {
      console.warn('Pomodoro notification error:', e)
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('番茄钟提醒', {
        body: mode.id === 'work' ? '专注完成，休息一下吧！' : '休息结束，准备专注！',
        icon: '/favicon.ico'
      })
    }

    if (mode.id === 'work' || mode.id === 'custom') {
      try {
        await pomodoroAPI.addSession({
          subject_id: selectedSubject,
          duration: mode.time / 60
        })
        loadTodayStats()
        await notificationAPI.show('🍅 番茄钟完成！', '干得漂亮，休息几分钟吧～')
      } catch (e) { console.error(e) }
      // Fire break-start callback so App can show BreakReviewModal
      if (onBreakStartRef.current) {
        onBreakStartRef.current()
      }
      setMode(dynamicModes.SHORT_BREAK!)
    } else {
      await notificationAPI.show('⏰ 休息结束', '精力充沛，继续加油！').catch(() => { })
      setMode(dynamicModes.WORK!)
    }
  }, [mode, selectedSubject, todayTotal, settingsData, pomodoroAPI, notificationAPI, loadTodayStats, dynamicModes])

  // Main Timer Loop
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    if (isRunning) {
      if (!endTimeRef.current) {
        endTimeRef.current = Date.now() + timeLeft * 1000
      }
      interval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((endTimeRef.current! - Date.now()) / 1000))
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
  }, [isRunning, handlePhaseComplete])

  const toggleTimer = useCallback(() => {
    setIsRunning(prev => !prev)
  }, [])

  const resetTimer = useCallback(() => {
    setIsRunning(false)
    setTimeLeft(mode.time)
    endTimeRef.current = null
  }, [mode.time])

  const formatTime = useCallback((seconds: number): string => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }, [])

  const progress = 1 - (timeLeft / mode.time)
  const circleCircumference = 2 * Math.PI * 90
  const miniCircumference = 2 * Math.PI * 18

  // Context Values
  const timerValue = useMemo((): PomodoroTimerValue => ({
    mode, timeLeft, isRunning, progress, circleCircumference, miniCircumference, dynamicModes
  }), [mode, timeLeft, isRunning, progress, circleCircumference, miniCircumference, dynamicModes])

  const dataValue = useMemo((): PomodoroDataValue => ({
    subjects, selectedSubject, todayStats, todayTotal, customMinutes, alertState, onBreakStart
  }), [subjects, selectedSubject, todayStats, todayTotal, customMinutes, alertState, onBreakStart])

  const actionsValue = useMemo((): PomodoroActionsValue => ({
    setMode, setSelectedSubject, setCustomMinutes, toggleTimer, resetTimer, formatTime, 
    loadSubjects, loadTodayStats, dismissAlert,
    setOnBreakStart: (cb) => {
      onBreakStartRef.current = cb
      setOnBreakStart(cb)
    }
  }), [toggleTimer, resetTimer, formatTime, loadSubjects, loadTodayStats, dismissAlert])

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

// Legacy combined hook (re-renders on any change)
export function usePomodoroContext() {
  const timer = usePomodoroTimer()
  const data = usePomodoroData()
  const actions = usePomodoroActions()
  return useMemo(() => ({ ...timer, ...data, ...actions }), [timer, data, actions])
}
