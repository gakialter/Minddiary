import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Editor from '../src/components/Editor'
import type { AIMessage, AIResponse, DiaryEntry, Tag } from '../src/types'

// jsdom has no layout; browser QA covers real selection geometry.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

const writingView = () => EditorView.findFromDOM(screen.getByTestId('diary-content-input'))!
const changeContent = (value: string) => act(() => { const view = writingView(); view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, userEvent: 'input.type' }) })

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
      expect(onSave).toHaveBeenCalledWith(
        {
          title: 'Entry title',
          content: 'Entry body',
          tags: [2],
        },
        { origin: 'editor-manual' },
      )
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

  it('exposes stable names for the diary title and writing canvas', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Editor entry={entry} onSave={onSave} loading={false} />)

    expect(await screen.findByRole('textbox', { name: '日记标题' })).toHaveValue('Entry title')
    expect(screen.getByRole('textbox', { name: '日记正文' })).toHaveTextContent('Entry body')
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

  it('exposes the generated AI summary through a native disclosure control', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Editor entry={entry} onSave={onSave} loading={false} />)

    fireEvent.click(screen.getByRole('button', { name: /AI 汇总/ }))
    const disclosure = await screen.findByRole('button', { name: 'AI 辅助摘要' })
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(disclosure).toHaveAccessibleDescription('由模型生成 · 仅供参考')
    expect(screen.getByText('summary result')).toBeInTheDocument()

    fireEvent.click(disclosure)

    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('summary result')).not.toBeInTheDocument()
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

    changeContent('Updated body')
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

    fireEvent.click(screen.getByRole('button', { name: '关闭 AI 摘要' }))

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

describe('Editor dirty tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tagsGetAll.mockResolvedValue(tags)
    mocks.getDailyTotal.mockResolvedValue(0)
    mocks.templatesGetAll.mockResolvedValue([])
    mocks.aiChat.mockResolvedValue({ content: '' })
  })

  it('reports clean only after a successful save', async () => {
    const onSave = vi.fn().mockResolvedValue(entry)
    const onDirtyChange = vi.fn()
    render(<Editor entry={entry} onSave={onSave} loading={false} onDirtyChange={onDirtyChange} />)

    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenCalledWith(false)
    })

    changeContent('Changed body')
    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    })

    fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true })

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        {
          title: 'Entry title',
          content: 'Changed body',
          tags: [1],
        },
        { origin: 'editor-manual' },
      )
      expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    })
  })

  it('keeps dirty state when save resolves null', async () => {
    const onSave = vi.fn().mockResolvedValue(null)
    const onDirtyChange = vi.fn()
    render(<Editor entry={entry} onSave={onSave} loading={false} onDirtyChange={onDirtyChange} />)

    changeContent('Unsaved body')
    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    })

    fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true })

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
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

    await waitFor(() => {
      expect(writingView().state.doc.toString()).toContain('## Focus Reflection')
    })
    expect(writingView().state.doc.toString()).toContain('Entry body')
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

    expect(String(writingView().state.doc.toString()).match(/## Focus Reflection/g)).toHaveLength(1)
  })
})

