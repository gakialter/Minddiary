import { useEffect, useMemo, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { useDiary } from '../contexts/DiaryContext'
import {
  formatCountdownLabel,
  getDaysLeft,
  getFeaturedCountdownEvent,
  normalizeCountdownEvents,
} from '../utils/countdown'
import type { AppSettings } from '../types'

function Countdown() {
  const diary = useDiary()
  const settingsData = (diary.settingsData || {}) as Partial<AppSettings>
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const featuredEvent = useMemo(() => {
    const events = normalizeCountdownEvents(settingsData.countdownEvents, settingsData.examDate)
    return getFeaturedCountdownEvent(events, now)
  }, [settingsData.countdownEvents, settingsData.examDate, now])

  const daysLeft = featuredEvent ? getDaysLeft(featuredEvent.date, now) : null
  const isUrgent = typeof daysLeft === 'number' && daysLeft >= 0 && daysLeft <= 30

  return (
    <div
      aria-label="关键日期倒计时"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-sm)',
        padding: '4px 14px',
        borderRadius: 20,
        background: isUrgent ? 'rgba(217,119,6,0.1)' : 'var(--bg-tertiary)',
        color: isUrgent ? 'var(--warning)' : 'var(--accent)',
        fontSize: 13,
        border: '1px solid var(--border-light)',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center' }}>
        <CalendarDays size={14} />
      </span>
      <span className="font-semibold">
        {formatCountdownLabel(featuredEvent, now)}
      </span>
    </div>
  )
}

export default Countdown
