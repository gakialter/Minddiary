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
    expect(tagA).toHaveClass('focus-visible:ring-2')
    expect(tagA).toHaveClass('focus-visible:ring-accent')
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

describe('Editor format toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tagsGetAll.mockResolvedValue([])
    mocks.getDailyTotal.mockResolvedValue(0)
    mocks.templatesGetAll.mockResolvedValue([])
    mocks.aiChat.mockResolvedValue({ content: '' })
  })

  it('renders the format toolbar with bold, highlight, underline, and color buttons', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Editor entry={entry} onSave={onSave} loading={false} />)

    await waitFor(() => {
      expect(screen.getByTestId('format-toolbar')).toBeInTheDocument()
    })
    expect(screen.getByTestId('format-bold')).toBeInTheDocument()
    expect(screen.getByTestId('format-highlight')).toBeInTheDocument()
    expect(screen.getByTestId('format-underline')).toBeInTheDocument()
    expect(screen.getByTestId('format-color')).toBeInTheDocument()
  })

  it('displays updated Markdown hint text with highlight, underline, and color syntax', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Editor entry={entry} onSave={onSave} loading={false} />)

    await waitFor(() => {
      expect(screen.getByText(/==高亮==/)).toBeInTheDocument()
    })
    expect(screen.getByText(/\+\+下划线\+\+/)).toBeInTheDocument()
    expect(screen.getByText(/\{color:red\}颜色\{\/color\}/)).toBeInTheDocument()
  })
})

describe('Editor focus reflection insertion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tagsGetAll.mockResolvedValue([])
    mocks.getDailyTotal.mockResolvedValue(0)
    mocks.templatesGetAll.mockResolvedValue([])
    mocks.aiChat.mockResolvedValue({ content: '' })
  })

  it('appends a pending focus reflection draft once', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onApplied = vi.fn()
    const pendingInsert = {
      id: 1,
      content: '## Focus Reflection\n- Subject: Math\n- Next step:',
    }

    const { rerender } = render(
      <Editor
        entry={entry}
        onSave={onSave}
        loading={false}
        pendingInsert={pendingInsert}
        onPendingInsertApplied={onApplied}
      />,
    )

    const contentInput = await screen.findByTestId('diary-content-input')
    await waitFor(() => {
      expect((contentInput as HTMLTextAreaElement).value).toContain('## Focus Reflection')
    })
    expect((contentInput as HTMLTextAreaElement).value).toContain('Entry body')
    expect(onApplied).toHaveBeenCalledWith(1)

    rerender(
      <Editor
        entry={entry}
        onSave={onSave}
        loading={false}
        pendingInsert={pendingInsert}
        onPendingInsertApplied={onApplied}
      />,
    )

    expect(String((contentInput as HTMLTextAreaElement).value).match(/## Focus Reflection/g)).toHaveLength(1)
  })
})

