import { useCallback, useEffect, useMemo, useState } from 'react'
import { getLocalDateKey, isDateKey } from '../utils/dateKey'
import {
  aggregatePomodoroStats,
  formatPomodoroMinutes,
  summarizePomodoroStats,
  type AggregatedPomodoroStat,
} from '../utils/pomodoroStats'
import { PieChart } from 'lucide-react'
import type { PomodoroContextAPI } from '../types/api'

type RangeKey = 'today' | 'week' | 'month' | 'single' | 'custom'

interface FocusDistributionChartProps {
  pomodoro: Pick<PomodoroContextAPI, 'getStatsRange'>
  dataRefreshVersion: number
}

interface SelectedDateRange {
  startDate: string
  endDate: string
}

interface ChartSegment extends AggregatedPomodoroStat {
  percent: number
  arcLength: number
  rotation: number
  displayColor: string
}

const RADIUS = 80
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const FALLBACK_COLOR = 'var(--border)'

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '近 7 天' },
  { key: 'month', label: '近 30 天' },
  { key: 'single', label: '单日' },
  { key: 'custom', label: '范围' },
]

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function generatePresetDateRange(rangeKey: Exclude<RangeKey, 'single' | 'custom'>): SelectedDateRange {
  const today = new Date()
  const todayKey = getLocalDateKey(today)
  if (rangeKey === 'today') return { startDate: todayKey, endDate: todayKey }

  const days = rangeKey === 'week' ? 7 : 30
  return {
    startDate: getLocalDateKey(addDays(today, -(days - 1))),
    endDate: todayKey,
  }
}

function getRangeValidationError(selection: RangeKey, singleDate: string, rangeStart: string, rangeEnd: string): string | null {
  if (selection === 'single') {
    return isDateKey(singleDate) ? null : '请选择有效日期'
  }

  if (selection !== 'custom') return null
  if (!isDateKey(rangeStart) || !isDateKey(rangeEnd)) return '请选择有效日期'
  if (rangeStart > rangeEnd) return '开始日期不能晚于结束日期'
  return null
}

