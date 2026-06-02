import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { usePomodoroTimer, usePomodoroData, usePomodoroActions } from '../contexts/PomodoroContext'
import { useDiary } from '../contexts/DiaryContext'
import { coerceBoolean } from '../utils/helpers'
import { logger } from '../utils/logger'
import { useFocusGuard } from '../hooks/useFocusGuard'
import FocusGuardNotice from './FocusGuardNotice'
import FocusZenMode from './FocusZenMode'
import { Play, Pause, RotateCcw, Maximize2, Square } from 'lucide-react'
import type { ActiveAppInfo, FocusWhitelistItem } from '../types'

const DRAG_THRESHOLD = 5 // px — below this is a click, above is a drag
const STORAGE_KEY = 'pomodoro-widget-position'

interface Position {
  x: number
  y: number
}

function getInitialPosition(isCollapsed: boolean): Position {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return { x: isCollapsed ? 90 : 260, y: window.innerHeight - 80 }
}

function clampPosition(x: number, y: number, elWidth = 160, elHeight = 56): Position {
  const maxX = window.innerWidth - elWidth
  const maxY = window.innerHeight - elHeight
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  }
}

function normalizeFocusWhitelist(value: unknown): FocusWhitelistItem[] {
  return Array.isArray(value) ? value.filter((item): item is FocusWhitelistItem => (
    !!item
    && typeof item === 'object'
    && typeof item.id === 'string'
    && typeof item.name === 'string'
    && typeof item.enabled === 'boolean'
    && typeof item.createdAt === 'string'
  )) : []
}

