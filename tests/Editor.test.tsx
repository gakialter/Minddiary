import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Editor from '../src/components/Editor'
import type { DiaryEntry, Tag } from '../src/types'

const tags: Tag[] = [
  { id: 1, name: 'Tag A', color: '#0F766E', icon: '🌿', variant: 'solid', pattern: 'dots' },
  { id: 2, name: 'Tag B', color: '#C65A3A', icon: '☆', variant: 'outline', pattern: 'grid' },
]

const mocks = vi.hoisted(() => ({
  tagsGetAll: vi.fn(),
  getDailyTotal: vi.fn(),
  templatesGetAll: vi.fn(),
  aiChat: vi.fn(),
}))

vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: () => ({
    tags: {
      getAll: mocks.tagsGetAll,
    },
    pomodoro: {
      getDailyTotal: mocks.getDailyTotal,
    },
    templates: {
      getAll: mocks.templatesGetAll,
    },
    ai: {
      chat: mocks.aiChat,
    },
  }),
}))

vi.mock('../src/components/Toast', () => ({
  showToast: vi.fn(),
}))

vi.mock('../src/components/TemplateManager', () => ({
  default: () => null,
}))

const entry: DiaryEntry = {
  id: 9,
  date: '2026-05-12',
  title: 'Entry title',
  content: 'Entry body',
  mood: null,
  tags: [1],
  word_count: 10,
  images: [],
  created_at: '2026-05-12T00:00:00.000Z',
  updated_at: '2026-05-12T00:00:00.000Z',
}

describe('Editor tag selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tagsGetAll.mockResolvedValue(tags)
    mocks.getDailyTotal.mockResolvedValue(0)
    mocks.templatesGetAll.mockResolvedValue([])
    mocks.aiChat.mockResolvedValue({ content: '' })
  })

  it('saves selected tag ids after selecting and removing tags', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(<Editor entry={entry} onSave={onSave} loading={false} />)

    const tagA = await screen.findByRole('button', { name: /Tag A/ })
    const tagB = await screen.findByRole('button', { name: /Tag B/ })

    expect(tagA).toHaveAttribute('aria-pressed', 'true')
    expect(tagB).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('tag-badge-1')).toHaveTextContent('🌿')
    expect(screen.getByTestId('tag-badge-2')).toHaveTextContent('☆')

    fireEvent.click(tagB)
    fireEvent.click(tagA)

    await waitFor(() => {
      expect(tagA).toHaveAttribute('aria-pressed', 'false')
      expect(tagB).toHaveAttribute('aria-pressed', 'true')
    })

    fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true })

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        title: 'Entry title',
        content: 'Entry body',
        tags: [2],
      })
    })
  })
})
