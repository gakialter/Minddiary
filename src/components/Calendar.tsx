import { useState, useEffect } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { MOODS } from '../utils/helpers'
import { logger } from '../utils/logger'
import MoodIcon from './MoodIcon'
import type { DiaryEntry, MoodId, DateMood } from '../types'

interface CalendarProps {
  selectedDate: string
  onSelectDate: (date: string) => void
}

interface CalendarDateData {
  mood: MoodId | null
  pomodoro: { totalMinutes: number; sessionCount: number } | null
  hasDiary: boolean
}

function Calendar({ selectedDate, onSelectDate }: CalendarProps) {
  const diary = useDiary()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [entriesByDate, setEntriesByDate] = useState<Record<string, CalendarDateData>>({})
  const [loading, setLoading] = useState(false)

  const getFocusLevel = (totalMinutes: number): 0 | 1 | 2 | 3 => {
    if (totalMinutes >= 120) return 3
    if (totalMinutes >= 60) return 2
    if (totalMinutes >= 30) return 1
    return 0
  }

  useEffect(() => {
    let isCancelled = false

    const loadMonthEntries = async () => {
      const yearMonth = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`
      
      const year = currentMonth.getFullYear()
      const month = currentMonth.getMonth()
      const lastDay = new Date(year, month + 1, 0).getDate()
      const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`
      const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

      setLoading(true)
      try {
        const [dates, pomodoroRange] = await Promise.all([
          diary.entries.getDatesWithEntries(yearMonth),
          diary.pomodoro.getRange(startDate, endDate)
        ])

        if (isCancelled) return

        const map: Record<string, CalendarDateData> = {}
        
        ;((dates || []) as DateMood[]).forEach(d => {
          map[d.date] = { mood: d.mood, hasDiary: true, pomodoro: null }
        })

        ;(pomodoroRange || []).forEach(p => {
          if (!map[p.date]) {
            map[p.date] = { mood: null, hasDiary: false, pomodoro: null }
          }
          map[p.date]!.pomodoro = { totalMinutes: p.total_minutes, sessionCount: p.session_count }
        })

        setEntriesByDate(map)
      } catch (error) {
        if (!isCancelled) logger.error('Failed to load entries:', error)
      } finally {
        if (!isCancelled) setLoading(false)
      }
    }

    loadMonthEntries()
    
    return () => {
      isCancelled = true
    }
  }, [currentMonth, diary.entries, diary.pomodoro])



  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const firstDayOfWeek = firstDay.getDay()

    const days: (Date | null)[] = []
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
    onSelectDate(today.toISOString().split('T')[0]!)
  }

  const formatMonthYear = (date: Date) => {
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
  }

  // Safe local-timezone date formatting
  const toDateStr = (date: Date) => {
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
      {/* Month navigation */}
      <div className="flex items-center justify-between" style={{
        background: 'transparent',
        paddingBottom: 'var(--space-sm)'
      }}>
        <div className="flex items-center gap-md">
           <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px' }}>{formatMonthYear(currentMonth)}</span>
           <button className="button button-secondary text-sm" onClick={goToToday} style={{ padding: '4px 12px', background: 'transparent' }}>回到今天</button>
        </div>
        <div className="flex gap-sm">
           <button className="button button-secondary text-sm" onClick={prevMonth} style={{ padding: '4px 12px', background: 'transparent' }}>← 上个月</button>
           <button className="button button-secondary text-sm" onClick={nextMonth} style={{ padding: '4px 12px', background: 'transparent' }}>下个月 →</button>
        </div>
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
            const data = entriesByDate[dateStr]
            const hasDiary = !!data?.hasDiary
            const pomodoro = data?.pomodoro
            const focusLevel = pomodoro ? getFocusLevel(pomodoro.totalMinutes) : 0

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
                  position: 'relative'
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
                    {hasDiary && (
                      <div style={{ marginBottom: 2, position: 'relative' }}>
                        <MoodIcon mood={data?.mood || null} size={20} />
                        {focusLevel > 0 && (
                          <div style={{ 
                            position: 'absolute', bottom: -2, right: -4, 
                            width: 10, height: 10, borderRadius: '50%',
                            background: focusLevel === 1 ? 'var(--success)' : focusLevel === 2 ? 'var(--warning)' : 'var(--danger)',
                            border: '2px solid var(--bg-primary)'
                          }} />
                        )}
                      </div>
                    )}
                    {hasDiary && <div className="text-xs text-muted">已记录</div>}
                    {!hasDiary && focusLevel > 0 && (
                      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                         <div style={{ 
                            padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 500,
                            background: `color-mix(in srgb, ${focusLevel === 1 ? 'var(--success)' : focusLevel === 2 ? 'var(--warning)' : 'var(--danger)'} 15%, transparent)`,
                            color: focusLevel === 1 ? 'var(--success)' : focusLevel === 2 ? 'var(--warning)' : 'var(--danger)',
                            border: `1px solid color-mix(in srgb, ${focusLevel === 1 ? 'var(--success)' : focusLevel === 2 ? 'var(--warning)' : 'var(--danger)'} 30%, transparent)`
                          }}>
                           {pomodoro?.totalMinutes || 0}m
                         </div>
                      </div>
                    )}
                    {!hasDiary && focusLevel === 0 && date.getDay() !== 0 && date.getDay() !== 6 && (
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
        <div className="flex items-center gap-sm ml-4">
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--success)' }} />
          <span className="text-sm text-secondary">专注 30m+</span>
        </div>
        <div className="flex items-center gap-sm">
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--warning)' }} />
          <span className="text-sm text-secondary">专注 60m+</span>
        </div>
        <div className="flex items-center gap-sm">
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--danger)' }} />
          <span className="text-sm text-secondary">专注 120m+</span>
        </div>
      </div>
    </div>
  )
}

export default Calendar