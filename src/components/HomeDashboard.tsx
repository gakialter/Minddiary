import { useMemo } from 'react'
import { useTodayStats } from '../hooks/useTodayStats'
import { useDiary } from '../contexts/DiaryContext'
import { Sparkles, Timer, PenLine, BookX, Flame, TrendingUp, Target, BarChart2, Loader2 } from 'lucide-react'
import './HomeDashboard.css'

const DAILY_QUOTES = [
  '每一次努力都在为未来铺路，今天的你比昨天更强大。',
  '考研不是终点，是新起点。保持热爱，奔赴山海。',
  '别怕慢，就怕站。只要在前进，就值得骄傲。',
  '星光不问赶路人，时光不负有心人。',
  '将来的你，一定会感谢现在拼命的自己。',
  '做你想做的，趁阳光正好，趁微风不噪。',
  '乾坤未定，你我皆是黑马。',
  '坚持就是胜利，不要在最接近成功的时候放弃。',
  '山顶的风景永远比半山腰的更美。',
  '那些让你熬夜的奋斗，终将成为照亮前路的星光。',
  '不要让今天的懈怠成为明天的遗憾。',
  '每一次翻开书本，都是一次灵魂的共鸣。',
  '只要心有所向，所向皆是未来。',
  '学习不是为了改变世界，而是为了不让世界改变自己。',
  '与其在犹豫中徘徊，不如在行动中找寻答案。',
  '只有经历过地狱般的折磨，才有征服天堂的力量。',
  '流过泪的眼睛更明亮，滴过血的心灵更坚强。',
  '通往成功的路总是在施工中，记得带上你的安全帽。',
  '生活不会辜负每一个努力攀登的人。',
  '今天的每一滴汗水，都会成为明天骄傲的资本。',
  '与其羡慕别人，不如自己发光。',
  '与其抱怨黑暗，不如提灯前行。',
  '勇敢不是不害怕，而是带着恐惧继续前行。',
  '只有不断地学习，才能永远保持年轻。',
  '梦想不是挂在嘴边的口号，而是握在手里的行动。',
  '不经一番寒彻骨，怎得梅花扑鼻香。',
  '与其仰望星空，不如自己成为发光的星。',
  '生活就像一面镜子，你微笑，它也微笑。',
  '没有比脚更长的路，没有比人更高的山。',
  '向着月亮出发，即使不能到达，也能站在群星之中。',
]

interface HomeDashboardProps {
  setActiveView: (view: string) => void
}

