import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useTodayStats } from '../hooks/useTodayStats'
import { useDiary } from '../contexts/DiaryContext'
import { useDashboardMasterState } from '../hooks/useDashboardMasterState'
import { useCurrentLocalDateKey } from '../contexts/LocalDateContext'
import { CommanderHero } from './dashboard/CommanderHero'
import { TrustMetric } from './dashboard/TrustMetric'
import DailyReviewAgentDialog from './DailyReviewAgentDialog'
import ReviewTaskPickerDialog from './ReviewTaskPickerDialog'
import TodayActionSuggestionDialog from './TodayActionSuggestionDialog'
import PlanningHistoryDialog from './PlanningHistoryDialog'
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { usePomodoroActions, usePomodoroData, usePomodoroTimer } from '../contexts/PomodoroContext'
import {
  buildTodayExecutionSummary,
  getNextTodayAction,
  resolveTaskSourceLabels,
} from '../utils/todayExecution'
import type { NewStudyTask, StudyTask, StudyTaskType, Subject, SubjectChapter } from '../types'
import { getPlanningRunsAPI } from '../utils/planningHistoryClient'

const TASK_ESTIMATE_MINUTES_MIN = 1
const TASK_ESTIMATE_MINUTES_MAX = 240

interface HomeDashboardProps {
  setActiveView: (view: string) => void
  setSelectedDate?: (date: string) => void
  onMistakeFilterIntent?: (intent: 'due') => void
}

