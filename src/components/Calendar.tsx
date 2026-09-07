import { useState, useEffect } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { MOODS } from '../utils/helpers'
import { logger } from '../utils/logger'
import MoodIcon from './MoodIcon'
import type { MoodId, DateMood } from '../types'

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

      try {
        const [datesResult, pomodoroRangeResult] = await Promise.allSettled([
          diary.entries.getDatesWithEntries(yearMonth),
          diary.pomodoro.getRange(startDate, endDate)
        ])

        if (isCancelled) return

        const map: Record<string, CalendarDateData> = {}
        
        if (datesResult.status === 'fulfilled') {
          ;((datesResult.value || []) as DateMood[]).forEach(d => {
            map[d.date] = { mood: d.mood, hasDiary: true, pomodoro: null }
          })
        } else {
          logger.error('Failed to load diary entries for calendar:', datesResult.reason)
        }

        if (pomodoroRangeResult.status === 'fulfilled') {
          ;(pomodoroRangeResult.value || []).forEach(p => {
            if (!map[p.date]) {
              map[p.date] = { mood: null, hasDiary: false, pomodoro: null }
            }
            map[p.date]!.pomodoro = { totalMinutes: p.total_minutes, sessionCount: p.session_count }
          })
        } else {
          logger.error('Failed to load pomodoro range for calendar:', pomodoroRangeResult.reason)
        }

        setEntriesByDate(map)
      } catch (error) {
        if (!isCancelled) logger.error('Unexpected error loading calendar data:', error)
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
    onSelectDate(toDateStr(today))
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
    <section className="workspace-page workspace-page--wide workspace-calendar" aria-labelledby="calendar-month-heading">
      {/* Month navigation */}
      <header className="workspace-calendar__header">
        <div className="workspace-calendar__heading-group">
           <h2 id="calendar-month-heading" className="workspace-calendar__month" aria-live="polite">
             {formatMonthYear(currentMonth)}
           </h2>
           <button type="button" className="button button-secondary workspace-calendar__today" onClick={goToToday}>
             回到今天
           </button>
        </div>
        <nav className="workspace-calendar__month-nav" aria-label="月份切换">
           <button type="button" className="button button-secondary" onClick={prevMonth}>← 上个月</button>
           <button type="button" className="button button-secondary" onClick={nextMonth}>下个月 →</button>
        </nav>
      </header>

      {/* Calendar grid */}
      <div className="workspace-calendar__grid" role="group" aria-label={`${formatMonthYear(currentMonth)}学习记录`}>
        {/* Weekday headers */}
        <div className="workspace-calendar__weekdays" aria-hidden="true">
          {weekdays.map(day => (
            <div key={day} className="workspace-calendar__weekday">
              {day}
            </div>
          ))}
        </div>

        {/* Days grid */}
        <div className="workspace-calendar__days">
          {days.map((date, index) => {
            const dateStr = date ? toDateStr(date) : ''
            const isSelected = dateStr === selectedDate
            const isToday = dateStr === todayStr
            const data = entriesByDate[dateStr]
            const hasDiary = !!data?.hasDiary
            const pomodoro = data?.pomodoro
            const focusLevel = pomodoro ? getFocusLevel(pomodoro.totalMinutes) : 0
            const buttonTitle = date ? `${dateStr}${hasDiary ? '，已记录日记' : ''}${pomodoro ? `，专注 ${pomodoro.totalMinutes} 分钟` : ''}` : ''

            return (
              <button
                key={index}
                type="button"
                className="workspace-calendar__day"
                title={buttonTitle}
                aria-label={buttonTitle || undefined}
                aria-pressed={date ? isSelected : undefined}
                aria-current={isToday ? 'date' : undefined}
                data-selected={isSelected || undefined}
                data-today={isToday || undefined}
                data-has-diary={hasDiary || undefined}
                data-focus-level={focusLevel}
                onClick={() => date && onSelectDate(dateStr)}
                disabled={!date}
              >
                {date && (
                  <>
                    <span className="workspace-calendar__day-number">
                      {date.getDate()}
                    </span>
                    {hasDiary && (
                      <div className="workspace-calendar__mood" aria-hidden="true">
                        <MoodIcon mood={data?.mood || null} size={20} />
                        {focusLevel > 0 && (
                          <span className="workspace-calendar__focus-dot" data-level={focusLevel} />
                        )}
                      </div>
                    )}
                    {hasDiary && <span className="workspace-calendar__recorded">已记录</span>}
                    {!hasDiary && focusLevel > 0 && (
                      <div className="workspace-calendar__focus-summary">
                         <span className="workspace-calendar__focus-badge" data-level={focusLevel}>
                           {pomodoro?.totalMinutes || 0}m
                         </span>
                      </div>
                    )}
                    {!hasDiary && focusLevel === 0 && date.getDay() !== 0 && date.getDay() !== 6 && (
                      <span className="workspace-calendar__add-hint">点击添加</span>
                    )}
                  </>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <aside className="workspace-calendar__legend" aria-label="日历图例">
        <h3 className="workspace-calendar__legend-title">图例</h3>
        <div className="workspace-calendar__legend-item">
          <span aria-hidden="true"><MoodIcon mood="default" size={24} /></span>
          <span>有日记</span>
        </div>
        {MOODS.map(m => (
          <div key={m.id} className="workspace-calendar__legend-item">
            <span aria-hidden="true"><MoodIcon mood={m.id} size={24} /></span>
            <span>{m.label}</span>
          </div>
        ))}
        <div className="workspace-calendar__legend-item workspace-calendar__legend-item--focus">
          <span className="workspace-calendar__focus-dot" data-level="1" aria-hidden="true" />
          <span>专注 30m+</span>
        </div>
        <div className="workspace-calendar__legend-item">
          <span className="workspace-calendar__focus-dot" data-level="2" aria-hidden="true" />
          <span>专注 60m+</span>
        </div>
        <div className="workspace-calendar__legend-item">
          <span className="workspace-calendar__focus-dot" data-level="3" aria-hidden="true" />
          <span>专注 120m+</span>
        </div>
      </aside>
    </section>
  )
}

export default Calendar
