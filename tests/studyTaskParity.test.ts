// @vitest-environment node

import BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runDatabaseMigrations } from '../electron/databaseMigrations'
import { createDatabaseRepositories } from '../electron/repositories/databaseRepositoryFactory'
import { createSubjectChaptersApi } from '../src/contexts/api/subjectChaptersApi'
import { createTasksApi } from '../src/contexts/api/tasksApi'
import type {
  PomodoroSession,
  SaveToLocalFn,
  StudyTask,
  StudyTaskStatus,
  Subject,
  SubjectChapter,
} from '../src/types'

vi.mock('../src/utils/apiAdapter', () => ({ IS_ELECTRON: false }))

type Ref<T> = { current: T }

const databases: BetterSqlite3.Database[] = []

const saveToLocal: SaveToLocalFn = () => {}

function createRef<T>(current: T): Ref<T> {
  return { current }
}

function createSqliteFixture() {
  const database = new BetterSqlite3(':memory:')
  databases.push(database)
  database.pragma('foreign_keys = ON')
  runDatabaseMigrations(database)
  return {
    database,
    repositories: createDatabaseRepositories(database),
  }
}

function createFallbackFixture(persist: SaveToLocalFn = saveToLocal) {
  const subjectsRef = createRef<Subject[]>([])
  const chaptersRef = createRef<SubjectChapter[]>([])
  const tasksRef = createRef<StudyTask[]>([])
  const pomodoroSessionsRef = createRef<PomodoroSession[]>([])
  const tasks = createTasksApi(
    tasksRef,
    persist,
    pomodoroSessionsRef,
    chaptersRef,
  )
  const subjectChapters = createSubjectChaptersApi(
    subjectsRef,
    chaptersRef,
    saveToLocal,
    tasksRef,
  )
  return {
    subjectsRef,
    chaptersRef,
    tasksRef,
    tasks,
    subjectChapters,
  }
}

function projectTask(task: StudyTask) {
  return {
    id: Number(task.id),
    title: task.title,
    status: task.status,
    subject_id: task.subject_id,
    related_chapter_id: task.related_chapter_id,
    created_at: task.created_at,
  }
}

function overwriteTaskTimestamps(
  taskId: number,
  createdAt: string,
  database: BetterSqlite3.Database,
  tasksRef: Ref<StudyTask[]>,
) {
  database.prepare(`
    UPDATE study_tasks
    SET created_at = ?, updated_at = ?
    WHERE id = ?
  `).run(createdAt, createdAt, taskId)
  tasksRef.current = tasksRef.current.map(task => (
    task.id === taskId
      ? { ...task, created_at: createdAt, updated_at: createdAt }
      : task
  ))
}

