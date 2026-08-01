// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { buildAIContextSections, type AIContextBuildDeps } from '../src/utils/aiContextBuilder'
import type { SubjectChapter } from '../src/types'

const makeDeps = (chapters: SubjectChapter[]): AIContextBuildDeps => ({
  entry: null,
  settingsData: {} as AIContextBuildDeps['settingsData'],
  entries: {
    getAll: vi.fn().mockResolvedValue([]),
    getByDate: vi.fn().mockResolvedValue(null),
    getById: vi.fn().mockResolvedValue(null),
    getDatesWithEntries: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  mistakes: {
    getAll: vi.fn().mockResolvedValue({ data: [], total: 0, masteredTotal: 0 }),
    create: vi.fn(),
    createBatch: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    toggleMastered: vi.fn(),
    review: vi.fn(),
    getDueCount: vi.fn(),
    getRandomDue: vi.fn(),
  },
  subjects: {
    getAll: vi.fn().mockResolvedValue([
      { id: 1, name: 'Math', total_chapters: 6, completed_chapters: 1, color: '#0F766E' },
    ]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  subjectChapters: {
    getBySubject: vi.fn().mockResolvedValue(chapters),
    create: vi.fn(),
    bulkCreate: vi.fn(),
    convertFromSummary: vi.fn(),
    patch: vi.fn(),
    toggleCompleted: vi.fn(),
    reorder: vi.fn(),
    delete: vi.fn(),
    clearDetailedChapters: vi.fn(),
  },
  tasks: {
    getByDate: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    createForCurrentDate: vi.fn(),
    createIdempotentAIStudyTaskForCurrentDate: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    complete: vi.fn(),
    skip: vi.fn(),
    startFocus: vi.fn(),
  },
  pomodoro: {
    getStats: vi.fn().mockResolvedValue([]),
    getStatsRange: vi.fn().mockResolvedValue([]),
    getRange: vi.fn().mockResolvedValue([]),
    addSession: vi.fn(),
    getDailyTotal: vi.fn(),
  },
})

const makeChapter = (overrides: Partial<SubjectChapter>): SubjectChapter => ({
  id: overrides.id ?? 1,
  subject_id: 1,
  title: overrides.title ?? 'Chapter',
  notes: '',
  completed: overrides.completed ?? false,
  sort_order: overrides.sort_order ?? 0,
  created_at: '2026-06-13T00:00:00.000Z',
  updated_at: '2026-06-13T00:00:00.000Z',
})

describe('AI context builder subject chapter summary', () => {
  it('includes bounded chapter progress without dumping the full chapter list', async () => {
    const sections = await buildAIContextSections(['study-overview'], makeDeps([
      makeChapter({ id: 1, title: '第一章 函数', completed: true, sort_order: 0 }),
      makeChapter({ id: 2, title: '第二章 导数', sort_order: 1 }),
      makeChapter({ id: 3, title: '第三章 积分', sort_order: 2 }),
      makeChapter({ id: 4, title: '第四章 多元函数', sort_order: 3 }),
      makeChapter({ id: 5, title: '第五章 常微分方程', sort_order: 4 }),
    ]))

    expect(sections).toHaveLength(1)
    const content = sections[0]!.content
    expect(content).toContain('Math')
    expect(content).toContain('1/5')
    expect(content).toContain('第二章 导数')
    expect(content).toContain('第三章 积分')
    expect(content).toContain('第四章 多元函数')
    expect(content).not.toContain('第五章 常微分方程')
  })
})

describe('AI context builder primary countdown', () => {
  it('uses the custom primary target title instead of assuming an exam', async () => {
    const deps = makeDeps([])
    deps.settingsData = {
      examDate: '2027-01-15',
      countdownEvents: [
        {
          id: 'default-exam',
          title: '论文提交',
          date: '2027-01-15',
          type: 'exam',
        },
      ],
    } as AIContextBuildDeps['settingsData']

    const [section] = await buildAIContextSections(['exam-countdown'], deps)

    expect(section?.label).toBe('主目标倒计时')
    expect(section?.content).toContain('主目标名称：论文提交')
    expect(section?.content).toContain('主目标日期：2027-01-15')
    expect(section?.content).not.toContain('考试日期')
  })
})
