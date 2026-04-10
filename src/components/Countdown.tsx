import { useState, useEffect } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { CalendarDays, Trophy } from 'lucide-react'

function Countdown() {
  const diary = useDiary()
  const [daysLeft, setDaysLeft] = useState<number | null>(null)
  const [examDate, setExamDate] = useState('2025-12-21')

  useEffect(() => {
    loadExamDate()
  }, [])

  const loadExamDate = async () => {
    try {
      const settings = await diary.settings.getAll()
      if (settings?.examDate) {
        setExamDate(settings.examDate as string)
      }
    } catch (error) {
      console.error('Failed to load exam date:', error)
    }
  }

  useEffect(() => {
    const calculateDaysLeft = () => {
      const today = new Date()
      const exam = new Date(examDate)
      const diff = exam.getTime() - today.getTime()
      const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
      setDaysLeft(days)
    }

    calculateDaysLeft()
    const interval = setInterval(calculateDaysLeft, 60000)
    return () => clearInterval(interval)
  }, [examDate])

  const getMessage = (days: number) => {
    if (days < 0) return <><Trophy size={14} /> 已结束</>
    if (days === 0) return '今天考试！'
    if (days < 10) return `只剩 ${days} 天！`
    if (days < 30) return `还有 ${days} 天`
    if (days < 100) return `距考试 ${days} 天`
    return `考试倒计时 ${days} 天`
  }

  if (daysLeft === null) return null

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)',
      padding: '4px 14px', borderRadius: 20,
      background: daysLeft < 30 ? 'rgba(239,68,68,0.15)' : 'rgba(139,92,246,0.15)',
      color: daysLeft < 30 ? 'var(--danger)' : 'var(--accent-light)',
      fontSize: 13
    }}>
      <span style={{ display: 'flex', alignItems: 'center' }}><CalendarDays size={14} /></span>
      <span className="font-semibold" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{getMessage(daysLeft)}</span>
    </div>
  )
}

export default Countdown