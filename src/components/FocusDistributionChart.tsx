import { useState, useEffect, useMemo, useCallback } from 'react'
import { getLocalDateKey } from '../utils/dateKey'
import { PieChart } from 'lucide-react'
import type { PomodoroStat } from '../types'
import type { PomodoroContextAPI } from '../types/api'

// ─── Types ──────────────────────────────────────────────────────────────────

type RangeKey = 'today' | 'week' | 'month'

interface FocusDistributionChartProps {
  pomodoro: Pick<PomodoroContextAPI, 'getStats'>
  dataRefreshVersion: number
}

interface AggregatedStat {
  subject_name: string
  color: string
  total_minutes: number
  session_count: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateDateRange(rangeKey: RangeKey): string[] {
  const today = new Date()
  const days = rangeKey === 'today' ? 1 : rangeKey === 'week' ? 7 : 30
  const dates: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    dates.push(getLocalDateKey(d))
  }
  return dates
}

function aggregateStats(allDayStats: PomodoroStat[][]): AggregatedStat[] {
  const merged = new Map<string, AggregatedStat>()

  for (const dayStats of allDayStats) {
    for (const stat of dayStats) {
      const key = stat.subject_name || '未分类'
      const existing = merged.get(key)
      if (existing) {
        existing.total_minutes += stat.total_minutes
        existing.session_count += stat.session_count
      } else {
        merged.set(key, {
          subject_name: key,
          color: stat.color || '',
          total_minutes: stat.total_minutes,
          session_count: stat.session_count,
        })
      }
    }
  }

  // Sort descending by total_minutes
  return Array.from(merged.values()).sort((a, b) => b.total_minutes - a.total_minutes)
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// ─── Constants ──────────────────────────────────────────────────────────────

const RADIUS = 80
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const FALLBACK_COLOR = 'var(--border)'

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '近 7 天' },
  { key: 'month', label: '近 30 天' },
]

// ─── Component ──────────────────────────────────────────────────────────────

