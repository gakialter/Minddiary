import { useCallback, useEffect, useRef, useState } from 'react'
import { Minimize2, Pause, Play } from 'lucide-react'

interface FocusZenModeProps {
  visible: boolean
  timeLeft: number
  modeLabel: string
  modeColor: string
  isRunning: boolean
  onToggleTimer: () => void
  onExit: () => void | Promise<void>
  formatTime: (seconds: number) => string
  selectedSubjectName?: string
}

const CONTROL_HIDE_DELAY_MS = 2400

export default function FocusZenMode({
  visible,
  timeLeft,
  modeLabel,
  modeColor,
  isRunning,
  onToggleTimer,
  onExit,
  formatTime,
  selectedSubjectName,
}: FocusZenModeProps) {
  const [controlsVisible, setControlsVisible] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const revealControls = useCallback(() => {
    setControlsVisible(true)
    clearHideTimer()
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROL_HIDE_DELAY_MS)
  }, [clearHideTimer])

  useEffect(() => {
    if (!visible) {
      setControlsVisible(false)
      clearHideTimer()
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }

      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault()
        revealControls()
        onToggleTimer()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      clearHideTimer()
    }
  }, [clearHideTimer, onExit, onToggleTimer, revealControls, visible])

  if (!visible) return null

  const isBreakMode = modeLabel.includes('休')
  const statusText = selectedSubjectName && !isBreakMode
    ? selectedSubjectName
    : isBreakMode ? '休息中' : '专注中'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Zen 全屏专注模式"
      data-testid="focus-zen-mode"
      onMouseMove={revealControls}
      onFocus={revealControls}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div
          data-testid="focus-zen-time"
          style={{
            fontSize: '7rem',
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: 0,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--text-primary)',
          }}
        >
          {formatTime(timeLeft)}
        </div>
        <div
          style={{
            color: modeColor,
            fontSize: 16,
            fontWeight: 500,
            opacity: 0.58,
          }}
        >
          {statusText}
        </div>
      </div>

      <div
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 48,
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 12,
          opacity: controlsVisible ? 0.82 : 0,
          pointerEvents: controlsVisible ? 'auto' : 'none',
          transition: 'opacity 180ms ease',
        }}
      >
        <button
          type="button"
          className="button button-secondary"
          data-testid="focus-zen-toggle-btn"
          onClick={() => {
            revealControls()
            onToggleTimer()
          }}
          style={{
            minWidth: 104,
            height: 42,
            borderRadius: 21,
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-light)',
          }}
        >
          {isRunning ? <><Pause size={16} /> 暂停</> : <><Play size={16} /> 继续</>}
        </button>
        <button
          type="button"
          className="button button-secondary"
          data-testid="focus-zen-exit-btn"
          onClick={onExit}
          style={{
            minWidth: 116,
            height: 42,
            borderRadius: 21,
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-light)',
          }}
        >
          <Minimize2 size={16} /> 退出全屏
        </button>
      </div>
    </div>
  )
}
