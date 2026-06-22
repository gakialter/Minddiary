import { describe, expect, it } from 'vitest'
import {
  buildTodayExecutionSummary,
  getNextTodayAction,
  resolveTaskSourceLabels,
} from '../src/utils/todayExecution'
import type { StudyTask, Subject, SubjectChapter } from '../src/types'

const makeTask = (overrides: Partial<StudyTask> = {}): StudyTask => ({
  id: 1,
  title: '普通任务',
  description: '',
  type: 'custom',
  subject_id: null,
  related_mistake_id: null,
  related_entry_id: null,
  related_chapter_id: null,
  planned_date: '2026-06-21',
  estimate_minutes: 25,
  status: 'todo',
  source: 'manual',
  created_at: '2026-06-21T00:00:00.000Z',
  updated_at: '2026-06-21T00:00:00.000Z',
  ...overrides,
})

describe('getNextTodayAction', () => {
  it('returns the active Pomodoro session without replacing its task', () => {
    const activeTask = makeTask({ id: 9, title: '正在专注的任务', status: 'doing' })

    const action = getNextTodayAction({
      tasks: [makeTask({ id: 1 })],
      hasActivePomodoroSession: true,
      activeTask,
      hasIncompleteChapters: true,
      diaryStatus: 'missing',
    })

    expect(action.kind).toBe('active-focus')
    expect(action.task).toBe(activeTask)
    expect(action.actionLabel).toBe('返回当前专注')
  })

  it('prefers the first doing task over chapter and ordinary todos', () => {
    const firstDoing = makeTask({ id: 2, title: '先继续我', status: 'doing' })
    const secondDoing = makeTask({ id: 3, title: '后继续我', status: 'doing' })
    const chapterTodo = makeTask({ id: 4, related_chapter_id: 40 })

    const action = getNextTodayAction({
      tasks: [chapterTodo, firstDoing, secondDoing],
      hasActivePomodoroSession: false,
      activeTask: null,
      hasIncompleteChapters: false,
      diaryStatus: 'missing',
    })

    expect(action.kind).toBe('task')
    expect(action.task?.id).toBe(2)
    expect(action.reason).toContain('已经开始')
  })

  it('prefers the first chapter todo over ordinary todos', () => {
    const firstChapterTodo = makeTask({ id: 2, title: '章节一', related_chapter_id: 20 })
    const secondChapterTodo = makeTask({ id: 3, title: '章节二', related_chapter_id: 30 })

    const action = getNextTodayAction({
      tasks: [makeTask({ id: 1 }), firstChapterTodo, secondChapterTodo],
      hasActivePomodoroSession: false,
      activeTask: null,
      hasIncompleteChapters: false,
      diaryStatus: 'missing',
    })

    expect(action.kind).toBe('task')
    expect(action.task?.id).toBe(2)
    expect(action.reason).toContain('章节')
  })

  it('returns the first ordinary todo when no higher-priority task exists', () => {
    const firstTodo = makeTask({ id: 5, title: '先加入的任务' })
    const secondTodo = makeTask({ id: 6, title: '后加入的任务' })

    const action = getNextTodayAction({
      tasks: [firstTodo, secondTodo],
      hasActivePomodoroSession: false,
      activeTask: null,
      hasIncompleteChapters: false,
      diaryStatus: 'missing',
    })

    expect(action.kind).toBe('task')
    expect(action.task?.id).toBe(5)
    expect(action.reason).toContain('加入今日计划的顺序')
  })

  it('never recommends done or skipped tasks for execution', () => {
    const action = getNextTodayAction({
      tasks: [
        makeTask({ id: 1, status: 'skipped' }),
        makeTask({ id: 2, status: 'done' }),
      ],
      hasActivePomodoroSession: false,
      activeTask: null,
      hasIncompleteChapters: false,
      diaryStatus: 'missing',
    })

    expect(action.kind).toBe('review')
    expect(action.task).toBeNull()
  })

  it('recommends writing a review when all tasks are complete and no diary exists', () => {
    const action = getNextTodayAction({
      tasks: [makeTask({ status: 'done' })],
      hasActivePomodoroSession: false,
      activeTask: null,
      hasIncompleteChapters: true,
      diaryStatus: 'missing',
    })

    expect(action.kind).toBe('review')
    expect(action.title).toBe('写今日复盘')
  })

  it('recommends continuing the review when all tasks are complete and a diary exists', () => {
    const action = getNextTodayAction({
      tasks: [makeTask({ status: 'done' })],
      hasActivePomodoroSession: false,
      activeTask: null,
      hasIncompleteChapters: false,
      diaryStatus: 'written',
    })

    expect(action.kind).toBe('review')
    expect(action.title).toBe('今日已闭环')
    expect(action.actionLabel).toBe('继续写今日复盘')
  })

  it('points to subject progress when there are no tasks and chapters remain', () => {
    const action = getNextTodayAction({
      tasks: [],
      hasActivePomodoroSession: false,
      activeTask: null,
      hasIncompleteChapters: true,
      diaryStatus: 'missing',
    })

    expect(action.kind).toBe('add-chapter')
    expect(action.actionLabel).toBe('去科目进度')
  })

  it('recommends a review for an empty day without unfinished chapters', () => {
    const action = getNextTodayAction({
      tasks: [],
      hasActivePomodoroSession: false,
      activeTask: null,
      hasIncompleteChapters: false,
      diaryStatus: 'missing',
    })

    expect(action.kind).toBe('review')
    expect(action.title).toBe('写今日复盘')
  })
})

