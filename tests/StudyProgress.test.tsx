import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudyProgress from '../src/components/StudyProgress'
import type { Mistake, PomodoroStat, Subject, SubjectChapter } from '../src/types'

const mocks = vi.hoisted(() => ({
  subjectsGetAll: vi.fn(),
  subjectsCreate: vi.fn(),
  subjectsUpdate: vi.fn(),
  subjectsDelete: vi.fn(),
  chaptersGetBySubject: vi.fn(),
  chaptersCreate: vi.fn(),
  chaptersBulkCreate: vi.fn(),
  chaptersConvert: vi.fn(),
  chaptersPatch: vi.fn(),
  chaptersToggle: vi.fn(),
  chaptersReorder: vi.fn(),
  chaptersDelete: vi.fn(),
  chaptersClear: vi.fn(),
  pomodoroGetStats: vi.fn(),
  mistakesGetAll: vi.fn(),
  tasksGetByDate: vi.fn(),
  tasksFind: vi.fn(),
  tasksCreate: vi.fn(),
  requestDataRefresh: vi.fn(),
  showToast: vi.fn(),
}))

let mockDataRefreshVersion = 0

vi.mock('../src/contexts/DiaryContext', () => {
  const diaryApi = {
    subjects: {
      getAll: mocks.subjectsGetAll,
      create: mocks.subjectsCreate,
      update: mocks.subjectsUpdate,
      delete: mocks.subjectsDelete,
    },
    subjectChapters: {
      getBySubject: mocks.chaptersGetBySubject,
      create: mocks.chaptersCreate,
      bulkCreate: mocks.chaptersBulkCreate,
      convertFromSummary: mocks.chaptersConvert,
      patch: mocks.chaptersPatch,
      toggleCompleted: mocks.chaptersToggle,
      reorder: mocks.chaptersReorder,
      delete: mocks.chaptersDelete,
      clearDetailedChapters: mocks.chaptersClear,
    },
    pomodoro: {
      getStats: mocks.pomodoroGetStats,
    },
    mistakes: {
      getAll: mocks.mistakesGetAll,
    },
    tasks: {
      getByDate: mocks.tasksGetByDate,
      find: mocks.tasksFind,
      create: mocks.tasksCreate,
    },
    requestDataRefresh: mocks.requestDataRefresh,
    get dataRefreshVersion() {
      return mockDataRefreshVersion
    },
  }
  return {
    useDiary: () => diaryApi,
  }
})

vi.mock('../src/components/Toast', () => ({
  showToast: mocks.showToast,
}))

vi.mock('../src/contexts/LocalDateContext', () => ({
  useCurrentLocalDateKey: () => '2026-06-21',
}))

const makeSubject = (overrides: Partial<Subject> = {}): Subject => ({
  id: overrides.id ?? 7,
  name: overrides.name ?? 'Math',
  color: overrides.color ?? '#0F766E',
  total_chapters: overrides.total_chapters ?? 5,
  completed_chapters: overrides.completed_chapters ?? 2,
})

const makeChapter = (overrides: Partial<SubjectChapter> = {}): SubjectChapter => ({
  id: overrides.id ?? 1,
  subject_id: overrides.subject_id ?? 7,
  title: overrides.title ?? '第一章 函数',
  notes: overrides.notes ?? '',
  completed: overrides.completed ?? false,
  sort_order: overrides.sort_order ?? 0,
  created_at: overrides.created_at ?? '2026-06-13T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-06-13T00:00:00.000Z',
})

const pomodoroStats: PomodoroStat[] = [{
  subject_name: 'Math',
  color: '#0F766E',
  total_minutes: 50,
  session_count: 2,
}]

const mistakes: Mistake[] = [{
  id: 3,
  subject_id: 7,
  question: '1 + 1',
  answer: '2',
  notes: '',
  mastered: false,
  ease_factor: 2.5,
  review_interval: 1,
  next_review_date: null,
  review_count: 0,
  created_at: '2026-06-07 09:00:00',
}]

