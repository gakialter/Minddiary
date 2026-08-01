import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TodayActionSuggestionDialog from '../src/components/TodayActionSuggestionDialog'
import type { AIResponse, DiaryEntry, Mistake, StudyTask, Subject } from '../src/types'
import type { IdempotentAIStudyTaskCreateRequest, IdempotentAIStudyTaskCreateResponse } from '../src/types/api'
import * as agentStudyTaskActions from '../src/utils/agentStudyTaskActions'
import {
  PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY,
  savePendingStudyTaskOperation,
} from '../src/utils/pendingStudyTaskOperations'

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
    tasksCreateLegacy: vi.fn(),
    mistakesGetAll: vi.fn(),
    subjectsGetAll: vi.fn(),
    entriesGetByDate: vi.fn(),
    onClose: vi.fn(),
    onCreated: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mocks.tasksCreate.mockReset()
    mocks.aiChat.mockResolvedValue({ content: validAiResponse })
    mocks.tasksGetByDate.mockResolvedValue([])
    mocks.tasksCreate.mockResolvedValue(makeTask())
    mocks.mistakesGetAll.mockResolvedValue({ data: [mistake], total: 1, masteredTotal: 0 })
    mocks.subjectsGetAll.mockResolvedValue([subject])
    mocks.entriesGetByDate.mockResolvedValue(entry)
  })

  const dialogElement = (date = '2026-06-12') => {
    const tasksAPI = {
      getByDate: mocks.tasksGetByDate,
      create: mocks.tasksCreateLegacy,
      createIdempotentAIStudyTaskForCurrentDate: async (
        request: IdempotentAIStudyTaskCreateRequest,
      ): Promise<IdempotentAIStudyTaskCreateResponse> => {
        const result = await mocks.tasksCreate(request.payload, request.expectedCurrentDate, request)
        if (result && typeof result === 'object' && 'ok' in result) {
          return { ...result, operationId: request.operationId } as IdempotentAIStudyTaskCreateResponse
        }
        return { ok: true, operationId: request.operationId, task: result, replayed: false }
      },
    }
    return (
      <TodayActionSuggestionDialog
        date={date}
        aiAPI={{ chat: mocks.aiChat }}
        tasksAPI={tasksAPI}
        mistakesAPI={{ getAll: mocks.mistakesGetAll }}
        subjectsAPI={{ getAll: mocks.subjectsGetAll }}
        entriesAPI={{ getByDate: mocks.entriesGetByDate }}
        onClose={mocks.onClose}
        onCreated={mocks.onCreated}
      />
    )
  }

  const renderDialog = (date = '2026-06-12') => render(dialogElement(date))

  it('generates validated suggestions and creates selected tasks only after user confirmation', async () => {
    renderDialog()

    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    expect(await screen.findByDisplayValue('复习函数极限错题')).toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    await waitFor(() => {
      expect(mocks.tasksCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '复习函数极限错题',
          type: 'review',
          source: 'ai',
          status: 'todo',
          planned_date: '2026-06-12',
          related_mistake_id: 12,
          subject_id: 1,
        }),
        '2026-06-12',
        expect.objectContaining({ operationKind: 'today_action' }),
      )
      expect(mocks.onCreated).toHaveBeenCalled()
    })
    expect(mocks.tasksCreateLegacy).not.toHaveBeenCalled()
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
    fireEvent.change(screen.getByLabelText('建议标题'), { target: { value: '编辑后的函数极限复习' } })
    fireEvent.change(screen.getByLabelText('预计分钟'), { target: { value: '30' } })

    expect(screen.getByLabelText('关联到期错题')).toHaveValue('13')
    expect(screen.getByLabelText('关联今日日记')).toHaveValue('5')
    expect(screen.getByLabelText('建议标题')).toHaveValue('编辑后的函数极限复习')
    expect(screen.getByLabelText('预计分钟')).toHaveValue(30)
    expect(screen.getByText('本地依据：到期错题：#13 导数符号错误')).toBeInTheDocument()
    expect(screen.getByText('本地依据：今日日记：Today')).toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '编辑后的函数极限复习',
        estimate_minutes: 30,
        related_mistake_id: 13,
        related_entry_id: 5,
        planned_date: '2026-06-12',
      }),
      '2026-06-12',
      expect.objectContaining({ operationKind: 'today_action' }),
    ))
  })

  it('clamps available time to the supported daily capacity range', async () => {
    renderDialog()
    await screen.findByTestId('planning-context-available_minutes')
    const available = screen.getByTestId('ai-plan-available-minutes')

    fireEvent.change(available, { target: { value: '0' } })
    expect(available).toHaveValue(5)
    fireEvent.change(available, { target: { value: '1000' } })
    expect(available).toHaveValue(720)
    expect(await screen.findByTestId('planning-context-available_minutes')).toHaveTextContent('720 分钟')
  })

  it('requires a second explicit confirmation when the planning context becomes stale', async () => {
    const createActionSpy = vi.spyOn(agentStudyTaskActions, 'createConfirmedStudyTaskAction')
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
    expect(createActionSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))
    expect(createActionSpy).toHaveBeenCalledTimes(1)
    const snapshot = createActionSpy.mock.calls[0]?.[0].confirmationSnapshot
    expect(snapshot?.generation.operationKind).toBe('today_action')
    expect(snapshot?.generation.versions.promptVersion).toBe('today-action.prompt.v1')
    expect(snapshot?.generation.generationContextSignature)
      .not.toBe(snapshot?.confirmationContextSignature)
    expect(snapshot?.generation.generationContextSignature).not.toContain('新出现的任务')
    expect(snapshot?.confirmationContextSignature).toContain('新出现的任务')
    createActionSpy.mockRestore()
  })

  it('preserves partial success, reports it, and retries only failed candidates', async () => {
    const createActionSpy = vi.spyOn(agentStudyTaskActions, 'createConfirmedStudyTaskAction')
    const createdA = makeTask({ id: 201, title: '任务 A', type: 'focus', subject_id: null, related_mistake_id: null })
    const createdB = makeTask({ id: 202, title: '任务 B', type: 'focus', subject_id: null, related_mistake_id: null })
    let taskRows: StudyTask[] = []
    mocks.tasksGetByDate.mockImplementation(async () => taskRows)
    mocks.aiChat.mockResolvedValue({ content: twoCandidateResponse })
    mocks.tasksCreate.mockReset()
    mocks.tasksCreate
      .mockResolvedValueOnce(createdA)
      .mockResolvedValueOnce({
        ok: false,
        code: 'INTEGRITY_ERROR',
        message: 'second write failed',
      })
      .mockResolvedValueOnce(createdB)

    renderDialog()
    await screen.findByTestId('planning-context-today_tasks')
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('任务 A')

    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    expect(await screen.findByTestId('ai-plan-creation-summary')).toHaveTextContent('本次已创建 1 项，失败 1 项')
    expect(screen.getByText('second write failed')).toBeInTheDocument()
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(2)
    expect(createActionSpy).toHaveBeenCalledTimes(2)
    const firstSnapshot = createActionSpy.mock.calls[0]?.[0].confirmationSnapshot
    const secondSnapshot = createActionSpy.mock.calls[1]?.[0].confirmationSnapshot
    expect(firstSnapshot).toBeDefined()
    expect(secondSnapshot).toBe(firstSnapshot)

    taskRows = [createdA]
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(3))

    const createdTitles = mocks.tasksCreate.mock.calls.map(([input]) => input.title)
    expect(createdTitles.filter(title => title === '任务 A')).toHaveLength(1)
    expect(createdTitles.filter(title => title === '任务 B')).toHaveLength(2)
    expect(createActionSpy.mock.calls[2]?.[0].confirmationSnapshot.generation)
      .toBe(firstSnapshot?.generation)
    createActionSpy.mockRestore()
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

  it('unlocks generation and ignores an old-date AI response after the date changes', async () => {
    const createActionSpy = vi.spyOn(agentStudyTaskActions, 'createConfirmedStudyTaskAction')
    const oldRequest = createDeferred<AIResponse>()
    const newDateResponse = JSON.stringify({
      suggestions: [
        {
          title: '新日期专注任务',
          type: 'focus',
          estimate_minutes: 20,
          reason: '只属于新日期。',
          priority: 'medium',
        },
      ],
    })
    mocks.aiChat
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce({ content: newDateResponse })

    const view = renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    await waitFor(() => expect(mocks.aiChat).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('ai-plan-generate')).toHaveTextContent('生成中...')
    expect(screen.getByLabelText('关闭 AI 今日行动建议')).toBeDisabled()

    view.rerender(dialogElement('2026-06-13'))

    await waitFor(() => expect(screen.getByLabelText('关闭 AI 今日行动建议')).not.toBeDisabled())
    expect(screen.getByTestId('ai-plan-generate')).not.toHaveTextContent('生成中...')
    expect(screen.queryByDisplayValue('复习函数极限错题')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-plan-errors')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-plan-stale-context')).not.toBeInTheDocument()

    await act(async () => {
      oldRequest.resolve({ content: validAiResponse })
      await oldRequest.promise
    })

    expect(screen.queryByDisplayValue('复习函数极限错题')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-plan-errors')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-plan-stale-context')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    expect(await screen.findByDisplayValue('新日期专注任务')).toBeInTheDocument()
    expect(mocks.aiChat).toHaveBeenCalledTimes(2)
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
    expect(mocks.tasksCreateLegacy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    await waitFor(() => expect(createActionSpy).toHaveBeenCalledTimes(1))
    const snapshot = createActionSpy.mock.calls[0]?.[0].confirmationSnapshot
    const generatedContext = JSON.parse(snapshot?.generation.generationContextSignature || '{}') as {
      date?: string
    }
    expect(generatedContext.date).toBe('2026-06-13')
    createActionSpy.mockRestore()
  })

  it('stops the remaining confirmed writes when the dialog unmounts during creation', async () => {
    const firstWrite = createDeferred<StudyTask>()
    mocks.aiChat.mockResolvedValue({ content: twoCandidateResponse })
    mocks.tasksCreate.mockReset()
    mocks.tasksCreate
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce(makeTask({ id: 202, title: '任务 B', type: 'focus' }))

    const view = renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('任务 A')
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))

    view.unmount()
    await act(async () => {
      firstWrite.resolve(makeTask({ id: 201, title: '任务 A', type: 'focus' }))
      await firstWrite.promise
    })

    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
    expect(mocks.onCreated).not.toHaveBeenCalled()
  })

  it('resets an in-flight old-date creation when the dialog date changes without unmounting', async () => {
    const firstWrite = createDeferred<StudyTask>()
    mocks.aiChat.mockResolvedValue({ content: twoCandidateResponse })
    mocks.tasksCreate.mockReset()
    mocks.tasksCreate
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce(makeTask({ id: 202, title: '任务 B', type: 'focus' }))

    const view = renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('任务 A')
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))

    view.rerender(dialogElement('2026-06-13'))
    await act(async () => {
      firstWrite.resolve(makeTask({ id: 201, title: '任务 A', type: 'focus' }))
      await firstWrite.promise
    })

    await waitFor(() => expect(screen.getByLabelText('关闭 AI 今日行动建议')).not.toBeDisabled())
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
    expect(mocks.onCreated).not.toHaveBeenCalled()
    expect(screen.queryByDisplayValue('任务 A')).not.toBeInTheDocument()
  })

  it('closes without creating any task when the user has not confirmed', async () => {
    renderDialog()
    await screen.findByTestId('planning-context-preview')

    fireEvent.click(screen.getByLabelText('关闭 AI 今日行动建议'))

    expect(mocks.onClose).toHaveBeenCalledTimes(1)
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
    expect(mocks.tasksCreateLegacy).not.toHaveBeenCalled()
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

  it('persists the exact pending operation before invoking the desktop route', async () => {
    mocks.tasksCreate.mockImplementationOnce(async (payload, expectedDate, request) => {
      const serialized = localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)
      expect(serialized).not.toBeNull()
      const envelope = JSON.parse(serialized!) as { operations: IdempotentAIStudyTaskCreateRequest[] }
      expect(envelope.operations).toHaveLength(1)
      expect(envelope.operations[0]).toMatchObject({
        operationId: request.operationId,
        operationKind: 'today_action',
        expectedCurrentDate: expectedDate,
        payload,
      })
      return makeTask({
        title: payload.title,
        description: payload.description,
        planned_date: payload.planned_date,
      })
    })

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('复习函数极限错题')
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))
    expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
  })

  it('retains an uncertain operation across restart and recovers with the same ID and payload only on click', async () => {
    mocks.tasksCreate
      .mockRejectedValueOnce(new Error('reply lost'))
      .mockResolvedValueOnce({
        ok: true,
        task: makeTask({ id: 303 }),
        replayed: true,
      })

    const firstView = renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    const titleInput = await screen.findByDisplayValue('复习函数极限错题')
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    expect(await screen.findByText(/任务创建结果不确定/)).toBeInTheDocument()
    expect(titleInput).toBeDisabled()
    expect(mocks.onCreated).not.toHaveBeenCalled()
    const stored = JSON.parse(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)!) as {
      operations: Array<IdempotentAIStudyTaskCreateRequest & { createdAt: string }>
    }
    const pending = stored.operations[0]!
    const firstRequest = mocks.tasksCreate.mock.calls[0]?.[2] as IdempotentAIStudyTaskCreateRequest
    expect(pending.operationId).toBe(firstRequest.operationId)
    expect(pending.payload).toEqual(firstRequest.payload)

    firstView.unmount()
    mocks.onCreated.mockClear()
    renderDialog()
    expect(await screen.findByTestId('pending-study-task-recovery-today_action')).toBeInTheDocument()
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId(`recover-pending-study-task-${pending.operationId}`))
    expect(await screen.findByText('已重放原操作，并恢复此前创建的同一任务。')).toBeInTheDocument()
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(2)
    const retryRequest = mocks.tasksCreate.mock.calls[1]?.[2] as IdempotentAIStudyTaskCreateRequest
    expect(retryRequest.operationId).toBe(firstRequest.operationId)
    expect(retryRequest.payload).toEqual(firstRequest.payload)
    expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
    expect(mocks.onCreated).toHaveBeenCalledTimes(1)
  })

  it('retains and locks an idempotency conflict for explicit inspection', async () => {
    mocks.tasksCreate.mockResolvedValueOnce({
      ok: false,
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'operation ID already belongs to different content',
    })

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    const titleInput = await screen.findByDisplayValue('复习函数极限错题')
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    expect(await screen.findByText('operation ID already belongs to different content')).toBeInTheDocument()
    expect(titleInput).toBeDisabled()
    expect(screen.getByTestId('pending-study-task-recovery-today_action')).toBeInTheDocument()
    expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).not.toBeNull()
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
  })

  it('keeps an uncertain operation unchanged when the dialog date changes', async () => {
    mocks.tasksCreate.mockRejectedValueOnce(new Error('reply lost'))
    const view = renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('复习函数极限错题')
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    expect(await screen.findByText(/任务创建结果不确定/)).toBeInTheDocument()

    const before = localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)
    const pending = JSON.parse(before!) as { operations: Array<{ operationId: string }> }
    view.rerender(dialogElement('2026-06-13'))

    expect(await screen.findByTestId(`pending-study-task-operation-${pending.operations[0]!.operationId}`))
      .toBeInTheDocument()
    expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBe(before)
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('复习函数极限错题')
    expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBe(before)
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
  })

  it('does not invoke task creation when the pending record cannot be saved', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded')
    })
    try {
      renderDialog()
      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      await screen.findByDisplayValue('复习函数极限错题')
      fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

      expect(await screen.findByText(/无法先保存本地恢复记录/)).toBeInTheDocument()
      expect(mocks.tasksCreate).not.toHaveBeenCalled()
    } finally {
      setItem.mockRestore()
    }
  })

  it.each([
    ['DATE_MISMATCH', 'confirmed date is stale'],
    ['RESULT_DELETED', 'the original task was deleted'],
  ] as const)('clears a definite %s recovery result without automatic or replacement writes', async (code, message) => {
    const operationId = '11111111-1111-4111-8111-111111111111'
    savePendingStudyTaskOperation({
      operationId,
      operationKind: 'today_action',
      actionContractVersion: 'confirmed-study-task-action.v1',
      expectedCurrentDate: '2026-06-11',
      payload: {
        title: '旧日期待恢复任务',
        description: '只允许检查原操作。',
        type: 'focus',
        subject_id: null,
        related_mistake_id: null,
        related_entry_id: null,
        related_chapter_id: null,
        planned_date: '2026-06-11',
        estimate_minutes: 25,
        status: 'todo',
        source: 'ai',
      },
    })
    mocks.tasksCreate.mockResolvedValueOnce({ ok: false, code, message })

    renderDialog('2026-06-12')
    expect(await screen.findByTestId('pending-study-task-recovery-today_action')).toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId(`recover-pending-study-task-${operationId}`))
    expect(await screen.findByText(`任务未创建，恢复记录已结束：${message}`)).toBeInTheDocument()
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
    expect(mocks.onCreated).not.toHaveBeenCalled()
  })
})
