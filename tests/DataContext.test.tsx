import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockEntries, mockMistakes, mockSubjectChapters, mockSubjects, mockTags, STORAGE_KEYS } from '../src/data/mockData'
import type { AIMessage, Attachment, DiaryEntry, DiaryTemplate, Mistake, StudyTask, SubjectChapter } from '../src/types'
import type { ElectronAPI } from '../src/types/api'

const mocks = vi.hoisted(() => ({
  isElectron: true,
}))

vi.mock('../src/utils/apiAdapter', () => ({
  get IS_ELECTRON() {
    return mocks.isElectron
  },
}))

import { DataProvider, useData } from '../src/contexts/DataContext'

const createWindowApiMock = (): ElectronAPI => ({
  window: {
    platform: 'win32',
    titlebarMode: 'custom',
    minimize: vi.fn().mockResolvedValue(undefined),
    maximize: vi.fn().mockResolvedValue(false),
    close: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn().mockResolvedValue(false),
    setFullScreen: vi.fn().mockResolvedValue(true),
    isFullScreen: vi.fn().mockResolvedValue(false),
    onFullScreenChange: vi.fn().mockReturnValue(() => {}),
  },
  updater: {
    check: vi.fn().mockResolvedValue({ success: true }),
    install: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue({ status: 'idle' }),
    onStatusChange: vi.fn().mockReturnValue(() => {}),
  },
  entries: {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    update: vi.fn().mockResolvedValue({ id: 1 }),
    delete: vi.fn().mockResolvedValue(undefined),
    getByDate: vi.fn().mockResolvedValue(null),
    getById: vi.fn().mockResolvedValue(null),
    getAll: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    getDatesWithEntries: vi.fn().mockResolvedValue([]),
  },
  tags: {
    getAll: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 1, name: 'tag', color: '#000000' }),
    update: vi.fn().mockResolvedValue({ id: 1, name: 'tag', color: '#000000' }),
    delete: vi.fn().mockResolvedValue(undefined),
    setEntryTags: vi.fn().mockResolvedValue(undefined),
    getEntryTags: vi.fn().mockResolvedValue([]),
    getEntryTagsBatch: vi.fn().mockResolvedValue({}),
  },
  settings: {
    getAll: vi.fn().mockResolvedValue({ aiApiKeyMasked: null, aiApiKeyPresent: false }),
    updateGeneral: vi.fn().mockResolvedValue({ success: true }),
    updateAI: vi.fn().mockResolvedValue({ success: true }),
    updateBackup: vi.fn().mockResolvedValue({ success: true }),
    selectBackupFolder: vi.fn().mockResolvedValue(null),
    selectBackupFile: vi.fn().mockResolvedValue(null),
    restoreBackupFromZip: vi.fn().mockResolvedValue({ success: false }),
  },
  attachments: {
    save: vi.fn().mockResolvedValue({
      id: 1,
      entry_id: 7,
      filename: 'a.png',
      filepath: 'attachments/a.png',
      mimetype: 'image/png',
      created_at: '2026-05-05T00:00:00.000Z',
    }),
    getByEntry: vi.fn().mockResolvedValue([]),
    getByEntries: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
    getPath: vi.fn().mockResolvedValue('mock-path.png'),
  },
  subjects: {
    getAll: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 1, name: 'subject', color: '#000000' }),
    update: vi.fn().mockResolvedValue({ id: 1, name: 'subject', color: '#000000' }),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  subjectChapters: {
    getBySubject: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({
      id: 1,
      subject_id: 1,
      title: 'chapter',
      notes: '',
      completed: false,
      sort_order: 0,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    }),
    bulkCreate: vi.fn().mockResolvedValue([]),
    convertFromSummary: vi.fn().mockResolvedValue([]),
    patch: vi.fn().mockResolvedValue({
      id: 1,
      subject_id: 1,
      title: 'chapter',
      notes: '',
      completed: false,
      sort_order: 0,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    }),
    toggleCompleted: vi.fn().mockResolvedValue({
      id: 1,
      subject_id: 1,
      title: 'chapter',
      notes: '',
      completed: true,
      sort_order: 0,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    }),
    reorder: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue({ success: true }),
    clearDetailedChapters: vi.fn().mockResolvedValue({ id: 1, name: 'subject', color: '#000000' }),
  },
  pomodoro: {
    addSession: vi.fn().mockResolvedValue({ id: 1 }),
    getStats: vi.fn().mockResolvedValue([]),
    getStatsRange: vi.fn().mockResolvedValue([]),
    getDailyTotal: vi.fn().mockResolvedValue(0),
    getRange: vi.fn().mockResolvedValue([]),
  },
  tasks: {
    getByDate: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({
      id: 1,
      title: 'task',
      description: '',
      type: 'custom',
      subject_id: null,
      related_mistake_id: null,
      related_entry_id: null,
      planned_date: '2026-05-31',
      estimate_minutes: 25,
      status: 'todo',
      source: 'manual',
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    }),
    update: vi.fn().mockResolvedValue({
      id: 1,
      title: 'task',
      description: '',
      type: 'custom',
      subject_id: null,
      related_mistake_id: null,
      related_entry_id: null,
      planned_date: '2026-05-31',
      estimate_minutes: 25,
      status: 'doing',
      source: 'manual',
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    }),
    delete: vi.fn().mockResolvedValue(true),
    complete: vi.fn().mockResolvedValue({ id: 1, status: 'done' }),
    skip: vi.fn().mockResolvedValue({ id: 1, status: 'skipped' }),
    startFocus: vi.fn().mockResolvedValue({ id: 1, status: 'doing' }),
  },
  dashboard: {
    streak: vi.fn().mockResolvedValue(0),
    entryDatesRange: vi.fn().mockResolvedValue([]),
  },
  todayDashboard: {
    getData: vi.fn().mockResolvedValue({
      todayEntry: null,
      pomodoroToday: { totalMinutes: 0, sessionCount: 0 },
      commanderMetrics: {
        riskPoolCount: 0,
        lockedKnowledgeGrowth: 0,
        focusConversionRate: 0,
      },
      taskFocusToday: {
        effectiveTaskCount: 0,
        completedTaskCount: 0,
        completionRate: 0,
        focusedTaskCount: 0,
        focusCoverageRate: 0,
        focusedMinutes: 0,
        skippedTaskCount: 0,
        openWithoutFocusCount: 0,
        focusedOpenTaskCount: 0,
        unclosedTaskTitles: [],
      },
      streakDays: 0,
    }),
  },
  mistakes: {
    getAll: vi.fn().mockResolvedValue({ data: [], total: 0, masteredTotal: 0 }),
    create: vi.fn().mockResolvedValue({ id: 1 }),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    toggleMastered: vi.fn().mockResolvedValue({ mastered: 1 }),
    review: vi.fn().mockResolvedValue({ success: true }),
    getDueCount: vi.fn().mockResolvedValue(0),
    getRandomDue: vi.fn().mockResolvedValue(null),
    saveImage: vi.fn().mockResolvedValue('image.png'),
    getImagePath: vi.fn().mockResolvedValue('/mock/image.png'),
  },
  ai: {
    chat: vi.fn().mockResolvedValue({ content: 'mock response' }),
    summarize: vi.fn().mockResolvedValue({ content: 'summary' }),
  },
  notification: {
    show: vi.fn().mockResolvedValue(undefined),
  },
  export: {
    showSaveDialog: vi.fn().mockResolvedValue('C:\\mock\\export.md'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    toPDF: vi.fn().mockResolvedValue(undefined),
  },
  focusGuard: {
    getActiveApp: vi.fn().mockResolvedValue(null),
  },
  templates: {
    getAll: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 1 }),
    update: vi.fn().mockResolvedValue({ id: 1 }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <DataProvider>{children}</DataProvider>
)

