import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TodayActionSuggestionDialog from '../src/components/TodayActionSuggestionDialog'
import type { AIResponse, DiaryEntry, Mistake, StudyTask, Subject, SubjectChapter } from '../src/types'
import type { IdempotentAIStudyTaskCreateRequest, IdempotentAIStudyTaskCreateResponse } from '../src/types/api'
import type {
  PlanningRunCreateRequest,
  PlanningRunListResult,
  PlanningRunRecord,
  PlanningRunTransitionRequest,
} from '../src/types/planningHistory'
import * as agentStudyTaskActions from '../src/utils/agentStudyTaskActions'
import {
  computeTodayActionChapterSignature,
  computeTodayActionGenerationContextSignature,
} from '../src/utils/todayActionChapterContext'
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

type IdempotentRoute = (
  request: IdempotentAIStudyTaskCreateRequest,
  planningCandidateId?: number,
) => Promise<IdempotentAIStudyTaskCreateResponse>

const makePlanningRun = (request: PlanningRunCreateRequest): PlanningRunRecord => ({
  ...request,
  contextSummary: [...request.contextSummary],
  createdAt: '2026-06-12T00:00:00.000Z',
  updatedAt: '2026-06-12T00:00:00.000Z',
  closedAt: null,
  closeReason: null,
  candidates: request.candidates.map((candidate, index) => ({
    ...candidate,
    id: 701 + index,
    editBefore: {},
    outcomeKind: null,
    outcomeObservedAt: null,
    admittedAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    sourceRelations: { subject: null, mistake: null, entry: null },
    editBeforeSourceRelations: { subject: null, mistake: null, entry: null },
    taskRelation: null,
    executionAttribution: null,
  })),
})

const makeHistoricalRun = (overrides: Partial<PlanningRunRecord> = {}): PlanningRunRecord => ({
  id: 'historical-run-1',
  entryPoint: 'today_action',
  planningDate: '2026-06-11',
  targetDate: '2026-06-11',
  generationResultKind: 'candidate_set',
  contextSummary: [],
  createdAt: '2026-06-11T08:00:00.000Z',
  updatedAt: '2026-06-11T08:05:00.000Z',
  closedAt: '2026-06-11T08:10:00.000Z',
  closeReason: 'dialog_closed',
  candidates: [
    {
      id: 901,
      ordinal: 0,
      title: '历史任务 A',
      description: '历史原因',
      type: 'focus',
      estimateMinutes: 30,
      priority: 'high',
      subjectId: null,
      relatedMistakeId: null,
      relatedEntryId: null,
      admissionOrigin: 'provider_validated',
      editBefore: {},
      editBeforeSourceRelations: { subject: null, mistake: null, entry: null },
      userDisposition: 'confirmed',
      outcomeKind: 'created',
      outcomeObservedAt: '2026-06-11T08:05:00.000Z',
      admittedAt: '2026-06-11T08:00:00.000Z',
      updatedAt: '2026-06-11T08:05:00.000Z',
      sourceRelations: { subject: null, mistake: null, entry: null },
      taskRelation: { available: true, title: '历史任务 A', status: 'done' },
      executionAttribution: {
        kind: 'verified_linked',
        receiptValidated: true,
        taskId: 55,
        taskCurrentTitle: '历史任务 A',
        taskCurrentStatus: 'done',
        semanticDrift: { hasDrift: false, differences: {} },
        focus: {
          state: 'available',
          totalDurationMinutes: 45,
          sessionCount: 2,
          unavailableReason: null,
        },
      },
    },
  ],
  ...overrides,
})

const subject: Subject = { id: 1, name: '数学', color: '#2563eb' }
const chapter: SubjectChapter = {
  id: 21,
  subject_id: 1,
  title: '函数极限',
  notes: '',
  completed: false,
  sort_order: 0,
  created_at: '2026-06-12T00:00:00.000Z',
  updated_at: '2026-06-12T00:00:00.000Z',
}
const chapterProjection = {
  chapter_progress: [{ subject_ref: 'subject:1', title: '函数极限', completed: false }],
}

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

const createValidationThenMalformedResponse = (operationId: string) => {
  const validTask = makeTask()
  const rawMalformedTask = {
    ...validTask,
    title: 'RAW_SECRET_TASK_TITLE',
    RAW_SECRET_FIELD: 'RAW_SECRET_TASK_FIELD',
  }
  const target = {
    ok: true as const,
    operationId,
    task: validTask,
    replayed: false,
  }
  const targetDescriptors = Object.getOwnPropertyDescriptors(target)
  const validTaskDescriptors = Object.getOwnPropertyDescriptors(validTask)
  const malformedTaskDescriptors = Object.getOwnPropertyDescriptors(rawMalformedTask)
  let taskReads = 0
  const response = new Proxy(target, {
    get(current, key, receiver) {
      if (key === 'task') {
        taskReads += 1
        return taskReads === 1 ? validTask : rawMalformedTask
      }
      return Reflect.get(current, key, receiver)
    },
  }) as IdempotentAIStudyTaskCreateResponse

  return {
    response,
    getTaskReads: () => taskReads,
    assertDescriptorsUnchanged: () => {
      expect(Object.getOwnPropertyDescriptors(target)).toEqual(targetDescriptors)
      expect(Object.getOwnPropertyDescriptors(validTask)).toEqual(validTaskDescriptors)
      expect(Object.getOwnPropertyDescriptors(rawMalformedTask)).toEqual(malformedTaskDescriptors)
    },
  }
}

