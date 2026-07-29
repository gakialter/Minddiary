import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Layout from '../src/components/Layout'

describe('Layout custom titlebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders only the left brand and keeps the center free of legacy labels and dates', () => {
    const { container } = render(
      <Layout isSidebarCollapsed={false}>
        <main>
          <h1>今日决策</h1>
          <time>6月11日</time>
        </main>
      </Layout>,
    )

    const titlebar = container.querySelector('.titlebar-custom')
    expect(titlebar).not.toBeNull()

    const titlebarQueries = within(titlebar as HTMLElement)
    expect(titlebarQueries.getAllByText('MindDiary')).toHaveLength(1)
    expect(titlebarQueries.queryByText(/考研日记/)).not.toBeInTheDocument()
    expect(titlebarQueries.queryByText(/\d{1,2}月\d{1,2}日/)).not.toBeInTheDocument()
    expect(titlebarQueries.getByTestId('titlebar-drag-region')).toHaveClass(
      'titlebar-drag-region',
      'flex-1',
      'self-stretch',
    )

    expect(screen.getByRole('heading', { name: '今日决策' })).toBeInTheDocument()
    expect(screen.getByText('6月11日')).toBeInTheDocument()
  })

  it('preserves the window controls and their no-drag contract', async () => {
    render(
      <Layout isSidebarCollapsed={false}>
        <main />
      </Layout>,
    )

    const minimize = screen.getByRole('button', { name: '最小化窗口' })
    const maximize = screen.getByRole('button', { name: '最大化窗口' })
    const close = screen.getByRole('button', { name: '关闭窗口' })

    expect(minimize.closest('.titlebar-custom')).not.toBeNull()
    expect(maximize.closest('.titlebar-custom')).not.toBeNull()
    expect(close.closest('.titlebar-custom')).not.toBeNull()

    fireEvent.click(minimize)
    fireEvent.click(maximize)
    fireEvent.click(close)

    expect(window.api.window.minimize).toHaveBeenCalledOnce()
    expect(window.api.window.maximize).toHaveBeenCalledOnce()
    expect(window.api.window.close).toHaveBeenCalledOnce()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '还原窗口' })).toBeInTheDocument()
    })
  })
})
