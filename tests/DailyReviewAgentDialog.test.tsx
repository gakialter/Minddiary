import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DailyReviewAgentDialog from '../src/components/DailyReviewAgentDialog'
import type { AIResponse, DiaryEntry, Mistake, PomodoroStat, StudyTask, Subject } from '../src/types'

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

  const renderDialog = (date = REVIEW_DATE) => render(
    <DailyReviewAgentDialog
      date={date}
      aiAPI={{ chat: mocks.aiChat }}
      tasksAPI={{ getByDate: mocks.tasksGetByDate, create: mocks.tasksCreate }}
      mistakesAPI={{ getAll: mocks.mistakesGetAll, getDueCount: mocks.mistakesGetDueCount }}
      subjectsAPI={{ getAll: mocks.subjectsGetAll }}
      entriesAPI={{ getByDate: mocks.entriesGetByDate }}
      pomodoroAPI={{ getStats: mocks.pomodoroGetStats, getDailyTotal: mocks.pomodoroGetDailyTotal }}
      onClose={mocks.onClose}
      onCreated={mocks.onCreated}
    />,
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
    let taskRows: StudyTask[] = []
    mocks.tasksGetByDate.mockImplementation(async () => taskRows)
    renderDialog()
    await generateCandidates()

    taskRows = [makeTask({ id: 101, title: '新出现的次日任务', type: 'focus', subject_id: null, related_mistake_id: null, planned_date: CANDIDATE_DATE, source: 'manual' })]
    fireEvent.click(screen.getByTestId('daily-review-create-selected'))

    expect(await screen.findByTestId('daily-review-stale-context')).toHaveTextContent('请查看结果后再次确认创建')
    expect(mocks.tasksCreate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('daily-review-create-selected'))
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(1))
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
    const createdA = makeTask({ id: 201, title: '任务 A', type: 'focus', subject_id: null, related_mistake_id: null })
    const createdB = makeTask({ id: 202, title: '任务 B', type: 'focus', subject_id: null, related_mistake_id: null })
    let candidateDateRows: StudyTask[] = []
    mocks.tasksGetByDate.mockImplementation(async (requestDate: string) => requestDate === CANDIDATE_DATE ? candidateDateRows : [])
    mocks.aiChat.mockResolvedValue({ content: twoCandidateResponse })
    mocks.tasksCreate.mockImplementationOnce(async () => {
      candidateDateRows = [createdA]
      return createdA
    }).mockRejectedValueOnce(new Error('second write failed')).mockImplementationOnce(async () => {
      candidateDateRows = [createdA, createdB]
      return createdB
    })

    renderDialog()
    await waitForInitialContext()
    fireEvent.click(screen.getByTestId('daily-review-generate'))
    await screen.findByDisplayValue('任务 A')

    fireEvent.click(screen.getByTestId('daily-review-create-selected'))
    expect(await screen.findByTestId('daily-review-creation-summary')).toHaveTextContent('本次已创建 1 项，失败 1 项')
    expect(screen.getByText('second write failed')).toBeInTheDocument()
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByTestId('daily-review-create-selected'))
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledTimes(3))

    const createdTitles = mocks.tasksCreate.mock.calls.map(([input]) => input.title)
    expect(createdTitles.filter(title => title === '任务 A')).toHaveLength(1)
    expect(createdTitles.filter(title => title === '任务 B')).toHaveLength(2)
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
      }))
      expect(mocks.onCreated).toHaveBeenCalledTimes(1)
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
})
