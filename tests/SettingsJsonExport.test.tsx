import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from '../src/components/Settings'
import { useDiary } from '../src/contexts/DiaryContext'
import { showToast } from '../src/components/Toast'
import type { DiaryContextValue } from '../src/types/api'

vi.mock('../src/contexts/DiaryContext', () => ({ useDiary: vi.fn() }))
vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }))
vi.mock('../src/utils/logger', () => ({ logger: { error: vi.fn() } }))

describe('Settings JSON export', () => {
  let api: ReturnType<typeof makeApi>
  let createObjectURL: ReturnType<typeof vi.fn>
  let anchorClick: ReturnType<typeof vi.spyOn>
  let exportedBlob: Blob | undefined
  let container: HTMLElement

  function makeApi() {
    return {
      theme: 'system', changeTheme: vi.fn(), requestDataRefresh: vi.fn(),
      settings: {
        getAll: vi.fn().mockResolvedValue({ aiApiKeyPresent: false }),
        updateGeneral: vi.fn(), updateAI: vi.fn(), updateBackup: vi.fn(),
        selectBackupFile: vi.fn().mockResolvedValue(null),
        restoreBackupFromZip: vi.fn().mockResolvedValue({ success: true }),
      },
      entries: { getAll: vi.fn().mockResolvedValue([{ id: 4, date: '2026-10-09', content: '合成日记' }]) },
      tags: { getAll: vi.fn().mockResolvedValue([{ id: 5, name: '合成标签' }]) },
      subjects: { getAll: vi.fn().mockResolvedValue([{ id: 6, name: '合成科目' }]) },
      mistakes: { getAll: vi.fn().mockResolvedValue({ data: [{ id: 7, question: '合成错题' }], total: 1 }) },
      pomodoro: { getRange: vi.fn().mockResolvedValue([{ id: 8, duration: 25 }]) },
      subjectChapters: { getBySubject: vi.fn().mockResolvedValue([]) },
    }
  }

  beforeEach(async () => {
    api = makeApi()
    exportedBlob = undefined
    vi.mocked(useDiary).mockReturnValue(api as unknown as DiaryContextValue)
    createObjectURL = vi.fn((blob: Blob) => {
      exportedBlob = blob
      return 'blob:synthetic-settings-export'
    })
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    let rendered!: ReturnType<typeof render>
    await act(async () => { rendered = render(<Settings />) })
    container = rendered.container
    vi.mocked(showToast).mockClear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  async function exportJson() {
    fireEvent.click(screen.getByRole('button', { name: '导出为 JSON' }))
  }

  async function waitForIdle() {
    await waitFor(() => expect(container.querySelector('.settings-page')).toHaveAttribute('aria-busy', 'false'))
  }

  it('keeps the Settings envelope, unwraps paginated mistakes, and removes the API key', async () => {
    api.settings.getAll.mockResolvedValue({ aiApiKey: 'synthetic-secret', aiApiKeyPresent: true, aiEndpoint: 'https://synthetic.invalid' })
    await exportJson()

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('导出成功', 'success'))
    expect(api.entries.getAll).toHaveBeenCalledWith({ includeContent: true })
    expect(api.tags.getAll).toHaveBeenCalledOnce()
    expect(api.subjects.getAll).toHaveBeenCalledOnce()
    expect(api.mistakes.getAll).toHaveBeenCalledWith({})
    expect(api.pomodoro.getRange).toHaveBeenCalledWith('1970-01-01', '2099-12-31')
    expect(api.settings.getAll).toHaveBeenCalledOnce()
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(anchorClick).toHaveBeenCalledOnce()

    const backup = JSON.parse(await exportedBlob!.text())
    expect(Object.keys(backup).sort()).toEqual(['data', 'timestamp', 'version'])
    expect(backup.timestamp).toEqual(expect.any(String))
    expect(Number.isNaN(Date.parse(backup.timestamp))).toBe(false)
    expect(Object.keys(backup.data).sort()).toEqual(['entries', 'mistakes', 'pomodoro', 'settings', 'subjects', 'tags'])
    expect(backup.data).toMatchObject({
      entries: [{ id: 4, date: '2026-10-09', content: '合成日记' }],
      tags: [{ id: 5, name: '合成标签' }],
      subjects: [{ id: 6, name: '合成科目' }],
      mistakes: [{ id: 7, question: '合成错题' }],
      pomodoro: [{ id: 8, duration: 25 }],
      settings: { aiApiKeyPresent: true, aiEndpoint: 'https://synthetic.invalid' },
    })
    expect(JSON.stringify(backup)).not.toContain('synthetic-secret')
    await waitForIdle()
  })

  it.each([
    ['entries', () => api.entries.getAll],
    ['tags', () => api.tags.getAll],
    ['subjects', () => api.subjects.getAll],
    ['mistakes', () => api.mistakes.getAll],
    ['pomodoro', () => api.pomodoro.getRange],
    ['settings', () => api.settings.getAll],
  ])('reports %s read failure and allows a later manual export', async (_source, getReader) => {
    const reader = getReader()
    reader.mockRejectedValueOnce(new Error('synthetic read failure'))

    await exportJson()
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('导出失败: synthetic read failure', 'error'))
    await waitForIdle()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(anchorClick).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalledWith('导出成功', 'success')

    vi.mocked(showToast).mockClear()
    await exportJson()
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('导出成功', 'success'))
    await waitForIdle()
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(anchorClick).toHaveBeenCalledOnce()
    expect(JSON.parse(await exportedBlob!.text()).data.mistakes).toEqual([{ id: 7, question: '合成错题' }])
  })
})
