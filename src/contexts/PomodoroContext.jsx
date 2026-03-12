import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { useDiary } from './DiaryContext'

const PomodoroContext = createContext(null)

const MODES = {
  WORK: { id: 'work', label: '专注', time: 25 * 60, color: 'var(--accent)' },
  SHORT_BREAK: { id: 'short_break', label: '短休', time: 5 * 60, color: 'var(--success)' },
  LONG_BREAK: { id: 'long_break', label: '长休', time: 15 * 60, color: 'var(--info)' }
}

export function PomodoroProvider({ children }) {
  const { settingsData, subjects: subjectsAPI, pomodoro: pomodoroAPI, notification: notificationAPI } = useDiary()
  const customWorkTime = (parseInt(settingsData?.pomodoroMinutes) || 25) * 60

  const dynamicModes = {
    ...MODES,
    WORK: { ...MODES.WORK, time: customWorkTime }
  }

  const [mode, setMode] = useState(dynamicModes.WORK)
  const [timeLeft, setTimeLeft] = useState(dynamicModes.WORK.time)
  const [isRunning, setIsRunning] = useState(false)

  // Subject and stats state
  const [subjects, setSubjects] = useState([])
  const [selectedSubject, setSelectedSubject] = useState(null)
  const [todayStats, setTodayStats] = useState([])
  const [todayTotal, setTodayTotal] = useState(0)

  const endTimeRef = useRef(null)

  useEffect(() => {
    loadSubjects()
    loadTodayStats()
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  const loadSubjects = async () => {
    try {
      const data = await subjectsAPI.getAll()
      setSubjects(data || [])
    } catch (e) { console.error(e) }
  }

  const loadTodayStats = async () => {
    const today = new Date().toISOString().split('T')[0]
    try {
      const stats = await pomodoroAPI.getStats(today)
      setTodayStats(stats || [])
      const total = await pomodoroAPI.getDailyTotal(today)
      setTodayTotal(total || 0)
    } catch (e) { console.error(e) }
  }

  // Reset timer when mode changes manually
  useEffect(() => {
    setTimeLeft(mode.time)
    setIsRunning(false)
    endTimeRef.current = null
  }, [mode])

  // Update work time if settings change while idle
  useEffect(() => {
    if (mode.id === 'work' && !isRunning) {
      setMode(dynamicModes.WORK)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customWorkTime, isRunning])

  // Phase-complete handler
  const handlePhaseComplete = useCallback(async () => {
    setIsRunning(false)
    endTimeRef.current = null

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('番茄钟提醒', {
        body: mode.id === 'work' ? '专注完成，休息一下吧！' : '休息结束，准备专注！',
        icon: '/favicon.ico'
      })
    }

    if (mode.id === 'work') {
      try {
        await pomodoroAPI.addSession({
          subject_id: selectedSubject,
          duration: mode.time / 60
        })
        loadTodayStats()
        await notificationAPI.show('🍅 番茄钟完成！', '干得漂亮，休息几分钟吧～')
      } catch (e) { console.error(e) }
      setMode(dynamicModes.SHORT_BREAK)
    } else {
      await notificationAPI.show('⏰ 休息结束', '精力充沛，继续加油！').catch(() => { })
      setMode(dynamicModes.WORK)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedSubject])

  // Main Timer Loop
  useEffect(() => {
    let interval = null
    if (isRunning) {
      if (!endTimeRef.current) {
        endTimeRef.current = Date.now() + timeLeft * 1000
      }
      interval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000))
        setTimeLeft(remaining)
        if (remaining <= 0) {
          clearInterval(interval)
          handlePhaseComplete()
        }
      }, 1000)
    } else {
      endTimeRef.current = null
    }
    return () => clearInterval(interval)
  }, [isRunning, handlePhaseComplete]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTimer = () => {
    setIsRunning(!isRunning)
  }

  const resetTimer = () => {
    setIsRunning(false)
    setTimeLeft(mode.time)
    endTimeRef.current = null
  }

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const progress = 1 - (timeLeft / mode.time)
  const circleCircumference = 2 * Math.PI * 90
  const miniCircumference = 2 * Math.PI * 18

  const value = {
    // State
    mode, setMode,
    timeLeft, isRunning,
    subjects, selectedSubject, setSelectedSubject,
    todayStats, todayTotal,
    dynamicModes,
    // Computed
    progress, circleCircumference, miniCircumference,
    // Actions
    toggleTimer, resetTimer, formatTime,
    loadSubjects, loadTodayStats,
  }

  return (
    <PomodoroContext.Provider value={value}>
      {children}
    </PomodoroContext.Provider>
  )
}

export function usePomodoroContext() {
  const ctx = useContext(PomodoroContext)
  if (!ctx) throw new Error('usePomodoroContext must be used within PomodoroProvider')
  return ctx
}
