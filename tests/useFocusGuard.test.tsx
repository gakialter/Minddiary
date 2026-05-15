import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFocusGuard } from '../src/hooks/useFocusGuard'
import type { ActiveAppInfo, FocusWhitelistItem } from '../src/types'

const activeApp = (overrides: Partial<ActiveAppInfo> = {}): ActiveAppInfo => ({
  name: 'Notion',
  processName: 'notion.exe',
  executable: 'notion.exe',
  title: 'Study notes',
  platform: 'win32',
  ...overrides,
})

const whitelistItem = (overrides: Partial<FocusWhitelistItem> = {}): FocusWhitelistItem => ({
  id: 'item-1',
  name: 'Notion',
  processName: 'notion.exe',
  executable: 'notion.exe',
  enabled: true,
  createdAt: '2026-05-15T00:00:00.000Z',
  ...overrides,
})

const renderGuard = (options: Partial<Parameters<typeof useFocusGuard>[0]> = {}) => {
  const onViolation = vi.fn()
  const result = renderHook(() => useFocusGuard({
    isRunning: true,
    modeId: 'work',
    whitelist: [],
    enabled: true,
    intervalSec: 5,
    onViolation,
    ...options,
  }))
  return { ...result, onViolation }
}

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'))
  window.api.focusGuard.getActiveApp = vi.fn().mockResolvedValue(activeApp())
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useFocusGuard', () => {
  it('calls getActiveApp when work mode is running and enabled', async () => {
    const { onViolation } = renderGuard()

    await flushPromises()

    expect(window.api.focusGuard.getActiveApp).toHaveBeenCalledTimes(1)
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ processName: 'notion.exe' }))
  })

  it('calls getActiveApp when custom focus mode is running and enabled', async () => {
    renderGuard({ modeId: 'custom' })

    await flushPromises()

    expect(window.api.focusGuard.getActiveApp).toHaveBeenCalledTimes(1)
  })

  it('does not run during break modes', async () => {
    renderGuard({ modeId: 'short_break' })

    await flushPromises()

    expect(window.api.focusGuard.getActiveApp).not.toHaveBeenCalled()
  })

  it('does not run while paused', async () => {
    renderGuard({ isRunning: false })

    await flushPromises()

    expect(window.api.focusGuard.getActiveApp).not.toHaveBeenCalled()
  })

  it('does not notify when the active app matches the whitelist', async () => {
    const { onViolation } = renderGuard({ whitelist: [whitelistItem()] })

    await flushPromises()

    expect(window.api.focusGuard.getActiveApp).toHaveBeenCalledTimes(1)
    expect(onViolation).not.toHaveBeenCalled()
  })

  it('notifies when the active app is not whitelisted', async () => {
    const { onViolation } = renderGuard({
      whitelist: [whitelistItem({ processName: 'chrome.exe', executable: 'chrome.exe', name: 'Chrome' })],
    })

    await flushPromises()

    expect(onViolation).toHaveBeenCalledTimes(1)
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ name: 'Notion' }))
  })

  it('does not repeat notifications shortly after ignoring the active app', async () => {
    const { result, onViolation } = renderGuard()

    await flushPromises()
    expect(onViolation).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.ignoreAppFor(activeApp(), 5 * 60 * 1000)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(35_000)
    })

    expect(window.api.focusGuard.getActiveApp).toHaveBeenCalled()
    expect(onViolation).toHaveBeenCalledTimes(1)
  })
})
