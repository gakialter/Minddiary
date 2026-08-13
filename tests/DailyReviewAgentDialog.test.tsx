import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DailyReviewAgentDialog from '../src/components/DailyReviewAgentDialog'
import type { AIResponse, DiaryEntry, Mistake, PomodoroStat, StudyTask, Subject } from '../src/types'
import type { IdempotentAIStudyTaskCreateRequest, IdempotentAIStudyTaskCreateResponse } from '../src/types/api'
import * as agentStudyTaskActions from '../src/utils/agentStudyTaskActions'
import * as aiOperationContracts from '../src/utils/aiOperationContracts'
import { PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY } from '../src/utils/pendingStudyTaskOperations'

const REVIEW_DATE = '2026-06-12'
const CANDIDATE_DATE = '2026-06-13'

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(innerResolve => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

const subject: Subject = { id: 1, name: '数学', color: '#2563eb', total_chapters: 8, completed_chapters: 3 }
const secondSubject: Subject = { id: 2, name: '英语', color: '#16a34a', total_chapters: 6, completed_chapters: 1 }

const mistake: Mistake = {
  id: 12,
  subject_id: 1,
  question: '函数极限换元时忽略定义域',
  answer: 'sensitive answer',
  notes: 'sensitive notes',
  mastered: false,
  ease_factor: 2.5,
  review_interval: 1,
  next_review_date: CANDIDATE_DATE,
  review_count: 0,
  image_path: 'sensitive-image-path',
  answer_image_path: 'sensitive-answer-image-path',
  created_at: '2026-06-12T00:00:00.000Z',
}

const subjectlessMistake: Mistake = {
  ...mistake,
  id: 13,
  subject_id: null,
  question: '无科目错题',
}

const entry: DiaryEntry = {
  id: 5,
  date: REVIEW_DATE,
  title: 'Today',
  content: 'sensitive diary body',
  mood: 'calm',
  word_count: 11,
  created_at: '2026-06-12T00:00:00.000Z',
  updated_at: '2026-06-12T00:00:00.000Z',
}

const pomodoroStats: PomodoroStat[] = [{ subject_name: '数学', color: '#2563eb', total_minutes: 25, session_count: 1 }]

const makeTask = (overrides: Partial<StudyTask> = {}): StudyTask => ({
  id: 99,
  title: '复习函数极限错题',
  description: 'task description must not enter Daily Review prompt',
  type: 'review',
  subject_id: 1,
  related_mistake_id: 12,
  related_entry_id: null,
  related_chapter_id: null,
  planned_date: CANDIDATE_DATE,
  estimate_minutes: 10,
  status: 'todo',
  source: 'ai',
  created_at: '2026-06-12T00:00:00.000Z',
  updated_at: '2026-06-12T00:00:00.000Z',
  ...overrides,
})

type IdempotentCreateRoute = (
  request: IdempotentAIStudyTaskCreateRequest,
) => Promise<IdempotentAIStudyTaskCreateResponse>

const createValidationThenMalformedSuccess = (operationId: string) => {
  const validTask = makeTask()
  const malformedTask = {
    ...validTask,
    id: 'RAW_SECRET_TASK_ID',
  } as unknown as StudyTask
  const target = {
    ok: true as const,
    operationId,
    task: validTask,
    replayed: false,
  }
  const malformedTaskDescriptors = Object.getOwnPropertyDescriptors(malformedTask)
  const targetDescriptors = Object.getOwnPropertyDescriptors(target)
  const validTaskDescriptors = Object.getOwnPropertyDescriptors(validTask)
  let taskReads = 0
  const response = new Proxy(target, {
    get(current, property, receiver) {
      if (property === 'task') {
        taskReads += 1
        return taskReads === 1 ? validTask : malformedTask
      }
      return Reflect.get(current, property, receiver)
    },
  }) as IdempotentAIStudyTaskCreateResponse

  return {
    expectUnchanged() {
      expect(Object.getOwnPropertyDescriptors(malformedTask)).toEqual(malformedTaskDescriptors)
      expect(Object.getOwnPropertyDescriptors(target)).toEqual(targetDescriptors)
      expect(Object.getOwnPropertyDescriptors(validTask)).toEqual(validTaskDescriptors)
    },
    malformedTask,
    response,
    target,
    taskReads: () => taskReads,
    validTask,
  }
}

const captureConsole = () => {
  const spies = [
    vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
    vi.spyOn(console, 'info').mockImplementation(() => undefined),
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'trace').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
  ]
  return {
    expectNoCalls() {
      spies.forEach(spy => expect(spy).not.toHaveBeenCalled())
    },
    restore() {
      spies.forEach(spy => spy.mockRestore())
    },
  }
}

const validAiResponse = JSON.stringify({
  observations: [
    {
      summary: '今日专注已启动',
      reason: '本地记录显示完成了一次专注。',
      source_refs: ['pomodoro'],
    },
  ],
  candidates: [
    {
      title: '复习函数极限错题',
      type: 'review',
      estimate_minutes: 10,
      reason: '截至次日到期，先处理薄弱点。',
      priority: 'high',
      subject_ref: 'subject:1',
      related_mistake_ref: 'mistake:12',
      related_entry_ref: null,
    },
  ],
})

const twoCandidateResponse = JSON.stringify({
  observations: [],
  candidates: [
    { title: '任务 A', type: 'focus', estimate_minutes: 10, reason: '先做 A。', priority: 'high', subject_ref: null, related_mistake_ref: null, related_entry_ref: null },
    { title: '任务 B', type: 'focus', estimate_minutes: 10, reason: '再做 B。', priority: 'medium', subject_ref: null, related_mistake_ref: null, related_entry_ref: null },
  ],
})

