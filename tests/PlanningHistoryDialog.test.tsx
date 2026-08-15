import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PlanningHistoryDialog from '../src/components/PlanningHistoryDialog'
import type { ElectronPlanningRunsAPI, PlanningRunRecord } from '../src/types/planningHistory'

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000'

function makeRun(): PlanningRunRecord {
  return {
    id: RUN_ID,
    entryPoint: 'today_action',
    planningDate: '2026-05-31',
    targetDate: '2026-05-31',
    generationResultKind: 'candidate_set',
    contextSummary: [
      {
        category: 'available_minutes',
        preparation: 'prepared',
        disposition: 'included',
        reasonCode: 'included_required',
      },
      {
        category: 'focus_history',
        preparation: 'not_integrated',
        disposition: 'excluded',
        reasonCode: 'not_integrated',
      },
    ],
    createdAt: '2026-05-31T08:30:00.000Z',
    updatedAt: '2026-05-31T08:35:00.000Z',
    closedAt: '2026-05-31T08:35:00.000Z',
    closeReason: 'dialog_closed',
    candidates: [
      {
        id: 17,
        ordinal: 0,
        admissionOrigin: 'provider_validated',
        title: '复习第三章',
        description: '今天到期，优先处理',
        type: 'review',
        estimateMinutes: 30,
        priority: 'high',
        subjectId: 3,
        relatedMistakeId: 9,
        relatedEntryId: null,
        editBefore: { title: '复习第二章', estimateMinutes: 25, subjectId: 2 },
        userDisposition: 'confirmed',
        outcomeKind: 'created',
        outcomeObservedAt: '2026-05-31T08:34:00.000Z',
        admittedAt: '2026-05-31T08:30:00.000Z',
        updatedAt: '2026-05-31T08:34:00.000Z',
        sourceRelations: {
          subject: { available: true, id: 3, label: '数学' },
          mistake: { available: false, id: 9 },
          entry: null,
        },
        editBeforeSourceRelations: {
          subject: { available: true, id: 2, label: '物理' },
          mistake: null,
          entry: null,
        },
        taskRelation: { available: true, title: '复习第三章', status: 'todo' },
      },
      {
        id: 18,
        ordinal: 2,
        admissionOrigin: 'provider_suggested_user_repaired',
        title: '整理笔记',
        description: '补齐今日总结',
        type: 'custom',
        estimateMinutes: 15,
        priority: 'low',
        subjectId: null,
        relatedMistakeId: null,
        relatedEntryId: null,
        editBefore: {},
        userDisposition: 'unselected',
        outcomeKind: null,
        outcomeObservedAt: null,
        admittedAt: '2026-05-31T08:31:00.000Z',
        updatedAt: '2026-05-31T08:31:00.000Z',
        sourceRelations: { subject: null, mistake: null, entry: null },
        editBeforeSourceRelations: { subject: null, mistake: null, entry: null },
        taskRelation: null,
      },
    ],
  }
}

function makeAPI(run = makeRun()): ElectronPlanningRunsAPI {
  return {
    create: vi.fn(),
    transition: vi.fn(),
    listRecent: vi.fn().mockResolvedValue({ items: [run], nextCursor: null }),
    get: vi.fn().mockResolvedValue(run),
    delete: vi.fn().mockResolvedValue({ deleted: true, deletedCount: 1 }),
  }
}

