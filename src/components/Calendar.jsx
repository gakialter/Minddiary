import { useState, useEffect } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { MOODS } from '../utils/helpers'
import MoodIcon from './MoodIcon'

function Calendar({ selectedDate, onSelectDate }) {
  const diary = useDiary()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [entriesByDate, setEntriesByDate] = useState({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadMonthEntries()
  }, [currentMonth])

  const loadMonthEntries = async () => {
    const yearMonth = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`
    setLoading(true)
    try {
      const dates = await diary.entries.getDatesWithEntries(yearMonth)
      const map = {}
      ;(dates || []).forEach(d => {
        map[d.date] = d.mood
      })
      setEntriesByDate(map)
    } catch (error) {
      console.error('Failed to load entries:', error)
    } finally {
      setLoading(false)
    }
  }

  const getDaysInMonth = (date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const firstDayOfWeek = firstDay.getDay()

    const days = []
    for (let i = 0; i < firstDayOfWeek; i++) days.push(null)
    for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i))
    return days
  }

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))
  }

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))
  }

  const goToToday = () => {
    const today = new Date()
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1))
    onSelectDate(today.toISOString().split('T')[0])
  }

  const formatMonthYear = (date) => {
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
  }

  // Safe local-timezone date formatting
  const toDateStr = (date) => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  const todayStr = toDateStr(new Date())
  const days = getDaysInMonth(currentMonth)
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']

  return (
    <div className="flex flex-col gap-md">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">日历视图</h2>
        <button className="button button-secondary text-sm" onClick={goToToday}>
          回到今天
        </button>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between" style={{
        background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-md)'
      }}>
        <button className="button button-secondary text-sm" onClick={prevMonth}>← 上个月</button>
        <div style={{ fontSize: 18, fontWeight: 600 }}>{formatMonthYear(currentMonth)}</div>
        <button className="button button-secondary text-sm" onClick={nextMonth}>下个月 →</button>
      </div>

      {/* Calendar grid */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {/* Weekday headers */}
        <div className="grid grid-cols-7" style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border)' }}>
          {weekdays.map(day => (
            <div key={day} style={{ padding: 'var(--space-sm)', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
              {day}
            </div>
          ))}
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7">
          {days.map((date, index) => {
            const dateStr = date ? toDateStr(date) : ''
            const isSelected = dateStr === selectedDate
            const isToday = dateStr === todayStr
            const mood = entriesByDate[dateStr]
            const hasEntry = dateStr in entriesByDate

            return (
              <button
                key={index}
                onClick={() => date && onSelectDate(dateStr)}
                disabled={!date}
                style={{
                  minHeight: 80, padding: 'var(--space-sm)',
                  border: '1px solid rgba(58,58,77,0.3)',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'flex-start',
                  transition: 'background 0.15s', cursor: date ? 'pointer' : 'default',
                  background: isSelected ? 'rgba(139,92,246,0.15)' : (date ? '' : 'transparent'),
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => { if (date && !isSelected) e.currentTarget.style.background = 'var(--bg-tertiary)' }}
                onMouseLeave={(e) => { if (date && !isSelected) e.currentTarget.style.background = '' }}
              >
                {date && (
                  <>
                    <span style={{
                      fontSize: 13, fontWeight: 500, marginBottom: 4,
                      ...(isToday ? {
                        background: 'var(--accent)', color: 'white',
                        borderRadius: '50%', width: 28, height: 28,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      } : {})
                    }}>
                      {date.getDate()}
                    </span>
                    {hasEntry && (
                      <>
                        <div style={{ marginBottom: 2 }}><MoodIcon mood={mood} size={20} /></div>
                        <div className="text-xs text-muted">已记录</div>
                      </>
                    )}
                    {!hasEntry && date.getDay() !== 0 && date.getDay() !== 6 && (
                      <div className="text-xs text-muted" style={{ marginTop: 8 }}>点击添加</div>
                    )}
                  </>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-md" style={{
        padding: 'var(--space-md)', background: 'var(--bg-tertiary)',
        borderRadius: 'var(--radius-lg)'
      }}>
        <div className="text-sm font-medium" style={{ marginBottom: 4 }}>图例</div>
        <div className="flex items-center gap-sm">
          <MoodIcon mood="default" size={24} />
          <span className="text-sm text-secondary">有日记</span>
        </div>
        {MOODS.map(m => (
          <div key={m.id} className="flex items-center gap-sm">
            <MoodIcon mood={m.id} size={24} />
            <span className="text-sm text-secondary">{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Calendar