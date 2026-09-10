import { createPortal } from 'react-dom'
import { useModalFocus } from '../hooks/useModalFocus'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Minimize2, Pause, Play, Square } from 'lucide-react'

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
  selectedTaskTitle?: string
  showFinishEarly?: boolean
  canFinishEarly?: boolean
  isFinishingEarly?: boolean
  onFinishEarly?: () => void | Promise<void>
}

const CONTROL_HIDE_DELAY_MS = 2400
const INTERACTIVE_TARGET = 'button, input, select, textarea, a[href], summary, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="combobox"], [tabindex]:not([tabindex="-1"])'

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
  selectedTaskTitle,
  showFinishEarly = false,
  canFinishEarly = false,
  isFinishingEarly = false,
  onFinishEarly,
}: FocusZenModeProps) {
  const modalRef = useModalFocus(onExit, visible, true)
  const controlsRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef({ onToggleTimer, isFinishingEarly })
  actionsRef.current = { onToggleTimer, isFinishingEarly }
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
    if (!controlsRef.current?.contains(document.activeElement)) {
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROL_HIDE_DELAY_MS)
    }
  }, [clearHideTimer])

  useEffect(() => {
    if (!visible) {
      setControlsVisible(false)
      clearHideTimer()
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      if (event.key === ' ' || event.code === 'Space') {
        if (event.target instanceof Element && event.target.closest(INTERACTIVE_TARGET)) return
        event.preventDefault()
        revealControls()
        if (!actionsRef.current.isFinishingEarly) actionsRef.current.onToggleTimer()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      clearHideTimer()
    }
  }, [clearHideTimer, revealControls, visible])

  if (!visible) return null

  const isBreakMode = modeLabel.includes('休')
  const statusText = isBreakMode
    ? '休息中'
    : [selectedTaskTitle, selectedSubjectName, modeLabel].filter(Boolean).join(' · ') || '专注中'

  return createPortal(
    <div
      ref={modalRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Zen 全屏专注模式"
      data-testid="focus-zen-mode"
      onMouseMove={revealControls}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-overlay)',
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
          }}
        >
          {statusText}
        </div>
      </div>

      <div
        ref={controlsRef}
        className="focus-zen-controls"
        onFocus={revealControls}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) revealControls() }}
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 48,
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 12,
          opacity: controlsVisible ? 1 : 0,
          pointerEvents: controlsVisible ? 'auto' : 'none',
          transition: 'opacity var(--motion-duration-standard) var(--motion-ease-standard)',
        }}
      >
        <button
          type="button"
          className="button button-secondary"
          data-testid="focus-zen-toggle-btn"
          disabled={isFinishingEarly}
          onClick={() => {
            revealControls()
            if (isFinishingEarly) return
            onToggleTimer()
          }}
          style={{
            minWidth: 104,
            height: 42,
            borderRadius: 'var(--radius-control)',
            background: 'var(--bg-secondary)',
            color: isFinishingEarly ? 'var(--text-muted)' : 'var(--text-primary)',
            border: '1px solid var(--border-light)',
            cursor: isFinishingEarly ? 'not-allowed' : 'pointer',
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
            borderRadius: 'var(--radius-control)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-light)',
          }}
        >
          <Minimize2 size={16} /> 退出全屏
        </button>
        {showFinishEarly && (
          <button
            type="button"
            className="button button-secondary"
            data-testid="focus-zen-finish-countdown-btn"
            disabled={!canFinishEarly || isFinishingEarly}
            onClick={() => {
              revealControls()
              void onFinishEarly?.()
            }}
            title={canFinishEarly ? '提前结束并保存当前实际专注时长' : '至少专注 1 分钟后可保存'}
            style={{
              minWidth: 148,
              height: 42,
              borderRadius: 'var(--radius-control)',
              background: canFinishEarly && !isFinishingEarly ? 'var(--bg-secondary)' : 'var(--bg-tertiary)',
              color: canFinishEarly && !isFinishingEarly ? 'var(--text-primary)' : 'var(--text-muted)',
              border: '1px solid var(--border-light)',
              cursor: canFinishEarly && !isFinishingEarly ? 'pointer' : 'not-allowed',
            }}
          >
            <Square size={16} /> {isFinishingEarly ? '正在保存...' : '提前结束并保存'}
          </button>
        )}
      </div>
    </div>, document.body
  )
}
