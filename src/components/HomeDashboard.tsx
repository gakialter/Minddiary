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
        <Loader2 size={32} className="animate-spin text-gray-400 mb-4" />
        <p className="text-gray-500 text-sm">正在加载实时模型状态...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <p className="text-rose-500">加载失败: {error}</p>
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
    <div className="flex flex-col p-10 md:p-16 w-full h-full overflow-y-auto bg-white dark:bg-[#0a0a0a]">
      
      {/* 1 & 2: Main Commander Conclusion & Action */}
      <CommanderHero config={config} onActionClick={handleCTA} />

      {/* 3: Core Trust Metrics (B-Style High Contrast) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-14 mt-4 mb-20 border-t border-gray-100 dark:border-gray-800/80 pt-12">
        <TrustMetric 
          value={commanderMetrics.riskPoolCount} 
          label="72 小时内高遗忘风险" 
          color={commanderMetrics.riskPoolCount >= 5 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-900 dark:text-gray-100'}
        />
        <TrustMetric 
          value={commanderMetrics.lockedKnowledgeGrowth} 
          label="近 7 日稳定记忆净增" 
          trend="系统评分达标的无遗忘题目"
        />
        <TrustMetric 
          value={`${commanderMetrics.focusConversionRate}%`} 
          label="有效专注转化率" 
          color={commanderMetrics.focusConversionRate < 50 && data.pomodoroToday.sessionCount >= 2 ? 'text-amber-500' : 'text-gray-900 dark:text-gray-100'}
        />
      </div>

      {/* 4: Expansion Layer / Fold Details */}
      <div className="mt-auto max-w-4xl">
        <button 
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-2 text-[14px] font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors py-2 px-4 -ml-4 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-900"
        >
          {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {showDetails ? '收起系统依据' : '展开系统推断依据'}
        </button>
        
        {showDetails && (
          <div className="mt-8 pt-8 border-t border-gray-100 dark:border-gray-800/80 opacity-[0.85] hover:opacity-100 transition-opacity">
            <h3 className="text-lg font-bold mb-2 text-gray-900 dark:text-white tracking-tight">模型底层依据</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed max-w-2xl">
              系统当前连续诊断天数：<strong className="text-gray-800 dark:text-gray-200">{data.streakDays} 天</strong>。<br/>
              如果持续保持有效产出，您的专注转化率和长期稳定记忆净增量将会同步上涨。
              我们不再关注单一番茄钟的绝对时长，而是专注衡量您实际「带走」了多少。
            </p>
            
            <div className="flex flex-wrap items-center gap-4">
              <button 
                className="px-5 py-2.5 bg-gray-100 dark:bg-gray-800/60 hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-800 dark:text-white rounded-xl text-sm font-medium transition-colors" 
                onClick={() => setActiveView('dashboard')}
              >
                打开全局图表与分析报表
              </button>
              
              {examDaysDiff !== null && (
                <div className="ml-auto text-sm text-gray-400">
                  距目标 <span className="font-bold text-gray-900 dark:text-white mx-1">{examDaysDiff}</span> 天
                </div>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
