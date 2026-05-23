import { useState, useRef, useEffect } from 'react'
import { Palette } from 'lucide-react'
import { COLOR_KEYS, type MarkdownColorKey } from '../../utils/remarkColor'

interface ColorPickerButtonProps {
  onSelectColor: (color: MarkdownColorKey) => void
}

/** Display labels for each preset color. */
const COLOR_LABELS: Record<MarkdownColorKey, string> = {
  red: '红色',
  orange: '橙色',
  yellow: '黄色',
  green: '绿色',
  blue: '蓝色',
  purple: '紫色',
  gray: '灰色',
}

const triggerStyle: React.CSSProperties = {
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

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 4,
  display: 'flex',
  gap: 4,
  padding: 6,
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  zIndex: 10,
}

const swatchStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: '50%',
  border: '2px solid transparent',
  cursor: 'pointer',
  transition: 'transform 0.12s, border-color 0.12s',
  padding: 0,
  flexShrink: 0,
}

/**
 * A dropdown color picker restricted to 7 preset colors.
 *
 * Clicking the trigger button toggles a small popover with color swatches.
 * Selecting a swatch fires `onSelectColor` and closes the popover.
 * Uses `onMouseDown + preventDefault` to avoid stealing focus from a textarea.
 */
export default function ColorPickerButton({ onSelectColor }: ColorPickerButtonProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close popover on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleTrigger = (e: React.MouseEvent) => {
    e.preventDefault()
    setOpen(prev => !prev)
  }

  const handleSelect = (e: React.MouseEvent, color: MarkdownColorKey) => {
    e.preventDefault()
    onSelectColor(color)
    setOpen(false)
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        style={triggerStyle}
        title="文字颜色"
        aria-label="文字颜色"
        aria-expanded={open}
        data-testid="format-color"
        onMouseDown={handleTrigger}
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
        <Palette size={14} />
      </button>

      {open && (
        <div style={popoverStyle} data-testid="color-picker-popover" role="group" aria-label="选择颜色">
          {COLOR_KEYS.map((color) => (
            <button
              key={color}
              type="button"
              style={{
                ...swatchStyle,
                background: `var(--md-color-${color})`,
              }}
              title={COLOR_LABELS[color]}
              aria-label={COLOR_LABELS[color]}
              data-testid={`color-swatch-${color}`}
              onMouseDown={(e) => handleSelect(e, color)}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.2)'
                e.currentTarget.style.borderColor = 'var(--text-primary)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.borderColor = 'transparent'
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