const renderDataHook = () => renderHook(() => useData(), { wrapper })

const seedEmptyBrowserStorage = () => {
  localStorage.setItem(STORAGE_KEYS.ENTRIES, '[]')
  localStorage.setItem(STORAGE_KEYS.TAGS, '[]')
  localStorage.setItem(STORAGE_KEYS.MISTAKES, '[]')
  localStorage.setItem(STORAGE_KEYS.SUBJECTS, '[]')
  localStorage.setItem(STORAGE_KEYS.SUBJECT_CHAPTERS, '[]')
  localStorage.setItem(STORAGE_KEYS.TASKS, '[]')
  localStorage.setItem(STORAGE_KEYS.POMODORO_SESSIONS, '[]')
}

beforeEach(() => {
  mocks.isElectron = true
  window.api = createWindowApiMock()
  localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('DataContext', () => {
  it('throws when useData is rendered without DataProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const suppressWindowError = (event: ErrorEvent) => event.preventDefault()

    window.addEventListener('error', suppressWindowError)
    try {
      expect(() => renderHook(() => useData())).toThrow('useData must be used within DataProvider')
    } finally {
      window.removeEventListener('error', suppressWindowError)
    }

    expect(consoleError).toHaveBeenCalled()
  })

  it('initializes quickly in Electron mode without reading localStorage', async () => {
    mocks.isElectron = true
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    expect(result.current.initErrors).toEqual([])
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('initializes browser fallback data from localStorage and writes mock defaults when empty', async () => {
    mocks.isElectron = false
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    expect(getItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.ENTRIES)
    expect(getItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.TAGS)
    expect(getItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.MISTAKES)
    expect(getItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.SUBJECTS)
    expect(getItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.SUBJECT_CHAPTERS)
    expect(getItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.TASKS)
    expect(getItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.POMODORO_SESSIONS)
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.ENTRIES, JSON.stringify(mockEntries))
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.TAGS, JSON.stringify(mockTags))
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.MISTAKES, JSON.stringify(mockMistakes))
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.SUBJECTS, JSON.stringify(mockSubjects))
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.SUBJECT_CHAPTERS, JSON.stringify(mockSubjectChapters))
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.TASKS, JSON.stringify([]))
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.POMODORO_SESSIONS, JSON.stringify([]))
  })

  it('passes core API calls through to Electron window.api namespaces', async () => {
    mocks.isElectron = true
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    const messages: AIMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'hello' },
    ]
    const attachmentData = { name: 'a.png', data: 'base64', mimetype: 'image/png' }
    let chatResult: Awaited<ReturnType<typeof result.current.ai.chat>> | undefined
    let savedAttachment: Attachment | undefined

    await act(async () => {
      await result.current.entries.getAll({ limit: 3 })
      await result.current.entries.create({
        date: '2026-05-05',
        title: 'test',
        content: 'body',
        mood: null,
      })
      await result.current.tags.getAll()
      await result.current.tags.setEntryTags(7, [1, 2])
      await result.current.tags.getEntryTags(7)
      await result.current.tags.getEntryTagsBatch([7, 8])
      await result.current.mistakes.getAll({ mastered: false })
      await result.current.subjects.getAll()
      await result.current.subjectChapters.getBySubject(1)
      await result.current.subjectChapters.create({ subject_id: 1, title: 'chapter' })
      await result.current.subjectChapters.bulkCreate({ subject_id: 1, chapters: [{ title: 'chapter 2' }] })
      await result.current.subjectChapters.convertFromSummary({
        subject_id: 1,
        chapters: [{ title: 'chapter 1' }],
        markCompletedCount: 1,
      })
      await result.current.subjectChapters.patch(1, { notes: 'updated' })
      await result.current.subjectChapters.toggleCompleted(1, true)
      await result.current.subjectChapters.reorder(1, [1])
      await result.current.subjectChapters.delete(1)
      await result.current.subjectChapters.clearDetailedChapters(1)
      await result.current.pomodoro.getStats('2026-05-05')
      await result.current.pomodoro.getStatsRange('2026-05-01', '2026-05-05')
      await result.current.tasks.getByDate('2026-05-05')
      await result.current.tasks.find({ planned_date: '2026-05-05', status: ['todo', 'doing'] })
      await result.current.tasks.create({ title: 'task', planned_date: '2026-05-05' })
      await result.current.tasks.update(1, { status: 'doing' })
      await result.current.tasks.startFocus(1, '2026-05-05')
      await result.current.tasks.complete(1)
      await result.current.tasks.skip(1)
      await result.current.tasks.delete(1)
      await result.current.dashboard.streak()
      await result.current.todayDashboard.getData('2026-05-05')
      await result.current.exportUtil.showSaveDialog({ defaultPath: 'export.md' })
      await result.current.notification.show('title', 'body')
      chatResult = await result.current.ai.chat(messages)
      await result.current.attachments.getByEntry(7)
      await result.current.attachments.getByEntries([7, 8])
      savedAttachment = await result.current.attachments.save(7, attachmentData)
      await result.current.templates.getAll()
    })

    expect(window.api.entries.getAll).toHaveBeenCalledWith({ limit: 3 })
    expect(window.api.entries.create).toHaveBeenCalledWith({
      date: '2026-05-05',
      title: 'test',
      content: 'body',
      mood: null,
    })
    expect(window.api.tags.getAll).toHaveBeenCalledTimes(1)
    expect(window.api.tags.setEntryTags).toHaveBeenCalledWith(7, [1, 2])
    expect(window.api.tags.getEntryTags).toHaveBeenCalledWith(7)
    expect(window.api.tags.getEntryTagsBatch).toHaveBeenCalledWith([7, 8])
    expect(window.api.mistakes.getAll).toHaveBeenCalledWith({ mastered: false })
    expect(window.api.subjects.getAll).toHaveBeenCalledTimes(1)
    expect(window.api.subjectChapters.getBySubject).toHaveBeenCalledWith(1)
    expect(window.api.subjectChapters.create).toHaveBeenCalledWith({ subject_id: 1, title: 'chapter' })
    expect(window.api.subjectChapters.bulkCreate).toHaveBeenCalledWith({ subject_id: 1, chapters: [{ title: 'chapter 2' }] })
    expect(window.api.subjectChapters.convertFromSummary).toHaveBeenCalledWith({
      subject_id: 1,
      chapters: [{ title: 'chapter 1' }],
      markCompletedCount: 1,
    })
    expect(window.api.subjectChapters.patch).toHaveBeenCalledWith(1, { notes: 'updated' })
    expect(window.api.subjectChapters.toggleCompleted).toHaveBeenCalledWith(1, true)
    expect(window.api.subjectChapters.reorder).toHaveBeenCalledWith(1, [1])
    expect(window.api.subjectChapters.delete).toHaveBeenCalledWith(1)
    expect(window.api.subjectChapters.clearDetailedChapters).toHaveBeenCalledWith(1)
    expect(window.api.pomodoro.getStats).toHaveBeenCalledWith('2026-05-05')
    expect(window.api.pomodoro.getStatsRange).toHaveBeenCalledWith('2026-05-01', '2026-05-05')
    expect(window.api.tasks.getByDate).toHaveBeenCalledWith('2026-05-05')
    expect(window.api.tasks.find).toHaveBeenCalledWith({ planned_date: '2026-05-05', status: ['todo', 'doing'] })
    expect(window.api.tasks.create).toHaveBeenCalledWith({ title: 'task', planned_date: '2026-05-05' })
    expect(window.api.tasks.update).toHaveBeenCalledWith(1, { status: 'doing' })
    expect(window.api.tasks.startFocus).toHaveBeenCalledWith(1, '2026-05-05')
    expect(window.api.tasks.complete).toHaveBeenCalledWith(1)
    expect(window.api.tasks.skip).toHaveBeenCalledWith(1)
    expect(window.api.tasks.delete).toHaveBeenCalledWith(1)
    expect(window.api.dashboard.streak).toHaveBeenCalledTimes(1)
    expect(window.api.todayDashboard.getData).toHaveBeenCalledWith('2026-05-05')
    expect(window.api.export.showSaveDialog).toHaveBeenCalledWith({ defaultPath: 'export.md' })
    expect(window.api.notification.show).toHaveBeenCalledWith('title', 'body')
    expect(window.api.ai.chat).toHaveBeenCalledWith(messages)
    expect(chatResult).toEqual({ content: 'mock response' })
    expect(window.api.attachments.getByEntry).toHaveBeenCalledWith(7)
    expect(window.api.attachments.getByEntries).toHaveBeenCalledWith([7, 8])
    expect(window.api.attachments.save).toHaveBeenCalledWith(7, attachmentData)
    expect(savedAttachment).toEqual({
      id: 1,
      entry_id: 7,
      filename: 'a.png',
      filepath: 'attachments/a.png',
      mimetype: 'image/png',
      created_at: '2026-05-05T00:00:00.000Z',
    })
    expect(window.api.templates.getAll).toHaveBeenCalledTimes(1)
  })

  it('creates and reads entries from browser fallback storage', async () => {
    mocks.isElectron = false
    seedEmptyBrowserStorage()
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    let createdEntry: DiaryEntry | undefined
    await act(async () => {
      createdEntry = await result.current.entries.create({
        date: '2026-05-05',
        title: 'test',
        content: 'created content',
        mood: null,
      })
    })

    const allEntries = await result.current.entries.getAll()

    expect(createdEntry).toEqual(expect.objectContaining({
      id: 1,
      title: 'test',
      word_count: 14,
      images: [],
      created_at: expect.any(String),
      updated_at: expect.any(String),
    }))

    const titleOnlyUpdate = await result.current.entries.update(createdEntry!.id, { title: 'retitled' })
    expect(titleOnlyUpdate).toEqual(expect.objectContaining({
      id: createdEntry!.id,
      title: 'retitled',
      content: 'created content',
      mood: null,
      word_count: 14,
    }))
    const contentUpdate = await result.current.entries.update(createdEntry!.id, { content: 'A B\nC' })
    expect(contentUpdate).toEqual(expect.objectContaining({
      id: createdEntry!.id,
      title: 'retitled',
      content: 'A B\nC',
      word_count: 3,
    }))
    expect(allEntries).toHaveLength(1)
    expect(allEntries[0]).toEqual(createdEntry)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ENTRIES) || '[]')).toEqual([
      expect.objectContaining({ id: createdEntry!.id, title: 'retitled', content: 'A B\nC', word_count: 3 }),
    ])
  })

  it('keeps browser fallback subject chapters and subject summaries consistent', async () => {
    mocks.isElectron = false
    localStorage.setItem(STORAGE_KEYS.ENTRIES, '[]')
    localStorage.setItem(STORAGE_KEYS.TAGS, '[]')
    localStorage.setItem(STORAGE_KEYS.MISTAKES, '[]')
    localStorage.setItem(STORAGE_KEYS.SUBJECTS, JSON.stringify([
      { id: 1, name: 'Math', total_chapters: 5, completed_chapters: 3, color: '#0F766E' },
      { id: 2, name: 'Physics', total_chapters: 4, completed_chapters: 3, color: '#854D0E' },
    ]))
    localStorage.setItem(STORAGE_KEYS.SUBJECT_CHAPTERS, '[]')
    localStorage.setItem(STORAGE_KEYS.TASKS, '[]')
    localStorage.setItem(STORAGE_KEYS.POMODORO_SESSIONS, '[]')
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    await expect(result.current.subjectChapters.convertFromSummary({
      subject_id: 2,
      markCompletedCount: 3,
      chapters: [{ title: '力学' }, { title: '电磁学' }],
    })).rejects.toThrow('Cannot mark more chapters complete')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECT_CHAPTERS) || '[]')).toEqual([])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 2, total_chapters: 4, completed_chapters: 3 }),
    ]))

    await expect(result.current.subjectChapters.clearDetailedChapters(2)).resolves.toEqual(expect.objectContaining({
      id: 2,
      total_chapters: 4,
      completed_chapters: 3,
    }))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 2, total_chapters: 4, completed_chapters: 3 }),
    ]))

    const converted = await result.current.subjectChapters.convertFromSummary({
      subject_id: 1,
      markCompletedCount: 2,
      chapters: [
        { title: '第一章 函数' },
        { title: '第二章 导数' },
        { title: '第三章 积分' },
      ],
    })
    expect(converted.map(chapter => ({ title: chapter.title, completed: chapter.completed }))).toEqual([
      { title: '第一章 函数', completed: true },
      { title: '第二章 导数', completed: true },
      { title: '第三章 积分', completed: false },
    ])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, total_chapters: 3, completed_chapters: 2 }),
    ]))

    const fourth = await result.current.subjectChapters.create({
      subject_id: 1,
      title: '第四章 多元函数微积分',
      notes: '重点',
    })
    const patched = await result.current.subjectChapters.patch(fourth.id, { notes: '新增说明' })
    expect(patched).toEqual(expect.objectContaining({ title: '第四章 多元函数微积分', notes: '新增说明', completed: false }))
    await result.current.subjectChapters.toggleCompleted(fourth.id, true)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, total_chapters: 4, completed_chapters: 3 }),
    ]))

    const reordered = await result.current.subjectChapters.reorder(1, [
      fourth.id,
      converted[2]!.id,
      converted[1]!.id,
      converted[0]!.id,
    ])
    expect(reordered.map(chapter => chapter.title)).toEqual([
      '第四章 多元函数微积分',
      '第三章 积分',
      '第二章 导数',
      '第一章 函数',
    ])
    await expect(result.current.subjectChapters.reorder(1, [fourth.id])).rejects.toThrow('chapterIds must include each subject chapter exactly once')

    await result.current.subjectChapters.delete(converted[2]!.id)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, total_chapters: 3, completed_chapters: 3 }),
    ]))
    await result.current.subjectChapters.clearDetailedChapters(1)
    expect(await result.current.subjectChapters.getBySubject(1)).toEqual([])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, total_chapters: 3, completed_chapters: 3 }),
    ]))
  })

  it('removes browser fallback chapters when deleting a subject while unlinking history rows', async () => {
    mocks.isElectron = false
    const chapter: SubjectChapter = {
      id: 9,
      subject_id: 1,
      title: '第一章 函数',
      notes: '',
      completed: true,
      sort_order: 0,
      created_at: '2026-06-13T00:00:00.000Z',
      updated_at: '2026-06-13T00:00:00.000Z',
    }
    const mistake: Mistake = {
      ...mockMistakes[0]!,
      id: 10,
      subject_id: 1,
    }
    const linkedTask: StudyTask = {
      id: 11,
      title: 'Subject task',
      description: '',
      type: 'custom',
      subject_id: 1,
      related_mistake_id: null,
      related_entry_id: null,
      planned_date: '2026-05-31',
      estimate_minutes: 25,
      status: 'todo',
      source: 'manual',
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    }
    localStorage.setItem(STORAGE_KEYS.ENTRIES, '[]')
    localStorage.setItem(STORAGE_KEYS.TAGS, '[]')
    localStorage.setItem(STORAGE_KEYS.MISTAKES, JSON.stringify([mistake]))
    localStorage.setItem(STORAGE_KEYS.SUBJECTS, JSON.stringify([
      { id: 1, name: 'Math', total_chapters: 1, completed_chapters: 1, color: '#0F766E' },
    ]))
    localStorage.setItem(STORAGE_KEYS.SUBJECT_CHAPTERS, JSON.stringify([chapter]))
    localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify([linkedTask]))
    localStorage.setItem(STORAGE_KEYS.POMODORO_SESSIONS, JSON.stringify([
      { id: 12, subject_id: 1, task_id: 11, duration: 25, date_key: '2026-05-31' },
    ]))

    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    await result.current.subjects.delete(1)

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECTS) || '[]')).toEqual([])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBJECT_CHAPTERS) || '[]')).toEqual([])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.MISTAKES) || '[]')).toEqual([
      expect.objectContaining({ id: 10, subject_id: null }),
    ])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.TASKS) || '[]')).toEqual([
      expect.objectContaining({ id: 11, subject_id: null }),
    ])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.POMODORO_SESSIONS) || '[]')).toEqual([
      expect.objectContaining({ id: 12, subject_id: null }),
    ])
  })

  it('clears browser fallback task entry links when an entry is deleted', async () => {
    mocks.isElectron = false
    const entry: DiaryEntry = {
      ...mockEntries[0]!,
      id: 11,
      date: '2026-05-31',
      content: 'linked diary body',
      word_count: 15,
    }
    const linkedTask: StudyTask = {
      id: 7,
      title: 'Diary task',
      description: '',
      type: 'diary',
      subject_id: null,
      related_mistake_id: null,
      related_entry_id: 11,
      planned_date: '2026-05-31',
      estimate_minutes: 15,
      status: 'done',
      source: 'manual',
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    }
    localStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify([entry]))
    localStorage.setItem(STORAGE_KEYS.TAGS, '[]')
    localStorage.setItem(STORAGE_KEYS.MISTAKES, '[]')
    localStorage.setItem(STORAGE_KEYS.SUBJECTS, '[]')
    localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify([linkedTask]))
    localStorage.setItem(STORAGE_KEYS.POMODORO_SESSIONS, '[]')
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    await result.current.entries.delete(11)

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.TASKS) || '[]')).toEqual([
      expect.objectContaining({ id: 7, related_entry_id: null, status: 'done' }),
    ])
  })

  it('sets, resolves, persists, and removes entry tags in browser fallback storage', async () => {
    mocks.isElectron = false
    const entry: DiaryEntry = {
      ...mockEntries[0]!,
      id: 11,
      tags: [],
    }
    const tags = mockTags.slice(0, 2)
    localStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify([entry]))
    localStorage.setItem(STORAGE_KEYS.TAGS, JSON.stringify(tags))
    localStorage.setItem(STORAGE_KEYS.MISTAKES, '[]')
    localStorage.setItem(STORAGE_KEYS.SUBJECTS, '[]')

    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    await act(async () => {
      await result.current.tags.setEntryTags(11, [tags[1]!.id])
    })

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ENTRIES) || '[]')).toEqual([
      expect.objectContaining({ id: 11, tags: [tags[1]!.id] }),
    ])

    const entryTags = await result.current.tags.getEntryTags(11)
    expect(entryTags).toEqual([
      { ...tags[1], icon: '', variant: 'soft', pattern: 'none' },
    ])

    await act(async () => {
      await result.current.tags.delete(tags[1]!.id)
    })

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ENTRIES) || '[]')).toEqual([
      expect.objectContaining({ id: 11, tags: [] }),
    ])
  })

  it('normalizes legacy tags and persists style fields in browser fallback storage', async () => {
    mocks.isElectron = false
    localStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify([]))
    localStorage.setItem(STORAGE_KEYS.TAGS, JSON.stringify([
      { id: 1, name: 'legacy', color: '#0F766E' },
    ]))
    localStorage.setItem(STORAGE_KEYS.MISTAKES, '[]')
    localStorage.setItem(STORAGE_KEYS.SUBJECTS, '[]')

    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    await expect(result.current.tags.getAll()).resolves.toEqual([
      { id: 1, name: 'legacy', color: '#0F766E', icon: '', variant: 'soft', pattern: 'none' },
    ])

    let createdTag: Awaited<ReturnType<typeof result.current.tags.create>> | undefined
    await act(async () => {
      createdTag = await result.current.tags.create({
        name: 'focus',
        color: '#C65A3A',
        icon: ' 🌿🌿🌿🌿🌿 ',
        variant: 'solid',
        pattern: 'stripes',
      })
    })

    expect(createdTag).toEqual({
      id: 2,
      name: 'focus',
      color: '#C65A3A',
      icon: '🌿🌿🌿🌿',
      variant: 'solid',
      pattern: 'stripes',
    })

    await act(async () => {
      await result.current.tags.update(2, { icon: '☆', pattern: 'grid' })
    })

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.TAGS) || '[]')).toEqual([
      { id: 1, name: 'legacy', color: '#0F766E' },
      { id: 2, name: 'focus', color: '#C65A3A', icon: '☆', variant: 'solid', pattern: 'grid' },
    ])
  })

  it('rejects invalid browser fallback tag create and update requests', async () => {
    mocks.isElectron = false
    localStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify([]))
    localStorage.setItem(STORAGE_KEYS.TAGS, JSON.stringify([
      { id: 1, name: 'legacy', color: '#0F766E' },
    ]))
    localStorage.setItem(STORAGE_KEYS.MISTAKES, '[]')
    localStorage.setItem(STORAGE_KEYS.SUBJECTS, '[]')

    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    await expect(result.current.tags.update(404, { name: 'missing' })).rejects.toThrow('Tag not found')
    await expect(result.current.tags.create({ name: '   ' })).rejects.toThrow('Tag name is required')
    await expect(result.current.tags.update(1, { name: '   ' })).rejects.toThrow('Tag name is required')
  })

  it('creates, updates, completes, skips, and deletes tasks in browser fallback storage', async () => {
    mocks.isElectron = false
    seedEmptyBrowserStorage()
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    let createdTask: Awaited<ReturnType<typeof result.current.tasks.create>> | undefined
    await act(async () => {
      createdTask = await result.current.tasks.create({
        title: 'Review today mistakes',
        description: 'Risk pool first',
        type: 'review',
        planned_date: '2026-05-31',
        estimate_minutes: 30,
        related_mistake_id: 42,
        source: 'dashboard',
      })
    })

    expect(createdTask).toEqual(expect.objectContaining({
      id: 1,
      title: 'Review today mistakes',
      description: 'Risk pool first',
      type: 'review',
      planned_date: '2026-05-31',
      estimate_minutes: 30,
      related_mistake_id: 42,
      status: 'todo',
      source: 'dashboard',
      created_at: expect.any(String),
      updated_at: expect.any(String),
    }))

    await act(async () => {
      await result.current.tasks.update(1, { status: 'doing', estimate_minutes: 20 })
    })
    await expect(result.current.tasks.find({
      planned_date: '2026-05-31',
      type: 'review',
      status: ['todo', 'doing'],
      related_mistake_id: 42,
      related_entry_id: null,
    })).resolves.toEqual([
      expect.objectContaining({ id: 1, status: 'doing', related_mistake_id: 42 }),
    ])
    await expect(result.current.tasks.complete(1)).resolves.toEqual(expect.objectContaining({ status: 'done' }))
    await expect(result.current.tasks.skip(1)).resolves.toEqual(expect.objectContaining({ status: 'skipped' }))
    await expect(result.current.tasks.getByDate('2026-05-31')).resolves.toEqual([
      expect.objectContaining({ id: 1, status: 'skipped', estimate_minutes: 20 }),
    ])

    await act(async () => {
      await result.current.tasks.delete(1)
    })

    await expect(result.current.tasks.getByDate('2026-05-31')).resolves.toEqual([])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.TASKS) || '[]')).toEqual([])
  })

  it('starts fallback task focus, stores pomodoro task_id, and clears it when the task is deleted', async () => {
    mocks.isElectron = false
    seedEmptyBrowserStorage()
    localStorage.setItem(STORAGE_KEYS.SUBJECTS, JSON.stringify([
      { id: 1, name: 'Math', color: '#0F766E' },
    ]))
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    const task = await result.current.tasks.create({
      title: 'Finish algebra',
      planned_date: '2026-05-31',
      subject_id: 1,
      estimate_minutes: 25,
    })

    await expect(result.current.tasks.startFocus(task.id, '2026-05-31')).resolves.toEqual(expect.objectContaining({
      id: task.id,
      status: 'doing',
    }))
    await result.current.pomodoro.addSession({
      subject_id: 1,
      task_id: task.id,
      duration: 25,
      date_key: '2026-05-31',
      started_at: '2026-05-31 09:00:00',
      completed_at: '2026-05-31 09:25:00',
    })

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.POMODORO_SESSIONS) || '[]')).toEqual([
      expect.objectContaining({ task_id: task.id, subject_id: 1, duration: 25 }),
    ])
    await expect(result.current.todayDashboard.getData('2026-05-31')).resolves.toEqual(expect.objectContaining({
      taskFocusToday: expect.objectContaining({
        effectiveTaskCount: 1,
        focusedTaskCount: 1,
        focusCoverageRate: 100,
        focusedMinutes: 25,
        focusedOpenTaskCount: 1,
        unclosedTaskTitles: ['Finish algebra'],
      }),
    }))

    await result.current.tasks.delete(task.id)

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.POMODORO_SESSIONS) || '[]')).toEqual([
      expect.objectContaining({ task_id: null }),
    ])
    await expect(result.current.todayDashboard.getData('2026-05-31')).resolves.toEqual(expect.objectContaining({
      taskFocusToday: expect.objectContaining({
        effectiveTaskCount: 0,
        focusedMinutes: 0,
      }),
    }))
  })

  it('keeps fallback todo tasks in the unclosed dashboard metrics even without focus', async () => {
    mocks.isElectron = false
    seedEmptyBrowserStorage()
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    await result.current.tasks.create({
      title: 'Read algebra notes',
      planned_date: '2026-05-31',
      estimate_minutes: 25,
    })

    await expect(result.current.todayDashboard.getData('2026-05-31')).resolves.toEqual(expect.objectContaining({
      taskFocusToday: expect.objectContaining({
        effectiveTaskCount: 1,
        completedTaskCount: 0,
        completionRate: 0,
        focusedTaskCount: 0,
        focusCoverageRate: 0,
        openWithoutFocusCount: 1,
        focusedOpenTaskCount: 0,
        unclosedTaskTitles: ['Read algebra notes'],
      }),
    }))
  })

  it('rejects fallback focus start for missing, completed, skipped, or non-today tasks', async () => {
    mocks.isElectron = false
    seedEmptyBrowserStorage()
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    const doneTask = await result.current.tasks.create({
      title: 'Done task',
      planned_date: '2026-05-31',
      status: 'done',
    })
    const skippedTask = await result.current.tasks.create({
      title: 'Skipped task',
      planned_date: '2026-05-31',
      status: 'skipped',
    })
    const tomorrowTask = await result.current.tasks.create({
      title: 'Tomorrow task',
      planned_date: '2026-06-01',
    })

    await expect(result.current.tasks.startFocus(999, '2026-05-31')).rejects.toThrow('Task not found')
    await expect(result.current.tasks.startFocus(doneTask.id, '2026-05-31')).rejects.toThrow('Cannot start focus for a completed or skipped task')
    await expect(result.current.tasks.startFocus(skippedTask.id, '2026-05-31')).rejects.toThrow('Cannot start focus for a completed or skipped task')
    await expect(result.current.tasks.startFocus(tomorrowTask.id, '2026-05-31')).rejects.toThrow('Task is not planned for this date')
  })

  it('rejects invalid browser fallback task writes before persisting', async () => {
    mocks.isElectron = false
    seedEmptyBrowserStorage()
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    await expect(result.current.tasks.create({
      title: '   ',
      planned_date: '2026-05-31',
    })).rejects.toThrow('Task title is required')
    await expect(result.current.tasks.create({
      title: 'Bad date',
      planned_date: '2026/05/31',
    })).rejects.toThrow('planned_date must be YYYY-MM-DD')
    await expect(result.current.tasks.create({
      title: 'Bad type',
      planned_date: '2026-05-31',
      type: 'quiz' as never,
    })).rejects.toThrow('Invalid task type')
    await expect(result.current.tasks.create({
      title: 'Bad status',
      planned_date: '2026-05-31',
      status: 'archived' as never,
    })).rejects.toThrow('Invalid task status')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.TASKS) || '[]')).toEqual([])
  })

  it('recovers from malformed browser fallback task storage', async () => {
    mocks.isElectron = false
    localStorage.setItem(STORAGE_KEYS.ENTRIES, '[]')
    localStorage.setItem(STORAGE_KEYS.TAGS, '[]')
    localStorage.setItem(STORAGE_KEYS.MISTAKES, '[]')
    localStorage.setItem(STORAGE_KEYS.SUBJECTS, '[]')
    localStorage.setItem(STORAGE_KEYS.TASKS, '{bad json')

    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    expect(result.current.initErrors.some(message => message.includes(STORAGE_KEYS.TASKS))).toBe(true)
    await expect(result.current.tasks.getByDate('2026-05-31')).resolves.toEqual([])
    expect(localStorage.getItem(STORAGE_KEYS.TASKS)).toBe(JSON.stringify([]))
  })

  it('resolves entry tags by entry id in browser fallback batch', async () => {
    mocks.isElectron = false
    const tags = mockTags.slice(0, 2)
    localStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify([
      { ...mockEntries[0]!, id: 11, tags: [tags[1]!.id] },
      { ...mockEntries[1]!, id: 12, tags: [tags[0]!.id, tags[1]!.id] },
    ]))
    localStorage.setItem(STORAGE_KEYS.TAGS, JSON.stringify(tags))
    localStorage.setItem(STORAGE_KEYS.MISTAKES, '[]')
    localStorage.setItem(STORAGE_KEYS.SUBJECTS, '[]')

    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    const tagsByEntry = await result.current.tags.getEntryTagsBatch([11, 12, 13, 11, 0, -2, 1.5])

    expect(tagsByEntry).toEqual({
      11: [{ ...tags[1], icon: '', variant: 'soft', pattern: 'none' }],
      12: tags.map(tag => ({ ...tag, icon: '', variant: 'soft', pattern: 'none' })),
      13: [],
    })
  })

  it('rejects unsupported browser fallback attachment writes', async () => {
    mocks.isElectron = false
    seedEmptyBrowserStorage()
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    await expect(result.current.attachments.save(11, {
      name: 'a.png',
      data: 'base64',
      mimetype: 'image/png',
    })).rejects.toMatchObject({
      name: 'UnsupportedError',
      message: '浏览器端目前不支持附件存储，请使用 Electron 客户端体验完整功能。',
    })
  })

  it('rejects unsupported browser fallback attachment deletes', async () => {
    mocks.isElectron = false
    seedEmptyBrowserStorage()
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    await expect(result.current.attachments.delete(11)).rejects.toMatchObject({
      name: 'UnsupportedError',
      message: '浏览器端目前不支持附件存储，请使用 Electron 客户端体验完整功能。',
    })
  })

  it('returns empty attachment arrays for valid entry ids in browser fallback batch', async () => {
    mocks.isElectron = false
    seedEmptyBrowserStorage()
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    await expect(result.current.attachments.getByEntries([11, 12, 11, 0, -1, 2.5])).resolves.toEqual({
      11: [],
      12: [],
    })
  })

  it('returns unsupported AI status in browser fallback chat', async () => {
    mocks.isElectron = false
    seedEmptyBrowserStorage()
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    await expect(result.current.ai.chat([
      { role: 'user', content: 'hello' },
    ])).resolves.toEqual({
      error: '浏览器端目前不支持直接调用 AI 接口，请使用 Electron 客户端体验完整功能。',
      unsupported: true,
    })
    expect(window.api.ai.chat).not.toHaveBeenCalled()
  })

  it('rejects invalid Electron AI chat requests before calling preload', async () => {
    mocks.isElectron = true
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    const response = await result.current.ai.chat([
      { role: 'system', content: 'system only' },
    ])

    expect(response.error).toContain('AI 请求消息格式异常')
    expect(window.api.ai.chat).not.toHaveBeenCalled()
  })

  it('creates, updates, and reads mistake answer images in browser fallback storage', async () => {
    mocks.isElectron = false
    localStorage.setItem(STORAGE_KEYS.ENTRIES, '[]')
    localStorage.setItem(STORAGE_KEYS.TAGS, '[]')
    localStorage.setItem(STORAGE_KEYS.MISTAKES, JSON.stringify([
      {
        id: 20,
        subject_id: null,
        question: 'Legacy',
        answer: '',
        notes: '',
        mastered: false,
        ease_factor: 2.5,
        review_interval: 1,
        next_review_date: null,
        review_count: 0,
        image_path: 'mistake_images/legacy-question.png',
        created_at: '2026-06-01T00:00:00.000Z',
      },
    ]))
    localStorage.setItem(STORAGE_KEYS.SUBJECTS, '[]')
    localStorage.setItem(STORAGE_KEYS.TASKS, '[]')
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    let createdMistake: Mistake | undefined
    await act(async () => {
      createdMistake = await result.current.mistakes.create({
        question: 'A',
        image_path: 'mistake_images/question.png',
        answer_image_path: 'mistake_images/answer.png',
      })
    })

    expect(createdMistake).toEqual(expect.objectContaining({
      id: 21,
      question: 'A',
      image_path: 'mistake_images/question.png',
      answer_image_path: 'mistake_images/answer.png',
      mastered: false,
      created_at: expect.any(String),
    }))

    await act(async () => {
      await result.current.mistakes.update(21, { answer_image_path: 'mistake_images/answer-updated.png' })
      await result.current.mistakes.toggleMastered(21)
    })

    const mistakes = await result.current.mistakes.getAll()

    expect(mistakes.data).toHaveLength(2)
    expect(mistakes.data.find(mistake => mistake.id === 20)).toEqual(expect.objectContaining({
      id: 20,
      image_path: 'mistake_images/legacy-question.png',
      answer_image_path: null,
    }))
    expect(mistakes.data.find(mistake => mistake.id === 21)).toEqual(expect.objectContaining({
      id: 21,
      question: 'A',
      answer_image_path: 'mistake_images/answer-updated.png',
      mastered: true,
    }))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.MISTAKES) || '[]')).toEqual([
      expect.objectContaining({ id: 20, question: 'Legacy' }),
      expect.objectContaining({
        id: 21,
        question: 'A',
        image_path: 'mistake_images/question.png',
        answer_image_path: 'mistake_images/answer-updated.png',
        mastered: true,
      }),
    ])
  })

  it('reviews mistakes with a verifiable result and clears task links on browser fallback delete', async () => {
    mocks.isElectron = false
    const mistake: Mistake = {
      id: 31,
      subject_id: null,
      question: 'Question',
      answer: 'Answer',
      notes: '',
      mastered: false,
      ease_factor: 2.5,
      review_interval: 1,
      next_review_date: null,
      review_count: 0,
      image_path: null,
      answer_image_path: null,
      created_at: '2026-05-31T00:00:00.000Z',
    }
    const linkedTask: StudyTask = {
      id: 9,
      title: 'Linked review',
      description: '',
      type: 'review',
      subject_id: null,
      related_mistake_id: 31,
      related_entry_id: null,
      planned_date: '2026-05-31',
      estimate_minutes: 10,
      status: 'done',
      source: 'manual',
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    }
    localStorage.setItem(STORAGE_KEYS.ENTRIES, '[]')
    localStorage.setItem(STORAGE_KEYS.TAGS, '[]')
    localStorage.setItem(STORAGE_KEYS.MISTAKES, JSON.stringify([mistake]))
    localStorage.setItem(STORAGE_KEYS.SUBJECTS, '[]')
    localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify([linkedTask]))
    localStorage.setItem(STORAGE_KEYS.POMODORO_SESSIONS, '[]')
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    await expect(result.current.mistakes.review(999, {
      ease_factor: 2.3,
      review_interval: 3,
      next_review_date: '2026-06-03',
      review_count: 1,
    })).rejects.toThrow('Mistake not found')

    await expect(result.current.mistakes.review(31, {
      ease_factor: 2.3,
      review_interval: 3,
      next_review_date: '2026-06-03',
      review_count: 1,
    })).resolves.toEqual({
      success: true,
      mistake: expect.objectContaining({
        id: 31,
        ease_factor: 2.3,
        review_interval: 3,
        next_review_date: '2026-06-03',
        review_count: 1,
      }),
    })

    await result.current.mistakes.delete(31)

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.TASKS) || '[]')).toEqual([
      expect.objectContaining({ id: 9, related_mistake_id: null, status: 'done' }),
    ])
  })
})
