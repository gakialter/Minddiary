import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
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

type IdempotentRoute = (
  request: IdempotentAIStudyTaskCreateRequest,
) => Promise<IdempotentAIStudyTaskCreateResponse>

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

  const dialogElement = (date = '2026-06-12', routeOverride?: IdempotentRoute) => {
    const tasksAPI = {
      getByDate: mocks.tasksGetByDate,
      create: mocks.tasksCreateLegacy,
      createIdempotentAIStudyTaskForCurrentDate: routeOverride ?? (async (
        request: IdempotentAIStudyTaskCreateRequest,
      ): Promise<IdempotentAIStudyTaskCreateResponse> => {
        const result = await mocks.tasksCreate(request.payload, request.expectedCurrentDate, request)
        if (result && typeof result === 'object' && 'ok' in result) {
          return { ...result, operationId: request.operationId } as IdempotentAIStudyTaskCreateResponse
        }
        return { ok: true, operationId: request.operationId, task: result, replayed: false }
      }),
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
    expect(screen.getByTestId('today-action-outcome-explainability')).toHaveTextContent('本代尚无已观察到的确认结果')

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

  it('keeps the exact pending record when recovery receives a validation-then-malformed response', async () => {
    let attempt = 0
    let fixture: ReturnType<typeof createValidationThenMalformedResponse> | undefined
    const route = vi.fn(async (request: IdempotentAIStudyTaskCreateRequest) => {
      attempt += 1
      if (attempt === 1) throw new Error('reply lost without raw detail')
      fixture = createValidationThenMalformedResponse(request.operationId)
      return fixture.response
    })
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
      await waitFor(() => expect(route).toHaveBeenCalledTimes(2))

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
      expect(route).toHaveBeenCalledTimes(2)
      expect(fixture?.getTaskReads()).toBe(2)
      fixture?.assertDescriptorsUnchanged()
      consoleCapture.expectNoRawSecret()
    } finally {
      consoleCapture.restore()
    }
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

    expect(await screen.findByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent(
      '结果尚无法确认，需要用户手动检查',
    )
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
    expect(await screen.findByText('原操作此前已完成，本次未重复创建')).toBeInTheDocument()
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(2)
    const retryRequest = mocks.tasksCreate.mock.calls[1]?.[2] as IdempotentAIStudyTaskCreateRequest
    expect(retryRequest.operationId).toBe(firstRequest.operationId)
    expect(retryRequest.payload).toEqual(firstRequest.payload)
    expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
    expect(mocks.onCreated).toHaveBeenCalledTimes(1)
  })

  it('observes an explicit live recovery without background retry and preserves replay semantics', async () => {
    mocks.tasksCreate
      .mockRejectedValueOnce(new Error('reply lost'))
      .mockResolvedValueOnce({
        ok: true,
        task: makeTask({ id: 304 }),
        replayed: true,
      })

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
    fireEvent.click(screen.getByTestId(`recover-pending-study-task-${pending.operations[0]!.operationId}`))

    await waitFor(() => {
      expect(screen.getByTestId('today-action-confirmed-outcome-suggestion-1')).toHaveTextContent(
        '原操作此前已完成，本次未重复创建',
      )
    })
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(2)
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
})
