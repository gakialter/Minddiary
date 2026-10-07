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
  usePomodoroActions: () => ({ setOnBreakStart: mocks.noop, dismissAlert: mocks.noop }),
}))
vi.mock('../src/hooks/useGlobalKeyboard', () => ({ useGlobalKeyboard: vi.fn() }))
vi.mock('../src/hooks/useNavigation', async () => {
  const { default: RealEditor } = await import('../src/components/Editor')
  type RenderProps = {
    entry: DiaryEntry | null
    saveEntry: ComponentProps<typeof Editor>['onSave']
    loading: boolean
    onEditorDirtyChange?: (dirty: boolean) => void
  }
  return {
    useNavigation: (options: { canAutoFollowToday: boolean }) => {
      mocks.navigation(options)
      return {
        activeView: 'editor', selectedDate: mocks.selectedDate, viewTitle: '写日记',
        setActiveView: mocks.noop, setSelectedDate: mocks.noop, changeDate: mocks.noop,
      }
    },
    VIEW_CONFIG: { editor: { title: '写日记', render: (props: RenderProps) => {
      mocks.renderEntry(props.entry)
      return <RealEditor entry={props.entry} onSave={props.saveEntry} loading={props.loading}
        onDirtyChange={dirty => { mocks.dirty(dirty); props.onEditorDirtyChange?.(dirty) }} />
    } } },
  }
})
vi.mock('../src/components/Layout', () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('../src/components/ErrorBoundary', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('../src/components/Sidebar', () => ({ default: () => null }))
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
vi.mock('../src/components/PomodoroAlert', () => ({ default: () => null }))
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
    expect(screen.getByText('未保存')).toBeInTheDocument()
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
    expect(screen.getByText('未保存')).toBeInTheDocument()
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
    expect(screen.getByText('未保存')).toBeInTheDocument()
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
    const polish = screen.getByRole('button', { name: '润色表达' })
    fireEvent.mouseDown(polish, { button: 0 }); fireEvent.click(polish)
    await screen.findByText('Polished')
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(body()).toBe('Polished body')
    await finish(pending, saved('Entry body'))
    expect(body()).toBe('Polished body')
    expectDirty(true)
    act(() => { expect(undo(view())).toBe(true) })
    expect(body()).toBe('Entry body')
    expectDirty(true)
  })
})
