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
  it('focuses Zen and contains both Tab directions', () => {
    const entry = document.createElement('button')
    document.body.append(entry)
    entry.focus()
    renderZen()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(screen.getByTestId('focus-zen-exit-btn')).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(screen.getByTestId('focus-zen-toggle-btn')).toHaveFocus()
    entry.remove()
  })

  it('restores focus when visibility changes without invoking timer actions', () => {
    const entry = document.createElement('button')
    document.body.append(entry)
    entry.focus()
    const props = { visible: true, timeLeft: 20, modeLabel: '专注', modeColor: 'green', isRunning: true, onToggleTimer: vi.fn(), onExit: vi.fn(), formatTime: String }
    const { rerender } = render(<FocusZenMode {...props} />)
    rerender(<FocusZenMode {...props} visible={false} />)
    expect(entry).toHaveFocus()
    expect(props.onToggleTimer).not.toHaveBeenCalled()
    entry.remove()
  })

  it('does not consume native button Space and keeps focused controls visible', () => {
    const props = renderZen()
    const button = screen.getByTestId('focus-zen-exit-btn')
    act(() => button.focus())
    expect(fireEvent.keyDown(button, { key: ' ', code: 'Space' })).toBe(true)
    expect(props.onToggleTimer).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(5000))
    expect(button.parentElement).toHaveStyle({ opacity: '1' })
    act(() => screen.getByRole('dialog').focus())
    act(() => vi.advanceTimersByTime(2400))
    expect(button.parentElement).toHaveStyle({ opacity: '0' })
  })

  it('leaves select and editable Space semantics intact', () => {
    const props = renderZen()
    const dialog = screen.getByRole('dialog')
    for (const control of [document.createElement('select'), document.createElement('textarea')]) {
      dialog.append(control)
      expect(fireEvent.keyDown(control, { key: ' ', code: 'Space' })).toBe(true)
      control.remove()
    }
    expect(props.onToggleTimer).not.toHaveBeenCalled()
  })

  it('does not restart or cancel hiding on timer ticks or callback replacements', () => {
    const props = { visible: true, timeLeft: 20, modeLabel: '专注', modeColor: 'green', isRunning: true, onToggleTimer: vi.fn(), onExit: vi.fn(), formatTime: String }
    const { rerender } = render(<FocusZenMode {...props} />)
    fireEvent.mouseMove(screen.getByRole('dialog'))
    for (let time = 19; time >= 17; time--) {
      act(() => vi.advanceTimersByTime(1000))
      rerender(<FocusZenMode {...props} timeLeft={time} onToggleTimer={vi.fn()} onExit={vi.fn()} />)
    }
    expect(screen.getByTestId('focus-zen-toggle-btn').parentElement).toHaveStyle({ opacity: '0' })
  })
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

  it('disables Zen pause and Space toggle while an early finish is saving', () => {
    const onToggleTimer = vi.fn()
    renderZen({
      isFinishingEarly: true,
      onToggleTimer,
      showFinishEarly: true,
      canFinishEarly: true,
    })

    fireEvent.mouseMove(screen.getByTestId('focus-zen-mode'))
    expect(screen.getByTestId('focus-zen-toggle-btn')).toBeDisabled()

    fireEvent.click(screen.getByTestId('focus-zen-toggle-btn'))
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })

    expect(onToggleTimer).not.toHaveBeenCalled()
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
    expect(controls).toHaveStyle({ opacity: '1' })

    act(() => {
      vi.advanceTimersByTime(2400)
    })
    expect(controls).toHaveStyle({ opacity: '0' })
  })
})
