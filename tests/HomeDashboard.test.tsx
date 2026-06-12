import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import HomeDashboard from '../src/components/HomeDashboard'
import * as DiaryContextModule from '../src/contexts/DiaryContext'
import type { StudyTask, TodayDashboardData } from '../src/types'

vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn(),
}))

const mockRefresh = vi.fn()
const mockRequestDataRefresh = vi.fn()
const mockTasksGetByDate = vi.fn()
const mockTasksCreate = vi.fn()
const mockTasksComplete = vi.fn()
const mockTasksSkip = vi.fn()
const mockTasksDelete = vi.fn()
let mockHookState: {
  data: TodayDashboardData
  loading: boolean
  error: string | null
  refresh: ReturnType<typeof vi.fn>
}

vi.mock('../src/hooks/useTodayStats', () => ({
  useTodayStats: () => mockHookState,
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
  planned_date: '2026-05-31',
  estimate_minutes: 25,
  status: 'todo',
  source: 'dashboard',
  created_at: '2026-05-31T00:00:00.000Z',
  updated_at: '2026-05-31T00:00:00.000Z',
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
    mockTasksGetByDate.mockResolvedValue([])
    mockTasksCreate.mockResolvedValue(makeTask())
    mockTasksComplete.mockResolvedValue({ id: 1, status: 'done' })
    mockTasksSkip.mockResolvedValue({ id: 2, status: 'skipped' })
    mockTasksDelete.mockResolvedValue(true)
    mockUseDiary.mockReturnValue({
      settingsData: { examDate: '2026-12-25' },
      tasks: {
        getByDate: mockTasksGetByDate,
        create: mockTasksCreate,
        update: vi.fn(),
        delete: mockTasksDelete,
        complete: mockTasksComplete,
        skip: mockTasksSkip,
      },
      requestDataRefresh: mockRequestDataRefresh,
    })

    mockHookState = {
      data: FULL_DATA,
      loading: false,
      error: null,
      refresh: mockRefresh,
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state correctly', async () => {
    mockHookState = { data: EMPTY_DATA, loading: true, error: null, refresh: mockRefresh }
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })
    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument()
  })

  it('renders error state correctly', async () => {
    mockHookState = { data: EMPTY_DATA, loading: false, error: '网络连接失败', refresh: mockRefresh }
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })
    expect(screen.getByText(/加载失败.*网络连接失败/)).toBeInTheDocument()
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

  it('renders today action queue with task statuses', async () => {
    mockTasksGetByDate.mockResolvedValue([
      {
        id: 1,
        title: 'Review risk pool',
        description: '',
        type: 'review',
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
        title: 'Write reflection',
        description: '',
        type: 'diary',
        subject_id: null,
        related_mistake_id: null,
        related_entry_id: null,
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
  })

  it('renders lightweight task focus loop metrics', async () => {
    mockHookState = {
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
      refresh: mockRefresh,
    }

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    const metrics = await screen.findByTestId('task-focus-loop-metrics')
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
      data: EMPTY_DATA,
      loading: false,
      error: null,
      refresh: mockRefresh,
    }

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    const metrics = await screen.findByTestId('task-focus-loop-metrics')
    expect(metrics).toHaveTextContent('暂无任务')
    expect(metrics).toHaveTextContent('添加任务后开始闭环')
    expect(metrics).not.toHaveTextContent('NaN')
  })

  it('creates suggested review and diary tasks from today context', async () => {
    mockHookState = {
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
      refresh: mockRefresh,
    }

    render(<HomeDashboard setActiveView={mockSetActiveView} />)

    await act(async () => {
      fireEvent.click(await screen.findByTestId('create-review-task-suggestion'))
    })
    await act(async () => {
      fireEvent.click(await screen.findByTestId('create-diary-task-suggestion'))
    })

    await waitFor(() => {
      expect(mockTasksCreate).toHaveBeenCalledWith(expect.objectContaining({
        title: '复习今日待复习错题',
        type: 'review',
        source: 'dashboard',
      }))
      expect(mockTasksCreate).toHaveBeenCalledWith(expect.objectContaining({
        title: '写今日学习沉淀',
        type: 'diary',
        source: 'dashboard',
      }))
    })
    expect(mockRequestDataRefresh).toHaveBeenCalled()
  })

  it('does not create duplicate review suggestions while a mutation is pending', async () => {
    const createResult = createDeferredTask()
    mockTasksCreate.mockReturnValue(createResult.promise)
    mockHookState = {
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
      refresh: mockRefresh,
    }

    render(<HomeDashboard setActiveView={mockSetActiveView} />)
    const reviewButton = await screen.findByTestId('create-review-task-suggestion')

    await act(async () => {
      fireEvent.click(reviewButton)
      fireEvent.click(reviewButton)
    })

    expect(mockTasksCreate).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(reviewButton).toBeDisabled()
    })

    await act(async () => {
      createResult.resolve(makeTask({ type: 'review' }))
    })
  })

  it('does not create duplicate diary suggestions while a mutation is pending', async () => {
    const createResult = createDeferredTask()
    mockTasksCreate.mockReturnValue(createResult.promise)
    mockHookState = {
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
      refresh: mockRefresh,
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