export default function FocusDistributionChart({ pomodoro, dataRefreshVersion }: FocusDistributionChartProps) {
  const [rangeKey, setRangeKey] = useState<RangeKey>('today')
  const [data, setData] = useState<AggregatedStat[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async (range: RangeKey) => {
    setLoading(true)
    try {
      const dates = generateDateRange(range)
      const allStats = await Promise.all(
        dates.map(d => pomodoro.getStats(d).catch(() => [] as PomodoroStat[]))
      )
      setData(aggregateStats(allStats))
    } catch {
      setData([])
    } finally {
      setLoading(false)
    }
  }, [pomodoro])

  useEffect(() => {
    loadData(rangeKey)
  }, [rangeKey, dataRefreshVersion, loadData])

  // ── Computed values ──

  const totalMinutes = useMemo(() => data.reduce((sum, s) => sum + s.total_minutes, 0), [data])
  const totalSessions = useMemo(() => data.reduce((sum, s) => sum + s.session_count, 0), [data])

  const segments = useMemo(() => {
    if (totalMinutes === 0) return []
    let cumPercent = 0
    return data.map((stat) => {
      const percent = (stat.total_minutes / totalMinutes) * 100
      const arcLength = (percent / 100) * CIRCUMFERENCE
      const rotation = -90 + cumPercent * 3.6
      cumPercent += percent
      return {
        ...stat,
        percent,
        arcLength,
        rotation,
        displayColor: stat.color || FALLBACK_COLOR,
      }
    })
  }, [data, totalMinutes])

  // ── Render ──

  return (
    <div className="card" style={{ padding: 'var(--space-xl)', marginTop: 'var(--space-xl)' }}>
      {/* Header: title + range selector */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 'var(--space-xl)', flexWrap: 'wrap', gap: 'var(--space-sm)',
      }}>
        <h3 className="font-semibold text-lg" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PieChart size={18} style={{ color: 'var(--accent)' }} /> 专注分布
        </h3>

        <div style={{
          display: 'flex', gap: 4,
          background: 'var(--bg-tertiary)', padding: 3, borderRadius: 20,
        }}>
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.key}
              data-testid={`focus-range-${opt.key}`}
              onClick={() => setRangeKey(opt.key)}
              style={{
                padding: '4px 14px', borderRadius: 16, fontSize: 13, fontWeight: 500,
                border: 'none', cursor: 'pointer',
                background: rangeKey === opt.key ? 'var(--bg-primary)' : 'transparent',
                color: rangeKey === opt.key ? 'var(--accent)' : 'var(--text-muted)',
                boxShadow: rangeKey === opt.key ? 'var(--shadow-sm)' : 'none',
                transition: 'all 0.3s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div data-testid="focus-distribution-loading" style={{
          textAlign: 'center', padding: 'var(--space-xl)',
          color: 'var(--text-muted)',
        }}>
          加载中...
        </div>
      ) : data.length === 0 || totalMinutes === 0 ? (
        <div data-testid="focus-distribution-empty" style={{
          textAlign: 'center', padding: 'var(--space-2xl) var(--space-xl)',
        }}>
          <PieChart size={48} style={{ color: 'var(--text-muted)', opacity: 0.2, marginBottom: 'var(--space-md)' }} />
          <p style={{ color: 'var(--text-secondary)', marginBottom: 4, fontSize: 15 }}>
            选定时间范围内暂无专注记录
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            完成一次番茄后，这里会显示你的专注分布
          </p>
        </div>
      ) : (
        <div
          data-testid="focus-distribution-chart"
          className="focus-distribution-layout"
          style={{
            display: 'grid',
            gridTemplateColumns: '200px 1fr',
            gap: 'var(--space-xl)',
            alignItems: 'center',
          }}
        >
          {/* SVG Donut Chart */}
          <div style={{ justifySelf: 'center' }}>
            <svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="专注分布环形图">
              {/* Background ring */}
              <circle
                cx="100" cy="100" r={RADIUS}
                fill="none" stroke="var(--border-light)" strokeWidth="28" opacity="0.3"
              />

              {/* Segments */}
              {segments.map((seg, i) => (
                <circle
                  key={i}
                  cx="100" cy="100" r={RADIUS}
                  fill="none"
                  stroke={seg.displayColor}
                  strokeWidth="28"
                  strokeLinecap={segments.length === 1 ? 'round' : undefined}
                  strokeDasharray={`${seg.arcLength} ${CIRCUMFERENCE - seg.arcLength}`}
                  transform={`rotate(${seg.rotation} 100 100)`}
                  style={{ transition: 'stroke-dasharray 0.6s ease, transform 0.6s ease' }}
                />
              ))}

              {/* Center text */}
              <text x="100" y="92" textAnchor="middle" fill="var(--text-primary)" fontSize="22" fontWeight="700">
                {formatMinutes(totalMinutes)}
              </text>
              <text x="100" y="112" textAnchor="middle" fill="var(--text-muted)" fontSize="11">
                共 {totalSessions} 番茄
              </text>
            </svg>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {segments.map((seg, i) => (
              <div
                key={i}
                data-testid="focus-legend-item"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-tertiary)', fontSize: 14,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: seg.displayColor, flexShrink: 0,
                  }} />
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    {seg.subject_name}
                  </span>
                </span>
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  color: 'var(--text-muted)', fontSize: 13,
                }}>
                  <span>{formatMinutes(seg.total_minutes)}</span>
                  <span style={{ minWidth: 36, textAlign: 'right' }}>{Math.round(seg.percent)}%</span>
                  <span style={{ minWidth: 40, textAlign: 'right' }}>{seg.session_count} 🍅</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Responsive: stack vertically on narrow screens */}
      <style>{`
        @media (max-width: 640px) {
          .focus-distribution-layout {
            grid-template-columns: 1fr !important;
          }
          .focus-distribution-layout > div:first-child {
            justify-self: center;
          }
        }
      `}</style>
    </div>
  )
}
