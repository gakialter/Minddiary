import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EFFECTIVE_DIARY_CONTENT_MIN_CHARS,
  findDiaryTaskSettlementCandidates,
  getEffectiveDiaryContentLength,
  hasEffectiveDiaryContent,
  settleDiaryTask,
} from '../src/utils/diaryTaskSettlement'
import type { DiaryEntry, StudyTask } from '../src/types'

const entry: DiaryEntry = {
  id: 8,
  date: '2026-06-12',
  title: 'Today',
  content: '今天完成了函数极限复盘并整理了三道错题。',
  mood: 'calm',
  word_count: 21,
  created_at: '2026-06-12T00:00:00.000Z',
  updated_at: '2026-06-12T00:00:00.000Z',
}

const makeTask = (overrides: Partial<StudyTask> = {}): StudyTask => ({
  id: 1,
  title: '写今日学习沉淀',
  description: '',
  type: 'diary',
  subject_id: null,
  related_mistake_id: null,
  related_entry_id: null,
  related_chapter_id: null,
  planned_date: '2026-06-12',
  estimate_minutes: 15,
  status: 'todo',
  source: 'dashboard',
  created_at: '2026-06-12T00:00:00.000Z',
  updated_at: '2026-06-12T00:00:00.000Z',
  ...overrides,
})

describe('diaryTaskSettlement', () => {
  const tasksAPI = {
    find: vi.fn(),
    update: vi.fn(),
  }

  beforeEach(() => {
    tasksAPI.find.mockReset()
    tasksAPI.update.mockReset()
    tasksAPI.find.mockResolvedValue([])
    tasksAPI.update.mockImplementation(async (id: number, patch: Partial<StudyTask>) => ({
      ...makeTask({ id }),
      ...patch,
    }))
  })

  it('uses the shared non-whitespace count with an explicit 20 character effective boundary', () => {
    expect(EFFECTIVE_DIARY_CONTENT_MIN_CHARS).toBe(20)
    expect(hasEffectiveDiaryContent({ content: '一二三四五六七八九十一二三四五六七八九' })).toBe(false)
    expect(hasEffectiveDiaryContent({ content: '一二三四五六七八九十一二三四五六七八九十' })).toBe(true)
    expect(hasEffectiveDiaryContent({ content: '一二三四五六七八九十一二三四五六七八九十一' })).toBe(true)
  })

  it('does not count markdown markers and empty template labels as effective diary content', () => {
    expect(getEffectiveDiaryContentLength('#### ********************')).toBe(0)
    expect(hasEffectiveDiaryContent({
      content: '## 本轮专注沉淀\n- 学习内容：\n- 卡点：\n- 下一步：',
    })).toBe(false)
    expect(hasEffectiveDiaryContent({
      content: '## 今日沉淀\n- 学习内容：完成函数极限复盘并整理了三道错题',
    })).toBe(true)
  })

  it('returns no candidates for ineffective diary content without querying tasks', async () => {
    const result = await findDiaryTaskSettlementCandidates({
      entry: { ...entry, content: '太短' },
      tasksAPI,
    })

    expect(result).toEqual({ status: 'none', tasks: [], reason: 'ineffective-content' })
    expect(tasksAPI.find).not.toHaveBeenCalled()
  })

  it('prefers one active task already linked to the entry', async () => {
    const linkedTask = makeTask({ id: 3, related_entry_id: entry.id, planned_date: '2026-06-11' })
    tasksAPI.find
      .mockResolvedValueOnce([linkedTask])
      .mockResolvedValueOnce([makeTask({ id: 4 })])

    const result = await findDiaryTaskSettlementCandidates({ entry, tasksAPI })

    expect(result).toEqual({ status: 'ready', match: 'exact', tasks: [linkedTask] })
    expect(tasksAPI.find).toHaveBeenCalledTimes(1)
    expect(tasksAPI.find).toHaveBeenCalledWith({
      type: 'diary',
      related_entry_id: entry.id,
      status: ['todo', 'doing'],
    })
  })

  it('falls back to same-day unlinked diary tasks without title matching', async () => {
    const unlinkedTask = makeTask({ id: 5, title: 'Any title' })
    tasksAPI.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([unlinkedTask])

    const result = await findDiaryTaskSettlementCandidates({ entry, tasksAPI })

    expect(result).toEqual({ status: 'ready', match: 'same-day-unlinked', tasks: [unlinkedTask] })
    expect(tasksAPI.find).toHaveBeenNthCalledWith(2, {
      type: 'diary',
      planned_date: entry.date,
      related_entry_id: null,
      status: ['todo', 'doing'],
    })
  })

  it('reports a conflict for multiple same-day unlinked diary tasks', async () => {
    tasksAPI.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeTask({ id: 5 }), makeTask({ id: 6, title: 'Second diary task' })])

    const result = await findDiaryTaskSettlementCandidates({ entry, tasksAPI })

    expect(result.status).toBe('conflict')
    expect(result.tasks.map(task => task.id)).toEqual([5, 6])
  })

  it('links the selected task to the saved entry and marks it done only after confirmation', async () => {
    tasksAPI.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeTask({ id: 5 })])

    const result = await settleDiaryTask({ entry, tasksAPI })

    expect(tasksAPI.update).toHaveBeenCalledWith(5, {
      related_entry_id: entry.id,
      status: 'done',
    })
    expect(result).toEqual(expect.objectContaining({
      taskSettlementStatus: 'completed',
      completedTask: expect.objectContaining({ id: 5, related_entry_id: entry.id, status: 'done' }),
    }))
  })

  it('does not choose among multiple active candidates until a task id is supplied', async () => {
    tasksAPI.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeTask({ id: 5 }), makeTask({ id: 6 })])

    const result = await settleDiaryTask({ entry, tasksAPI })

    expect(result.taskSettlementStatus).toBe('conflict')
    expect(tasksAPI.update).not.toHaveBeenCalled()
  })

  it('keeps the diary save successful when task settlement fails and supports task-only retry', async () => {
    tasksAPI.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeTask({ id: 5 })])
    tasksAPI.update.mockRejectedValueOnce(new Error('task update failed'))

    await expect(settleDiaryTask({ entry, tasksAPI })).resolves.toEqual(expect.objectContaining({
      taskSettlementStatus: 'failed',
      settlementError: 'task update failed',
    }))

    tasksAPI.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeTask({ id: 5 })])
    tasksAPI.update.mockResolvedValueOnce(makeTask({ id: 5, related_entry_id: entry.id, status: 'done' }))

    await expect(settleDiaryTask({ entry, tasksAPI })).resolves.toEqual(expect.objectContaining({
      taskSettlementStatus: 'completed',
      completedTask: expect.objectContaining({ id: 5, status: 'done' }),
    }))
    expect(tasksAPI.update).toHaveBeenCalledTimes(2)
  })
})
