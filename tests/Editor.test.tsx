import { EditorView } from '@codemirror/view'
import { redo, undo } from '@codemirror/commands'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
        expect.objectContaining({ origin: 'editor-manual' }),
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
        expect.objectContaining({ origin: 'editor-manual' }),
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

  it('ignores a same-diary saved prop echo while a newer draft is dirty', async () => {
    const pending = createDeferred<unknown>()
    const onSave = vi.fn().mockReturnValue(pending.promise)
    const dirty = vi.fn()
    const mounted = render(<Editor entry={entry} onSave={onSave} onDirtyChange={dirty} loading={false} />)
    changeContent('Revision A')
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    changeContent('Revision B')
    const staleEntry = { ...entry, content: 'Revision A' }
    mounted.rerender(<Editor entry={staleEntry} onSave={onSave} onDirtyChange={dirty} loading={false} />)
    await act(async () => pending.resolve(staleEntry))
    expect(writingView().state.doc.toString()).toBe('Revision B')
    expect(dirty).toHaveBeenLastCalledWith(true)
    act(() => { expect(undo(writingView())).toBe(true) })
    // Consecutive typing keeps its existing history grouping across the receipt.
    expect(writingView().state.doc.toString()).toBe(entry.content)
    act(() => { expect(redo(writingView())).toBe(true) })
    expect(writingView().state.doc.toString()).toBe('Revision B')
  })

  it.each(['title', 'tags'])('keeps newer %s edits dirty when an earlier save succeeds', async field => {
    const pending = createDeferred<unknown>()
    const onSave = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(entry)
    const dirty = vi.fn()
    render(<Editor entry={entry} onSave={onSave} onDirtyChange={dirty} loading={false} />)
    await screen.findByRole('button', { name: /Tag B/ })
    changeContent('Revision A')
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    if (field === 'title') fireEvent.change(screen.getByRole('textbox', { name: '日记标题' }), { target: { value: 'New title' } })
    else fireEvent.click(screen.getByRole('button', { name: /Tag B/ }))
    await act(async () => pending.resolve(entry))
    expect(dirty).toHaveBeenLastCalledWith(true)
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false))
    expect(onSave.mock.calls[1]![0]).toEqual({
      title: field === 'title' ? 'New title' : entry.title,
      content: 'Revision A', tags: field === 'tags' ? [1, 2] : [1],
    })
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

  it('projects a structure template without dirtying it, then autosaves canonical list continuation', async () => {
    const content = '## 今日学了什么\n-\n## 薄弱点 / 疑问\n-'
    const onSave = vi.fn().mockResolvedValue(undefined), onDirtyChange = vi.fn()
    render(<Editor entry={{ ...entry, content }} onSave={onSave} loading={false} onDirtyChange={onDirtyChange} />)
    await act(async () => {})
    vi.useFakeTimers()
    const view = writingView()
    expect(view.contentDOM.textContent).toBe('今日学了什么•薄弱点 / 疑问•')
    expect(view.state.doc.toString()).toBe(content)
    await act(async () => { vi.advanceTimersByTime(2100) })
    expect(onSave).not.toHaveBeenCalled()
    expect(onDirtyChange).not.toHaveBeenCalledWith(true)
    act(() => {
      view.focus()
      view.dispatch({ selection: { anchor: view.state.doc.length } })
      view.dispatch({ ...view.state.replaceSelection(' 第一项'), userEvent: 'input.type' })
      fireEvent.keyDown(view.contentDOM, { key: 'Enter', code: 'Enter' })
      view.dispatch({ ...view.state.replaceSelection('第二项'), userEvent: 'input.type' })
    })
    const expected = content + ' 第一项\n- 第二项'
    expect(view.state.doc.toString()).toBe(expected)
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ content: expected }), expect.objectContaining({ origin: 'editor-auto' }))
  })

  it('refreshes structure projection on external sync without saving or adding history', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(<Editor entry={entry} onSave={onSave} loading={false} />)
    await act(async () => {})
    const view = writingView()
    rerender(<Editor entry={{ ...entry, content: '## 更新\n- {color:green}复习{/color}' }} onSave={onSave} loading={false} />)
    expect(writingView()).toBe(view)
    expect(view.state.doc.toString()).toBe('## 更新\n- {color:green}复习{/color}')
    expect(view.contentDOM.textContent).toBe('更新•复习')
    act(() => { expect(undo(view)).toBe(false) })
    vi.useFakeTimers()
    await act(async () => { vi.advanceTimersByTime(2100) })
    expect(onSave).not.toHaveBeenCalled()
  })

  it.each([
    ['cross', '**ab** ==cd==', 3, 10, '**a** ==d==', 8],
    ['leading', '**ab**', 2, 2, ' **ab**', 3],
    ['trailing', '**ab**', 4, 4, '**ab** ', 7],
  ] as const)('uses the production dispatch checkpoint for %s and persists only canonical text', async (_name, original, from, to, expected, caret) => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Editor entry={{ ...entry, content: original }} onSave={onSave} loading={false} />)
    await act(async () => {})
    const view = writingView()
    act(() => {
      view.dispatch({ selection: { anchor: from, head: to } })
      view.dispatch({ changes: { from, to, insert: ' ' }, selection: { anchor: from + 1 }, userEvent: 'input.type' })
    })
    expect(view.state.doc.toString()).toBe(expected)
    expect(view.state.selection.main).toMatchObject({ anchor: caret, head: caret })
    act(() => { expect(undo(view)).toBe(true) })
    expect(view.state.doc.toString()).toBe(original)
    act(() => { expect(redo(view)).toBe(true) })
    expect(view.state.doc.toString()).toBe(expected)
    expect(view.state.selection.main).toMatchObject({ anchor: caret, head: caret })
    vi.useFakeTimers()
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await act(async () => {})
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ content: expected }), expect.objectContaining({ origin: 'editor-manual' }))
  })

  it('keeps visual caret/selection navigation out of autosave and dirty state', async () => {
    const onSave = vi.fn(), onDirtyChange = vi.fn()
    render(<Editor entry={{ ...entry, content: '**=={color:green}重点{/color}==**' }}
      onSave={onSave} loading={false} onDirtyChange={onDirtyChange} />)
    await act(async () => {})
    vi.useFakeTimers()
    for (const selection of [{ anchor: 18 }, { anchor: 17, head: 19 }, { anchor: 19 }, { anchor: 1 }]) {
      act(() => writingView().dispatch({ selection }))
      expect(writingView().contentDOM.textContent).toBe('重点')
    }
    await act(async () => { vi.advanceTimersByTime(2100) })
    expect(onSave).not.toHaveBeenCalled()
    expect(onDirtyChange).not.toHaveBeenCalledWith(true)
    act(() => { expect(undo(writingView())).toBe(false) })
  })

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
    expect(onSave).toHaveBeenCalledWith({ title: entry.title, content: '**Entry** body', tags: [1] }, expect.objectContaining({ origin: 'editor-auto' }))
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
    expect(writingView().state.doc.toString()).toBe(entry.content)
    fireEvent.click(screen.getByRole('button', { name: '替换当前内容' }))
    expect(writingView().state.doc.toString()).toBe(template)
    expect(writingView().state.selection.main.anchor).toBe(template.length)
    expect(screen.getByLabelText('日记字数 12')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ content: template }), expect.objectContaining({ origin: 'editor-manual' })))
    fireEvent.click(screen.getByRole('button', { name: 'AI 汇总' }))
    await waitFor(() => expect(mocks.aiChat).toHaveBeenCalledTimes(1))
    expect((mocks.aiChat.mock.calls[0]?.[0] as AIMessage[])[1]?.content).toContain(template)
  })

  it('applies a template directly only to an empty diary', async () => {
    mocks.templatesGetAll.mockResolvedValue([{ id: 1, name: '模板', content: '## 复盘\n' }])
    render(<Editor entry={{ ...entry, content: '' }} onSave={vi.fn()} loading={false} />)
    fireEvent.click(await screen.findByRole('button', { name: '模板' }))
    expect(writingView().state.doc.toString()).toBe('## 复盘\n')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => { expect(undo(writingView())).toBe(true) })
    expect(writingView().state.doc.toString()).toBe('')
  })

  it('keeps content and selection untouched on cancel, then inserts without trimming with one-step undo/redo', async () => {
    const original = '## 原文\n保留内容  \n'
    mocks.templatesGetAll.mockResolvedValue([{ id: 1, name: '模板', content: '## 复盘\n- 下一步' }])
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Editor entry={{ ...entry, content: original }} onSave={onSave} loading={false} />)
    const button = await screen.findByRole('button', { name: '模板' })
    act(() => writingView().dispatch({ selection: { anchor: 3, head: 5 } }))
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: '插入模板' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(writingView().state.doc.toString()).toBe(original)
    expect(writingView().state.selection.main).toMatchObject({ anchor: 3, head: 5 })
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: '插入模板' }))
    const inserted = `${original}\n## 复盘\n- 下一步`
    expect(writingView().state.doc.toString()).toBe(inserted)
    act(() => { expect(undo(writingView())).toBe(true) })
    expect(writingView().state.doc.toString()).toBe(original)
    act(() => { expect(redo(writingView())).toBe(true) })
    expect(writingView().state.doc.toString()).toBe(inserted)
    vi.useFakeTimers()
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await act(async () => {})
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ content: inserted }), expect.objectContaining({ origin: 'editor-manual' }))
  })

  it('does not autosave a replacement while awaiting explicit choice and cancels it on date change', async () => {
    mocks.templatesGetAll.mockResolvedValue([{ id: 1, name: '模板', content: '新模板' }])
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(<Editor entry={entry} onSave={onSave} loading={false} />)
    const button = await screen.findByRole('button', { name: '模板' })
    vi.useFakeTimers()
    changeContent('未保存的原文')
    fireEvent.click(button)
    await act(async () => { vi.advanceTimersByTime(2100) })
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ content: '未保存的原文' }), expect.objectContaining({ origin: 'editor-auto' }))
    expect(writingView().state.doc.toString()).toBe('未保存的原文')
    fireEvent.click(screen.getByRole('button', { name: '替换当前内容' }))
    expect(writingView().state.doc.toString()).toBe('新模板')
    act(() => { expect(undo(writingView())).toBe(true) })
    expect(writingView().state.doc.toString()).toBe('未保存的原文')
    fireEvent.click(button)
    rerender(<Editor entry={{ ...entry, date: '2026-05-13', content: '其他日记' }} onSave={onSave} loading={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(writingView().state.doc.toString()).toBe('其他日记')
  })

  it('checks for non-empty text after composition before applying a template to an initially empty diary', async () => {
    mocks.templatesGetAll.mockResolvedValue([{ id: 1, name: '模板', content: '新模板' }])
    render(<Editor entry={{ ...entry, content: '' }} onSave={vi.fn()} loading={false} />)
    const button = await screen.findByRole('button', { name: '模板' })
    const view = writingView()
    const composing = vi.spyOn(view, 'compositionStarted', 'get').mockReturnValue(true)
    fireEvent.click(button)
    act(() => view.dispatch({ changes: { from: 0, insert: '输入中的原文' } }))
    composing.mockRestore()
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(view.state.doc.toString()).toBe('输入中的原文')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(view.state.doc.toString()).toBe('输入中的原文')
  })

  it('visibly explains a rejected mixed-format selection while leaving Markdown and undo history unchanged', async () => {
    const original = '**重点** 后续文字'
    render(<Editor entry={{ ...entry, content: original }} onSave={vi.fn()} loading={false} />)
    await act(async () => {})
    act(() => writingView().dispatch({ selection: { anchor: 3, head: original.length } }))
    fireEvent.click(screen.getByTestId('format-bold'))
    const notice = screen.getByText('这段文字包含不同格式，请缩小选区后再试。')
    expect(notice).toBeVisible()
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).not.toHaveClass('editor-visually-hidden')
    expect(writingView().state.doc.toString()).toBe(original)
    act(() => { expect(undo(writingView())).toBe(false) })
    act(() => writingView().dispatch({ selection: { anchor: 7, head: original.length } }))
    fireEvent.click(screen.getByTestId('format-bold'))
    expect(writingView().state.doc.toString()).toBe('**重点** **后续文字**')
    expect(screen.queryByText('这段文字包含不同格式，请缩小选区后再试。')).not.toBeInTheDocument()
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
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ content: expected }), expect.objectContaining({ origin: 'editor-auto' }))
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
  async function openPolish(action = '润色表达', source = 'Entry') {
    const view = writingView()
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 100, right: 180, top: 220, bottom: 240 })
    vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 160, 600, 400))
    act(() => { view.focus(); view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(source), head: view.state.doc.toString().indexOf(source) + source.length } }) })
    const ai = await screen.findByRole('button', { name: 'AI 润色' })
    fireEvent.mouseDown(ai, { button: 0 })
    fireEvent.click(ai)
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(source)
    fireEvent.mouseDown(screen.getByRole('button', { name: action }), { button: 0 })
    fireEvent.click(screen.getByRole('button', { name: action }))
  }
  it('keeps an applied candidate dirty when an older autosave completes, then saves it and preserves undo', async () => {
    const pending = createDeferred<unknown>()
    const onSave = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const dirty = vi.fn()
    render(<Editor entry={entry} onSave={onSave} onDirtyChange={dirty} loading={false} />)
    const original = '**Entry** body'
    vi.useFakeTimers()
    changeContent(original)
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(onSave.mock.calls[0]![0].content).toBe(original)
    vi.useRealTimers()

    await openPolish()
    const candidateInput = await screen.findByRole('textbox', { name: '候选文本' })
    fireEvent.change(candidateInput, { target: { value: 'Manually polished' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    const candidate = '**Manually polished** body'
    expect(writingView().state.doc.toString()).toBe(candidate)
    await act(async () => pending.resolve({ ...entry, content: original }))
    expect(writingView().state.doc.toString()).toBe(candidate)
    expect(dirty).toHaveBeenLastCalledWith(true)
    expect(document.querySelector('.editor-save-state')).toHaveAttribute('data-state', 'dirty')

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false))
    expect(onSave.mock.calls[1]![0].content).toBe(candidate)
    act(() => { expect(undo(writingView())).toBe(true) })
    expect(writingView().state.doc.toString()).toBe(original)
    expect(dirty).toHaveBeenLastCalledWith(true)
    act(() => { expect(redo(writingView())).toBe(true) })
    expect(writingView().state.doc.toString()).toBe(candidate)
  })
  it('keeps candidate separate, applies once, publishes dirty/autosave canonical text and undoes once', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined), dirty = vi.fn()
    const formattedEntry = { ...entry, content: '**Entry** body' }
    render(<Editor entry={formattedEntry} onSave={onSave} onDirtyChange={dirty} loading={false} />)
    await openPolish()
    expect(await screen.findByRole('textbox', { name: '候选文本' })).toHaveValue('Polished')
    expect(mocks.aiChat.mock.calls[0]![0][1]).toEqual({ role: 'user', content: 'Entry' })
    expect(writingView().state.doc.toString()).toBe(formattedEntry.content)
    expect(dirty).toHaveBeenLastCalledWith(false)
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(writingView().state.doc.toString()).toBe('**Polished** body')
    expect(dirty).toHaveBeenLastCalledWith(true)
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ content: '**Polished** body' }), expect.objectContaining({ origin: 'editor-auto' }))
    act(() => { expect(undo(writingView())).toBe(true) })
    expect(writingView().state.doc.toString()).toBe(formattedEntry.content)
  })
  it('applies the user-edited candidate only to the original selection and undoes in one step', async () => {
    const source = '今天感觉很好。'
    const original = `前文。 **${source}** 尾部。\n\n其他内容`
    mocks.aiChat.mockResolvedValue({ content: source })
    const dirty = vi.fn()
    render(<Editor entry={{ ...entry, content: original }} onSave={vi.fn()} onDirtyChange={dirty} loading={false} />)
    await openPolish('润色表达', source)
    const candidate = await screen.findByRole('textbox', { name: '候选文本' })
    fireEvent.change(candidate, { target: { value: '今天状态很好。' } })
    expect(writingView().state.doc.toString()).toBe(original)
    expect(dirty).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(writingView().state.doc.toString()).toBe('前文。 **今天状态很好。** 尾部。\n\n其他内容')
    expect(dirty).toHaveBeenLastCalledWith(true)
    act(() => { expect(undo(writingView())).toBe(true) })
    expect(writingView().state.doc.toString()).toBe(original)
  })
  it('discards an edited candidate without changing the diary or dirty state', async () => {
    const dirty = vi.fn()
    render(<Editor entry={entry} onSave={vi.fn()} onDirtyChange={dirty} loading={false} />)
    await openPolish()
    fireEvent.change(await screen.findByRole('textbox', { name: '候选文本' }), { target: { value: 'Discarded edit' } })
    fireEvent.click(screen.getByRole('button', { name: '放弃' }))
    expect(screen.queryByRole('dialog', { name: 'AI 润色候选' })).toBeNull()
    expect(writingView().state.doc.toString()).toBe(entry.content)
    expect(dirty).toHaveBeenLastCalledWith(false)
  })
  it.each(['', '   ', '第一段\n第二段', '**格式**', '字'.repeat(121)])('refuses invalid user-edited candidate %j without losing the editor', async value => {
    render(<Editor entry={entry} onSave={vi.fn()} loading={false} />)
    await openPolish()
    const candidate = await screen.findByRole('textbox', { name: '候选文本' })
    fireEvent.change(candidate, { target: { value } })
    expect(candidate).toHaveValue(value)
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(writingView().state.doc.toString()).toBe(entry.content)
    fireEvent.change(candidate, { target: { value: 'Valid edit' } })
    expect(screen.getByRole('button', { name: '应用' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(writingView().state.doc.toString()).toBe('Valid edit body')
  })
  it.each(['success', 'failure'])('retains the edited candidate during regenerate and handles %s', async outcome => {
    const regenerated = createDeferred<AIResponse>()
    mocks.aiChat.mockResolvedValueOnce({ content: 'Candidate A' }).mockReturnValueOnce(regenerated.promise)
    render(<Editor entry={entry} onSave={vi.fn()} loading={false} />)
    await openPolish()
    const candidate = await screen.findByRole('textbox', { name: '候选文本' })
    fireEvent.change(candidate, { target: { value: 'Edited A' } })
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    expect(candidate).toHaveValue('Edited A')
    expect(within(screen.getByRole('dialog', { name: 'AI 润色候选' })).getByRole('status')).toHaveTextContent('继续修改正文会取消本次结果')
    expect(mocks.aiChat.mock.calls[1]![0][1]).toEqual({ role: 'user', content: 'Entry' })
    // A user's edits made while waiting must also survive a failed request.
    fireEvent.change(candidate, { target: { value: 'Edited while waiting' } })
    await act(async () => {
      if (outcome === 'success') regenerated.resolve({ content: 'Candidate B' })
      else regenerated.reject(new Error('重新生成失败'))
    })
    expect(candidate).toHaveValue(outcome === 'success' ? 'Candidate B' : 'Edited while waiting')
    if (outcome === 'failure') expect(screen.getByRole('alert')).toHaveTextContent('重新生成失败')
    expect(screen.getByRole('button', { name: '应用' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(writingView().state.doc.toString()).toBe(`${outcome === 'success' ? 'Candidate B' : 'Edited while waiting'} body`)
  })
  it.each(['ready', 'pending'])('keeps a %s candidate through first-save identity promotion', async phase => {
    const initial = { ...entry, id: 0, content: '' }
    const savedEntry = { ...entry, id: 99 }
    const save = createDeferred<unknown>()
    const response = createDeferred<AIResponse>()
    const onSave = vi.fn().mockReturnValue(save.promise)
    mocks.aiChat.mockReturnValue(response.promise)
    const dirty = vi.fn()
    const mounted = render(<Editor entry={initial} onSave={onSave} onDirtyChange={dirty} loading={false} />)
    changeContent(entry.content)
    await openPolish()
    const view = writingView()
    if (phase === 'ready') await act(async () => response.resolve({ content: 'Polished' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled(), { timeout: 2500 })
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ content: entry.content }), expect.objectContaining({ origin: 'editor-auto' }))
    await act(async () => {
      mounted.rerender(<Editor entry={savedEntry} onSave={onSave} onDirtyChange={dirty} loading={false} />)
      save.resolve(savedEntry)
    })
    expect(writingView()).toBe(view)
    expect(screen.getByRole('dialog', { name: 'AI 润色候选' })).toBeInTheDocument()
    if (phase === 'pending') await act(async () => response.resolve({ content: 'Polished' }))
    const candidate = screen.getByRole('textbox', { name: '候选文本' })
    expect(candidate).toHaveValue('Polished')
    fireEvent.change(candidate, { target: { value: 'Edited after save' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(view.state.doc.toString()).toBe('Edited after save body')
    expect(dirty).toHaveBeenLastCalledWith(true)
  })
  it.each([
    { ...entry, id: 10 },
    { ...entry, id: 0 },
    { ...entry, id: 10, date: '2026-05-13' },
  ])('clears an existing candidate on a real entry switch to $date id $id, even with identical content', async next => {
    const onSave = vi.fn()
    const mounted = render(<Editor entry={entry} onSave={onSave} loading={false} />)
    await openPolish()
    await screen.findByRole('textbox', { name: '候选文本' })
    mounted.rerender(<Editor entry={next} onSave={onSave} loading={false} />)
    expect(screen.queryByRole('dialog', { name: 'AI 润色候选' })).toBeNull()
    expect(writingView().state.doc.toString()).toBe(next.content)
  })
  it.each([0, 100])('dismisses the promoted session when switching again to id %i with identical content', async id => {
    const onSave = vi.fn()
    const initial = { ...entry, id: 0 }
    const mounted = render(<Editor entry={initial} onSave={onSave} loading={false} />)
    await openPolish()
    await screen.findByRole('textbox', { name: '候选文本' })
    mounted.rerender(<Editor entry={{ ...initial, id: 99 }} onSave={onSave} loading={false} />)
    expect(screen.getByRole('textbox', { name: '候选文本' })).toHaveValue('Polished')
    mounted.rerender(<Editor entry={{ ...initial, id }} onSave={onSave} loading={false} />)
    expect(screen.queryByRole('dialog', { name: 'AI 润色候选' })).toBeNull()
    expect(writingView().state.doc.toString()).toBe(entry.content)
  })
  it('invalidates an edited candidate after body or IME changes', async () => {
    render(<Editor entry={entry} onSave={vi.fn()} loading={false} />)
    await openPolish()
    fireEvent.change(await screen.findByRole('textbox', { name: '候选文本' }), { target: { value: 'Edited candidate' } })
    fireEvent.compositionStart(screen.getByTestId('diary-content-input'))
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(writingView().state.doc.toString()).toBe(entry.content)
    fireEvent.compositionEnd(screen.getByTestId('diary-content-input'))
    changeContent('New body')
    expect(screen.getByRole('alert')).toHaveTextContent('原文或选区已发生变化')
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled()
    expect(writingView().state.doc.toString()).toBe('New body')
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
    expect(screen.getByRole('textbox', { name: '候选文本' })).toHaveValue('Newest')
  })
  it('a newer action wins and a pending composition cannot apply', async () => {
    const first = createDeferred<AIResponse>(), second = createDeferred<AIResponse>()
    mocks.aiChat.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<Editor entry={entry} onSave={vi.fn()} loading={false} />)
    await openPolish()
    await openPolish('精简')
    await act(async () => second.resolve({ content: 'Newest' }))
    await act(async () => first.resolve({ content: 'Old' }))
    expect(screen.getByRole('textbox', { name: '候选文本' })).toHaveValue('Newest')
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