function createFocusWhitelistId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `focus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function basenameOnly(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || value
}

function activeAppToWhitelistItem(app: ActiveAppInfo): FocusWhitelistItem {
  const executable = basenameOnly(app.executable)
  const name = app.name || app.processName || executable || '未知应用'
  return {
    id: createFocusWhitelistId(),
    name: name.trim().slice(0, 160),
    ...(app.processName ? { processName: app.processName.trim().slice(0, 160) } : {}),
    ...(executable ? { executable: executable.trim().slice(0, 160) } : {}),
    enabled: true,
    createdAt: new Date().toISOString(),
  }
}

function sameFocusTarget(a: FocusWhitelistItem, b: FocusWhitelistItem): boolean {
  const normalize = (value: string | undefined) => (value || '').trim().toLowerCase()
  return (!!a.processName && normalize(a.processName) === normalize(b.processName))
    || (!!a.executable && normalize(a.executable) === normalize(b.executable))
    || normalize(a.name) === normalize(b.name)
}

interface PomodoroProps {
  isWidget: boolean
  onExpand: () => void
  isCollapsed: boolean
  onFullscreenChange?: (isActive: boolean) => void
}

export default function Pomodoro({ isWidget, onExpand, isCollapsed, onFullscreenChange }: PomodoroProps) {
  const { settingsData, settings, notification } = useDiary()
  const {
    mode, timeLeft, isRunning,
    progress, circleCircumference, miniCircumference,
    dynamicModes, hasActiveTimerSession,
  } = usePomodoroTimer()

  const {
    subjects, selectedSubject,
    todayStats, todayTotal,
    customMinutes,
  } = usePomodoroData()

  const {
    setMode, setSelectedSubject, setCustomMinutes,
    toggleTimer, resetTimer, finishStopwatchSession, formatTime,
  } = usePomodoroActions()

  const [focusViolation, setFocusViolation] = useState<ActiveAppInfo | null>(null)
  const focusWhitelist = useMemo(() => normalizeFocusWhitelist(settingsData?.focusWhitelist), [settingsData?.focusWhitelist])
  const handleFocusViolation = useCallback((app: ActiveAppInfo) => {
    setFocusViolation(app)
    const appLabel = app.name || app.processName || app.executable || 'unknown'
    void notification.show('专注提醒', `当前应用不在专注白名单：${appLabel}`)
      .catch(error => {
        logger.warn('[focusGuard] Failed to show violation notification:', error instanceof Error ? error.message : String(error))
      })
  }, [notification])
  const focusGuard = useFocusGuard({
    enabled: coerceBoolean(settingsData?.focusGuardEnabled, false),
    intervalSec: Number(settingsData?.focusGuardIntervalSec) || 5,
    whitelist: focusWhitelist,
    isRunning,
    modeId: mode.id,
    onViolation: handleFocusViolation,
  })
  const [zenVisible, setZenVisible] = useState(false)
  useEffect(() => {
    onFullscreenChange?.(zenVisible)
  }, [onFullscreenChange, zenVisible])
  useEffect(() => {
    return () => onFullscreenChange?.(false)
  }, [onFullscreenChange])
  const selectedSubjectName = useMemo(
    () => subjects.find(subject => subject.id === selectedSubject)?.name,
    [selectedSubject, subjects],
  )
  const isStopwatchMode = mode.id === 'stopwatch'
  const isFocusMode = mode.id === 'work' || mode.id === 'custom' || isStopwatchMode
  const canSaveStopwatchSession = isStopwatchMode && hasActiveTimerSession && timeLeft >= 60
  const timerStatusText = isRunning
    ? (isStopwatchMode ? '正在正计时...' : '正在进行中...')
    : (isStopwatchMode && hasActiveTimerSession ? '已暂停' : '准备就绪')

  // ─── Drag state (widget only) ───
  const [pos, setPos] = useState<Position>(() => getInitialPosition(isCollapsed))
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0, moved: false })
  const widgetRef = useRef<HTMLDivElement>(null)

  // Update default position when sidebar collapses (only if user hasn't dragged)
  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setPos(prev => ({ ...prev, x: isCollapsed ? 90 : 260 }))
      }
    } catch { /* ignore */ }
  }, [isCollapsed])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Don't initiate drag on the play/pause button area
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return
    e.preventDefault()
    const ref = dragRef.current
    ref.startX = e.clientX
    ref.startY = e.clientY
    ref.startPosX = pos.x
    ref.startPosY = pos.y
    ref.moved = false
    setIsDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [pos])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return
    const ref = dragRef.current
    const dx = e.clientX - ref.startX
    const dy = e.clientY - ref.startY
    if (!ref.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
    ref.moved = true
    const el = widgetRef.current
    const w = el ? el.offsetWidth : 160
    const h = el ? el.offsetHeight : 56
    const clamped = clampPosition(ref.startPosX + dx, ref.startPosY + dy, w, h)
    setPos(clamped)
  }, [isDragging])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return
    setIsDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
    const ref = dragRef.current
    if (!ref.moved) {
      // It was a click — navigate to Pomodoro page
      onExpand?.()
    } else {
      // Save position
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)) } catch { /* ignore */ }
    }
  }, [isDragging, onExpand, pos])

  const addViolationToWhitelist = useCallback(async (app: ActiveAppInfo) => {
    const item = activeAppToWhitelistItem(app)
    const nextWhitelist = [
      ...focusWhitelist.filter(existing => !sameFocusTarget(existing, item)),
      item,
    ]
    try {
      await settings.updateGeneral({ focusWhitelist: nextWhitelist })
      setFocusViolation(null)
    } catch (error) {
      logger.warn('[focusGuard] Failed to add app to whitelist:', error)
    }
  }, [focusWhitelist, settings])

  const ignoreViolationForSession = useCallback((app: ActiveAppInfo) => {
    focusGuard.ignoreAppFor(app, 5 * 60 * 1000)
    setFocusViolation(null)
  }, [focusGuard])

  const requestAppFullscreen = useCallback(async () => {
    let usedElectronFullscreen = false
    try {
      const setFullScreen = window.api?.window?.setFullScreen
      if (setFullScreen) {
        usedElectronFullscreen = await setFullScreen(true)
      }
    } catch (error) {
      logger.warn('[zen] Electron fullscreen request failed:', error)
    }

    if (usedElectronFullscreen) return

    try {
      await document.documentElement.requestFullscreen?.()
    } catch (error) {
      logger.warn('[zen] Browser fullscreen request failed:', error)
    }
  }, [])

  const enterZenMode = useCallback(async () => {
    if (!isRunning) toggleTimer()
    setZenVisible(true)
    await requestAppFullscreen()
  }, [isRunning, requestAppFullscreen, toggleTimer])

  const exitZenMode = useCallback(async () => {
    setZenVisible(false)
    let usedElectronFullscreen = false
    try {
      const setFullScreen = window.api?.window?.setFullScreen
      if (setFullScreen) {
        await setFullScreen(false)
        usedElectronFullscreen = true
      }
    } catch (error) {
      logger.warn('[zen] Electron fullscreen exit failed:', error)
    }

    if (usedElectronFullscreen) return

    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen()
      }
    } catch (error) {
      logger.warn('[zen] Browser fullscreen exit failed:', error)
    }
  }, [])

  useEffect(() => {
    const removeFullScreenListener = window.api?.window?.onFullScreenChange?.((fullScreen: boolean) => {
      if (!fullScreen) setZenVisible(false)
    })

    const handleDocumentFullscreenChange = () => {
      if (!document.fullscreenElement) setZenVisible(false)
    }

    document.addEventListener('fullscreenchange', handleDocumentFullscreenChange)
    return () => {
      removeFullScreenListener?.()
      document.removeEventListener('fullscreenchange', handleDocumentFullscreenChange)
    }
  }, [])

  // Auto-exit Zen overlay when the timer completes
  useEffect(() => {
    if (zenVisible && !isStopwatchMode && timeLeft === 0) {
      void exitZenMode()
    }
  }, [zenVisible, timeLeft, isStopwatchMode, exitZenMode])

  const focusNotice = focusViolation ? (
    <FocusGuardNotice
      app={focusViolation}
      onAddToWhitelist={addViolationToWhitelist}
      onIgnore={ignoreViolationForSession}
      onDismiss={() => setFocusViolation(null)}
    />
  ) : null

  // ─── Widget (floating ball) ───
  const startButtonLabel = ({
    work: '开始专注',
    short_break: '开始短休',
    long_break: '开始长休',
    custom: '开始计时',
    stopwatch: hasActiveTimerSession ? '继续正计时' : '开始正计时',
  } as Record<string, string>)[mode.id] || '开始计时'
  if (isWidget) {
    return (
      <>
      <div
        ref={widgetRef}
        className="pomodoro-mini card"
        data-testid="pomodoro-widget"
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          padding: '6px 14px 6px 6px',
          display: 'flex', alignItems: 'center', gap: 10,
          border: `1px solid ${mode.color}20`,
          background: 'var(--bg-secondary)',
          backdropFilter: 'blur(16px)',
          zIndex: 'var(--z-floating)',
          transition: isDragging ? 'none' : 'box-shadow 0.3s, border-color 0.3s',
          cursor: isDragging ? 'grabbing' : 'grab',
          boxShadow: isDragging ? '0 12px 24px rgba(0,0,0,0.1)' : '0 2px 12px rgba(0,0,0,0.06)',
          borderRadius: 30,
          userSelect: 'none',
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="拖拽移动 · 点击打开番茄钟"
        aria-label="番茄钟"
      >
        <div
          data-no-drag
          style={{ position: 'relative', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); toggleTimer(); }}
        >
          <svg viewBox="0 0 40 40" width="32" height="32" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
            <circle cx="20" cy="20" r="18" fill="none" stroke="var(--border)" strokeWidth="3" />
            <circle cx="20" cy="20" r="18" fill="none" stroke={mode.color} strokeWidth="3" strokeLinecap="round"
              strokeDasharray={miniCircumference} strokeDashoffset={miniCircumference * (1 - progress)}
              style={{ transition: 'stroke-dashoffset 1s linear' }} />
          </svg>
          <div style={{ fontSize: 13, opacity: 0.8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {isRunning ? <Pause size={14} /> : <Play size={14} />}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: mode.color, opacity: 0.85, fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(timeLeft)}
          </div>
        </div>
      </div>
      {focusNotice}
      </>
    )
  }

  // ─── Full-page view ───
  return (
    <>
    <div className="pomodoro-container flex flex-col items-center w-full" style={{ padding: 'var(--space-xl) 0' }} data-testid="pomodoro-timer">

      {/* Mode Switcher */}
      <div className="flex gap-sm p-1 rounded-full bg-secondary" style={{ background: 'var(--bg-tertiary)', padding: 4, borderRadius: 24, marginBottom: 'var(--space-2xl)' }}>
        {Object.values(dynamicModes).map(m => {
          const isCurrentMode = mode.id === m.id
          const shouldLockModeSwitch = hasActiveTimerSession && isFocusMode
          const isSwitchDisabled = !isCurrentMode && shouldLockModeSwitch
          return (
            <button
              key={m.id}
              onClick={() => setMode(m)}
              disabled={isSwitchDisabled}
              data-testid={`pomodoro-mode-${m.id}`}
              title={isSwitchDisabled ? '请先完成或重置当前专注' : undefined}
              style={{
                padding: '6px 16px', borderRadius: 20, fontSize: 14, fontWeight: 500, border: 'none',
                cursor: isSwitchDisabled ? 'not-allowed' : 'pointer',
                opacity: isSwitchDisabled ? 0.4 : 1,
                background: isCurrentMode ? 'var(--bg-primary)' : 'transparent',
                color: isCurrentMode ? m.color : 'var(--text-muted)',
                boxShadow: isCurrentMode ? 'var(--shadow-sm)' : 'none',
                transition: 'all 0.3s'
              }}
            >
              {m.label}
            </button>
          )
        })}
      </div>

      {mode.id === 'custom' && !isRunning && (
        <div style={{ marginBottom: 'var(--space-2xl)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>时长:</span>
          <input
            type="number"
            min={1}
            max={120}
            className="input"
            data-testid="pomodoro-custom-minutes"
            style={{ width: 80, textAlign: 'center', padding: '4px 8px' }}
            value={customMinutes}
            onChange={e => {
              const val = Math.max(1, Math.min(120, Number(e.target.value) || 1))
              setCustomMinutes(val)
            }}
          />
          <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>分钟</span>
        </div>
      )}

      {/* Timer Visual */}
      <div style={{ position: 'relative', width: 260, height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--space-xl)' }}>
        <svg viewBox="0 0 200 200" width="260" height="260" style={{ position: 'absolute' }}>
          <circle cx="100" cy="100" r="90" fill="none" stroke="var(--border)" strokeWidth="4" />
          <circle
            cx="100" cy="100" r="90" fill="none"
            stroke={mode.color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circleCircumference}
            strokeDashoffset={circleCircumference * (1 - progress)}
            transform="rotate(-90 100 100)"
            style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.4s ease' }}
          />
        </svg>
        <div className="flex flex-col items-center">
          <div style={{ fontSize: 64, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', lineHeight: 1 }}>
            {formatTime(timeLeft)}
          </div>
          <div className="text-sm mt-2" style={{ color: mode.color, opacity: 0.8, fontWeight: 500 }}>
            {timerStatusText}
          </div>
        </div>
      </div>

      <div className="flex gap-md" style={{ marginBottom: 'var(--space-2xl)' }}>
        <button
          className="button"
          data-testid="pomodoro-start-btn"
          style={{
            minWidth: 120, height: 44, borderRadius: 22, fontSize: 16, fontWeight: 600, border: 'none',
            background: isRunning ? 'var(--bg-tertiary)' : mode.color,
            color: isRunning ? 'var(--text-primary)' : 'white',
            boxShadow: isRunning ? 'none' : `0 8px 16px ${mode.color}40`,
          }}
          onClick={toggleTimer}
        >
          {isRunning
            ? <><Pause size={18} /> 暂停</>
            : <><Play size={18} /> {startButtonLabel}</>}
        </button>
        <button
          className="button button-secondary"
          data-testid="pomodoro-reset-btn"
          style={{ width: 44, height: 44, borderRadius: 22, padding: 0 }}
          onClick={resetTimer}
          title="重置"
          aria-label="重置番茄钟"
        >
          <RotateCcw size={18} />
        </button>
        {isStopwatchMode && (
          <button
            className="button"
            data-testid="pomodoro-finish-stopwatch-btn"
            disabled={!canSaveStopwatchSession}
            style={{
              minWidth: 128, height: 44, borderRadius: 22, fontWeight: 600, border: 'none',
              background: canSaveStopwatchSession ? mode.color : 'var(--bg-tertiary)',
              color: canSaveStopwatchSession ? 'white' : 'var(--text-muted)',
              cursor: canSaveStopwatchSession ? 'pointer' : 'not-allowed',
              boxShadow: canSaveStopwatchSession ? `0 8px 16px ${mode.color}30` : 'none',
            }}
            title={canSaveStopwatchSession ? '结束并保存本次正计时' : '至少专注 1 分钟后可保存'}
            onClick={() => { void finishStopwatchSession() }}
          >
            <Square size={16} /> 结束并保存
          </button>
        )}
        <button
          className="button button-secondary"
          data-testid="pomodoro-enter-zen-btn"
          style={{ minWidth: 150, height: 44, borderRadius: 22 }}
          onClick={() => { void enterZenMode() }}
        >
          <Maximize2 size={18} /> 进入全屏专注
        </button>
      </div>

      {/* Subject Select */}
      <div style={{ width: '100%', maxWidth: '300px', marginBottom: 'var(--space-xl)' }}>
        <select
          className="input w-full"
          data-testid="pomodoro-subject-select"
          value={selectedSubject || ''}
          onChange={(e) => setSelectedSubject(e.target.value ? Number(e.target.value) : null)}
          disabled={!isFocusMode}
        >
          {isFocusMode ? (
            <option value="">选择专注科目（可选）</option>
          ) : (
            <option value="">休息中...</option>
          )}
          {subjects.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Today Stats */}
      <div className="card w-full" style={{ maxWidth: '340px', padding: 'var(--space-lg)' }} data-testid="pomodoro-stats">
        <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-md)' }}>
          <h3 className="text-base font-semibold">当前进度</h3>
          <div className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
            {Math.floor(todayTotal / 60)}h {todayTotal % 60}m
          </div>
        </div>

        {todayStats.length > 0 ? (
          <div className="flex flex-col gap-sm">
            {todayStats.map((stat, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-1" style={{ borderBottom: i < todayStats.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                <span className="flex items-center gap-sm">
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: stat.color || 'var(--border)'
                  }} />
                  {stat.subject_name || '未分类'}
                </span>
                <span className="text-muted">{stat.total_minutes}m · {stat.session_count} 番茄</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted text-center py-2 opacity-70">
            今天还没有专注记录。开始一次番茄后，这里会显示当前进度。
          </div>
        )}
      </div>
    </div>
    <FocusZenMode
      visible={zenVisible}
      timeLeft={timeLeft}
      modeLabel={mode.label}
      modeColor={mode.color}
      isRunning={isRunning}
      onToggleTimer={toggleTimer}
      onExit={exitZenMode}
      formatTime={formatTime}
      selectedSubjectName={selectedSubjectName}
    />
    {focusNotice}
    </>
  )
}
