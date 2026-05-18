import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SearchPanel from '../src/components/SearchPanel'
import type { Attachment, DiaryEntry, Tag } from '../src/types'

const mocks = vi.hoisted(() => ({
  entriesGetAll: vi.fn(),
  entriesSearch: vi.fn(),
  entriesDelete: vi.fn(),
  tagsGetAll: vi.fn(),
  tagsGetEntryTags: vi.fn(),
  attachmentsGetByEntry: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: () => ({
    entries: {
      getAll: mocks.entriesGetAll,
      search: mocks.entriesSearch,
      delete: mocks.entriesDelete,
    },
    tags: {
      getAll: mocks.tagsGetAll,
      getEntryTags: mocks.tagsGetEntryTags,
    },
    attachments: {
      getByEntry: mocks.attachmentsGetByEntry,
    },
  }),
}))

vi.mock('../src/components/Toast', () => ({
  showToast: mocks.showToast,
}))

const tag: Tag = { id: 1, name: '数学', color: '#0F766E' }

const makeEntry = (overrides: Partial<DiaryEntry>): DiaryEntry => ({
  id: 1,
  date: '2026-05-18',
  title: '',
  content: '',
  mood: null,
  word_count: 0,
  tags: [],
  images: [],
  created_at: '2026-05-18T00:00:00.000Z',
  updated_at: '2026-05-18T00:00:00.000Z',
  ...overrides,
})

const imageAttachment: Attachment = {
  id: 9,
  entry_id: 4,
  filename: 'diary.png',
  filepath: '4_1779000000000.png',
  mimetype: 'image/png',
  created_at: '2026-05-18T00:00:00.000Z',
}