describe('study task SQLite/browser fallback parity', () => {
  afterEach(() => {
    vi.useRealTimers()
    for (const database of databases.splice(0)) {
      database.close()
    }
  })

  it('keeps browser fallback date-bound creation zero-write after logical midnight', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 31, 23, 59, 59))
    const fallback = createFallbackFixture()
    const task = {
      title: 'Old-date candidate',
      planned_date: '2026-06-01',
      status: 'todo' as const,
      source: 'ai' as const,
    }

    await fallback.tasks.createForCurrentDate(task, '2026-05-31')
    expect(fallback.tasksRef.current).toHaveLength(1)

    vi.setSystemTime(new Date(2026, 5, 1, 0, 0, 1))
    await expect(fallback.tasks.createForCurrentDate(task, '2026-05-31'))
      .rejects.toThrow('The current local date changed before task creation')
    expect(fallback.tasksRef.current).toHaveLength(1)
  })

  it('rolls back browser fallback creation when the date changes inside the call', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 31, 23, 59, 59))
    let persistenceWrites = 0
    const fallback = createFallbackFixture(() => {
      persistenceWrites += 1
      if (persistenceWrites === 1) vi.setSystemTime(new Date(2026, 5, 1, 0, 0, 1))
    })

    await expect(fallback.tasks.createForCurrentDate({
      title: 'Mid-call rollover candidate',
      planned_date: '2026-06-01',
      status: 'todo',
      source: 'ai',
    }, '2026-05-31')).rejects.toThrow('The current local date changed before task creation')

    expect(fallback.tasksRef.current).toEqual([])
    expect(persistenceWrites).toBe(2)
  })

  it('returns the same shape and deterministic order for the same planned-date fixture', async () => {
    const sqlite = createSqliteFixture()
    const fallback = createFallbackFixture()

    const subject = sqlite.repositories.subjects.createSubject({
      name: 'Math',
      color: '#0F766E',
    }) as Subject
    fallback.subjectsRef.current = [{ ...subject, id: Number(subject.id) }]

    const chapter = sqlite.repositories.subjectChapters.createChapter({
      subject_id: Number(subject.id),
      title: 'Functions',
    })
    fallback.chaptersRef.current = [chapter]

    const specs: Array<{
      title: string
      status: StudyTaskStatus
      created_at: string
      related_chapter_id?: number | null
    }> = [
      {
        title: 'ordinary todo same timestamp',
        status: 'todo',
        created_at: '2026-06-21T08:00:00.000Z',
        related_chapter_id: null,
      },
      {
        title: 'chapter todo same timestamp',
        status: 'todo',
        created_at: '2026-06-21T08:00:00.000Z',
        related_chapter_id: chapter.id,
      },
      {
        title: 'doing task',
        status: 'doing',
        created_at: '2026-06-21T09:00:00.000Z',
        related_chapter_id: null,
      },
      {
        title: 'skipped task',
        status: 'skipped',
        created_at: '2026-06-21T07:00:00.000Z',
        related_chapter_id: null,
      },
      {
        title: 'done task',
        status: 'done',
        created_at: '2026-06-21T06:00:00.000Z',
        related_chapter_id: null,
      },
    ]

    for (const spec of specs) {
      const taskInput = {
        title: spec.title,
        type: 'focus' as const,
        subject_id: Number(subject.id),
        related_chapter_id: spec.related_chapter_id ?? null,
        planned_date: '2026-06-21',
        estimate_minutes: 25,
        status: spec.status,
        source: 'manual' as const,
      }
      const sqliteTask = sqlite.repositories.studyTasks.createStudyTask(taskInput)
      const fallbackTask = await fallback.tasks.create(taskInput)
      expect(Number(sqliteTask.id)).toBe(fallbackTask.id)
      overwriteTaskTimestamps(
        Number(sqliteTask.id),
        spec.created_at,
        sqlite.database,
        fallback.tasksRef,
      )
    }

    const sqliteTaskRows = sqlite.repositories.studyTasks.getStudyTasksByDate('2026-06-21')
    const fallbackTaskRows = await fallback.tasks.getByDate('2026-06-21')

    expect(sqliteTaskRows).toEqual(fallbackTaskRows)
    const sqliteTasks = sqliteTaskRows.map(projectTask)
    expect(sqliteTasks.map(task => task.status)).toEqual([
      'doing',
      'todo',
      'todo',
      'skipped',
      'done',
    ])
    expect(sqliteTasks.map(task => task.title)).toEqual([
      'doing task',
      'ordinary todo same timestamp',
      'chapter todo same timestamp',
      'skipped task',
      'done task',
    ])
  })

  it('keeps chapter delete set-null semantics aligned without deleting the task', async () => {
    const sqlite = createSqliteFixture()
    const fallback = createFallbackFixture()

    const subject = sqlite.repositories.subjects.createSubject({
      name: 'English',
      color: '#0E7490',
    }) as Subject
    fallback.subjectsRef.current = [{ ...subject, id: Number(subject.id) }]
    const chapter = sqlite.repositories.subjectChapters.createChapter({
      subject_id: Number(subject.id),
      title: 'Reading',
    })
    fallback.chaptersRef.current = [chapter]

    const taskInput = {
      title: 'Read chapter',
      type: 'focus' as const,
      subject_id: Number(subject.id),
      related_chapter_id: chapter.id,
      planned_date: '2026-06-22',
      status: 'todo' as const,
      source: 'manual' as const,
    }
    const sqliteTask = sqlite.repositories.studyTasks.createStudyTask(taskInput)
    const fallbackTask = await fallback.tasks.create(taskInput)
    expect(Number(sqliteTask.id)).toBe(fallbackTask.id)
    overwriteTaskTimestamps(
      Number(sqliteTask.id),
      '2026-06-22T08:00:00.000Z',
      sqlite.database,
      fallback.tasksRef,
    )

    sqlite.repositories.subjectChapters.deleteChapter(chapter.id)
    await fallback.subjectChapters.delete(chapter.id)

    expect(sqlite.repositories.subjectChapters.getBySubject(Number(subject.id))).toEqual([])
    await expect(fallback.subjectChapters.getBySubject(Number(subject.id))).resolves.toEqual([])
    const sqliteAfterDelete = sqlite.repositories.studyTasks
      .getStudyTasksByDate('2026-06-22')
      .map(projectTask)
    const fallbackAfterDelete = (await fallback.tasks.getByDate('2026-06-22')).map(projectTask)

    expect(sqliteAfterDelete).toEqual(fallbackAfterDelete)
    expect(sqliteAfterDelete).toEqual([
      expect.objectContaining({
        id: Number(sqliteTask.id),
        title: 'Read chapter',
        status: 'todo',
        subject_id: Number(subject.id),
        related_chapter_id: null,
      }),
    ])
    expect(sqlite.database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('rejects cross-subject chapter attribution in both data paths', async () => {
    const sqlite = createSqliteFixture()
    const fallback = createFallbackFixture()

    const math = sqlite.repositories.subjects.createSubject({
      name: 'Math',
      color: '#0F766E',
    }) as Subject
    const english = sqlite.repositories.subjects.createSubject({
      name: 'English',
      color: '#0E7490',
    }) as Subject
    fallback.subjectsRef.current = [
      { ...math, id: Number(math.id) },
      { ...english, id: Number(english.id) },
    ]
    const englishChapter = sqlite.repositories.subjectChapters.createChapter({
      subject_id: Number(english.id),
      title: 'Reading',
    })
    fallback.chaptersRef.current = [englishChapter]

    const invalidTask = {
      title: 'Invalid attribution',
      type: 'focus' as const,
      subject_id: Number(math.id),
      related_chapter_id: englishChapter.id,
      planned_date: '2026-06-23',
      source: 'manual' as const,
    }

    expect(() => sqlite.repositories.studyTasks.createStudyTask(invalidTask))
      .toThrow('Task subject must match chapter subject')
    await expect(fallback.tasks.create(invalidTask))
      .rejects.toThrow('Task subject must match chapter subject')
    expect(sqlite.repositories.studyTasks.getStudyTasksByDate('2026-06-23')).toEqual([])
    expect(fallback.tasksRef.current).toEqual([])
  })
})
