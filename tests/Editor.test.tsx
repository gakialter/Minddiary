import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Editor from '../src/components/Editor'
import type { AIMessage, AIResponse, DiaryEntry, Tag } from '../src/types'

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

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

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

describe('Editor AI summary request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tagsGetAll.mockResolvedValue([])
    mocks.getDailyTotal.mockResolvedValue(0)
    mocks.templatesGetAll.mockResolvedValue([])
    mocks.aiChat.mockResolvedValue({ content: 'summary result' })
  })

  it('sends the existing system plus user summary request shape', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Editor entry={entry} onSave={onSave} loading={false} />)

    fireEvent.click(screen.getByRole('button', { name: /AI/ }))

    await waitFor(() => {
      expect(mocks.aiChat).toHaveBeenCalledTimes(1)
    })

    const payload = mocks.aiChat.mock.calls[0]?.[0] as AIMessage[]
    expect(payload).toHaveLength(2)
    expect(payload[0]?.role).toBe('system')
    expect(payload[1]?.role).toBe('user')
    expect(payload[1]?.content).toContain('Entry body')
  })

  it('keeps a late older summary from overwriting a newer content summary', async () => {
    const firstRequest = createDeferred<AIResponse>()
    const secondRequest = createDeferred<AIResponse>()
    mocks.aiChat
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise)
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Editor entry={entry} onSave={onSave} loading={false} />)

    fireEvent.click(screen.getByRole('button', { name: /AI/ }))
    await waitFor(() => {
      expect(mocks.aiChat).toHaveBeenCalledTimes(1)
    })

    const contentInput = screen.getByTestId('diary-content-input')
    fireEvent.change(contentInput, { target: { value: 'Updated body' } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /AI/ })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /AI/ }))
    await waitFor(() => {
      expect(mocks.aiChat).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      secondRequest.resolve({ content: 'new summary wins' })
      await secondRequest.promise
    })
    expect(screen.getByText('new summary wins')).toBeInTheDocument()

    await act(async () => {
      firstRequest.resolve({ content: 'old stale summary' })
      await firstRequest.promise
    })
    expect(screen.queryByText('old stale summary')).not.toBeInTheDocument()
  })

  it('does not reopen the summary card after it is closed while loading', async () => {
    const request = createDeferred<AIResponse>()
    mocks.aiChat.mockReturnValueOnce(request.promise)
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Editor entry={entry} onSave={onSave} loading={false} />)

    fireEvent.click(screen.getByRole('button', { name: /AI/ }))
    await waitFor(() => {
      expect(mocks.aiChat).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close AI summary' }))

    await act(async () => {
      request.resolve({ content: 'closed stale summary' })
      await request.promise
    })

    expect(screen.queryByText('closed stale summary')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AI/ })).not.toBeDisabled()
  })

  it('ignores summary responses that arrive after unmount', async () => {
    const request = createDeferred<AIResponse>()
    mocks.aiChat.mockReturnValueOnce(request.promise)
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { unmount } = render(<Editor entry={entry} onSave={onSave} loading={false} />)

    fireEvent.click(screen.getByRole('button', { name: /AI/ }))
    await waitFor(() => {
      expect(mocks.aiChat).toHaveBeenCalledTimes(1)
    })

    unmount()

    await act(async () => {
      request.resolve({ content: 'late unmounted summary' })
      await request.promise
    })

    expect(screen.queryByText('late unmounted summary')).not.toBeInTheDocument()
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