describe('buildTodayExecutionSummary', () => {
  it('summarizes tasks, focus, chapter progress, and diary status', () => {
    const summary = buildTodayExecutionSummary({
      tasks: [
        makeTask({ id: 1, status: 'done', related_chapter_id: 10 }),
        makeTask({ id: 2, status: 'todo', related_chapter_id: 11 }),
        makeTask({ id: 3, status: 'skipped' }),
      ],
      focusMinutes: 47,
      todayEntry: { wordCount: 120 },
    })

    expect(summary).toEqual({
      totalTasks: 3,
      completedTasks: 1,
      focusMinutes: 47,
      chapterTaskCount: 2,
      completedChapterTaskCount: 1,
      diaryStatus: 'written',
    })
  })

  it('distinguishes a blank diary draft from a missing diary', () => {
    expect(buildTodayExecutionSummary({ tasks: [], focusMinutes: 0, todayEntry: { wordCount: 0 } }).diaryStatus).toBe('draft')
    expect(buildTodayExecutionSummary({ tasks: [], focusMinutes: 0, todayEntry: null }).diaryStatus).toBe('missing')
  })
})

describe('resolveTaskSourceLabels', () => {
  const subjects: Subject[] = [{ id: 7, name: '数学', color: '#2563eb' }]
  const chapters: SubjectChapter[] = [{
    id: 70,
    subject_id: 7,
    title: '函数',
    notes: '',
    completed: false,
    sort_order: 0,
    created_at: '2026-06-21T00:00:00.000Z',
    updated_at: '2026-06-21T00:00:00.000Z',
  }]

  it('maps chapter tasks to stable subject and chapter labels without parsing titles', () => {
    const labels = resolveTaskSourceLabels({
      tasks: [makeTask({ id: 8, title: '任意标题', subject_id: 7, related_chapter_id: 70 })],
      subjects,
      chaptersBySubject: { 7: chapters },
    })

    expect(labels[8]).toEqual({
      subjectName: '数学',
      chapterName: '函数',
      label: '数学 · 函数',
      missingChapter: false,
    })
  })

  it('degrades missing chapters safely and omits ordinary tasks', () => {
    const labels = resolveTaskSourceLabels({
      tasks: [
        makeTask({ id: 8, subject_id: 7, related_chapter_id: 999 }),
        makeTask({ id: 9 }),
      ],
      subjects,
      chaptersBySubject: { 7: chapters },
    })

    expect(labels[8]?.label).toBe('章节已删除')
    expect(labels[8]?.missingChapter).toBe(true)
    expect(labels[9]).toBeUndefined()
  })
})