export default function HomeDashboard({ setActiveView, setSelectedDate, onMistakeFilterIntent }: HomeDashboardProps) {
  const { data, error, resolvedDateKey, errorDateKey } = useTodayStats()
  const {
    settingsData,
    tasks: tasksAPI,
    mistakes: mistakesAPI,
    subjects: subjectsAPI,
    subjectChapters: subjectChaptersAPI,
    pomodoro: pomodoroAPI,
    entries: entriesAPI,
    ai: aiAPI,
    requestDataRefresh,
    dataRefreshVersion = 0,
  } = useDiary()
  const [showDetails, setShowDetails] = useState(false)
  const [tasks, setTasks] = useState<StudyTask[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [chaptersBySubject, setChaptersBySubject] = useState<Record<number, SubjectChapter[]>>({})
  const [taskSourcesAvailable, setTaskSourcesAvailable] = useState(false)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [taskLoading, setTaskLoading] = useState(true)
  const [taskMutating, setTaskMutating] = useState(false)
  const taskMutationLockedRef = useRef(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskType, setNewTaskType] = useState<StudyTaskType>('custom')
  const [newTaskEstimate, setNewTaskEstimate] = useState(25)
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null)
  const [editTaskTitle, setEditTaskTitle] = useState('')
  const [editTaskEstimate, setEditTaskEstimate] = useState('')
  const [reviewPickerOpen, setReviewPickerOpen] = useState(false)
  const [aiSuggestionOpen, setAiSuggestionOpen] = useState(false)
  const [dailyReviewAgentOpenDate, setDailyReviewAgentOpenDate] = useState<string | null>(null)
  const [planningHistoryOpen, setPlanningHistoryOpen] = useState(false)
  const todayDate = useCurrentLocalDateKey()
  const { hasActiveTimerSession } = usePomodoroTimer()
  const { selectedTask: activePomodoroTask } = usePomodoroData()
  const { selectFocusTask } = usePomodoroActions()

  const config = useDashboardMasterState(data)

  const loadTaskSources = useCallback(async (todayTasks: StudyTask[]) => {
    try {
      const nextSubjects = await subjectsAPI.getAll()
      const subjectIds = Array.from(new Set(
        todayTasks
          .filter(task => task.related_chapter_id !== null && task.subject_id !== null)
          .map(task => task.subject_id)
          .filter((subjectId): subjectId is number => subjectId !== null),
      ))
      const chapterEntries = await Promise.all(subjectIds.map(async subjectId => (
        [subjectId, await subjectChaptersAPI.getBySubject(subjectId)] as const
      )))

      setSubjects(nextSubjects)
      setChaptersBySubject(Object.fromEntries(chapterEntries))
      setTaskSourcesAvailable(true)
    } catch {
      setSubjects([])
      setChaptersBySubject({})
      setTaskSourcesAvailable(false)
    }
  }, [subjectChaptersAPI, subjectsAPI])

  const loadTasks = useCallback(async ({ throwOnError = false }: { throwOnError?: boolean } = {}) => {
    setTaskLoading(true)
    setTaskError(null)
    try {
      const todayTasks = await tasksAPI.getByDate(todayDate)
      setTasks(todayTasks)
      await loadTaskSources(todayTasks)
    } catch (taskLoadError) {
      const message = taskLoadError instanceof Error ? taskLoadError.message : String(taskLoadError)
      setTaskError(message)
      if (throwOnError) throw new Error(message)
    } finally {
      setTaskLoading(false)
    }
  }, [loadTaskSources, tasksAPI, todayDate])

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

  const openTaskEditor = (task: StudyTask) => {
    setEditingTaskId(task.id)
    setEditTaskTitle(task.title)
    setEditTaskEstimate(String(task.estimate_minutes))
    setTaskError(null)
  }

  const closeTaskEditor = () => {
    setEditingTaskId(null)
    setEditTaskTitle('')
    setEditTaskEstimate('')
    setTaskError(null)
  }

  const handleTaskEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (editingTaskId === null || taskMutationLockedRef.current) return

    const title = editTaskTitle.trim()
    if (!title) {
      setTaskError('任务标题不能为空。')
      return
    }
    if (title.length > 200) {
      setTaskError('任务标题不能超过 200 个字符。')
      return
    }

    let estimateMinutes: number
    const parsedEstimate = Number(editTaskEstimate)
    if (
      !Number.isInteger(parsedEstimate)
      || parsedEstimate < TASK_ESTIMATE_MINUTES_MIN
      || parsedEstimate > TASK_ESTIMATE_MINUTES_MAX
    ) {
      setTaskError(
        `预计分钟数必须是 ${TASK_ESTIMATE_MINUTES_MIN} 到 ${TASK_ESTIMATE_MINUTES_MAX} 的整数。`,
      )
      return
    }
    estimateMinutes = parsedEstimate

    taskMutationLockedRef.current = true
    setTaskMutating(true)
    setTaskError(null)
    try {
      const updated = await tasksAPI.update(editingTaskId, {
        title,
        estimate_minutes: estimateMinutes,
      })
      setTasks(current => current.map(task => task.id === updated.id ? updated : task))
      setEditingTaskId(null)
      setEditTaskTitle('')
      setEditTaskEstimate('')
      requestDataRefresh()
    } catch (taskUpdateError) {
      const message = taskUpdateError instanceof Error ? taskUpdateError.message : String(taskUpdateError)
      setTaskError(`保存任务修改失败：${message}`)
    } finally {
      taskMutationLockedRef.current = false
      setTaskMutating(false)
    }
  }

  const hasResolvedCurrentDashboardDate = resolvedDateKey === todayDate
  const hasCurrentDashboardError = errorDateKey === todayDate && Boolean(error)
  const shouldShowInitialLoading = !hasResolvedCurrentDashboardDate && !hasCurrentDashboardError
  const shouldShowInitialError = !hasResolvedCurrentDashboardDate && hasCurrentDashboardError
  const hasBackgroundDashboardError = hasResolvedCurrentDashboardDate && hasCurrentDashboardError

  if (shouldShowInitialLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <Loader2 size={32} className="animate-spin mb-4" style={{ color: 'var(--text-muted)' }} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }} data-testid="dashboard-loading">正在加载实时模型状态...</p>
      </div>
    )
  }

  if (shouldShowInitialError) {
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
  const executionSummary = buildTodayExecutionSummary({
    tasks,
    focusMinutes: data.pomodoroToday.totalMinutes,
    todayEntry: data.todayEntry,
  })
  const taskSourceLabels = taskSourcesAvailable
    ? resolveTaskSourceLabels({ tasks, subjects, chaptersBySubject })
    : {}
  const hasIncompleteChapters = subjects.some(subject => (
    (subject.total_chapters ?? 0) > (subject.completed_chapters ?? 0)
  ))
  const nextAction = getNextTodayAction({
    tasks,
    hasActivePomodoroSession: hasActiveTimerSession,
    activeTask: activePomodoroTask,
    hasIncompleteChapters,
    diaryStatus: executionSummary.diaryStatus,
  })
  const recommendedTaskSource = nextAction.task ? taskSourceLabels[nextAction.task.id] : undefined
  const diaryStatusLabel = executionSummary.diaryStatus === 'missing'
    ? '未写'
    : executionSummary.diaryStatus === 'draft'
      ? '已有草稿'
      : '已写'
  const reviewActionLabel = executionSummary.diaryStatus === 'missing'
    ? '写今日复盘'
    : executionSummary.diaryStatus === 'draft'
      ? '完善今日复盘'
      : '继续写今日复盘'

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

  const openTodayReview = () => {
    setSelectedDate?.(todayDate)
    setActiveView('editor')
  }

  const handleNextAction = () => {
    if (nextAction.kind === 'active-focus') {
      setActiveView('pomodoro')
      return
    }
    if (nextAction.kind === 'task' && nextAction.task) {
      selectFocusTask(nextAction.task.id)
      setActiveView('pomodoro')
      return
    }
    if (nextAction.kind === 'add-chapter') {
      setActiveView('progress')
      return
    }
    openTodayReview()
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
          {hasBackgroundDashboardError && (
            <p role="alert" data-testid="dashboard-background-refresh-error" className="rounded-lg px-4 py-3 text-sm" style={{ border: '1px solid var(--danger)', color: 'var(--danger)', background: 'var(--danger-bg, rgba(220, 38, 38, 0.1))' }}>
              实时模型刷新失败：{error}。当前仍显示上次成功加载的数据。
            </p>
          )}

          <section
            data-testid="today-execution-overview"
            className="rounded-2xl p-5 md:p-6"
            style={{ border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}
          >
            <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-medium" style={{ color: 'var(--accent)' }}>今日学习驾驶舱</p>
                <h2 className="mt-1 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>今日概览</h2>
              </div>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{todayDate}</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div data-testid="overview-tasks" className="rounded-xl px-4 py-3" style={{ background: 'var(--bg-tertiary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>今日任务</div>
                <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {executionSummary.completedTasks} / {executionSummary.totalTasks}
                </div>
                <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>已完成 / 总数</div>
              </div>
              <div data-testid="overview-focus" className="rounded-xl px-4 py-3" style={{ background: 'var(--bg-tertiary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>今日专注</div>
                <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {executionSummary.focusMinutes} 分钟
                </div>
                <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>全部专注会话</div>
              </div>
              <div data-testid="overview-chapters" className="rounded-xl px-4 py-3" style={{ background: 'var(--bg-tertiary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>章节推进</div>
                <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {executionSummary.completedChapterTaskCount} / {executionSummary.chapterTaskCount}
                </div>
                <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>已完成 / 今日章节</div>
              </div>
              <div data-testid="overview-diary" className="rounded-xl px-4 py-3" style={{ background: 'var(--bg-tertiary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>今日复盘</div>
                <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{diaryStatusLabel}</div>
                <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>按今日日记内容判断</div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
            <div
              data-testid="next-today-action"
              className="rounded-2xl p-5 md:p-6"
              style={{ border: '1px solid color-mix(in srgb, var(--accent) 45%, var(--border))', background: 'var(--bg-secondary)' }}
            >
              <div className="text-xs font-medium" style={{ color: 'var(--accent)' }}>推荐下一步</div>
              <h2 className="mt-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{nextAction.title}</h2>
              <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{nextAction.reason}</p>
              {nextAction.task && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>{nextAction.task.status} · 预计 {nextAction.task.estimate_minutes} 分钟</span>
                  <span data-testid="next-action-source">
                    来源：{recommendedTaskSource?.label ?? '今日任务'}
                  </span>
                </div>
              )}
              <button
                type="button"
                data-testid="next-today-action-cta"
                className="button button-primary mt-4"
                disabled={taskLoading || Boolean(taskError)}
                onClick={handleNextAction}
                style={{ minHeight: 40, borderRadius: 'var(--radius-sm)' }}
              >
                {nextAction.actionLabel}
              </button>
            </div>

            <div
              data-testid="today-review-entry"
              className="rounded-2xl p-5 md:p-6"
              style={{ border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}
            >
              <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>今日复盘</div>
              <h2 className="mt-2 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{reviewActionLabel}</h2>
              <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                回到今天的日记，记录收获、问题和明日第一步。
              </p>
              <button
                type="button"
                data-testid="today-review-cta"
                className="button button-secondary mt-4"
                onClick={openTodayReview}
                style={{ minHeight: 40, borderRadius: 'var(--radius-sm)' }}
              >
                {reviewActionLabel}
              </button>
            </div>
          </section>

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
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setPlanningHistoryOpen(true)}
                  style={{ minHeight: 36, borderRadius: 'var(--radius-sm)' }}
                >
                  最近 AI 规划
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  data-testid="open-daily-review-agent"
                  disabled={taskMutating}
                  onClick={() => setDailyReviewAgentOpenDate(todayDate)}
                  style={{ minHeight: 36, borderRadius: 'var(--radius-sm)' }}
                >
                  每日复盘
                </button>
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
                  className="min-w-0 rounded-xl px-4 py-3"
                  style={{
                    border: '1px solid var(--border)',
                    background: 'var(--bg-tertiary)',
                  }}
                >
                  {editingTaskId === task.id ? (
                    <form className="min-w-0 space-y-3" noValidate onSubmit={handleTaskEditSubmit}>
                      <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
                        <label className="min-w-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          任务标题
                          <input
                            data-testid={`task-edit-title-${task.id}`}
                            className="input mt-1 w-full min-w-0"
                            value={editTaskTitle}
                            maxLength={200}
                            disabled={taskMutating}
                            onChange={event => setEditTaskTitle(event.target.value)}
                          />
                        </label>
                        <label className="min-w-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          预计分钟数
                          <input
                            data-testid={`task-edit-estimate-${task.id}`}
                            className="input mt-1 w-full min-w-0"
                            type="number"
                            min={TASK_ESTIMATE_MINUTES_MIN}
                            max={TASK_ESTIMATE_MINUTES_MAX}
                            step={1}
                            value={editTaskEstimate}
                            disabled={taskMutating}
                            onChange={event => setEditTaskEstimate(event.target.value)}
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className="button"
                          data-testid={`task-edit-cancel-${task.id}`}
                          disabled={taskMutating}
                          onClick={closeTaskEditor}
                          style={{ height: 34, padding: '0 10px', borderRadius: 'var(--radius-sm)' }}
                        >
                          取消
                        </button>
                        <button
                          type="submit"
                          className="button button-primary"
                          data-testid={`task-edit-save-${task.id}`}
                          disabled={taskMutating}
                          style={{ height: 34, padding: '0 10px', borderRadius: 'var(--radius-sm)' }}
                        >
                          {taskMutating ? '保存中...' : '保存'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 max-w-full break-words font-medium" style={{ color: 'var(--text-primary)' }}>{task.title}</span>
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
                            <>
                              <span
                                className="rounded-full px-2 py-0.5 text-xs"
                                style={{ color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)', background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
                              >
                                章节任务
                              </span>
                              {taskSourceLabels[task.id] && (
                                <span
                                  data-testid={`task-source-${task.id}`}
                                  className="text-xs"
                                  style={{ color: taskSourceLabels[task.id]?.missingChapter ? 'var(--warning)' : 'var(--text-secondary)' }}
                                >
                                  {taskSourceLabels[task.id]?.label}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                        {task.description && (
                          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{task.description}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          data-testid={`task-edit-${task.id}`}
                          type="button"
                          className="button"
                          disabled={taskMutating}
                          style={{ height: 34, padding: '0 10px', borderRadius: 'var(--radius-sm)' }}
                          onClick={() => openTaskEditor(task)}
                        >
                          修改
                        </button>
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
                  )}
                </div>
              ))}
            </div>

            {taskError && (
              <p role="alert" data-testid="task-error" className="mt-3 break-words text-sm" style={{ color: 'var(--danger)' }}>{taskError}</p>
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
      {dailyReviewAgentOpenDate === todayDate && (
        <DailyReviewAgentDialog
          date={todayDate}
          aiAPI={aiAPI}
          tasksAPI={tasksAPI}
          mistakesAPI={mistakesAPI}
          subjectsAPI={subjectsAPI}
          entriesAPI={entriesAPI}
          pomodoroAPI={pomodoroAPI}
          onClose={() => setDailyReviewAgentOpenDate(null)}
          onCreated={async () => {
            await loadTasks({ throwOnError: true })
            requestDataRefresh()
          }}
        />
      )}
      {planningHistoryOpen && (
        <PlanningHistoryDialog
          planningRunsAPI={getPlanningRunsAPI()}
          onClose={() => setPlanningHistoryOpen(false)}
        />
      )}
    </div>
  )
}
