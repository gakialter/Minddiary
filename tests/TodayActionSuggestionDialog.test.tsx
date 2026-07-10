import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TodayActionSuggestionDialog from '../src/components/TodayActionSuggestionDialog'
import type { AIResponse, DiaryEntry, Mistake, StudyTask, Subject } from '../src/types'

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(innerResolve => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

const subject: Subject = { id: 1, name: '数学', color: '#2563eb' }

const mistake: Mistake = {
  id: 12,
  subject_id: 1,
  question: '函数极限换元时忽略定义域',
  answer: '',
  notes: '',
  mastered: false,
  ease_factor: 2.5,
  review_interval: 1,
  next_review_date: '2026-06-12',
  review_count: 0,
  created_at: '2026-06-12T00:00:00.000Z',
}

const entry: DiaryEntry = {
  id: 5,
  date: '2026-06-12',
  title: 'Today',
  content: '今天复盘了函数极限。',
  mood: null,
  word_count: 11,
  created_at: '2026-06-12T00:00:00.000Z',
  updated_at: '2026-06-12T00:00:00.000Z',
}

const makeTask = (overrides: Partial<StudyTask> = {}): StudyTask => ({
  id: 99,
  title: '复习函数极限错题',
  description: '',
  type: 'review',
  subject_id: 1,
  related_mistake_id: 12,
  related_entry_id: null,
  related_chapter_id: null,
  planned_date: '2026-06-12',
  estimate_minutes: 10,
  status: 'todo',
  source: 'ai',
  created_at: '2026-06-12T00:00:00.000Z',
  updated_at: '2026-06-12T00:00:00.000Z',
  ...overrides,
})

const validAiResponse = JSON.stringify({
  suggestions: [
    {
      title: '复习函数极限错题',
      type: 'review',
      estimate_minutes: 10,
      reason: '今天到期，先处理薄弱点。',
      priority: 'high',
      subject_ref: 'subject:1',
      related_mistake_ref: 'mistake:12',
    },
  ],
})

const twoCandidateResponse = JSON.stringify({
  suggestions: [
    { title: '任务 A', type: 'focus', estimate_minutes: 10, reason: '先做 A。', priority: 'high' },
    { title: '任务 B', type: 'focus', estimate_minutes: 10, reason: '再做 B。', priority: 'medium' },
  ],
})

describe('TodayActionSuggestionDialog', () => {
  const mocks = {
    aiChat: vi.fn(),
    tasksGetByDate: vi.fn(),
    tasksCreate: vi.fn(),
    mistakesGetAll: vi.fn(),
    subjectsGetAll: vi.fn(),
    entriesGetByDate: vi.fn(),
    onClose: vi.fn(),
    onCreated: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.aiChat.mockResolvedValue({ content: validAiResponse })
    mocks.tasksGetByDate.mockResolvedValue([])
    mocks.tasksCreate.mockResolvedValue(makeTask())
    mocks.mistakesGetAll.mockResolvedValue({ data: [mistake], total: 1, masteredTotal: 0 })
    mocks.subjectsGetAll.mockResolvedValue([subject])
    mocks.entriesGetByDate.mockResolvedValue(entry)
  })

  const renderDialog = () => render(
    <TodayActionSuggestionDialog
      date="2026-06-12"
      aiAPI={{ chat: mocks.aiChat }}
      tasksAPI={{ getByDate: mocks.tasksGetByDate, create: mocks.tasksCreate }}
      mistakesAPI={{ getAll: mocks.mistakesGetAll }}
      subjectsAPI={{ getAll: mocks.subjectsGetAll }}
      entriesAPI={{ getByDate: mocks.entriesGetByDate }}
      onClose={mocks.onClose}
      onCreated={mocks.onCreated}
    />,
  )

  it('generates validated suggestions and creates selected tasks only after user confirmation', async () => {
    renderDialog()

    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    expect(await screen.findByDisplayValue('复习函数极限错题')).toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    await waitFor(() => {
      expect(mocks.tasksCreate).toHaveBeenCalledWith(expect.objectContaining({
        title: '复习函数极限错题',
        type: 'review',
        source: 'ai',
        status: 'todo',
        planned_date: '2026-06-12',
        related_mistake_id: 12,
        subject_id: 1,
      }))
      expect(mocks.onCreated).toHaveBeenCalled()
    })
    expect(await screen.findByText('已创建 #99')).toBeInTheDocument()
  })

  it('shows local planning context before an AI request without creating tasks', async () => {
    mocks.tasksGetByDate.mockResolvedValue([makeTask()])

    renderDialog()

    expect(await screen.findByTestId('planning-context-today_tasks')).toHaveTextContent('已使用：今日活跃任务（1）')
    expect(screen.getByTestId('planning-context-due_mistakes')).toHaveTextContent('已使用：今日到期错题（1）')
    expect(mocks.aiChat).not.toHaveBeenCalled()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('shows the empty local context state and an unavailable diary association', async () => {
    mocks.mistakesGetAll.mockResolvedValue({ data: [], total: 0, masteredTotal: 0 })
    mocks.entriesGetByDate.mockResolvedValue(null)
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [{
          title: '写复盘', type: 'diary', estimate_minutes: 10, reason: '记录今天。', priority: 'low', related_entry_ref: 'entry:5',
        }],
      }),
    })

    renderDialog()

    expect(await screen.findByTestId('planning-context-empty')).toBeInTheDocument()
    expect(screen.getByTestId('planning-context-today_entry')).toHaveTextContent('今天尚无日记')
    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    expect(await screen.findByText('related_entry_ref is not in the allowlist')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '今天没有可关联日记' })).toBeInTheDocument()
    expect(screen.getByTestId('ai-plan-create-selected')).toBeDisabled()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('loads the preview without requesting AI or mutating tasks', async () => {
    const request = createDeferred<StudyTask[]>()
    mocks.tasksGetByDate.mockReturnValueOnce(request.promise)

    renderDialog()

    expect(screen.getByTestId('planning-context-loading')).toBeInTheDocument()
    expect(mocks.aiChat).not.toHaveBeenCalled()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()

    await act(async () => {
      request.resolve([])
      await request.promise
    })
    expect(await screen.findByTestId('planning-context-preview')).toBeInTheDocument()
  })

  it('shows unsupported AI errors with a visible regenerate path and no task creation', async () => {
    mocks.aiChat.mockResolvedValue({
      unsupported: true,
      error: '浏览器端目前不支持直接调用 AI 接口，请使用 Electron 客户端体验完整功能。',
    })

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    expect(await screen.findByTestId('ai-plan-errors')).toHaveTextContent('浏览器端目前不支持')
    expect(screen.getByTestId('ai-plan-errors')).toHaveTextContent('重新生成建议')
    expect(screen.getByTestId('ai-plan-generate')).toHaveTextContent('重新生成建议')
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('shows a visible error and does not create tasks when the final context refresh fails', async () => {
    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    expect(await screen.findByDisplayValue('复习函数极限错题')).toBeInTheDocument()

    mocks.tasksGetByDate.mockRejectedValueOnce(new Error('context refresh failed'))
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    expect(await screen.findByText('创建前无法刷新规划依据：context refresh failed')).toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('blocks task creation when AI response has fatal schema errors', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        unsafe: true,
        suggestions: [
          {
            title: '复习函数极限错题',
            type: 'review',
            estimate_minutes: 10,
            reason: '今天到期，先处理薄弱点。',
            priority: 'high',
            subject_ref: 'subject:1',
            related_mistake_ref: 'mistake:12',
          },
        ],
      }),
    })

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    expect(await screen.findByText(/Unsupported top-level fields/)).toBeInTheDocument()
    expect(screen.getByTestId('ai-plan-create-selected')).toBeDisabled()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('lets users edit due-mistake and diary associations before confirmation', async () => {
    const secondMistake: Mistake = { ...mistake, id: 13, question: '导数符号错误' }
    mocks.mistakesGetAll.mockResolvedValue({ data: [mistake, secondMistake], total: 2, masteredTotal: 0 })

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('复习函数极限错题')

    fireEvent.change(screen.getByLabelText('关联到期错题'), { target: { value: '13' } })
    fireEvent.change(screen.getByLabelText('关联今日日记'), { target: { value: '5' } })

    expect(screen.getByLabelText('关联到期错题')).toHaveValue('13')
    expect(screen.getByLabelText('关联今日日记')).toHaveValue('5')
    expect(screen.getByText('本地依据：到期错题：#13 导数符号错误')).toBeInTheDocument()
    expect(screen.getByText('本地依据：今日日记：Today')).toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('clamps available time to the supported daily capacity range', async () => {
    renderDialog()
    const available = screen.getByTestId('ai-plan-available-minutes')

    fireEvent.change(available, { target: { value: '0' } })
    expect(available).toHaveValue(5)
    fireEvent.change(available, { target: { value: '1000' } })
    expect(available).toHaveValue(720)
  })

  it('requires a second explicit confirmation when the planning context becomes stale', async () => {
    const changedTask = makeTask({
      id: 100,
      title: '新出现的任务',
      type: 'focus',
      subject_id: null,
      related_mistake_id: null,
      estimate_minutes: 20,
      source: 'manual',
    })
    let taskRows: StudyTask[] = []
    mocks.tasksGetByDate.mockImplementation(async () => taskRows)

    renderDialog()
    await screen.findByTestId('planning-context-today_tasks')
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('复习函数极限错题')

    taskRows = [changedTask]
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    expect(await screen.findByTestId('ai-plan-stale-context')).toHaveTextContent('请查看结果后再次确认创建')
    expect(mocks.tasksCreate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))
  })

  it('preserves partial success, reports it, and retries only failed candidates', async () => {
    const createdA = makeTask({ id: 201, title: '任务 A', type: 'focus', subject_id: null, related_mistake_id: null })
    const createdB = makeTask({ id: 202, title: '任务 B', type: 'focus', subject_id: null, related_mistake_id: null })
    let taskRows: StudyTask[] = []
    mocks.tasksGetByDate.mockImplementation(async () => taskRows)
    mocks.aiChat.mockResolvedValue({ content: twoCandidateResponse })
    mocks.tasksCreate.mockReset()
    mocks.tasksCreate
      .mockResolvedValueOnce(createdA)
      .mockRejectedValueOnce(new Error('second write failed'))
      .mockResolvedValueOnce(createdB)

    renderDialog()
    await screen.findByTestId('planning-context-today_tasks')
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('任务 A')

    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    expect(await screen.findByTestId('ai-plan-creation-summary')).toHaveTextContent('本次已创建 1 项，失败 1 项')
    expect(screen.getByText('second write failed')).toBeInTheDocument()
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(2)

    taskRows = [createdA]
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(3))

    const createdTitles = mocks.tasksCreate.mock.calls.map(([input]) => input.title)
    expect(createdTitles.filter(title => title === '任务 A')).toHaveLength(1)
    expect(createdTitles.filter(title => title === '任务 B')).toHaveLength(2)
  })

  it('does not apply stale AI responses after the dialog is closed', async () => {
    const request = createDeferred<AIResponse>()
    mocks.aiChat.mockReturnValue(request.promise)

    const { unmount } = renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    unmount()

    await act(async () => {
      request.resolve({ content: validAiResponse })
      await request.promise
    })

    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('ignores an older planning-context response after available time changes', async () => {
    const staleTasks = createDeferred<StudyTask[]>()
    mocks.tasksGetByDate.mockReturnValueOnce(staleTasks.promise).mockResolvedValue([])

    renderDialog()
    fireEvent.change(screen.getByTestId('ai-plan-available-minutes'), { target: { value: '120' } })

    expect(await screen.findByTestId('planning-context-available_minutes')).toHaveTextContent('120 分钟')

    await act(async () => {
      staleTasks.resolve([makeTask()])
      await staleTasks.promise
    })

    await waitFor(() => {
      expect(screen.getByTestId('planning-context-today_tasks')).toHaveTextContent('今日活跃任务（0）')
    })
  })
})