describe('Editor live preview contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tagsGetAll.mockResolvedValue([])
    mocks.getDailyTotal.mockResolvedValue(0)
    mocks.templatesGetAll.mockResolvedValue([])
    mocks.aiChat.mockResolvedValue({ content: 'summary' })
  })
  afterEach(() => vi.useRealTimers())

  it('preserves selection, active state, keyboard formatting and one-step undo', async () => {
    render(<Editor entry={entry} onSave={vi.fn()} loading={false} />)
    await screen.findByRole('button', { name: '加粗' })
    const view = writingView()
    act(() => { view.focus(); view.dispatch({ selection: { anchor: 0, head: 5 } }) })
    fireEvent.mouseDown(screen.getByRole('button', { name: '加粗' }), { button: 0 })
    expect(view.state.doc.toString()).toBe('**Entry** body')
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('Entry')
    expect(view.hasFocus).toBe(true)
    expect(screen.getByRole('button', { name: '加粗' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(view.contentDOM, { key: 'b', code: 'KeyB', ctrlKey: true })
    expect(view.state.doc.toString()).toBe('Entry body')
    fireEvent.keyDown(view.contentDOM, { key: 'u', code: 'KeyU', ctrlKey: true })
    expect(view.state.doc.toString()).toBe('++Entry++ body')
    fireEvent.keyDown(view.contentDOM, { key: 'z', code: 'KeyZ', ctrlKey: true })
    expect(view.state.doc.toString()).toBe('Entry body')
    act(() => { view.dispatch({ selection: { anchor: view.state.doc.length } }); view.dispatch(view.state.replaceSelection(' 后续输入')) })
    expect(view.state.doc.toString()).toBe('Entry body 后续输入')
  })

  it('autosaves canonical markers after two seconds and updates word count', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Editor entry={entry} onSave={onSave} loading={false} />)
    await act(async () => {})
    vi.useFakeTimers()
    const view = writingView()
    act(() => view.dispatch({ selection: { anchor: 0, head: 5 } }))
    fireEvent.click(screen.getByRole('button', { name: '加粗' }))
    await act(async () => { vi.advanceTimersByTime(1999) })
    expect(onSave).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(onSave).toHaveBeenCalledWith({ title: entry.title, content: '**Entry** body', tags: [1] }, { origin: 'editor-auto' })
    expect(screen.getByLabelText('日记字数 13')).toBeInTheDocument()
  })

  it('switches entries with fresh selection/history and does not save the previous draft into the new entry', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onDirtyChange = vi.fn()
    const { rerender } = render(<Editor entry={entry} onSave={onSave} loading={false} onDirtyChange={onDirtyChange} />)
    await act(async () => {})
    vi.useFakeTimers()
    changeContent('Unsent old draft')
    const oldView = writingView()
    const next = { ...entry, id: 10, date: '2026-05-13', content: 'New entry content' }
    rerender(<Editor entry={next} onSave={onSave} loading={false} onDirtyChange={onDirtyChange} />)
    expect(writingView()).not.toBe(oldView)
    expect(writingView().state.doc.toString()).toBe(next.content)
    expect(writingView().state.selection.main.anchor).toBe(0)
    act(() => { expect(undo(writingView())).toBe(false) })
    await act(async () => { vi.advanceTimersByTime(2100) })
    expect(onSave).not.toHaveBeenCalled()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('keeps cursor and undo when the first save assigns a new diary id', async () => {
    const initial = { ...entry, id: 0, content: '' }
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(<Editor entry={initial} onSave={onSave} loading={false} />)
    await act(async () => {})
    changeContent('第一篇日记')
    const view = writingView()
    act(() => view.dispatch({ selection: { anchor: 3 } }))
    rerender(<Editor entry={{ ...initial, id: 99, content: '第一篇日记' }} onSave={onSave} loading={false} />)
    expect(writingView()).toBe(view)
    expect(view.state.selection.main.anchor).toBe(3)
    act(() => { expect(undo(view)).toBe(true) })
    expect(view.state.doc.toString()).toBe('')
  })

  it('inserts a replacement template, updates count and sends its canonical text to AI', async () => {
    const template = '**复习** ++重点++'
    mocks.templatesGetAll.mockResolvedValue([{ id: 1, name: '复习模板', content: template }])
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Editor entry={entry} onSave={onSave} loading={false} />)
    fireEvent.click(await screen.findByRole('button', { name: '复习模板' }))
    expect(writingView().state.doc.toString()).toBe(template)
    expect(writingView().state.selection.main.anchor).toBe(template.length)
    expect(screen.getByLabelText('日记字数 12')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ content: template }), { origin: 'editor-manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI 汇总' }))
    await waitFor(() => expect(mocks.aiChat).toHaveBeenCalledTimes(1))
    expect((mocks.aiChat.mock.calls[0]?.[0] as AIMessage[])[1]?.content).toContain(template)
  })

  it('appends to the latest edited content, focuses the end, and autosaves it once', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const applied = vi.fn()
    const { rerender } = render(<Editor entry={entry} onSave={onSave} loading={false} />)
    await act(async () => {})
    vi.useFakeTimers()
    changeContent('当前 **正文**')
    rerender(<Editor entry={entry} onSave={onSave} loading={false} pendingInsert={{ id: 42, content: '++插入++' }} onPendingInsertApplied={applied} />)
    const expected = '当前 **正文**\n\n++插入++\n'
    expect(writingView().state.doc.toString()).toBe(expected)
    expect(writingView().state.selection.main.anchor).toBe(expected.length)
    expect(writingView().hasFocus).toBe(true)
    expect(applied).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ content: expected }), { origin: 'editor-auto' })
  })

  it('defers an external insert behind the composition gate and acknowledges only the applied transaction', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const applied = vi.fn()
    const { rerender } = render(<Editor entry={entry} onSave={onSave} loading={false} />)
    await act(async () => {})
    const view = writingView()
    // Gate unit test only: this is not a simulation of a native Chinese IME.
    const composing = vi.spyOn(view, 'compositionStarted', 'get').mockReturnValue(true)
    const pending = { id: 77, content: '外部插入', date: entry.date }
    rerender(<Editor entry={entry} onSave={onSave} loading={false} pendingInsert={pending} onPendingInsertApplied={applied} />)
    expect(view.state.doc.toString()).toBe(entry.content)
    expect(applied).not.toHaveBeenCalled()
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '中文' } }))
    composing.mockRestore()
    await waitFor(() => expect(applied).toHaveBeenCalledWith(77))
    expect(writingView()).toBe(view)
    expect(view.state.doc.toString()).toBe('Entry body中文\n\n外部插入\n')
  })

  it('cancels a deferred insert on entry switching without consuming its pending request', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const applied = vi.fn()
    const pending = { id: 78, content: '原日记插入', date: entry.date }
    const { rerender } = render(<Editor entry={entry} onSave={onSave} loading={false} />)
    await act(async () => {})
    const composing = vi.spyOn(writingView(), 'compositionStarted', 'get').mockReturnValue(true)
    rerender(<Editor entry={entry} onSave={onSave} loading={false} pendingInsert={pending} onPendingInsertApplied={applied} />)
    rerender(<Editor entry={{ ...entry, id: 10, date: '2026-05-13', content: '另一篇' }} onSave={onSave} loading={false} pendingInsert={pending} onPendingInsertApplied={applied} />)
    composing.mockRestore()
    expect(writingView().state.doc.toString()).toBe('另一篇')
    expect(applied).not.toHaveBeenCalled()
    rerender(<Editor entry={entry} onSave={onSave} loading={false} pendingInsert={pending} onPendingInsertApplied={applied} />)
    await waitFor(() => expect(applied).toHaveBeenCalledTimes(1))
    expect(writingView().state.doc.toString()).toBe('Entry body\n\n原日记插入\n')
  })
})


