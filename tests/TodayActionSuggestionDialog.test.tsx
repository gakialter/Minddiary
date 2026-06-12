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

const task: StudyTask = {
  id: 99,
  title: '复习函数极限错题',
  description: '',
  type: 'review',
  subject_id: 1,
  related_mistake_id: 12,
  related_entry_id: null,
  planned_date: '2026-06-12',
  estimate_minutes: 10,
  status: 'todo',
  source: 'ai',
  created_at: '2026-06-12T00:00:00.000Z',
  updated_at: '2026-06-12T00:00:00.000Z',
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
    mocks.tasksCreate.mockResolvedValue(task)
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

  it('shows unsupported AI errors without creating tasks', async () => {
    mocks.aiChat.mockResolvedValue({
      unsupported: true,
      error: '浏览器端目前不支持直接调用 AI 接口，请使用 Electron 客户端体验完整功能。',
    })

    renderDialog()
    fireEvent.click(screen.getByTestId('ai-plan-generate'))

    expect(await screen.findByText(/浏览器端目前不支持/)).toBeInTheDocument()
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
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
})
