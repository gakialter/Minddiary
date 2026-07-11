import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import HomeDashboard from '../src/components/HomeDashboard'
import * as DiaryContextModule from '../src/contexts/DiaryContext'
import type { Mistake, StudyTask, TodayDashboardData } from '../src/types'

vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn(),
}))

const mockRefresh = vi.fn()
const mockRequestDataRefresh = vi.fn()
const mockTasksGetByDate = vi.fn()
const mockTasksFind = vi.fn()
const mockTasksCreate = vi.fn()
const mockTasksComplete = vi.fn()
const mockTasksSkip = vi.fn()
const mockTasksDelete = vi.fn()
const mockMistakesGetAll = vi.fn()
const mockSubjectsGetAll = vi.fn()
const mockSubjectChaptersGetBySubject = vi.fn()
const mockSetSelectedDate = vi.fn()
const dailyReviewHarness = vi.hoisted(() => ({
  onCreated: undefined as undefined | (() => void | Promise<void>),
}))
const localDateMocks = vi.hoisted(() => ({
  currentDateKey: '2026-05-31',
}))

const pomodoroMocks = vi.hoisted(() => ({
  timer: { hasActiveTimerSession: false },
  data: { selectedTask: null as StudyTask | null },
  selectFocusTask: vi.fn(),
}))

vi.mock('../src/contexts/PomodoroContext', () => ({
  usePomodoroTimer: () => pomodoroMocks.timer,
  usePomodoroData: () => pomodoroMocks.data,
  usePomodoroActions: () => ({ selectFocusTask: pomodoroMocks.selectFocusTask }),
}))
let mockHookState: {
  data: TodayDashboardData
  loading: boolean
  error: string | null
  refresh: ReturnType<typeof vi.fn>
  currentDateKey: string
  resolvedDateKey: string | null
  errorDateKey: string | null
}

vi.mock('../src/hooks/useTodayStats', () => ({
  useTodayStats: () => mockHookState,
}))

vi.mock('../src/contexts/LocalDateContext', () => ({
  useCurrentLocalDateKey: () => localDateMocks.currentDateKey,
}))

vi.mock('../src/components/DailyReviewAgentDialog', () => ({
  default: ({ onCreated }: { onCreated: () => void | Promise<void> }) => {
    dailyReviewHarness.onCreated = onCreated
    return (
      <div data-testid="daily-review-dialog-harness">
        <button type="button" data-testid="daily-review-harness-created" onClick={() => { void onCreated() }}>
          模拟每日复盘创建完成
        </button>
      </div>
    )
  },
}))

const mockUseDiary = DiaryContextModule.useDiary as ReturnType<typeof vi.fn>

const makeTask = (overrides: Partial<StudyTask> = {}): StudyTask => ({
  id: 10,
  title: 'Generated task',
  description: '',
  type: 'review',
  subject_id: null,
  related_mistake_id: null,
  related_entry_id: null,
  related_chapter_id: null,
  planned_date: '2026-05-31',
  estimate_minutes: 25,
  status: 'todo',
  source: 'dashboard',
  created_at: '2026-05-31T00:00:00.000Z',
  updated_at: '2026-05-31T00:00:00.000Z',
  ...overrides,
})

const makeMistake = (overrides: Partial<Mistake> = {}): Mistake => ({
  id: 101,
  subject_id: 3,
  question: '二次函数顶点式转换错误',
  answer: '配方后检查符号。',
  notes: '',
  mastered: false,
  ease_factor: 2.5,
  review_interval: 1,
  next_review_date: '2026-05-31',
  review_count: 0,
  subject_name: '数学',
  subject_color: '#2563eb',
  created_at: '2026-05-30T00:00:00.000Z',
  updated_at: '2026-05-30T00:00:00.000Z',
  ...overrides,
})

