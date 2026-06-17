import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  currentDateKey: '2026-05-04',
}))

vi.mock('../src/contexts/LocalDateContext', () => ({
  useCurrentLocalDateKey: () => mocks.currentDateKey,
}))

import { VIEW_CONFIG, useNavigation } from '../src/hooks/useNavigation'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.currentDateKey = '2026-05-04'
})

describe('VIEW_CONFIG', () => {
  it('contains the main views and a render function for each config', () => {
    const expectedViews = [
      'home',
      'editor',
      'calendar',
      'dashboard',
      'tags',
      'search',
      'pomodoro',
      'progress',
      'mistakes',
      'ai',
      'settings',
    ]

    for (const view of expectedViews) {
      expect(VIEW_CONFIG).toHaveProperty(view)
      expect(typeof VIEW_CONFIG[view]?.render).toBe('function')
    }
  })
})

describe('useNavigation', () => {
  it('starts on the home view with today selected', () => {
    const { result } = renderHook(() => useNavigation())

    expect(result.current.activeView).toBe('home')
    expect(result.current.selectedDate).toBe('2026-05-04')
    expect(result.current.currentDateKey).toBe('2026-05-04')
    expect(result.current.isFollowingToday).toBe(true)
    expect(result.current.viewTitle).toBe(VIEW_CONFIG.home?.title)
    expect(result.current.viewTitle).not.toBe('')
  })

  it('updates active view and selected date independently', () => {
    const { result } = renderHook(() => useNavigation())

    act(() => {
      result.current.setActiveView('settings')
    })

    expect(result.current.activeView).toBe('settings')
    expect(result.current.viewTitle).toBe('')

    act(() => {
      result.current.setSelectedDate('2026-05-05')
    })

    expect(result.current.selectedDate).toBe('2026-05-05')
    expect(result.current.activeView).toBe('settings')
    expect(result.current.isFollowingToday).toBe(false)
  })

  it('changeDate updates selected date and switches to editor', () => {
    const { result } = renderHook(() => useNavigation())

    act(() => {
      result.current.changeDate('2026-05-10')
    })

    expect(result.current.selectedDate).toBe('2026-05-10')
    expect(result.current.activeView).toBe('editor')
    expect(result.current.viewTitle).toBe(VIEW_CONFIG.editor?.title)
    expect(result.current.isFollowingToday).toBe(false)
  })

  it('rolls selected date forward only while following today', () => {
    const { result, rerender } = renderHook(() => useNavigation())

    mocks.currentDateKey = '2026-05-05'
    rerender()

    expect(result.current.selectedDate).toBe('2026-05-05')
    expect(result.current.isFollowingToday).toBe(true)

    act(() => {
      result.current.changeDate('2026-05-01')
    })

    mocks.currentDateKey = '2026-05-06'
    rerender()

    expect(result.current.selectedDate).toBe('2026-05-01')
    expect(result.current.isFollowingToday).toBe(false)

    act(() => {
      result.current.returnToToday()
    })

    expect(result.current.selectedDate).toBe('2026-05-06')
    expect(result.current.isFollowingToday).toBe(true)
  })

  it('defers automatic today rollover while auto-follow is disabled', () => {
    const { result, rerender } = renderHook(
      ({ canAutoFollowToday }) => useNavigation({ canAutoFollowToday }),
      { initialProps: { canAutoFollowToday: false } },
    )

    mocks.currentDateKey = '2026-05-05'
    rerender({ canAutoFollowToday: false })

    expect(result.current.selectedDate).toBe('2026-05-04')
    expect(result.current.isFollowingToday).toBe(true)

    rerender({ canAutoFollowToday: true })

    expect(result.current.selectedDate).toBe('2026-05-05')
    expect(result.current.isFollowingToday).toBe(true)
  })
})