describe('SearchPanel diary results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.tagsGetAll.mockResolvedValue([tag])
    mocks.entriesDelete.mockResolvedValue(true)
    mocks.tagsGetEntryTags.mockImplementation((entryId: number) => Promise.resolve(entryId === 3 ? [tag] : []))
    mocks.attachmentsGetByEntry.mockImplementation((entryId: number) => Promise.resolve(entryId === 4 ? [imageAttachment] : []))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('filters blank diary entries while keeping text, tagged, and image entries', async () => {
    mocks.entriesGetAll.mockResolvedValue([
      makeEntry({ id: 1, date: '2026-05-18', content: '<p>&nbsp;</p>\n###' }),
      makeEntry({ id: 2, date: '2026-05-17', title: '有效日记', content: '今天做完了真题' }),
      makeEntry({ id: 3, date: '2026-05-16' }),
      makeEntry({ id: 4, date: '2026-05-15' }),
    ])

    render(<SearchPanel />)

    expect(await screen.findByTestId('search-result-2')).toBeInTheDocument()
    expect(screen.getByTestId('search-result-3')).toBeInTheDocument()
    expect(screen.getByTestId('search-result-4')).toBeInTheDocument()
    expect(screen.queryByTestId('search-result-1')).not.toBeInTheDocument()
  })

  it('opens image previews from search results and closes them', async () => {
    mocks.entriesGetAll.mockResolvedValue([
      makeEntry({ id: 4, date: '2026-05-15' }),
    ])

    render(<SearchPanel />)

    const result = await screen.findByTestId('search-result-4')
    fireEvent.click(within(result).getByRole('button', { name: /放大查看日记图片 diary\.png/ }))

    const dialog = await screen.findByRole('dialog', { name: '图片预览' })
    expect(within(dialog).getByAltText('diary.png')).toHaveAttribute('src', 'local://attachments/4_1779000000000.png')

    fireEvent.click(screen.getByRole('button', { name: '关闭图片预览' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument()
    })
  })

  it('does not delete a diary result when confirmation is cancelled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    mocks.entriesGetAll.mockResolvedValue([
      makeEntry({ id: 2, date: '2026-05-17', title: '可删除日记', content: '内容' }),
    ])

    const onSelectEntry = vi.fn()
    render(<SearchPanel onSelectEntry={onSelectEntry} />)

    const result = await screen.findByTestId('search-result-2')
    fireEvent.click(within(result).getByRole('button', { name: '删除日记 可删除日记' }))

    expect(window.confirm).toHaveBeenCalledWith('确认删除这篇日记吗？此操作不可恢复。')
    expect(mocks.entriesDelete).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalledWith('日记已删除', 'success')
    expect(onSelectEntry).not.toHaveBeenCalled()
    expect(screen.getByTestId('search-result-2')).toBeInTheDocument()
  })

  it('deletes a diary result after confirmation without selecting it', async () => {
    mocks.entriesGetAll.mockResolvedValue([
      makeEntry({ id: 2, date: '2026-05-17', title: '可删除日记', content: '内容' }),
    ])

    const onSelectEntry = vi.fn()
    render(<SearchPanel onSelectEntry={onSelectEntry} />)

    const result = await screen.findByTestId('search-result-2')
    fireEvent.click(within(result).getByRole('button', { name: '删除日记 可删除日记' }))

    expect(window.confirm).toHaveBeenCalledWith('确认删除这篇日记吗？此操作不可恢复。')
    await waitFor(() => {
      expect(mocks.entriesDelete).toHaveBeenCalledWith(2)
    })
    expect(mocks.showToast).toHaveBeenCalledWith('日记已删除', 'success')
    expect(onSelectEntry).not.toHaveBeenCalled()
    expect(screen.queryByTestId('search-result-2')).not.toBeInTheDocument()
  })

  it('shows an error toast when confirmed diary deletion fails', async () => {
    mocks.entriesGetAll.mockResolvedValue([
      makeEntry({ id: 2, date: '2026-05-17', title: '可删除日记', content: '内容' }),
    ])
    mocks.entriesDelete.mockRejectedValue(new Error('delete failed'))

    render(<SearchPanel />)

    const result = await screen.findByTestId('search-result-2')
    fireEvent.click(within(result).getByRole('button', { name: '删除日记 可删除日记' }))

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith('删除日记失败', 'error')
    })
    expect(screen.getByTestId('search-result-2')).toBeInTheDocument()
  })

  it('keeps the newest search results when an older recent-load request finishes later', async () => {
    let resolveRecentTags: ((tags: Tag[]) => void) | undefined
    let resolveSearchTags: ((tags: Tag[]) => void) | undefined

    mocks.entriesGetAll.mockResolvedValue([
      makeEntry({ id: 1, date: '2026-05-18', title: '最近日记', content: '旧结果' }),
    ])
    mocks.entriesSearch.mockResolvedValue([
      makeEntry({ id: 2, date: '2026-05-17', title: '搜索日记', content: '新结果' }),
    ])
    mocks.tagsGetEntryTags.mockImplementation((entryId: number) => {
      if (entryId === 1) {
        return new Promise<Tag[]>(resolve => {
          resolveRecentTags = resolve
        })
      }
      if (entryId === 2) {
        return new Promise<Tag[]>(resolve => {
          resolveSearchTags = resolve
        })
      }
      return Promise.resolve([])
    })
    mocks.attachmentsGetByEntry.mockResolvedValue([])

    render(<SearchPanel />)

    const searchInput = screen.getByPlaceholderText('搜索日记内容或标题...')
    fireEvent.change(searchInput, { target: { value: '搜索' } })
    fireEvent.keyDown(searchInput, { key: 'Enter' })

    await waitFor(() => {
      expect(mocks.entriesSearch).toHaveBeenCalledWith('搜索')
    })

    await act(async () => {
      resolveSearchTags?.([])
    })
    expect(await screen.findByTestId('search-result-2')).toBeInTheDocument()

    await act(async () => {
      resolveRecentTags?.([])
    })

    await waitFor(() => {
      expect(screen.getByTestId('search-result-2')).toBeInTheDocument()
      expect(screen.queryByTestId('search-result-1')).not.toBeInTheDocument()
    })
  })
})