describe('PlanningHistoryDialog', () => {
  it('states clearly that persistent history is unavailable without the desktop API', () => {
    render(<PlanningHistoryDialog planningRunsAPI={undefined} onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: '最近 AI 规划' })).toHaveTextContent(
      '当前环境不支持持久化 AI 规划记录',
    )
  })

  it('shows human-readable history detail without exposing internal identifiers or raw JSON', async () => {
    const api = makeAPI()
    render(<PlanningHistoryDialog planningRunsAPI={api} onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /今日行动.*2026-05-31/ }))
    const detail = await screen.findByTestId('planning-history-detail')

    expect(detail).toHaveTextContent('规划日期：2026-05-31')
    expect(detail).toHaveTextContent('目标日期：2026-05-31')
    expect(detail).toHaveTextContent('今日可用时间')
    expect(detail).toHaveTextContent('已加入本次请求')
    expect(detail).toHaveTextContent('专注历史')
    expect(detail).toHaveTextContent('未加入本次请求')
    expect(detail).toHaveTextContent('复习第三章')
    expect(detail).toHaveTextContent('今天到期，优先处理')
    expect(detail).toHaveTextContent('复习 · 30 分钟 · 高优先级')
    expect(detail).toHaveTextContent('标题：复习第二章 → 复习第三章')
    expect(detail).toHaveTextContent('预计时间：25 分钟 → 30 分钟')
    expect(detail).toHaveTextContent('科目：物理 → 数学')
    expect(detail).not.toHaveTextContent('#2')
    expect(detail).toHaveTextContent('科目：数学')
    expect(detail).toHaveTextContent('当前关联内容不可用')
    expect(detail).toHaveTextContent('已创建任务')
    expect(detail).toHaveTextContent('当前任务：复习第三章（todo）')
    expect(detail).toHaveTextContent('本次未选择')
    expect(detail).toHaveTextContent('已观察结束：已关闭规划窗口')
    expect(detail).not.toHaveTextContent(RUN_ID)
    expect(detail).not.toHaveTextContent('operation')
    expect(detail).not.toHaveTextContent('planning-history.v1')
    expect(detail).not.toHaveTextContent('{"')
  })

  it('deletes one run and clears all history through the bounded desktop API', async () => {
    const api = makeAPI()
    const first = render(<PlanningHistoryDialog planningRunsAPI={api} onClose={vi.fn()} />)

    const row = await screen.findByTestId('planning-history-row')
    fireEvent.click(within(row).getByRole('button', { name: '删除这次规划' }))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith({ runId: RUN_ID }))
    expect(screen.getByText('还没有持久化的 AI 规划记录。')).toBeInTheDocument()
    first.unmount()

    // Reload the surface to exercise the independent clear-all command.
    const secondAPI = makeAPI()
    const { unmount } = render(<PlanningHistoryDialog planningRunsAPI={secondAPI} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '清空全部规划历史' }))
    await waitFor(() => expect(secondAPI.delete).toHaveBeenCalledWith({ runId: null }))
    unmount()
  })

  it('ignores stale detail responses when the user selects a newer run', async () => {
    const runA = makeRun()
    const runB: PlanningRunRecord = {
      ...makeRun(),
      id: '223e4567-e89b-42d3-a456-426614174000',
      planningDate: '2026-06-01',
      targetDate: '2026-06-01',
      candidates: [{ ...makeRun().candidates[1]!, title: '较新的规划详情' }],
    }
    let resolveA!: (run: PlanningRunRecord) => void
    let resolveB!: (run: PlanningRunRecord) => void
    const api = makeAPI()
    api.listRecent = vi.fn().mockResolvedValue({ items: [runB, runA], nextCursor: null })
    api.get = vi.fn((id: string) => new Promise<PlanningRunRecord>(resolve => {
      if (id === runA.id) resolveA = resolve
      else resolveB = resolve
    }))
    render(<PlanningHistoryDialog planningRunsAPI={api} onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /今日行动.*2026-05-31/ }))
    fireEvent.click(screen.getByRole('button', { name: /今日行动.*2026-06-01/ }))
    resolveB(runB)
    await expect(screen.findByTestId('planning-history-detail')).resolves.toHaveTextContent('较新的规划详情')
    resolveA(runA)
    await waitFor(() => expect(screen.getByTestId('planning-history-detail')).toHaveTextContent('较新的规划详情'))
    expect(screen.getByTestId('planning-history-detail')).not.toHaveTextContent('复习第三章')
  })
})
