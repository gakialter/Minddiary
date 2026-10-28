// @vitest-environment node

import BetterSqlite3 from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runDatabaseMigrations } from '../electron/databaseMigrations'
import { createDatabaseRepositories } from '../electron/repositories/databaseRepositoryFactory'
import { createTasksApi } from '../src/contexts/api/tasksApi'
import type { NewStudyTask, PomodoroSession, StudyTask, Subject, SubjectChapter } from '../src/types'
import type { ElectronAPI, TasksContextAPI } from '../src/types/api'
import { validateRemoveChapterFromTodayInput } from '../src/utils/chapterTodayTaskRemoval'
import * as dateKey from '../src/utils/dateKey'

vi.mock('../src/utils/apiAdapter', () => ({ IS_ELECTRON: false }))

const TODAY = '2026-10-27'
const TOMORROW = '2026-10-28'
const request = { taskId: 1, chapterId: 1, subjectId: 1, date: TODAY }
const spec: NewStudyTask = {
  title: '学习：数学 · 函数', type: 'focus', subject_id: 1,
  related_chapter_id: 1, planned_date: TODAY, source: 'chapter',
}
const cleanups: Array<() => void> = []

function createHarness(kind: 'SQLite' | 'browser') {
  if (kind === 'SQLite') {
    const database = new BetterSqlite3(':memory:')
    cleanups.push(() => database.close())
    database.pragma('foreign_keys = ON')
    runDatabaseMigrations(database)
    database.exec(`
      INSERT INTO subjects (id, name) VALUES (1, '数学'), (2, '英语');
      INSERT INTO subject_chapters (id, subject_id, title) VALUES
        (1, 1, '函数'), (2, 1, '极限'), (3, 2, '阅读');
    `)
    const repository = createDatabaseRepositories(database).studyTasks
    const tasks: Pick<TasksContextAPI, 'create' | 'update' | 'removeChapterFromToday' | 'getByDate'> = {
      create: async data => repository.createStudyTask(data),
      update: async (id, patch) => repository.updateStudyTask(id, patch),
      removeChapterFromToday: async input => repository.removeChapterFromToday(input),
      getByDate: async date => repository.getStudyTasksByDate(date),
    }
    return {
      tasks,
      addFocus: (id: number) => {
        database.prepare('INSERT INTO pomodoro_sessions (task_id, subject_id, duration, date_key) VALUES (?, 1, 25, ?)').run(id, TODAY)
      },
      snapshot: () => JSON.stringify(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(value => {
        const { name } = value as { name: string }
        return [name, database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]
      })),
      database,
      persist: null,
    }
  }
  const tasksRef = { current: [] as StudyTask[] }
  const sessionsRef = { current: [] as PomodoroSession[] }
  const subjectsRef = { current: [
    { id: 1, name: '数学', total_chapters: 2, completed_chapters: 0, color: '#0F766E' },
    { id: 2, name: '英语', total_chapters: 1, completed_chapters: 0, color: '#0F766E' },
  ] as Subject[] }
  const chaptersRef = { current: [
    { id: 1, subject_id: 1, title: '函数' },
    { id: 2, subject_id: 1, title: '极限' },
    { id: 3, subject_id: 2, title: '阅读' },
  ].map(chapter => ({ ...chapter, completed: false, notes: '', sort_order: chapter.id, created_at: '', updated_at: '' })) as SubjectChapter[] }
  const persist = vi.fn()
  return {
    tasks: createTasksApi(tasksRef, persist, sessionsRef, chaptersRef, subjectsRef),
    addFocus: (id: number) => {
      sessionsRef.current.push({ id: 1, task_id: id, subject_id: 1, duration: 25, date_key: TODAY, completed_at: '' })
    },
    snapshot: () => JSON.stringify([tasksRef.current, sessionsRef.current, subjectsRef.current, chaptersRef.current]),
    database: null,
    persist,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 27, 12))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  cleanups.splice(0).forEach(cleanup => cleanup())
})

