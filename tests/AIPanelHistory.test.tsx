import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'

const CHAT_HISTORY_KEY = 'minddiary.ai.chatHistory'

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
  aiChat: vi.fn(),
  mistakesGetAll: vi.fn(),
  setOnBreakStart: vi.fn(),
  dismissAlert: vi.fn(),
}))

vi.mock('../src/contexts/DiaryContext', () => ({
  DiaryProvider: ({ children }: { children: ReactNode }) => children,
  useDiary: () => ({
    isDarkMode: false,
    settingsData: {},
    entries: mocks.entries,
    tags: mocks.tags,
    ai: {
      chat: mocks.aiChat,
    },
    mistakes: {
      getAll: mocks.mistakesGetAll,
    },
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
    },
  }),
  usePomodoroActions: () => ({
    setOnBreakStart: mocks.setOnBreakStart,
    dismissAlert: mocks.dismissAlert,
  }),
}))

vi.mock('../src/hooks/useGlobalKeyboard', () => ({
  useGlobalKeyboard: vi.fn(),
}))

vi.mock('../src/components/Layout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('../src/components/Sidebar', () => ({
  default: ({ onViewChange }: { onViewChange: (viewId: string) => void }) => (
    <nav>
      <button onClick={() => onViewChange('ai')}>AI</button>
      <button onClick={() => onViewChange('editor')}>Diary</button>
    </nav>
  ),
}))

vi.mock('../src/components/HomeDashboard', () => ({ default: () => <div>Home view</div> }))
vi.mock('../src/components/Editor', () => ({ default: () => <div>Diary view</div> }))
vi.mock('../src/components/Calendar', () => ({ default: () => <div>Calendar view</div> }))
vi.mock('../src/components/Dashboard', () => ({ default: () => <div>Dashboard view</div> }))
vi.mock('../src/components/TagManager', () => ({ default: () => <div>Tags view</div> }))
vi.mock('../src/components/SearchPanel', () => ({ default: () => <div>Search view</div> }))
vi.mock('../src/components/Pomodoro', () => ({ default: () => <div>Pomodoro view</div> }))
vi.mock('../src/components/StudyProgress', () => ({ default: () => <div>Progress view</div> }))
vi.mock('../src/components/MistakeBook', () => ({ default: () => <div>Mistakes view</div> }))
vi.mock('../src/components/Settings', () => ({ default: () => <div>Settings view</div> }))
vi.mock('../src/components/Countdown', () => ({ default: () => null }))
vi.mock('../src/components/MoodPicker', () => ({ default: () => null }))
vi.mock('../src/components/CommandPalette', () => ({ default: () => null }))
vi.mock('../src/components/ExportModal', () => ({ default: () => null }))
vi.mock('../src/components/BreakReviewModal', () => ({ default: () => null }))
vi.mock('../src/components/PomodoroAlert', () => ({ default: () => null }))
vi.mock('../src/components/Welcome', () => ({ default: () => null }))
vi.mock('../src/components/ImageGallery', () => ({ default: () => null }))
vi.mock('../src/components/common/MarkdownRenderer', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

describe('AI chat history cache', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('started', 'true')
    vi.clearAllMocks()
    mocks.entries.getByDate.mockResolvedValue(null)
    mocks.entries.create.mockResolvedValue(null)
    mocks.entries.update.mockResolvedValue(null)
    mocks.tags.getEntryTags.mockResolvedValue([])
    mocks.tags.setEntryTags.mockResolvedValue(undefined)
    mocks.aiChat.mockResolvedValue({ content: 'Cached assistant reply' })
    mocks.mistakesGetAll.mockResolvedValue({ data: [] })
    HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  it('keeps sent and received AI messages after navigating away and back', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Remember this chat' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', code: 'Enter' })

    await screen.findByText('Cached assistant reply')
    expect(localStorage.getItem(CHAT_HISTORY_KEY)).toContain('Remember this chat')
    expect(localStorage.getItem(CHAT_HISTORY_KEY)).toContain('Cached assistant reply')

    fireEvent.click(screen.getByRole('button', { name: 'Diary' }))
    expect(screen.getByText('Diary view')).toBeInTheDocument()
    expect(screen.queryByText('Cached assistant reply')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))

    expect(screen.getByText('Remember this chat')).toBeInTheDocument()
    expect(screen.getByText('Cached assistant reply')).toBeInTheDocument()
  })

  it('clears cached AI messages when clearing the conversation', async () => {
    localStorage.setItem(
      CHAT_HISTORY_KEY,
      JSON.stringify([
        { role: 'user', content: 'Old question', id: 1 },
        { role: 'assistant', content: 'Old answer', id: 2 },
      ]),
    )

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    expect(screen.getByText('Old question')).toBeInTheDocument()
    expect(screen.getByText('Old answer')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /清空历史/ }))

    await waitFor(() => {
      expect(localStorage.getItem(CHAT_HISTORY_KEY)).toBeNull()
    })
    expect(screen.queryByText('Old question')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Diary' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI' }))

    expect(screen.queryByText('Old question')).not.toBeInTheDocument()
    expect(screen.queryByText('Old answer')).not.toBeInTheDocument()
  })

  it('does not crash and resets history when cached AI messages contain malformed JSON', async () => {
    localStorage.setItem(CHAT_HISTORY_KEY, '{not json')

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    await waitFor(() => {
      expect(localStorage.getItem(CHAT_HISTORY_KEY)).toBeNull()
    })
  })
})
