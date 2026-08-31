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
const FALLBACK_COLOR = 'var(--color-border-strong)'

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
        <label className="focus-distribution__date-control">
          日期
          <input
            className="input"
            data-testid="focus-single-date"
            type="date"
            value={singleDate}
            onChange={event => setSingleDate(event.target.value)}
          />
        </label>
      )
    }

    if (rangeKey !== 'custom') return null

    return (
      <div className="focus-distribution__date-range">
        <label className="focus-distribution__date-control">
          开始
          <input
            className="input"
            data-testid="focus-range-start"
            type="date"
            value={rangeStart}
            onChange={event => setRangeStart(event.target.value)}
          />
        </label>
        <label className="focus-distribution__date-control">
          结束
          <input
            className="input"
            data-testid="focus-range-end"
            type="date"
            value={rangeEnd}
            onChange={event => setRangeEnd(event.target.value)}
          />
        </label>
      </div>
    )
  }

  return (
    <section className="statistics-dashboard__section focus-distribution" aria-labelledby="focus-distribution-title">
      <div className="focus-distribution__header">
        <div>
          <span className="statistics-dashboard__section-kicker">科目证据</span>
          <h2 id="focus-distribution-title">
            <PieChart size={18} aria-hidden="true" />专注分布
          </h2>
          <p>
            按科目汇总选定日期内的专注投入
          </p>
        </div>

        <div className="focus-distribution__controls">
          <div className="focus-distribution__range-options" role="group" aria-label="专注分布时间范围">
            {RANGE_OPTIONS.map(opt => (
              <button
                type="button"
                key={opt.key}
                data-testid={`focus-range-${opt.key}`}
                aria-pressed={rangeKey === opt.key}
                onClick={() => setRangeKey(opt.key)}
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
          className="focus-distribution__validation"
          role="alert"
        >
          {validationError}
        </div>
      )}

      {!validationError && (
        <dl className="focus-distribution__summary" aria-label="所选范围专注摘要">
          <div>
            <dt>总专注</dt>
            <dd>总 {formatPomodoroMinutes(summary.totalMinutes)}</dd>
          </div>
          <div>
            <dt>次数</dt>
            <dd>共 {summary.totalSessions} 次</dd>
          </div>
          <div>
            <dt>平均每次</dt>
            <dd>约 {formatPomodoroMinutes(summary.averageMinutes)}</dd>
          </div>
        </dl>
      )}

      {loading ? (
        <div data-testid="focus-distribution-loading" className="focus-distribution__state" role="status">
          正在加载专注分布...
        </div>
      ) : data.length === 0 || summary.totalMinutes === 0 ? (
        <div data-testid="focus-distribution-empty" className="focus-distribution__state">
          <span className="focus-distribution__state-icon" aria-hidden="true"><PieChart size={22} /></span>
          <p>
            选定时间范围内暂无专注记录
          </p>
          <p>
            完成一次番茄或正计时后，这里会显示你的专注分布
          </p>
        </div>
      ) : (
        <div
          data-testid="focus-distribution-chart"
          className="focus-distribution__chart-layout"
        >
          <div className="focus-distribution__donut">
            <svg
              viewBox="0 0 200 200"
              width="200"
              height="200"
              role="img"
              aria-label={`专注分布环形图，总专注 ${formatPomodoroMinutes(summary.totalMinutes)}，共 ${summary.totalSessions} 次`}
              aria-describedby="focus-distribution-legend"
            >
              <circle
                cx="100" cy="100" r={RADIUS}
                fill="none" stroke="var(--color-surface-subtle)" strokeWidth="24"
              />

              {segments.map((seg, i) => (
                <circle
                  key={i}
                  cx="100" cy="100" r={RADIUS}
                  fill="none"
                  stroke={seg.displayColor}
                  strokeWidth="24"
                  strokeLinecap={segments.length === 1 ? 'round' : undefined}
                  strokeDasharray={`${seg.arcLength} ${CIRCUMFERENCE - seg.arcLength}`}
                  transform={`rotate(${seg.rotation} 100 100)`}
                />
              ))}

              <text x="100" y="92" textAnchor="middle" fill="var(--color-text-primary)" fontSize="20" fontWeight="600">
                {formatPomodoroMinutes(summary.totalMinutes)}
              </text>
              <text x="100" y="114" textAnchor="middle" fill="var(--color-text-muted)" fontSize="12">
                共 {summary.totalSessions} 番茄
              </text>
            </svg>
          </div>

          <div className="focus-distribution__legend-wrap">
            <div className="focus-distribution__legend-head" aria-hidden="true">
              <span>科目</span><span>时长</span><span>占比</span><span>次数</span>
            </div>
            <ul id="focus-distribution-legend" className="focus-distribution__legend">
            {segments.map((seg, i) => (
              <li
                key={i}
                data-testid="focus-legend-item"
              >
                <span className="focus-distribution__subject">
                  <span className="focus-distribution__swatch" style={{ background: seg.displayColor }} aria-hidden="true" />
                  <span>
                    {seg.subject_name}
                  </span>
                </span>
                <span>{formatPomodoroMinutes(seg.total_minutes)}</span>
                <span>{Math.round(seg.percent)}%</span>
                <span>{seg.session_count} 次</span>
              </li>
            ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
