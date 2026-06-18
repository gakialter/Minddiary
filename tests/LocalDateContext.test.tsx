import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalDateProvider, useCurrentLocalDateKey } from '../src/contexts/LocalDateContext'

describe('LocalDateProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initializes with the current local date key and rolls over at local midnight', async () => {
    vi.setSystemTime(new Date(2026, 4, 4, 23, 59, 50))
    const { result } = renderHook(() => useCurrentLocalDateKey(), {
      wrapper: ({ children }) => <LocalDateProvider>{children}</LocalDateProvider>,
    })

    expect(result.current).toBe('2026-05-04')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(result.current).toBe('2026-05-05')
  })

  it('reschedules after each rollover instead of using a fixed one-shot timer', async () => {
    vi.setSystemTime(new Date(2026, 4, 4, 23, 59, 59))
    const { result } = renderHook(() => useCurrentLocalDateKey(), {
      wrapper: ({ children }) => <LocalDateProvider>{children}</LocalDateProvider>,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(result.current).toBe('2026-05-05')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    })

    expect(result.current).toBe('2026-05-06')
  })

  it('refreshes after visibility or focus resumes reveal a date change', () => {
    vi.setSystemTime(new Date(2026, 4, 4, 12, 0, 0))
    const { result } = renderHook(() => useCurrentLocalDateKey(), {
      wrapper: ({ children }) => <LocalDateProvider>{children}</LocalDateProvider>,
    })

    expect(result.current).toBe('2026-05-04')

    vi.setSystemTime(new Date(2026, 4, 5, 9, 0, 0))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(result.current).toBe('2026-05-05')
  })

  it('cleans up the scheduled rollover timer on unmount', () => {
    vi.setSystemTime(new Date(2026, 4, 4, 12, 0, 0))
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')
    const { unmount } = renderHook(() => useCurrentLocalDateKey(), {
      wrapper: ({ children }) => <LocalDateProvider>{children}</LocalDateProvider>,
    })

    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })
})
