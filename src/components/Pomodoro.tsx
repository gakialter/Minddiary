import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { usePomodoroTimer, usePomodoroData, usePomodoroActions } from '../contexts/PomodoroContext'
import { useDiary } from '../contexts/DiaryContext'
import { coerceBoolean } from '../utils/helpers'
import { logger } from '../utils/logger'
import { IS_ELECTRON } from '../utils/apiAdapter'
import { useFocusGuard } from '../hooks/useFocusGuard'
import FocusGuardNotice from './FocusGuardNotice'
import FocusZenMode from './FocusZenMode'
import { usePomodoroWidgetPlacement } from '../hooks/usePomodoroWidgetPlacement'
import { Play, Pause, RotateCcw, Maximize2, Square, GripVertical, PanelLeft, PanelRight } from 'lucide-react'
import type { ActiveAppInfo, FocusWhitelistItem } from '../types'

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

function formatElapsedForConfirmation(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  return `${minutes} 分 ${remainingSeconds.toString().padStart(2, '0')} 秒`
}

interface PomodoroProps {
  isWidget: boolean
  onExpand: () => void
  isCollapsed: boolean
  onFullscreenChange?: (isActive: boolean) => void
}

export default function Pomodoro({ isWidget, onExpand, onFullscreenChange }: PomodoroProps) {
  const { settingsData, settings, notification } = useDiary()
  const {
    mode, timeLeft, isRunning,
    progress, circleCircumference,
    dynamicModes, hasActiveTimerSession, countdownElapsedSeconds,
  } = usePomodoroTimer()

  const {
    subjects, selectedSubject,
    todayStats, todayTotal,
    customMinutes,
    isSavingInterruptedFocus,
    todayTasks, selectedTask, taskError,
  } = usePomodoroData()

  const {
    setMode, setSelectedSubject, selectFocusTask, setCustomMinutes,
    toggleTimer, resetTimer, getCountdownFocusSettlementPreview, finishCountdownFocusSession, finishStopwatchSession, formatTime,
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
  const finishCountdownClickInFlightRef = useRef(false)
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
  const subjectNameById = useMemo(() => new Map(subjects.map(subject => [subject.id, subject.name])), [subjects])
  const isStopwatchMode = mode.id === 'stopwatch'
  const isCountdownFocusMode = mode.id === 'work' || mode.id === 'custom'
  const isFocusMode = isCountdownFocusMode || isStopwatchMode
  const selectableTasks = useMemo(
    () => todayTasks.filter(task => task.status === 'todo' || task.status === 'doing'),
    [todayTasks],
  )
  const selectedTaskTitle = selectedTask?.title
  const selectedTaskSubjectName = selectedTask?.subject_id ? subjectNameById.get(selectedTask.subject_id) : undefined
  const canSaveStopwatchSession = isStopwatchMode && hasActiveTimerSession && timeLeft >= 60
  const showFinishCountdownSession = isCountdownFocusMode && hasActiveTimerSession
  const canFinishCountdownSession = showFinishCountdownSession && countdownElapsedSeconds >= 60 && !isSavingInterruptedFocus
  const timerControlsDisabled = isSavingInterruptedFocus
  const timerStatusText = isRunning
    ? (isStopwatchMode ? '正在正计时...' : '正在进行中...')
    : (isStopwatchMode && hasActiveTimerSession ? '已暂停' : '准备就绪')

  const placement = usePomodoroWidgetPlacement()

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
    if (IS_ELECTRON) {
      try {
        await window.api.window.setFullScreen(true)
      } catch (error) {
        logger.warn('[zen] Electron fullscreen request failed:', error)
      }
      return
    }

    try {
      if (!document.documentElement.requestFullscreen) {
        logger.warn('[zen] Browser fullscreen API unavailable')
        return
      }
      await document.documentElement.requestFullscreen()
    } catch (error) {
      logger.warn('[zen] Browser fullscreen request failed:', error)
    }
  }, [])

  const enterZenMode = useCallback(async () => {
    if (!isRunning) {
      const started = await toggleTimer()
      if (!started) return
    }
    setZenVisible(true)
    await requestAppFullscreen()
  }, [isRunning, requestAppFullscreen, toggleTimer])

  const exitZenMode = useCallback(async () => {
    setZenVisible(false)
    if (IS_ELECTRON) {
      try {
        await window.api.window.setFullScreen(false)
      } catch (error) {
        logger.warn('[zen] Electron fullscreen exit failed:', error)
      }
      return
    }

    if (!document.fullscreenElement) return
    try {
      if (!document.exitFullscreen) {
        logger.warn('[zen] Browser fullscreen exit API unavailable')
        return
      }
      await document.exitFullscreen()
    } catch (error) {
      logger.warn('[zen] Browser fullscreen exit failed:', error)
    }
  }, [])

  const handleFinishCountdownFocusSession = useCallback(async () => {
    if (finishCountdownClickInFlightRef.current || !canFinishCountdownSession) return

    const preview = getCountdownFocusSettlementPreview()
    if (!preview || preview.elapsedSeconds < 60) return

    const elapsedSeconds = Math.max(0, Math.floor(preview.elapsedSeconds))
    const roundedMinutes = preview.roundedMinutes
    const confirmed = window.confirm(
      `本次已有效专注 ${formatElapsedForConfirmation(elapsedSeconds)}，将按 ${roundedMinutes} 分钟计入统计。确定提前结束并保存吗？`,
    )
    if (!confirmed) return

    finishCountdownClickInFlightRef.current = true
    try {
      const saved = await finishCountdownFocusSession(preview)
      if (saved && zenVisible) {
        await exitZenMode()
      }
    } finally {
      finishCountdownClickInFlightRef.current = false
    }
  }, [canFinishCountdownSession, exitZenMode, finishCountdownFocusSession, getCountdownFocusSettlementPreview, zenVisible])

  const handleResetTimer = useCallback(() => {
    if (isSavingInterruptedFocus) return

    if (isCountdownFocusMode && hasActiveTimerSession) {
      const confirmed = window.confirm('重置将放弃本次尚未保存的专注记录。确定继续吗？')
      if (!confirmed) return
    }
    resetTimer()
  }, [hasActiveTimerSession, isCountdownFocusMode, isSavingInterruptedFocus, resetTimer])

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
      <div className="pomodoro-mini" data-testid="pomodoro-widget" data-dock={placement.dock} data-dragging={placement.isDragging} aria-label="番茄钟">
        <span className="pomodoro-mini__handle" aria-hidden="true" title="拖拽选择左侧或右侧停靠" {...placement.handleProps}><GripVertical size={16} /></span>
        <button type="button" className="button button-secondary button-icon" aria-label={isRunning ? '暂停计时' : '开始计时'} disabled={timerControlsDisabled} onClick={() => { if (!timerControlsDisabled) void toggleTimer() }}>
          {isRunning ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button type="button" className="button button-secondary pomodoro-mini__open" aria-label="打开番茄钟" onClick={onExpand}>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTime(timeLeft)}</span>
          <Maximize2 size={14} aria-hidden="true" />
        </button>
        <div role="group" aria-label="番茄钟停靠位置" className="pomodoro-mini__docks">
          <button type="button" className="button button-secondary button-icon" aria-label="停靠左下角" aria-pressed={placement.dock === 'bottom-left'} onClick={() => placement.setDock('bottom-left')}><PanelLeft size={14} /></button>
          <button type="button" className="button button-secondary button-icon" aria-label="停靠右下角" aria-pressed={placement.dock === 'bottom-right'} onClick={() => placement.setDock('bottom-right')}><PanelRight size={14} /></button>
        </div>
      </div>
      {focusNotice}
      </>
    )
  }

  // ─── Full-page view ───
  return (
    <>
    <div className="workspace-page workspace-page--wide pomodoro-page" data-testid="pomodoro-timer">

      {/* Mode Switcher */}
      <div className="pomodoro-page__modes" role="group" aria-label="计时模式">
        {Object.values(dynamicModes).map(m => {
          const isCurrentMode = mode.id === m.id
          const shouldLockModeSwitch = hasActiveTimerSession && isFocusMode
          const isSwitchDisabled = isSavingInterruptedFocus || (!isCurrentMode && shouldLockModeSwitch)
          return (
            <button
              key={m.id}
              className="button button-secondary"
              aria-pressed={isCurrentMode}
              onClick={() => setMode(m)}
              disabled={isSwitchDisabled}
              data-testid={`pomodoro-mode-${m.id}`}
              title={isSwitchDisabled ? '请先完成或重置当前专注' : undefined}
            >
              {m.label}
            </button>
          )
        })}
      </div>

      {mode.id === 'custom' && !isRunning && (
        <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <label htmlFor="pomodoro-minutes">时长</label>
          <input
            id="pomodoro-minutes"
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

      <div className="pomodoro-page__layout">
        <section className="pomodoro-page__timer" aria-label="专注计时">
          {/* Timer Visual */}
          <div className="pomodoro-page__clock" style={{ position: 'relative', width: 260, height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--space-xl)' }}>
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
              <div className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                {timerStatusText}
              </div>
            </div>
          </div>

          <div className="pomodoro-page__controls">
            <button
              className="button button-primary"
              data-testid="pomodoro-start-btn"
              disabled={timerControlsDisabled}
              onClick={() => { void toggleTimer() }}
            >
              {isRunning
                ? <><Pause size={18} /> 暂停</>
                : <><Play size={18} /> {startButtonLabel}</>}
            </button>
            <button
              className="button button-secondary"
              data-testid="pomodoro-reset-btn"
              disabled={timerControlsDisabled}
              style={{ width: 44, height: 44, borderRadius: 'var(--radius-control)', padding: 0, cursor: timerControlsDisabled ? 'not-allowed' : 'pointer' }}
              onClick={handleResetTimer}
              title="重置"
              aria-label="重置番茄钟"
            >
              <RotateCcw size={18} />
            </button>
            {showFinishCountdownSession && (
              <button
                className="button button-secondary"
                data-testid="pomodoro-finish-countdown-btn"
                disabled={!canFinishCountdownSession}
                title={canFinishCountdownSession ? '提前结束并保存当前实际专注时长' : '至少专注 1 分钟后可保存'}
                onClick={() => { void handleFinishCountdownFocusSession() }}
              >
                <Square size={16} /> {isSavingInterruptedFocus ? '正在保存...' : '提前结束并保存'}
              </button>
            )}
            {isStopwatchMode && (
              <button
                className="button button-secondary"
                data-testid="pomodoro-finish-stopwatch-btn"
                disabled={!canSaveStopwatchSession}
                title={canSaveStopwatchSession ? '结束并保存本次正计时' : '至少专注 1 分钟后可保存'}
                onClick={() => { void finishStopwatchSession() }}
              >
                <Square size={16} /> 结束并保存
              </button>
            )}
            <button
              className="button button-secondary"
              data-testid="pomodoro-enter-zen-btn"
              style={{ minWidth: 150, height: 44, borderRadius: 'var(--radius-control)' }}
              onClick={() => { void enterZenMode() }}
            >
              <Maximize2 size={18} /> 进入全屏专注
            </button>
          </div>

        </section>
        <section className="pomodoro-page__context" aria-label="本次专注与今日进度">
          {isFocusMode && (
            <div
              data-testid="pomodoro-task-binding"
              className="workspace-field"
            >
              <label htmlFor="pomodoro-task">今日任务</label>
              <select id="pomodoro-task"
                className="input w-full"
                data-testid="pomodoro-task-select"
                value={selectedTask?.id ?? ''}
                onChange={(event) => selectFocusTask(event.target.value ? Number(event.target.value) : null)}
                disabled={hasActiveTimerSession || timerControlsDisabled}
              >
                <option value="">不绑定今日任务</option>
                {selectableTasks.map(task => {
                  const subjectName = task.subject_id ? subjectNameById.get(task.subject_id) : undefined
                  const details = [
                    task.status,
                    subjectName,
                    task.estimate_minutes ? `${task.estimate_minutes}m` : undefined,
                  ].filter(Boolean).join(' · ')
                  return (
                    <option key={task.id} value={task.id}>
                      {task.title}{details ? ` · ${details}` : ''}
                    </option>
                  )
                })}
              </select>
              {selectedTask && (
                <div
                  data-testid="pomodoro-selected-task-summary"
                  className="text-xs"
                  style={{ marginTop: 8, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}
                >
                  当前任务：{selectedTask.title}
                  {selectedTaskSubjectName ? ` · ${selectedTaskSubjectName}` : ''}
                  {selectedTask.estimate_minutes ? ` · 预计 ${selectedTask.estimate_minutes} 分钟` : ''}
                </div>
              )}
              {taskError && (
                <div
                  data-testid="pomodoro-task-error"
                  className="text-xs"
                  style={{ marginTop: 8, color: 'var(--color-danger-fg)', overflowWrap: 'anywhere' }}
                >
                  {taskError}
                </div>
              )}
            </div>
          )}

          {/* Subject Select */}
          <div className="workspace-field">
            <label htmlFor="pomodoro-subject">专注科目（可选）</label>
            <select id="pomodoro-subject"
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
          <div className="workspace-section pomodoro-page__stats" data-testid="pomodoro-stats">
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
        </section>
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
      selectedTaskTitle={selectedTaskTitle}
      showFinishEarly={showFinishCountdownSession}
      canFinishEarly={canFinishCountdownSession}
      isFinishingEarly={isSavingInterruptedFocus}
      onFinishEarly={handleFinishCountdownFocusSession}
    />
    {focusNotice}
    </>
  )
}
