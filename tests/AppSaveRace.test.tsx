import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import type Editor from '../src/components/Editor'
import type { DiaryEntry, MoodId } from '../src/types'

// CodeMirror needs selection geometry; jsdom has no layout.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

const mocks = vi.hoisted(() => ({
  selectedDate: '2026-05-12',
  dirty: vi.fn(),
  navigation: vi.fn(),
  renderEntry: vi.fn(),
  renderSave: vi.fn(),
  renderEnsureId: vi.fn(),
  setSelectedDate: vi.fn(),
  dismissAlert: vi.fn(),
  entries: { getByDate: vi.fn(), create: vi.fn(), update: vi.fn() },
  tags: { getAll: vi.fn(), getEntryTags: vi.fn(), setEntryTags: vi.fn() },
  pomodoro: { getDailyTotal: vi.fn() },
  templates: { getAll: vi.fn() },
  tasks: { find: vi.fn(), update: vi.fn() },
  mistakes: { getRandomDue: vi.fn() },
  ai: { chat: vi.fn() },
  noop: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../src/contexts/DiaryContext', () => ({
  DiaryProvider: ({ children }: { children: ReactNode }) => children,
  useDiary: () => ({ ...mocks, isDarkMode: false, requestDataRefresh: mocks.noop }),
}))
vi.mock('../src/contexts/PomodoroContext', () => ({
  PomodoroProvider: ({ children }: { children: ReactNode }) => children,
  usePomodoroData: () => ({ alertState: { visible: false } }),
  usePomodoroActions: () => ({ setOnBreakStart: mocks.noop, dismissAlert: mocks.dismissAlert }),
}))
vi.mock('../src/hooks/useGlobalKeyboard', () => ({ useGlobalKeyboard: vi.fn() }))
vi.mock('../src/hooks/useNavigation', async () => {
  const { default: RealEditor } = await import('../src/components/Editor')
  const { useState } = await import('react')
  type RenderProps = {
    entry: DiaryEntry | null
    saveEntry: ComponentProps<typeof Editor>['onSave']
    loading: boolean
    onEditorDirtyChange?: (dirty: boolean) => void
    onRegisterEditorSave?: ComponentProps<typeof Editor>['onRegisterSave']
    ensureEntryId: () => Promise<number | null>
  }
  return {
    useNavigation: (options: { canAutoFollowToday: boolean }) => {
      const [activeView, setActiveView] = useState('editor')
      mocks.navigation(options)
      return {
        activeView, selectedDate: mocks.selectedDate, viewTitle: '写日记',
        setActiveView, setSelectedDate: mocks.setSelectedDate, changeDate: mocks.noop,
      }
    },
    VIEW_CONFIG: { editor: { title: '写日记', render: (props: RenderProps) => {
      mocks.renderEntry(props.entry)
      mocks.renderSave(props.saveEntry)
      mocks.renderEnsureId(props.ensureEntryId)
      return <RealEditor entry={props.entry} onSave={props.saveEntry} loading={props.loading}
        onRegisterSave={props.onRegisterEditorSave}
        onDirtyChange={dirty => { mocks.dirty(dirty); props.onEditorDirtyChange?.(dirty) }} />
    } }, search: { render: () => <div>Search view</div> }, calendar: { render: () => <div>Calendar view</div> } },
  }
})
vi.mock('../src/components/Layout', () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('../src/components/ErrorBoundary', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('../src/components/Sidebar', () => ({ default: ({ onViewChange }: { onViewChange: (view: string) => void }) => (
  <nav>
    <button onClick={() => onViewChange('search')}>Search nav</button>
    <button onClick={() => onViewChange('editor')}>Editor nav</button>
    <button onClick={() => onViewChange('calendar')}>Calendar nav</button>
  </nav>
) }))
vi.mock('../src/components/Countdown', () => ({ default: () => null }))
vi.mock('../src/components/MoodPicker', () => ({
  default: ({ mood, onChange }: { mood: MoodId | null; onChange: (mood: MoodId | null) => void }) => (
    <button onClick={() => onChange('happy')}>设置开心（{mood ?? '未设置'}）</button>
  ),
}))
vi.mock('../src/components/Pomodoro', () => ({ default: () => null }))
vi.mock('../src/components/ImageGallery', () => ({ default: () => null }))
vi.mock('../src/components/Welcome', () => ({ default: () => null }))
vi.mock('../src/components/CommandPalette', () => ({ default: () => null }))
vi.mock('../src/components/ExportModal', () => ({ default: () => null }))
vi.mock('../src/components/BreakReviewModal', () => ({ default: () => null }))
vi.mock('../src/components/PomodoroAlert', () => ({ default: ({ onWriteDiary, onClose }: { onWriteDiary: () => void; onClose: () => void }) => (
  <div><button onClick={onWriteDiary}>Focus diary</button><button onClick={onClose}>Close focus alert</button></div>
) }))
vi.mock('../src/components/TemplateManager', () => ({ default: () => null }))
vi.mock('../src/components/Toast', () => ({ showToast: mocks.showToast, ToastContainer: () => null }))

const original: DiaryEntry = {
  id: 9, date: '2026-05-12', title: 'Diary', content: 'Original body', mood: null,
  tags: [], images: [], word_count: 12,
  created_at: '2026-05-12T00:00:00.000Z', updated_at: '2026-05-12T00:00:00.000Z',
}
const saved = (content: string, overrides: Partial<DiaryEntry> = {}): DiaryEntry => ({ ...original, content, ...overrides })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const view = () => EditorView.findFromDOM(screen.getByTestId('diary-content-input'))!
const body = () => view().state.doc.toString()
const appEntry = () => mocks.renderEntry.mock.lastCall![0] as DiaryEntry
const edit = (content: string) => act(() => {
  const editor = view()
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content }, userEvent: 'input.type' })
})
const saveNow = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true })
const finish = async (pending: ReturnType<typeof deferred<DiaryEntry>>, entry: DiaryEntry) => {
  await act(async () => { pending.resolve(entry); await pending.promise })
}
const expectDirty = (dirty: boolean) => {
  expect(mocks.dirty).toHaveBeenLastCalledWith(dirty)
  expect(mocks.navigation).toHaveBeenLastCalledWith({ canAutoFollowToday: !dirty })
}
const mount = async (content = original.content) => {
  const result = render(<App />)
  await waitFor(() => expect(body()).toBe(content))
  return result
}

