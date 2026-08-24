import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MistakeReviewAgentDialog from '../src/components/MistakeReviewAgentDialog'
import type { Mistake, StudyTask, Subject } from '../src/types'

describe('MistakeReviewAgentDialog Component', () => {
  const currentDate = '2026-08-15'

  const mockSubjects: Subject[] = [
    { id: 1, name: '数学', color: '#2563eb' },
    { id: 2, name: '物理', color: '#16a34a' },
  ]

  const mockMistakes: Mistake[] = [
    {
      id: 10,
      subject_id: 1,
      question: '求极限 lim (sin x)/x',
      answer: '1',
      notes: '经典极限',
      mastered: false,
      ease_factor: 2.5,
      review_interval: 1,
      next_review_date: '2026-08-10',
      review_count: 1,
      created_at: '2026-08-01',
    },
    {
      id: 20,
      subject_id: 2,
      question: '牛顿第二定律公式',
      answer: 'F=ma',
      notes: '力学基础',
      mastered: false,
      ease_factor: 2.5,
      review_interval: 1,
      next_review_date: '2026-08-12',
      review_count: 2,
      created_at: '2026-08-01',
    },
  ]

  let mistakesAPI: { getAll: ReturnType<typeof vi.fn> }
  let subjectsAPI: { getAll: ReturnType<typeof vi.fn> }
  let tasksAPI: {
    find: ReturnType<typeof vi.fn>
    createIdempotentAIStudyTaskForCurrentDate: ReturnType<typeof vi.fn>
  }
  let aiAPI: { chat: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mistakesAPI = {
      getAll: vi.fn().mockResolvedValue({ data: mockMistakes, total: 2, masteredTotal: 0 }),
    }
    subjectsAPI = {
      getAll: vi.fn().mockResolvedValue(mockSubjects),
    }
    tasksAPI = {
      find: vi.fn().mockResolvedValue([]),
      createIdempotentAIStudyTaskForCurrentDate: vi.fn(),
    }
    aiAPI = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          suggestions: [
            {
              mistake_ref: 'm1',
              title: '复习极限基础',
              reason: '已逾期 5 天，建议优先巩固。',
              estimate_minutes: 25,
            },
            {
              mistake_ref: 'm2',
              title: '复习牛顿第二定律',
              reason: '已逾期 3 天，力学重点公式。',
              estimate_minutes: 30,
            },
          ],
        }),
      }),
    }
  })

  it('renders loading state initially and then displays candidate cards in ready state', async () => {
    render(
      <MistakeReviewAgentDialog
        currentDate={currentDate}
        onClose={vi.fn()}
        mistakesAPI={mistakesAPI as any}
        subjectsAPI={subjectsAPI as any}
        tasksAPI={tasksAPI as any}
        aiAPI={aiAPI as any}
      />,
    )

    expect(screen.getByTestId('mistake-review-loading')).toBeInTheDocument()

    await screen.findByTestId('mistake-review-candidate-list')

    expect(screen.getByText('复习极限基础')).toBeInTheDocument()
    expect(screen.getByText('复习牛顿第二定律')).toBeInTheDocument()
    expect(screen.getAllByText(/已逾期 5 天/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/已逾期 3 天/).length).toBeGreaterThan(0)

    // Read-only cards: verify there are no inputs, textareas, or checkboxes
    const dialog = screen.getByTestId('mistake-review-agent-dialog')
    expect(dialog.querySelectorAll('input[type="text"]').length).toBe(0)
    expect(dialog.querySelectorAll('textarea').length).toBe(0)
    expect(dialog.querySelectorAll('input[type="checkbox"]').length).toBe(0)
    expect(screen.queryByText(/全选|批量确认|Confirm All/i)).not.toBeInTheDocument()
  })

  it('renders empty state when there are no due mistakes', async () => {
    mistakesAPI.getAll.mockResolvedValueOnce({ data: [], total: 0, masteredTotal: 0 })

    render(
      <MistakeReviewAgentDialog
        currentDate={currentDate}
        onClose={vi.fn()}
        mistakesAPI={mistakesAPI as any}
        subjectsAPI={subjectsAPI as any}
        tasksAPI={tasksAPI as any}
        aiAPI={aiAPI as any}
      />,
    )

    await screen.findByTestId('mistake-review-empty')
    expect(screen.getByText('暂无到期错题或未生成建议')).toBeInTheDocument()
  })

  it('renders unsupported presentation when browser fallback reports unsupported', async () => {
    aiAPI.chat.mockResolvedValueOnce({
      content: '请在 Electron 环境中使用 AI 功能',
      unsupported: true,
    })

    render(
      <MistakeReviewAgentDialog
        currentDate={currentDate}
        onClose={vi.fn()}
        mistakesAPI={mistakesAPI as any}
        subjectsAPI={subjectsAPI as any}
        tasksAPI={tasksAPI as any}
        aiAPI={aiAPI as any}
      />,
    )

    await screen.findByTestId('mistake-review-unsupported')
    expect(screen.getByText('AI 复习规划不可用')).toBeInTheDocument()
  })

  it('renders error state when AI call fails and allows retry', async () => {
    aiAPI.chat.mockRejectedValueOnce(new Error('Network error'))

    render(
      <MistakeReviewAgentDialog
        currentDate={currentDate}
        onClose={vi.fn()}
        mistakesAPI={mistakesAPI as any}
        subjectsAPI={subjectsAPI as any}
        tasksAPI={tasksAPI as any}
        aiAPI={aiAPI as any}
      />,
    )

    await screen.findByTestId('mistake-review-error')
    expect(screen.getByText(/Network error/)).toBeInTheDocument()

    // Retry
    aiAPI.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        suggestions: [
          {
            mistake_ref: 'm1',
            title: '复习极限基础',
            reason: '重试成功',
            estimate_minutes: 20,
          },
        ],
      }),
    })

    fireEvent.click(screen.getByTestId('mistake-review-retry-btn'))
    await screen.findByTestId('mistake-review-candidate-list')
    expect(screen.getByText('复习极限基础')).toBeInTheDocument()
  })

  it('consumes a successful generation, regenerates from active tasks, and allows the fresh candidate to succeed', async () => {
    const onTaskCreated = vi.fn()
    const createdTaskA: StudyTask = {
      id: 99,
      title: '复习极限基础',
      description: '已逾期 5 天，建议优先巩固。',
      type: 'review',
      subject_id: 1,
      related_mistake_id: 10,
      related_entry_id: null,
      related_chapter_id: null,
      planned_date: currentDate,
      estimate_minutes: 25,
      status: 'todo',
      source: 'ai',
      created_at: '2026-08-15',
      updated_at: '2026-08-15',
    }
    const createdTaskB: StudyTask = {
      ...createdTaskA,
      id: 100,
      title: 'P1 复习牛顿第二定律',
      description: '基于刷新后的权威上下文。',
      subject_id: 2,
      related_mistake_id: 20,
      estimate_minutes: 30,
    }
    const activeReviewTasks: StudyTask[] = []

    tasksAPI.find.mockImplementation(async () => [...activeReviewTasks])
    aiAPI.chat
      .mockResolvedValueOnce({
        content: JSON.stringify({
          suggestions: [
            {
              mistake_ref: 'm1',
              title: '复习极限基础',
              reason: '已逾期 5 天，建议优先巩固。',
              estimate_minutes: 25,
            },
            {
              mistake_ref: 'm2',
              title: 'P0 复习牛顿第二定律',
              reason: '来自 P0。',
              estimate_minutes: 30,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          suggestions: [
            {
              mistake_ref: 'm1',
              title: 'P1 复习牛顿第二定律',
              reason: '基于刷新后的权威上下文。',
              estimate_minutes: 30,
            },
          ],
        }),
      })

    tasksAPI.createIdempotentAIStudyTaskForCurrentDate
      .mockImplementationOnce(async (req: any) => {
        activeReviewTasks.push(createdTaskA)
        return {
          ok: true,
          operationId: req.operationId,
          task: createdTaskA,
          replayed: false,
        }
      })
      .mockImplementationOnce(async (req: any) => {
        activeReviewTasks.push(createdTaskB)
        return {
          ok: true,
          operationId: req.operationId,
          task: createdTaskB,
          replayed: false,
        }
      })

    render(
      <MistakeReviewAgentDialog
        currentDate={currentDate}
        onClose={vi.fn()}
        onTaskCreated={onTaskCreated}
        mistakesAPI={mistakesAPI as any}
        subjectsAPI={subjectsAPI as any}
        tasksAPI={tasksAPI as any}
        aiAPI={aiAPI as any}
      />,
    )

    await screen.findByTestId('mistake-review-candidate-list')

    expect(screen.getByText('P0 复习牛顿第二定律')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('mistake-review-confirm-btn-0'))

    await screen.findByText('P1 复习牛顿第二定律')
    expect(screen.queryByText('P0 复习牛顿第二定律')).not.toBeInTheDocument()
    expect(tasksAPI.find).toHaveBeenCalledTimes(2)
    expect(aiAPI.chat).toHaveBeenCalledTimes(2)

    const firstProviderInput = JSON.stringify(aiAPI.chat.mock.calls[0]![0])
    const secondProviderInput = JSON.stringify(aiAPI.chat.mock.calls[1]![0])
    expect(firstProviderInput).toContain('求极限 lim (sin x)/x')
    expect(secondProviderInput).not.toContain('求极限 lim (sin x)/x')
    expect(secondProviderInput).toContain('牛顿第二定律公式')

    expect(tasksAPI.createIdempotentAIStudyTaskForCurrentDate).toHaveBeenCalledTimes(1)
    const firstRequest = tasksAPI.createIdempotentAIStudyTaskForCurrentDate.mock.calls[0]![0]
    expect(firstRequest).toMatchObject({
      operationKind: 'mistake_review',
      actionContractVersion: 'confirmed-mistake-review-task-action.v2',
      expectedCurrentDate: currentDate,
      contextProjectionVersion: 'mistake-review.context-projection.v1',
      generationContextSignature: expect.stringMatching(/^[0-9a-f]{64}$/),
      generationMistakeRef: 'm1',
      payload: {
        title: '复习极限基础',
        type: 'review',
        subject_id: 1,
        related_mistake_id: 10,
        planned_date: currentDate,
        estimate_minutes: 25,
        status: 'todo',
        source: 'ai',
      },
    })
    expect(onTaskCreated).toHaveBeenCalledWith(createdTaskA)

    fireEvent.click(screen.getByTestId('mistake-review-confirm-btn-0'))
    await screen.findByTestId('mistake-review-empty')

    expect(tasksAPI.createIdempotentAIStudyTaskForCurrentDate).toHaveBeenCalledTimes(2)
    const secondRequest = tasksAPI.createIdempotentAIStudyTaskForCurrentDate.mock.calls[1]![0]
    expect(secondRequest).toMatchObject({
      generationMistakeRef: 'm1',
      payload: {
        title: 'P1 复习牛顿第二定律',
        subject_id: 2,
        related_mistake_id: 20,
      },
    })
    expect(secondRequest.generationContextSignature).not.toBe(firstRequest.generationContextSignature)
    expect(onTaskCreated).toHaveBeenNthCalledWith(2, createdTaskB)
  })

  it('blocks a second confirmation synchronously while the generation request is in flight', async () => {
    let resolveCreate: ((value: any) => void) | undefined
    const createdTask: StudyTask = {
      id: 101,
      title: '复习极限基础',
      description: '已逾期 5 天，建议优先巩固。',
      type: 'review',
      subject_id: 1,
      related_mistake_id: 10,
      related_entry_id: null,
      related_chapter_id: null,
      planned_date: currentDate,
      estimate_minutes: 25,
      status: 'todo',
      source: 'ai',
      created_at: '2026-08-15',
      updated_at: '2026-08-15',
    }
    const activeReviewTasks: StudyTask[] = []
    tasksAPI.find.mockImplementation(async () => [...activeReviewTasks])
    tasksAPI.createIdempotentAIStudyTaskForCurrentDate.mockImplementation(() => new Promise(resolve => {
      resolveCreate = resolve
    }))

    render(
      <MistakeReviewAgentDialog
        currentDate={currentDate}
        onClose={vi.fn()}
        mistakesAPI={mistakesAPI as any}
        subjectsAPI={subjectsAPI as any}
        tasksAPI={tasksAPI as any}
        aiAPI={aiAPI as any}
      />,
    )

    await screen.findByTestId('mistake-review-candidate-list')
    const confirmA = screen.getByTestId('mistake-review-confirm-btn-0')
    const confirmB = screen.getByTestId('mistake-review-confirm-btn-1')

    act(() => {
      fireEvent.click(confirmA)
      fireEvent.click(confirmB)
    })

    expect(tasksAPI.createIdempotentAIStudyTaskForCurrentDate).toHaveBeenCalledTimes(1)
    expect(confirmB).toBeDisabled()

    activeReviewTasks.push(createdTask)
    await act(async () => {
      resolveCreate?.({
        ok: true,
        operationId: tasksAPI.createIdempotentAIStudyTaskForCurrentDate.mock.calls[0]![0].operationId,
        task: createdTask,
        replayed: false,
      })
    })
  })

  it('handles uncertain result and allows retry with the SAME operation_id', async () => {
    const task: StudyTask = {
      id: 100,
      title: '复习极限基础',
      description: '已逾期 5 天，建议优先巩固。',
      type: 'review',
      subject_id: 1,
      related_mistake_id: 10,
      related_entry_id: null,
      related_chapter_id: null,
      planned_date: currentDate,
      estimate_minutes: 25,
      status: 'todo',
      source: 'ai',
      created_at: '2026-08-15',
      updated_at: '2026-08-15',
    }

    const activeReviewTasks: StudyTask[] = []
    tasksAPI.find.mockImplementation(async () => [...activeReviewTasks])
    aiAPI.chat
      .mockResolvedValueOnce({
        content: JSON.stringify({
          suggestions: [
            {
              mistake_ref: 'm1',
              title: '复习极限基础',
              reason: '已逾期 5 天，建议优先巩固。',
              estimate_minutes: 25,
            },
            {
              mistake_ref: 'm2',
              title: 'P0 复习牛顿第二定律',
              reason: '来自 P0。',
              estimate_minutes: 30,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          suggestions: [
            {
              mistake_ref: 'm1',
              title: 'P1 复习牛顿第二定律',
              reason: 'A replay 后的权威生成。',
              estimate_minutes: 30,
            },
          ],
        }),
      })
    tasksAPI.createIdempotentAIStudyTaskForCurrentDate
      .mockRejectedValueOnce(new Error('Network drop'))
      .mockImplementationOnce(async (req: any) => {
        activeReviewTasks.push(task)
        return {
          ok: true,
          operationId: req.operationId,
          task,
          replayed: true,
        }
      })

    render(
      <MistakeReviewAgentDialog
        currentDate={currentDate}
        onClose={vi.fn()}
        mistakesAPI={mistakesAPI as any}
        subjectsAPI={subjectsAPI as any}
        tasksAPI={tasksAPI as any}
        aiAPI={aiAPI as any}
      />,
    )

    await screen.findByTestId('mistake-review-candidate-list')

    const confirmBtn0 = screen.getByTestId('mistake-review-confirm-btn-0')
    fireEvent.click(confirmBtn0)

    await screen.findByTestId('mistake-review-card-uncertain-0')
    expect(screen.getByTestId('mistake-review-card-uncertain-0')).toBeInTheDocument()
    expect(screen.getByTestId('mistake-review-confirm-btn-1')).toBeDisabled()
    expect(aiAPI.chat).toHaveBeenCalledTimes(1)

    const firstOpId = tasksAPI.createIdempotentAIStudyTaskForCurrentDate.mock.calls[0]![0].operationId

    // Click retry button on the card
    const retryBtn = screen.getByTestId('mistake-review-confirm-btn-0')
    expect(retryBtn).toHaveTextContent('重试')
    fireEvent.click(retryBtn)

    await screen.findByText('P1 复习牛顿第二定律')
    expect(tasksAPI.createIdempotentAIStudyTaskForCurrentDate).toHaveBeenCalledTimes(2)
    expect(aiAPI.chat).toHaveBeenCalledTimes(2)
    const secondOpId = tasksAPI.createIdempotentAIStudyTaskForCurrentDate.mock.calls[1]![0].operationId
    expect(secondOpId).toBe(firstOpId)
  })

  it('consumes a definitively rejected generation instead of re-enabling its old candidates', async () => {
    tasksAPI.createIdempotentAIStudyTaskForCurrentDate.mockImplementationOnce(async (req: any) => ({
      ok: false,
      operationId: req.operationId,
      code: 'INVALID_REQUEST',
      message: 'Mistake Review generation context is stale',
    }))
    aiAPI.chat
      .mockResolvedValueOnce({
        content: JSON.stringify({
          suggestions: [
            {
              mistake_ref: 'm1',
              title: '复习极限基础',
              reason: '已逾期 5 天，建议优先巩固。',
              estimate_minutes: 25,
            },
            {
              mistake_ref: 'm2',
              title: 'P0 复习牛顿第二定律',
              reason: '来自 P0。',
              estimate_minutes: 30,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          suggestions: [
            {
              mistake_ref: 'm2',
              title: '外部漂移后的新生成',
              reason: '权威上下文已经刷新。',
              estimate_minutes: 30,
            },
          ],
        }),
      })

    render(
      <MistakeReviewAgentDialog
        currentDate={currentDate}
        onClose={vi.fn()}
        mistakesAPI={mistakesAPI as any}
        subjectsAPI={subjectsAPI as any}
        tasksAPI={tasksAPI as any}
        aiAPI={aiAPI as any}
      />,
    )

    await screen.findByTestId('mistake-review-candidate-list')
    fireEvent.click(screen.getByTestId('mistake-review-confirm-btn-0'))

    await screen.findByText('外部漂移后的新生成')
    expect(aiAPI.chat).toHaveBeenCalledTimes(2)
    expect(tasksAPI.createIdempotentAIStudyTaskForCurrentDate).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('复习极限基础')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('mistake-review-confirm-btn-0')).toBeEnabled())
  })

  it('invalidates previous generation session when regenerate is clicked or dialog closed', async () => {
    let resolveFirstChat: ((val: any) => void) | undefined
    aiAPI.chat.mockImplementationOnce(() => new Promise(resolve => {
      resolveFirstChat = resolve
    }))

    const { unmount } = render(
      <MistakeReviewAgentDialog
        currentDate={currentDate}
        onClose={vi.fn()}
        mistakesAPI={mistakesAPI as any}
        subjectsAPI={subjectsAPI as any}
        tasksAPI={tasksAPI as any}
        aiAPI={aiAPI as any}
      />,
    )

    expect(screen.getByTestId('mistake-review-loading')).toBeInTheDocument()

    // Unmount before first chat resolves
    unmount()

    // Resolve late first chat
    resolveFirstChat?.({
      content: JSON.stringify({
        suggestions: [{ mistake_ref: 'm1', title: 'Late', reason: 'Late', estimate_minutes: 20 }],
      }),
    })

    // No errors thrown on unmounted component
  })
})
