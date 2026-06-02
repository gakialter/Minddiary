import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'

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
  dismissAlert: vi.fn(),
  showToast: vi.fn(),
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
    alertState: {
      visible: false,
      isWorkComplete: false,
      duration: 0,
      todayTotal: 0,
      showSettlementActions: false,
      subjectName: null,
    },
  }),
  usePomodoroActions: () => ({
    setOnBreakStart: mocks.setOnBreakStart,
    dismissAlert: mocks.dismissAlert,
  }),
}))

vi.mock('../src/components/Toast', () => ({
  showToast: mocks.showToast,
  ToastContainer: () => null,
}))

vi.mock('../src/components/Layout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('../src/components/Sidebar', () => ({
  default: ({
    activeView,
    onViewChange,
  }: {
    activeView: string
    onViewChange: (viewId: string) => void
  }) => (
    <nav>
      <div data-testid="active-view">{activeView}</div>
      <button onClick={() => onViewChange('pomodoro')}>Pomodoro nav</button>
      <button onClick={() => onViewChange('settings')}>Settings nav</button>
    </nav>
  ),
}))

vi.mock('../src/components/CommandPalette', () => ({
  default: ({
    isOpen,
    onClose,
    onNavigate,
  }: {
    isOpen: boolean
    onClose: () => void
    onNavigate: (viewId: string) => void
  }) => isOpen ? (
    <div>
      <button onClick={() => {
        onNavigate('settings')
        onClose()
      }}>
        Palette settings
      </button>
    </div>
  ) : null,
}))

vi.mock('../src/components/Pomodoro', () => ({
  default: ({
    isWidget,
    onExpand,
    onFullscreenChange,
  }: {
    isWidget: boolean
    onExpand: () => void
    onFullscreenChange?: (isActive: boolean) => void
  }) => isWidget ? (
    <button onClick={onExpand}>Open pomodoro widget</button>
  ) : (
    <div>
      <div>Pomodoro view</div>
      <button onClick={() => onFullscreenChange?.(true)}>Enter fullscreen</button>
      <button onClick={() => onFullscreenChange?.(false)}>Exit fullscreen</button>
    </div>
  ),
}))

vi.mock('../src/components/HomeDashboard', () => ({ default: () => <div>Home view</div> }))
vi.mock('../src/components/Editor', () => ({ default: () => <div>Editor view</div> }))
vi.mock('../src/components/Calendar', () => ({ default: () => <div>Calendar view</div> }))
vi.mock('../src/components/Dashboard', () => ({ default: () => <div>Dashboard view</div> }))
vi.mock('../src/components/TagManager', () => ({ default: () => <div>Tags view</div> }))
vi.mock('../src/components/SearchPanel', () => ({ default: () => <div>Search view</div> }))
vi.mock('../src/components/StudyProgress', () => ({ default: () => <div>Progress view</div> }))
vi.mock('../src/components/MistakeBook', () => ({ default: () => <div>Mistakes view</div> }))
vi.mock('../src/components/AIPanel', () => ({ default: () => <div>AI view</div> }))
vi.mock('../src/components/Settings', () => ({ default: () => <div>Settings view</div> }))
vi.mock('../src/components/Countdown', () => ({ default: () => null }))
vi.mock('../src/components/MoodPicker', () => ({ default: () => null }))
vi.mock('../src/components/ExportModal', () => ({ default: () => null }))
vi.mock('../src/components/BreakReviewModal', () => ({ default: () => null }))
vi.mock('../src/components/PomodoroAlert', () => ({ default: () => null }))
vi.mock('../src/components/Welcome', () => ({ default: () => null }))
vi.mock('../src/components/ImageGallery', () => ({ default: () => null }))

describe('App Pomodoro fullscreen navigation guard', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('started', 'true')
    vi.clearAllMocks()
    mocks.entries.getByDate.mockResolvedValue(null)
    mocks.entries.create.mockResolvedValue(null)
    mocks.entries.update.mockResolvedValue(null)
    mocks.tags.getEntryTags.mockResolvedValue([])
    mocks.tags.setEntryTags.mockResolvedValue(undefined)
  })

  it('allows sidebar navigation when Pomodoro fullscreen is not active', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Settings nav' }))

    expect(screen.getByTestId('active-view')).toHaveTextContent('settings')
    expect(screen.getByText('Settings view')).toBeInTheDocument()
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it('keeps the Pomodoro page active and shows a prompt during fullscreen', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Pomodoro nav' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings nav' }))

    expect(screen.getByTestId('active-view')).toHaveTextContent('pomodoro')
    expect(screen.getByText('Pomodoro view')).toBeInTheDocument()
    expect(screen.queryByText('Settings view')).not.toBeInTheDocument()
    expect(mocks.showToast).toHaveBeenCalledWith('请先退出番茄钟全屏模式再切换页面', 'info')
  })

  it('restores sidebar navigation after Pomodoro fullscreen exits', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Pomodoro nav' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings nav' }))

    expect(screen.getByTestId('active-view')).toHaveTextContent('settings')
    expect(screen.getByText('Settings view')).toBeInTheDocument()
  })

  it('blocks command palette navigation while Pomodoro fullscreen is active', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Pomodoro nav' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }))
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Palette settings' }))

    expect(screen.getByTestId('active-view')).toHaveTextContent('pomodoro')
    expect(screen.getByText('Pomodoro view')).toBeInTheDocument()
    expect(screen.queryByText('Settings view')).not.toBeInTheDocument()
    expect(mocks.showToast).toHaveBeenCalledWith('请先退出番茄钟全屏模式再切换页面', 'info')
  })
})
