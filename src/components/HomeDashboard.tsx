import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useTodayStats } from '../hooks/useTodayStats'
import { useDiary } from '../contexts/DiaryContext'
import { useDashboardMasterState } from '../hooks/useDashboardMasterState'
import { useCurrentLocalDateKey } from '../contexts/LocalDateContext'
import { CommanderHero } from './dashboard/CommanderHero'
import { TrustMetric } from './dashboard/TrustMetric'
import ReviewTaskPickerDialog from './ReviewTaskPickerDialog'
import TodayActionSuggestionDialog from './TodayActionSuggestionDialog'
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import type { NewStudyTask, StudyTask, StudyTaskType } from '../types'

interface HomeDashboardProps {
  setActiveView: (view: string) => void
  onMistakeFilterIntent?: (intent: 'due') => void
}

export default function HomeDashboard({ setActiveView, onMistakeFilterIntent }: HomeDashboardProps) {
  const { data, loading, error } = useTodayStats()
  const {
    settingsData,
    tasks: tasksAPI,
    mistakes: mistakesAPI,
    subjects: subjectsAPI,
    entries: entriesAPI,
    ai: aiAPI,
    requestDataRefresh,
    dataRefreshVersion = 0,
  } = useDiary()
  const [showDetails, setShowDetails] = useState(false)
  const [tasks, setTasks] = useState<StudyTask[]>([])
  const [taskError, setTaskError] = useState<string | null>(null)
  const [taskLoading, setTaskLoading] = useState(false)
  const [taskMutating, setTaskMutating] = useState(false)
  const taskMutationLockedRef = useRef(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskType, setNewTaskType] = useState<StudyTaskType>('custom')
  const [newTaskEstimate, setNewTaskEstimate] = useState(25)
  const [reviewPickerOpen, setReviewPickerOpen] = useState(false)
  const [aiSuggestionOpen, setAiSuggestionOpen] = useState(false)
  const todayDate = useCurrentLocalDateKey()

  const config = useDashboardMasterState(data)

  const loadTasks = useCallback(async () => {
    setTaskLoading(true)
    setTaskError(null)
    try {
      setTasks(await tasksAPI.getByDate(todayDate))
    } catch (taskLoadError) {
      setTaskError(taskLoadError instanceof Error ? taskLoadError.message : String(taskLoadError))
    } finally {
      setTaskLoading(false)
    }
  }, [tasksAPI, todayDate])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks, dataRefreshVersion])

  const persistTaskChange = async (operation: () => Promise<unknown>) => {
    if (taskMutationLockedRef.current) return false
    taskMutationLockedRef.current = true
    setTaskMutating(true)
    setTaskError(null)
    try {
      await operation()
      await loadTasks()
      requestDataRefresh()
      return true
    } catch (taskMutationError) {
      setTaskError(taskMutationError instanceof Error ? taskMutationError.message : String(taskMutationError))
      return false
    } finally {
      taskMutationLockedRef.current = false
      setTaskMutating(false)
    }
  }

  const createTask = async (task: NewStudyTask) => {
    return persistTaskChange(() => tasksAPI.create(task))
  }

  const hasActiveSuggestionTask = (items: StudyTask[], type: 'review' | 'diary') => (
    items.some(task => task.type === type && task.status !== 'skipped' && task.status !== 'done')
  )

  const createSuggestedTask = async (type: 'review' | 'diary', task: NewStudyTask) => {
    return persistTaskChange(async () => {
      const latestTasks = await tasksAPI.getByDate(todayDate)
      if (hasActiveSuggestionTask(latestTasks, type)) return
      await tasksAPI.create(task)
    })
  }

  const handleManualTaskSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = newTaskTitle.trim()
    if (!title) return
    const created = await createTask({
      title,
      type: newTaskType,
      planned_date: todayDate,
      estimate_minutes: Math.max(1, Math.round(newTaskEstimate || 25)),
      source: 'manual',
    })
    if (!created) return
    setNewTaskTitle('')
    setNewTaskType('custom')
    setNewTaskEstimate(25)
  }

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
  const taskFocus = data.taskFocusToday
  const hasDiaryTask = hasActiveSuggestionTask(tasks, 'diary')
  const taskStatusCounts = tasks.reduce<Record<StudyTask['status'], number>>((counts, task) => {
    counts[task.status] += 1
    return counts
  }, { todo: 0, doing: 0, done: 0, skipped: 0 })
  const plannedTaskMinutes = tasks
    .filter(task => task.status !== 'skipped')
    .reduce((total, task) => total + task.estimate_minutes, 0)

  const handleCTA = () => {
    // Navigate based on the exact state logic Action intent
    if (config.type === 'A') {
      onMistakeFilterIntent?.('due')
      setActiveView('mistakes') // Urgent -> review
    }
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

          <section
            data-testid="daily-action-queue"
            className="rounded-2xl p-5 md:p-6"
            style={{
              border: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
            }}
          >
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  今日行动队列
                </h2>
                <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  todo {taskStatusCounts.todo} · doing {taskStatusCounts.doing} · done {taskStatusCounts.done} · skipped {taskStatusCounts.skipped}
                </p>
              </div>
              {taskLoading && (
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>同步中...</span>
              )}
              <button
                type="button"
                className="button button-secondary"
                data-testid="open-ai-today-action-suggestions"
                disabled={taskMutating}
                onClick={() => setAiSuggestionOpen(true)}
                style={{ minHeight: 36, borderRadius: 'var(--radius-sm)' }}
              >
                AI 规划今日行动
              </button>
            </div>

            <form className="mt-4 grid gap-3 md:grid-cols-[1fr_150px_120px_auto]" onSubmit={handleManualTaskSubmit}>
              <input
                data-testid="task-title-input"
                value={newTaskTitle}
                onChange={event => setNewTaskTitle(event.target.value)}
                placeholder="添加一个今日任务"
                className="input"
                style={{ minHeight: 40 }}
              />
              <select
                data-testid="task-type-select"
                value={newTaskType}
                onChange={event => setNewTaskType(event.target.value as StudyTaskType)}
                className="input"
                style={{ minHeight: 40 }}
              >
                <option value="custom">custom</option>
                <option value="review">review</option>
                <option value="focus">focus</option>
                <option value="diary">diary</option>
                <option value="mistake">mistake</option>
              </select>
              <input
                data-testid="task-estimate-input"
                value={newTaskEstimate}
                onChange={event => setNewTaskEstimate(Number(event.target.value))}
                type="number"
                min={1}
                max={240}
                className="input"
                style={{ minHeight: 40 }}
                aria-label="预计分钟数"
              />
              <button
                data-testid="task-create-submit"
                className="button button-primary"
                type="submit"
                disabled={taskMutating || !newTaskTitle.trim()}
                style={{ minHeight: 40, borderRadius: 'var(--radius-sm)' }}
              >
                新增
              </button>
            </form>

            {commanderMetrics.riskPoolCount > 0 || (!data.todayEntry && !hasDiaryTask) ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {commanderMetrics.riskPoolCount > 0 && (
                  <button
                    data-testid="create-review-task-suggestion"
                    type="button"
                    className="button"
                    disabled={taskMutating}
                    style={{ height: 36, padding: '0 12px', borderRadius: 'var(--radius-sm)' }}
                    onClick={() => setReviewPickerOpen(true)}
                  >
                    生成今日错题复习任务
                  </button>
                )}
                {!data.todayEntry && !hasDiaryTask && (
                  <button
                    data-testid="create-diary-task-suggestion"
                    type="button"
                    className="button"
                    disabled={taskMutating}
                    style={{ height: 36, padding: '0 12px', borderRadius: 'var(--radius-sm)' }}
                    onClick={() => createSuggestedTask('diary', {
                      title: '写今日学习沉淀',
                      description: '记录今天的有效专注、错题收获和明日第一步。',
                      type: 'diary',
                      planned_date: todayDate,
                      estimate_minutes: 15,
                      source: 'dashboard',
                    })}
                  >
                    生成今日学习沉淀任务
                  </button>
                )}
              </div>
            ) : null}

            <div
              data-testid="task-focus-loop-metrics"
              className="mt-4 grid gap-3 md:grid-cols-5"
            >
              <div className="rounded-xl px-3 py-3" style={{ border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>计划预计</div>
                <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {plannedTaskMinutes}m / {taskFocus.focusedMinutes}m
                </div>
              </div>
              <div className="rounded-xl px-3 py-3" style={{ border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>任务完成率</div>
                <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {taskFocus.effectiveTaskCount > 0 ? `${taskFocus.completionRate}%` : '暂无任务'}
                </div>
              </div>
              <div className="rounded-xl px-3 py-3" style={{ border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>专注覆盖率</div>
                <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {taskFocus.effectiveTaskCount > 0 ? `${taskFocus.focusCoverageRate}%` : '暂无任务'}
                </div>
              </div>
              <div className="rounded-xl px-3 py-3" style={{ border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>任务专注</div>
                <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {taskFocus.focusedMinutes}m
                </div>
              </div>
              <div className="rounded-xl px-3 py-3" style={{ border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>未闭环提示</div>
                <div className="mt-1 text-sm font-medium" style={{ color: taskFocus.unclosedTaskTitles.length > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>
                  {taskFocus.effectiveTaskCount === 0
                    ? '添加任务后开始闭环'
                    : taskFocus.unclosedTaskTitles.length > 0
                      ? taskFocus.unclosedTaskTitles.join('、')
                      : '今日任务已闭环'}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {tasks.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  今天还没有行动任务，可以先添加一个最小可执行动作。
                </p>
              ) : tasks.map(task => (
                <div
                  key={task.id}
                  className="flex flex-col gap-3 rounded-xl px-4 py-3 md:flex-row md:items-center md:justify-between"
                  style={{
                    border: '1px solid var(--border)',
                    background: 'var(--bg-tertiary)',
                  }}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{task.title}</span>
                      <span
                        data-testid={`task-status-${task.id}`}
                        className="rounded-full px-2 py-0.5 text-xs"
                        style={{
                          border: '1px solid var(--border)',
                          color: 'var(--text-secondary)',
                          background: 'var(--bg-secondary)',
                        }}
                      >
                        {task.status}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {task.type} · {task.estimate_minutes}m
                      </span>
                      {task.source === 'ai' && (
                        <span className="rounded-full px-2 py-0.5 text-xs" style={{ color: 'var(--accent)', border: '1px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>
                          AI 建议
                        </span>
                      )}
                      {task.related_mistake_id !== null && (
                        <span className="rounded-full px-2 py-0.5 text-xs" style={{ color: 'var(--warning)', border: '1px solid color-mix(in srgb, var(--warning) 45%, transparent)', background: 'color-mix(in srgb, var(--warning) 8%, transparent)' }}>
                          关联错题 #{task.related_mistake_id}
                        </span>
                      )}
                      {task.related_entry_id !== null && (
                        <span className="rounded-full px-2 py-0.5 text-xs" style={{ color: 'var(--success)', border: '1px solid color-mix(in srgb, var(--success) 45%, transparent)', background: 'color-mix(in srgb, var(--success) 8%, transparent)' }}>
                          关联日记 #{task.related_entry_id}
                        </span>
                      )}
                      {task.related_chapter_id !== null && (
                        <span
                          className="rounded-full px-2 py-0.5 text-xs"
                          style={{ color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)', background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
                        >
                          章节任务
                        </span>
                      )}
                    </div>
                    {task.description && (
                      <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{task.description}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      data-testid={`task-complete-${task.id}`}
                      type="button"
                      className="button"
                      disabled={taskMutating || task.status === 'done'}
                      style={{ height: 34, padding: '0 10px', borderRadius: 'var(--radius-sm)' }}
                      onClick={() => persistTaskChange(() => tasksAPI.complete(task.id))}
                    >
                      完成
                    </button>
                    <button
                      data-testid={`task-skip-${task.id}`}
                      type="button"
                      className="button"
                      disabled={taskMutating || task.status === 'skipped'}
                      style={{ height: 34, padding: '0 10px', borderRadius: 'var(--radius-sm)' }}
                      onClick={() => persistTaskChange(() => tasksAPI.skip(task.id))}
                    >
                      跳过
                    </button>
                    <button
                      data-testid={`task-delete-${task.id}`}
                      type="button"
                      className="button"
                      disabled={taskMutating}
                      style={{ height: 34, padding: '0 10px', borderRadius: 'var(--radius-sm)' }}
                      onClick={() => persistTaskChange(() => tasksAPI.delete(task.id))}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {taskError && (
              <p className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>{taskError}</p>
            )}
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
                <p
                  className="mt-3 text-sm leading-6 max-w-2xl"
                  data-testid="dashboard-state-explanation"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {config.explanation}
                </p>
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
      {reviewPickerOpen && (
        <ReviewTaskPickerDialog
          date={todayDate}
          riskPoolCount={commanderMetrics.riskPoolCount}
          mistakesAPI={mistakesAPI}
          tasksAPI={tasksAPI}
          onClose={() => setReviewPickerOpen(false)}
          onCreated={async () => {
            await loadTasks()
            requestDataRefresh()
          }}
        />
      )}
      {aiSuggestionOpen && (
        <TodayActionSuggestionDialog
          date={todayDate}
          aiAPI={aiAPI}
          tasksAPI={tasksAPI}
          mistakesAPI={mistakesAPI}
          subjectsAPI={subjectsAPI}
          entriesAPI={entriesAPI}
          onClose={() => setAiSuggestionOpen(false)}
          onCreated={async () => {
            await loadTasks()
            requestDataRefresh()
          }}
        />
      )}
    </div>
  )
}
