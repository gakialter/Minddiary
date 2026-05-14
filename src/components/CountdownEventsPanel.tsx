import { CalendarDays } from 'lucide-react'
import {
  formatDaysLeft,
  getDaysLeft,
  sortUpcomingEvents,
} from '../utils/countdown'
import type { CountdownEvent } from '../types'

interface CountdownEventsPanelProps {
  events: CountdownEvent[]
  maxItems?: number
}

export default function CountdownEventsPanel({ events, maxItems = 3 }: CountdownEventsPanelProps) {
  const upcomingEvents = sortUpcomingEvents(events).slice(0, maxItems)

  return (
    <div className="card" style={{ padding: 'var(--space-lg)', borderTop: '3px solid var(--accent)' }}>
      <div className="text-muted text-sm font-medium mb-2 flex items-center gap-xs">
        <CalendarDays size={14} style={{ color: 'var(--accent)' }} /> 关键日期
      </div>

      {upcomingEvents.length === 0 ? (
        <div className="text-sm text-muted" style={{ lineHeight: 1.6 }}>
          还没有设置关键日期。添加一个目标日期，让备考节奏更清晰。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {upcomingEvents.map(event => {
            const daysLeft = getDaysLeft(event.date)
            return (
              <div
                key={event.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 'var(--space-sm)',
                  alignItems: 'baseline',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {event.title}
                  </div>
                  <div className="text-xs text-muted">{event.date}</div>
                </div>
                <div className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
                  {formatDaysLeft(daysLeft)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