export default function HomeDashboard({ setActiveView }: HomeDashboardProps) {
  const { data, loading, error } = useTodayStats()
  const { settingsData } = useDiary()

  // Calculate deterministic daily quote — memoized to avoid creating Date objects on every render
  const quote = useMemo(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), 0, 0)
    const diff = (now.getTime() - start.getTime()) + ((start.getTimezoneOffset() - now.getTimezoneOffset()) * 60 * 1000)
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24))
    return DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length]
  }, []) // Stable for the entire session (same day)

  if (loading) {
    return (
      <div className="bento-container" style={{ alignItems: 'center', justifyItems: 'center', display: 'flex', flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', marginTop: '10%' }}>
            <Loader2 size={32} className="animate-spin text-accent" style={{ animation: 'spin 1s linear infinite' }} />
            <p className="text-secondary" style={{ color: 'var(--text-secondary)' }}>加载今日看板...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bento-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--error)' }}>加载失败: {error}</p>
      </div>
    )
  }

  // Calculate exam countdown
  const examDateStr = settingsData?.examDate || ''
  let examDaysDiff: number | null = null
  if (examDateStr) {
    const target = new Date(examDateStr + 'T00:00:00') // Append time for timezone safety
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const diffTime = target.getTime() - now.getTime()
    if (diffTime >= 0) {
      examDaysDiff = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    }
  }

  const { pomodoroToday, todayEntry, dueReviewCount, mistakeOverview, streakDays, weeklyTrend } = data

  return (
    <div className="bento-container">
      <div className="bento-header">
        <h1>今日看板</h1>
        <p>让每一天的数据都成为进步的阶梯</p>
      </div>

      <div className="bento-grid">
        {/* Quote */}
        <div className="bento-card bento-card--full" style={{ background: 'linear-gradient(135deg, var(--bg-secondary), var(--bg-tertiary))' }}>
          <div className="bento-card-header" style={{ color: 'var(--accent)' }}>
            <Sparkles size={18} />
            <span>每日寄语</span>
          </div>
          <div className="bento-quote">"{quote}"</div>
        </div>

        {/* Focus */}
        <div className="bento-card">
          <div className="bento-card-header">
            <Timer size={18} style={{ color: 'var(--success)' }} />
            <span>今日专注</span>
          </div>
          <div className="bento-card-value">{Math.round(pomodoroToday?.totalMinutes || 0)} <span style={{ fontSize: '16px', fontWeight: 500 }}>分钟</span></div>
          <div className="bento-card-label">完成了 {pomodoroToday?.sessionCount || 0} 个番茄钟</div>
        </div>

        {/* Diary */}
        <div className="bento-card">
          <div className="bento-card-header">
            <PenLine size={18} style={{ color: 'var(--accent)' }}/>
            <span>日记状态</span>
          </div>
          {todayEntry ? (
             <>
               <div className="bento-card-value text-success" style={{ color: 'var(--success)' }}>已写</div>
               <div className="bento-card-label">共 {todayEntry.wordCount} 字</div>
             </>
          ) : (
             <>
               <div className="bento-card-value" style={{ color: 'var(--text-secondary)' }}>待完成</div>
               <div className="bento-card-label">今天还没写日记</div>
             </>
          )}
        </div>

        {/* Mistakes */}
        <div className="bento-card">
          <div className="bento-card-header">
            <BookX size={18} style={{ color: dueReviewCount > 0 ? 'var(--warning)' : 'var(--success)' }}/>
            <span>错题欠债</span>
          </div>
          {dueReviewCount > 0 ? (
            <>
              <div className="bento-card-value text-warning" style={{ color: 'var(--warning)' }}>{dueReviewCount} <span style={{ fontSize: '16px', fontWeight: 500 }}>题</span></div>
              <div className="bento-card-label">待复习，已掌握 {mistakeOverview?.mastered || 0}/{mistakeOverview?.total || 0}</div>
            </>
          ) : (
            <>
              <div className="bento-card-value text-success" style={{ color: 'var(--success)' }}>清零</div>
              <div className="bento-card-label">太棒了，今日无欠债 ({mistakeOverview?.mastered || 0}/{mistakeOverview?.total || 0})</div>
            </>
          )}
        </div>

        {/* Streak */}
        <div className="bento-card bento-card--wide">
          <div className="bento-card-header">
            <Flame size={18} style={{ color: 'var(--error)' }}/>
            <span>连续学习</span>
          </div>
          <div className="bento-card-value" style={{ color: 'var(--error)' }}>{streakDays} <span style={{ fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)' }}>天</span></div>
          <div className="bento-card-label">保持节奏，继续加油！</div>
        </div>

        {/* Trend */}
        <div className="bento-card">
          <div className="bento-card-header">
            <TrendingUp size={18} style={{ color: 'var(--accent)' }}/>
            <span>近7日势态</span>
          </div>
          <div className="bento-trend-chart">
            {weeklyTrend && weeklyTrend.length > 0 ? (
              (() => {
                const maxMinutes = Math.max(...weeklyTrend.map(x => x.totalMinutes), 60)
                return weeklyTrend.map((t, idx) => {
                  const heightPct = Math.max(5, (t.totalMinutes / maxMinutes) * 100)
                  return (
                    <div key={idx} className="bento-trend-bar" style={{ height: `${heightPct}%` }} title={`${t.date}: ${t.totalMinutes} 分钟`} />
                  )
                })
              })()
            ) : (
              <div style={{ fontSize: '12px', width: '100%', textAlign: 'center', color: 'var(--text-muted)' }}>暂无数据</div>
            )}
          </div>
        </div>
        
        {/* Exam */}
        {examDateStr && examDaysDiff !== null && (
          <div className="bento-card bento-card--full" style={{ alignItems: 'center' }}>
            <div className="bento-card-header" style={{ justifyContent: 'center' }}>
              <Target size={18} style={{ color: 'var(--error)' }}/>
              <span style={{ fontSize: '16px' }}>距离考研还有</span>
            </div>
            <div className="exam-days">{examDaysDiff} <span style={{ fontSize: '24px', fontWeight: 600 }}>天</span></div>
            <div className="bento-card-label">目标日期：{examDateStr}</div>
          </div>
        )}

      </div>
      
      {/* Quick Links */}
      <h3 style={{ fontSize: '16px', marginBottom: 'var(--space-md)', color: 'var(--text-primary)' }}>快捷入口</h3>
      <div className="bento-quick-links">
        <button className="bento-btn" onClick={() => setActiveView('pomodoro')}><Timer size={18} /> 开始专注</button>
        <button className="bento-btn" onClick={() => setActiveView('editor')}><PenLine size={18} /> 写日记</button>
        <button className="bento-btn" onClick={() => setActiveView('mistakes')}><BookX size={18} /> 复习错题</button>
        <button className="bento-btn" onClick={() => setActiveView('dashboard')}><BarChart2 size={18} /> 查看统计</button>
      </div>

    </div>
  )
}