describe('DailyReviewAgentDialog', () => {
  const mocks = {
    aiChat: vi.fn(),
    tasksGetByDate: vi.fn(),
    tasksCreate: vi.fn(),
    mistakesGetAll: vi.fn(),
    mistakesGetDueCount: vi.fn(),
    subjectsGetAll: vi.fn(),
    entriesGetByDate: vi.fn(),
    pomodoroGetStats: vi.fn(),
    pomodoroGetDailyTotal: vi.fn(),
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
    mocks.mistakesGetDueCount.mockResolvedValue(1)
    mocks.subjectsGetAll.mockResolvedValue([subject])
    mocks.entriesGetByDate.mockResolvedValue(entry)
    mocks.pomodoroGetStats.mockResolvedValue(pomodoroStats)
    mocks.pomodoroGetDailyTotal.mockResolvedValue(25)
  })

  const dialogProps = (
    date = REVIEW_DATE,
    onCreated: () => void | Promise<void> = mocks.onCreated,
    routeOverride?: IdempotentCreateRoute,
  ) => ({
    date,
    aiAPI: { chat: mocks.aiChat },
    tasksAPI: {
      getByDate: mocks.tasksGetByDate,
      createIdempotentAIStudyTaskForCurrentDate: routeOverride ?? (async (
          request: IdempotentAIStudyTaskCreateRequest,
        ): Promise<IdempotentAIStudyTaskCreateResponse> => {
          const result = await mocks.tasksCreate(request.payload, request.expectedCurrentDate, request)
          if (result && typeof result === 'object' && 'ok' in result) {
            return { ...result, operationId: request.operationId } as IdempotentAIStudyTaskCreateResponse
          }
          return { ok: true, operationId: request.operationId, task: result, replayed: false }
        }),
    },
    mistakesAPI: { getAll: mocks.mistakesGetAll, getDueCount: mocks.mistakesGetDueCount },
    subjectsAPI: { getAll: mocks.subjectsGetAll },
    entriesAPI: { getByDate: mocks.entriesGetByDate },
    pomodoroAPI: { getStats: mocks.pomodoroGetStats, getDailyTotal: mocks.pomodoroGetDailyTotal },
    onClose: mocks.onClose,
    onCreated,
  })

  const renderDialog = (
    date = REVIEW_DATE,
    onCreated: () => void | Promise<void> = mocks.onCreated,
    routeOverride?: IdempotentCreateRoute,
  ) => render(
    <DailyReviewAgentDialog {...dialogProps(date, onCreated, routeOverride)} />,
  )

  const waitForInitialContext = async () => {
    await waitFor(() => {
      expect(mocks.tasksGetByDate).toHaveBeenCalledWith(REVIEW_DATE)
      expect(mocks.tasksGetByDate).toHaveBeenCalledWith(CANDIDATE_DATE)
    })
  }

  const generateCandidates = async () => {
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))
    return screen.findByDisplayValue('复习函数极限错题')
  }

  it('opens with a local deterministic preview without requesting AI or creating tasks', async () => {
    renderDialog()

    await waitForInitialContext()

    expect(screen.getByTestId('daily-review-context-preview')).toHaveTextContent('复盘依据（仅本地读取）')
    expect(screen.getByTestId('daily-review-deterministic-summary')).toBeInTheDocument()
    expect(mocks.aiChat).not.toHaveBeenCalled()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('portals its viewport-fixed overlay out of a transformed scrolling ancestor without changing page scroll', async () => {
    const transformedScroller = document.createElement('div')
    const renderHost = document.createElement('div')
    transformedScroller.style.transform = 'translateZ(0)'
    transformedScroller.style.overflow = 'auto'
    transformedScroller.append(renderHost)
    document.body.append(transformedScroller)

    const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY')
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 320 })

    try {
      const view = render(<DailyReviewAgentDialog {...dialogProps()} />, { container: renderHost })
      await waitForInitialContext()

      const dialog = screen.getByRole('dialog', { name: '每日复盘' })
      expect(window.scrollY).toBe(320)
      expect(dialog.parentElement).toBe(document.body)
      expect(transformedScroller.contains(dialog)).toBe(false)
      expect(dialog).toHaveStyle('position: fixed')
      expect(dialog).toHaveStyle('inset: 0')

      fireEvent.keyDown(window, { key: 'Escape' })
      expect(mocks.onClose).toHaveBeenCalledTimes(1)

      view.unmount()
      expect(screen.queryByRole('dialog', { name: '每日复盘' })).not.toBeInTheDocument()
      expect(scrollTo).not.toHaveBeenCalled()
    } finally {
      if (originalScrollY) Object.defineProperty(window, 'scrollY', originalScrollY)
      else Reflect.deleteProperty(window, 'scrollY')
      scrollTo.mockRestore()
      transformedScroller.remove()
    }
  })

  it('shows an empty-day message with no AI or task mutation', async () => {
    mocks.mistakesGetAll.mockResolvedValue({ data: [], total: 0, masteredTotal: 0 })
    mocks.mistakesGetDueCount.mockResolvedValue(0)
    mocks.entriesGetByDate.mockResolvedValue(null)
    mocks.pomodoroGetStats.mockResolvedValue([])
    mocks.pomodoroGetDailyTotal.mockResolvedValue(0)

    renderDialog()
    await waitForInitialContext()

    expect(await screen.findByTestId('daily-review-empty-day')).toBeInTheDocument()
    expect(mocks.aiChat).not.toHaveBeenCalled()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('requests AI only after the user clicks generate and keeps generated candidates memory-only', async () => {
    renderDialog()

    expect(screen.getByTestId('daily-review-generation-request-snapshot')).toHaveTextContent('尚未生成请求')
    await generateCandidates()

    expect(mocks.aiChat).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('daily-review-observations')).toHaveTextContent('AI 复盘建议')
    expect(await screen.findByTestId('daily-review-generation-request-context-subjects')).toHaveTextContent('请求处置：已加入本次请求')
    expect(screen.getByTestId('daily-review-provider-usage-disclaimer')).toHaveTextContent('无法证明模型内部是否实际使用了某项内容')
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('初始通过验证 1 项')
    expect(screen.getByRole('dialog')).not.toHaveTextContent('AI 已使用')
    expect(localStorage.length).toBe(0)
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('shows the Pomodoro unavailable marker as included without claiming source records were sent', async () => {
    mocks.pomodoroGetStats.mockRejectedValue(new Error('stats unavailable'))
    mocks.pomodoroGetDailyTotal.mockRejectedValue(new Error('total unavailable'))
    renderDialog()
    await waitForInitialContext()

    const currentDecision = await screen.findByTestId('daily-review-current-request-context-pomodoro')
    expect(currentDecision).toHaveTextContent('已加入本次请求：来源不可用标记')
    expect(currentDecision).toHaveTextContent('未发送专注记录或专注汇总')
    expect(currentDecision).toHaveTextContent('本地准备 0 项，请求加入 0 项')
    expect(currentDecision).not.toHaveTextContent('未加入本次请求')

    fireEvent.click(screen.getByTestId('daily-review-generate'))
    await screen.findByDisplayValue('复习函数极限错题')

    const generationDecision = screen.getByTestId('daily-review-generation-request-context-pomodoro')
    expect(generationDecision).toHaveTextContent('已加入本次请求：来源不可用标记')
    expect(generationDecision).toHaveTextContent('未发送专注记录或专注汇总')
    expect(generationDecision).not.toHaveTextContent('已发送 Pomodoro 数据')
    expect(generationDecision).not.toHaveTextContent('模型使用了专注记录')

    const sentMessages = mocks.aiChat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>
    expect(sentMessages.map(message => message.role)).toEqual(['system', 'user'])
    expect(sentMessages[1]?.content).toContain('"pomodoro":{"unavailable":true}')
  })

  it('keeps the generation request snapshot fixed while a local refresh updates only the current preview', async () => {
    renderDialog()
    expect(await screen.findByTestId('daily-review-current-request-context-subjects')).toHaveTextContent('本地准备 1 项')
    await generateCandidates()

    const generationSnapshot = screen.getByTestId('daily-review-generation-request-context-subjects')
    expect(generationSnapshot).toHaveTextContent('本地准备 1 项')

    mocks.subjectsGetAll.mockResolvedValue([subject, secondSubject])
    fireEvent.click(screen.getByTestId('daily-review-refresh-context'))

    await waitFor(() => expect(screen.getByTestId('daily-review-current-request-context-subjects')).toHaveTextContent('本地准备 2 项'))
    expect(generationSnapshot).toHaveTextContent('本地准备 1 项')
    expect(mocks.aiChat).toHaveBeenCalledTimes(1)
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('shows malformed and unknown-field AI output errors without creating tasks', async () => {
    mocks.aiChat.mockResolvedValueOnce({ content: '这里是建议：{"observations":[],"candidates":[]}' })
    renderDialog()
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))

    expect(await screen.findByTestId('daily-review-errors')).toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()

    mocks.aiChat.mockResolvedValueOnce({ content: JSON.stringify({ observations: [], candidates: [], unsafe: true }) })
    fireEvent.click(screen.getByTestId('daily-review-generate'))

    expect(await screen.findByTestId('daily-review-errors')).toHaveTextContent(/Unsupported|unknown|unsupported/i)
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('lets the user edit, unselect, and delete a candidate before confirmation', async () => {
    mocks.subjectsGetAll.mockResolvedValue([subject, secondSubject])
    renderDialog()
    await generateCandidates()

    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('初始通过验证 1 项')
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('当前已选择 1 项')

    fireEvent.change(screen.getByLabelText('候选任务标题'), { target: { value: '编辑后的任务' } })
    fireEvent.change(screen.getByLabelText('候选预计分钟数'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('候选关联科目'), { target: { value: '2' } })
    expect(screen.getByLabelText('候选任务标题')).toHaveValue('编辑后的任务')
    expect(screen.getByLabelText('候选预计分钟数')).toHaveValue(30)
    expect(screen.getByLabelText('候选关联科目')).toHaveValue('2')

    await waitFor(() => expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('已编辑 1 项'))
    expect(screen.getByTestId('daily-review-candidate-changes-daily-review-candidate-1')).toHaveTextContent('标题：复习函数极限错题 → 编辑后的任务')
    expect(screen.getByTestId('daily-review-candidate-changes-daily-review-candidate-1')).toHaveTextContent('预计分钟：10 → 30')

    fireEvent.change(screen.getByLabelText('候选任务标题'), { target: { value: '复习函数极限错题' } })
    fireEvent.change(screen.getByLabelText('候选预计分钟数'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('候选关联科目'), { target: { value: '1' } })

    await waitFor(() => expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('已编辑 0 项'))
    expect(screen.queryByTestId('daily-review-candidate-changes-daily-review-candidate-1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('选择候选任务：复习函数极限错题'))
    await waitFor(() => {
      expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('保留但未选择 1 项')
      expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('当前已选择 0 项')
    })
    expect(screen.getByTestId('daily-review-create-selected')).toBeDisabled()

    fireEvent.click(screen.getByLabelText('选择候选任务：复习函数极限错题'))
    await waitFor(() => expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('当前已选择 1 项'))
    fireEvent.change(screen.getByLabelText('候选任务标题'), { target: { value: '编辑后移除的任务' } })
    fireEvent.click(screen.getByLabelText('删除候选任务：编辑后移除的任务'))

    expect(screen.queryByDisplayValue('编辑后的任务')).not.toBeInTheDocument()
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('已移除 1 项')
    expect(screen.getByTestId('daily-review-candidate-decision-daily-review-candidate-1')).toHaveTextContent('编辑后移除的任务')
    expect(screen.getByTestId('daily-review-candidate-decision-daily-review-candidate-1')).toHaveTextContent('已移除')
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('synchronizes a review candidate subject to the selected due mistake, including null, and blocks later mismatches', async () => {
    mocks.subjectsGetAll.mockResolvedValue([subject, secondSubject])
    mocks.mistakesGetAll.mockResolvedValue({ data: [subjectlessMistake, mistake], total: 2, masteredTotal: 0 })
    mocks.mistakesGetDueCount.mockResolvedValue(2)
    renderDialog()
    await generateCandidates()

    const subjectControl = screen.getByLabelText('候选关联科目')
    const mistakeControl = screen.getByLabelText('关联截至次日到期错题')

    fireEvent.change(mistakeControl, { target: { value: String(subjectlessMistake.id) } })
    expect(subjectControl).toHaveValue('')
    expect(screen.getByTestId('daily-review-create-selected')).not.toBeDisabled()

    fireEvent.change(mistakeControl, { target: { value: String(mistake.id) } })
    expect(subjectControl).toHaveValue(String(subject.id))

    fireEvent.change(subjectControl, { target: { value: String(secondSubject.id) } })
    expect(await screen.findByText('复习建议的科目与所选错题不一致，请重新选择。')).toBeInTheDocument()
    expect(screen.getByTestId('daily-review-create-selected')).toBeDisabled()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('admits an invalid provider candidate only at its first repaired valid snapshot', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        observations: [],
        candidates: [{ title: '待修复任务', type: 'provider_raw_invalid_type', estimate_minutes: 10, reason: '类型需要用户修复。', priority: 'low', subject_ref: null, related_mistake_ref: null, related_entry_ref: null }],
      }),
    })
    renderDialog()
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))

    expect(await screen.findByText('这个建议的任务类型无法识别，请调整后再试。')).toBeInTheDocument()
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('初始通过验证 0 项')
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 0 项')
    expect(document.body.innerHTML).not.toContain('provider_raw_invalid_type')
    expect(screen.getByTestId('daily-review-create-selected')).toBeDisabled()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('候选任务类型'), { target: { value: 'focus' } })

    await waitFor(() => {
      expect(screen.queryByText('这个建议的任务类型无法识别，请调整后再试。')).not.toBeInTheDocument()
      expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 1 项')
      expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('初始通过验证 0 项')
      expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('已编辑 0 项')
      expect(screen.getByTestId('daily-review-create-selected')).toBeDisabled()
    })
    const repairedDecision = screen.getByTestId('daily-review-candidate-decision-daily-review-candidate-1')
    expect(repairedDecision).toHaveTextContent('模型候选：用户修复后通过本地验证')
    expect(repairedDecision).not.toHaveTextContent('provider_raw_invalid_type')

    fireEvent.change(screen.getByLabelText('候选任务标题'), { target: { value: '用户后续编辑' } })
    await waitFor(() => expect(repairedDecision).toHaveTextContent('标题：待修复任务 → 用户后续编辑'))
    fireEvent.change(screen.getByLabelText('候选任务标题'), { target: { value: '待修复任务' } })
    await waitFor(() => expect(repairedDecision).not.toHaveTextContent('标题：'))

    const selection = screen.getByLabelText('选择候选任务：待修复任务')
    fireEvent.click(selection)
    fireEvent.click(selection)
    await waitFor(() => expect(repairedDecision).toHaveTextContent('保留但未选择'))
    expect(repairedDecision).toHaveTextContent('模型候选：用户修复后通过本地验证')

    fireEvent.click(screen.getByLabelText('删除候选任务：待修复任务'))
    expect(repairedDecision).toHaveTextContent('已移除')
    expect(repairedDecision).toHaveTextContent('模型候选：用户修复后通过本地验证')

    fireEvent.click(screen.getByTestId('daily-review-generate'))
    await screen.findByDisplayValue('待修复任务')
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 0 项')
    expect(screen.queryByTestId('daily-review-candidate-decision-daily-review-candidate-1')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('候选任务类型'), { target: { value: 'focus' } })
    await waitFor(() => expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 1 项'))
    fireEvent.click(screen.getByLabelText('选择候选任务：待修复任务'))
    await waitFor(() => expect(screen.getByTestId('daily-review-create-selected')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('daily-review-create-selected'))

    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('daily-review-confirmation-outcome-daily-review-candidate-1')).toHaveAttribute('data-outcome-kind', 'created')
    expect(screen.getByTestId('daily-review-candidate-decision-daily-review-candidate-1')).toHaveTextContent(
      '模型候选：用户修复后通过本地验证',
    )
    expect(screen.getByTestId('daily-review-candidate-decision-daily-review-candidate-1')).toHaveTextContent('已确认')
  })

  it('shows bounded Chinese guidance for observed candidate validation failures', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        observations: [],
        candidates: [
          {
            title: '类型待修复任务',
            type: 'provider_raw_invalid_type',
            estimate_minutes: 10,
            reason: '需要用户选择可识别类型。',
            priority: 'low',
            subject_ref: null,
            related_mistake_ref: null,
            related_entry_ref: null,
          },
          {
            title: '缺少错题关联的复习任务',
            type: 'review',
            estimate_minutes: 10,
            reason: '需要关联当前可复习错题。',
            priority: 'medium',
            subject_ref: null,
            related_mistake_ref: null,
            related_entry_ref: null,
          },
        ],
      }),
    })

    renderDialog()
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))

    expect(await screen.findByText('这个建议的任务类型无法识别，请调整后再试。')).toBeInTheDocument()
    expect(screen.getByText('这个复习建议没有关联到当前可复习的错题，请修改任务类型或重新生成。')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('type is invalid')
    expect(document.body).not.toHaveTextContent('review candidates must reference a due mistake')
    expect(screen.getByTestId('daily-review-create-selected')).toBeDisabled()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('repairs an unselected candidate without admitting another invalid unselected candidate', async () => {
    mocks.tasksGetByDate.mockImplementation(async date => date === CANDIDATE_DATE
      ? [makeTask({ title: '已存在的其他次日复习任务' })]
      : [])
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        observations: [],
        candidates: [
          {
            title: '共享次日候选标题',
            type: 'review',
            estimate_minutes: 10,
            reason: 'A 与已有 review mistake 冲突。',
            priority: 'high',
            subject_ref: 'subject:1',
            related_mistake_ref: 'mistake:12',
            related_entry_ref: null,
          },
          {
            title: '共享次日候选标题',
            type: 'RAW_INVALID_TYPE_B',
            estimate_minutes: 10,
            reason: '只修复并创建 B。',
            priority: 'medium',
            subject_ref: null,
            related_mistake_ref: null,
            related_entry_ref: null,
          },
        ],
      }),
    })

    renderDialog()
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))

    expect(await screen.findByText('这道错题在计划日期已有复习任务，请取消关联或不选择此建议。')).toBeInTheDocument()
    expect(screen.getByText('这个建议的任务类型无法识别，请调整后再试。')).toBeInTheDocument()
    const selections = screen.getAllByLabelText('选择候选任务：共享次日候选标题')
    expect(selections[0]).not.toBeChecked()
    expect(selections[1]).not.toBeChecked()

    fireEvent.change(screen.getAllByLabelText('候选任务类型')[1]!, { target: { value: 'focus' } })

    await waitFor(() => {
      expect(screen.queryByText('这个建议的任务类型无法识别，请调整后再试。')).not.toBeInTheDocument()
      expect(screen.queryByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).not.toBeInTheDocument()
      expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 1 项')
    })
    const repairedDecision = screen.getByTestId('daily-review-candidate-decision-daily-review-candidate-2')
    expect(repairedDecision).toHaveTextContent('模型候选：用户修复后通过本地验证')
    expect(screen.queryByTestId('daily-review-candidate-decision-daily-review-candidate-1')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByLabelText('选择候选任务：共享次日候选标题')[1]!)
    await waitFor(() => expect(screen.getByTestId('daily-review-create-selected')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('daily-review-create-selected'))

    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('daily-review-confirmation-outcome-daily-review-candidate-2')).toHaveAttribute(
      'data-outcome-kind',
      'created',
    )
    expect(repairedDecision).toHaveTextContent('模型候选：用户修复后通过本地验证')
    expect(repairedDecision).toHaveTextContent('已确认')
  })

  it('does not pollute a selected candidate with a repaired peer hypothetical admission error', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        observations: [],
        candidates: [
          {
            title: '保持有效的次日已选任务',
            type: 'focus',
            estimate_minutes: 10,
            reason: 'A 当前有效且已选择。',
            priority: 'high',
            subject_ref: null,
            related_mistake_ref: null,
            related_entry_ref: null,
          },
          {
            title: '',
            type: 'focus',
            estimate_minutes: 10,
            reason: 'B 需要用户修复。',
            priority: 'medium',
            subject_ref: null,
            related_mistake_ref: null,
            related_entry_ref: null,
          },
        ],
      }),
    })

    renderDialog()
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))

    const selectedA = await screen.findByLabelText('选择候选任务：保持有效的次日已选任务')
    const unselectedB = screen.getByLabelText('选择候选任务：2')
    expect(selectedA).toBeChecked()
    expect(unselectedB).not.toBeChecked()
    expect(screen.getByTestId('daily-review-create-selected')).not.toBeDisabled()

    fireEvent.change(screen.getAllByLabelText('候选任务标题')[1]!, {
      target: { value: '保持有效的次日已选任务' },
    })

    await waitFor(() => {
      expect(screen.getAllByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).toHaveLength(1)
      expect(screen.getByTestId('daily-review-create-selected')).not.toBeDisabled()
    })
    expect(selectedA).toBeChecked()
    expect(screen.getAllByLabelText('选择候选任务：保持有效的次日已选任务')[1]).not.toBeChecked()
    expect(screen.queryByTestId('daily-review-candidate-decision-daily-review-candidate-2')).not.toBeInTheDocument()

    fireEvent.change(screen.getAllByLabelText('候选任务标题')[1]!, {
      target: { value: '修复后的唯一次日任务' },
    })

    await waitFor(() => {
      expect(screen.queryByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).not.toBeInTheDocument()
      expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 1 项')
    })
    const repairedDecision = screen.getByTestId('daily-review-candidate-decision-daily-review-candidate-2')
    expect(repairedDecision).toHaveTextContent('模型候选：用户修复后通过本地验证')
    expect(selectedA).toBeChecked()

    fireEvent.click(screen.getByLabelText('选择候选任务：修复后的唯一次日任务'))
    await waitFor(() => expect(screen.getByTestId('daily-review-create-selected')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('daily-review-create-selected'))

    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('daily-review-confirmation-outcome-daily-review-candidate-2')).toHaveAttribute(
      'data-outcome-kind',
      'created',
    )
  })

  it('admits only the edited member of a duplicate-title cohort and never admits from peer removal or selection', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        observations: [],
        candidates: [
          { title: '聚合重复标题', type: 'focus', estimate_minutes: 10, reason: '第一个候选。', priority: 'high', subject_ref: null, related_mistake_ref: null, related_entry_ref: null },
          { title: '聚合重复标题', type: 'focus', estimate_minutes: 10, reason: '第二个候选。', priority: 'medium', subject_ref: null, related_mistake_ref: null, related_entry_ref: null },
        ],
      }),
    })
    render(
      <StrictMode>
        <DailyReviewAgentDialog {...dialogProps()} />
      </StrictMode>,
    )
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))

    await waitFor(() => expect(screen.getAllByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).toHaveLength(2))
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 0 项')

    fireEvent.click(screen.getAllByLabelText('选择候选任务：聚合重复标题')[0]!)
    await waitFor(() => expect(screen.queryByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).not.toBeInTheDocument())
    fireEvent.click(screen.getAllByLabelText('选择候选任务：聚合重复标题')[1]!)
    await waitFor(() => expect(screen.getAllByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).toHaveLength(2))

    fireEvent.change(screen.getAllByLabelText('候选建议优先级')[0]!, { target: { value: 'high' } })
    fireEvent.change(screen.getAllByLabelText('候选理由')[0]!, { target: { value: '只修改不相关理由，不能解除标题冲突。' } })
    await waitFor(() => expect(screen.getAllByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).toHaveLength(2))
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 0 项')

    fireEvent.change(screen.getAllByLabelText('候选任务标题')[0]!, { target: { value: '用户修复后的唯一标题' } })
    await waitFor(() => {
      expect(screen.queryByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).not.toBeInTheDocument()
      expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 1 项')
    })
    expect(screen.getAllByTestId('daily-review-candidate-decision-daily-review-candidate-1')).toHaveLength(1)
    expect(screen.queryByTestId('daily-review-candidate-decision-daily-review-candidate-2')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('daily-review-generate'))
    await waitFor(() => expect(screen.getAllByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).toHaveLength(2))
    fireEvent.click(screen.getAllByLabelText('删除候选任务：聚合重复标题')[1]!)
    await waitFor(() => expect(screen.queryByText('选中的建议中有重复标题，请修改标题或取消重复选择。')).not.toBeInTheDocument())
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 0 项')
    expect(screen.queryByTestId('daily-review-candidate-decision-daily-review-candidate-1')).not.toBeInTheDocument()

    const remainingSelection = screen.getByLabelText('选择候选任务：聚合重复标题')
    fireEvent.click(remainingSelection)
    await waitFor(() => expect(remainingSelection).toBeChecked())
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 0 项')
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('admits only the edited member when a duplicate-mistake cohort becomes valid', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        observations: [],
        candidates: [
          { title: '错题聚合候选 A', type: 'review', estimate_minutes: 10, reason: '先复习 A。', priority: 'high', subject_ref: 'subject:1', related_mistake_ref: 'mistake:12', related_entry_ref: null },
          { title: '错题聚合候选 B', type: 'review', estimate_minutes: 10, reason: '再复习 B。', priority: 'medium', subject_ref: 'subject:1', related_mistake_ref: 'mistake:12', related_entry_ref: null },
        ],
      }),
    })
    renderDialog()
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))

    await waitFor(() => expect(screen.getAllByText('多个选中建议关联了同一道错题，请只保留一个。')).toHaveLength(2))
    fireEvent.click(screen.getByLabelText('选择候选任务：错题聚合候选 A'))
    await waitFor(() => expect(screen.queryByText('多个选中建议关联了同一道错题，请只保留一个。')).not.toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('选择候选任务：错题聚合候选 B'))
    await waitFor(() => expect(screen.getAllByText('多个选中建议关联了同一道错题，请只保留一个。')).toHaveLength(2))
    fireEvent.change(screen.getAllByLabelText('候选任务类型')[0]!, { target: { value: 'focus' } })

    await waitFor(() => {
      expect(screen.queryByText('多个选中建议关联了同一道错题，请只保留一个。')).not.toBeInTheDocument()
      expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 1 项')
    })
    expect(screen.getByTestId('daily-review-candidate-decision-daily-review-candidate-1')).toHaveTextContent('模型候选：用户修复后通过本地验证')
    expect(screen.queryByTestId('daily-review-candidate-decision-daily-review-candidate-2')).not.toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('retains combined-budget evidence through invalid edits and admits only the first valid repair', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        observations: [],
        candidates: [
          { title: '预算聚合候选 A', type: 'focus', estimate_minutes: 60, reason: '预算 A。', priority: 'high', subject_ref: null, related_mistake_ref: null, related_entry_ref: null },
          { title: '预算聚合候选 B', type: 'focus', estimate_minutes: 60, reason: '预算 B。', priority: 'medium', subject_ref: null, related_mistake_ref: null, related_entry_ref: null },
        ],
      }),
    })
    renderDialog()
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))

    await waitFor(() => expect(screen.getAllByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).toHaveLength(2))
    fireEvent.click(screen.getByLabelText('选择候选任务：预算聚合候选 A'))
    await waitFor(() => expect(screen.queryByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).not.toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('选择候选任务：预算聚合候选 B'))
    await waitFor(() => expect(screen.getAllByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).toHaveLength(2))
    fireEvent.change(screen.getAllByLabelText('候选预计分钟数')[0]!, { target: { value: '50' } })
    await waitFor(() => expect(screen.getAllByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).toHaveLength(2))
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 0 项')

    fireEvent.change(screen.getAllByLabelText('候选预计分钟数')[0]!, { target: { value: '30' } })
    await waitFor(() => {
      expect(screen.queryByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).not.toBeInTheDocument()
      expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 1 项')
    })
    fireEvent.change(screen.getAllByLabelText('候选预计分钟数')[0]!, { target: { value: '30' } })
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 1 项')
    expect(screen.queryByTestId('daily-review-candidate-decision-daily-review-candidate-2')).not.toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('does not admit from context refresh or selection and admits only the edited conflict transition', async () => {
    mocks.tasksGetByDate.mockImplementation(async date => date === CANDIDATE_DATE
      ? [makeTask({
          id: 202,
          title: '次日已存在的冲突任务',
          type: 'focus',
          subject_id: null,
          related_mistake_id: null,
          source: 'manual',
        })]
      : [])
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        observations: [],
        candidates: [{
          title: '次日已存在的冲突任务',
          type: 'focus',
          estimate_minutes: 10,
          reason: '需要用户明确修复标题冲突。',
          priority: 'medium',
          subject_ref: null,
          related_mistake_ref: null,
          related_entry_ref: null,
        }],
      }),
    })
    renderDialog()
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))

    expect(await screen.findByText('计划日期已有同名进行中任务，请修改标题或不选择此建议。')).toBeInTheDocument()
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 0 项')

    fireEvent.click(screen.getByTestId('daily-review-refresh-context'))
    await waitFor(() => expect(screen.queryByText('计划日期已有同名进行中任务，请修改标题或不选择此建议。')).not.toBeInTheDocument())
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 0 项')
    expect(screen.queryByTestId('daily-review-candidate-decision-daily-review-candidate-1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('选择候选任务：次日已存在的冲突任务'))
    expect(await screen.findByText('计划日期已有同名进行中任务，请修改标题或不选择此建议。')).toBeInTheDocument()
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 0 项')
    expect(screen.getByTestId('daily-review-create-selected')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('候选任务标题'), { target: { value: '用户明确修复后的次日任务' } })
    await waitFor(() => {
      expect(screen.queryByText('计划日期已有同名进行中任务，请修改标题或不选择此建议。')).not.toBeInTheDocument()
      expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 1 项')
      expect(screen.getByTestId('daily-review-create-selected')).not.toBeDisabled()
    })
    expect(screen.getByTestId('daily-review-candidate-decision-daily-review-candidate-1')).toHaveTextContent(
      '模型候选：用户修复后通过本地验证',
    )
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('does not admit when available minutes alone clear an error and requires a later invalid-to-valid edit', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        observations: [],
        candidates: [{
          title: '次日预算候选',
          type: 'focus',
          estimate_minutes: 100,
          reason: '验证预算变化不会伪造用户修复。',
          priority: 'low',
          subject_ref: null,
          related_mistake_ref: null,
          related_entry_ref: null,
        }],
      }),
    })
    renderDialog()
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))

    expect(await screen.findByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('daily-review-available-minutes'), { target: { value: '120' } })
    await waitFor(() => expect(screen.queryByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).not.toBeInTheDocument())
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 0 项')

    fireEvent.click(screen.getByLabelText('选择候选任务：次日预算候选'))
    await waitFor(() => expect(screen.getByLabelText('选择候选任务：次日预算候选')).toBeChecked())
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 0 项')
    expect(screen.getByTestId('daily-review-create-selected')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('候选预计分钟数'), { target: { value: '130' } })
    expect(await screen.findByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).toBeInTheDocument()
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 0 项')

    fireEvent.change(screen.getByLabelText('候选预计分钟数'), { target: { value: '100' } })
    await waitFor(() => {
      expect(screen.queryByText('选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。')).not.toBeInTheDocument()
      expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 1 项')
      expect(screen.getByTestId('daily-review-create-selected')).not.toBeDisabled()
    })
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('admits a repaired candidate once under StrictMode effect replay', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        observations: [],
        candidates: [{
          title: 'StrictMode 次日待修复候选',
          type: 'RAW_INVALID_SECRET_TYPE',
          estimate_minutes: 10,
          reason: '修复后只能纳入一次。',
          priority: 'low',
          subject_ref: null,
          related_mistake_ref: null,
          related_entry_ref: null,
        }],
      }),
    })
    render(
      <StrictMode>
        <DailyReviewAgentDialog {...dialogProps()} />
      </StrictMode>,
    )
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))
    expect(await screen.findByText('这个建议的任务类型无法识别，请调整后再试。')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('候选任务类型'), { target: { value: 'focus' } })
    await waitFor(() => expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('用户修复后纳入 1 项'))
    expect(screen.getAllByTestId('daily-review-candidate-decision-daily-review-candidate-1')).toHaveLength(1)
    expect(document.body.innerHTML).not.toContain('RAW_INVALID_SECRET_TYPE')
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('requires a second explicit confirmation when the safe context has become stale', async () => {
    const createActionSpy = vi.spyOn(agentStudyTaskActions, 'createConfirmedStudyTaskAction')
    let taskRows: StudyTask[] = []
    mocks.tasksGetByDate.mockImplementation(async () => taskRows)
    renderDialog()
    await generateCandidates()

    taskRows = [makeTask({ id: 101, title: '新出现的次日任务', type: 'focus', subject_id: null, related_mistake_id: null, planned_date: CANDIDATE_DATE, source: 'manual' })]
    fireEvent.click(screen.getByTestId('daily-review-create-selected'))

    expect(await screen.findByTestId('daily-review-stale-context')).toHaveTextContent('请查看结果后再次确认创建')
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
    expect(createActionSpy).not.toHaveBeenCalled()
    expect(screen.getByTestId('daily-review-confirmation-outcomes')).toHaveTextContent('尚无已确认候选')

    fireEvent.click(screen.getByTestId('daily-review-create-selected'))
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))
    const snapshot = createActionSpy.mock.calls[0]?.[0].confirmationSnapshot
    expect(snapshot?.generation.operationKind).toBe('daily_review')
    expect(snapshot?.generation.versions.promptVersion).toBe('daily-review.prompt.v1')
    expect(snapshot?.generation.generationContextSignature)
      .not.toBe(snapshot?.confirmationContextSignature)
    expect(snapshot?.generation.generationContextSignature).not.toContain('新出现的次日任务')
    expect(snapshot?.confirmationContextSignature).toContain('新出现的次日任务')
    createActionSpy.mockRestore()
  })

  it('replaces old generation provenance when the user regenerates', async () => {
    const provenanceSpy = vi.spyOn(aiOperationContracts, 'createAIStudyTaskGenerationProvenance')
    const createActionSpy = vi.spyOn(agentStudyTaskActions, 'createConfirmedStudyTaskAction')
    let candidateDateRows: StudyTask[] = []
    mocks.tasksGetByDate.mockImplementation(async (requestDate: string) => (
      requestDate === CANDIDATE_DATE ? candidateDateRows : []
    ))
    renderDialog()
    await generateCandidates()
    expect(provenanceSpy).toHaveBeenCalledTimes(1)
    const firstGenerationSnapshot = screen.getByTestId('daily-review-generation-request-snapshot').textContent
    fireEvent.click(screen.getByLabelText('删除候选任务：复习函数极限错题'))
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('已移除 1 项')

    candidateDateRows = [makeTask({
      id: 102,
      title: '重新生成前新增的次日任务',
      type: 'focus',
      subject_id: null,
      related_mistake_id: null,
      source: 'manual',
    })]
    fireEvent.click(screen.getByTestId('daily-review-generate'))
    await waitFor(() => expect(provenanceSpy).toHaveBeenCalledTimes(2))
    expect(await screen.findByDisplayValue('复习函数极限错题')).toBeInTheDocument()
    expect(screen.getByTestId('daily-review-generation-request-snapshot').textContent).not.toBe(firstGenerationSnapshot)
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('已移除 0 项')
    fireEvent.click(screen.getByTestId('daily-review-create-selected'))
    await waitFor(() => expect(createActionSpy).toHaveBeenCalledTimes(1))

    const firstGenerationSignature = provenanceSpy.mock.calls[0]?.[1]
    const secondGenerationSignature = provenanceSpy.mock.calls[1]?.[1]
    const snapshot = createActionSpy.mock.calls[0]?.[0].confirmationSnapshot
    expect(firstGenerationSignature).not.toContain('重新生成前新增的次日任务')
    expect(secondGenerationSignature).toContain('重新生成前新增的次日任务')
    expect(snapshot?.generation.generationContextSignature).toBe(secondGenerationSignature)
    provenanceSpy.mockRestore()
    createActionSpy.mockRestore()
  })

  it('preserves successful creation state and summary through a parent refresh rerender', async () => {
    const createdTask = makeTask({ id: 301 })
    let candidateDateRows: StudyTask[] = []
    mocks.tasksGetByDate.mockImplementation(async (requestDate: string) => requestDate === CANDIDATE_DATE ? candidateDateRows : [])
    mocks.tasksCreate.mockImplementation(async () => {
      candidateDateRows = [...candidateDateRows, createdTask]
      return createdTask
    })

    function ParentRefreshHarness() {
      const [refreshVersion, setRefreshVersion] = useState(0)
      return (
        <>
          <span data-testid="daily-review-parent-refresh-version">{refreshVersion}</span>
          <DailyReviewAgentDialog
            {...dialogProps(REVIEW_DATE, async () => {
              setRefreshVersion(version => version + 1)
            })}
          />
        </>
      )
    }

    render(<ParentRefreshHarness />)
    await generateCandidates()

    candidateDateRows = [makeTask({ id: 300, title: '刚新增的次日任务', type: 'focus', subject_id: null, related_mistake_id: null, source: 'manual' })]
    fireEvent.click(screen.getByTestId('daily-review-create-selected'))
    expect(await screen.findByTestId('daily-review-stale-context')).toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('daily-review-create-selected'))
    await waitFor(() => {
      expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('daily-review-parent-refresh-version')).toHaveTextContent('1')
    })

    expect(screen.getByDisplayValue('复习函数极限错题')).toBeInTheDocument()
    expect(screen.getByText('已创建 #301')).toBeInTheDocument()
    expect(screen.getByTestId('daily-review-creation-summary')).toHaveTextContent('本次新创建 1 项，重放确认 0 项，未新建 0 项')
    const createdSelection = screen.getByLabelText('选择候选任务：复习函数极限错题')
    expect(createdSelection).not.toBeChecked()
    expect(createdSelection).toBeDisabled()
    expect(screen.getByTestId('daily-review-create-selected')).toBeDisabled()
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
  })

  it('keeps created candidates and reports a refresh error when onCreated rejects', async () => {
    mocks.onCreated.mockRejectedValueOnce(new Error('dashboard refresh failed'))
    renderDialog()
    await generateCandidates()

    fireEvent.click(screen.getByTestId('daily-review-create-selected'))

    expect(await screen.findByText('已创建 #99')).toBeInTheDocument()
    expect(screen.getByTestId('daily-review-creation-summary')).toHaveTextContent('本次新创建 1 项，重放确认 0 项，未新建 0 项')
    expect(await screen.findByText('列表刷新失败：dashboard refresh failed')).toBeInTheDocument()
    expect(screen.getByDisplayValue('复习函数极限错题')).toBeInTheDocument()
    expect(screen.getByLabelText('选择候选任务：复习函数极限错题')).toBeDisabled()
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
  })

  it('does zero writes when the pre-create context refresh fails', async () => {
    renderDialog()
    await generateCandidates()

    mocks.tasksGetByDate.mockRejectedValueOnce(new Error('context refresh failed'))
    fireEvent.click(screen.getByTestId('daily-review-create-selected'))

    expect(await screen.findByTestId('daily-review-creation-error')).toHaveTextContent('创建前无法刷新复盘依据：context refresh failed')
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('preserves partial creation success and retries only remaining failed candidates', async () => {
    const createActionSpy = vi.spyOn(agentStudyTaskActions, 'createConfirmedStudyTaskAction')
    const createdA = makeTask({ id: 201, title: '任务 A', type: 'focus', subject_id: null, related_mistake_id: null })
    const createdB = makeTask({ id: 202, title: '任务 B', type: 'focus', subject_id: null, related_mistake_id: null })
    let candidateDateRows: StudyTask[] = []
    mocks.tasksGetByDate.mockImplementation(async (requestDate: string) => requestDate === CANDIDATE_DATE ? candidateDateRows : [])
    mocks.aiChat.mockResolvedValue({ content: twoCandidateResponse })
    mocks.tasksCreate.mockImplementationOnce(async () => {
      candidateDateRows = [createdA]
      return createdA
    }).mockResolvedValueOnce({
      ok: false,
      code: 'INTEGRITY_ERROR',
      message: 'second write failed',
    }).mockImplementationOnce(async () => {
      candidateDateRows = [createdA, createdB]
      return createdB
    })

    function ParentRefreshHarness() {
      const [refreshVersion, setRefreshVersion] = useState(0)
      return (
        <>
          <span data-testid="daily-review-parent-refresh-version">{refreshVersion}</span>
          <DailyReviewAgentDialog
            {...dialogProps(REVIEW_DATE, async () => {
              setRefreshVersion(version => version + 1)
            })}
          />
        </>
      )
    }

    render(<ParentRefreshHarness />)
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))
    await screen.findByDisplayValue('任务 A')

    fireEvent.click(screen.getByTestId('daily-review-create-selected'))
    expect(await screen.findByTestId('daily-review-creation-summary')).toHaveTextContent('本次新创建 1 项，重放确认 0 项，未新建 1 项')
    expect(screen.getByTestId('daily-review-confirmation-outcome-daily-review-candidate-1')).toHaveAttribute('data-outcome-kind', 'created')
    expect(screen.getByTestId('daily-review-confirmation-outcome-daily-review-candidate-2')).toHaveAttribute('data-outcome-kind', 'integrity_error')
    await waitFor(() => expect(screen.getByTestId('daily-review-parent-refresh-version')).toHaveTextContent('1'))
    expect(screen.getByText('已创建 #201')).toBeInTheDocument()
    expect(screen.getByText('完整性检查未通过，本次操作已安全终止')).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('second write failed')
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(2)
    expect(createActionSpy).toHaveBeenCalledTimes(2)
    const firstSnapshot = createActionSpy.mock.calls[0]?.[0].confirmationSnapshot
    const secondSnapshot = createActionSpy.mock.calls[1]?.[0].confirmationSnapshot
    expect(firstSnapshot).toBeDefined()
    expect(secondSnapshot).toBe(firstSnapshot)

    const retryTitleInput = screen.getAllByLabelText('候选任务标题').find(input => input.getAttribute('value') === '任务 B')
    expect(retryTitleInput).toBeDefined()
    expect(retryTitleInput).not.toBeDisabled()
    fireEvent.change(retryTitleInput!, { target: { value: '任务 B 重试' } })

    fireEvent.click(screen.getByTestId('daily-review-create-selected'))
    await waitFor(() => {
      expect(mocks.tasksCreate).toHaveBeenCalledTimes(3)
      expect(screen.getByTestId('daily-review-parent-refresh-version')).toHaveTextContent('2')
    })
    expect(screen.getByTestId('daily-review-confirmation-outcome-daily-review-candidate-2')).toHaveAttribute('data-outcome-kind', 'created')
    expect(screen.getByTestId('daily-review-candidate-decision-daily-review-candidate-2')).toHaveTextContent('任务 B 重试')

    const createdTitles = mocks.tasksCreate.mock.calls.map(([input]) => input.title)
    expect(createdTitles.filter(title => title === '任务 A')).toHaveLength(1)
    expect(createdTitles.filter(title => title === '任务 B')).toHaveLength(1)
    expect(createdTitles.filter(title => title === '任务 B 重试')).toHaveLength(1)
    expect(createActionSpy.mock.calls[2]?.[0].confirmationSnapshot.generation)
      .toBe(firstSnapshot?.generation)
    createActionSpy.mockRestore()
  })

  it('uses local candidate date, todo status, and ai source rather than model-owned fields', async () => {
    renderDialog()
    await generateCandidates()
    fireEvent.click(screen.getByTestId('daily-review-create-selected'))

    await waitFor(() => {
      expect(mocks.tasksCreate).toHaveBeenCalledWith(expect.objectContaining({
        title: '复习函数极限错题',
        planned_date: CANDIDATE_DATE,
        status: 'todo',
        source: 'ai',
        related_entry_id: null,
        related_chapter_id: null,
      }), REVIEW_DATE, expect.objectContaining({ operationKind: 'daily_review' }))
      expect(mocks.onCreated).toHaveBeenCalledTimes(1)
    })
    const outcome = screen.getByTestId('daily-review-confirmation-outcome-daily-review-candidate-1')
    expect(outcome).toHaveAttribute('data-outcome-kind', 'created')
    expect(outcome).toHaveTextContent('已创建任务')
    expect(outcome).toHaveTextContent('任务 ID：99')
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('已确认 1 项')
  })

  it('revalidates and persists the final user-edited candidate fields', async () => {
    renderDialog()
    await generateCandidates()

    fireEvent.change(screen.getByLabelText('候选任务标题'), { target: { value: '编辑后的次日复习' } })
    fireEvent.change(screen.getByLabelText('候选预计分钟数'), { target: { value: '35' } })
    fireEvent.change(screen.getByLabelText('候选理由'), { target: { value: '按最终确认内容执行。' } })
    fireEvent.click(screen.getByTestId('daily-review-create-selected'))

    await waitFor(() => {
      expect(mocks.tasksCreate).toHaveBeenCalledWith({
        title: '编辑后的次日复习',
        description: '按最终确认内容执行。',
        type: 'review',
        subject_id: 1,
        related_mistake_id: 12,
        related_entry_id: null,
        related_chapter_id: null,
        planned_date: CANDIDATE_DATE,
        estimate_minutes: 35,
        status: 'todo',
        source: 'ai',
      }, REVIEW_DATE, expect.objectContaining({ operationKind: 'daily_review' }))
    })
  })

  it('rejects model-provided planned_date, status, and source fields', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        observations: [],
        candidates: [{ title: '越权候选', type: 'focus', estimate_minutes: 10, reason: '不应接受。', priority: 'low', subject_ref: null, related_mistake_ref: null, related_entry_ref: null, planned_date: '2030-01-01', status: 'done', source: 'manual' }],
      }),
    })
    renderDialog()
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))

    expect(await screen.findByTestId('daily-review-errors')).toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('closes when idle and does not close while generating', async () => {
    const deferred = createDeferred<AIResponse>()
    mocks.aiChat.mockReturnValue(deferred.promise)
    renderDialog()
    await waitForInitialContext()

    fireEvent.click(screen.getByTestId('daily-review-generate'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(mocks.onClose).not.toHaveBeenCalled()

    await act(async () => {
      deferred.resolve({ content: validAiResponse })
      await deferred.promise
    })
    await screen.findByDisplayValue('复习函数极限错题')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('daily-review-generation-request-snapshot')).toHaveTextContent('尚未生成请求'))
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('初始通过验证 0 项')
  })

  it('does not apply a stale generation result after unmount and does not leak candidates across a new dialog', async () => {
    const deferred = createDeferred<AIResponse>()
    mocks.aiChat.mockReturnValueOnce(deferred.promise)
    const first = renderDialog()
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))
    first.unmount()

    await act(async () => {
      deferred.resolve({ content: validAiResponse })
      await deferred.promise
    })

    renderDialog()
    await waitForInitialContext()
    expect(screen.queryByDisplayValue('复习函数极限错题')).not.toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('unlocks generation and ignores an old-date AI response after the review date changes', async () => {
    const deferred = createDeferred<AIResponse>()
    mocks.aiChat.mockReturnValueOnce(deferred.promise)
    const view = renderDialog()
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))
    await waitFor(() => expect(mocks.aiChat).toHaveBeenCalledTimes(1))

    view.rerender(<DailyReviewAgentDialog {...dialogProps('2026-06-13')} />)

    await waitFor(() => expect(screen.getByLabelText('关闭每日复盘')).not.toBeDisabled())
    await act(async () => {
      deferred.resolve({ content: validAiResponse })
      await deferred.promise
    })

    expect(screen.queryByDisplayValue('复习函数极限错题')).not.toBeInTheDocument()
    expect(screen.queryByTestId('daily-review-errors')).not.toBeInTheDocument()
    expect(screen.getByTestId('daily-review-generation-request-snapshot')).toHaveTextContent('尚未生成请求')
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('初始通过验证 0 项')
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('unlocks an in-flight old-date creation after the review date changes', async () => {
    const firstWrite = createDeferred<StudyTask>()
    mocks.tasksCreate.mockReturnValueOnce(firstWrite.promise)
    const view = renderDialog()
    await generateCandidates()
    fireEvent.click(screen.getByTestId('daily-review-create-selected'))
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))

    view.rerender(<DailyReviewAgentDialog {...dialogProps('2026-06-13')} />)
    await act(async () => {
      firstWrite.resolve(makeTask())
      await firstWrite.promise
    })

    await waitFor(() => expect(screen.getByLabelText('关闭每日复盘')).not.toBeDisabled())
    expect(screen.queryByDisplayValue('复习函数极限错题')).not.toBeInTheDocument()
    expect(mocks.onCreated).not.toHaveBeenCalled()
  })

  it('does not create an old-date candidate when the dialog unmounts during the pre-create refresh', async () => {
    const view = renderDialog()
    await generateCandidates()
    const pendingTasks = createDeferred<StudyTask[]>()
    mocks.tasksGetByDate.mockReturnValueOnce(Promise.resolve([])).mockReturnValueOnce(pendingTasks.promise)

    fireEvent.click(screen.getByTestId('daily-review-create-selected'))
    view.unmount()

    await act(async () => {
      pendingTasks.resolve([])
      await pendingTasks.promise
    })

    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('creates normally after the StrictMode mount-effect replay', async () => {
    render(
      <StrictMode>
        <DailyReviewAgentDialog {...dialogProps()} />
      </StrictMode>,
    )
    await generateCandidates()

    fireEvent.click(screen.getByTestId('daily-review-create-selected'))

    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ planned_date: CANDIDATE_DATE, source: 'ai' }),
      REVIEW_DATE,
      expect.objectContaining({ operationKind: 'daily_review' }),
    ))
  })

  it('separates a replayed success from a newly created task in the batch and candidate outcomes', async () => {
    mocks.tasksCreate.mockResolvedValueOnce({
      ok: true,
      task: makeTask({ id: 405 }),
      replayed: true,
    })
    renderDialog()
    await generateCandidates()

    fireEvent.click(screen.getByTestId('daily-review-create-selected'))

    expect(await screen.findByTestId('daily-review-creation-summary')).toHaveTextContent('本次新创建 0 项，重放确认 1 项，未新建 0 项')
    const outcome = screen.getByTestId('daily-review-confirmation-outcome-daily-review-candidate-1')
    expect(outcome).toHaveAttribute('data-outcome-kind', 'replayed')
    expect(outcome).toHaveTextContent('原操作此前已完成，本次未重复创建')
    expect(outcome).toHaveTextContent('任务 ID：405')
  })

  it.each([
    ['IDEMPOTENCY_CONFLICT', 'conflict', '该操作 ID 已对应另一份确认内容，本次未新建任务'],
    ['RESULT_DELETED', 'deleted', '原操作曾成功关联任务，但该任务后来已删除；本次检查没有新建任务。'],
    ['INTEGRITY_ERROR', 'integrity_error', '完整性检查未通过，本次操作已安全终止'],
    ['DATE_MISMATCH', 'date_mismatch', '确认日期已失效，本次未创建任务'],
    ['INVALID_REQUEST', 'validation_error', '确认内容未通过校验，本次未创建任务'],
  ] as const)('shows the fixed %s confirmation outcome without treating it as a created task', async (code, outcomeKind, fixedMessage) => {
    mocks.tasksCreate.mockResolvedValueOnce({
      ok: false,
      code,
      message: `untrusted backend detail for ${code}`,
    })
    renderDialog()
    await generateCandidates()

    fireEvent.click(screen.getByTestId('daily-review-create-selected'))

    const outcome = await screen.findByTestId('daily-review-confirmation-outcome-daily-review-candidate-1')
    expect(outcome).toHaveAttribute('data-outcome-kind', outcomeKind)
    expect(outcome).toHaveTextContent(fixedMessage)
    expect(outcome).toHaveTextContent('操作 ID：')
    expect(outcome).not.toHaveTextContent('untrusted backend detail')
    expect(screen.getByTestId('daily-review-candidate-decision-counts')).toHaveTextContent('已确认 1 项')
    expect(mocks.onCreated).not.toHaveBeenCalled()
  })

  it('treats a validation-then-malformed live success as uncertain without leaking or clearing recovery state', async () => {
    let fixture: ReturnType<typeof createValidationThenMalformedSuccess> | undefined
    const route = vi.fn(async (request: IdempotentAIStudyTaskCreateRequest) => {
      fixture = createValidationThenMalformedSuccess(request.operationId)
      return fixture.response
    })
    const consoleCapture = captureConsole()
    try {
      renderDialog(REVIEW_DATE, mocks.onCreated, route)
      await generateCandidates()
      fireEvent.click(screen.getByTestId('daily-review-create-selected'))

      const outcome = await screen.findByTestId('daily-review-confirmation-outcome-daily-review-candidate-1')
      expect(outcome).toHaveAttribute('data-outcome-kind', 'uncertain')
      expect(outcome).toHaveTextContent('结果尚无法确认，需要用户手动检查')
      expect(screen.getByDisplayValue('复习函数极限错题')).toBeDisabled()
      expect(route).toHaveBeenCalledTimes(1)
      expect(mocks.onCreated).not.toHaveBeenCalled()

      const pending = localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)
      expect(pending).not.toBeNull()
      expect(pending).not.toContain('RAW_SECRET_')
      expect(document.body.innerHTML).not.toContain('RAW_SECRET_')
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(route).toHaveBeenCalledTimes(1)
      expect(fixture?.taskReads()).toBeGreaterThanOrEqual(2)
      fixture?.expectUnchanged()
      consoleCapture.expectNoCalls()
    } finally {
      consoleCapture.restore()
    }
  })

  it('keeps the exact pending receipt when recovery returns a validation-then-malformed success', async () => {
    let fixture: ReturnType<typeof createValidationThenMalformedSuccess> | undefined
    let routeCalls = 0
    const route = vi.fn(async (request: IdempotentAIStudyTaskCreateRequest) => {
      routeCalls += 1
      if (routeCalls === 1) throw new Error('RAW_SECRET_TRANSPORT_DETAIL')
      fixture = createValidationThenMalformedSuccess(request.operationId)
      return fixture.response
    })
    const consoleCapture = captureConsole()
    try {
      renderDialog(REVIEW_DATE, mocks.onCreated, route)
      await generateCandidates()
      fireEvent.click(screen.getByTestId('daily-review-create-selected'))

      const uncertainOutcome = await screen.findByTestId('daily-review-confirmation-outcome-daily-review-candidate-1')
      expect(uncertainOutcome).toHaveAttribute('data-outcome-kind', 'uncertain')
      const pendingBefore = localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)
      expect(pendingBefore).not.toBeNull()
      const stored = JSON.parse(pendingBefore!) as {
        operations: Array<IdempotentAIStudyTaskCreateRequest & { createdAt: string }>
      }
      const pending = stored.operations[0]!
      expect(route).toHaveBeenCalledTimes(1)

      fireEvent.click(await screen.findByTestId(`recover-pending-study-task-${pending.operationId}`))
      await waitFor(() => expect(route).toHaveBeenCalledTimes(2))
      await waitFor(() => {
        expect(screen.getByTestId('daily-review-confirmation-outcome-daily-review-candidate-1')).toHaveAttribute('data-outcome-kind', 'uncertain')
        expect(screen.getByTestId('daily-review-confirmation-outcome-daily-review-candidate-1')).toHaveTextContent('结果尚无法确认，需要用户手动检查')
      })

      expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBe(pendingBefore)
      expect(screen.getByTestId(`pending-study-task-operation-${pending.operationId}`)).toBeInTheDocument()
      expect(screen.getByDisplayValue('复习函数极限错题')).toBeDisabled()
      expect(mocks.onCreated).not.toHaveBeenCalled()
      expect(document.body.innerHTML).not.toContain('RAW_SECRET_')
      expect(pendingBefore).not.toContain('RAW_SECRET_')
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(route).toHaveBeenCalledTimes(2)
      expect(fixture?.taskReads()).toBeGreaterThanOrEqual(2)
      fixture?.expectUnchanged()
      consoleCapture.expectNoCalls()
    } finally {
      consoleCapture.restore()
    }
  })

  it('updates the live uncertain outcome only after an explicit recovery click and maps replayed success', async () => {
    mocks.tasksCreate
      .mockRejectedValueOnce(new Error('reply lost'))
      .mockResolvedValueOnce({
        ok: true,
        task: makeTask({ id: 404 }),
        replayed: true,
      })
    renderDialog()
    await generateCandidates()

    fireEvent.click(screen.getByTestId('daily-review-create-selected'))

    const uncertainOutcome = await screen.findByTestId('daily-review-confirmation-outcome-daily-review-candidate-1')
    expect(uncertainOutcome).toHaveAttribute('data-outcome-kind', 'uncertain')
    expect(uncertainOutcome).toHaveTextContent('结果尚无法确认，需要用户手动检查')
    const stored = JSON.parse(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)!) as {
      operations: Array<IdempotentAIStudyTaskCreateRequest & { createdAt: string }>
    }
    const pending = stored.operations[0]!
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
    expect(await screen.findByTestId(`recover-pending-study-task-${pending.operationId}`)).toBeInTheDocument()
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId(`recover-pending-study-task-${pending.operationId}`))

    await waitFor(() => expect(screen.getByTestId('daily-review-confirmation-outcome-daily-review-candidate-1')).toHaveAttribute('data-outcome-kind', 'replayed'))
    const replayedOutcome = screen.getByTestId('daily-review-confirmation-outcome-daily-review-candidate-1')
    expect(replayedOutcome).toHaveTextContent('原操作此前已完成，本次未重复创建')
    expect(replayedOutcome).toHaveTextContent('任务 ID：404')
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(2)
    expect(mocks.onCreated).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
  })

  it('persists a Daily Review pending operation before invoking the desktop route', async () => {
    mocks.tasksCreate.mockImplementationOnce(async (payload, expectedDate, request) => {
      const serialized = localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)
      expect(serialized).not.toBeNull()
      const envelope = JSON.parse(serialized!) as { operations: IdempotentAIStudyTaskCreateRequest[] }
      expect(envelope.operations[0]).toMatchObject({
        operationId: request.operationId,
        operationKind: 'daily_review',
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
    await generateCandidates()
    fireEvent.click(screen.getByTestId('daily-review-create-selected'))

    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))
    expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
  })

  it('restores an uncertain Daily Review operation without automatic writes and reuses its exact request', async () => {
    mocks.tasksCreate
      .mockRejectedValueOnce(new Error('reply lost'))
      .mockResolvedValueOnce({
        ok: true,
        task: makeTask({ id: 404 }),
        replayed: true,
      })

    const firstView = renderDialog()
    await generateCandidates()
    const titleInput = screen.getByDisplayValue('复习函数极限错题')
    fireEvent.click(screen.getByTestId('daily-review-create-selected'))

    expect(await screen.findByText('结果尚无法确认，需要用户手动检查')).toBeInTheDocument()
    expect(titleInput).toBeDisabled()
    const stored = JSON.parse(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)!) as {
      operations: Array<IdempotentAIStudyTaskCreateRequest & { createdAt: string }>
    }
    const pending = stored.operations[0]!
    const firstRequest = mocks.tasksCreate.mock.calls[0]?.[2] as IdempotentAIStudyTaskCreateRequest

    firstView.unmount()
    mocks.onCreated.mockClear()
    renderDialog()
    expect(await screen.findByTestId('pending-study-task-recovery-daily_review')).toBeInTheDocument()
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId(`recover-pending-study-task-${pending.operationId}`))
    expect(await screen.findByText('原操作此前已完成，本次未重复创建')).toBeInTheDocument()
    const retryRequest = mocks.tasksCreate.mock.calls[1]?.[2] as IdempotentAIStudyTaskCreateRequest
    expect(retryRequest).toEqual(firstRequest)
    expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
    expect(mocks.onCreated).toHaveBeenCalledTimes(1)
  })
})