describe('Editor AI selection polish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tagsGetAll.mockResolvedValue([])
    mocks.getDailyTotal.mockResolvedValue(0)
    mocks.templatesGetAll.mockResolvedValue([])
    mocks.aiChat.mockResolvedValue({ content: 'Polished' })
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
  async function openPolish(action = '润色表达') {
    const view = writingView()
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 100, right: 180, top: 220, bottom: 240 })
    vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 160, 600, 400))
    act(() => { view.focus(); view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('Entry'), head: view.state.doc.toString().indexOf('Entry') + 5 } }) })
    const ai = await screen.findByRole('button', { name: 'AI 润色' })
    fireEvent.mouseDown(ai, { button: 0 })
    fireEvent.click(ai)
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('Entry')
    fireEvent.mouseDown(screen.getByRole('button', { name: action }), { button: 0 })
    fireEvent.click(screen.getByRole('button', { name: action }))
  }
  it('keeps candidate separate, applies once, publishes dirty/autosave canonical text and undoes once', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined), dirty = vi.fn()
    const formattedEntry = { ...entry, content: '**Entry** body' }
    render(<Editor entry={formattedEntry} onSave={onSave} onDirtyChange={dirty} loading={false} />)
    await openPolish()
    await screen.findByText('Polished')
    expect(mocks.aiChat.mock.calls[0]![0][1]).toEqual({ role: 'user', content: 'Entry' })
    expect(writingView().state.doc.toString()).toBe(formattedEntry.content)
    expect(dirty).toHaveBeenLastCalledWith(false)
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(writingView().state.doc.toString()).toBe('**Polished** body')
    expect(dirty).toHaveBeenLastCalledWith(true)
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ content: '**Polished** body' }), { origin: 'editor-auto' })
    act(() => { expect(undo(writingView())).toBe(true) })
    expect(writingView().state.doc.toString()).toBe(formattedEntry.content)
  })
  it.each(['target', 'outside', 'selection'])('invalidates pending result after %s change', async kind => {
    const pending = createDeferred<AIResponse>()
    mocks.aiChat.mockReturnValue(pending.promise)
    render(<Editor entry={entry} onSave={vi.fn()} loading={false} />)
    await openPolish()
    act(() => writingView().dispatch(kind === 'selection' ? { selection: { anchor: 8 } } : { changes: { from: kind === 'target' ? 1 : 9, insert: 'x' } }))
    await act(async () => pending.resolve({ content: 'Old candidate' }))
    expect(screen.getByRole('alert')).toHaveTextContent('原文或选区已发生变化')
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled()
    expect(screen.queryByText('Old candidate')).toBeNull()
  })
  it('regenerates original source and ignores out-of-order responses', async () => {
    const first = createDeferred<AIResponse>(), second = createDeferred<AIResponse>()
    mocks.aiChat.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<Editor entry={entry} onSave={vi.fn()} loading={false} />)
    await openPolish()
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    expect(mocks.aiChat.mock.calls[1]![0]).toEqual(mocks.aiChat.mock.calls[0]![0])
    await act(async () => second.resolve({ content: 'Newest' }))
    await act(async () => first.resolve({ content: 'Old' }))
    expect(screen.getByText('Newest')).toBeInTheDocument()
    expect(screen.queryByText('Old')).toBeNull()
  })
  it('a newer action wins and a pending composition cannot apply', async () => {
    const first = createDeferred<AIResponse>(), second = createDeferred<AIResponse>()
    mocks.aiChat.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<Editor entry={entry} onSave={vi.fn()} loading={false} />)
    await openPolish()
    await openPolish('精简')
    await act(async () => second.resolve({ content: 'Newest' }))
    await act(async () => first.resolve({ content: 'Old' }))
    expect(screen.getByText('Newest')).toBeInTheDocument()
    expect(screen.queryByText('Old')).toBeNull()
    expect(mocks.aiChat.mock.calls[1]![0][0].content).toContain('删除冗余')
    vi.spyOn(writingView(), 'compositionStarted', 'get').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(writingView().state.doc.toString()).toBe(entry.content)
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled()
  })
  it('keeps network errors local', async () => {
    mocks.aiChat.mockRejectedValue(new Error('网络连接失败'))
    render(<Editor entry={entry} onSave={vi.fn()} loading={false} />)
    await openPolish()
    expect(await screen.findByRole('alert')).toHaveTextContent('网络连接失败')
    expect(writingView().state.doc.toString()).toBe(entry.content)
  })
  it.each(['close', 'switch', 'unmount'])('ignores pending result on %s', async kind => {
    const pending = createDeferred<AIResponse>()
    mocks.aiChat.mockReturnValue(pending.promise)
    const mounted = render(<Editor entry={entry} onSave={vi.fn()} loading={false} />)
    await openPolish()
    if (kind === 'close') fireEvent.click(screen.getByRole('button', { name: '放弃' }))
    if (kind === 'switch') mounted.rerender(<Editor entry={{ ...entry, id: 10, date: '2026-05-13', content: 'Other diary' }} onSave={vi.fn()} loading={false} />)
    if (kind === 'unmount') mounted.unmount()
    await act(async () => pending.resolve({ content: 'Old' }))
    expect(screen.queryByRole('dialog', { name: 'AI 润色候选' })).toBeNull()
    if (kind === 'switch') expect(writingView().state.doc.toString()).toBe('Other diary')
  })
  it.each([{ content: '' }, { content: '**bad**' }, { error: '未配置 AI' }, null])('shows local errors without edits: %j', async response => {
    mocks.aiChat.mockResolvedValue(response)
    render(<Editor entry={entry} onSave={vi.fn()} loading={false} />)
    await openPolish()
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled()
    expect(writingView().state.doc.toString()).toBe(entry.content)
    fireEvent.click(screen.getByRole('button', { name: '放弃' }))
    changeContent('继续写作')
    expect(writingView().state.doc.toString()).toBe('继续写作')
  })
})
