import { fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CommandPalette from '../src/components/CommandPalette'

describe('CommandPalette navigation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens the calendar command when its updated title is selected', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '日历' } })
    fireEvent.click(screen.getByText('日历'))

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('calendar')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('finds progress by its updated description and opens the original view id', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '章节完成情况' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('progress')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('uses ArrowDown and Enter to navigate to the next command', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />)

    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('calendar')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on Escape without navigating', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />)

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('clears the filter and focuses the input after closing and reopening', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    const props = { onClose, onNavigate }
    const { rerender } = render(<CommandPalette isOpen {...props} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '章节完成情况' } })

    rerender(<CommandPalette isOpen={false} {...props} />)
    rerender(<CommandPalette isOpen {...props} />)

    expect(screen.getByRole('textbox')).toHaveValue('')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(screen.getByRole('textbox')).toHaveFocus()
    expect(screen.getByText('写日记')).toBeInTheDocument()
  })
})

describe('CommandPalette P10 search', () => {
  it.each([
    ['错题描述', '复习错题和知识点', 'mistakes', '错题本'],
    ['AI 描述', '提问或整理学习思路', 'ai', 'AI 助手'],
  ])('finds only the %s item and preserves its view id for Enter', (_label, query, viewId, expectedTitle) => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: query } })

    expect(screen.getByText(query)).toBeInTheDocument()
    expect(screen.getByText(expectedTitle)).toBeInTheDocument()
    for (const title of ['写日记', '日历', '搜索日记', '科目进度', '错题本', '专注计时', '标签', 'AI 助手', '设置']) {
      if (title !== expectedTitle) expect(screen.queryByText(title)).not.toBeInTheDocument()
    }

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(viewId)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it.each([
    ['错题描述', '复习错题和知识点', 'mistakes', '错题本'],
    ['AI 描述', '提问或整理学习思路', 'ai', 'AI 助手'],
  ])('opens the %s by click using its original view id', (_label, query, viewId, expectedTitle) => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: query } })
    expect(screen.getByText(expectedTitle)).toBeInTheDocument()
    fireEvent.click(screen.getByText(query))

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(viewId)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('searches the placeholder examples, keeps an empty result open, and restores all commands after clearing', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('placeholder', '搜索功能，例如：设置、日记')

    fireEvent.change(input, { target: { value: '设置' } })
    expect(screen.getByText('设置')).toBeInTheDocument()
    expect(screen.queryByText('日历')).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: '日记' } })
    expect(screen.getByText('写日记')).toBeInTheDocument()
    expect(screen.getByText('搜索日记')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '没有这项功能' } })
    expect(screen.getByText('没找到功能，换个词试试。')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onNavigate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '' } })
    for (const title of ['写日记', '日历', '搜索日记', '科目进度', '错题本', '专注计时', '标签', 'AI 助手', '设置']) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('editor')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
