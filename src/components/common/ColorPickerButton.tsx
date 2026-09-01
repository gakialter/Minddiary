import { useState, useRef, useEffect, useId } from 'react'
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

/**
 * A dropdown color picker restricted to 7 preset colors.
 *
 * Clicking the trigger button toggles a small popover with color swatches.
 * Selecting a swatch fires `onSelectColor` and closes the popover.
 * Uses `onMouseDown + preventDefault` to avoid stealing focus from a textarea.
 */
export default function ColorPickerButton({ onSelectColor }: ColorPickerButtonProps) {
  const [open, setOpen] = useState(false)
  const popoverId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstSwatchRef = useRef<HTMLButtonElement>(null)
  const focusFirstSwatchRef = useRef(false)
  const restoreTriggerIfFocusIsLostRef = useRef(false)

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

  useEffect(() => {
    if (open && focusFirstSwatchRef.current) {
      focusFirstSwatchRef.current = false
      firstSwatchRef.current?.focus()
    }

    if (!open && restoreTriggerIfFocusIsLostRef.current) {
      restoreTriggerIfFocusIsLostRef.current = false
      if (document.activeElement === document.body) triggerRef.current?.focus()
    }
  }, [open])

  const handleTriggerMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    focusFirstSwatchRef.current = false
    setOpen(prev => !prev)
  }

  const handleTriggerClick = (e: React.MouseEvent) => {
    if (e.detail !== 0) return
    if (!open) focusFirstSwatchRef.current = true
    setOpen(prev => !prev)
  }

  const selectColor = (color: MarkdownColorKey, restoreTriggerIfFocusIsLost = false) => {
    restoreTriggerIfFocusIsLostRef.current = restoreTriggerIfFocusIsLost
    setOpen(false)
    onSelectColor(color)
  }

  const handleSelectMouseDown = (e: React.MouseEvent, color: MarkdownColorKey) => {
    if (e.button !== 0) return
    e.preventDefault()
    selectColor(color)
  }

  const handleSelectClick = (e: React.MouseEvent, color: MarkdownColorKey) => {
    if (e.detail === 0) selectColor(color, true)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || !open) return
    e.preventDefault()
    e.stopPropagation()
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={containerRef} className="color-picker" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="format-toolbar__button color-picker__trigger"
        title="文字颜色"
        aria-label="文字颜色"
        aria-expanded={open}
        aria-controls={popoverId}
        data-testid="format-color"
        onMouseDown={handleTriggerMouseDown}
        onClick={handleTriggerClick}
      >
        <Palette size={15} aria-hidden="true" />
      </button>

      {open && (
        <div id={popoverId} className="color-picker__popover" data-testid="color-picker-popover" role="group" aria-label="选择颜色">
          {COLOR_KEYS.map((color, index) => (
            <button
              ref={index === 0 ? firstSwatchRef : undefined}
              key={color}
              type="button"
              className="color-picker__swatch"
              style={{ backgroundColor: `var(--md-color-${color})` }}
              title={COLOR_LABELS[color]}
              aria-label={COLOR_LABELS[color]}
              data-testid={`color-swatch-${color}`}
              onMouseDown={(e) => handleSelectMouseDown(e, color)}
              onClick={(e) => handleSelectClick(e, color)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
