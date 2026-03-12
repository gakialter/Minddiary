import { useState, useRef, useCallback, useEffect } from 'react'
import { usePomodoroContext } from '../contexts/PomodoroContext'

const DRAG_THRESHOLD = 5 // px — below this is a click, above is a drag
const STORAGE_KEY = 'pomodoro-widget-position'

function getInitialPosition(isCollapsed) {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return { x: isCollapsed ? 90 : 260, y: window.innerHeight - 80 }
}

function clampPosition(x, y, elWidth = 160, elHeight = 56) {
  const maxX = window.innerWidth - elWidth
  const maxY = window.innerHeight - elHeight
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  }
}

export default function Pomodoro({ isWidget, onExpand, isCollapsed }) {
  const {
    mode, setMode, timeLeft, isRunning,
    subjects, selectedSubject, setSelectedSubject,
    todayStats, todayTotal, dynamicModes,
    progress, circleCircumference, miniCircumference,
    toggleTimer, resetTimer, formatTime,
  } = usePomodoroContext()

  // ─── Drag state (widget only) ───
  const [pos, setPos] = useState(() => getInitialPosition(isCollapsed))
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0, moved: false })
  const widgetRef = useRef(null)

  // Update default position when sidebar collapses (only if user hasn't dragged)
  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setPos(prev => ({ ...prev, x: isCollapsed ? 90 : 260 }))
      }
    } catch { /* ignore */ }
  }, [isCollapsed])

  const onPointerDown = useCallback((e) => {
    // Don't initiate drag on the play/pause button area
    if (e.target.closest('[data-no-drag]')) return
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

  const onPointerMove = useCallback((e) => {
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

  const onPointerUp = useCallback((e) => {
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

  // ─── Widget (floating ball) ───
  if (isWidget) {
    return (
      <div
        ref={widgetRef}
        className="pomodoro-mini card"
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          padding: '8px 16px 8px 8px',
          display: 'flex', alignItems: 'center', gap: 12,
          border: `1px solid ${mode.color}40`,
          background: 'var(--bg-secondary)',
          backdropFilter: 'blur(16px)',
          zIndex: 100,
          transition: isDragging ? 'none' : 'box-shadow 0.3s, border-color 0.3s',
          cursor: isDragging ? 'grabbing' : 'grab',
          boxShadow: isDragging ? 'var(--shadow-xl, 0 20px 40px rgba(0,0,0,0.15))' : 'var(--shadow-lg)',
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
          style={{ position: 'relative', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); toggleTimer(); }}
        >
          <svg viewBox="0 0 40 40" width="40" height="40" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
            <circle cx="20" cy="20" r="18" fill="none" stroke="var(--border)" strokeWidth="3" />
            <circle cx="20" cy="20" r="18" fill="none" stroke={mode.color} strokeWidth="3" strokeLinecap="round"
              strokeDasharray={miniCircumference} strokeDashoffset={miniCircumference * (1 - progress)}
              style={{ transition: 'stroke-dashoffset 1s linear' }} />
          </svg>
          <div style={{ fontSize: 14, opacity: 0.8 }}>{isRunning ? '⏸' : '▶'}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: mode.color, fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(timeLeft)}
          </div>
        </div>
      </div>
    )
  }

  // ─── Full-page view ───
  return (
    <div className="pomodoro-container flex flex-col items-center w-full" style={{ padding: 'var(--space-xl) 0' }}>

      {/* Mode Switcher */}
      <div className="flex gap-sm p-1 rounded-full bg-secondary" style={{ background: 'var(--bg-tertiary)', padding: 4, borderRadius: 24, marginBottom: 'var(--space-2xl)' }}>
        {Object.values(dynamicModes).map(m => (
          <button
            key={m.id}
            onClick={() => setMode(m)}
            style={{
              padding: '6px 16px', borderRadius: 20, fontSize: 14, fontWeight: 500, border: 'none', cursor: 'pointer',
              background: mode.id === m.id ? 'var(--bg-primary)' : 'transparent',
              color: mode.id === m.id ? m.color : 'var(--text-muted)',
              boxShadow: mode.id === m.id ? 'var(--shadow-sm)' : 'none',
              transition: 'all 0.3s'
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

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
            {isRunning ? '正在进行中...' : '准备就绪'}
          </div>
        </div>
      </div>

      <div className="flex gap-md" style={{ marginBottom: 'var(--space-2xl)' }}>
        <button
          className="button"
          style={{
            minWidth: 120, height: 44, borderRadius: 22, fontSize: 16, fontWeight: 600, border: 'none',
            background: isRunning ? 'var(--bg-tertiary)' : mode.color,
            color: isRunning ? 'var(--text-primary)' : 'white',
            boxShadow: isRunning ? 'none' : `0 8px 16px ${mode.color}40`,
          }}
          onClick={toggleTimer}
        >
          {isRunning ? '⏸ 暂停' : '▶ 开始专注'}
        </button>
        <button
          className="button button-secondary"
          style={{ width: 44, height: 44, borderRadius: 22, padding: 0 }}
          onClick={resetTimer}
          title="重置"
          aria-label="重置番茄钟"
        >
          ↻
        </button>
      </div>

      {/* Subject Select */}
      <div style={{ width: '100%', maxWidth: '300px', marginBottom: 'var(--space-xl)' }}>
        <select
          className="input w-full"
          value={selectedSubject || ''}
          onChange={(e) => setSelectedSubject(e.target.value ? Number(e.target.value) : null)}
          disabled={mode.id !== 'work'}
        >
          <option value="">{mode.id === 'work' ? '选择专注科目（可选）' : '休息中...'}</option>
          {subjects.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Today Stats */}
      <div className="card w-full" style={{ maxWidth: '340px', padding: 'var(--space-lg)' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-md)' }}>
          <h3 className="text-base font-semibold">今日总览</h3>
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
            今天还没有专注记录哦
          </div>
        )}
      </div>
    </div>
  )
}