export default function FocusDistributionChart({ pomodoro, dataRefreshVersion }: FocusDistributionChartProps) {
  const todayKey = getLocalDateKey()
  const defaultRangeStart = getLocalDateKey(addDays(new Date(), -6))
  const [rangeKey, setRangeKey] = useState<RangeKey>('today')
  const [singleDate, setSingleDate] = useState(todayKey)
  const [rangeStart, setRangeStart] = useState(defaultRangeStart)
  const [rangeEnd, setRangeEnd] = useState(todayKey)
  const [data, setData] = useState<AggregatedPomodoroStat[]>([])
  const [loading, setLoading] = useState(true)

  const validationError = useMemo(
    () => getRangeValidationError(rangeKey, singleDate, rangeStart, rangeEnd),
    [rangeKey, rangeEnd, rangeStart, singleDate],
  )

  const selectedRange = useMemo<SelectedDateRange | null>(() => {
    if (validationError) return null
    if (rangeKey === 'single') return { startDate: singleDate, endDate: singleDate }
    if (rangeKey === 'custom') return { startDate: rangeStart, endDate: rangeEnd }
    return generatePresetDateRange(rangeKey)
  }, [rangeKey, rangeStart, rangeEnd, singleDate, validationError])

  const loadData = useCallback(async (dateRange: SelectedDateRange | null) => {
    if (!dateRange) {
      setData([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const rangeStats = await pomodoro.getStatsRange(dateRange.startDate, dateRange.endDate)
      setData(aggregatePomodoroStats([rangeStats || []]))
    } catch {
      setData([])
    } finally {
      setLoading(false)
    }
  }, [pomodoro])

  useEffect(() => {
    if (validationError) {
      setData([])
      setLoading(false)
      return
    }
    const timeout = window.setTimeout(() => {
      void loadData(selectedRange)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [dataRefreshVersion, loadData, selectedRange, validationError])

  const summary = useMemo(() => summarizePomodoroStats(data), [data])

  const segments = useMemo<ChartSegment[]>(() => {
    if (summary.totalMinutes === 0) return []
    let cumPercent = 0
    return data.map((stat) => {
      const percent = (stat.total_minutes / summary.totalMinutes) * 100
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
  }, [data, summary.totalMinutes])

  const renderDateControls = () => {
    if (rangeKey === 'single') {
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
          日期
          <input
            className="input"
            data-testid="focus-single-date"
            type="date"
            value={singleDate}
            onChange={event => setSingleDate(event.target.value)}
            style={{ padding: '5px 10px', fontSize: 13 }}
          />
        </label>
      )
    }

    if (rangeKey !== 'custom') return null

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: 'var(--text-secondary)', fontSize: 13 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          开始
          <input
            className="input"
            data-testid="focus-range-start"
            type="date"
            value={rangeStart}
            onChange={event => setRangeStart(event.target.value)}
            style={{ padding: '5px 10px', fontSize: 13 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          结束
          <input
            className="input"
            data-testid="focus-range-end"
            type="date"
            value={rangeEnd}
            onChange={event => setRangeEnd(event.target.value)}
            style={{ padding: '5px 10px', fontSize: 13 }}
          />
        </label>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 'var(--space-xl)', marginTop: 'var(--space-xl)' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: 'var(--space-lg)', flexWrap: 'wrap', gap: 'var(--space-md)',
      }}>
        <div>
          <h3 className="font-semibold text-lg" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <PieChart size={18} style={{ color: 'var(--accent)' }} /> 专注分布
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            按科目汇总选定日期内的专注投入
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
          <div style={{
            display: 'flex', gap: 4, flexWrap: 'wrap',
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
          {renderDateControls()}
        </div>
      </div>

      {validationError && (
        <div
          data-testid="focus-range-error"
          className="text-sm"
          style={{
            color: 'var(--color-state-danger)',
            background: 'color-mix(in srgb, var(--color-state-danger) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-state-danger) 25%, transparent)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 12px',
            marginBottom: 'var(--space-lg)',
          }}
        >
          {validationError}
        </div>
      )}

      {!validationError && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 'var(--space-sm)',
          marginBottom: 'var(--space-xl)',
        }}>
          <div style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-tertiary)' }}>
            <div className="text-xs text-muted">总专注</div>
            <div className="font-semibold" style={{ color: 'var(--text-primary)', marginTop: 4 }}>
              总 {formatPomodoroMinutes(summary.totalMinutes)}
            </div>
          </div>
          <div style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-tertiary)' }}>
            <div className="text-xs text-muted">次数</div>
            <div className="font-semibold" style={{ color: 'var(--text-primary)', marginTop: 4 }}>
              共 {summary.totalSessions} 次
            </div>
          </div>
          <div style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-tertiary)' }}>
            <div className="text-xs text-muted">平均每次</div>
            <div className="font-semibold" style={{ color: 'var(--text-primary)', marginTop: 4 }}>
              约 {formatPomodoroMinutes(summary.averageMinutes)}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div data-testid="focus-distribution-loading" style={{
          textAlign: 'center', padding: 'var(--space-xl)',
          color: 'var(--text-muted)',
        }}>
          加载中...
        </div>
      ) : data.length === 0 || summary.totalMinutes === 0 ? (
        <div data-testid="focus-distribution-empty" style={{
          textAlign: 'center', padding: 'var(--space-2xl) var(--space-xl)',
        }}>
          <PieChart size={48} style={{ color: 'var(--text-muted)', opacity: 0.2, marginBottom: 'var(--space-md)' }} />
          <p style={{ color: 'var(--text-secondary)', marginBottom: 4, fontSize: 15 }}>
            选定时间范围内暂无专注记录
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            完成一次番茄或正计时后，这里会显示你的专注分布
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
          <div style={{ justifySelf: 'center' }}>
            <svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="专注分布环形图">
              <circle
                cx="100" cy="100" r={RADIUS}
                fill="none" stroke="var(--border-light)" strokeWidth="28" opacity="0.3"
              />

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

              <text x="100" y="92" textAnchor="middle" fill="var(--text-primary)" fontSize="22" fontWeight="700">
                {formatPomodoroMinutes(summary.totalMinutes)}
              </text>
              <text x="100" y="112" textAnchor="middle" fill="var(--text-muted)" fontSize="11">
                共 {summary.totalSessions} 番茄
              </text>
            </svg>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {segments.map((seg, i) => (
              <div
                key={i}
                data-testid="focus-legend-item"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-tertiary)', fontSize: 14,
                  gap: 'var(--space-sm)',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: seg.displayColor, flexShrink: 0,
                  }} />
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {seg.subject_name}
                  </span>
                </span>
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  color: 'var(--text-muted)', fontSize: 13, flexShrink: 0,
                }}>
                  <span>{formatPomodoroMinutes(seg.total_minutes)}</span>
                  <span style={{ minWidth: 36, textAlign: 'right' }}>{Math.round(seg.percent)}%</span>
                  <span style={{ minWidth: 40, textAlign: 'right' }}>{seg.session_count} 🍅</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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