const captureConsole = () => {
  const spies = [
    vi.spyOn(console, 'debug'),
    vi.spyOn(console, 'error'),
    vi.spyOn(console, 'info'),
    vi.spyOn(console, 'log'),
    vi.spyOn(console, 'warn'),
  ]
  return {
    expectNoRawSecret() {
      const output = spies.flatMap(spy => spy.mock.calls).flat().map(value => {
        if (typeof value === 'string') return value
        try {
          return JSON.stringify(value)
        } catch {
          return String(value)
        }
      }).join('\n')
      expect(output).not.toContain('RAW_SECRET_')
    },
    restore() {
      spies.forEach(spy => spy.mockRestore())
    },
  }
}

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
    chaptersGetBySubject: vi.fn(),
    tasksGetChapterContext: vi.fn(),
    tasksAuthorizeStaleReview: vi.fn(),
    tasksGetCommittedStatus: vi.fn(),
    entriesGetByDate: vi.fn(),
    onClose: vi.fn(),
    onCreated: vi.fn(),
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    localStorage.clear()
    delete window.api.planningRuns
    mocks.tasksCreate.mockReset()
    mocks.aiChat.mockResolvedValue({ content: validAiResponse })
    mocks.tasksGetByDate.mockResolvedValue([])
    mocks.tasksCreate.mockResolvedValue(makeTask())
    mocks.mistakesGetAll.mockResolvedValue({ data: [mistake], total: 1, masteredTotal: 0 })
    mocks.subjectsGetAll.mockResolvedValue([subject])
    mocks.chaptersGetBySubject.mockResolvedValue([chapter])
    mocks.tasksGetChapterContext.mockImplementation(async () => ({
      chapterProjection,
      currentChapterSignature: await computeTodayActionChapterSignature(chapterProjection),
    }))
    mocks.tasksAuthorizeStaleReview.mockResolvedValue({ staleReviewToken: 'e'.repeat(64) })
    mocks.tasksGetCommittedStatus.mockImplementation(async request => ({
      status: 'NOT_COMMITTED' as const,
      operationId: request.operationId,
    }))
    mocks.entriesGetByDate.mockResolvedValue(entry)
  })

  const dialogElement = (date = '2026-06-12', routeOverride?: IdempotentRoute) => {
    const tasksAPI = {
      getByDate: mocks.tasksGetByDate,
      create: mocks.tasksCreateLegacy,
      createIdempotentAIStudyTaskForCurrentDate: routeOverride ?? (async (
        request: IdempotentAIStudyTaskCreateRequest,
        planningCandidateId?: number,
      ): Promise<IdempotentAIStudyTaskCreateResponse> => {
        const result = planningCandidateId === undefined
          ? await mocks.tasksCreate(request.payload, request.expectedCurrentDate, request)
          : await mocks.tasksCreate(request.payload, request.expectedCurrentDate, request, planningCandidateId)
        if (result && typeof result === 'object' && 'ok' in result) {
          return { ...result, operationId: request.operationId } as IdempotentAIStudyTaskCreateResponse
        }
        return { ok: true, operationId: request.operationId, task: result, replayed: false }
      }),
      getTodayActionAuthoritativeChapterContext: mocks.tasksGetChapterContext,
      authorizeTodayActionStaleReview: mocks.tasksAuthorizeStaleReview,
      getCommittedAIStudyTaskOperationStatus: mocks.tasksGetCommittedStatus,
    }
    return (
      <TodayActionSuggestionDialog
        date={date}
        aiAPI={{ chat: mocks.aiChat }}
        tasksAPI={tasksAPI}
        mistakesAPI={{ getAll: mocks.mistakesGetAll }}
        subjectsAPI={{ getAll: mocks.subjectsGetAll }}
        subjectChaptersAPI={{ getBySubject: mocks.chaptersGetBySubject }}
        entriesAPI={{ getByDate: mocks.entriesGetByDate }}
        onClose={mocks.onClose}
        onCreated={mocks.onCreated}
      />
    )
  }

  const renderDialog = (date = '2026-06-12', routeOverride?: IdempotentRoute) => (
    render(dialogElement(date, routeOverride))
  )

  it('portals its viewport-fixed overlay out of a transformed scroller and owns modal scrolling', async () => {
    const transformedScroller = document.createElement('div')
    const renderHost = document.createElement('div')
    const opener = document.createElement('button')
    transformedScroller.style.transform = 'translateZ(0)'
    transformedScroller.style.overflow = 'auto'
    transformedScroller.append(renderHost)
    document.body.append(transformedScroller, opener)
    opener.focus()

    const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY')
    const previousBodyOverflow = document.body.style.overflow
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 480 })
    document.body.style.overflow = 'auto'
    let unmount: (() => void) | undefined

    try {
      const view = render(dialogElement(), { container: renderHost })
      unmount = view.unmount
      await screen.findByTestId('planning-context-preview')

      const dialog = screen.getByRole('dialog', { name: 'AI 规划今日行动' })
      expect(window.scrollY).toBe(480)
      expect(dialog.parentElement).toBe(document.body)
      expect(transformedScroller.contains(dialog)).toBe(false)
      expect(dialog).toHaveStyle({ position: 'fixed', inset: '0' })
      expect(screen.getByTestId('today-action-dialog-content')).toHaveStyle({
        overflowY: 'auto',
        maxHeight: 'min(580px, calc(100vh - 220px))',
      })
      expect(document.body.style.overflow).toBe('hidden')
      expect(screen.getByRole('button', { name: '关闭 AI 今日行动建议' })).toHaveFocus()

      const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ))
      const firstFocusable = focusableElements[0]!
      const lastFocusable = focusableElements[focusableElements.length - 1]!
      lastFocusable.focus()
      fireEvent.keyDown(dialog, { key: 'Tab' })
      expect(firstFocusable).toHaveFocus()
      firstFocusable.focus()
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
      expect(lastFocusable).toHaveFocus()

      fireEvent.keyDown(window, { key: 'Escape' })
      expect(mocks.onClose).toHaveBeenCalledTimes(1)

      view.unmount()
      unmount = undefined
      expect(document.body.style.overflow).toBe('auto')
      expect(opener).toHaveFocus()
      expect(scrollTo).not.toHaveBeenCalled()
    } finally {
      unmount?.()
      document.body.style.overflow = previousBodyOverflow
      if (originalScrollY) Object.defineProperty(window, 'scrollY', originalScrollY)
      else Reflect.deleteProperty(window, 'scrollY')
      scrollTo.mockRestore()
      transformedScroller.remove()
      opener.remove()
    }
  })

  it('distinguishes the first generation from replacement and starts B with fresh candidate state', async () => {
    const replacementResponse = JSON.stringify({
      suggestions: [
        { title: '新一轮任务 C', type: 'focus', estimate_minutes: 15, reason: '这是独立的新一轮规划。', priority: 'high' },
      ],
    })
    mocks.aiChat.mockResolvedValue({ content: twoCandidateResponse })

    renderDialog()

    const generateButton = screen.getByTestId('ai-plan-generate')
    expect(generateButton).toHaveTextContent('生成建议')
    expect(screen.queryByTestId('today-action-regeneration-warning')).not.toBeInTheDocument()

    fireEvent.click(generateButton)
    const firstTitle = await screen.findByDisplayValue('任务 A')

    expect(generateButton).toHaveTextContent('重新生成一组建议')
    expect(screen.getByTestId('today-action-regeneration-warning')).toHaveTextContent(
      '重新生成会开始一次新的规划，当前尚未确认的候选和修改将被替换',
    )
    expect(screen.getByTestId('today-action-regeneration-warning')).toHaveTextContent('已创建的任务不受影响')

    fireEvent.change(firstTitle, { target: { value: '用户修改的任务 A' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 任务 B' }))
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))

    expect(screen.getByTestId('today-action-regeneration-warning')).toBeInTheDocument()
    mocks.aiChat.mockResolvedValueOnce({ content: replacementResponse })
    fireEvent.click(generateButton)

    expect(await screen.findByDisplayValue('新一轮任务 C')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('用户修改的任务 A')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('任务 B')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 新一轮任务 C' })).toBeChecked()
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('已净编辑 0')
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('保留但未选择 0')
    expect(screen.getByTestId('today-action-candidate-decision-suggestion-1')).toHaveTextContent('新一轮任务 C')
    expect(screen.getByTestId('today-action-candidate-decision-suggestion-1')).not.toHaveTextContent('用户修改的任务 A')
    expect(mocks.aiChat).toHaveBeenCalledTimes(2)
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
  })

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
    expect(screen.getByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent('已创建任务')
  })

  it('persists only semantic planning commits and correlates confirmation with the durable candidate', async () => {
    let durableRun: PlanningRunRecord | null = null
    const create = vi.fn(async (request: PlanningRunCreateRequest) => {
      durableRun = makePlanningRun(request)
      return durableRun
    })
    const transition = vi.fn(async () => durableRun!)
    window.api.planningRuns = {
      create,
      transition,
      listRecent: vi.fn(async () => ({ items: [], nextCursor: null })),
      get: vi.fn(),
      delete: vi.fn(),
    }
    renderDialog()

    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    const title = await screen.findByLabelText('建议标题')
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      entryPoint: 'today_action',
      planningDate: '2026-06-12',
      targetDate: '2026-06-12',
      generationResultKind: 'candidate_set',
      candidates: [expect.objectContaining({ ordinal: 0, description: '今天到期,先处理薄弱点。' })],
    }))

    transition.mockClear()
    fireEvent.change(title, { target: { value: '语义提交后的标题' } })
    expect(transition).not.toHaveBeenCalled()
    fireEvent.blur(title)
    await waitFor(() => expect(transition).toHaveBeenCalledWith({
      kind: 'commit_candidate',
      runId: durableRun!.id,
      ordinal: 0,
      candidate: expect.objectContaining({ title: '语义提交后的标题' }),
    }))

    const checkbox = screen.getByRole('checkbox', { name: '选择 语义提交后的标题' })
    fireEvent.click(checkbox)
    await waitFor(() => expect(transition).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'set_selection', selected: false, ordinal: 0,
    })))
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: '语义提交后的标题' }),
      '2026-06-12',
      expect.objectContaining({ operationKind: 'today_action' }),
      701,
    ))
  })

  it('closes a pending durable create with date_rollover when the date changes first', async () => {
    const deferred = createDeferred<PlanningRunRecord>()
    let createRequest: PlanningRunCreateRequest | null = null
    const create = vi.fn((request: PlanningRunCreateRequest) => {
      createRequest = request
      return deferred.promise
    })
    const transition = vi.fn(async (request: PlanningRunTransitionRequest) => ({
      ...makePlanningRun(createRequest!),
      closedAt: '2026-06-12T01:00:00.000Z',
      closeReason: request.kind === 'close_run' ? request.reason : null,
    }))
    window.api.planningRuns = {
      create,
      transition,
      listRecent: vi.fn(async () => ({ items: [], nextCursor: null })),
      get: vi.fn(),
      delete: vi.fn(),
    }
    const view = renderDialog()

    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    view.rerender(dialogElement('2026-06-13'))
    await act(async () => {
      deferred.resolve(makePlanningRun(createRequest!))
      await deferred.promise
    })

    await waitFor(() => expect(transition).toHaveBeenCalledWith({
      kind: 'close_run',
      runId: createRequest!.id,
      reason: 'date_rollover',
    }))
  })

  it('shows local planning context before an AI request without creating tasks', async () => {
    mocks.tasksGetByDate.mockResolvedValue([makeTask()])

    renderDialog()

    expect(await screen.findByTestId('planning-context-today_tasks')).toHaveTextContent('本地已准备：今日活跃任务（1）')
    expect(screen.getByTestId('planning-context-due_mistakes')).toHaveTextContent('本地已准备：今日到期错题（1）')
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

    expect(await screen.findByText('关联的今日日记当前不可用，请重新选择或取消关联。')).toBeInTheDocument()
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('初始通过验证 0')
    expect(screen.getByRole('option', { name: '今天没有可关联日记' })).toBeInTheDocument()
    expect(screen.getByTestId('ai-plan-create-selected')).toBeDisabled()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('admits an initially invalid provider candidate only at its first repaired valid snapshot', async () => {
    mocks.entriesGetByDate.mockResolvedValue(null)
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [{
          title: '写复盘', type: 'diary', estimate_minutes: 10, reason: '记录今天。', priority: 'low', related_entry_ref: 'entry:5',
        }],
      }),
    })

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('写复盘')
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('初始通过验证 0')
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')
    expect(document.body.innerHTML).not.toContain('entry:5')

    fireEvent.change(screen.getByLabelText('关联今日日记'), { target: { value: '' } })
    await waitFor(() => expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 1'))
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('初始通过验证 0')
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('已净编辑 0')
    const repairedDecision = screen.getByTestId('today-action-candidate-decision-suggestion-1')
    expect(repairedDecision).toHaveTextContent('模型候选：用户修复后通过本地验证')
    expect(repairedDecision).not.toHaveTextContent('entry:5')

    fireEvent.change(screen.getByLabelText('建议标题'), { target: { value: '写深度复盘' } })
    await waitFor(() => expect(repairedDecision).toHaveTextContent('标题：写复盘 → 写深度复盘'))
    fireEvent.change(screen.getByLabelText('建议标题'), { target: { value: '写复盘' } })
    await waitFor(() => expect(repairedDecision).not.toHaveTextContent('标题：'))

    const selection = screen.getByRole('checkbox', { name: '选择 写复盘' })
    fireEvent.click(selection)
    fireEvent.click(selection)
    await waitFor(() => expect(repairedDecision).toHaveTextContent('保留但未选择'))
    expect(repairedDecision).toHaveTextContent('模型候选：用户修复后通过本地验证')

    fireEvent.click(screen.getByRole('button', { name: '删除建议' }))
    expect(repairedDecision).toHaveTextContent('已移除')
    expect(repairedDecision).toHaveTextContent('模型候选：用户修复后通过本地验证')

    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('写复盘')
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')
    expect(screen.queryByTestId('today-action-candidate-decision-suggestion-1')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('关联今日日记'), { target: { value: '' } })
    await waitFor(() => expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 1'))

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 写复盘' }))
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    expect(await screen.findByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent('已创建任务')
    expect(screen.getByTestId('today-action-candidate-decision-suggestion-1')).toHaveTextContent(
      '模型候选：用户修复后通过本地验证',
    )
    expect(screen.getByTestId('today-action-candidate-decision-suggestion-1')).toHaveTextContent('已确认')
  })

  it('repairs an unselected candidate without admitting another invalid unselected candidate', async () => {
    mocks.tasksGetByDate.mockResolvedValue([makeTask({ title: '已存在的其他复习任务' })])
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [
          {
            title: '共享候选标题',
            type: 'review',
            estimate_minutes: 10,
            reason: 'A 与已有 review mistake 冲突。',
            priority: 'high',
            subject_ref: 'subject:1',
            related_mistake_ref: 'mistake:12',
          },
          {
            title: '共享候选标题',
            type: 'RAW_INVALID_TYPE_B',
            estimate_minutes: 10,
            reason: '只修复并创建 B。',
            priority: 'medium',
          },
        ],
      }),
    })

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    expect(await screen.findByText('这道错题在计划日期已有复习任务，请取消关联或不选择此建议。')).toBeInTheDocument()
    expect(screen.getByText('这个建议的任务类型无法识别，请调整后再试。')).toBeInTheDocument()
    const selections = screen.getAllByRole('checkbox', { name: '选择 共享候选标题' })
    expect(selections[0]).not.toBeChecked()
    expect(selections[1]).not.toBeChecked()

    fireEvent.change(screen.getAllByLabelText('建议类型')[1]!, { target: { value: 'focus' } })

    await waitFor(() => {
      expect(screen.queryByText('这个建议的任务类型无法识别，请调整后再试。')).not.toBeInTheDocument()
      expect(screen.queryByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).not.toBeInTheDocument()
      expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 1')
    })
    const repairedDecision = screen.getByTestId('today-action-candidate-decision-suggestion-2')
    expect(repairedDecision).toHaveTextContent('模型候选：用户修复后通过本地验证')
    expect(screen.queryByTestId('today-action-candidate-decision-suggestion-1')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('checkbox', { name: '选择 共享候选标题' })[1]!)
    await waitFor(() => expect(screen.getByTestId('ai-plan-create-selected')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('today-action-confirmed-outcome-suggestion-2')).toHaveTextContent('已创建任务')
    expect(repairedDecision).toHaveTextContent('模型候选：用户修复后通过本地验证')
    expect(repairedDecision).toHaveTextContent('已确认')
  })

  it('does not pollute a selected candidate with a repaired peer hypothetical admission error', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [
          {
            title: '保持有效的已选任务',
            type: 'focus',
            estimate_minutes: 10,
            reason: 'A 当前有效且已选择。',
            priority: 'high',
          },
          {
            title: '',
            type: 'focus',
            estimate_minutes: 10,
            reason: 'B 需要用户修复。',
            priority: 'medium',
          },
        ],
      }),
    })

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    const selectedA = await screen.findByRole('checkbox', { name: '选择 保持有效的已选任务' })
    const unselectedB = screen.getByRole('checkbox', { name: '选择 suggestion-2' })
    expect(selectedA).toBeChecked()
    expect(unselectedB).not.toBeChecked()
    expect(screen.getByTestId('ai-plan-create-selected')).not.toBeDisabled()

    fireEvent.change(screen.getAllByLabelText('建议标题')[1]!, {
      target: { value: '保持有效的已选任务' },
    })

    await waitFor(() => {
      expect(screen.getAllByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).toHaveLength(1)
      expect(screen.getByTestId('ai-plan-create-selected')).not.toBeDisabled()
    })
    expect(selectedA).toBeChecked()
    expect(screen.getAllByRole('checkbox', { name: '选择 保持有效的已选任务' })[1]).not.toBeChecked()
    expect(screen.queryByTestId('today-action-candidate-decision-suggestion-2')).not.toBeInTheDocument()

    fireEvent.change(screen.getAllByLabelText('建议标题')[1]!, {
      target: { value: '修复后的唯一任务' },
    })

    await waitFor(() => {
      expect(screen.queryByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).not.toBeInTheDocument()
      expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 1')
    })
    const repairedDecision = screen.getByTestId('today-action-candidate-decision-suggestion-2')
    expect(repairedDecision).toHaveTextContent('模型候选：用户修复后通过本地验证')
    expect(selectedA).toBeChecked()

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 修复后的唯一任务' }))
    await waitFor(() => expect(screen.getByTestId('ai-plan-create-selected')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('today-action-confirmed-outcome-suggestion-2')).toHaveTextContent('已创建任务')
  })

  it('does not admit from context refresh or selection and admits only the edited conflict transition', async () => {
    mocks.tasksGetByDate.mockResolvedValue([makeTask({
      id: 201,
      title: '已存在的冲突任务',
      type: 'focus',
      subject_id: null,
      related_mistake_id: null,
      estimate_minutes: 10,
      source: 'manual',
    })])
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [{
          title: '已存在的冲突任务',
          type: 'focus',
          estimate_minutes: 10,
          reason: '需要用户改成不冲突的标题。',
          priority: 'medium',
        }],
      }),
    })
    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    expect(await screen.findByText('计划日期已有同名进行中任务，请修改标题或不选择此建议。')).toBeInTheDocument()
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')

    fireEvent.click(screen.getByTestId('ai-plan-refresh-context'))
    await waitFor(() => expect(screen.queryByText('计划日期已有同名进行中任务，请修改标题或不选择此建议。')).not.toBeInTheDocument())
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')
    expect(screen.queryByTestId('today-action-candidate-decision-suggestion-1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 已存在的冲突任务' }))
    expect(await screen.findByText('计划日期已有同名进行中任务，请修改标题或不选择此建议。')).toBeInTheDocument()
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')
    expect(screen.getByTestId('ai-plan-create-selected')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('建议标题'), { target: { value: '用户明确修复后的任务' } })
    await waitFor(() => {
      expect(screen.queryByText('计划日期已有同名进行中任务，请修改标题或不选择此建议。')).not.toBeInTheDocument()
      expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 1')
      expect(screen.getByTestId('ai-plan-create-selected')).not.toBeDisabled()
    })
    expect(screen.getByTestId('today-action-candidate-decision-suggestion-1')).toHaveTextContent(
      '模型候选：用户修复后通过本地验证',
    )
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('does not admit when available minutes alone clear an error and requires a later invalid-to-valid edit', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [{
          title: '预算候选',
          type: 'focus',
          estimate_minutes: 100,
          reason: '验证预算变化不会伪造用户修复。',
          priority: 'low',
        }],
      }),
    })
    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    expect(await screen.findByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('ai-plan-available-minutes'), { target: { value: '120' } })
    await waitFor(() => expect(screen.queryByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).not.toBeInTheDocument())
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 预算候选' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '选择 预算候选' })).toBeChecked())
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')
    expect(screen.getByTestId('ai-plan-create-selected')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('预计分钟'), { target: { value: '130' } })
    expect(await screen.findByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).toBeInTheDocument()
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')

    fireEvent.change(screen.getByLabelText('预计分钟'), { target: { value: '100' } })
    await waitFor(() => {
      expect(screen.queryByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).not.toBeInTheDocument()
      expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 1')
      expect(screen.getByTestId('ai-plan-create-selected')).not.toBeDisabled()
    })
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('admits one duplicate-title repair after invalid edits and normalized no-ops, including StrictMode replay', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [
          { title: '重复标题', type: 'focus', estimate_minutes: 10, reason: '第一项。', priority: 'high' },
          { title: '重复标题', type: 'focus', estimate_minutes: 10, reason: '第二项。', priority: 'medium' },
        ],
      }),
    })

    render(<StrictMode>{dialogElement()}</StrictMode>)
    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    expect(await screen.findAllByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).toHaveLength(2)
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('初始通过验证 0')
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')

    fireEvent.click(screen.getAllByRole('checkbox', { name: '选择 重复标题' })[0]!)
    await waitFor(() => expect(screen.queryByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).not.toBeInTheDocument())
    fireEvent.click(screen.getAllByRole('checkbox', { name: '选择 重复标题' })[1]!)
    await waitFor(() => expect(screen.getAllByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).toHaveLength(2))

    fireEvent.change(screen.getAllByLabelText('建议理由')[0]!, { target: { value: '仍然冲突的无关字段编辑。' } })
    await waitFor(() => {
      expect(screen.getAllByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).toHaveLength(2)
      expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')
    })

    fireEvent.change(screen.getAllByLabelText('建议标题')[0]!, { target: { value: '  重复标题  ' } })
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')
    expect(screen.queryByTestId('today-action-candidate-decision-suggestion-1')).not.toBeInTheDocument()

    fireEvent.change(screen.getAllByLabelText('建议标题')[0]!, { target: { value: '修复后的唯一标题' } })
    await waitFor(() => {
      expect(screen.queryByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).not.toBeInTheDocument()
      expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 1')
    })
    expect(screen.getAllByTestId('today-action-candidate-decision-suggestion-1')).toHaveLength(1)
    expect(screen.queryByTestId('today-action-candidate-decision-suggestion-2')).not.toBeInTheDocument()

    fireEvent.change(screen.getAllByLabelText('建议理由')[0]!, { target: { value: '通过后的再次编辑。' } })
    await waitFor(() => {
      expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 1')
      expect(screen.getAllByTestId('today-action-candidate-decision-suggestion-1')).toHaveLength(1)
    })
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('admits only the candidate whose duplicate-mistake conflict is explicitly repaired', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [
          {
            title: '错题复习 A',
            type: 'review',
            estimate_minutes: 10,
            reason: '第一项。',
            priority: 'high',
            subject_ref: 'subject:1',
            related_mistake_ref: 'mistake:12',
          },
          {
            title: '错题复习 B',
            type: 'review',
            estimate_minutes: 10,
            reason: '第二项。',
            priority: 'medium',
            subject_ref: 'subject:1',
            related_mistake_ref: 'mistake:12',
          },
        ],
      }),
    })

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    expect(await screen.findAllByText('多个选中建议关联了同一道错题，请只保留一个。')).toHaveLength(2)
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 错题复习 A' }))
    await waitFor(() => expect(screen.queryByText('多个选中建议关联了同一道错题，请只保留一个。')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 错题复习 B' }))
    await waitFor(() => expect(screen.getAllByText('多个选中建议关联了同一道错题，请只保留一个。')).toHaveLength(2))
    fireEvent.change(screen.getAllByLabelText('建议理由')[0]!, { target: { value: '仍然重复错题。' } })
    await waitFor(() => {
      expect(screen.getAllByText('多个选中建议关联了同一道错题，请只保留一个。')).toHaveLength(2)
      expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')
    })

    fireEvent.change(screen.getAllByLabelText('建议类型')[0]!, { target: { value: 'focus' } })
    await waitFor(() => {
      expect(screen.queryByText('多个选中建议关联了同一道错题，请只保留一个。')).not.toBeInTheDocument()
      expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 1')
    })
    expect(screen.getByTestId('today-action-candidate-decision-suggestion-1')).toHaveTextContent(
      '模型候选：用户修复后通过本地验证',
    )
    expect(screen.queryByTestId('today-action-candidate-decision-suggestion-2')).not.toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('admits a combined-budget repair only after the selected cohort becomes valid', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [
          { title: '预算任务 A', type: 'focus', estimate_minutes: 60, reason: '第一项。', priority: 'high' },
          { title: '预算任务 B', type: 'focus', estimate_minutes: 60, reason: '第二项。', priority: 'medium' },
        ],
      }),
    })

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    expect(await screen.findAllByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).toHaveLength(2)
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 预算任务 A' }))
    await waitFor(() => expect(screen.queryByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 预算任务 B' }))
    await waitFor(() => expect(screen.getAllByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).toHaveLength(2))
    fireEvent.change(screen.getAllByLabelText('预计分钟')[0]!, { target: { value: '50' } })
    await waitFor(() => {
      expect(screen.getAllByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).toHaveLength(2)
      expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')
    })

    fireEvent.change(screen.getAllByLabelText('预计分钟')[0]!, { target: { value: '50' } })
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')
    fireEvent.change(screen.getAllByLabelText('预计分钟')[0]!, { target: { value: '30' } })
    await waitFor(() => {
      expect(screen.queryByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).not.toBeInTheDocument()
      expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 1')
    })

    fireEvent.change(screen.getAllByLabelText('预计分钟')[0]!, { target: { value: '25' } })
    await waitFor(() => {
      expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 1')
      expect(screen.getAllByTestId('today-action-candidate-decision-suggestion-1')).toHaveLength(1)
    })
    expect(screen.queryByTestId('today-action-candidate-decision-suggestion-2')).not.toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('does not admit when peer removal or a selection toggle merely clears an aggregate error', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [
          { title: '待去重标题', type: 'focus', estimate_minutes: 10, reason: '第一项。', priority: 'high' },
          { title: '待去重标题', type: 'focus', estimate_minutes: 10, reason: '第二项。', priority: 'medium' },
        ],
      }),
    })

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    expect(await screen.findAllByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: '删除建议' })[1]!)
    await waitFor(() => expect(screen.queryByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).not.toBeInTheDocument())
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')
    expect(screen.queryByTestId('today-action-candidate-decision-suggestion-1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 待去重标题' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '选择 待去重标题' })).toBeChecked())
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 0')
    expect(screen.queryByTestId('today-action-candidate-decision-suggestion-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-plan-create-selected')).toBeDisabled()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('admits a repaired candidate once under StrictMode effect replay', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [{
          title: 'StrictMode 待修复候选',
          type: 'RAW_INVALID_SECRET_TYPE',
          estimate_minutes: 10,
          reason: '修复后只能纳入一次。',
          priority: 'low',
        }],
      }),
    })
    render(<StrictMode>{dialogElement()}</StrictMode>)
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    expect(await screen.findByText('这个建议的任务类型无法识别，请调整后再试。')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('建议类型'), { target: { value: 'focus' } })
    await waitFor(() => expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('用户修复后纳入 1'))
    expect(screen.getAllByTestId('today-action-candidate-decision-suggestion-1')).toHaveLength(1)
    expect(document.body.innerHTML).not.toContain('RAW_INVALID_SECRET_TYPE')
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('keeps the generation request snapshot separate from refreshed local preview', async () => {
    let taskRows: StudyTask[] = []
    mocks.tasksGetByDate.mockImplementation(async () => taskRows)
    renderDialog()

    await screen.findByTestId('planning-context-today_tasks')
    expect(screen.getByTestId('today-action-request-explainability')).toHaveTextContent('尚未生成')
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('复习函数极限错题')

    const requestSnapshot = screen.getByTestId('today-action-request-context-today_tasks')
    expect(requestSnapshot).toHaveTextContent('本地 0，请求 0')
    expect(screen.getByTestId('today-action-provider-usage-disclaimer')).toHaveTextContent(
      '无法证明模型内部是否实际使用了某项内容',
    )

    taskRows = [makeTask({ id: 101, title: '刷新后出现的任务', type: 'focus', related_mistake_id: null })]
    fireEvent.click(screen.getByTestId('ai-plan-refresh-context'))
    await waitFor(() => {
      expect(screen.getByTestId('planning-context-today_tasks')).toHaveTextContent('今日活跃任务（1）')
    })
    expect(requestSnapshot).toHaveTextContent('本地 0，请求 0')
    expect(document.body).not.toHaveTextContent('AI 已使用')
  })

  it('tracks bounded net edits, selection, removal, regenerate, close, and date reset in one generation', async () => {
    const view = renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    const titleInput = await screen.findByLabelText('建议标题')

    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('初始通过验证 1')
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('当前选择 1')
    expect(localStorage.length).toBe(0)

    fireEvent.change(titleInput, { target: { value: '复习导数错题' } })
    await waitFor(() => expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('已净编辑 1'))
    expect(screen.getByTestId('today-action-candidate-decision-suggestion-1')).toHaveTextContent(
      '标题：复习函数极限错题 → 复习导数错题',
    )

    fireEvent.change(titleInput, { target: { value: '复习函数极限错题' } })
    await waitFor(() => expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('已净编辑 0'))
    expect(screen.getByTestId('today-action-candidate-decision-suggestion-1')).not.toHaveTextContent('标题：')

    const checkbox = screen.getByRole('checkbox', { name: '选择 复习函数极限错题' })
    fireEvent.click(checkbox)
    await waitFor(() => expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('保留但未选择 1'))
    fireEvent.click(checkbox)
    await waitFor(() => expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('当前选择 1'))

    fireEvent.click(screen.getByRole('button', { name: '删除建议' }))
    expect(screen.queryByTestId('ai-suggestion-suggestion-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('已移除 1')
    expect(screen.getByTestId('today-action-candidate-decision-suggestion-1')).toHaveTextContent('已移除')

    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('复习函数极限错题')
    expect(screen.getByTestId('today-action-candidate-counts')).toHaveTextContent('已移除 0')

    view.rerender(dialogElement('2026-06-13'))
    await waitFor(() => expect(screen.queryByTestId('today-action-candidate-explainability')).not.toBeInTheDocument())

    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('复习函数极限错题')
    fireEvent.click(screen.getByRole('button', { name: '关闭 AI 今日行动建议' }))
    expect(mocks.onClose).toHaveBeenCalled()
    expect(screen.queryByTestId('today-action-candidate-explainability')).not.toBeInTheDocument()
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
    expect(screen.getByTestId('ai-plan-generate')).toHaveTextContent('重新生成一组建议')
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

  it('consumes a fresh-path candidate after definitive INVALID_REQUEST and blocks O2 dispatch', async () => {
    const racedProjection = {
      chapter_progress: [{ subject_ref: 'subject:1', title: '函数连续性', completed: true }],
    }
    const racedSignature = await computeTodayActionChapterSignature(racedProjection)
    const durableRuns: PlanningRunRecord[] = []
    const createPlanningRun = vi.fn(async (request: PlanningRunCreateRequest) => {
      const run = makePlanningRun(request)
      run.candidates[0]!.id = 701 + durableRuns.length
      durableRuns.push(run)
      return run
    })
    const transitionPlanningRun = vi.fn(async (request: PlanningRunTransitionRequest) => {
      const run = durableRuns.find(item => item.id === request.runId)!
      if (request.kind !== 'close_run') return run
      const closed = { ...run, closedAt: '2026-06-12T00:01:00.000Z', closeReason: request.reason }
      durableRuns[durableRuns.indexOf(run)] = closed
      return closed
    })
    window.api.planningRuns = {
      create: createPlanningRun,
      transition: transitionPlanningRun,
      listRecent: vi.fn(async () => ({ items: [], nextCursor: null })),
      get: vi.fn(),
      delete: vi.fn(),
    }
    let createAttempt = 0
    const route = vi.fn(async (
      request: IdempotentAIStudyTaskCreateRequest,
      _planningCandidateId?: number,
    ): Promise<IdempotentAIStudyTaskCreateResponse> => {
      createAttempt += 1
      if (createAttempt === 1) {
        mocks.tasksGetChapterContext.mockResolvedValue({
          chapterProjection: racedProjection,
          currentChapterSignature: racedSignature,
        })
        return {
          ok: false,
          operationId: request.operationId,
          code: 'INVALID_REQUEST',
          message: 'chapter drifted between renderer and Main',
        }
      }
      return {
        ok: true,
        operationId: request.operationId,
        task: makeTask({ id: 100, title: request.payload.title, type: request.payload.type }),
        replayed: false,
      }
    })

    renderDialog('2026-06-12', route)
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('复习函数极限错题')
    await waitFor(() => expect(createPlanningRun).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('ai-plan-generate')).toBeEnabled())

    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    await waitFor(() => expect(route).toHaveBeenCalledTimes(1))
    const firstOperationId = route.mock.calls[0]![0].operationId
    expect(route.mock.calls[0]![1]).toBe(701)
    expect(screen.getByTestId('today-action-stale-chapter-context')).toHaveTextContent(
      '当前建议已不能继续使用，请重新生成建议',
    )
    await waitFor(() => {
      expect(screen.getByTestId('today-action-refreshed-chapter-context')).toHaveTextContent('函数连续性')
    })
    expect(screen.getByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent(firstOperationId)
    expect(screen.getByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent('确认内容未通过校验')

    const checkbox = screen.getByRole('checkbox', { name: '选择 复习函数极限错题' })
    await waitFor(() => expect(checkbox).not.toBeChecked())
    expect(checkbox).toBeDisabled()
    fireEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()

    const createButton = screen.getByTestId('ai-plan-create-selected')
    expect(createButton).toBeDisabled()
    createButton.removeAttribute('disabled')
    fireEvent.click(createButton)
    await waitFor(() => expect(route).toHaveBeenCalledTimes(1))
    expect(mocks.tasksAuthorizeStaleReview).not.toHaveBeenCalled()
    expect(screen.queryByTestId('today-action-accept-stale-chapter-context')).not.toBeInTheDocument()

    mocks.aiChat.mockResolvedValueOnce({
      content: JSON.stringify({
        suggestions: [{
          title: '重新生成后的任务',
          type: 'focus',
          estimate_minutes: 15,
          reason: '使用新的候选身份。',
          priority: 'high',
        }],
      }),
    })
    mocks.chaptersGetBySubject.mockResolvedValueOnce([{
      ...chapter,
      title: '函数连续性',
      completed: true,
    }])
    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    expect(await screen.findByDisplayValue('重新生成后的任务')).toBeInTheDocument()
    await waitFor(() => expect(createPlanningRun).toHaveBeenCalledTimes(2))
    expect(durableRuns[1]!.id).not.toBe(durableRuns[0]!.id)
    expect(durableRuns[1]!.candidates[0]!.id).not.toBe(durableRuns[0]!.candidates[0]!.id)
    expect(transitionPlanningRun).toHaveBeenCalledWith({
      kind: 'close_run',
      runId: durableRuns[0]!.id,
      reason: 'regenerated',
    })

    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    await waitFor(() => expect(route).toHaveBeenCalledTimes(2))
    const secondOperationId = route.mock.calls[1]![0].operationId
    expect(secondOperationId).not.toBe(firstOperationId)
    expect(route.mock.calls[1]![1]).toBe(durableRuns[1]!.candidates[0]!.id)
    expect(await screen.findByText('已创建 #100')).toBeInTheDocument()
  })

  it('stops a multi-selected fresh confirmation loop after the first definitive INVALID_REQUEST', async () => {
    mocks.aiChat.mockResolvedValueOnce({
      content: JSON.stringify({
        suggestions: [
          { title: '任务 A', type: 'focus', estimate_minutes: 10, reason: '先做 A。', priority: 'high' },
          { title: '任务 B', type: 'focus', estimate_minutes: 10, reason: '再做 B。', priority: 'medium' },
          { title: '任务 C', type: 'focus', estimate_minutes: 10, reason: '最后做 C。', priority: 'low' },
        ],
      }),
    })
    const route = vi.fn(async (
      request: IdempotentAIStudyTaskCreateRequest,
    ): Promise<IdempotentAIStudyTaskCreateResponse> => ({
      ok: false,
      operationId: request.operationId,
      code: 'INVALID_REQUEST',
      message: 'chapter drifted between renderer and Main',
    }))

    renderDialog('2026-06-12', route)
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('任务 C')
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    await waitFor(() => expect(route).toHaveBeenCalledTimes(1))
    expect(route.mock.calls[0]![0].payload.title).toBe('任务 A')
    expect(screen.getByTestId('today-action-stale-chapter-context')).toHaveTextContent(
      '当前建议已不能继续使用，请重新生成建议',
    )
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '选择 任务 A' })).not.toBeChecked())
    expect(screen.getByRole('checkbox', { name: '选择 任务 B' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: '选择 任务 C' })).toBeDisabled()
    expect(screen.queryByTestId('today-action-confirmed-outcome-suggestion-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('today-action-confirmed-outcome-suggestion-3')).not.toBeInTheDocument()
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

  it('blocks the first stale chapter confirmation, retains the original suggestion, and requires Main authorization for override', async () => {
    const createActionSpy = vi.spyOn(agentStudyTaskActions, 'createConfirmedStudyTaskAction')
    const refreshedProjection = {
      chapter_progress: [{ subject_ref: 'subject:1', title: '函数连续性', completed: true }],
    }
    const refreshedSignature = await computeTodayActionChapterSignature(refreshedProjection)
    mocks.tasksGetChapterContext.mockResolvedValue({
      chapterProjection: refreshedProjection,
      currentChapterSignature: refreshedSignature,
    })

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    expect(await screen.findByDisplayValue('复习函数极限错题')).toBeInTheDocument()
    const exactProviderMessages = mocks.aiChat.mock.calls[0]![0]
    expect(JSON.stringify(exactProviderMessages)).toContain('函数极限')
    expect(Object.isFrozen(exactProviderMessages)).toBe(true)
    expect(exactProviderMessages.every(Object.isFrozen)).toBe(true)
    const expectedOriginalGenerationContextSignature = await computeTodayActionGenerationContextSignature(
      exactProviderMessages,
    )

    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    const staleNotice = await screen.findByTestId('today-action-stale-chapter-context')
    expect(staleNotice).toHaveTextContent('原建议仍基于生成时的旧上下文')
    expect(screen.getByTestId('today-action-refreshed-chapter-context')).toHaveTextContent('函数连续性')
    expect(screen.getByDisplayValue('复习函数极限错题')).toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
    expect(mocks.tasksAuthorizeStaleReview).not.toHaveBeenCalled()
    expect(mocks.aiChat).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('today-action-accept-stale-chapter-context'))
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))

    expect(mocks.tasksAuthorizeStaleReview).toHaveBeenCalledTimes(1)
    const authorizationCore = mocks.tasksAuthorizeStaleReview.mock.calls[0]![0]
    expect(authorizationCore).toMatchObject({
      operationKind: 'today_action',
      actionContractVersion: 'confirmed-study-task-action.v2',
      contextProjectionVersion: 'today-action.context-projection.v2',
      generationChapterSignature: expect.stringMatching(/^[0-9a-f]{64}$/),
      latestReviewedChapterSignature: refreshedSignature,
      staleContextOverride: true,
    })
    expect(authorizationCore.generationChapterSignature).not.toBe(refreshedSignature)
    expect(authorizationCore).not.toHaveProperty('staleReviewToken')
    const snapshot = createActionSpy.mock.calls[0]![0].confirmationSnapshot
    expect(snapshot).toMatchObject({
      generationChapterSignature: authorizationCore.generationChapterSignature,
      latestReviewedChapterSignature: refreshedSignature,
      staleContextOverride: true,
      staleReviewToken: 'e'.repeat(64),
    })
    expect(snapshot.generation.generationContextSignature)
      .toBe(authorizationCore.originalGenerationContextSignature)
    expect(snapshot.generation.generationContextSignature)
      .toBe(expectedOriginalGenerationContextSignature)
    expect(mocks.aiChat).toHaveBeenCalledTimes(1)
    createActionSpy.mockRestore()
  })

  it('requires regeneration after a definitive second chapter drift and never dispatches O2 for the old candidate', async () => {
    const firstRefreshedProjection = {
      chapter_progress: [{ subject_ref: 'subject:1', title: '函数连续性', completed: false }],
    }
    const secondRefreshedProjection = {
      chapter_progress: [{ subject_ref: 'subject:1', title: '函数连续性', completed: true }],
    }
    const firstSignature = await computeTodayActionChapterSignature(firstRefreshedProjection)
    const secondSignature = await computeTodayActionChapterSignature(secondRefreshedProjection)
    const freshCandidateResponse = JSON.stringify({
      suggestions: [{
        title: '按最新章节复习连续性',
        type: 'focus',
        estimate_minutes: 15,
        reason: '基于最新章节进度重新规划。',
        priority: 'high',
      }],
    })
    const durableRuns: PlanningRunRecord[] = []
    const createPlanningRun = vi.fn(async (request: PlanningRunCreateRequest) => {
      const run = makePlanningRun(request)
      run.candidates[0]!.id = 701 + durableRuns.length
      durableRuns.push(run)
      return run
    })
    const transitionPlanningRun = vi.fn(async (request: PlanningRunTransitionRequest) => {
      const run = durableRuns.find(item => item.id === request.runId)!
      return request.kind === 'close_run'
        ? { ...run, closedAt: '2026-06-12T00:01:00.000Z', closeReason: request.reason }
        : run
    })
    window.api.planningRuns = {
      create: createPlanningRun,
      transition: transitionPlanningRun,
      listRecent: vi.fn(async () => ({ items: [], nextCursor: null })),
      get: vi.fn(),
      delete: vi.fn(),
    }
    let chapterContextRead = 0
    mocks.tasksGetChapterContext.mockReset().mockImplementation(async () => {
      chapterContextRead += 1
      return chapterContextRead <= 2
        ? { chapterProjection: firstRefreshedProjection, currentChapterSignature: firstSignature }
        : { chapterProjection: secondRefreshedProjection, currentChapterSignature: secondSignature }
    })
    let createAttempt = 0
    const route = vi.fn(async (
      request: IdempotentAIStudyTaskCreateRequest,
      _planningCandidateId?: number,
    ): Promise<IdempotentAIStudyTaskCreateResponse> => {
      createAttempt += 1
      if (createAttempt === 1) {
        return {
          ok: false,
          operationId: request.operationId,
          code: 'INVALID_REQUEST',
          message: 'chapter drifted again',
        }
      }
      return {
        ok: true,
        operationId: request.operationId,
        task: makeTask({ id: 100, title: request.payload.title, type: request.payload.type }),
        replayed: false,
      }
    })

    renderDialog('2026-06-12', route)
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('复习函数极限错题')
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    await screen.findByTestId('today-action-accept-stale-chapter-context')
    fireEvent.click(screen.getByTestId('today-action-accept-stale-chapter-context'))
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    await waitFor(() => {
      expect(screen.getByTestId('today-action-stale-chapter-context')).toHaveTextContent('本次确认未通过安全校验')
    })
    expect(screen.getByTestId('today-action-stale-chapter-context')).toHaveTextContent(
      '当前建议已不能继续使用，请重新生成建议',
    )
    await waitFor(() => {
      expect(screen.getByTestId('today-action-refreshed-chapter-context')).toHaveTextContent('已完成')
    })
    expect(route).toHaveBeenCalledTimes(1)
    expect(mocks.tasksAuthorizeStaleReview).toHaveBeenCalledTimes(1)
    const firstOperationId = route.mock.calls[0]![0].operationId
    expect(screen.getByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent(firstOperationId)
    expect(screen.getByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent('确认内容未通过校验')
    expect(screen.queryByTestId('today-action-accept-stale-chapter-context')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 复习函数极限错题' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: '选择 复习函数极限错题' })).toBeDisabled()
    expect(screen.getByTestId('ai-plan-create-selected')).toBeDisabled()
    expect(screen.getByTestId('ai-plan-generate')).toHaveTextContent('重新生成一组建议')

    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    expect(route).toHaveBeenCalledTimes(1)
    expect(mocks.tasksAuthorizeStaleReview).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()

    mocks.aiChat.mockResolvedValueOnce({ content: freshCandidateResponse })
    mocks.chaptersGetBySubject.mockResolvedValueOnce([{
      ...chapter,
      title: '函数连续性',
      completed: true,
    }])
    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    expect(await screen.findByDisplayValue('按最新章节复习连续性')).toBeInTheDocument()
    await waitFor(() => expect(createPlanningRun).toHaveBeenCalledTimes(2))
    expect(createPlanningRun.mock.calls[1]![0].id).not.toBe(createPlanningRun.mock.calls[0]![0].id)
    expect(durableRuns[1]!.candidates[0]!.id).not.toBe(durableRuns[0]!.candidates[0]!.id)
    expect(transitionPlanningRun).toHaveBeenCalledWith({
      kind: 'close_run',
      runId: durableRuns[0]!.id,
      reason: 'regenerated',
    })

    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    await waitFor(() => expect(route).toHaveBeenCalledTimes(2))
    const secondOperationId = route.mock.calls[1]![0].operationId
    expect(secondOperationId).not.toBe(firstOperationId)
    expect(route.mock.calls[1]![1]).toBe(durableRuns[1]!.candidates[0]!.id)
    expect(await screen.findByText('已创建 #100')).toBeInTheDocument()
    expect(screen.getByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent(secondOperationId)
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
    expect(screen.getByTestId('today-action-outcome-explainability')).toHaveTextContent('本代尚无已观察到的确认结果')

    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))
    expect(createActionSpy).toHaveBeenCalledTimes(1)
    const snapshot = createActionSpy.mock.calls[0]?.[0].confirmationSnapshot
    expect(snapshot?.generation.operationKind).toBe('today_action')
    expect(snapshot?.generation.versions.promptVersion).toBe('today-action.prompt.v4')
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
    expect(await screen.findByTestId('ai-plan-creation-summary')).toHaveTextContent('本次新创建 1 项，重放确认 0 项，未新建 1 项')
    expect(document.body).toHaveTextContent('完整性检查未通过，本次操作已安全终止')
    expect(document.body).not.toHaveTextContent('second write failed')
    expect(screen.getByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent('已创建任务')
    expect(screen.getByTestId('today-action-confirmed-outcome-suggestion-2')).toHaveTextContent('完整性检查未通过')
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
    expect(snapshot?.generation.generationContextSignature).toMatch(/^[0-9a-f]{64}$/)
    expect(snapshot?.expectedCurrentDate).toBe('2026-06-13')
    expect(JSON.stringify(mocks.aiChat.mock.calls[1]?.[0])).toContain('2026-06-13')
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
      const envelope = JSON.parse(serialized!) as { operations: Array<Record<string, unknown>> }
      expect(envelope.operations).toHaveLength(1)
      expect(envelope.operations[0]).toMatchObject({
        operationId: request.operationId,
        operationKind: 'today_action',
        actionContractVersion: 'confirmed-study-task-action.v2',
        expectedCurrentDate: expectedDate,
        plannedDate: expectedDate,
      })
      expect(Object.keys(envelope.operations[0]!)).toEqual([
        'operationId',
        'operationKind',
        'actionContractVersion',
        'expectedCurrentDate',
        'plannedDate',
        'createdAt',
      ])
      expect(serialized).not.toContain(payload.title)
      expect(serialized).not.toContain('staleReviewToken')
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
    await waitFor(() => {
      expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
    })
  })

  it('treats a validation-then-malformed live executor response as controlled uncertain data', async () => {
    let fixture: ReturnType<typeof createValidationThenMalformedResponse> | undefined
    const route = vi.fn(async (request: IdempotentAIStudyTaskCreateRequest) => {
      fixture = createValidationThenMalformedResponse(request.operationId)
      return fixture.response
    })
    const consoleCapture = captureConsole()

    try {
      renderDialog('2026-06-12', route)
      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      const titleInput = await screen.findByDisplayValue('复习函数极限错题')
      fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

      const outcome = await screen.findByTestId('today-action-confirmed-outcome-suggestion-1')
      expect(outcome).toHaveTextContent('结果尚无法确认，需要用户手动检查')
      expect(screen.getByTestId('ai-suggestion-suggestion-1')).toHaveTextContent(
        '结果尚无法确认，需要用户手动检查',
      )
      expect(titleInput).toBeDisabled()
      expect(screen.getByTestId('pending-study-task-recovery-today_action')).toBeInTheDocument()
      expect(mocks.onCreated).not.toHaveBeenCalled()
      expect(route).toHaveBeenCalledTimes(1)

      const pending = localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)
      expect(pending).not.toBeNull()
      expect(pending).not.toContain('RAW_SECRET_')
      expect(document.body.innerHTML).not.toContain('RAW_SECRET_')

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(route).toHaveBeenCalledTimes(1)
      expect(fixture?.getTaskReads()).toBe(2)
      fixture?.assertDescriptorsUnchanged()
      consoleCapture.expectNoRawSecret()
    } finally {
      consoleCapture.restore()
    }
  })

  it('keeps the metadata-only pending marker when read-only status is unavailable', async () => {
    const route = vi.fn(async () => {
      throw new Error('reply lost without raw detail')
    })
    mocks.tasksGetCommittedStatus.mockRejectedValueOnce(new Error('status unavailable'))
    const consoleCapture = captureConsole()

    try {
      renderDialog('2026-06-12', route)
      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      const titleInput = await screen.findByDisplayValue('复习函数极限错题')
      fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

      expect(await screen.findByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent(
        '结果尚无法确认，需要用户手动检查',
      )
      const beforeRecovery = localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)
      expect(beforeRecovery).not.toBeNull()
      const pending = JSON.parse(beforeRecovery!) as {
        operations: Array<{ operationId: string }>
      }
      const operationId = pending.operations[0]!.operationId
      expect(route).toHaveBeenCalledTimes(1)
      expect(mocks.onCreated).not.toHaveBeenCalled()

      fireEvent.click(screen.getByTestId(`recover-pending-study-task-${operationId}`))
      expect(await screen.findByTestId('pending-study-task-outcome')).toHaveTextContent(
        '结果尚无法确认，需要用户手动检查',
      )
      await waitFor(() => expect(mocks.tasksGetCommittedStatus).toHaveBeenCalledTimes(1))

      expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBe(beforeRecovery)
      expect(screen.getByTestId(`pending-study-task-operation-${operationId}`)).toBeInTheDocument()
      expect(screen.getByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent(
        '结果尚无法确认，需要用户手动检查',
      )
      expect(titleInput).toBeDisabled()
      expect(mocks.onCreated).not.toHaveBeenCalled()
      expect(document.body.innerHTML).not.toContain('RAW_SECRET_')
      expect(beforeRecovery).not.toContain('RAW_SECRET_')

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(route).toHaveBeenCalledTimes(1)
      consoleCapture.expectNoRawSecret()
    } finally {
      consoleCapture.restore()
    }
  })

  it('recovers a committed Today v2 operation after restart through read-only receipt status only', async () => {
    mocks.tasksCreate.mockRejectedValueOnce(new Error('reply lost'))

    const firstView = renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    const titleInput = await screen.findByDisplayValue('复习函数极限错题')
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    expect(await screen.findByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent(
      '结果尚无法确认，需要用户手动检查',
    )
    expect(titleInput).toBeDisabled()
    expect(mocks.onCreated).not.toHaveBeenCalled()
    const serialized = localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)!
    const stored = JSON.parse(serialized) as { operations: Array<Record<string, unknown>> }
    const pending = stored.operations[0]!
    const firstRequest = mocks.tasksCreate.mock.calls[0]?.[2] as IdempotentAIStudyTaskCreateRequest
    expect(pending.operationId).toBe(firstRequest.operationId)
    expect(pending).not.toHaveProperty('payload')
    expect(serialized).not.toContain(firstRequest.payload.title)
    expect(serialized).not.toContain('staleReviewToken')
    mocks.tasksGetCommittedStatus.mockResolvedValueOnce({
      status: 'RECOVERED_COMMITTED',
      operationId: firstRequest.operationId,
      task: makeTask({ id: 303 }),
    })

    firstView.unmount()
    mocks.onCreated.mockClear()
    renderDialog()
    expect(await screen.findByTestId('pending-study-task-recovery-today_action')).toBeInTheDocument()
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId(`recover-pending-study-task-${String(pending.operationId)}`))
    expect(await screen.findByTestId('pending-study-task-outcome')).toHaveTextContent(
      '原操作此前已完成，本次未重复创建',
    )
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
    expect(mocks.tasksGetCommittedStatus).toHaveBeenCalledWith({
      operationId: firstRequest.operationId,
      operationKind: 'today_action',
      actionContractVersion: 'confirmed-study-task-action.v2',
      expectedCurrentDate: '2026-06-12',
      plannedDate: '2026-06-12',
    })
    expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
    expect(mocks.onCreated).toHaveBeenCalledTimes(1)
  })

  it('uses read-only receipt status for explicit live recovery without retrying create', async () => {
    mocks.tasksCreate.mockRejectedValueOnce(new Error('reply lost'))

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('复习函数极限错题')
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    const uncertainOutcome = await screen.findByTestId('today-action-confirmed-outcome-suggestion-1')
    expect(uncertainOutcome).toHaveTextContent('结果尚无法确认，需要用户手动检查')
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)

    const pending = JSON.parse(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)!) as {
      operations: Array<{ operationId: string }>
    }
    mocks.tasksGetCommittedStatus.mockResolvedValueOnce({
      status: 'RECOVERED_COMMITTED',
      operationId: pending.operations[0]!.operationId,
      task: makeTask({ id: 304 }),
    })
    fireEvent.click(screen.getByTestId(`recover-pending-study-task-${pending.operations[0]!.operationId}`))

    await waitFor(() => {
      expect(screen.getByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent(
        '原操作此前已完成，本次未重复创建',
      )
    })
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
    expect(mocks.tasksGetCommittedStatus).toHaveBeenCalledTimes(1)
    expect(mocks.onCreated).toHaveBeenCalledTimes(1)
  })

  it('does not aggregate a replayed confirmation as a newly created task', async () => {
    mocks.tasksCreate.mockResolvedValueOnce({
      ok: true,
      task: makeTask({ id: 305 }),
      replayed: true,
    })

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('复习函数极限错题')
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    expect(await screen.findByTestId('ai-plan-creation-summary')).toHaveTextContent(
      '本次新创建 0 项，重放确认 1 项',
    )
    expect(screen.getByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent(
      '原操作此前已完成，本次未重复创建',
    )
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

    expect(await screen.findByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent(
      '该操作 ID 已对应另一份确认内容，本次未新建任务',
    )
    expect(document.body).not.toHaveTextContent('operation ID already belongs to different content')
    expect(titleInput).toBeDisabled()
    expect(screen.getByTestId('pending-study-task-recovery-today_action')).toBeInTheDocument()
    expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).not.toBeNull()
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent(
      '该操作 ID 已对应另一份确认内容，本次未新建任务',
    )
  })

  it.each([
    ['INTEGRITY_ERROR', '完整性检查未通过，本次操作已安全终止'],
    ['DATE_MISMATCH', '确认日期已失效，本次未创建任务'],
    ['RESULT_DELETED', '原操作曾成功关联任务，但该任务后来已删除；本次检查没有新建任务。'],
    ['INVALID_REQUEST', '确认内容未通过校验，本次未创建任务'],
  ] as const)('shows the per-candidate terminal %s outcome with fixed safe wording', async (code, expectedMessage) => {
    mocks.tasksCreate.mockResolvedValueOnce({
      ok: false,
      code,
      message: 'untrusted backend detail',
    })

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('复习函数极限错题')
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))

    const outcome = await screen.findByTestId('today-action-confirmed-outcome-suggestion-1')
    expect(outcome).toHaveTextContent(expectedMessage)
    expect(outcome).not.toHaveTextContent('untrusted backend detail')
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
  })

  it('keeps an uncertain operation unchanged when the dialog date changes', async () => {
    mocks.tasksCreate.mockRejectedValueOnce(new Error('reply lost'))
    const view = renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))
    await screen.findByDisplayValue('复习函数极限错题')
    fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
    expect(await screen.findByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent(
      '结果尚无法确认，需要用户手动检查',
    )

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
    ['DATE_MISMATCH', 'confirmed date is stale', '确认日期已失效，本次未创建任务；恢复记录已结束。'],
    ['RESULT_DELETED', 'the original task was deleted', '原操作曾成功关联任务，但该任务后来已删除；本次检查没有新建任务；恢复记录已结束。'],
  ] as const)('clears a definite %s recovery result without automatic or replacement writes', async (code, message, displayMessage) => {
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
    expect(await screen.findByText(displayMessage)).toBeInTheDocument()
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
    expect(mocks.onCreated).not.toHaveBeenCalled()
  })

  describe('Phase C4 v1: User-triggered Today Action feedback integration', () => {
    const makeHistoricalRun = (overrides: Partial<PlanningRunRecord> = {}): PlanningRunRecord => ({
      id: 'historical-run-1',
      entryPoint: 'today_action',
      planningDate: '2026-06-11',
      targetDate: '2026-06-11',
      generationResultKind: 'candidate_set',
      contextSummary: [],
      createdAt: '2026-06-11T08:00:00.000Z',
      updatedAt: '2026-06-11T08:05:00.000Z',
      closedAt: '2026-06-11T08:10:00.000Z',
      closeReason: 'dialog_closed',
      candidates: [
        {
          id: 901,
          ordinal: 0,
          title: '历史任务 A',
          description: '历史原因',
          type: 'focus',
          estimateMinutes: 30,
          priority: 'high',
          subjectId: null,
          relatedMistakeId: null,
          relatedEntryId: null,
          admissionOrigin: 'provider_validated',
          editBefore: {},
          editBeforeSourceRelations: { subject: null, mistake: null, entry: null },
          userDisposition: 'confirmed',
          outcomeKind: 'created',
          outcomeObservedAt: '2026-06-11T08:05:00.000Z',
          admittedAt: '2026-06-11T08:00:00.000Z',
          updatedAt: '2026-06-11T08:05:00.000Z',
          sourceRelations: { subject: null, mistake: null, entry: null },
          taskRelation: { available: true, title: '历史任务 A', status: 'done' },
          executionAttribution: {
            kind: 'verified_linked',
            receiptValidated: true,
            taskId: 55,
            taskCurrentTitle: '历史任务 A',
            taskCurrentStatus: 'done',
            semanticDrift: { hasDrift: false, differences: {} },
            focus: {
              state: 'available',
              totalDurationMinutes: 45,
              sessionCount: 2,
              unavailableReason: null,
            },
          },
        },
      ],
      ...overrides,
    })

    it('DLG-C4-01: shows preview without calling Provider or closing Run A when eligible history exists', async () => {
      let createdRun: PlanningRunRecord | null = null
      const create = vi.fn(async (req: PlanningRunCreateRequest) => {
        createdRun = makePlanningRun(req)
        return createdRun
      })
      const transition = vi.fn(async () => createdRun!)
      const listRecent = vi.fn(async () => ({ items: [makeHistoricalRun()], nextCursor: null }))
      window.api.planningRuns = {
        create,
        transition,
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      renderDialog()

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByTestId('today-action-feedback-preview')).toBeInTheDocument()
      expect(screen.getByText('历史任务 A')).toBeInTheDocument()
      expect(mocks.aiChat).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
      expect(transition).not.toHaveBeenCalled()
    })

    it('DLG-C4-02: preview cancel dismisses preview leaving Run A open and Provider uncalled', async () => {
      const listRecent = vi.fn(async () => ({ items: [makeHistoricalRun()], nextCursor: null }))
      window.api.planningRuns = {
        create: vi.fn(),
        transition: vi.fn(),
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      renderDialog()

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByTestId('today-action-feedback-preview')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('ai-plan-feedback-cancel'))
      expect(screen.queryByTestId('today-action-feedback-preview')).not.toBeInTheDocument()
      expect(mocks.aiChat).not.toHaveBeenCalled()
    })

    it('DLG-C4-03: generates without feedback and sends 2 messages', async () => {
      const listRecent = vi.fn(async () => ({ items: [makeHistoricalRun()], nextCursor: null }))
      const create = vi.fn(async (req: PlanningRunCreateRequest) => makePlanningRun(req))
      window.api.planningRuns = {
        create,
        transition: vi.fn(),
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      renderDialog()

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByTestId('today-action-feedback-preview')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('ai-plan-feedback-skip'))
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()
      expect(mocks.aiChat).toHaveBeenCalledTimes(1)
      const chatMessages = mocks.aiChat.mock.calls[0]?.[0]
      expect(chatMessages).toHaveLength(2)
    })

    it('DLG-C4-04: generates with selected feedback and sends 3 messages after second listRecent', async () => {
      const historicalRun = makeHistoricalRun()
      const listRecent = vi.fn(async () => ({ items: [historicalRun], nextCursor: null }))
      const create = vi.fn(async (req: PlanningRunCreateRequest) => makePlanningRun(req))
      window.api.planningRuns = {
        create,
        transition: vi.fn(),
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      renderDialog()

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByTestId('today-action-feedback-preview')).toBeInTheDocument()
      expect(listRecent).toHaveBeenCalledTimes(1)

      fireEvent.click(screen.getByTestId('ai-plan-feedback-confirm'))
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()
      expect(listRecent).toHaveBeenCalledTimes(2)
      expect(mocks.aiChat).toHaveBeenCalledTimes(1)
      const chatMessages = mocks.aiChat.mock.calls[0]?.[0]
      expect(chatMessages).toHaveLength(3)
      expect(chatMessages[2].role).toBe('user')
      expect(chatMessages[2].content).toContain('FEEDBACK_DATA：')
      expect(chatMessages[2].content).toContain('历史任务 A')
    })

    it('DLG-C4-05: refreshes preview and stops generation when feedback becomes stale', async () => {
      let callCount = 0
      const listRecent = vi.fn(async () => {
        callCount += 1
        if (callCount === 1) return { items: [makeHistoricalRun()], nextCursor: null }
        // On confirm revalidation: return empty runs (stale/evicted)
        return { items: [], nextCursor: null }
      })
      window.api.planningRuns = {
        create: vi.fn(),
        transition: vi.fn(),
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      renderDialog()

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByTestId('today-action-feedback-preview')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('ai-plan-feedback-confirm'))
      expect(await screen.findByTestId('today-action-feedback-stale-notice')).toHaveTextContent(
        '历史参考信息已发生变化，已刷新列表。请重新检查并确认。',
      )
      expect(mocks.aiChat).not.toHaveBeenCalled()
    })

    it('DLG-C4-06: closes Run A as regenerated and creates no Run B on Provider failure', async () => {
      let currentRun: PlanningRunRecord | null = makePlanningRun({
        id: 'run-a',
        entryPoint: 'today_action',
        planningDate: '2026-06-12',
        targetDate: '2026-06-12',
        generationResultKind: 'candidate_set',
        contextSummary: [],
        candidates: [],
      })
      const create = vi.fn()
      const transition = vi.fn(async (req: PlanningRunTransitionRequest) => {
        if (req.kind === 'close_run') {
          currentRun = { ...currentRun!, closedAt: '2026-06-12T01:00:00.000Z', closeReason: req.reason }
        }
        return currentRun!
      })
      const listRecent = vi.fn(async () => ({ items: [], nextCursor: null }))
      window.api.planningRuns = {
        create,
        transition,
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      mocks.aiChat.mockResolvedValueOnce({ error: 'AI provider quota exceeded' })
      renderDialog()

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByText('AI provider quota exceeded')).toBeInTheDocument()
      expect(create).not.toHaveBeenCalled()
    })

    it('DLG-C4-07: shows warning on history read failure and allows generating without feedback', async () => {
      const listRecent = vi.fn(async () => { throw new Error('Database locked') })
      window.api.planningRuns = {
        create: vi.fn(async (req: PlanningRunCreateRequest) => makePlanningRun(req)),
        transition: vi.fn(),
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      renderDialog()

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByTestId('today-action-feedback-warning')).toHaveTextContent(
        '读取历史规划记录失败。你可以重试，或直接选择“不使用历史反馈生成”。',
      )
      expect(mocks.aiChat).not.toHaveBeenCalled()

      fireEvent.click(screen.getByTestId('ai-plan-feedback-skip'))
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()
      expect(mocks.aiChat).toHaveBeenCalledTimes(1)
      expect(mocks.aiChat.mock.calls[0]?.[0]).toHaveLength(2)
    })

    it('DLG-C4-08: generates base suggestions directly when planningRuns API is unavailable', async () => {
      delete window.api.planningRuns
      renderDialog()

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()
      expect(mocks.aiChat).toHaveBeenCalledTimes(1)
      expect(mocks.aiChat.mock.calls[0]?.[0]).toHaveLength(2)
    })

    it('DLG-C4-09: discards preview on date rollover', async () => {
      const listRecent = vi.fn(async () => ({ items: [makeHistoricalRun()], nextCursor: null }))
      window.api.planningRuns = {
        create: vi.fn(),
        transition: vi.fn(),
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      const view = renderDialog('2026-06-12')

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByTestId('today-action-feedback-preview')).toBeInTheDocument()

      await act(async () => {
        view.rerender(dialogElement('2026-06-13'))
      })
      expect(screen.queryByTestId('today-action-feedback-preview')).not.toBeInTheDocument()
      expect(mocks.aiChat).not.toHaveBeenCalled()
    })

    it('DLG-C4-10: still allows candidate creation when historical feedback is deleted after Provider success', async () => {
      let historicalRuns: PlanningRunRecord[] = [makeHistoricalRun()]
      const listRecent = vi.fn(async () => ({ items: historicalRuns, nextCursor: null }))
      const create = vi.fn(async (req: PlanningRunCreateRequest) => makePlanningRun(req))
      window.api.planningRuns = {
        create,
        transition: vi.fn(),
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      renderDialog()

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByTestId('today-action-feedback-preview')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('ai-plan-feedback-confirm'))
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()

      // Later historical history is deleted
      historicalRuns = []

      // Confirmation only checks latest Today Action context, not feedback history
      fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
      await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))
    })

    it('DLG-C4-11: disables feedback confirm button when 0 items are selected', async () => {
      const listRecent = vi.fn(async () => ({ items: [makeHistoricalRun()], nextCursor: null }))
      window.api.planningRuns = {
        create: vi.fn(),
        transition: vi.fn(),
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      renderDialog()

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByTestId('today-action-feedback-preview')).toBeInTheDocument()

      // Unselect all
      fireEvent.click(screen.getByTestId('ai-plan-feedback-toggle-all'))
      const confirmButton = screen.getByTestId('ai-plan-feedback-confirm')
      expect(confirmButton).toBeDisabled()
    })

    it('DLG-C4-12: guards double-clicks and only executes latest generation request', async () => {
      const deferred = createDeferred<{ items: PlanningRunRecord[]; nextCursor: null }>()
      const listRecent = vi.fn(() => deferred.promise)
      window.api.planningRuns = {
        create: vi.fn(),
        transition: vi.fn(),
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      renderDialog()

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(listRecent).toHaveBeenCalledTimes(1)

      await act(async () => {
        deferred.resolve({ items: [makeHistoricalRun()], nextCursor: null })
        await deferred.promise
      })

      expect(await screen.findByTestId('today-action-feedback-preview')).toBeInTheDocument()
      expect(mocks.aiChat).not.toHaveBeenCalled()
    })

    it('C4-H1-01: releases feedback loading on base generation transition so subsequent generation can be started', async () => {
      const listRecent = vi.fn(async () => ({ items: [], nextCursor: null }))
      const create = vi.fn(async (req: PlanningRunCreateRequest) => makePlanningRun(req))
      const transition = vi.fn(async (req: PlanningRunTransitionRequest) => makePlanningRun({
        id: req.runId,
        entryPoint: 'today_action',
        planningDate: '2026-06-12',
        targetDate: '2026-06-12',
        generationResultKind: 'candidate_set',
        contextSummary: [],
        candidates: [],
      }))
      window.api.planningRuns = {
        create,
        transition,
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      renderDialog()

      const generateButton = screen.getByTestId('ai-plan-generate')
      expect(generateButton).toBeEnabled()

      // First generation (0 eligible feedback items -> direct base generation)
      fireEvent.click(generateButton)
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()
      expect(mocks.aiChat).toHaveBeenCalledTimes(1)
      expect(generateButton).toBeEnabled()

      // Second generation should not be blocked by feedbackLoading
      fireEvent.click(generateButton)
      await waitFor(() => {
        expect(mocks.aiChat).toHaveBeenCalledTimes(2)
      })
      expect(generateButton).toBeEnabled()
    })

    it('C4-H1-02: releases feedback loading on feedback generation transition so subsequent generation can be started', async () => {
      const historicalRun = makeHistoricalRun()
      let callCount = 0
      const listRecent = vi.fn(async () => {
        callCount += 1
        return { items: [historicalRun], nextCursor: null }
      })
      const create = vi.fn(async (req: PlanningRunCreateRequest) => makePlanningRun(req))
      const transition = vi.fn(async (req: PlanningRunTransitionRequest) => makePlanningRun({
        id: req.runId,
        entryPoint: 'today_action',
        planningDate: '2026-06-12',
        targetDate: '2026-06-12',
        generationResultKind: 'candidate_set',
        contextSummary: [],
        candidates: [],
      }))
      window.api.planningRuns = {
        create,
        transition,
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      renderDialog()

      const generateButton = screen.getByTestId('ai-plan-generate')
      expect(generateButton).toBeEnabled()

      // First generation with feedback preview confirmation
      fireEvent.click(generateButton)
      expect(await screen.findByTestId('today-action-feedback-preview')).toBeInTheDocument()
      expect(listRecent).toHaveBeenCalledTimes(1)

      fireEvent.click(screen.getByTestId('ai-plan-feedback-confirm'))
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()
      expect(listRecent).toHaveBeenCalledTimes(2)
      expect(mocks.aiChat).toHaveBeenCalledTimes(1)
      expect(generateButton).toBeEnabled()

      // Second generation should not be blocked by feedbackLoading
      fireEvent.click(generateButton)
      expect(await screen.findByTestId('today-action-feedback-preview')).toBeInTheDocument()
      expect(listRecent).toHaveBeenCalledTimes(3)
    })

    it('C4-H1-03: preserves stale callback protection when preflight resolves after dialog close', async () => {
      const deferred = createDeferred<{ items: PlanningRunRecord[]; nextCursor: null }>()
      const listRecent = vi.fn(() => deferred.promise)
      window.api.planningRuns = {
        create: vi.fn(),
        transition: vi.fn(),
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      renderDialog()

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(listRecent).toHaveBeenCalledTimes(1)

      // Dialog is closed while preflight is still pending
      fireEvent.click(screen.getByLabelText('关闭 AI 今日行动建议'))
      expect(mocks.onClose).toHaveBeenCalledTimes(1)

      // Preflight resolves after close
      await act(async () => {
        deferred.resolve({ items: [makeHistoricalRun()], nextCursor: null })
        await deferred.promise
      })

      // Must not call AI chat or show preview
      expect(mocks.aiChat).not.toHaveBeenCalled()
      expect(screen.queryByTestId('today-action-feedback-preview')).not.toBeInTheDocument()
    })
  })

  describe('Phase C6 Planning Strategy Presets', () => {
    it('C6-TA-01: renders strategy selector with balanced as default and all three options', async () => {
      renderDialog()
      const selector = screen.getByTestId('today-action-strategy-selector') as HTMLSelectElement
      expect(selector).toBeInTheDocument()
      expect(selector).toBeEnabled()
      expect(selector.value).toBe('balanced')

      const options = Array.from(selector.options).map(opt => ({ value: opt.value, text: opt.text }))
      expect(options).toEqual([
        { value: 'balanced', text: '均衡规划' },
        { value: 'deep_focus', text: '深度专注' },
        { value: 'light_load', text: '轻量推进' },
      ])
    })

    it('C6-TA-02: generates with selected strategy directive and renders attribution badge', async () => {
      renderDialog()
      const selector = screen.getByTestId('today-action-strategy-selector')
      fireEvent.change(selector, { target: { value: 'deep_focus' } })
      expect((selector as HTMLSelectElement).value).toBe('deep_focus')

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()

      expect(mocks.aiChat).toHaveBeenCalledTimes(1)
      const promptMessages = mocks.aiChat.mock.calls[0]![0]
      expect(promptMessages[1]!.content).toContain(
        '规划策略：深度专注（deep_focus）。倾向于建议较少数量、较长连续时长的单科目深度学习块，减少科目频繁切换，优先安排需要高度沉浸的核心攻坚或系统性复习。',
      )

      const badge = screen.getByTestId('today-action-generated-strategy-badge')
      expect(badge).toBeInTheDocument()
      expect(badge).toHaveTextContent('当前候选基于「深度专注」策略生成')
      expect(screen.queryByTestId('today-action-strategy-mismatch-notice')).not.toBeInTheDocument()
    })

    it('C6-TA-03: shows mismatch notice when changing strategy after generation and clears when reverted', async () => {
      renderDialog()
      const selector = screen.getByTestId('today-action-strategy-selector')
      fireEvent.change(selector, { target: { value: 'deep_focus' } })

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()

      // Switch to light_load without regenerating
      fireEvent.change(selector, { target: { value: 'light_load' } })

      const mismatchNotice = screen.getByTestId('today-action-strategy-mismatch-notice')
      expect(mismatchNotice).toBeInTheDocument()
      expect(mismatchNotice).toHaveTextContent(
        '（当前显示基于「深度专注」；切换为「轻量推进」将在重新生成时生效）',
      )

      // Switch back to deep_focus
      fireEvent.change(selector, { target: { value: 'deep_focus' } })
      expect(screen.queryByTestId('today-action-strategy-mismatch-notice')).not.toBeInTheDocument()
    })

    it('C6-TA-04: regenerates with updated strategy, updates badge and clears mismatch notice', async () => {
      renderDialog()
      const selector = screen.getByTestId('today-action-strategy-selector')
      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()
      expect(screen.getByTestId('today-action-generated-strategy-badge')).toHaveTextContent('当前候选基于「均衡规划」策略生成')

      // Switch to light_load
      fireEvent.change(selector, { target: { value: 'light_load' } })
      expect(screen.getByTestId('today-action-strategy-mismatch-notice')).toBeInTheDocument()

      // Regenerate
      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()

      expect(mocks.aiChat).toHaveBeenCalledTimes(2)
      const secondPromptMessages = mocks.aiChat.mock.calls[1]![0]
      expect(secondPromptMessages[1]!.content).toContain(
        '规划策略：轻量推进（light_load）。倾向于建议启动门槛低、单项时长适中偏短、易于执行的行动，优先消化到期错题或完成小颗粒度目标，避免安排高负荷长时任务。',
      )

      const badge = screen.getByTestId('today-action-generated-strategy-badge')
      expect(badge).toHaveTextContent('当前候选基于「轻量推进」策略生成')
      expect(screen.queryByTestId('today-action-strategy-mismatch-notice')).not.toBeInTheDocument()
    })

    it('C6-TA-05: prevents stale closures during feedback preview and captures selectedStrategyRef', async () => {
      const historicalRun = makeHistoricalRun()
      const listRecent = vi.fn(async () => ({ items: [historicalRun], nextCursor: null }))
      const create = vi.fn(async (req: PlanningRunCreateRequest) => makePlanningRun(req))
      const transition = vi.fn(async (req: PlanningRunTransitionRequest) => makePlanningRun({
        id: req.runId,
        entryPoint: 'today_action',
        planningDate: '2026-06-12',
        targetDate: '2026-06-12',
        generationResultKind: 'candidate_set',
        contextSummary: [],
        candidates: [],
      }))
      window.api.planningRuns = {
        create,
        transition,
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      renderDialog()

      // Trigger generation with default balanced -> enters feedback preview
      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByTestId('today-action-feedback-preview')).toBeInTheDocument()

      // User changes strategy selector while preview is active
      const selector = screen.getByTestId('today-action-strategy-selector')
      expect(selector).toBeEnabled()
      fireEvent.change(selector, { target: { value: 'deep_focus' } })

      // User confirms feedback generation
      fireEvent.click(screen.getByTestId('ai-plan-feedback-confirm'))
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()

      expect(mocks.aiChat).toHaveBeenCalledTimes(1)
      const promptMessages = mocks.aiChat.mock.calls[0]![0]
      expect(promptMessages[1]!.content).toContain(
        '规划策略：深度专注（deep_focus）。倾向于建议较少数量、较长连续时长的单科目深度学习块，减少科目频繁切换，优先安排需要高度沉浸的核心攻坚或系统性复习。',
      )

      const badge = screen.getByTestId('today-action-generated-strategy-badge')
      expect(badge).toHaveTextContent('当前候选基于「深度专注」策略生成')
      expect(screen.queryByTestId('today-action-strategy-mismatch-notice')).not.toBeInTheDocument()
    })

    it('C6-TA-06: resets strategy to balanced on date rollover and clears attribution and mismatch', async () => {
      const { rerender } = renderDialog()
      const selector = screen.getByTestId('today-action-strategy-selector') as HTMLSelectElement
      fireEvent.change(selector, { target: { value: 'deep_focus' } })

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()
      expect(screen.getByTestId('today-action-generated-strategy-badge')).toBeInTheDocument()

      // Date rollover
      rerender(dialogElement('2026-06-13'))

      const rolledSelector = screen.getByTestId('today-action-strategy-selector') as HTMLSelectElement
      expect(rolledSelector.value).toBe('balanced')
      expect(screen.queryByTestId('today-action-generated-strategy-badge')).not.toBeInTheDocument()
      expect(screen.queryByTestId('today-action-strategy-mismatch-notice')).not.toBeInTheDocument()
    })

    it('C6-TA-07: retains strategy in generation provenance upon task creation and keeps confirmation snapshot clean', async () => {
      const createActionSpy = vi.spyOn(agentStudyTaskActions, 'createConfirmedStudyTaskAction')
      renderDialog()
      const selector = screen.getByTestId('today-action-strategy-selector')
      fireEvent.change(selector, { target: { value: 'light_load' } })

      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('ai-plan-create-selected'))
      await waitFor(() => {
        expect(createActionSpy).toHaveBeenCalled()
      })

      const callArg = createActionSpy.mock.calls[0]![0]
      const snapshot = callArg.confirmationSnapshot
      expect(snapshot.generation.operationKind).toBe('today_action')
      expect(snapshot.generation.generationContextSignature).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(mocks.aiChat.mock.calls[0]?.[0])).toContain('轻量推进（light_load）')

      // Confirmation context signature strictly matches base signature without strategy
      const parsedConfSig = JSON.parse(snapshot.confirmationContextSignature)
      expect(parsedConfSig.date).toBe('2026-06-12')
      expect(parsedConfSig).not.toHaveProperty('strategyId')
      expect(parsedConfSig).not.toHaveProperty('feedback')
      createActionSpy.mockRestore()
    })

    it('C6-TA-08: allows changing strategy while planning history discovery is in-flight and uses selected strategy when discovery returns zero eligible feedback', async () => {
      const listRecentDeferred = createDeferred<PlanningRunListResult>()
      const listRecent = vi.fn(() => listRecentDeferred.promise)
      const create = vi.fn(async (req: PlanningRunCreateRequest) => makePlanningRun(req))
      const transition = vi.fn(async (req: PlanningRunTransitionRequest) => makePlanningRun({
        id: req.runId,
        entryPoint: 'today_action',
        planningDate: '2026-06-12',
        targetDate: '2026-06-12',
        generationResultKind: 'candidate_set',
        contextSummary: [],
        candidates: [],
      }))
      window.api.planningRuns = {
        create,
        transition,
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      renderDialog()
      const selector = screen.getByTestId('today-action-strategy-selector') as HTMLSelectElement
      expect(selector.value).toBe('balanced')

      // Trigger generation under balanced -> discovery starts and is in-flight
      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(listRecent).toHaveBeenCalledTimes(1)

      // Selector MUST remain enabled while feedback discovery is in-flight
      expect(selector).toBeEnabled()

      // User changes strategy to deep_focus while discovery is in-flight
      fireEvent.change(selector, { target: { value: 'deep_focus' } })
      expect(selector.value).toBe('deep_focus')

      // Discovery resolves with zero eligible candidates
      listRecentDeferred.resolve({ items: [], nextCursor: null })

      // Generation proceeds with deep_focus
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()
      expect(mocks.aiChat).toHaveBeenCalledTimes(1)
      const promptMessages = mocks.aiChat.mock.calls[0]![0]
      expect(promptMessages[1]!.content).toContain(
        '规划策略：深度专注（deep_focus）。倾向于建议较少数量、较长连续时长的单科目深度学习块，减少科目频繁切换，优先安排需要高度沉浸的核心攻坚或系统性复习。',
      )

      const badge = screen.getByTestId('today-action-generated-strategy-badge')
      expect(badge).toHaveTextContent('当前候选基于「深度专注」策略生成')
      expect(screen.queryByTestId('today-action-strategy-mismatch-notice')).not.toBeInTheDocument()
    })

    it('C6-TA-09: allows changing strategy while AI generation is in-flight and shows mismatch notice upon return without altering in-flight attribution', async () => {
      const aiChatDeferred = createDeferred<{ content: string }>()
      mocks.aiChat.mockReturnValueOnce(aiChatDeferred.promise)
      renderDialog()

      const selector = screen.getByTestId('today-action-strategy-selector') as HTMLSelectElement
      expect(selector.value).toBe('balanced')

      // Trigger generation under balanced -> aiChat is in-flight
      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      await waitFor(() => {
        expect(mocks.aiChat).toHaveBeenCalledTimes(1)
      })

      // Strategy selector MUST remain enabled while AI provider request is in-flight
      expect(selector).toBeEnabled()

      // User changes strategy to light_load while Provider request is in-flight
      fireEvent.change(selector, { target: { value: 'light_load' } })
      expect(selector.value).toBe('light_load')

      // Provider returns candidates
      aiChatDeferred.resolve({ content: validAiResponse })

      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()

      // Returned candidates must be attributed to balanced (the strategy at generation start)
      const badge = screen.getByTestId('today-action-generated-strategy-badge')
      expect(badge).toHaveTextContent('当前候选基于「均衡规划」策略生成')

      // Selector remains light_load and mismatch notice is displayed
      expect(selector.value).toBe('light_load')
      const mismatchNotice = screen.getByTestId('today-action-strategy-mismatch-notice')
      expect(mismatchNotice).toHaveTextContent(
        '（当前显示基于「均衡规划」；切换为「轻量推进」将在重新生成时生效）',
      )
    })

    it('C6-TA-10: clears generated strategy and attribution at regeneration start even if new request fails or is malformed', async () => {
      renderDialog()
      const selector = screen.getByTestId('today-action-strategy-selector') as HTMLSelectElement
      expect(selector.value).toBe('balanced')

      // First generation succeeds under balanced
      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()
      expect(screen.getByTestId('today-action-generated-strategy-badge')).toHaveTextContent('当前候选基于「均衡规划」策略生成')

      // Switch to light_load
      fireEvent.change(selector, { target: { value: 'light_load' } })
      expect(screen.getByTestId('today-action-strategy-mismatch-notice')).toBeInTheDocument()

      // Regenerate with failing / malformed provider response
      mocks.aiChat.mockResolvedValueOnce({ error: 'Model overloaded' })
      fireEvent.click(screen.getByTestId('ai-plan-generate'))

      // Old candidates, badge, and mismatch notice MUST NOT survive
      expect(await screen.findByText('Model overloaded')).toBeInTheDocument()
      expect(screen.queryByLabelText('建议标题')).not.toBeInTheDocument()
      expect(screen.queryByTestId('today-action-generated-strategy-badge')).not.toBeInTheDocument()
      expect(screen.queryByTestId('today-action-strategy-mismatch-notice')).not.toBeInTheDocument()
    })

    it('C6-TA-11: captures selected strategy immediately before Provider request dispatch in direct path after async context refresh', async () => {
      const getByDateDeferred = createDeferred<StudyTask[]>()
      mocks.tasksGetByDate.mockImplementationOnce(() => getByDateDeferred.promise)
      renderDialog()

      const selector = screen.getByTestId('today-action-strategy-selector') as HTMLSelectElement
      expect(selector.value).toBe('balanced')

      // Click generate while balanced -> context preparation is in-flight
      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(mocks.tasksGetByDate).toHaveBeenCalled()
      expect(mocks.aiChat).not.toHaveBeenCalled()

      // Change strategy to light_load while context preparation is pending
      expect(selector).toBeEnabled()
      fireEvent.change(selector, { target: { value: 'light_load' } })
      expect(selector.value).toBe('light_load')

      // Resolve context preparation
      getByDateDeferred.resolve([])

      // Provider request is now dispatched with light_load
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()
      expect(mocks.aiChat).toHaveBeenCalledTimes(1)
      const promptMessages = mocks.aiChat.mock.calls[0]![0]
      expect(promptMessages[1]!.content).toContain(
        '规划策略：轻量推进（light_load）。倾向于建议启动门槛低、单项时长适中偏短、易于执行的行动，优先消化到期错题或完成小颗粒度目标，避免安排高负荷长时任务。',
      )

      const badge = screen.getByTestId('today-action-generated-strategy-badge')
      expect(badge).toHaveTextContent('当前候选基于「轻量推进」策略生成')
      expect(screen.queryByTestId('today-action-strategy-mismatch-notice')).not.toBeInTheDocument()
    })

    it('C6-TA-12: freezes strategy at final feedback authorization before async revalidation while allowing selector change', async () => {
      const historicalRun = makeHistoricalRun()
      const listRecentDeferred = createDeferred<PlanningRunListResult>()
      let listRecentCallCount = 0
      const listRecent = vi.fn(async () => {
        listRecentCallCount++
        if (listRecentCallCount === 1) {
          return { items: [historicalRun], nextCursor: null }
        }
        return listRecentDeferred.promise
      })
      const create = vi.fn(async (req: PlanningRunCreateRequest) => makePlanningRun(req))
      const transition = vi.fn(async (req: PlanningRunTransitionRequest) => makePlanningRun({
        id: req.runId,
        entryPoint: 'today_action',
        planningDate: '2026-06-12',
        targetDate: '2026-06-12',
        generationResultKind: 'candidate_set',
        contextSummary: [],
        candidates: [],
      }))
      window.api.planningRuns = {
        create,
        transition,
        listRecent,
        get: vi.fn(),
        delete: vi.fn(),
      }
      renderDialog()

      // Initial generation opens feedback preview
      fireEvent.click(screen.getByTestId('ai-plan-generate'))
      expect(await screen.findByTestId('today-action-feedback-preview')).toBeInTheDocument()

      const selector = screen.getByTestId('today-action-strategy-selector') as HTMLSelectElement
      fireEvent.change(selector, { target: { value: 'deep_focus' } })
      expect(selector.value).toBe('deep_focus')

      // Click final feedback confirmation -> freezes deep_focus and starts async revalidation
      fireEvent.click(screen.getByTestId('ai-plan-feedback-confirm'))
      expect(listRecent).toHaveBeenCalledTimes(2)

      // While revalidation is pending, user changes strategy to light_load
      expect(selector).toBeEnabled()
      fireEvent.change(selector, { target: { value: 'light_load' } })
      expect(selector.value).toBe('light_load')

      // Resolve revalidation
      listRecentDeferred.resolve({ items: [historicalRun], nextCursor: null })

      // Generation completes with deep_focus
      expect(await screen.findByLabelText('建议标题')).toBeInTheDocument()
      expect(mocks.aiChat).toHaveBeenCalledTimes(1)
      const promptMessages = mocks.aiChat.mock.calls[0]![0]
      expect(promptMessages[1]!.content).toContain(
        '规划策略：深度专注（deep_focus）。倾向于建议较少数量、较长连续时长的单科目深度学习块，减少科目频繁切换，优先安排需要高度沉浸的核心攻坚或系统性复习。',
      )

      // Provenance and badge reflect frozen deep_focus
      const badge = screen.getByTestId('today-action-generated-strategy-badge')
      expect(badge).toHaveTextContent('当前候选基于「深度专注」策略生成')

      // Selector remains light_load and mismatch notice is shown
      expect(selector.value).toBe('light_load')
      const mismatchNotice = screen.getByTestId('today-action-strategy-mismatch-notice')
      expect(mismatchNotice).toHaveTextContent(
        '（当前显示基于「深度专注」；切换为「轻量推进」将在重新生成时生效）',
      )
    })
  })
})
