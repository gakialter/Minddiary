import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AIPanel from '../src/components/AIPanel'

const CHAT_HISTORY_KEY = 'minddiary.ai.chatHistory'
const COPY_TEXT = 'clipboard integration sentinel'

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
}))

vi.mock('../src/components/Toast', () => ({ showToast: mocks.showToast }))
vi.mock('../src/components/common/MarkdownRenderer', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: () => ({
    settingsData: {},
    ai: { chat: vi.fn() },
    entries: {},
    mistakes: {},
    subjects: {},
    subjectChapters: {},
    tasks: {},
    pomodoro: {},
  }),
}))

describe('AI message clipboard behavior', () => {
  const browserWriteText = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify([
      { role: 'user', content: COPY_TEXT, id: 1 },
    ]))
    Reflect.deleteProperty(window.api, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: browserWriteText },
    })
    HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    localStorage.clear()
    Reflect.deleteProperty(window.api, 'clipboard')
  })

  it('uses Electron clipboard IPC and reports success without renderer permission fallback', async () => {
    const electronWriteText = vi.fn().mockResolvedValue(undefined)
    Reflect.set(window.api, 'clipboard', { writeText: electronWriteText })
    render(<AIPanel entry={null} />)

    fireEvent.click(screen.getByRole('button', { name: '复制用户消息' }))

    await waitFor(() => expect(electronWriteText).toHaveBeenCalledWith(COPY_TEXT))
    expect(browserWriteText).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('已复制', 'success')
  })

  it('reports Electron IPC rejection without falling back to renderer clipboard permission', async () => {
    const electronWriteText = vi.fn().mockRejectedValue(new Error('denied'))
    Reflect.set(window.api, 'clipboard', { writeText: electronWriteText })
    render(<AIPanel entry={null} />)

    fireEvent.click(screen.getByRole('button', { name: '复制用户消息' }))

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('复制失败', 'error'))
    expect(browserWriteText).not.toHaveBeenCalled()
  })

  it('uses navigator clipboard in browser mode when Electron clipboard API is absent', async () => {
    browserWriteText.mockResolvedValue(undefined)
    render(<AIPanel entry={null} />)

    fireEvent.click(screen.getByRole('button', { name: '复制用户消息' }))

    await waitFor(() => expect(browserWriteText).toHaveBeenCalledWith(COPY_TEXT))
    expect(mocks.showToast).toHaveBeenCalledWith('已复制', 'success')
  })
})
