import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGlobalKeyboard } from '../src/hooks/useGlobalKeyboard'

const dispatchKeyDown = (
  key: string,
  options: Pick<KeyboardEventInit, 'ctrlKey' | 'metaKey'> = {},
) => {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: options.ctrlKey,
    metaKey: options.metaKey,
    bubbles: true,
    cancelable: true,
  })
  const preventDefault = vi.fn()

  Object.defineProperty(event, 'preventDefault', {
    value: preventDefault,
    configurable: true,
  })

  window.dispatchEvent(event)

  return { event, preventDefault }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useGlobalKeyboard', () => {
  it('calls the matching binding and prevents default for Ctrl shortcuts', () => {
    const handler = vi.fn()

    renderHook(() => useGlobalKeyboard({ k: handler }))
    const { preventDefault } = dispatchKeyDown('k', { ctrlKey: true })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('ignores ordinary keydown events without Ctrl or Cmd', () => {
    const handler = vi.fn()

    renderHook(() => useGlobalKeyboard({ k: handler }))
    const { preventDefault } = dispatchKeyDown('k')

    expect(handler).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('ignores Ctrl shortcuts with unbound keys', () => {
    const handler = vi.fn()

    renderHook(() => useGlobalKeyboard({ k: handler }))
    const { preventDefault } = dispatchKeyDown('j', { ctrlKey: true })

    expect(handler).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('matches key bindings case-insensitively', () => {
    const handler = vi.fn()

    renderHook(() => useGlobalKeyboard({ k: handler }))
    const { preventDefault } = dispatchKeyDown('K', { ctrlKey: true })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('supports Cmd shortcuts through metaKey', () => {
    const handler = vi.fn()

    renderHook(() => useGlobalKeyboard({ k: handler }))
    const { preventDefault } = dispatchKeyDown('k', { metaKey: true })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('removes the global keydown listener on unmount', () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useGlobalKeyboard({ k: handler }))

    dispatchKeyDown('k', { ctrlKey: true })
    expect(handler).toHaveBeenCalledTimes(1)

    unmount()
    const { preventDefault } = dispatchKeyDown('k', { ctrlKey: true })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
