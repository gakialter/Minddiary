import { useState } from 'react'
import { useTodayStats } from '../hooks/useTodayStats'
import { useDiary } from '../contexts/DiaryContext'
import { useDashboardMasterState } from '../hooks/useDashboardMasterState'
import { CommanderHero } from './dashboard/CommanderHero'
import { TrustMetric } from './dashboard/TrustMetric'
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react'

interface HomeDashboardProps {
  setActiveView: (view: string) => void
}

export default function HomeDashboard({ setActiveView }: HomeDashboardProps) {
  const { data, loading, error } = useTodayStats()
  const { settingsData } = useDiary()
  const [showDetails, setShowDetails] = useState(false)

  const config = useDashboardMasterState(data)

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <Loader2 size={32} className="animate-spin mb-4" style={{ color: 'var(--text-muted)' }} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }} data-testid="dashboard-loading">正在加载实时模型状态...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <p style={{ color: 'var(--danger)' }}>加载失败: {error}</p>
      </div>
    )
  }

  const { commanderMetrics } = data

  const handleCTA = () => {
    // Navigate based on the exact state logic Action intent
    if (config.type === 'A') setActiveView('mistakes') // Urgent -> review
    else if (config.type === 'B') setActiveView('pomodoro') // Steady -> focus
    else if (config.type === 'C') setActiveView('mistakes') // Digest needed -> review / edit
    else setActiveView('pomodoro') // Cold start -> focus to build up
  }

  // Calculate generic exam countdown to inject into details
  const examDateStr = settingsData?.examDate || ''
  let examDaysDiff: number | null = null
  if (examDateStr) {
    const target = new Date(examDateStr + 'T00:00:00')
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const diffTime = target.getTime() - now.getTime()
    if (diffTime >= 0) {
      examDaysDiff = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    }
  }

  return (
    <div className="w-full min-h-full bg-transparent overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="space-y-6">
          
          <CommanderHero config={config} onActionClick={handleCTA} />

          <section className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            <TrustMetric 
              value={commanderMetrics.riskPoolCount} 
              label="72 小时风险池" 
              hint={commanderMetrics.riskPoolCount > 0 ? `待处理 ${commanderMetrics.riskPoolCount} 个` : '当前无明显风险'}
              accent={commanderMetrics.riskPoolCount > 0 ? 'danger' : 'default'}
            />
            <TrustMetric 
              value={commanderMetrics.lockedKnowledgeGrowth > 0 ? `+${commanderMetrics.lockedKnowledgeGrowth}` : commanderMetrics.lockedKnowledgeGrowth} 
              label="稳定记忆净增" 
              hint="近 7 天口径"
              accent={commanderMetrics.lockedKnowledgeGrowth > 0 ? 'success' : 'default'}
            />
            <TrustMetric 
              value={`${commanderMetrics.focusConversionRate}%`} 
              label="有效专注转化率" 
              hint="专注时长与沉淀产出比"
              accent="default"
            />
          </section>

          <section className="max-w-3xl">
            <div className="flex items-center gap-3">
              <button 
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="inline-flex items-center gap-1.5 text-sm font-medium bg-transparent border-0 outline-none appearance-none transition-colors"
                data-testid="dashboard-details-toggle"
                style={{ color: 'var(--text-secondary)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--accent)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'}
              >
                {showDetails ? '收起系统依据' : '查看系统依据'}
                {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {!showDetails && <div className="h-px w-24" style={{ background: 'linear-gradient(to right, var(--border), transparent)' }} />}
            </div>
            
            {showDetails && (
              <div
                className="mt-4 rounded-2xl p-5 md:p-6 opacity-[0.98]"
                style={{
                  border: '1px solid var(--border)',
                  background: 'var(--bg-tertiary)',
                }}
              >
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>系统依据</h3>
                <p className="mt-3 text-sm leading-6 max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
                  系统当前连续诊断天数：<strong style={{ color: 'var(--text-primary)' }}>{data.streakDays} 天</strong>。<br/>
                  如果持续保持有效产出，您的专注转化率和长期稳定记忆净增量将会同步上涨。
                  我们不再关注单一番茄钟的绝对时长，而是专注衡量您实际「带走」了多少。
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    className="button"
                    style={{ height: 40, padding: '0 16px', borderRadius: 'var(--radius-sm)' }}
                    onClick={() => setActiveView('dashboard')}
                  >
                    打开全局图表与分析报表
                  </button>

                  {examDaysDiff !== null && (
                    <span className="text-sm sm:ml-auto" style={{ color: 'var(--text-secondary)' }}>
                      距目标 <strong style={{ color: 'var(--text-primary)', margin: '0 4px' }}>{examDaysDiff}</strong> 天
                    </span>
                  )}
                </div>
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  )
}
