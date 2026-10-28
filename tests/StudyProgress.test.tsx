import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudyProgress from '../src/components/StudyProgress'
import type { Mistake, PomodoroStat, StudyTask, Subject, SubjectChapter } from '../src/types'

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
  tasksRemoveChapterFromToday: vi.fn(),
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
      removeChapterFromToday: mocks.tasksRemoveChapterFromToday,
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

const makeTask = (overrides: Partial<StudyTask> = {}): StudyTask => ({
  id: 1, title: '学习：Math · 第一章 函数', description: '', type: 'focus',
  subject_id: 7, related_chapter_id: 1, related_entry_id: null, related_mistake_id: null,
  planned_date: '2026-06-21', estimate_minutes: 25, status: 'todo', source: 'chapter',
  created_at: '2026-06-21 10:00:00', updated_at: '2026-06-21 10:00:00', ...overrides,
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
  let tasks: StudyTask[] = []

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
  mocks.tasksCreate.mockImplementation(async (data: Partial<StudyTask>) => {
    const created = makeTask({ id: tasks.length + 1, ...data })
    tasks = [...tasks, created]
    return created
  })
  mocks.tasksRemoveChapterFromToday.mockImplementation(async ({ taskId }: { taskId: number }) => {
    tasks = tasks.filter(task => task.id !== taskId)
    return { status: 'removed', tasks }
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
  return { view, getSubjects: () => subjects, getChapters: (subjectId: number) => chaptersBySubject[subjectId] ?? [], getTasks: () => tasks, setTasks: (next: StudyTask[]) => { tasks = next } }
}

describe('StudyProgress detailed subject chapters', () => {
  beforeEach(() => {
    mockDataRefreshVersion = 0
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('keeps the same planning rows, buttons and filter through three consecutive additions', async () => {
    const setup = setupStudyProgress([makeSubject({ total_chapters: 4, completed_chapters: 1 })], {
      7: [1, 2, 3, 4].map(id => makeChapter({ id, title: `章节 ${id}`, completed: id === 4, sort_order: id - 1 })),
    })
    const card = await screen.findByTestId('subject-card-7')
    const openFilter = await within(card).findByTestId('chapter-filter-open')
    expect(openFilter).toHaveAttribute('aria-pressed', 'true')
    const rows = [1, 2, 3].map(id => within(card).getByTestId(`chapter-row-${id}`))
    const buttons = [1, 2, 3].map(id => within(card).getByTestId(`chapter-add-today-${id}`))
    for (const [index, button] of buttons.entries()) {
      button.focus()
      fireEvent.click(button)
      await waitFor(() => expect(within(card).getByTestId(`chapter-added-today-${index + 1}`)).toBe(button))
      expect(button).toHaveAttribute('aria-disabled', 'false')
      expect(button).toHaveFocus()
      expect(within(card).getByTestId(`chapter-added-today-${index + 1}`)).toBe(button)
      expect(button).toHaveTextContent('撤销')
      expect(within(rows[index]!).getByText('已加入')).toBeVisible()
      expect(within(rows[index]!).getByRole('checkbox', { name: `标记为已完成：章节 ${index + 1}` })).not.toBeChecked()
      for (const [rowIndex, row] of rows.entries()) {
        expect(within(card).getByTestId(`chapter-row-${rowIndex + 1}`)).toBe(row)
      }
      expect(within(card).getByTestId('chapter-filter-open')).toBe(openFilter)
      expect(openFilter).toHaveAttribute('aria-pressed', 'true')
      mockDataRefreshVersion += 1
      setup.view.rerender(<StudyProgress />)
    }
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(3)
    expect(mocks.subjectsGetAll).toHaveBeenCalledTimes(1)
    expect(mocks.chaptersGetBySubject).toHaveBeenCalledTimes(1)
  })

  it('keeps management tools out of planning until explicitly opened', async () => {
    setupStudyProgress([makeSubject()], { 7: [makeChapter()] })
    const card = await screen.findByTestId('subject-card-7')
    const management = await within(card).findByTestId('chapter-management-toggle')
    expect(management).toHaveAttribute('aria-expanded', 'false')
    expect(management).toHaveTextContent('管理章节')
    expect(within(card).getByTestId('chapter-title-input')).not.toBeVisible()
    expect(within(card).queryByTitle('编辑章节')).not.toBeInTheDocument()
    expect(within(card).queryByTitle('删除章节')).not.toBeInTheDocument()
    expect(within(card).queryByTestId('chapter-up-1')).not.toBeInTheDocument()
    fireEvent.click(management)
    expect(management).toHaveAttribute('aria-expanded', 'true')
    expect(management).toHaveTextContent('完成管理')
    expect(document.getElementById(management.getAttribute('aria-controls')!)).toBeInTheDocument()
    expect(within(card).getByTestId('chapter-title-input')).toBeVisible()
    expect(within(card).getByTitle('编辑章节')).toBeVisible()
    fireEvent.click(management)
    expect(within(card).queryByTitle('编辑章节')).not.toBeInTheDocument()
  })

  it('preserves each subject workspace and drafts while switching and searching subjects', async () => {
    setupStudyProgress([makeSubject(), makeSubject({ id: 8, name: 'English' })], {
      7: [makeChapter()],
      8: [makeChapter({ id: 2, subject_id: 8, title: '英语阅读' })],
    })
    const math = await screen.findByTestId('subject-card-7')
    fireEvent.click(await within(math).findByTestId('chapter-management-toggle'))
    fireEvent.click(within(math).getByTestId('chapter-filter-all'))
    fireEvent.change(within(math).getByTestId('chapter-title-input'), { target: { value: '数学草稿' } })
    fireEvent.change(within(math).getByTestId('chapter-bulk-input'), { target: { value: '目录草稿' } })
    fireEvent.click(within(math).getByTitle('编辑章节'))
    fireEvent.change(within(math).getByTestId('chapter-edit-title-1'), { target: { value: '编辑草稿' } })
    fireEvent.click(screen.getByTestId('subject-select-8'))
    const english = await screen.findByTestId('subject-card-8')
    expect(math).not.toBeVisible()
    expect(english).toBeVisible()
    expect(screen.getByTestId('subject-select-8')).toHaveAttribute('aria-pressed', 'true')
    expect(within(english).getByTestId('chapter-filter-open')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(english).getByTestId('chapter-management-toggle'))
    fireEvent.change(within(english).getByTestId('chapter-title-input'), { target: { value: '英语草稿' } })
    fireEvent.click(screen.getByTestId('subject-select-7'))
    expect(screen.getByTestId('subject-card-7')).toBe(math)
    expect(math).toBeVisible()
    expect(english).not.toBeVisible()
    expect(within(math).getByTestId('chapter-filter-all')).toHaveAttribute('aria-pressed', 'true')
    expect(within(math).getByTestId('chapter-title-input')).toHaveValue('数学草稿')
    expect(within(math).getByTestId('chapter-bulk-input')).toHaveValue('目录草稿')
    expect(within(math).getByTestId('chapter-edit-title-1')).toHaveValue('编辑草稿')
    fireEvent.change(screen.getByLabelText('搜索科目'), { target: { value: 'English' } })
    expect(screen.queryByTestId('subject-select-7')).not.toBeInTheDocument()
    expect(math).toBeVisible()
    expect(within(math).getByTestId('chapter-edit-title-1')).toHaveValue('编辑草稿')
    fireEvent.click(screen.getByTestId('subject-select-8'))
    expect(screen.getByTestId('subject-card-8')).toBe(english)
    expect(within(english).getByTestId('chapter-title-input')).toHaveValue('英语草稿')
    expect(mocks.subjectsGetAll).toHaveBeenCalledTimes(1)
    expect(mocks.chaptersGetBySubject).toHaveBeenCalledTimes(2)
  })

  it('refreshes external chapter state in place without losing creation or edit drafts', async () => {
    const chapter = makeChapter()
    const setup = setupStudyProgress([makeSubject()], { 7: [chapter] })
    const card = await screen.findByTestId('subject-card-7')
    fireEvent.click(await within(card).findByTestId('chapter-management-toggle'))
    fireEvent.click(within(card).getByTestId('chapter-filter-all'))
    const titleInput = within(card).getByTestId('chapter-title-input')
    fireEvent.change(titleInput, { target: { value: '未提交新章节' } })
    fireEvent.change(within(card).getByTestId('chapter-bulk-input'), { target: { value: '未提交目录' } })
    fireEvent.click(within(card).getByTitle('编辑章节'))
    const editInput = within(card).getByTestId('chapter-edit-title-1')
    fireEvent.change(editInput, { target: { value: '未提交编辑' } })
    mocks.chaptersGetBySubject.mockResolvedValue([{ ...chapter, completed: true }])
    mocks.subjectsGetAll.mockResolvedValue([makeSubject({ completed_chapters: 3 })])
    mockDataRefreshVersion = 1
    setup.view.rerender(<StudyProgress />)
    await waitFor(() => expect(within(card).getByTestId('chapter-toggle-1')).toBeChecked())
    expect(screen.getByTestId('subject-card-7')).toBe(card)
    expect(within(card).getByTestId('chapter-title-input')).toBe(titleInput)
    expect(titleInput).toHaveValue('未提交新章节')
    expect(within(card).getByTestId('chapter-bulk-input')).toHaveValue('未提交目录')
    expect(within(card).getByTestId('chapter-edit-title-1')).toBe(editInput)
    expect(editInput).toHaveValue('未提交编辑')
    expect(within(card).getByTestId('chapter-filter-all')).toHaveAttribute('aria-pressed', 'true')
  })

  it.each(['find', 'create'])('does not show a false added state when task %s fails', async operation => {
    setupStudyProgress([makeSubject()], { 7: [makeChapter()] })
    const failingCall = operation === 'find' ? mocks.tasksFind : mocks.tasksCreate
    failingCall.mockRejectedValueOnce(new Error('task failed'))
    const button = await screen.findByTestId('chapter-add-today-1')
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('task failed')
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'))
    expect(screen.queryByTestId('chapter-added-today-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('chapter-add-today-1')).toBe(button)
    expect(button).not.toHaveAttribute('aria-disabled', 'true')
    expect(mocks.requestDataRefresh).not.toHaveBeenCalled()
    if (operation === 'find') expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('adds an incomplete chapter to today once without reloading the chapter list', async () => {
    const setup = setupStudyProgress([makeSubject({ total_chapters: 2, completed_chapters: 1 })], {
      7: [
        makeChapter({ id: 1, completed: false, title: '第一章 函数' }),
        makeChapter({ id: 2, completed: true, title: '第二章 导数', sort_order: 1 }),
      ],
    })

    await screen.findByTestId('subject-card-7')
    const addButton = await screen.findByTestId('chapter-add-today-1')
    expect(screen.queryByTestId('chapter-add-today-2')).not.toBeInTheDocument()

    fireEvent.click(addButton)
    await waitFor(() => expect(mocks.tasksCreate).toHaveBeenCalledWith({
      title: '学习：Math · 第一章 函数',
      type: 'focus',
      subject_id: 7,
      related_chapter_id: 1,
      planned_date: '2026-06-21',
      source: 'chapter',
    }))
    expect(mocks.tasksFind).toHaveBeenCalledWith({ planned_date: '2026-06-21', related_chapter_id: 1 })
    expect(mocks.requestDataRefresh).toHaveBeenCalled()
    expect(await screen.findByTestId('chapter-added-today-1')).toHaveAttribute('aria-disabled', 'false')
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
    expect(mocks.subjectsGetAll).toHaveBeenCalledTimes(1)
    expect(mocks.chaptersGetBySubject).toHaveBeenCalledTimes(1)

    mockDataRefreshVersion = 1
    setup.view.rerender(<StudyProgress />)
    expect(mocks.subjectsGetAll).toHaveBeenCalledTimes(1)
    expect(mocks.chaptersGetBySubject).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('chapter-added-today-1'))
    await screen.findByTestId('chapter-add-today-1')
    expect(mocks.tasksCreate).toHaveBeenCalledTimes(1)
  })

  it('marks an already-existing today task locally without creating or reloading', async () => {
    setupStudyProgress([makeSubject({ total_chapters: 1, completed_chapters: 0 })], {
      7: [makeChapter({ id: 1, completed: false })],
    })
    mocks.tasksFind.mockResolvedValueOnce([makeTask({ id: 99 })])

    await screen.findByTestId('subject-card-7')
    fireEvent.click(await screen.findByTestId('chapter-add-today-1'))

    expect(await screen.findByTestId('chapter-added-today-1')).toHaveAttribute('aria-disabled', 'false')
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
    expect(mocks.requestDataRefresh).toHaveBeenCalledTimes(1)
    expect(mocks.subjectsGetAll).toHaveBeenCalledTimes(1)
    expect(mocks.chaptersGetBySubject).toHaveBeenCalledTimes(1)
  })

  it('undoes and re-adds in place with one completion heading and accurate checkbox names', async () => {
    const setup = setupStudyProgress([makeSubject()], { 7: [makeChapter()] })
    const card = await screen.findByTestId('subject-card-7')
    const row = within(card).getByTestId('chapter-row-1')
    const body = card.querySelector('.chapter-workspace__body')!
    body.scrollTop = 240
    const button = within(row).getByTestId('chapter-add-today-1')
    expect(within(card).getAllByText('完成', { exact: true })).toHaveLength(1)
    expect(within(row).queryByText('完成', { exact: true })).not.toBeInTheDocument()
    expect(within(row).getByRole('checkbox')).toHaveAccessibleName('标记为已完成：第一章 函数')
    for (let cycle = 0; cycle < 2; cycle++) {
      button.focus()
      fireEvent.click(button)
      await waitFor(() => expect(button).toHaveAccessibleName('撤销加入今日任务：第一章 函数'))
      expect(screen.getByText(/今日已安排/)).toHaveTextContent('今日已安排 1 章')
      fireEvent.click(button)
      await waitFor(() => expect(button).toHaveAccessibleName('加入今日任务：第一章 函数'))
      expect(screen.getByText(/今日已安排/)).toHaveTextContent('今日已安排 0 章')
      expect(button).toHaveFocus()
      expect(body.scrollTop).toBe(240)
      expect(within(card).getByTestId('chapter-row-1')).toBe(row)
      expect(setup.getTasks()).toHaveLength(0)
    }
    expect(mocks.tasksRemoveChapterFromToday).toHaveBeenCalledWith({ taskId: 1, chapterId: 1, subjectId: 7, date: '2026-06-21' })
    expect(mocks.chaptersGetBySubject).toHaveBeenCalledTimes(1)
  })

  it('keeps truthful state after undo failure and allows a retry without remounting', async () => {
    const setup = setupStudyProgress([makeSubject()], { 7: [makeChapter()] })
    const button = await screen.findByTestId('chapter-add-today-1')
    fireEvent.click(button)
    await screen.findByTestId('chapter-added-today-1')
    mocks.tasksRemoveChapterFromToday.mockRejectedValueOnce(new Error('删除失败，请重试'))
    button.focus()
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('删除失败，请重试')
    expect(screen.getByTestId('chapter-added-today-1')).toBe(button)
    expect(button).toHaveFocus()
    expect(setup.getTasks()).toHaveLength(1)
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'))
    fireEvent.click(button)
    await screen.findByTestId('chapter-add-today-1')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(setup.getTasks()).toHaveLength(0)
  })

  it.each(['protected', 'changed'] as const)('retains a %s task and explains why undo did not delete it', async status => {
    const setup = setupStudyProgress([makeSubject()], { 7: [makeChapter()] })
    const button = await screen.findByTestId('chapter-add-today-1')
    fireEvent.click(button)
    await screen.findByTestId('chapter-added-today-1')
    mocks.tasksRemoveChapterFromToday.mockResolvedValueOnce({ status, tasks: setup.getTasks() })
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent(status === 'protected' ? '已保留' : '已变化')
    expect(screen.getByTestId('chapter-added-today-1')).toBe(button)
    expect(screen.getByText(/今日已安排/)).toHaveTextContent('今日已安排 1 章')
  })

  it('blocks repeated pending undo clicks and refreshes external deletion without replacing rows', async () => {
    const setup = setupStudyProgress([makeSubject()], { 7: [makeChapter()] })
    const button = await screen.findByTestId('chapter-add-today-1')
    fireEvent.click(button)
    await screen.findByTestId('chapter-added-today-1')
    let finish: ((value: { status: string; tasks: StudyTask[] }) => void) | undefined
    mocks.tasksRemoveChapterFromToday.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    fireEvent.click(button)
    fireEvent.click(button)
    expect(mocks.tasksRemoveChapterFromToday).toHaveBeenCalledTimes(1)
    setup.setTasks([])
    finish!({ status: 'removed', tasks: [] })
    await screen.findByTestId('chapter-add-today-1')
    // A later page refresh must also reconcile associations and retain the control.
    setup.setTasks([makeTask()])
    mockDataRefreshVersion = 2
    setup.view.rerender(<StudyProgress />)
    expect(await screen.findByTestId('chapter-added-today-1')).toBe(button)
    setup.setTasks([])
    mockDataRefreshVersion = 3
    setup.view.rerender(<StudyProgress />)
    expect(await screen.findByTestId('chapter-add-today-1')).toBe(button)
  })

  it('ignores an older task read after adding and retains known links when a refresh fails', async () => {
    const setup = setupStudyProgress([makeSubject()], { 7: [makeChapter()] })
    const button = await screen.findByTestId('chapter-add-today-1')
    let finishRead: ((tasks: StudyTask[]) => void) | undefined
    mocks.tasksGetByDate.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
    mockDataRefreshVersion = 2
    setup.view.rerender(<StudyProgress />)
    await waitFor(() => expect(mocks.tasksGetByDate).toHaveBeenCalledTimes(2))
    fireEvent.click(button)
    await screen.findByTestId('chapter-added-today-1')
    finishRead!([])
    await waitFor(() => expect(mocks.chaptersGetBySubject).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('chapter-added-today-1')).toBe(button)
    mocks.tasksGetByDate.mockRejectedValueOnce(new Error('read failed'))
    mockDataRefreshVersion = 4
    setup.view.rerender(<StudyProgress />)
    await waitFor(() => expect(mocks.tasksGetByDate).toHaveBeenCalledTimes(3))
    expect(screen.getByTestId('chapter-added-today-1')).toBe(button)
    expect(screen.getByText(/今日已安排/)).toHaveTextContent('今日已安排 1 章')
  })

  it('reconciles a successful delete whose response failed instead of showing a false link', async () => {
    const setup = setupStudyProgress([makeSubject()], { 7: [makeChapter()] })
    const button = await screen.findByTestId('chapter-add-today-1')
    fireEvent.click(button)
    await screen.findByTestId('chapter-added-today-1')
    mocks.tasksRemoveChapterFromToday.mockImplementationOnce(async () => {
      setup.setTasks([])
      throw new Error('response failed')
    })
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('response failed')
    expect(screen.getByTestId('chapter-add-today-1')).toBe(button)
    expect(screen.getByText(/今日已安排/)).toHaveTextContent('今日已安排 0 章')
  })

  it('updates chapter completion locally without reloading the chapter list', async () => {
    setupStudyProgress([makeSubject({ total_chapters: 1, completed_chapters: 0 })], {
      7: [makeChapter({ id: 1, completed: false })],
    })

    const subjectCard = await screen.findByTestId('subject-card-7')
    fireEvent.click(await screen.findByTestId('chapter-filter-all'))
    const toggle = await screen.findByTestId('chapter-toggle-1')
    expect(toggle).toHaveAccessibleName('标记为已完成：第一章 函数')

    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
    expect(toggle).toHaveAccessibleName('标记为未完成：第一章 函数')
    expect(subjectCard).toHaveTextContent('1 / 1')
    expect(screen.getByTestId('chapter-add-today-1')).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).not.toBeChecked())
    expect(subjectCard).toHaveTextContent('0 / 1')
    expect(await screen.findByTestId('chapter-add-today-1')).toBeInTheDocument()
    expect(mocks.chaptersToggle).toHaveBeenNthCalledWith(1, 1, true)
    expect(mocks.chaptersToggle).toHaveBeenNthCalledWith(2, 1, false)
    expect(mocks.subjectsGetAll).toHaveBeenCalledTimes(1)
    expect(mocks.chaptersGetBySubject).toHaveBeenCalledTimes(1)
    expect(mocks.tasksCreate).not.toHaveBeenCalled()
  })

  it('reloads chapter progress when the global data refresh version changes', async () => {
    const chapter = makeChapter({ id: 1, completed: false })
    const setup = setupStudyProgress([makeSubject({ total_chapters: 1, completed_chapters: 0 })], { 7: [chapter] })
    await screen.findByTestId('subject-card-7')
    fireEvent.click(await screen.findByTestId('chapter-filter-all'))
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
    expect(within(screen.getByTestId('subject-card-7')).getByRole('heading', { name: 'Math' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '总进度' })).toHaveAttribute('aria-valuenow', '40')
    expect(screen.getByRole('progressbar', { name: 'Math章节进度' })).toHaveAttribute('aria-valuetext', '已完成 2 / 5 章节')
    expect(screen.getByRole('button', { name: '增加 Math 的完成章节数' })).toBeInTheDocument()
    expect(screen.getByTitle('增加 Math 的完成章节数')).toBeInTheDocument()

    vi.mocked(window.confirm).mockReturnValue(false)
    fireEvent.click(screen.getByText('科目设置'))
    fireEvent.click(screen.getByTitle('删除科目'))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('详细章节'))
    expect(mocks.subjectsDelete).not.toHaveBeenCalled()
  })

  it('keeps the subject form persistently labelled and exposes color selection', async () => {
    setupStudyProgress([])

    fireEvent.click(await screen.findByRole('button', { name: '添加科目' }))

    expect(screen.getByLabelText('科目名')).toHaveAttribute('id', 'study-progress-subject-name')
    expect(screen.getByLabelText('章节总数')).toHaveAttribute('id', 'study-progress-subject-total')
    expect(screen.getByRole('button', { name: '选择颜色 #0F766E' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '选择颜色 #2F8F6B' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('converts legacy summary progress from a pasted chapter list', async () => {
    setupStudyProgress([makeSubject({ total_chapters: 5, completed_chapters: 2 })])

    await screen.findByTestId('subject-card-7')
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
    await screen.findByTestId('chapter-row-2')

    fireEvent.click(await screen.findByTestId('chapter-management-toggle'))
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
    fireEvent.click(within(thirdRow).getByTitle('编辑章节'))
    fireEvent.change(screen.getByTestId('chapter-edit-title-100'), { target: { value: '第三章 定积分' } })
    fireEvent.change(screen.getByTestId('chapter-edit-notes-100'), { target: { value: '重点题型' } })
    fireEvent.click(within(thirdRow).getByTitle('保存章节'))
    await waitFor(() => {
      expect(mocks.chaptersPatch).toHaveBeenCalledWith(100, { title: '第三章 定积分', notes: '重点题型' })
    })

    fireEvent.click(screen.getByTestId('chapter-up-100'))
    await waitFor(() => {
      expect(mocks.chaptersReorder).toHaveBeenCalledWith(7, [1, 100, 2])
    })

    fireEvent.click(within(screen.getByTestId('chapter-row-100')).getByTitle('删除章节'))
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
    fireEvent.click(await screen.findByTestId('chapter-management-toggle'))
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

  it('discloses clearing chapter details, cancels without writes, and preserves summary progress on confirmation', async () => {
    const subject = makeSubject({ total_chapters: 3, completed_chapters: 2 })
    const chapters = [
      makeChapter({ id: 1, title: '第一章 函数', notes: '保留用于取消核对', completed: true }),
      makeChapter({ id: 2, title: '第二章 导数', completed: true, sort_order: 1 }),
      makeChapter({ id: 3, title: '第三章 积分', completed: false, sort_order: 2 }),
    ]
    const state = setupStudyProgress([subject], { 7: chapters })
    await screen.findByTestId('subject-card-7')
    fireEvent.click(await screen.findByTestId('chapter-management-toggle'))
    const clearButton = await screen.findByRole('button', { name: '删除明细，保留汇总进度' })
    expect(clearButton).toHaveAttribute('title', '删除章节明细并保留汇总进度')

    vi.mocked(window.confirm).mockReturnValueOnce(false)
    fireEvent.click(clearButton)
    expect(window.confirm).toHaveBeenLastCalledWith('确认删除全部详细章节，并保留当前 2/3 为汇总进度吗？')
    expect(mocks.chaptersClear).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalled()
    expect(state.getChapters(7)).toEqual(chapters)
    expect(state.getSubjects()).toEqual([subject])
    expect(screen.getByTestId('chapter-row-3')).toBeInTheDocument()

    fireEvent.click(clearButton)
    await waitFor(() => expect(mocks.chaptersClear).toHaveBeenCalledWith(7))
    expect(mocks.chaptersClear).toHaveBeenCalledTimes(1)
    expect(window.confirm).toHaveBeenCalledTimes(2)
    expect(mocks.showToast).toHaveBeenCalledWith('已退出详细章节模式，汇总进度已保留', 'success')
    await waitFor(() => expect(screen.queryByRole('button', { name: '删除明细，保留汇总进度' })).not.toBeInTheDocument())
    expect(state.getChapters(7)).toEqual([])
    expect(state.getSubjects()).toEqual([subject])
    expect(screen.getByTestId('subject-card-7')).toHaveTextContent('已完成 2 / 3 章')
    expect(screen.queryByTestId('chapter-row-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chapter-row-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chapter-row-3')).not.toBeInTheDocument()
  })

  it('deletes a confirmed subject and removes its detailed chapters from the next refresh', async () => {
    const state = setupStudyProgress([makeSubject()], {
      7: [makeChapter({ id: 1, title: '第一章 函数', completed: true })],
    })

    await screen.findByTestId('subject-card-7')
    fireEvent.click(screen.getByText('科目设置'))
    fireEvent.click(screen.getByTitle('删除科目'))

    await waitFor(() => {
      expect(mocks.subjectsDelete).toHaveBeenCalledWith(7)
    })
    expect(mocks.showToast).toHaveBeenCalledWith('科目已删除', 'success')
    expect(state.getSubjects()).toEqual([])
    expect(state.getChapters(7)).toEqual([])
  })
})
