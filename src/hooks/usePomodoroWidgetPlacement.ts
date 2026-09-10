import { useEffect, useRef, useState, type PointerEvent } from 'react'

type Dock = 'bottom-left' | 'bottom-right'
const KEY = 'pomodoro-widget-dock'
const LEGACY_KEY = 'pomodoro-widget-position'

function initialDock(): Dock {
  try {
    const dock = localStorage.getItem(KEY)
    if (dock === 'bottom-left' || dock === 'bottom-right') return dock
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null')
    if (legacy && Number.isFinite(legacy.x) && Number.isFinite(legacy.y)
      && legacy.x >= 0 && legacy.x <= window.innerWidth - 160
      && legacy.y >= 0 && legacy.y <= window.innerHeight - 56) {
      return legacy.x + 80 > window.innerWidth / 2 ? 'bottom-right' : 'bottom-left'
    }
  } catch { /* Invalid or unavailable storage uses the default anchor. */ }
  return 'bottom-left'
}

/** Owns dock intent only; CSS derives anchors from the shell's current geometry. */
export function usePomodoroWidgetPlacement() {
  const [dock, setDock] = useState<Dock>(initialDock)
  const [isDragging, setIsDragging] = useState(false)
  const drag = useRef<{ id: number; x: number; y: number; target: HTMLElement } | null>(null)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, dock)
      localStorage.removeItem(LEGACY_KEY)
    } catch { /* Docking remains available without storage. */ }
  }, [dock])
  const release = () => {
    const current = drag.current
    drag.current = null
    if (current?.target.hasPointerCapture?.(current.id)) current.target.releasePointerCapture(current.id)
  }
  useEffect(() => () => release(), [])
  const cancel = () => { release(); setIsDragging(false) }
  return {
    dock, setDock, isDragging,
    handleProps: {
      onPointerDown(event: PointerEvent<HTMLSpanElement>) {
        if (event.button !== 0 || drag.current) return
        event.preventDefault()
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, target: event.currentTarget }
        event.currentTarget.setPointerCapture(event.pointerId)
        setIsDragging(true)
      },
      onPointerUp(event: PointerEvent<HTMLSpanElement>) {
        const start = drag.current
        if (!start || start.id !== event.pointerId) return
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5) {
          const bounds = event.currentTarget.closest('.main')?.getBoundingClientRect()
          const midpoint = bounds ? bounds.left + bounds.width / 2 : window.innerWidth / 2
          setDock(event.clientX > midpoint ? 'bottom-right' : 'bottom-left')
        }
        cancel()
      },
      onPointerCancel(event: PointerEvent<HTMLSpanElement>) {
        if (drag.current?.id === event.pointerId) cancel()
      },
      onLostPointerCapture(event: PointerEvent<HTMLSpanElement>) {
        if (drag.current?.id === event.pointerId) cancel()
      },
    },
  }
}
