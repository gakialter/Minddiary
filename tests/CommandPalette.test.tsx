import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CommandPalette from '../src/components/CommandPalette'

const getSearchInput = () => screen.getByRole('combobox', { name: '搜索功能' })
const getOptions = () => screen.getAllByRole('option')
let scrollIntoViewDescriptor: PropertyDescriptor | undefined
let scrollIntoViewMock: ReturnType<typeof vi.fn>
let scrolledElements: HTMLElement[]

const getOption = (index: number) => {
  const option = getOptions()[index]
  if (!option) throw new Error(`Expected an option at index ${index}`)
  return option
}
const getLastScrolledElement = () => {
  const element = scrolledElements[scrolledElements.length - 1]
  if (!element) throw new Error('Expected scrollIntoView to have been called')
  return element
}

beforeEach(() => {
  scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  scrolledElements = []
  scrollIntoViewMock = vi.fn(function (this: HTMLElement) {
    scrolledElements.push(this)
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoViewMock,
  })
})

afterEach(() => {
  if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor)
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
})

describe('CommandPalette navigation', () => {
  it('opens the calendar command when its updated title is selected', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />)

    fireEvent.change(getSearchInput(), { target: { value: '日历' } })
    fireEvent.click(screen.getByText('日历'))

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('calendar')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('finds progress by its updated description and opens the original view id', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />)

    const input = getSearchInput()
    fireEvent.change(input, { target: { value: '章节完成情况' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('progress')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('uses ArrowDown and Enter to navigate to the next command', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />)

    const input = getSearchInput()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('calendar')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on Escape without navigating', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />)

    fireEvent.keyDown(getSearchInput(), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('clears the filter and focuses the input after closing and reopening', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    const props = { onClose, onNavigate }
    const { rerender } = render(<CommandPalette isOpen {...props} />)
    const input = getSearchInput()
    fireEvent.change(input, { target: { value: '章节完成情况' } })

    rerender(<CommandPalette isOpen={false} {...props} />)
    rerender(<CommandPalette isOpen {...props} />)

    expect(getSearchInput()).toHaveValue('')
    expect(getSearchInput()).toHaveFocus()
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

    const input = getSearchInput()
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

    fireEvent.change(getSearchInput(), { target: { value: query } })
    expect(screen.getByText(expectedTitle)).toBeInTheDocument()
    fireEvent.click(screen.getByText(query))

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(viewId)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('searches the placeholder examples, keeps an empty result open, and restores all commands after clearing', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />)

    const input = getSearchInput()
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

describe('CommandPalette accessibility and focus', () => {
  it('exposes modal and listbox semantics and focuses search on open', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} onNavigate={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: '快捷菜单' })
    const input = getSearchInput()
    const listbox = screen.getByRole('listbox', { name: '功能' })
    const firstOption = getOption(0)

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input).toHaveAttribute('aria-controls', listbox.id)
    expect(listbox).toHaveAttribute('tabindex', '-1')
    expect(input).toHaveFocus()
    expect(firstOption).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', firstOption.id)

    for (const option of getOptions()) {
      expect(option).toHaveAttribute('aria-labelledby')
      expect(option).toHaveAttribute('aria-describedby')
      expect(document.getElementById(option.getAttribute('aria-labelledby')!)).toBeInTheDocument()
      expect(document.getElementById(option.getAttribute('aria-describedby')!)).toBeInTheDocument()
    }
  })

  it('keeps the active descendant and selected option in sync for keyboard and pointer selection', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} onNavigate={vi.fn()} />)

    const input = getSearchInput()
    fireEvent.keyDown(input, { key: 'ArrowDown' })

    expect(input).toHaveAttribute('aria-activedescendant', getOption(1).id)
    expect(getOption(0)).toHaveAttribute('aria-selected', 'false')
    expect(getOption(1)).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveFocus()

    fireEvent.mouseEnter(getOption(3))

    expect(input).toHaveAttribute('aria-activedescendant', getOption(3).id)
    expect(getOption(1)).toHaveAttribute('aria-selected', 'false')
    expect(getOption(3)).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveFocus()
  })

  it('wraps selection from the first option to the last and back', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} onNavigate={vi.fn()} />)

    const input = getSearchInput()
    const lastOption = getOption(getOptions().length - 1)

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveAttribute('aria-activedescendant', lastOption.id)
    expect(lastOption).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', getOption(0).id)
    expect(getOption(0)).toHaveAttribute('aria-selected', 'true')
  })

  it('leaves an empty result unselected and restores the first filtered option after navigation keys', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />)

    const input = getSearchInput()
    fireEvent.change(input, { target: { value: '没有这项功能' } })
    expect(screen.getByText('没找到功能，换个词试试。')).toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-activedescendant')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNavigate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(input).not.toHaveAttribute('aria-activedescendant')

    fireEvent.change(input, { target: { value: '日历' } })
    const firstOption = getOption(0)
    expect(firstOption).toHaveTextContent('日历')
    expect(firstOption).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', firstOption.id)
  })

  it('traps Tab and Shift+Tab and restores focus to the opener after Escape', () => {
    const onNavigate = vi.fn()
    const FocusRig = () => {
      const [isOpen, setIsOpen] = useState(false)
      return (
        <>
          <button onClick={() => setIsOpen(true)}>打开快捷菜单</button>
          <CommandPalette isOpen={isOpen} onClose={() => setIsOpen(false)} onNavigate={onNavigate} />
        </>
      )
    }

    render(<FocusRig />)
    const opener = screen.getByRole('button', { name: '打开快捷菜单' })
    opener.focus()
    fireEvent.click(opener)
    const input = getSearchInput()

    expect(input).toHaveFocus()
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(input).toHaveFocus()
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
    expect(input).toHaveFocus()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '快捷菜单' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('marks the page opener inert while the modal is open', () => {
    const Page = () => (
      <>
        <button>页面操作</button>
        <CommandPalette isOpen onClose={vi.fn()} onNavigate={vi.fn()} />
      </>
    )
    const { container } = render(<Page />)

    expect(container).toHaveProperty('inert', true)
  })

  it('does not submit a command when Enter is pressed during IME composition', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />)

    fireEvent.keyDown(getSearchInput(), { key: 'Enter', isComposing: true })

    expect(onNavigate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('scrolls the newly selected option into view immediately', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} onNavigate={vi.fn()} />)
    const input = getSearchInput()

    fireEvent.keyDown(input, { key: 'ArrowDown' })

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest', behavior: 'instant' })
    expect(getLastScrolledElement()).toBe(getOption(1))
  })
})
