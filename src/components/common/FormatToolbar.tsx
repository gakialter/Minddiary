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

const btnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  padding: 0,
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  transition: 'all 0.15s',
  flexShrink: 0,
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
  // Use onMouseDown + preventDefault to avoid stealing focus from textarea
  const handleMouseDown = (e: React.MouseEvent, action: () => void) => {
    e.preventDefault()
    action()
  }

  return (
    <div
      className="flex items-center gap-xs"
      role="toolbar"
      aria-label="文本格式工具栏"
      data-testid="format-toolbar"
    >
      <button
        type="button"
        style={btnStyle}
        title="加粗 (**文本**)"
        aria-label="加粗"
        data-testid="format-bold"
        onMouseDown={(e) => handleMouseDown(e, onBold)}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-tertiary)'
          e.currentTarget.style.color = 'var(--text-primary)'
          e.currentTarget.style.borderColor = 'var(--accent)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--text-secondary)'
          e.currentTarget.style.borderColor = 'var(--border)'
        }}
      >
        <Bold size={14} />
      </button>

      <button
        type="button"
        style={btnStyle}
        title="高亮 (==文本==)"
        aria-label="高亮"
        data-testid="format-highlight"
        onMouseDown={(e) => handleMouseDown(e, onHighlight)}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-tertiary)'
          e.currentTarget.style.color = 'var(--text-primary)'
          e.currentTarget.style.borderColor = 'var(--accent)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--text-secondary)'
          e.currentTarget.style.borderColor = 'var(--border)'
        }}
      >
        <Highlighter size={14} />
      </button>

      <button
        type="button"
        style={btnStyle}
        title="下划线 (++文本++)"
        aria-label="下划线"
        data-testid="format-underline"
        onMouseDown={(e) => handleMouseDown(e, onUnderline)}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-tertiary)'
          e.currentTarget.style.color = 'var(--text-primary)'
          e.currentTarget.style.borderColor = 'var(--accent)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--text-secondary)'
          e.currentTarget.style.borderColor = 'var(--border)'
        }}
      >
        <Underline size={14} />
      </button>

      {onColor && (
        <>
          <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />
          <ColorPickerButton onSelectColor={onColor} />
        </>
      )}
    </div>
  )
}