describe.each(['SQLite', 'browser'] as const)('%s chapter task undo', kind => {
  it('removes only the exact untouched task and returns current tasks; repeating is missing', async () => {
    const harness = createHarness(kind)
    const target = await harness.tasks.create(spec)
    const sameChapter = await harness.tasks.create(spec)
    const history = await harness.tasks.create({ ...spec, planned_date: '2026-10-26' })
    const future = await harness.tasks.create({ ...spec, planned_date: TOMORROW })
    const unrelated = await harness.tasks.create({ ...spec, subject_id: 2, related_chapter_id: 3, title: '学习：英语 · 阅读' })
    const result = await harness.tasks.removeChapterFromToday({ ...request, taskId: target.id })
    expect(result.status).toBe('removed')
    expect(result.tasks.map(task => task.id)).toEqual([sameChapter.id, unrelated.id])
    expect(await harness.tasks.getByDate('2026-10-26')).toEqual([history])
    expect(await harness.tasks.getByDate(TOMORROW)).toEqual([future])
    expect((await harness.tasks.removeChapterFromToday({ ...request, taskId: target.id })).status).toBe('missing')
  })

  it.each([
    { source: 'manual' as const },
    { source: 'ai' as const },
    { status: 'doing' as const },
    { status: 'done' as const },
    { status: 'skipped' as const },
    { title: 'My edited chapter task' },
    { description: 'Keep these notes' },
    { estimate_minutes: 45 },
    { type: 'custom' as const },
  ])('protects important or non-generated task data: %j', async patch => {
    const harness = createHarness(kind)
    const task = await harness.tasks.create({ ...spec, ...patch })
    const before = harness.snapshot()
    expect((await harness.tasks.removeChapterFromToday({ ...request, taskId: task.id })).status).toBe('protected')
    expect(harness.snapshot()).toBe(before)
  })

  it.each([
    { status: 'doing' as const }, { status: 'done' as const }, { title: 'Edited title' },
  ])('protects same-clock edits restored to their original fields: %j', async patch => {
    const harness = createHarness(kind)
    const task = await harness.tasks.create(spec)
    await harness.tasks.update(task.id, patch)
    const restored = await harness.tasks.update(task.id, { status: 'todo', title: spec.title, source: 'chapter' })
    expect(restored.source).toBe('manual')
    const before = harness.snapshot()
    expect((await harness.tasks.removeChapterFromToday({ ...request, taskId: task.id })).status).toBe('protected')
    expect(harness.snapshot()).toBe(before)
  })

  it('preserves focus records and their exact task link', async () => {
    const harness = createHarness(kind)
    const task = await harness.tasks.create(spec)
    harness.addFocus(task.id)
    const before = harness.snapshot()
    expect((await harness.tasks.removeChapterFromToday({ ...request, taskId: task.id })).status).toBe('protected')
    expect(harness.snapshot()).toBe(before)
  })

  it.each([
    { chapterId: 2 }, { subjectId: 2 }, { date: '2026-10-26' },
  ])('checks chapter, subject and local date at mutation: %j', async patch => {
    const harness = createHarness(kind)
    const task = await harness.tasks.create(spec)
    const before = harness.snapshot()
    expect((await harness.tasks.removeChapterFromToday({ ...request, taskId: task.id, ...patch })).status).toBe('changed')
    expect(harness.snapshot()).toBe(before)
  })

  it('returns the new current-day tasks after midnight without deleting yesterday', async () => {
    const harness = createHarness(kind)
    const yesterday = await harness.tasks.create(spec)
    const today = await harness.tasks.create({ ...spec, planned_date: TOMORROW })
    vi.setSystemTime(new Date(2026, 9, 28, 0, 0, 1))
    const before = harness.snapshot()
    expect(await harness.tasks.removeChapterFromToday({ ...request, taskId: yesterday.id })).toEqual({ status: 'changed', tasks: [today] })
    expect(harness.snapshot()).toBe(before)
  })

  it('checks midnight again immediately before delete', async () => {
    const harness = createHarness(kind)
    const task = await harness.tasks.create(spec)
    const tomorrow = await harness.tasks.create({ ...spec, planned_date: TOMORROW })
    const before = harness.snapshot()
    vi.spyOn(dateKey, 'getLocalDateKey').mockReturnValueOnce(TODAY).mockReturnValue(TOMORROW)
    expect(await harness.tasks.removeChapterFromToday({ ...request, taskId: task.id })).toEqual({ status: 'changed', tasks: [tomorrow] })
    expect(harness.snapshot()).toBe(before)
  })

  it('never removes other planned dates even with a valid current request date', async () => {
    const harness = createHarness(kind)
    const task = await harness.tasks.create({ ...spec, planned_date: TOMORROW })
    const before = harness.snapshot()
    expect((await harness.tasks.removeChapterFromToday({ ...request, taskId: task.id })).status).toBe('changed')
    expect(harness.snapshot()).toBe(before)
  })

  it.each([
    null, [], {}, { ...request, taskId: '1' }, { ...request, chapterId: -1 },
    { ...request, subjectId: 1.5 }, { ...request, date: 'today' },
  ])('rejects malformed boundary input without writes: %j', async input => {
    const harness = createHarness(kind)
    await harness.tasks.create(spec)
    const before = harness.snapshot()
    // Exercise the runtime boundary with deliberately untyped IPC input.
    await expect(harness.tasks.removeChapterFromToday(input as never)).rejects.toThrow()
    expect(harness.snapshot()).toBe(before)
  })
})

