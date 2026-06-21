import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Sidebar from '../src/components/Sidebar'

describe('Sidebar', () => {
  it('keeps home as the default navigation id and labels it 今日执行', () => {
    const onViewChange = vi.fn()

    render(
      <Sidebar
        activeView="home"
        onViewChange={onViewChange}
        selectedDate="2026-06-21"
        isCollapsed={false}
        onToggle={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '今日执行' }))

    expect(onViewChange).toHaveBeenCalledWith('home')
    expect(screen.getByRole('button', { name: '数据统计' })).toBeInTheDocument()
  })
})
