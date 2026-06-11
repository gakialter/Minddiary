import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FocusZenMode from '../src/components/FocusZenMode'

const renderZen = (overrides: Partial<ComponentProps<typeof FocusZenMode>> = {}) => {
  const props: ComponentProps<typeof FocusZenMode> = {
    visible: true,
    timeLeft: 90,
    modeLabel: '专注',
    modeColor: 'var(--accent)',
    isRunning: true,
    onToggleTimer: vi.fn(),
    onExit: vi.fn(),
    formatTime: (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`,
    selectedSubjectName: 'Math',
    ...overrides,
  }
  render(<FocusZenMode {...props} />)
  return props
}

describe('FocusZenMode', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('renders a disabled early finish control before the minimum duration', () => {
    renderZen({
      showFinishEarly: true,
      canFinishEarly: false,
    })

    fireEvent.mouseMove(screen.getByTestId('focus-zen-mode'))

    const button = screen.getByTestId('focus-zen-finish-countdown-btn')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', '至少专注 1 分钟后可保存')
  })

  it('calls early finish when the Zen control is enabled', () => {
    const onFinishEarly = vi.fn()
    renderZen({
      showFinishEarly: true,
      canFinishEarly: true,
      onFinishEarly,
    })

    fireEvent.mouseMove(screen.getByTestId('focus-zen-mode'))
    fireEvent.click(screen.getByTestId('focus-zen-finish-countdown-btn'))

    expect(onFinishEarly).toHaveBeenCalledTimes(1)
  })

  it('keeps Escape and Space keyboard behavior unchanged', () => {
    const onExit = vi.fn()
    const onToggleTimer = vi.fn()
    renderZen({ onExit, onToggleTimer })

    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(onToggleTimer).toHaveBeenCalledTimes(1)
    expect(onExit).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('still auto-hides controls after reveal', () => {
    renderZen({
      showFinishEarly: true,
      canFinishEarly: true,
    })

    const controls = screen.getByTestId('focus-zen-toggle-btn').parentElement
    expect(controls).toHaveStyle({ opacity: '0' })

    act(() => {
      fireEvent.mouseMove(screen.getByTestId('focus-zen-mode'))
    })
    expect(controls).toHaveStyle({ opacity: '0.82' })

    act(() => {
      vi.advanceTimersByTime(2400)
    })
    expect(controls).toHaveStyle({ opacity: '0' })
  })
})
