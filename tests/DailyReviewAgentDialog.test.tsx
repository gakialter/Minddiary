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

  const dialogProps = (date = REVIEW_DATE, onCreated: () => void | Promise<void> = mocks.onCreated) => ({
    date,
    aiAPI: { chat: mocks.aiChat },
    tasksAPI: {
      getByDate: mocks.tasksGetByDate,
      createIdempotentAIStudyTaskForCurrentDate: async (
        request: IdempotentAIStudyTaskCreateRequest,
      ): Promise<IdempotentAIStudyTaskCreateResponse> => {
        const result = await mocks.tasksCreate(request.payload, request.expectedCurrentDate, request)
        if (result && typeof result === 'object' && 'ok' in result) {
          return { ...result, operationId: request.operationId } as IdempotentAIStudyTaskCreateResponse
        }
        return { ok: true, operationId: request.operationId, task: result, replayed: false }
      },
    },
    mistakesAPI: { getAll: mocks.mistakesGetAll, getDueCount: mocks.mistakesGetDueCount },
    subjectsAPI: { getAll: mocks.subjectsGetAll },
    entriesAPI: { getByDate: mocks.entriesGetByDate },
    pomodoroAPI: { getStats: mocks.pomodoroGetStats, getDailyTotal: mocks.pomodoroGetDailyTotal },
    onClose: mocks.onClose,
    onCreated,
  })

  const renderDialog = (date = REVIEW_DATE, onCreated: () => void | Promise<void> = mocks.onCreated) => render(
    <DailyReviewAgentDialog {...dialogProps(date, onCreated)} />,
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

    await generateCandidates()

    expect(mocks.aiChat).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('daily-review-observations')).toHaveTextContent('AI 复盘建议')
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

    fireEvent.change(screen.getByLabelText('候选任务标题'), { target: { value: '编辑后的任务' } })
    fireEvent.change(screen.getByLabelText('候选预计分钟数'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('候选关联科目'), { target: { value: '2' } })
    expect(screen.getByLabelText('候选任务标题')).toHaveValue('编辑后的任务')
    expect(screen.getByLabelText('候选预计分钟数')).toHaveValue(30)
    expect(screen.getByLabelText('候选关联科目')).toHaveValue('2')

    fireEvent.click(screen.getByLabelText('选择候选任务：编辑后的任务'))
    expect(screen.getByTestId('daily-review-create-selected')).toBeDisabled()

    fireEvent.click(screen.getByLabelText('删除候选任务：编辑后的任务'))
    expect(screen.queryByDisplayValue('编辑后的任务')).not.toBeInTheDocument()
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
    expect(await screen.findByText('review candidate subject must match the related mistake subject')).toBeInTheDocument()
    expect(screen.getByTestId('daily-review-create-selected')).toBeDisabled()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('does not permit an invalid candidate to be created', async () => {
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify({
        observations: [],
        candidates: [{ title: '太短', type: 'focus', estimate_minutes: 3, reason: '预计时长不合法。', priority: 'low', subject_ref: null, related_mistake_ref: null, related_entry_ref: null }],
      }),
    })
    renderDialog()
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))

    expect(await screen.findByText('estimate_minutes must be between 5 and 180')).toBeInTheDocument()
    expect(screen.getByTestId('daily-review-create-selected')).toBeDisabled()
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
    expect(screen.getByTestId('daily-review-creation-summary')).toHaveTextContent('本次已创建 1 项，失败 0 项')
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
    expect(screen.getByTestId('daily-review-creation-summary')).toHaveTextContent('本次已创建 1 项，失败 0 项')
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
    expect(await screen.findByTestId('daily-review-creation-summary')).toHaveTextContent('本次已创建 1 项，失败 1 项')
    await waitFor(() => expect(screen.getByTestId('daily-review-parent-refresh-version')).toHaveTextContent('1'))
    expect(screen.getByText('已创建 #201')).toBeInTheDocument()
    expect(screen.getByText('second write failed')).toBeInTheDocument()
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

    expect(await screen.findByText(/任务创建结果不确定/)).toBeInTheDocument()
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
    expect(await screen.findByText('已重放原操作，并恢复此前创建的同一任务。')).toBeInTheDocument()
    const retryRequest = mocks.tasksCreate.mock.calls[1]?.[2] as IdempotentAIStudyTaskCreateRequest
    expect(retryRequest).toEqual(firstRequest)
    expect(localStorage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
    expect(mocks.onCreated).toHaveBeenCalledTimes(1)
  })
})