function setupStudyProgress(initialSubjects: Subject[], initialChapters: Record<number, SubjectChapter[]> = {}) {
  let subjects = [...initialSubjects]
  let chaptersBySubject: Record<number, SubjectChapter[]> = Object.fromEntries(
    Object.entries(initialChapters).map(([subjectId, chapters]) => [Number(subjectId), [...chapters]]),
  )
  let nextChapterId = 100
  let tasks: Array<Record<string, unknown>> = []

  const syncSubject = (subjectId: number) => {
    const chapters = chaptersBySubject[subjectId] ?? []
    subjects = subjects.map(subject => (
      subject.id === subjectId
        ? {
            ...subject,
            total_chapters: chapters.length || subject.total_chapters,
            completed_chapters: chapters.length
              ? chapters.filter(chapter => chapter.completed).length
              : subject.completed_chapters,
          }
        : subject
    ))
  }

  mocks.subjectsGetAll.mockImplementation(async () => subjects)
  mocks.chaptersGetBySubject.mockImplementation(async (subjectId: number) => chaptersBySubject[subjectId] ?? [])
  mocks.pomodoroGetStats.mockResolvedValue(pomodoroStats)
  mocks.mistakesGetAll.mockResolvedValue({ data: mistakes, total: mistakes.length, masteredTotal: 0 })
  mocks.tasksGetByDate.mockImplementation(async () => tasks)
  mocks.tasksFind.mockImplementation(async (query: { planned_date?: string; related_chapter_id?: number | null }) => (
    tasks.filter(task => (
      (query.planned_date === undefined || task.planned_date === query.planned_date)
      && (query.related_chapter_id === undefined || task.related_chapter_id === query.related_chapter_id)
    ))
  ))
  mocks.tasksCreate.mockImplementation(async (data: Record<string, unknown>) => {
    const created = { id: tasks.length + 1, status: 'todo', ...data }
    tasks = [...tasks, created]
    return created
  })
  mocks.subjectsCreate.mockImplementation(async (data: Partial<Subject>) => {
    const created = makeSubject({
      id: Math.max(0, ...subjects.map(subject => subject.id)) + 1,
      name: data.name,
      total_chapters: data.total_chapters ?? 0,
      completed_chapters: 0,
      color: data.color,
    })
    subjects = [...subjects, created]
    return created
  })
  mocks.subjectsUpdate.mockImplementation(async (id: number, patch: Partial<Subject>) => {
    subjects = subjects.map(subject => subject.id === id ? { ...subject, ...patch } : subject)
    return subjects.find(subject => subject.id === id)
  })
  mocks.subjectsDelete.mockImplementation(async (id: number) => {
    subjects = subjects.filter(subject => subject.id !== id)
    delete chaptersBySubject[id]
    return true
  })
  mocks.chaptersBulkCreate.mockImplementation(async ({ subject_id, chapters }: { subject_id: number; chapters: Array<Partial<SubjectChapter>> }) => {
    const created = chapters.map((chapter, index) => makeChapter({
      id: nextChapterId++,
      subject_id,
      title: String(chapter.title),
      notes: String(chapter.notes ?? ''),
      completed: !!chapter.completed,
      sort_order: (chaptersBySubject[subject_id]?.length ?? 0) + index,
    }))
    chaptersBySubject[subject_id] = [...(chaptersBySubject[subject_id] ?? []), ...created]
    syncSubject(subject_id)
    return created
  })
  mocks.chaptersConvert.mockImplementation(async ({ subject_id, chapters, markCompletedCount }: {
    subject_id: number
    chapters: Array<Partial<SubjectChapter>>
    markCompletedCount: number
  }) => {
    const converted = chapters.map((chapter, index) => makeChapter({
      id: nextChapterId++,
      subject_id,
      title: String(chapter.title),
      completed: index < markCompletedCount,
      sort_order: index,
    }))
    chaptersBySubject[subject_id] = converted
    syncSubject(subject_id)
    return converted
  })
  mocks.chaptersPatch.mockImplementation(async (id: number, patch: Partial<SubjectChapter>) => {
    let updated: SubjectChapter | undefined
    chaptersBySubject = Object.fromEntries(Object.entries(chaptersBySubject).map(([subjectId, chapters]) => [
      subjectId,
      chapters.map(chapter => {
        if (chapter.id !== id) return chapter
        updated = { ...chapter, ...patch }
        return updated
      }),
    ]))
    if (!updated) throw new Error('Chapter not found')
    syncSubject(updated.subject_id)
    return updated
  })
  mocks.chaptersToggle.mockImplementation(async (id: number, completed?: boolean) => {
    let updated: SubjectChapter | undefined
    chaptersBySubject = Object.fromEntries(Object.entries(chaptersBySubject).map(([subjectId, chapters]) => [
      subjectId,
      chapters.map(chapter => {
        if (chapter.id !== id) return chapter
        updated = { ...chapter, completed: typeof completed === 'boolean' ? completed : !chapter.completed }
        return updated
      }),
    ]))
    if (!updated) throw new Error('Chapter not found')
    syncSubject(updated.subject_id)
    return updated
  })
  mocks.chaptersReorder.mockImplementation(async (subjectId: number, chapterIds: number[]) => {
    const current = chaptersBySubject[subjectId] ?? []
    const byId = new Map(current.map(chapter => [chapter.id, chapter]))
    chaptersBySubject[subjectId] = chapterIds.map((id, index) => ({ ...byId.get(id)!, sort_order: index }))
    return chaptersBySubject[subjectId]
  })
  mocks.chaptersDelete.mockImplementation(async (id: number) => {
    for (const [subjectId, chapters] of Object.entries(chaptersBySubject)) {
      if (chapters.some(chapter => chapter.id === id)) {
        chaptersBySubject[Number(subjectId)] = chapters.filter(chapter => chapter.id !== id)
        syncSubject(Number(subjectId))
      }
    }
    return true
  })
  mocks.chaptersClear.mockImplementation(async (subjectId: number) => {
    chaptersBySubject[subjectId] = []
    return subjects.find(subject => subject.id === subjectId)
  })

  const view = render(<StudyProgress />)
  return { view, getSubjects: () => subjects, getChapters: (subjectId: number) => chaptersBySubject[subjectId] ?? [] }
}