describe('App + Editor save acknowledgements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectedDate = original.date
    localStorage.clear()
    localStorage.setItem('started', 'true')
    mocks.entries.getByDate.mockReset().mockResolvedValue(original)
    mocks.entries.create.mockReset()
    mocks.entries.update.mockReset()
    mocks.tags.getAll.mockResolvedValue([])
    mocks.tags.getEntryTags.mockResolvedValue([])
    mocks.tags.setEntryTags.mockResolvedValue(undefined)
    mocks.pomodoro.getDailyTotal.mockResolvedValue(0)
    mocks.templates.getAll.mockResolvedValue([])
    mocks.tasks.find.mockResolvedValue([])
    mocks.ai.chat.mockResolvedValue({ content: 'Polished' })
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('persists a draft before navigation cancels its two-second autosave', async () => {
    const pending = deferred<DiaryEntry>()
    mocks.entries.update.mockReturnValue(pending.promise)
    await mount()
    edit('Draft before debounce')
    fireEvent.click(screen.getByRole('button', { name: 'Search nav' }))
    expect(mocks.entries.update).toHaveBeenCalledWith(9, { title: 'Diary', content: 'Draft before debounce' })
    expect(body()).toBe('Draft before debounce')
    expect(screen.queryByText('Search view')).not.toBeInTheDocument()
    await finish(pending, saved('Draft before debounce'))
    expect(screen.getByText('Search view')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Editor nav' }))
    await waitFor(() => expect(body()).toBe('Draft before debounce'))
  })

  it('keeps the editor and draft when saving for navigation fails, then allows retry', async () => {
    const pending = deferred<DiaryEntry>(), retry = deferred<DiaryEntry>()
    mocks.entries.update.mockReturnValueOnce(pending.promise).mockReturnValueOnce(retry.promise)
    await mount()
    edit('Keep on failure')
    fireEvent.click(screen.getByRole('button', { name: 'Search nav' }))
    await act(async () => { pending.reject(new Error('Disk unavailable')); await pending.promise.catch(() => {}) })
    expect(body()).toBe('Keep on failure')
    expectDirty(true)
    expect(screen.queryByText('Search view')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Search nav' }))
    await finish(retry, saved('Keep on failure'))
    expect(screen.getByText('Search view')).toBeInTheDocument()
  })

  it('keeps a newer draft when the navigation save acknowledges an older revision', async () => {
    const pending = deferred<DiaryEntry>()
    mocks.entries.update.mockReturnValue(pending.promise)
    await mount()
    edit('Revision A')
    fireEvent.click(screen.getByRole('button', { name: 'Search nav' }))
    edit('Revision B')
    await finish(pending, saved('Revision A'))
    expect(body()).toBe('Revision B')
    expectDirty(true)
    expect(screen.queryByText('Search view')).not.toBeInTheDocument()
  })

  it('joins a pending save for navigation and honors only the latest navigation request', async () => {
    const pending = deferred<DiaryEntry>()
    mocks.entries.update.mockReturnValue(pending.promise)
    await mount()
    edit('Already saving'); saveNow()
    fireEvent.click(screen.getByRole('button', { name: 'Search nav' }))
    fireEvent.click(screen.getByRole('button', { name: 'Calendar nav' }))
    vi.useFakeTimers()
    await act(async () => { vi.advanceTimersByTime(2000) })
    vi.useRealTimers()
    expect(mocks.entries.update).toHaveBeenCalledTimes(1)
    await finish(pending, saved('Already saving'))
    expect(screen.getByText('Calendar view')).toBeInTheDocument()
    expect(screen.queryByText('Search view')).not.toBeInTheDocument()
  })

  it('continues navigation through a newer manual save of the same draft', async () => {
    const automatic = deferred<DiaryEntry>(), manual = deferred<DiaryEntry>()
    mocks.entries.update.mockReturnValueOnce(automatic.promise).mockReturnValueOnce(manual.promise)
    await mount()
    edit('Same draft')
    fireEvent.click(screen.getByRole('button', { name: 'Search nav' }))
    saveNow()
    await finish(automatic, saved('Same draft'))
    expect(body()).toBe('Same draft')
    await finish(manual, saved('Same draft'))
    expect(screen.getByText('Search view')).toBeInTheDocument()
    expect(mocks.showToast).toHaveBeenCalledWith('已保存', 'success')
  })

  it('cancels a delayed focus diary action when the alert closes before saving finishes', async () => {
    const pending = deferred<DiaryEntry>()
    mocks.entries.update.mockReturnValue(pending.promise)
    await mount()
    edit('Preserve before focus reflection')
    fireEvent.click(screen.getByRole('button', { name: 'Focus diary' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close focus alert' }))
    await finish(pending, saved('Preserve before focus reflection'))
    expect(body()).toBe('Preserve before focus reflection')
    expect(mocks.setSelectedDate).not.toHaveBeenCalled()
    expect(mocks.dismissAlert).toHaveBeenCalledTimes(1)
  })

  it('waits for a first create before leaving without duplicating the new entry', async () => {
    mocks.entries.getByDate.mockResolvedValue(null)
    const pending = deferred<DiaryEntry>()
    mocks.entries.create.mockReturnValue(pending.promise)
    await mount('')
    edit('First draft'); saveNow()
    fireEvent.click(screen.getByRole('button', { name: 'Search nav' }))
    expect(mocks.entries.create).toHaveBeenCalledTimes(1)
    await finish(pending, saved('First draft', { id: 42, title: '' }))
    expect(screen.getByText('Search view')).toBeInTheDocument()
    expect(mocks.entries.update).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Editor nav' }))
    await waitFor(() => expect(body()).toBe('First draft'))
  })

  it('does not expose the old diary for editing while the newly selected date loads', async () => {
    const pending = deferred<DiaryEntry>()
    const mounted = await mount()
    mocks.entries.getByDate.mockReturnValue(pending.promise)
    mocks.selectedDate = '2026-05-13'
    mounted.rerender(<App />)
    expect(screen.queryByTestId('diary-content-input')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /设置开心/ })).not.toBeInTheDocument()
    saveNow()
    expect(mocks.entries.update).not.toHaveBeenCalled()
    await finish(pending, saved('Loaded date', { id: 10, date: mocks.selectedDate }))
    await waitFor(() => expect(body()).toBe('Loaded date'))
    edit('New date edited'); saveNow()
    expect(mocks.entries.update).toHaveBeenCalledWith(10, { title: 'Diary', content: 'New date edited' })
  })

  it('rejects a stale save callback both during and after loading a different date', async () => {
    const pending = deferred<DiaryEntry>()
    const mounted = await mount()
    const oldSave = mocks.renderSave.mock.lastCall![0] as ComponentProps<typeof Editor>['onSave']
    const draft = { title: 'Wrong date', content: 'Must not update old id', tags: [] }
    mocks.entries.getByDate.mockReturnValue(pending.promise)
    mocks.selectedDate = '2026-05-13'
    mounted.rerender(<App />)
    await expect(oldSave(draft)).resolves.toBeNull()
    await finish(pending, saved('Loaded date', { id: 10, date: mocks.selectedDate }))
    await expect(oldSave(draft)).resolves.toBeNull()
    expect(mocks.entries.create).not.toHaveBeenCalled()
    expect(mocks.entries.update).not.toHaveBeenCalled()
    expect(mocks.tags.setEntryTags).not.toHaveBeenCalled()
  })

  it.each(['image-first', 'editor-first'] as const)('shares the initial entry id across image upload and draft save when %s', async order => {
    mocks.entries.getByDate.mockResolvedValue(null)
    const creation = deferred<DiaryEntry>(), update = deferred<DiaryEntry>()
    mocks.entries.create.mockReturnValue(creation.promise)
    mocks.entries.update.mockReturnValue(update.promise)
    await mount('')
    const ensureId = mocks.renderEnsureId.mock.lastCall![0] as () => Promise<number | null>
    let imageEntryId!: Promise<number | null>
    if (order === 'image-first') {
      act(() => { imageEntryId = ensureId() })
      edit('Draft with image'); saveNow()
    } else {
      edit('Draft with image'); saveNow()
      act(() => { imageEntryId = ensureId() })
    }
    expect(mocks.entries.create).toHaveBeenCalledTimes(1)
    await finish(creation, saved(order === 'image-first' ? '' : 'Draft with image', { id: 42, title: '' }))
    await expect(imageEntryId).resolves.toBe(42)
    if (order === 'image-first') {
      expect(mocks.entries.update).toHaveBeenCalledWith(42, { title: '', content: 'Draft with image' })
      await finish(update, saved('Draft with image', { id: 42, title: '' }))
    } else {
      expect(mocks.entries.update).not.toHaveBeenCalled()
    }
    expect(appEntry()).toEqual(expect.objectContaining({ id: 42, content: 'Draft with image' }))
    expect(body()).toBe('Draft with image')
    expectDirty(false)
  })

  it('acknowledges the current revision as saved and clears App dirty state', async () => {
    const pending = deferred<DiaryEntry>()
    mocks.entries.update.mockReturnValue(pending.promise)
    await mount()
    edit('Revision A'); saveNow()
    expect(mocks.entries.update).toHaveBeenCalledWith(9, { title: 'Diary', content: 'Revision A' })
    await finish(pending, saved('Revision A'))
    expect(body()).toBe('Revision A')
    expect(appEntry().content).toBe('Revision A')
    expect(screen.getByText('已保存')).toBeInTheDocument()
    expectDirty(false)
  })

  it('keeps B dirty when the pending A save returns, then persists B with update', async () => {
    const a = deferred<DiaryEntry>(), b = deferred<DiaryEntry>()
    mocks.entries.update.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    await mount()
    edit('Revision A'); saveNow(); edit('Revision B')
    await finish(a, saved('Revision A'))
    expect(body()).toBe('Revision B')
    expect(appEntry().content).toBe(original.content)
    expectDirty(true)
    expect(screen.getByText('尚未保存')).toBeInTheDocument()
    saveNow()
    expect(mocks.entries.update).toHaveBeenNthCalledWith(2, 9, { title: 'Diary', content: 'Revision B' })
    await finish(b, saved('Revision B'))
    expect(body()).toBe('Revision B')
    expect(appEntry().content).toBe('Revision B')
    expect(screen.getByText('已保存')).toBeInTheDocument()
    expectDirty(false)
  })

  it('keeps the B acknowledgement when B returns before the older A request', async () => {
    const a = deferred<DiaryEntry>(), b = deferred<DiaryEntry>()
    mocks.entries.update.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    await mount()
    edit('Revision A'); saveNow(); edit('Revision B'); saveNow()
    await finish(b, saved('Revision B'))
    expectDirty(false)
    await finish(a, saved('Revision A'))
    expect(body()).toBe('Revision B')
    expect(appEntry().content).toBe('Revision B')
    expect(screen.getByText('已保存')).toBeInTheDocument()
    expectDirty(false)
  })

  it('does not overwrite a newly selected diary when the old diary save returns', async () => {
    const a = deferred<DiaryEntry>()
    mocks.entries.update.mockReturnValue(a.promise)
    const mounted = await mount()
    edit('Revision A'); saveNow()
    const next = saved('Other diary', { id: 10, date: '2026-05-13' })
    mocks.entries.getByDate.mockResolvedValue(next)
    mocks.selectedDate = next.date
    mounted.rerender(<App />)
    await waitFor(() => expect(body()).toBe('Other diary'))
    edit('Other diary edited')
    await finish(a, saved('Revision A'))
    expect(body()).toBe('Other diary edited')
    expect(appEntry()).toEqual(expect.objectContaining({ id: 10, date: next.date, content: 'Other diary' }))
    expect(screen.getByText(next.date, { selector: 'time' })).toHaveAttribute('dateTime', next.date)
    expectDirty(true)
  })

  it('retains the id from a stale first create and updates B without creating twice', async () => {
    mocks.entries.getByDate.mockResolvedValue(null)
    const a = deferred<DiaryEntry>(), b = deferred<DiaryEntry>()
    mocks.entries.create.mockReturnValue(a.promise)
    mocks.entries.update.mockReturnValue(b.promise)
    await mount('')
    edit('Revision A'); saveNow(); edit('Revision B')
    await finish(a, saved('Revision A', { id: 42, title: '' }))
    expect(body()).toBe('Revision B')
    expectDirty(true)
    saveNow()
    expect(mocks.entries.create).toHaveBeenCalledTimes(1)
    expect(mocks.entries.update).toHaveBeenCalledWith(42, { title: '', content: 'Revision B' })
    await finish(b, saved('Revision B', { id: 42, title: '' }))
    expect(body()).toBe('Revision B')
    expectDirty(false)
  })

  it('keeps the edited text dirty after persistence fails', async () => {
    const pending = deferred<DiaryEntry>()
    mocks.entries.update.mockReturnValue(pending.promise)
    await mount()
    edit('Revision A'); saveNow()
    await act(async () => { pending.reject(new Error('Persistence failed')); await pending.promise.catch(() => {}) })
    expect(body()).toBe('Revision A')
    expect(screen.getByText('尚未保存')).toBeInTheDocument()
    expectDirty(true)
  })

  it('shares a pending first create and saves B by updating the newly assigned id', async () => {
    mocks.entries.getByDate.mockResolvedValue(null)
    const a = deferred<DiaryEntry>(), b = deferred<DiaryEntry>()
    mocks.entries.create.mockReturnValue(a.promise)
    mocks.entries.update.mockReturnValue(b.promise)
    await mount('')
    edit('Revision A'); saveNow(); edit('Revision B'); saveNow()
    expect(mocks.entries.create).toHaveBeenCalledTimes(1)
    expect(mocks.entries.update).not.toHaveBeenCalled()
    await finish(a, saved('Revision A', { id: 42, title: '' }))
    expect(body()).toBe('Revision B')
    expectDirty(true)
    expect(mocks.entries.update).toHaveBeenCalledWith(42, { title: '', content: 'Revision B' })
    await finish(b, saved('Revision B', { id: 42, title: '' }))
    expect(mocks.entries.create).toHaveBeenCalledTimes(1)
    expect(body()).toBe('Revision B')
    expect(screen.getByText('已保存')).toBeInTheDocument()
    expectDirty(false)
  })

  it.each(['editor-first', 'mood-first'] as const)('merges mood without reverting saved B when acknowledgements are %s', async order => {
    const b = deferred<DiaryEntry>(), mood = deferred<DiaryEntry>()
    mocks.entries.update.mockReturnValueOnce(b.promise).mockReturnValueOnce(mood.promise)
    await mount()
    edit('Revision B'); saveNow()
    fireEvent.click(screen.getByRole('button', { name: /设置开心/ }))
    expect(mocks.entries.update).toHaveBeenNthCalledWith(2, 9, { mood: 'happy' })
    const finishEditor = () => finish(b, saved('Revision B'))
    const finishMood = () => finish(mood, saved(original.content, { mood: 'happy' }))
    if (order === 'editor-first') {
      await finishEditor()
      expectDirty(false)
      await finishMood()
    } else {
      await finishMood()
      expect(body()).toBe('Revision B')
      expectDirty(true)
      await finishEditor()
    }
    expect(body()).toBe('Revision B')
    expect(appEntry()).toEqual(expect.objectContaining({ content: 'Revision B', mood: 'happy' }))
    expect(screen.getByRole('button', { name: '设置开心（happy）' })).toBeInTheDocument()
    expect(screen.getByText('已保存')).toBeInTheDocument()
    expectDirty(false)
  })

  it('allows another first create after failure without losing dirty text', async () => {
    mocks.entries.getByDate.mockResolvedValue(null)
    const first = deferred<DiaryEntry>(), retry = deferred<DiaryEntry>()
    mocks.entries.create.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
    await mount('')
    edit('Revision B'); saveNow()
    await act(async () => { first.reject(new Error('Create failed')); await first.promise.catch(() => {}) })
    expect(body()).toBe('Revision B')
    expectDirty(true)
    expect(screen.getByText('尚未保存')).toBeInTheDocument()
    saveNow()
    expect(mocks.entries.create).toHaveBeenCalledTimes(2)
    expect(mocks.entries.create).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'Revision B' }))
    await finish(retry, saved('Revision B', { id: 42, title: '' }))
    expect(mocks.entries.update).not.toHaveBeenCalled()
    expect(appEntry()).toEqual(expect.objectContaining({ id: 42, content: 'Revision B' }))
    expect(body()).toBe('Revision B')
    expectDirty(false)
  })

  it('preserves a real Polish application and its undo when an older save returns', async () => {
    const pending = deferred<DiaryEntry>()
    mocks.entries.update.mockReturnValue(pending.promise)
    await mount()
    vi.useFakeTimers()
    edit('Entry body')
    await act(async () => { vi.advanceTimersByTime(2000) })
    vi.useRealTimers()
    expect(mocks.entries.update).toHaveBeenCalledWith(9, { title: 'Diary', content: 'Entry body' })
    const editor = view()
    vi.spyOn(editor, 'coordsAtPos').mockReturnValue({ left: 100, right: 180, top: 220, bottom: 240 })
    vi.spyOn(editor.scrollDOM, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 160, 600, 400))
    act(() => { editor.focus(); editor.dispatch({ selection: { anchor: 0, head: 5 } }) })
    const ai = await screen.findByRole('button', { name: 'AI 润色' })
    fireEvent.mouseDown(ai, { button: 0 }); fireEvent.click(ai)
    const polish = screen.getByRole('button', { name: '写得通顺' })
    fireEvent.mouseDown(polish, { button: 0 }); fireEvent.click(polish)
    await screen.findByText('Polished')
    fireEvent.click(screen.getByRole('button', { name: '替换选中文字' }))
    expect(body()).toBe('Polished body')
    await finish(pending, saved('Entry body'))
    expect(body()).toBe('Polished body')
    expectDirty(true)
    act(() => { expect(undo(view())).toBe(true) })
    expect(body()).toBe('Entry body')
    expectDirty(true)
  })
})
