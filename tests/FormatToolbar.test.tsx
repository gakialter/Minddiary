import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { applyTextFormat, FORMAT_BOLD, FORMAT_HIGHLIGHT, FORMAT_UNDERLINE } from '../src/hooks/useTextFormat'
import FormatToolbar from '../src/components/common/FormatToolbar'
import ColorPickerButton from '../src/components/common/ColorPickerButton'

// ─── applyTextFormat unit tests ─────────────────────────────────────────────

function makeTextarea(value: string, selectionStart: number, selectionEnd: number): HTMLTextAreaElement {
  const el = document.createElement('textarea')
  el.value = value
  el.selectionStart = selectionStart
  el.selectionEnd = selectionEnd
  // jsdom doesn't implement setSelectionRange, so we shim it
  el.setSelectionRange = (start: number, end: number) => {
    el.selectionStart = start
    el.selectionEnd = end
  }
  el.focus = vi.fn()
  return el
}

describe('applyTextFormat', () => {
  describe('bold (**text**)', () => {
    it('wraps selected text with ** markers', () => {
      const el = makeTextarea('hello world', 6, 11)
      const result = applyTextFormat(el, FORMAT_BOLD)
      expect(result).toBe('hello **world**')
      // Cursor should be after the closing **
      expect(el.selectionStart).toBe(15)
      expect(el.selectionEnd).toBe(15)
    })

    it('inserts placeholder when no text is selected', () => {
      const el = makeTextarea('hello ', 6, 6)
      const result = applyTextFormat(el, FORMAT_BOLD)
      expect(result).toBe('hello **粗体文本**')
      // Placeholder should be selected
      expect(el.selectionStart).toBe(8)
      expect(el.selectionEnd).toBe(12)
    })

    it('wraps at the beginning of text', () => {
      const el = makeTextarea('hello', 0, 5)
      const result = applyTextFormat(el, FORMAT_BOLD)
      expect(result).toBe('**hello**')
    })

    it('wraps in the middle of text', () => {
      const el = makeTextarea('aaa bbb ccc', 4, 7)
      const result = applyTextFormat(el, FORMAT_BOLD)
      expect(result).toBe('aaa **bbb** ccc')
    })
  })

  describe('highlight (==text==)', () => {
    it('wraps selected text with == markers', () => {
      const el = makeTextarea('hello world', 6, 11)
      const result = applyTextFormat(el, FORMAT_HIGHLIGHT)
      expect(result).toBe('hello ==world==')
      expect(el.selectionStart).toBe(15)
      expect(el.selectionEnd).toBe(15)
    })

    it('inserts placeholder when no text is selected', () => {
      const el = makeTextarea('', 0, 0)
      const result = applyTextFormat(el, FORMAT_HIGHLIGHT)
      expect(result).toBe('==高亮文本==')
      expect(el.selectionStart).toBe(2)
      expect(el.selectionEnd).toBe(6)
    })
  })

  describe('underline (++text++)', () => {
    it('wraps selected text with ++ markers', () => {
      const el = makeTextarea('hello world', 0, 5)
      const result = applyTextFormat(el, FORMAT_UNDERLINE)
      expect(result).toBe('++hello++ world')
      expect(el.selectionStart).toBe(9)
      expect(el.selectionEnd).toBe(9)
    })

    it('inserts placeholder when no text is selected', () => {
      const el = makeTextarea('text', 4, 4)
      const result = applyTextFormat(el, FORMAT_UNDERLINE)
      expect(result).toBe('text++下划线文本++')
      expect(el.selectionStart).toBe(6)
      expect(el.selectionEnd).toBe(11)
    })
  })

  it('calls focus on the textarea', () => {
    const el = makeTextarea('abc', 0, 3)
    applyTextFormat(el, FORMAT_BOLD)
    expect(el.focus).toHaveBeenCalled()
  })

  describe('color ({color:KEY}text{/color})', () => {
    it('wraps selected text with color markers', () => {
      const el = makeTextarea('hello world', 6, 11)
      const result = applyTextFormat(el, {
        prefix: '{color:red}',
        suffix: '{/color}',
        placeholder: '彩色文本',
      })
      expect(result).toBe('hello {color:red}world{/color}')
      expect(el.selectionStart).toBe(30)
      expect(el.selectionEnd).toBe(30)
    })

    it('inserts placeholder when no text is selected', () => {
      const el = makeTextarea('hello ', 6, 6)
      const result = applyTextFormat(el, {
        prefix: '{color:blue}',
        suffix: '{/color}',
        placeholder: '彩色文本',
      })
      expect(result).toBe('hello {color:blue}彩色文本{/color}')
      // Placeholder '彩色文本' should be selected
      expect(el.selectionStart).toBe(18)
      expect(el.selectionEnd).toBe(22)
    })

    it('calls focus on the textarea after color insert', () => {
      const el = makeTextarea('abc', 0, 3)
      applyTextFormat(el, {
        prefix: '{color:green}',
        suffix: '{/color}',
        placeholder: '彩色文本',
      })
      expect(el.focus).toHaveBeenCalled()
    })
  })

  it('handles empty textarea', () => {
    const el = makeTextarea('', 0, 0)
    const result = applyTextFormat(el, FORMAT_BOLD)
    expect(result).toBe('**粗体文本**')
  })
})

// ─── FormatToolbar component tests ──────────────────────────────────────────

