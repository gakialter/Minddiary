import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTodayStr: vi.fn(() => '2026-05-04'),
}))

vi.mock('../src/utils/helpers', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/utils/helpers')>()

  return {
    ...actual,
    getTodayStr: mocks.getTodayStr,
  }
})

import { getTodayStr } from '../src/utils/helpers'
import { VIEW_CONFIG, useNavigation } from '../src/hooks/useNavigation'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTodayStr).mockReturnValue('2026-05-04')
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
    expect(result.current.viewTitle).toBe(VIEW_CONFIG.home?.title)
    expect(result.current.viewTitle).not.toBe('')
    expect(getTodayStr).toHaveBeenCalledTimes(1)
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
  })

  it('changeDate updates selected date and switches to editor', () => {
    const { result } = renderHook(() => useNavigation())

    act(() => {
      result.current.changeDate('2026-05-10')
    })

    expect(result.current.selectedDate).toBe('2026-05-10')
    expect(result.current.activeView).toBe('editor')
    expect(result.current.viewTitle).toBe(VIEW_CONFIG.editor?.title)
  })
})
