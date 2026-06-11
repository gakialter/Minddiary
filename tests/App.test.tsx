import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry } from '../src/types'
import App from '../src/App'
import { getLocalDateKey } from '../src/utils/dateKey'

const mocks = vi.hoisted(() => ({
  entries: {
    getByDate: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  tags: {
    getEntryTags: vi.fn(),
    setEntryTags: vi.fn(),
  },
  setOnBreakStart: vi.fn(),
  breakStartCallback: null as (() => void) | null,
  dismissAlert: vi.fn(),
  setActiveView: vi.fn(),
  setSelectedDate: vi.fn(),
  changeDate: vi.fn(),
  showToast: vi.fn(),
  alertState: {
    visible: false,
    isWorkComplete: false,
    completionKind: 'completed' as 'completed' | 'interrupted',
    duration: 0,
    todayTotal: 0,
    showSettlementActions: false,
    subjectName: null as string | null,
  },
}))

vi.mock('../src/contexts/DiaryContext', () => ({
  DiaryProvider: ({ children }: { children: ReactNode }) => children,
  useDiary: () => ({
    isDarkMode: false,
    entries: mocks.entries,
    tags: mocks.tags,
  }),
}))

vi.mock('../src/contexts/PomodoroContext', () => ({
  PomodoroProvider: ({ children }: { children: ReactNode }) => children,
  usePomodoroData: () => ({
    alertState: mocks.alertState,
  }),
  usePomodoroActions: () => ({
    setOnBreakStart: mocks.setOnBreakStart,
    dismissAlert: mocks.dismissAlert,
  }),
}))

vi.mock('../src/hooks/useGlobalKeyboard', () => ({
  useGlobalKeyboard: vi.fn(),
}))

vi.mock('../src/hooks/useNavigation', () => ({
  useNavigation: () => ({
    activeView: 'editor',
    setActiveView: mocks.setActiveView,
    selectedDate: '2026-05-12',
    setSelectedDate: mocks.setSelectedDate,
    changeDate: mocks.changeDate,
    viewTitle: '写日记',
  }),
  VIEW_CONFIG: {
    editor: {
      title: '写日记',
      render: (props: { saveEntry: (data: Partial<DiaryEntry>) => Promise<void> }) => (
        <div>
          <div data-testid="pending-diary-insert">
            {'pendingDiaryInsert' in props && props.pendingDiaryInsert
              ? (props.pendingDiaryInsert as { content: string }).content
              : ''}
          </div>
          <button
            data-testid="save-new-entry"
            onClick={() => props.saveEntry({ title: 'Draft', content: 'Body', tags: [2, 5] })}
          >
            Save
          </button>
        </div>
      ),
    },
  },
}))

vi.mock('../src/components/Layout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('../src/components/Sidebar', () => ({ default: () => null }))
vi.mock('../src/components/Countdown', () => ({ default: () => null }))
vi.mock('../src/components/MoodPicker', () => ({ default: () => null }))
vi.mock('../src/components/Pomodoro', () => ({ default: () => null }))
vi.mock('../src/components/CommandPalette', () => ({ default: () => null }))
vi.mock('../src/components/ExportModal', () => ({ default: () => null }))
vi.mock('../src/components/BreakReviewModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="mock-break-review-modal">
      <button onClick={onClose}>Close break review</button>
    </div>
  ),
}))
vi.mock('../src/components/PomodoroAlert', () => ({
  default: ({
    visible,
    completionKind,
    onWriteDiary,
    onAddMistake,
    onClose,
  }: {
    visible: boolean
    completionKind?: 'completed' | 'interrupted'
    onWriteDiary?: () => void
    onAddMistake?: () => void
    onClose: () => void
  }) => visible ? (
    <div>
      <div data-testid="mock-alert-kind">{completionKind}</div>
      <button data-testid="mock-alert-write-diary" onClick={onWriteDiary}>Write diary</button>
      <button data-testid="mock-alert-add-mistake" onClick={onAddMistake}>Add mistake</button>
      <button data-testid="mock-alert-close" onClick={onClose}>Close</button>
    </div>
  ) : null,
}))
vi.mock('../src/components/Welcome', () => ({ default: () => null }))
vi.mock('../src/components/ImageGallery', () => ({ default: () => null }))
vi.mock('../src/components/ErrorBoundary', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('../src/components/Toast', () => ({
  showToast: mocks.showToast,
  ToastContainer: () => null,
}))

describe('App diary save flow', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('started', 'true')
    vi.clearAllMocks()
    mocks.entries.getByDate.mockResolvedValue(null)
    mocks.entries.create.mockResolvedValue({
      id: 42,
      date: '2026-05-12',
      title: 'Draft',
      content: 'Body',
      mood: null,
      word_count: 4,
      created_at: '2026-05-12T00:00:00.000Z',
      updated_at: '2026-05-12T00:00:00.000Z',
    })
    mocks.entries.update.mockResolvedValue(null)
    mocks.tags.getEntryTags.mockResolvedValue([])
    mocks.tags.setEntryTags.mockResolvedValue(undefined)
    mocks.alertState = {
      visible: false,
      isWorkComplete: false,
      completionKind: 'completed',
      duration: 0,
      todayTotal: 0,
      showSettlementActions: false,
      subjectName: null,
    }
    mocks.breakStartCallback = null
    mocks.setOnBreakStart.mockImplementation((cb: (() => void) | null) => {
      mocks.breakStartCallback = cb
    })
  })

  it('sets tags after a new diary receives its saved entry id', async () => {
    render(<App />)

    fireEvent.click(screen.getByTestId('save-new-entry'))

    await waitFor(() => {
      expect(mocks.entries.create).toHaveBeenCalled()
      expect(mocks.tags.setEntryTags).toHaveBeenCalledWith(42, [2, 5])
    })

    expect(mocks.entries.create.mock.calls[0]?.[0]).toEqual({
      title: 'Draft',
      content: 'Body',
      mood: null,
      date: '2026-05-12',
    })
    expect(mocks.entries.create.mock.calls[0]?.[0]).not.toHaveProperty('tags')
  })

  it('routes focus settlement write-diary action to today editor with a draft insert', async () => {
    mocks.alertState = {
      visible: true,
      isWorkComplete: true,
      completionKind: 'interrupted',
      duration: 25,
      todayTotal: 50,
      showSettlementActions: true,
      subjectName: 'Math',
    }

    render(<App />)

    fireEvent.click(screen.getByTestId('mock-alert-write-diary'))

    await waitFor(() => {
      expect(mocks.setSelectedDate).toHaveBeenCalledWith(getLocalDateKey())
      expect(mocks.setActiveView).toHaveBeenCalledWith('editor')
      expect(mocks.dismissAlert).toHaveBeenCalled()
      expect(screen.getByTestId('pending-diary-insert')).toHaveTextContent('本轮专注沉淀')
    })
  })

  it('routes focus settlement add-mistake action to the mistake book', async () => {
    mocks.alertState = {
      visible: true,
      isWorkComplete: true,
      completionKind: 'interrupted',
      duration: 25,
      todayTotal: 50,
      showSettlementActions: true,
      subjectName: 'Math',
    }

    render(<App />)

    fireEvent.click(screen.getByTestId('mock-alert-add-mistake'))

    expect(mocks.setActiveView).toHaveBeenCalledWith('mistakes')
    expect(mocks.dismissAlert).toHaveBeenCalled()
  })

  it('opens break review only when the natural completion callback fires', async () => {
    render(<App />)

    expect(screen.queryByTestId('mock-break-review-modal')).not.toBeInTheDocument()
    expect(mocks.breakStartCallback).toEqual(expect.any(Function))

    await act(async () => {
      mocks.breakStartCallback?.()
    })

    expect(screen.getByTestId('mock-break-review-modal')).toBeInTheDocument()
  })

  it('does not open break review for an interrupted focus settlement alert', () => {
    mocks.alertState = {
      visible: true,
      isWorkComplete: true,
      completionKind: 'interrupted',
      duration: 19,
      todayTotal: 44,
      showSettlementActions: true,
      subjectName: 'Math',
    }

    render(<App />)

    expect(screen.getByTestId('mock-alert-kind')).toHaveTextContent('interrupted')
    expect(screen.queryByTestId('mock-break-review-modal')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-alert-write-diary')).toBeInTheDocument()
    expect(screen.getByTestId('mock-alert-add-mistake')).toBeInTheDocument()
  })
})