describe('FormatToolbar', () => {
  it('renders three format buttons', () => {
    render(
      <FormatToolbar
        onBold={vi.fn()}
        onHighlight={vi.fn()}
        onUnderline={vi.fn()}
      />,
    )
    expect(screen.getByTestId('format-bold')).toBeInTheDocument()
    expect(screen.getByTestId('format-highlight')).toBeInTheDocument()
    expect(screen.getByTestId('format-underline')).toBeInTheDocument()
  })

  it('has correct aria labels', () => {
    render(
      <FormatToolbar
        onBold={vi.fn()}
        onHighlight={vi.fn()}
        onUnderline={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('加粗')).toBeInTheDocument()
    expect(screen.getByLabelText('高亮')).toBeInTheDocument()
    expect(screen.getByLabelText('下划线')).toBeInTheDocument()
  })

  it('fires onBold callback on mousedown', () => {
    const onBold = vi.fn()
    render(
      <FormatToolbar
        onBold={onBold}
        onHighlight={vi.fn()}
        onUnderline={vi.fn()}
      />,
    )
    fireEvent.mouseDown(screen.getByTestId('format-bold'))
    expect(onBold).toHaveBeenCalledTimes(1)
  })

  it('fires onHighlight callback on mousedown', () => {
    const onHighlight = vi.fn()
    render(
      <FormatToolbar
        onBold={vi.fn()}
        onHighlight={onHighlight}
        onUnderline={vi.fn()}
      />,
    )
    fireEvent.mouseDown(screen.getByTestId('format-highlight'))
    expect(onHighlight).toHaveBeenCalledTimes(1)
  })

  it('fires onUnderline callback on mousedown', () => {
    const onUnderline = vi.fn()
    render(
      <FormatToolbar
        onBold={vi.fn()}
        onHighlight={vi.fn()}
        onUnderline={onUnderline}
      />,
    )
    fireEvent.mouseDown(screen.getByTestId('format-underline'))
    expect(onUnderline).toHaveBeenCalledTimes(1)
  })

  it('has a toolbar role', () => {
    render(
      <FormatToolbar
        onBold={vi.fn()}
        onHighlight={vi.fn()}
        onUnderline={vi.fn()}
      />,
    )
    expect(screen.getByRole('toolbar')).toBeInTheDocument()
  })

  it('prevents default on mousedown to keep textarea focus', () => {
    render(
      <FormatToolbar
        onBold={vi.fn()}
        onHighlight={vi.fn()}
        onUnderline={vi.fn()}
      />,
    )
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    const prevented = !screen.getByTestId('format-bold').dispatchEvent(event)
    expect(prevented).toBe(true)
  })

  it('does not render color button when onColor is not provided', () => {
    render(
      <FormatToolbar
        onBold={vi.fn()}
        onHighlight={vi.fn()}
        onUnderline={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('format-color')).toBeNull()
  })

  it('renders color button when onColor is provided', () => {
    render(
      <FormatToolbar
        onBold={vi.fn()}
        onHighlight={vi.fn()}
        onUnderline={vi.fn()}
        onColor={vi.fn()}
      />,
    )
    expect(screen.getByTestId('format-color')).toBeInTheDocument()
  })
})

// ─── ColorPickerButton component tests ──────────────────────────────────────

describe('ColorPickerButton', () => {
  it('renders the trigger button', () => {
    render(<ColorPickerButton onSelectColor={vi.fn()} />)
    expect(screen.getByTestId('format-color')).toBeInTheDocument()
    expect(screen.getByLabelText('文字颜色')).toBeInTheDocument()
  })

  it('shows 7 color swatches after clicking the trigger', () => {
    render(<ColorPickerButton onSelectColor={vi.fn()} />)
    fireEvent.mouseDown(screen.getByTestId('format-color'))
    expect(screen.getByTestId('color-picker-popover')).toBeInTheDocument()

    const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']
    for (const color of colors) {
      expect(screen.getByTestId(`color-swatch-${color}`)).toBeInTheDocument()
    }
  })

  it('fires onSelectColor with the clicked color key', () => {
    const onSelectColor = vi.fn()
    render(<ColorPickerButton onSelectColor={onSelectColor} />)
    fireEvent.mouseDown(screen.getByTestId('format-color'))
    fireEvent.mouseDown(screen.getByTestId('color-swatch-red'))
    expect(onSelectColor).toHaveBeenCalledWith('red')
    expect(onSelectColor).toHaveBeenCalledTimes(1)
  })

  it('closes the popover after selecting a color', () => {
    render(<ColorPickerButton onSelectColor={vi.fn()} />)
    fireEvent.mouseDown(screen.getByTestId('format-color'))
    expect(screen.getByTestId('color-picker-popover')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByTestId('color-swatch-blue'))
    expect(screen.queryByTestId('color-picker-popover')).toBeNull()
  })

  it('does not show popover initially', () => {
    render(<ColorPickerButton onSelectColor={vi.fn()} />)
    expect(screen.queryByTestId('color-picker-popover')).toBeNull()
  })

  it('each swatch has an aria-label', () => {
    render(<ColorPickerButton onSelectColor={vi.fn()} />)
    fireEvent.mouseDown(screen.getByTestId('format-color'))
    expect(screen.getByLabelText('红色')).toBeInTheDocument()
    expect(screen.getByLabelText('蓝色')).toBeInTheDocument()
    expect(screen.getByLabelText('灰色')).toBeInTheDocument()
  })
})