describe('StudyProgress detailed subject chapters', () => {
  beforeEach(() => {
    mockDataRefreshVersion = 0
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('adds an incomplete chapter to today once and disables the entry after refresh', async () => {
    setupStudyProgress([makeSubject({ total_chapters: 2, completed_chapters: 1 })], {
      7: [
        makeChapter({ id: 1, completed: false, title: '第一章 函数' }),
        makeChapter({ id: 2, completed: true, title: '第二章 导数', sort_order: 1 }),
      ],
    })

    fireEvent.click(await screen.findByTestId('manage-chapters-7'))
    const addButton = await screen.findByTestId('chapter-add-today-1')
    expect(screen.queryByTestId('chapter-add-today-2')).not.toBeInTheDocument()

    fireEvent.click(addButton)
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledWith({
      title: '学习：Math · 第一章 函数',
      type: 'focus',
      subject_id: 7,
      related_chapter_id: 1,
      planned_date: '2026-06-21',
      source: 'manual',
    }))
    expect(mocks.tasksFind).toHaveBeenCalledWith({ planned_date: '2026-06-21', related_chapter_id: 1 })
    expect(mocks.requestDataRefresh).toHaveBeenCalled()
    expect(await screen.findByTestId('chapter-added-today-1')).toBeDisabled()

    fireEvent.click(screen.getByTestId('chapter-added-today-1'))
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
  })

  it('reloads chapter progress when the global data refresh version changes', async () => {
    const chapter = makeChapter({ id: 1, completed: false })
    const setup = setupStudyProgress([makeSubject({ total_chapters: 1, completed_chapters: 0 })], { 7: [chapter] })
    fireEvent.click(await screen.findByTestId('manage-chapters-7'))
    expect(screen.getByTestId('chapter-toggle-1')).not.toBeChecked()

    mocks.chaptersGetBySubject.mockResolvedValue([{ ...chapter, completed: true }])
    mocks.subjectsGetAll.mockResolvedValue([makeSubject({ total_chapters: 1, completed_chapters: 1 })])
    mockDataRefreshVersion = 1
    setup.view.rerender(<StudyProgress />)

    await waitFor(() => expect(screen.getByTestId('chapter-toggle-1')).toBeChecked())
  })

  it('shows legacy summary progress and keeps subject deletion behind confirmation', async () => {
    setupStudyProgress([makeSubject()])

    await screen.findByTestId('subject-card-7')
    expect(screen.getByText('Math')).toBeInTheDocument()
    expect(screen.getByTitle('汇总进度加一')).toBeInTheDocument()

    vi.mocked(window.confirm).mockReturnValue(false)
    fireEvent.click(screen.getByTitle('删除科目'))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('详细章节'))
    expect(mocks.subjectsDelete).not.toHaveBeenCalled()
  })

  it('converts legacy summary progress from a pasted chapter list', async () => {
    setupStudyProgress([makeSubject({ total_chapters: 5, completed_chapters: 2 })])

    await screen.findByTestId('subject-card-7')
    fireEvent.click(screen.getByTestId('manage-chapters-7'))
    fireEvent.change(screen.getByTestId('chapter-bulk-input'), {
      target: {
        value: [
          '第一章 函数、极限与连续',
          '第二章 一元函数微分学',
          '第二章 一元函数微分学',
          '',
          '第三章 一元函数积分学',
        ].join('\n'),
      },
    })
    fireEvent.click(screen.getByTestId('chapter-bulk-button'))
    fireEvent.click(await screen.findByTestId('chapter-conversion-confirm'))

    await waitFor(() => {
      expect(mocks.chaptersConvert).toHaveBeenCalledWith({
        subject_id: 7,
        markCompletedCount: 2,
        chapters: [
          { title: '第一章 函数、极限与连续' },
          { title: '第二章 一元函数微分学' },
          { title: '第三章 一元函数积分学' },
        ],
      })
    })
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('重复'), 'success')
    expect(await screen.findByTestId('chapter-row-102')).toBeInTheDocument()
  })

  it('adds one chapter, toggles completion, filters, edits, reorders, and deletes', async () => {
    setupStudyProgress([makeSubject({ total_chapters: 2, completed_chapters: 1 })], {
      7: [
        makeChapter({ id: 1, title: '第一章 函数', completed: true, sort_order: 0 }),
        makeChapter({ id: 2, title: '第二章 导数', completed: false, sort_order: 1 }),
      ],
    })

    await screen.findByTestId('subject-card-7')
    fireEvent.click(screen.getByTestId('manage-chapters-7'))
    await screen.findByTestId('chapter-row-2')

    fireEvent.change(screen.getByTestId('chapter-title-input'), { target: { value: '第三章 积分' } })
    fireEvent.click(screen.getByTestId('chapter-add-button'))
    await waitFor(() => {
      expect(mocks.chaptersBulkCreate).toHaveBeenCalledWith({ subject_id: 7, chapters: [{ title: '第三章 积分' }] })
    })
    await screen.findByText('第三章 积分')

    fireEvent.click(screen.getByTestId('chapter-toggle-2'))
    await waitFor(() => {
      expect(mocks.chaptersToggle).toHaveBeenCalledWith(2, true)
    })

    fireEvent.click(screen.getByTestId('chapter-filter-open'))
    await waitFor(() => {
      expect(screen.queryByTestId('chapter-row-2')).not.toBeInTheDocument()
      expect(screen.getByTestId('chapter-row-100')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('chapter-filter-all'))

    const thirdRow = await screen.findByTestId('chapter-row-100')
    const thirdButtons = within(thirdRow).getAllByRole('button')
    fireEvent.click(thirdButtons[2]!)
    fireEvent.change(screen.getByTestId('chapter-edit-title-100'), { target: { value: '第三章 定积分' } })
    fireEvent.change(screen.getByTestId('chapter-edit-notes-100'), { target: { value: '重点题型' } })
    fireEvent.click(within(thirdRow).getAllByRole('button')[0]!)
    await waitFor(() => {
      expect(mocks.chaptersPatch).toHaveBeenCalledWith(100, { title: '第三章 定积分', notes: '重点题型' })
    })

    fireEvent.click(screen.getByTestId('chapter-up-100'))
    await waitFor(() => {
      expect(mocks.chaptersReorder).toHaveBeenCalledWith(7, [1, 100, 2])
    })

    fireEvent.click(within(screen.getByTestId('chapter-row-100')).getAllByRole('button')[3]!)
    await waitFor(() => {
      expect(mocks.chaptersDelete).toHaveBeenCalledWith(100)
    })
  })

  it('shows all-complete empty state when filtering unfinished chapters', async () => {
    setupStudyProgress([makeSubject({ total_chapters: 2, completed_chapters: 2 })], {
      7: [
        makeChapter({ id: 1, title: '第一章 函数', completed: true, sort_order: 0 }),
        makeChapter({ id: 2, title: '第二章 导数', completed: true, sort_order: 1 }),
      ],
    })

    await screen.findByTestId('subject-card-7')
    fireEvent.click(screen.getByTestId('manage-chapters-7'))
    fireEvent.click(screen.getByTestId('chapter-filter-open'))

    expect(await screen.findByText('全部章节都已完成。')).toBeInTheDocument()
  })

  it('reloads real state and shows feedback when a chapter API call fails', async () => {
    let resolveCreate: (() => void) | undefined
    setupStudyProgress([makeSubject({ total_chapters: 1, completed_chapters: 0 })], {
      7: [makeChapter({ id: 1, title: '第一章 函数', completed: false })],
    })
    mocks.chaptersBulkCreate.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => {
        resolveCreate = resolve
      })
      throw new Error('save failed')
    })

    await screen.findByTestId('subject-card-7')
    fireEvent.click(screen.getByTestId('manage-chapters-7'))
    fireEvent.change(screen.getByTestId('chapter-title-input'), { target: { value: '第二章 导数' } })
    fireEvent.click(screen.getByTestId('chapter-add-button'))
    fireEvent.click(screen.getByTestId('chapter-add-button'))
    expect(mocks.chaptersBulkCreate).toHaveBeenCalledTimes(1)

    resolveCreate?.()
    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith('save failed', 'error')
    })
    expect(mocks.subjectsGetAll).toHaveBeenCalledTimes(2)
  })

  it('deletes a confirmed subject and removes its detailed chapters from the next refresh', async () => {
    const state = setupStudyProgress([makeSubject()], {
      7: [makeChapter({ id: 1, title: '第一章 函数', completed: true })],
    })

    await screen.findByTestId('subject-card-7')
    fireEvent.click(screen.getByTitle('删除科目'))

    await waitFor(() => {
      expect(mocks.subjectsDelete).toHaveBeenCalledWith(7)
    })
    expect(mocks.showToast).toHaveBeenCalledWith('科目已删除', 'success')
    expect(state.getSubjects()).toEqual([])
    expect(state.getChapters(7)).toEqual([])
  })
})
