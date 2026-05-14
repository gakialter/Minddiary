import { useState, type CSSProperties } from 'react'
import { CalendarDays, Pin, PinOff, Plus, Trash2 } from 'lucide-react'
import {
  DEFAULT_EXAM_EVENT_ID,
  DEFAULT_EXAM_TITLE,
  normalizeCountdownEvents,
} from '../utils/countdown'
import type { CountdownEvent, CountdownEventType } from '../types'

interface CountdownEventsManagerProps {
  examDate: string
  setExamDate: (value: string) => void
  events: CountdownEvent[]
  setEvents: (events: CountdownEvent[]) => void
}

const EVENT_TYPE_OPTIONS: Array<{ value: CountdownEventType; label: string }> = [
  { value: 'exam', label: '考试' },
  { value: 'holiday', label: '假期' },
  { value: 'deadline', label: '截止' },
  { value: 'custom', label: '自定义' },
]

export default function CountdownEventsManager({
  examDate,
  setExamDate,
  events,
  setEvents,
}: CountdownEventsManagerProps) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [type, setType] = useState<CountdownEventType>('custom')

  const normalizedEvents = normalizeCountdownEvents(events, examDate)
  const canAdd = title.trim().length > 0 && date.trim().length > 0

  const handleExamDateChange = (value: string) => {
    setExamDate(value)
    setEvents(normalizeCountdownEvents(events, value))
  }

  const handleAdd = () => {
    if (!canAdd) return

    const nextEvent: CountdownEvent = {
      id: `countdown-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title: title.trim(),
      date,
      type,
    }

    setEvents(normalizeCountdownEvents([...normalizedEvents, nextEvent], examDate))
    setTitle('')
    setDate('')
    setType('custom')
  }

  const handleTogglePinned = (eventId: string) => {
    setEvents(normalizedEvents.map(event => (
      event.id === eventId ? { ...event, pinned: !event.pinned } : event
    )))
  }

  const handleDelete = (eventId: string) => {
    if (eventId === DEFAULT_EXAM_EVENT_ID) return
    setEvents(normalizedEvents.filter(event => event.id !== eventId))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <div>
        <label style={labelStyle}>考研初试日期</label>
        <input
          type="date"
          className="input w-full"
          value={examDate}
          onChange={(e) => handleExamDateChange(e.target.value)}
        />
        <div className="text-xs text-muted" style={{ marginTop: 6 }}>
          此字段会同步到内置“{DEFAULT_EXAM_TITLE}”关键日期，旧版 examDate 数据会继续可用。
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <CalendarDays size={15} style={{ color: 'var(--accent)' }} />
          关键日期管理
        </div>
        <div className="text-xs text-muted" style={{ marginBottom: 'var(--space-sm)', lineHeight: 1.6 }}>
          添加考试、报名、假期等关键节点，让每日看板帮你保持长期节奏。
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-sm)', alignItems: 'end' }}>
          <label style={{ ...fieldLabelStyle, gridColumn: '1 / -1', marginBottom: 0 }}>
            <span>标题</span>
            <input
              aria-label="关键日期标题"
              type="text"
              className="input w-full"
              placeholder="暑假开始"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label style={{ ...fieldLabelStyle, marginBottom: 0 }}>
            <span>日期</span>
            <input
              aria-label="关键日期日期"
              type="date"
              className="input w-full"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label style={{ ...fieldLabelStyle, marginBottom: 0 }}>
            <span>类型</span>
            <select
              aria-label="关键日期类型"
              className="input w-full"
              value={type}
              onChange={(e) => setType(e.target.value as CountdownEventType)}
            >
              {EVENT_TYPE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button button-primary"
            onClick={handleAdd}
            disabled={!canAdd}
            style={{ gridColumn: '1 / -1', height: 38, padding: '0 var(--space-md)' }}
          >
            <Plus size={15} /> 添加日期
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {normalizedEvents.length === 0 ? (
          <div className="text-sm text-muted" style={{ padding: 'var(--space)', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
            还没有设置关键日期，可以在设置中添加考研、暑假或报名节点。
          </div>
        ) : (
          normalizedEvents.map(event => (
            <div
              key={event.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 'var(--space-sm)',
                alignItems: 'center',
                padding: '10px 12px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {event.title}
                  {event.id === DEFAULT_EXAM_EVENT_ID && (
                    <span className="text-xs text-muted" style={{ marginLeft: 8 }}>内置</span>
                  )}
                </div>
                <div className="text-xs text-muted">
                  {event.date} · {eventTypeLabel(event.type)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                <button
                  type="button"
                  className="button button-secondary"
                  aria-label={`${event.pinned ? '取消置顶' : '置顶'} ${event.title}`}
                  title={event.pinned ? '取消置顶' : '置顶'}
                  onClick={() => handleTogglePinned(event.id)}
                  style={{ width: 34, height: 34, padding: 0 }}
                >
                  {event.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  aria-label={`删除 ${event.title}`}
                  title={event.id === DEFAULT_EXAM_EVENT_ID ? '内置日期不可删除' : '删除'}
                  onClick={() => handleDelete(event.id)}
                  disabled={event.id === DEFAULT_EXAM_EVENT_ID}
                  style={{ width: 34, height: 34, padding: 0, color: 'var(--danger)' }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: 'var(--text-muted)',
  marginBottom: 'var(--space-sm)',
}

const fieldLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: 'var(--text-muted)',
}

function eventTypeLabel(type: CountdownEventType | undefined): string {
  return EVENT_TYPE_OPTIONS.find(option => option.value === type)?.label || '自定义'
}
