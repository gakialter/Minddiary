import { Bold, Highlighter, Underline } from 'lucide-react'
import type { MarkdownColorKey } from '../../utils/remarkColor'
import ColorPickerButton from './ColorPickerButton'

interface FormatToolbarProps {
  /** Callback when the bold button is clicked */
  onBold: () => void
  /** Callback when the highlight button is clicked */
  onHighlight: () => void
  /** Callback when the underline button is clicked */
  onUnderline: () => void
  /** Optional callback for preset color insertion. When provided, a color picker button appears. */
  onColor?: (color: MarkdownColorKey) => void
}

/**
 * A lightweight Markdown format toolbar.
 *
 * Renders bold, highlight, and underline buttons that fire callbacks.
 * The toolbar itself is stateless — the parent decides what happens
 * when a button is clicked (typically inserting Markdown markers
 * into a textarea via the useTextFormat hook).
 */
export default function FormatToolbar({ onBold, onHighlight, onUnderline, onColor }: FormatToolbarProps) {
  // Pointer activation runs on mousedown so the textarea selection is still intact.
  // Keyboard/assistive activation reaches the click path with detail === 0.
  const handleMouseDown = (e: React.MouseEvent, action: () => void) => {
    if (e.button !== 0) return
    e.preventDefault()
    action()
  }

  const handleClick = (e: React.MouseEvent, action: () => void) => {
    if (e.detail === 0) action()
  }

  return (
    <div
      className="format-toolbar"
      role="toolbar"
      aria-label="文本格式工具栏"
      data-testid="format-toolbar"
    >
      <button
        type="button"
        className="format-toolbar__button"
        title="加粗 (**文本**)"
        aria-label="加粗"
        data-testid="format-bold"
        onMouseDown={(e) => handleMouseDown(e, onBold)}
        onClick={(e) => handleClick(e, onBold)}
      >
        <Bold size={15} aria-hidden="true" />
      </button>

      <button
        type="button"
        className="format-toolbar__button"
        title="高亮 (==文本==)"
        aria-label="高亮"
        data-testid="format-highlight"
        onMouseDown={(e) => handleMouseDown(e, onHighlight)}
        onClick={(e) => handleClick(e, onHighlight)}
      >
        <Highlighter size={15} aria-hidden="true" />
      </button>

      <button
        type="button"
        className="format-toolbar__button"
        title="下划线 (++文本++)"
        aria-label="下划线"
        data-testid="format-underline"
        onMouseDown={(e) => handleMouseDown(e, onUnderline)}
        onClick={(e) => handleClick(e, onUnderline)}
      >
        <Underline size={15} aria-hidden="true" />
      </button>

      {onColor && (
        <>
          <span className="format-toolbar__separator" aria-hidden="true" />
          <ColorPickerButton onSelectColor={onColor} />
        </>
      )}
    </div>
  )
}
