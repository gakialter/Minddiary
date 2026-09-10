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
      <div className="today-action-state" role="status" aria-live="polite">
        <Loader2 size={28} className="animate-spin" aria-hidden="true" />
        <p data-testid="dashboard-loading">正在加载实时模型状态...</p>
      </div>
    )
  }

  if (shouldShowInitialError) {
    return (
      <div className="today-action-state today-action-state--error" role="alert">
        <p>加载失败: {error}</p>
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
    <div className="today-action">
      <div className="today-action__frame">
        <div className="today-action__content">
          {hasBackgroundDashboardError && (
            <p
              role="alert"
              data-testid="dashboard-background-refresh-error"
              className="today-action__notice today-action__notice--danger"
            >
              实时模型刷新失败：{error}。当前仍显示上次成功加载的数据。
            </p>
          )}

          <CommanderHero config={config} onActionClick={handleCTA} />

          <section
            data-testid="next-today-action"
            className="today-action__next"
            aria-labelledby="today-action-next-title"
          >
            <div className="today-action__next-copy">
              <p className="today-action__eyebrow">推荐下一步</p>
              <h2 id="today-action-next-title">{nextAction.title}</h2>
              <p id="today-action-next-reason" className="today-action__next-reason">{nextAction.reason}</p>
              {nextAction.task && (
                <div className="today-action__next-meta">
                  <span>{nextAction.task.status} · 预计 {nextAction.task.estimate_minutes} 分钟</span>
                  <span data-testid="next-action-source">
                    来源：{recommendedTaskSource?.label ?? '今日任务'}
                  </span>
                </div>
              )}
            </div>
            <button
              type="button"
              data-testid="next-today-action-cta"
              className="button button-primary today-action__next-action"
              disabled={taskLoading || Boolean(taskError)}
              onClick={handleNextAction}
              aria-describedby="today-action-next-reason"
            >
              {nextAction.actionLabel}
            </button>
          </section>

          <section
            data-testid="today-execution-overview"
            className="today-action__overview"
            aria-labelledby="today-action-overview-title"
          >
            <div className="today-action__section-heading today-action__section-heading--compact">
              <div>
                <p className="today-action__eyebrow">今日学习状态</p>
                <h2 id="today-action-overview-title">今日概览</h2>
              </div>
              <time className="today-action__date" dateTime={todayDate}>{todayDate}</time>
            </div>
            <dl className="today-action__overview-grid">
              <div data-testid="overview-tasks" className="today-action__overview-item">
                <dt>今日任务</dt>
                <dd>
                  <strong>{executionSummary.completedTasks} / {executionSummary.totalTasks}</strong>
                  <span>已完成 / 总数</span>
                </dd>
              </div>
              <div data-testid="overview-focus" className="today-action__overview-item">
                <dt>今日专注</dt>
                <dd>
                  <strong>{executionSummary.focusMinutes} 分钟</strong>
                  <span>全部专注会话</span>
                </dd>
              </div>
              <div data-testid="overview-chapters" className="today-action__overview-item">
                <dt>章节推进</dt>
                <dd>
                  <strong>{executionSummary.completedChapterTaskCount} / {executionSummary.chapterTaskCount}</strong>
                  <span>已完成 / 今日章节</span>
                </dd>
              </div>
              <div data-testid="overview-diary" className="today-action__overview-item">
                <dt>今日复盘</dt>
                <dd>
                  <strong>{diaryStatusLabel}</strong>
                  <span>按今日日记内容判断</span>
                </dd>
              </div>
            </dl>
          </section>

          <section
            data-testid="daily-action-queue"
            className="today-action__queue"
            aria-labelledby="today-action-queue-title"
            aria-busy={taskLoading || taskMutating}
          >
            <div className="today-action__section-heading">
              <div>
                <p className="today-action__eyebrow">当前执行</p>
                <h2 id="today-action-queue-title">
                  今日行动队列
                </h2>
                <p className="today-action__queue-summary">
                  todo {taskStatusCounts.todo} · doing {taskStatusCounts.doing} · done {taskStatusCounts.done} · skipped {taskStatusCounts.skipped}
                </p>
              </div>
              {(taskLoading || taskMutating) && (
                <span className="today-action__sync-status" role="status" aria-live="polite">
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  {taskMutating ? '正在更新任务...' : '同步中...'}
                </span>
              )}
            </div>

            <form className="today-action__task-create" aria-label="添加今日任务" onSubmit={handleManualTaskSubmit}>
              <label className="today-action__field today-action__field--title" htmlFor="today-task-title">
                <span>任务标题</span>
                <input
                  id="today-task-title"
                  data-testid="task-title-input"
                  value={newTaskTitle}
                  onChange={event => setNewTaskTitle(event.target.value)}
                  placeholder="添加一个今日任务"
                  className="input"
                />
              </label>
              <label className="today-action__field" htmlFor="today-task-type">
                <span>任务类型</span>
                <select
                  id="today-task-type"
                  data-testid="task-type-select"
                  value={newTaskType}
                  onChange={event => setNewTaskType(event.target.value as StudyTaskType)}
                  className="input"
                >
                  <option value="custom">custom</option>
                  <option value="review">review</option>
                  <option value="focus">focus</option>
                  <option value="diary">diary</option>
                  <option value="mistake">mistake</option>
                </select>
              </label>
              <label className="today-action__field" htmlFor="today-task-estimate">
                <span>预计分钟数</span>
                <input
                  id="today-task-estimate"
                  data-testid="task-estimate-input"
                  value={newTaskEstimate}
                  onChange={event => setNewTaskEstimate(Number(event.target.value))}
                  type="number"
                  min={1}
                  max={240}
                  className="input"
                />
              </label>
              <button
                data-testid="task-create-submit"
                className="button today-action__task-create-submit"
                type="submit"
                disabled={taskMutating || !newTaskTitle.trim()}
              >
                新增
              </button>
            </form>

            {commanderMetrics.riskPoolCount > 0 || (!data.todayEntry && !hasDiaryTask) ? (
              <div className="today-action__task-suggestions" role="group" aria-label="任务补全建议">
                <span className="today-action__task-suggestions-label">可选补全</span>
                {commanderMetrics.riskPoolCount > 0 && (
                  <button
                    data-testid="create-review-task-suggestion"
                    type="button"
                    className="button today-action__quiet-action"
                    disabled={taskMutating}
                    onClick={() => setReviewPickerOpen(true)}
                  >
                    生成今日错题复习任务
                  </button>
                )}
                {!data.todayEntry && !hasDiaryTask && (
                  <button
                    data-testid="create-diary-task-suggestion"
                    type="button"
                    className="button today-action__quiet-action"
                    disabled={taskMutating}
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

            <div className="today-action__task-list">
              {tasks.length === 0 ? (
                <p className="today-action__empty-queue" role="status">
                  今天还没有行动任务，可以先添加一个最小可执行动作。
                </p>
              ) : tasks.map(task => (
                <div
                  key={task.id}
                  className="today-action__task-row"
                  data-status={task.status}
                >
                  {editingTaskId === task.id ? (
                    <form className="today-action__task-edit" noValidate onSubmit={handleTaskEditSubmit}>
                      <div className="today-action__task-edit-fields">
                        <label className="today-action__field">
                          <span>任务标题</span>
                          <input
                            data-testid={`task-edit-title-${task.id}`}
                            className="input"
                            value={editTaskTitle}
                            maxLength={200}
                            disabled={taskMutating}
                            onChange={event => setEditTaskTitle(event.target.value)}
                          />
                        </label>
                        <label className="today-action__field">
                          <span>预计分钟数</span>
                          <input
                            data-testid={`task-edit-estimate-${task.id}`}
                            className="input"
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
                      <div className="today-action__task-edit-actions">
                        <button
                          type="button"
                          className="button today-action__task-action"
                          data-testid={`task-edit-cancel-${task.id}`}
                          disabled={taskMutating}
                          onClick={closeTaskEditor}
                        >
                          取消
                        </button>
                        <button
                          type="submit"
                          className="button button-primary today-action__task-action"
                          data-testid={`task-edit-save-${task.id}`}
                          disabled={taskMutating}
                        >
                          {taskMutating ? '保存中...' : '保存'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="today-action__task-layout">
                      <div className="today-action__task-copy">
                        <div className="today-action__task-title-line">
                          <span className="today-action__task-title">{task.title}</span>
                          <span
                            data-testid={`task-status-${task.id}`}
                            className="today-action__task-status"
                            data-status={task.status}
                          >
                            {task.status}
                          </span>
                          <span className="today-action__task-meta">
                            {task.type} · {task.estimate_minutes}m
                          </span>
                          {task.source === 'ai' && (
                            <span className="today-action__task-tag today-action__task-tag--ai">
                              AI 建议
                            </span>
                          )}
                          {task.related_mistake_id !== null && (
                            <span className="today-action__task-tag today-action__task-tag--warning">
                              关联错题 #{task.related_mistake_id}
                            </span>
                          )}
                          {task.related_entry_id !== null && (
                            <span className="today-action__task-tag today-action__task-tag--success">
                              关联日记 #{task.related_entry_id}
                            </span>
                          )}
                          {task.related_chapter_id !== null && (
                            <>
                              <span className="today-action__task-tag today-action__task-tag--chapter">
                                章节任务
                              </span>
                              {taskSourceLabels[task.id] && (
                                <span
                                  data-testid={`task-source-${task.id}`}
                                  className="today-action__task-source"
                                  data-missing={taskSourceLabels[task.id]?.missingChapter ? 'true' : 'false'}
                                >
                                  {taskSourceLabels[task.id]?.label}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                        {task.description && (
                          <p className="today-action__task-description">{task.description}</p>
                        )}
                      </div>
                      <div className="today-action__task-actions" role="group" aria-label={`${task.title} 的操作`}>
                        <button
                          data-testid={`task-edit-${task.id}`}
                          type="button"
                          className="button today-action__task-action"
                          disabled={taskMutating}
                          onClick={() => openTaskEditor(task)}
                        >
                          修改
                        </button>
                        <button
                          data-testid={`task-complete-${task.id}`}
                          type="button"
                          className="button today-action__task-action today-action__task-action--complete"
                          disabled={taskMutating || task.status === 'done'}
                          onClick={() => persistTaskChange(() => tasksAPI.complete(task.id))}
                        >
                          完成
                        </button>
                        <button
                          data-testid={`task-skip-${task.id}`}
                          type="button"
                          className="button today-action__task-action"
                          disabled={taskMutating || task.status === 'skipped'}
                          onClick={() => persistTaskChange(() => tasksAPI.skip(task.id))}
                        >
                          跳过
                        </button>
                        <button
                          data-testid={`task-delete-${task.id}`}
                          type="button"
                          className="button today-action__task-action today-action__task-action--danger"
                          disabled={taskMutating}
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
              <p role="alert" id="today-action-task-error" data-testid="task-error" className="today-action__notice today-action__notice--danger">
                {taskError}
              </p>
            )}
          </section>

          <section className="today-action__followup" aria-labelledby="today-action-followup-title">
            <div className="today-action__section-heading">
              <div>
                <p className="today-action__eyebrow">复盘与计划</p>
                <h2 id="today-action-followup-title">完成今天的学习闭环</h2>
              </div>
            </div>

            <div className="today-action__followup-grid">
              <div
                data-testid="today-review-entry"
                className="today-action__review-entry"
              >
                <p className="today-action__followup-kicker">今日复盘</p>
                <h3>{reviewActionLabel}</h3>
                <p>回到今天的日记，记录收获、问题和明日第一步。</p>
                <button
                  type="button"
                  data-testid="today-review-cta"
                  className="button button-secondary"
                  onClick={openTodayReview}
                >
                  {reviewActionLabel}
                </button>
              </div>

              <div className="today-action__workflow-actions">
                <div className="today-action__workflow-row">
                  <div>
                    <strong>每日复盘</strong>
                    <span>基于本地证据检查今日学习，并确认候选任务。</span>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary"
                    data-testid="open-daily-review-agent"
                    disabled={taskMutating}
                    onClick={() => setDailyReviewAgentOpenDate(todayDate)}
                  >
                    打开每日复盘
                  </button>
                </div>

                <div className="today-action__workflow-row">
                  <div>
                    <strong>AI 规划今日行动</strong>
                    <span>生成结果是建议，仍需由你确认。</span>
                  </div>
                  <button
                    type="button"
                    className="button today-action__quiet-action"
                    data-testid="open-ai-today-action-suggestions"
                    disabled={taskMutating}
                    onClick={() => setAiSuggestionOpen(true)}
                  >
                    打开 AI 规划
                  </button>
                </div>

                <div className="today-action__workflow-row today-action__workflow-row--quiet">
                  <div>
                    <strong>最近 AI 规划</strong>
                    <span>查看既有规划记录与执行反馈。</span>
                  </div>
                  <button
                    type="button"
                    className="button today-action__quiet-action"
                    onClick={() => setPlanningHistoryOpen(true)}
                  >
                    最近 AI 规划
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="today-action__evidence" aria-labelledby="today-action-evidence-title">
            <div className="today-action__section-heading">
              <div>
                <p className="today-action__eyebrow">支持依据</p>
                <h2 id="today-action-evidence-title">为什么这样安排</h2>
              </div>
              <p className="today-action__section-note">指标用于解释当前建议，不替代你的判断。</p>
            </div>

            <div className="today-action__trust-band" role="group" aria-label="今日推荐支持指标">
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
            </div>

            <dl data-testid="task-focus-loop-metrics" className="today-action__focus-metrics">
              <div>
                <dt>计划预计</dt>
                <dd>{plannedTaskMinutes}m / {taskFocus.focusedMinutes}m</dd>
              </div>
              <div>
                <dt>任务完成率</dt>
                <dd>{taskFocus.effectiveTaskCount > 0 ? `${taskFocus.completionRate}%` : '暂无任务'}</dd>
              </div>
              <div>
                <dt>专注覆盖率</dt>
                <dd>{taskFocus.effectiveTaskCount > 0 ? `${taskFocus.focusCoverageRate}%` : '暂无任务'}</dd>
              </div>
              <div>
                <dt>任务专注</dt>
                <dd>{taskFocus.focusedMinutes}m</dd>
              </div>
              <div data-warning={taskFocus.unclosedTaskTitles.length > 0 ? 'true' : 'false'}>
                <dt>未闭环提示</dt>
                <dd>
                  {taskFocus.effectiveTaskCount === 0
                    ? '添加任务后开始闭环'
                    : taskFocus.unclosedTaskTitles.length > 0
                      ? taskFocus.unclosedTaskTitles.join('、')
                      : '今日任务已闭环'}
                </dd>
              </div>
            </dl>

            <div className="today-action__details">
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="today-action__details-toggle"
                data-testid="dashboard-details-toggle"
                aria-expanded={showDetails}
                aria-controls="today-action-system-evidence"
              >
                {showDetails ? '收起系统依据' : '查看系统依据'}
                {showDetails
                  ? <ChevronUp size={16} aria-hidden="true" />
                  : <ChevronDown size={16} aria-hidden="true" />}
              </button>

              {showDetails && (
                <div id="today-action-system-evidence" className="today-action__details-content">
                  <h3>系统依据</h3>
                  <p data-testid="dashboard-state-explanation">{config.explanation}</p>
                  <p>
                    系统当前连续诊断天数：<strong>{data.streakDays} 天</strong>。<br />
                    如果持续保持有效产出，您的专注转化率和长期稳定记忆净增量将会同步上涨。
                    我们不再关注单一番茄钟的绝对时长，而是专注衡量您实际「带走」了多少。
                  </p>

                  <div className="today-action__details-actions">
                    <button className="button" onClick={() => setActiveView('dashboard')}>
                      打开全局图表与分析报表
                    </button>

                    {examDaysDiff !== null && (
                      <span>
                        距目标 <strong>{examDaysDiff}</strong> 天
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
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
          subjectChaptersAPI={subjectChaptersAPI}
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