it('keeps an idempotency / Planning History receipt and its referenced task intact', async () => {
  const harness = createHarness('SQLite')
  const task = await harness.tasks.create(spec)
  harness.database!.prepare(`
    INSERT INTO study_task_action_receipts (operation_id, operation_kind, action_contract_version,
      request_digest, expected_current_date, planned_date, task_id)
    VALUES ('operation', 'today_action', 'v1', 'digest', ?, ?, ?)
  `).run(TODAY, TODAY, task.id)
  const before = harness.snapshot()
  expect((await harness.tasks.removeChapterFromToday({ ...request, taskId: task.id })).status).toBe('protected')
  expect(harness.snapshot()).toBe(before)
})

it('preserves browser in-memory state when persisting removal fails', async () => {
  const harness = createHarness('browser')
  const task = await harness.tasks.create(spec)
  const before = harness.snapshot()
  harness.persist!.mockImplementationOnce(() => { throw new Error('Storage full') })
  await expect(harness.tasks.removeChapterFromToday({ ...request, taskId: task.id })).rejects.toThrow('Storage full')
  expect(harness.snapshot()).toBe(before)
})

it('does not create a false browser association when persisting the chapter task fails', async () => {
  const harness = createHarness('browser')
  const before = harness.snapshot()
  harness.persist!.mockImplementationOnce(() => { throw new Error('Storage full') })
  await expect(harness.tasks.create(spec)).rejects.toThrow('Storage full')
  expect(harness.snapshot()).toBe(before)
  expect(await harness.tasks.getByDate(TODAY)).toEqual([])
})

it('passes the narrow undo request through preload to the validated main-process boundary', async () => {
  let exposed: ElectronAPI | undefined
  const remove = vi.fn().mockResolvedValue({ status: 'removed', tasks: [] })
  const invoke = vi.fn(async (channel: string, input: unknown) => {
    expect(channel).toBe('tasks:removeChapterFromToday')
    return remove(validateRemoveChapterFromTodayInput(input))
  })
  const code = ts.transpileModule(readFileSync('electron/preload.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('require', 'process', 'exports', code)(() => ({
    contextBridge: { exposeInMainWorld: (name: string, api: ElectronAPI) => { if (name === 'api') exposed = api } },
    ipcRenderer: { invoke },
  }), { env: {}, platform: 'win32' }, {})
  expect(await exposed!.tasks.removeChapterFromToday(request)).toEqual({ status: 'removed', tasks: [] })
  expect(remove).toHaveBeenCalledWith(request)
  await expect(exposed!.tasks.removeChapterFromToday({ ...request, taskId: '1' } as never)).rejects.toThrow()
  expect(remove).toHaveBeenCalledTimes(1)
})