const createDeferredTask = () => {
  let resolve!: (value: StudyTask) => void
  const promise = new Promise<StudyTask>(innerResolve => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

const EMPTY_TASK_FOCUS: TodayDashboardData['taskFocusToday'] = {
  effectiveTaskCount: 0,
  completedTaskCount: 0,
  completionRate: 0,
  focusedTaskCount: 0,
  focusCoverageRate: 0,
  focusedMinutes: 0,
  skippedTaskCount: 0,
  openWithoutFocusCount: 0,
  focusedOpenTaskCount: 0,
  unclosedTaskTitles: [],
}

const FULL_DATA: TodayDashboardData = {
  todayEntry: { id: 1, title: '测试', wordCount: 320, mood: 'happy' },
  pomodoroToday: { totalMinutes: 45, sessionCount: 2 },
  commanderMetrics: {
    riskPoolCount: 6,
    lockedKnowledgeGrowth: 8,
    focusConversionRate: 75,
  },
  taskFocusToday: EMPTY_TASK_FOCUS,
  streakDays: 7,
}

const NEXT_DAY_DATA: TodayDashboardData = {
  ...FULL_DATA,
  todayEntry: { id: 2, title: '次日复盘', wordCount: 180, mood: 'calm' },
  pomodoroToday: { totalMinutes: 25, sessionCount: 1 },
  commanderMetrics: {
    riskPoolCount: 2,
    lockedKnowledgeGrowth: 3,
    focusConversionRate: 50,
  },
  streakDays: 8,
}

const EMPTY_DATA: TodayDashboardData = {
  todayEntry: null,
  pomodoroToday: { totalMinutes: 0, sessionCount: 0 },
  commanderMetrics: {
    riskPoolCount: 0,
    lockedKnowledgeGrowth: 0,
    focusConversionRate: 0,
  },
  taskFocusToday: EMPTY_TASK_FOCUS,
  streakDays: 0,
}

describe('HomeDashboard Component - Commander Engine', () => {
  const mockSetActiveView = vi.fn()

  beforeEach(() => {
    dailyReviewHarness.onCreated = undefined
    localDateMocks.currentDateKey = '2026-05-31'
    mockTasksGetByDate.mockResolvedValue([])
    mockTasksFind.mockResolvedValue([])
    mockTasksCreate.mockResolvedValue(makeTask())
    mockTasksComplete.mockResolvedValue({ id: 1, status: 'done' })
    mockTasksSkip.mockResolvedValue({ id: 2, status: 'skipped' })
    mockTasksDelete.mockResolvedValue(true)
    mockMistakesGetAll.mockResolvedValue({ data: [makeMistake()], total: 1 })
    mockSubjectsGetAll.mockResolvedValue([])
    mockSubjectChaptersGetBySubject.mockResolvedValue([])
    pomodoroMocks.timer.hasActiveTimerSession = false
    pomodoroMocks.data.selectedTask = null
    mockUseDiary.mockReturnValue({
      settingsData: { examDate: '2026-12-25' },
      tasks: {
        getByDate: mockTasksGetByDate,
        find: mockTasksFind,
        create: mockTasksCreate,
        update: vi.fn(),
        delete: mockTasksDelete,
        complete: mockTasksComplete,
        skip: mockTasksSkip,
      },
      mistakes: {
        getAll: mockMistakesGetAll,
      },
      subjects: {
        getAll: mockSubjectsGetAll,
      },
      subjectChapters: {
        getBySubject: mockSubjectChaptersGetBySubject,
      },
      requestDataRefresh: mockRequestDataRefresh,
    })

    mockHookState = {
      data: FULL_DATA,
      loading: false,
      error: null,
      refresh: mockRefresh,
      currentDateKey: localDateMocks.currentDateKey,
      resolvedDateKey: localDateMocks.currentDateKey,
      errorDateKey: null,
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state correctly', async () => {
    mockHookState = {
      ...mockHookState,
      data: EMPTY_DATA,
      loading: true,
      error: null,
      resolvedDateKey: null,
      errorDateKey: null,
    }
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })
    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument()
  })

  it('renders error state correctly', async () => {
    mockHookState = {
      ...mockHookState,
      data: EMPTY_DATA,
      loading: false,
      error: '网络连接失败',
      resolvedDateKey: null,
      errorDateKey: localDateMocks.currentDateKey,
    }
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })
    expect(screen.getByText(/加载失败.*网络连接失败/)).toBeInTheDocument()
  })

  it('keeps an open Daily Review instance mounted while its successful creation refreshes the dashboard', async () => {
    const view = render(<HomeDashboard setActiveView={mockSetActiveView} />)
    fireEvent.click(await screen.findByTestId('open-daily-review-agent'))

    const dialogInstance = screen.getByTestId('daily-review-dialog-harness')
    expect(screen.getByTestId('open-ai-today-action-suggestions')).toBeInTheDocument()

    mockHookState = {
      ...mockHookState,
      loading: true,
      error: null,
      currentDateKey: '2026-05-31',
      resolvedDateKey: '2026-05-31',
      errorDateKey: null,
    }
    view.rerender(<HomeDashboard setActiveView={mockSetActiveView} />)

    expect(screen.queryByTestId('dashboard-loading')).not.toBeInTheDocument()
    expect(screen.getByTestId('daily-review-dialog-harness')).toBe(dialogInstance)

    fireEvent.click(screen.getByTestId('daily-review-harness-created'))
    await waitFor(() => expect(mockRequestDataRefresh).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('daily-review-dialog-harness')).toBe(dialogInstance)

    mockHookState = {
      ...mockHookState,
      data: {
        ...FULL_DATA,
        commanderMetrics: { ...FULL_DATA.commanderMetrics, riskPoolCount: 9 },
      },
      loading: false,
    }
    view.rerender(<HomeDashboard setActiveView={mockSetActiveView} />)

    expect(screen.getByTestId('daily-review-dialog-harness')).toBe(dialogInstance)
    expect(screen.getByText(/今天有 9 个高风险知识点待抢救/)).toBeInTheDocument()
    expect(screen.getByTestId('open-ai-today-action-suggestions')).toBeInTheDocument()

    mockHookState = {
      ...mockHookState,
      loading: false,
      error: '后台统计刷新失败',
      errorDateKey: '2026-05-31',
    }
    view.rerender(<HomeDashboard setActiveView={mockSetActiveView} />)

    expect(screen.getByTestId('dashboard-background-refresh-error')).toHaveTextContent('后台统计刷新失败')
    expect(screen.getByTestId('daily-review-dialog-harness')).toBe(dialogInstance)
    expect(screen.queryByTestId('dashboard-loading')).not.toBeInTheDocument()
    expect(screen.getByText(/今天有 9 个高风险知识点待抢救/)).toBeInTheDocument()
  })

  it('hides stale dashboard data during the date-switch effect-before-loading window', async () => {
    const view = render(<HomeDashboard setActiveView={mockSetActiveView} />)
    expect(await screen.findByText(/今天有 6 个高风险知识点待抢救/)).toBeInTheDocument()

    localDateMocks.currentDateKey = '2026-06-01'
    mockHookState = {
      ...mockHookState,
      data: FULL_DATA,
      loading: false,
      error: null,
      currentDateKey: '2026-06-01',
      resolvedDateKey: '2026-05-31',
      errorDateKey: null,
    }
    view.rerender(<HomeDashboard setActiveView={mockSetActiveView} />)

    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('today-execution-overview')).not.toBeInTheDocument()
    expect(screen.queryByTestId('open-daily-review-agent')).not.toBeInTheDocument()
    expect(screen.queryByText(/今天有 6 个高风险知识点待抢救/)).not.toBeInTheDocument()
  })

  it('keeps the new date in full-page loading while its request is pending', async () => {
    localDateMocks.currentDateKey = '2026-06-01'
    mockHookState = {
      ...mockHookState,
      data: FULL_DATA,
      loading: true,
      error: null,
      currentDateKey: '2026-06-01',
      resolvedDateKey: '2026-05-31',
      errorDateKey: null,
    }

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('today-execution-overview')).not.toBeInTheDocument()
    expect(screen.queryByText(/今天有 6 个高风险知识点待抢救/)).not.toBeInTheDocument()
  })

  it('does not display a previous date error as the new date error', async () => {
    localDateMocks.currentDateKey = '2026-06-01'
    mockHookState = {
      ...mockHookState,
      data: FULL_DATA,
      loading: false,
      error: '昨天加载失败',
      currentDateKey: '2026-06-01',
      resolvedDateKey: '2026-05-31',
      errorDateKey: '2026-05-31',
    }

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument()
    expect(screen.queryByText(/加载失败.*昨天加载失败/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-background-refresh-error')).not.toBeInTheDocument()
  })

  it('shows a new-date failure without stale Dashboard data or an old Daily Review dialog', async () => {
    const view = render(<HomeDashboard setActiveView={mockSetActiveView} />)
    fireEvent.click(await screen.findByTestId('open-daily-review-agent'))
    expect(screen.getByTestId('daily-review-dialog-harness')).toBeInTheDocument()

    localDateMocks.currentDateKey = '2026-06-01'
    mockHookState = {
      ...mockHookState,
      data: FULL_DATA,
      loading: false,
      error: '次日加载失败',
      currentDateKey: '2026-06-01',
      resolvedDateKey: '2026-05-31',
      errorDateKey: '2026-06-01',
    }
    view.rerender(<HomeDashboard setActiveView={mockSetActiveView} />)

    expect(screen.getByText(/加载失败.*次日加载失败/)).toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-background-refresh-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('today-execution-overview')).not.toBeInTheDocument()
    expect(screen.queryByTestId('daily-review-dialog-harness')).not.toBeInTheDocument()
  })

  it('renders only the new date Dashboard data after the new date resolves', async () => {
    const view = render(<HomeDashboard setActiveView={mockSetActiveView} />)
    expect(await screen.findByText(/今天有 6 个高风险知识点待抢救/)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('open-daily-review-agent'))
    expect(screen.getByTestId('daily-review-dialog-harness')).toBeInTheDocument()

    localDateMocks.currentDateKey = '2026-06-01'
    mockHookState = {
      ...mockHookState,
      data: NEXT_DAY_DATA,
      loading: false,
      error: null,
      currentDateKey: '2026-06-01',
      resolvedDateKey: '2026-06-01',
      errorDateKey: null,
    }
    view.rerender(<HomeDashboard setActiveView={mockSetActiveView} />)

    await waitFor(() => {
      expect(mockTasksGetByDate).toHaveBeenLastCalledWith('2026-06-01')
    })

    expect(screen.queryByTestId('dashboard-loading')).not.toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-background-refresh-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('today-execution-overview')).toHaveTextContent('2026-06-01')
    expect(screen.getByTestId('today-execution-overview')).toHaveTextContent('25 分钟')
    expect(screen.getByTestId('today-execution-overview')).not.toHaveTextContent('45 分钟')
    expect(screen.queryByText(/今天有 6 个高风险知识点待抢救/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('daily-review-dialog-harness')).not.toBeInTheDocument()
  })

  it('propagates a Daily Review task-list refresh failure through onCreated', async () => {
    render(<HomeDashboard setActiveView={mockSetActiveView} />)
    fireEvent.click(await screen.findByTestId('open-daily-review-agent'))
    await waitFor(() => expect(dailyReviewHarness.onCreated).toEqual(expect.any(Function)))

    mockTasksGetByDate.mockRejectedValueOnce(new Error('task refresh failed'))
    await act(async () => {
      await expect(dailyReviewHarness.onCreated!()).rejects.toThrow('task refresh failed')
    })

    expect(screen.getByText('task refresh failed')).toBeInTheDocument()
    expect(mockRequestDataRefresh).not.toHaveBeenCalled()
  })

  it('renders Commander Hero title and metrics', async () => {
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    expect(screen.getByText(/今天有 6 个高风险知识点待抢救/)).toBeInTheDocument()
    expect(screen.getByText('72 小时风险池')).toBeInTheDocument()
    expect(screen.getByText('稳定记忆净增')).toBeInTheDocument()
    expect(screen.getByText('有效专注转化率')).toBeInTheDocument()
  })

  it('toggles expansion layer details and shows the decision explanation', async () => {
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    const toggleBtn = screen.getByTestId('dashboard-details-toggle')
    expect(screen.queryByTestId('dashboard-state-explanation')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(toggleBtn)
    })
    expect(screen.getByTestId('dashboard-state-explanation')).toHaveTextContent('待复习错题 6 ≥ 5')
  })

  it('cta handles navigation properly', async () => {
    const mockMistakeFilterIntent = vi.fn()

    await act(async () => {
      render(
        <HomeDashboard
          setActiveView={mockSetActiveView}
          onMistakeFilterIntent={mockMistakeFilterIntent}
        />,
      )
    })

    const ctaBtn = screen.getByTestId('dashboard-cta')
    await act(async () => {
      fireEvent.click(ctaBtn)
    })

    expect(mockMistakeFilterIntent).toHaveBeenCalledWith('due')
    expect(mockSetActiveView).toHaveBeenCalledWith('mistakes')
  })

  it('renders the today execution overview with task, focus, chapter, and diary status', async () => {
    mockTasksGetByDate.mockResolvedValue([
      makeTask({ id: 1, status: 'done', related_chapter_id: 10, subject_id: 7 }),
      makeTask({ id: 2, status: 'todo', related_chapter_id: 11, subject_id: 7 }),
      makeTask({ id: 3, status: 'skipped' }),
    ])

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    const overview = await screen.findByTestId('today-execution-overview')
    expect(overview).toHaveTextContent('今日概览')
    expect(screen.getByTestId('overview-tasks')).toHaveTextContent('1 / 3')
    expect(screen.getByTestId('overview-focus')).toHaveTextContent('45 分钟')
    expect(screen.getByTestId('overview-chapters')).toHaveTextContent('1 / 2')
    expect(screen.getByTestId('overview-diary')).toHaveTextContent('已写')
  })

  it('recommends a doing task before chapter and ordinary todos', async () => {
    mockTasksGetByDate.mockResolvedValue([
      makeTask({ id: 1, title: '普通待办' }),
      makeTask({ id: 2, title: '章节待办', related_chapter_id: 20, subject_id: 7 }),
      makeTask({ id: 3, title: '进行中的任务', status: 'doing' }),
    ])

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    const recommendation = await screen.findByTestId('next-today-action')
    expect(recommendation).toHaveTextContent('继续：进行中的任务')
    expect(recommendation).toHaveTextContent('该任务已经开始，优先完成现有闭环。')
  })

  it('recommends a chapter todo and shows its stable subject and chapter source', async () => {
    mockTasksGetByDate.mockResolvedValue([
      makeTask({ id: 1, title: '普通待办' }),
      makeTask({ id: 2, title: '任意章节任务标题', subject_id: 7, related_chapter_id: 70 }),
    ])
    mockSubjectsGetAll.mockResolvedValue([
      { id: 7, name: '数学', color: '#2563eb', total_chapters: 2, completed_chapters: 0 },
    ])
    mockSubjectChaptersGetBySubject.mockResolvedValue([
      {
        id: 70,
        subject_id: 7,
        title: '函数',
        notes: '',
        completed: false,
        sort_order: 0,
        created_at: '2026-05-31T00:00:00.000Z',
        updated_at: '2026-05-31T00:00:00.000Z',
      },
    ])

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    const recommendation = await screen.findByTestId('next-today-action')
    await waitFor(() => expect(recommendation).toHaveTextContent('数学 · 函数'))
    expect(recommendation).toHaveTextContent('推进章节：任意章节任务标题')
    expect(screen.getByTestId('task-source-2')).toHaveTextContent('数学 · 函数')
    expect(mockSubjectChaptersGetBySubject).toHaveBeenCalledWith(7)
  })

  it('recommends the first ordinary todo without rendering a chapter source', async () => {
    mockTasksGetByDate.mockResolvedValue([
      makeTask({ id: 4, title: '普通任务一' }),
      makeTask({ id: 5, title: '普通任务二' }),
    ])

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    expect(await screen.findByTestId('next-today-action')).toHaveTextContent('开始：普通任务一')
    expect(screen.queryByTestId('task-source-4')).not.toBeInTheDocument()
    expect(screen.queryByText('章节已删除')).not.toBeInTheDocument()
  })

  it('degrades a missing chapter source safely without hiding the task', async () => {
    mockTasksGetByDate.mockResolvedValue([
      makeTask({ id: 8, title: '保留任务标题', subject_id: 7, related_chapter_id: 999 }),
    ])
    mockSubjectsGetAll.mockResolvedValue([{ id: 7, name: '数学', color: '#2563eb' }])
    mockSubjectChaptersGetBySubject.mockResolvedValue([])

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    expect(await screen.findByText('保留任务标题')).toBeInTheDocument()
    expect(await screen.findByTestId('task-source-8')).toHaveTextContent('章节已删除')
  })

  it('selects a recommended task and opens Pomodoro without starting the timer', async () => {
    mockTasksGetByDate.mockResolvedValue([makeTask({ id: 12, title: '进入专注任务' })])

    render(<HomeDashboard setActiveView={mockSetActiveView} setSelectedDate={mockSetSelectedDate} />)

    fireEvent.click(await screen.findByTestId('next-today-action-cta'))

    expect(pomodoroMocks.selectFocusTask).toHaveBeenCalledWith(12)
    expect(mockSetActiveView).toHaveBeenCalledWith('pomodoro')
  })

  it('returns to an active Pomodoro session without replacing its selected task', async () => {
    pomodoroMocks.timer.hasActiveTimerSession = true
    pomodoroMocks.data.selectedTask = makeTask({ id: 22, title: '当前专注任务', status: 'doing' })
    mockTasksGetByDate.mockResolvedValue([makeTask({ id: 12, title: '其他任务' })])

    render(<HomeDashboard setActiveView={mockSetActiveView} setSelectedDate={mockSetSelectedDate} />)

    const recommendation = await screen.findByTestId('next-today-action')
    expect(recommendation).toHaveTextContent('返回当前专注：当前专注任务')
    fireEvent.click(screen.getByTestId('next-today-action-cta'))

    expect(pomodoroMocks.selectFocusTask).not.toHaveBeenCalled()
    expect(mockSetActiveView).toHaveBeenCalledWith('pomodoro')
  })

  it('opens today editor from the review recommendation after setting today date', async () => {
    mockHookState = { ...mockHookState, data: EMPTY_DATA, loading: false, error: null }
    mockTasksGetByDate.mockResolvedValue([makeTask({ id: 1, status: 'done' })])

    render(<HomeDashboard setActiveView={mockSetActiveView} setSelectedDate={mockSetSelectedDate} />)

    expect(await screen.findByTestId('next-today-action')).toHaveTextContent('写今日复盘')
    fireEvent.click(screen.getByTestId('today-review-cta'))

    expect(mockSetSelectedDate).toHaveBeenCalledWith('2026-05-31')
    expect(mockSetActiveView).toHaveBeenCalledWith('editor')
    expect(mockSetSelectedDate.mock.invocationCallOrder[0]!).toBeLessThan(mockSetActiveView.mock.invocationCallOrder[0]!)
  })

  it('opens subject progress when today has no tasks and unfinished chapters remain', async () => {
    mockHookState = { ...mockHookState, data: EMPTY_DATA, loading: false, error: null }
    mockSubjectsGetAll.mockResolvedValue([
      { id: 7, name: '数学', color: '#2563eb', total_chapters: 3, completed_chapters: 1 },
    ])

    render(<HomeDashboard setActiveView={mockSetActiveView} setSelectedDate={mockSetSelectedDate} />)

    expect(await screen.findByTestId('next-today-action')).toHaveTextContent('选择一个章节开始推进')
    fireEvent.click(screen.getByTestId('next-today-action-cta'))

    expect(mockSetActiveView).toHaveBeenCalledWith('progress')
  })

  it('refreshes the overview after completing a task', async () => {
    mockTasksGetByDate
      .mockResolvedValueOnce([makeTask({ id: 31, title: '待完成任务' })])
      .mockResolvedValueOnce([makeTask({ id: 31, title: '待完成任务', status: 'done' })])

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    expect(await screen.findByTestId('overview-tasks')).toHaveTextContent('0 / 1')
    fireEvent.click(screen.getByTestId('task-complete-31'))

    await waitFor(() => expect(screen.getByTestId('overview-tasks')).toHaveTextContent('1 / 1'))
    expect(mockRequestDataRefresh).toHaveBeenCalled()
  })

  it('keeps tasks usable when chapter source loading fails', async () => {
    mockTasksGetByDate.mockResolvedValue([
      makeTask({ id: 41, title: '来源加载失败任务', subject_id: 7, related_chapter_id: 70 }),
    ])
    mockSubjectsGetAll.mockRejectedValue(new Error('subjects unavailable'))

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    expect(await screen.findByText('来源加载失败任务')).toBeInTheDocument()
    expect(screen.getByTestId('task-complete-41')).toBeEnabled()
  })

  it('renders today action queue with task statuses', async () => {
    mockTasksGetByDate.mockResolvedValue([
      {
        id: 1,
        title: 'Review risk pool',
        description: '',
        type: 'review',
        subject_id: null,
        related_mistake_id: 44,
        related_entry_id: null,
        related_chapter_id: null,
        planned_date: '2026-05-31',
        estimate_minutes: 25,
        status: 'todo',
        source: 'ai',
        created_at: '2026-05-31T00:00:00.000Z',
        updated_at: '2026-05-31T00:00:00.000Z',
      },
      {
        id: 2,
        title: 'Write reflection',
        description: '',
        type: 'diary',
        subject_id: null,
        related_mistake_id: null,
        related_entry_id: 1,
        related_chapter_id: null,
        planned_date: '2026-05-31',
        estimate_minutes: 15,
        status: 'done',
        source: 'manual',
        created_at: '2026-05-31T00:00:00.000Z',
        updated_at: '2026-05-31T00:00:00.000Z',
      },
    ])

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    expect(await screen.findByTestId('daily-action-queue')).toBeInTheDocument()
    expect(screen.getByText('Review risk pool')).toBeInTheDocument()
    expect(screen.getByText('Write reflection')).toBeInTheDocument()
    expect(screen.getByTestId('task-status-1')).toHaveTextContent('todo')
    expect(screen.getByTestId('task-status-2')).toHaveTextContent('done')
    expect(screen.getByText('AI 建议')).toBeInTheDocument()
    expect(screen.getByText('关联错题 #44')).toBeInTheDocument()
    expect(screen.getByText('关联日记 #1')).toBeInTheDocument()
  })

  it('marks chapter-attributed tasks without changing ordinary task badges', async () => {
    mockTasksGetByDate.mockResolvedValue([
      makeTask({ id: 1, title: '学习：Math · 第一章 函数', type: 'focus', related_chapter_id: 9 }),
      makeTask({ id: 2, title: 'Ordinary focus', type: 'focus' }),
    ])

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    expect(await screen.findByText('学习：Math · 第一章 函数')).toBeInTheDocument()
    expect(screen.getAllByText('章节任务')).toHaveLength(1)
    expect(screen.getByText('Ordinary focus')).toBeInTheDocument()
  })

  it('renders lightweight task focus loop metrics', async () => {
    mockHookState = {
      ...mockHookState,
      data: {
        ...FULL_DATA,
        taskFocusToday: {
          effectiveTaskCount: 4,
          completedTaskCount: 2,
          completionRate: 50,
          focusedTaskCount: 3,
          focusCoverageRate: 75,
          focusedMinutes: 65,
          skippedTaskCount: 1,
          openWithoutFocusCount: 1,
          focusedOpenTaskCount: 1,
          unclosedTaskTitles: ['Math problem set', 'English reading'],
        },
      },
      loading: false,
      error: null,
    }

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    const metrics = await screen.findByTestId('task-focus-loop-metrics')
    expect(metrics).toHaveTextContent('计划预计')
    expect(metrics).toHaveTextContent('0m / 65m')
    expect(metrics).toHaveTextContent('任务完成率')
    expect(metrics).toHaveTextContent('50%')
    expect(metrics).toHaveTextContent('专注覆盖率')
    expect(metrics).toHaveTextContent('75%')
    expect(metrics).toHaveTextContent('任务专注')
    expect(metrics).toHaveTextContent('65m')
    expect(metrics).toHaveTextContent('Math problem set、English reading')
  })

  it('renders an empty task focus loop state without NaN', async () => {
    mockHookState = {
      ...mockHookState,
      data: EMPTY_DATA,
      loading: false,
      error: null,
    }

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    const metrics = await screen.findByTestId('task-focus-loop-metrics')
    expect(metrics).toHaveTextContent('暂无任务')
    expect(metrics).toHaveTextContent('添加任务后开始闭环')
    expect(metrics).not.toHaveTextContent('NaN')
  })

  it('creates suggested review and diary tasks from today context', async () => {
    const dueMistake = makeMistake({ id: 42, question: '三角函数诱导公式符号错误' })
    mockMistakesGetAll.mockResolvedValue({ data: [dueMistake], total: 1 })
    mockHookState = {
      ...mockHookState,
      data: {
        ...EMPTY_DATA,
        commanderMetrics: {
          riskPoolCount: 4,
          lockedKnowledgeGrowth: 0,
          focusConversionRate: 0,
        },
      },
      loading: false,
      error: null,
    }

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    await act(async () => {
      fireEvent.click(await screen.findByTestId('create-review-task-suggestion'))
    })
    expect(await screen.findByText(/三角函数诱导公式符号错误/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByText('全选可创建项'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('创建任务'))
    })
    await waitFor(() => {
      expect(mockTasksCreate).toHaveBeenCalledWith(expect.objectContaining({
        title: expect.stringContaining('复习错题 42'),
        type: 'review',
        related_mistake_id: 42,
        subject_id: 3,
        source: 'dashboard',
      }))
    })

    await act(async () => {
      fireEvent.click(screen.getByLabelText('关闭错题任务选择'))
    })
    await act(async () => {
      fireEvent.click(await screen.findByTestId('create-diary-task-suggestion'))
    })

    await waitFor(() => {
      expect(mockTasksCreate).toHaveBeenCalledWith(expect.objectContaining({
        title: '写今日学习沉淀',
        type: 'diary',
        source: 'dashboard',
      }))
    })
    expect(mockRequestDataRefresh).toHaveBeenCalled()
  })

  it('does not create review suggestions before a mistake is selected in the picker', async () => {
    const createResult = createDeferredTask()
    mockTasksCreate.mockReturnValue(createResult.promise)
    mockHookState = {
      ...mockHookState,
      data: {
        ...EMPTY_DATA,
        todayEntry: { id: 1, title: '测试', wordCount: 120, mood: 'calm' },
        commanderMetrics: {
          riskPoolCount: 4,
          lockedKnowledgeGrowth: 0,
          focusConversionRate: 0,
        },
      },
      loading: false,
      error: null,
    }

    render(<HomeDashboard setActiveView={mockSetActiveView} />)
    const reviewButton = await screen.findByTestId('create-review-task-suggestion')

    await act(async () => {
      fireEvent.click(reviewButton)
      fireEvent.click(reviewButton)
    })

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(mockTasksCreate).not.toHaveBeenCalled()

    createResult.resolve(makeTask({ type: 'review' }))
  })

  it('does not create duplicate diary suggestions while a mutation is pending', async () => {
    const createResult = createDeferredTask()
    mockTasksCreate.mockReturnValue(createResult.promise)
    mockHookState = {
      ...mockHookState,
      data: {
        ...EMPTY_DATA,
        commanderMetrics: {
          riskPoolCount: 0,
          lockedKnowledgeGrowth: 0,
          focusConversionRate: 0,
        },
      },
      loading: false,
      error: null,
    }

    render(<HomeDashboard setActiveView={mockSetActiveView} />)
    const diaryButton = await screen.findByTestId('create-diary-task-suggestion')

    await act(async () => {
      fireEvent.click(diaryButton)
      fireEvent.click(diaryButton)
    })

    expect(mockTasksCreate).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(diaryButton).toBeDisabled()
    })

    await act(async () => {
      createResult.resolve(makeTask({ type: 'diary' }))
    })
  })

  it('creates a manual task from the lightweight queue form', async () => {
    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    fireEvent.change(await screen.findByTestId('task-title-input'), { target: { value: 'Read math notes' } })
    fireEvent.change(screen.getByTestId('task-type-select'), { target: { value: 'focus' } })
    fireEvent.change(screen.getByTestId('task-estimate-input'), { target: { value: '40' } })

    await act(async () => {
      fireEvent.click(screen.getByTestId('task-create-submit'))
    })

    await waitFor(() => {
      expect(mockTasksCreate).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Read math notes',
        type: 'focus',
        estimate_minutes: 40,
        source: 'manual',
      }))
    })
  })

  it('completes, skips, and deletes action queue tasks', async () => {
    mockTasksGetByDate.mockResolvedValue([
      {
        id: 1,
        title: 'Finish one task',
        description: '',
        type: 'custom',
        subject_id: null,
        related_mistake_id: null,
        related_entry_id: null,
        planned_date: '2026-05-31',
        estimate_minutes: 25,
        status: 'todo',
        source: 'manual',
        created_at: '2026-05-31T00:00:00.000Z',
        updated_at: '2026-05-31T00:00:00.000Z',
      },
      {
        id: 2,
        title: 'Skip one task',
        description: '',
        type: 'custom',
        subject_id: null,
        related_mistake_id: null,
        related_entry_id: null,
        planned_date: '2026-05-31',
        estimate_minutes: 25,
        status: 'todo',
        source: 'manual',
        created_at: '2026-05-31T00:00:00.000Z',
        updated_at: '2026-05-31T00:00:00.000Z',
      },
      {
        id: 3,
        title: 'Delete one task',
        description: '',
        type: 'custom',
        subject_id: null,
        related_mistake_id: null,
        related_entry_id: null,
        planned_date: '2026-05-31',
        estimate_minutes: 25,
        status: 'todo',
        source: 'manual',
        created_at: '2026-05-31T00:00:00.000Z',
        updated_at: '2026-05-31T00:00:00.000Z',
      },
    ])

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    const completeButton = await screen.findByTestId('task-complete-1')
    const skipButton = await screen.findByTestId('task-skip-2')
    const deleteButton = await screen.findByTestId('task-delete-3')

    await act(async () => {
      fireEvent.click(completeButton)
    })
    await act(async () => {
      fireEvent.click(skipButton)
    })
    await act(async () => {
      fireEvent.click(deleteButton)
    })

    expect(mockTasksComplete).toHaveBeenCalledWith(1)
    expect(mockTasksSkip).toHaveBeenCalledWith(2)
    expect(mockTasksDelete).toHaveBeenCalledWith(3)
  })
})
