import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Sidebar from '../src/components/Sidebar'

const destinationNames = [
  '今日安排',
  '写日记',
  '日历',
  '学习统计',
  '标签',
  '搜索日记',
  '专注计时',
  '科目进度',
  '错题本',
  '学习助手',
  '设置',
] as const

function renderSidebar({
  activeView = 'home',
  isCollapsed = false,
  onViewChange = vi.fn(),
  onToggle = vi.fn(),
}: {
  activeView?: string
  isCollapsed?: boolean
  onViewChange?: (viewId: string) => void
  onToggle?: () => void
} = {}) {
  return render(
    <Sidebar
      activeView={activeView}
      onViewChange={onViewChange}
      selectedDate="2026-06-21"
      isCollapsed={isCollapsed}
      onToggle={onToggle}
    />,
  )
}

function getDestinationNames() {
  const navigation = screen.getByRole('navigation', { name: '主要导航' })
  return within(navigation)
    .getAllByRole('button')
    .map(button => button.getAttribute('aria-label'))
}

describe('Sidebar', () => {
  it('exposes all 11 destination names in the expanded navigation', () => {
    renderSidebar()

    expect(getDestinationNames()).toEqual(destinationNames)
  })

  it('keeps the same 11 destination names when collapsed', () => {
    renderSidebar({ isCollapsed: true })

    expect(getDestinationNames()).toEqual(destinationNames)
  })

  it('identifies only the active destination as the current page', () => {
    renderSidebar({ activeView: 'dashboard' })

    const currentDestination = screen.getByRole('button', { name: '学习统计' })
    expect(currentDestination).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '今日安排' })).not.toHaveAttribute('aria-current')
  })

  it('names the collapse control accurately and exposes its expanded state', () => {
    const onToggle = vi.fn()
    const { rerender } = renderSidebar({ onToggle })

    const collapseButton = screen.getByRole('button', { name: '收起侧边栏' })
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true')
    expect(collapseButton).toHaveAttribute('aria-controls', 'primary-navigation')

    fireEvent.click(collapseButton)
    expect(onToggle).toHaveBeenCalledOnce()

    rerender(
      <Sidebar
        activeView="home"
        onViewChange={vi.fn()}
        selectedDate="2026-06-21"
        isCollapsed
        onToggle={onToggle}
      />,
    )

    expect(screen.getByRole('button', { name: '展开侧边栏' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('navigates from the collapsed rail through the public callback', () => {
    const onViewChange = vi.fn()
    renderSidebar({ isCollapsed: true, onViewChange })

    fireEvent.click(screen.getByRole('button', { name: '学习统计' }))

    expect(onViewChange).toHaveBeenCalledWith('dashboard')
  })
})
