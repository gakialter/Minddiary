import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockEntries, mockMistakes, mockSubjects, mockTags, STORAGE_KEYS } from '../src/data/mockData'
import type { AIMessage, Attachment, DiaryEntry, DiaryTemplate, Mistake } from '../src/types'
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
  pomodoro: {
    addSession: vi.fn().mockResolvedValue({ id: 1 }),
    getStats: vi.fn().mockResolvedValue([]),
    getStatsRange: vi.fn().mockResolvedValue([]),
    getDailyTotal: vi.fn().mockResolvedValue(0),
    getRange: vi.fn().mockResolvedValue([]),
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
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.ENTRIES, JSON.stringify(mockEntries))
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.TAGS, JSON.stringify(mockTags))
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.MISTAKES, JSON.stringify(mockMistakes))
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.SUBJECTS, JSON.stringify(mockSubjects))
  })

  it('passes core API calls through to Electron window.api namespaces', async () => {
    mocks.isElectron = true
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    const message: AIMessage = { role: 'user', content: 'hello' }
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
      await result.current.pomodoro.getStats('2026-05-05')
      await result.current.pomodoro.getStatsRange('2026-05-01', '2026-05-05')
      await result.current.dashboard.streak()
      await result.current.todayDashboard.getData('2026-05-05')
      await result.current.exportUtil.showSaveDialog({ defaultPath: 'export.md' })
      await result.current.notification.show('title', 'body')
      chatResult = await result.current.ai.chat([message])
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
    expect(window.api.pomodoro.getStats).toHaveBeenCalledWith('2026-05-05')
    expect(window.api.pomodoro.getStatsRange).toHaveBeenCalledWith('2026-05-01', '2026-05-05')
    expect(window.api.dashboard.streak).toHaveBeenCalledTimes(1)
    expect(window.api.todayDashboard.getData).toHaveBeenCalledWith('2026-05-05')
    expect(window.api.export.showSaveDialog).toHaveBeenCalledWith({ defaultPath: 'export.md' })
    expect(window.api.notification.show).toHaveBeenCalledWith('title', 'body')
    expect(window.api.ai.chat).toHaveBeenCalledWith([message])
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
      word_count: 'created content'.length,
      images: [],
      created_at: expect.any(String),
      updated_at: expect.any(String),
    }))
    expect(allEntries).toHaveLength(1)
    expect(allEntries[0]).toEqual(createdEntry)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ENTRIES) || '[]')).toEqual([createdEntry])
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
  })

  it('creates mistakes in browser fallback storage and toggles mastered state', async () => {
    mocks.isElectron = false
    seedEmptyBrowserStorage()
    const { result } = renderDataHook()

    await waitFor(() => {
      expect(result.current.dataReady).toBe(true)
    })

    let createdMistake: Mistake | undefined
    await act(async () => {
      createdMistake = await result.current.mistakes.create({ question: 'A' })
    })

    expect(createdMistake).toEqual(expect.objectContaining({
      id: 1,
      question: 'A',
      mastered: false,
      created_at: expect.any(String),
    }))

    await act(async () => {
      await result.current.mistakes.toggleMastered(1)
    })

    const mistakes = await result.current.mistakes.getAll()

    expect(mistakes.data).toHaveLength(1)
    expect(mistakes.data[0]).toEqual(expect.objectContaining({
      id: 1,
      question: 'A',
      mastered: true,
    }))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.MISTAKES) || '[]')[0]).toEqual(
      expect.objectContaining({ id: 1, question: 'A', mastered: true }),
    )
  })
})
