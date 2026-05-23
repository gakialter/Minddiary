import { useCallback, type RefObject } from 'react'
import { COLOR_WHITELIST, type MarkdownColorKey } from '../utils/remarkColor'

/**
 * Describes a Markdown format that wraps selected text with a prefix and suffix.
 */
export interface TextFormat {
  /** Characters to insert before the selection, e.g. `**` */
  prefix: string
  /** Characters to insert after the selection, e.g. `**` */
  suffix: string
  /** Placeholder text when nothing is selected */
  placeholder: string
}

export const FORMAT_BOLD: TextFormat = {
  prefix: '**',
  suffix: '**',
  placeholder: '粗体文本',
}

export const FORMAT_HIGHLIGHT: TextFormat = {
  prefix: '==',
  suffix: '==',
  placeholder: '高亮文本',
}

export const FORMAT_UNDERLINE: TextFormat = {
  prefix: '++',
  suffix: '++',
  placeholder: '下划线文本',
}

/**
 * Apply a text format to a textarea element.
 *
 * - If text is selected, wraps the selection with prefix/suffix.
 * - If no text is selected, inserts prefix + placeholder + suffix and selects the placeholder.
 *
 * Returns the new full text value, or null if the textarea ref is unavailable.
 */
export function applyTextFormat(
  textarea: HTMLTextAreaElement,
  format: TextFormat,
): string {
  const { prefix, suffix, placeholder } = format
  const { selectionStart, selectionEnd, value } = textarea

  const before = value.slice(0, selectionStart)
  const selected = value.slice(selectionStart, selectionEnd)
  const after = value.slice(selectionEnd)

  const hasSelection = selectionStart !== selectionEnd && selected.length > 0
  const insertText = hasSelection ? selected : placeholder
  const newValue = before + prefix + insertText + suffix + after

  // We need to set the value synchronously so the cursor position sticks.
  // React controlled inputs will reconcile on the next render via onChange.
  textarea.value = newValue

  if (hasSelection) {
    // Place cursor right after the closing suffix
    const cursorPos = selectionStart + prefix.length + insertText.length + suffix.length
    textarea.setSelectionRange(cursorPos, cursorPos)
  } else {
    // Select the placeholder text so the user can immediately type over it
    const placeholderStart = selectionStart + prefix.length
    const placeholderEnd = placeholderStart + placeholder.length
    textarea.setSelectionRange(placeholderStart, placeholderEnd)
  }

  textarea.focus()
  return newValue
}

/**
 * React hook that provides format action callbacks for a textarea.
 *
 * @param textareaRef - React ref pointing to the target textarea element
 * @param onValueChange - Callback invoked with the new text value after formatting.
 *                        The caller should use this to update React state (e.g. setContent).
 */
export function useTextFormat(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  onValueChange: (newValue: string) => void,
) {
  const applyFormat = useCallback(
    (format: TextFormat) => {
      const textarea = textareaRef.current
      if (!textarea) return
      const newValue = applyTextFormat(textarea, format)
      onValueChange(newValue)
    },
    [textareaRef, onValueChange],
  )

  const bold = useCallback(() => applyFormat(FORMAT_BOLD), [applyFormat])
  const highlight = useCallback(() => applyFormat(FORMAT_HIGHLIGHT), [applyFormat])
  const underline = useCallback(() => applyFormat(FORMAT_UNDERLINE), [applyFormat])

  const color = useCallback(
    (colorKey: MarkdownColorKey) => {
      if (!COLOR_WHITELIST.has(colorKey)) return
      applyFormat({
        prefix: `{color:${colorKey}}`,
        suffix: '{/color}',
        placeholder: '彩色文本',
      })
    },
    [applyFormat],
  )

  return { bold, highlight, underline, color, applyFormat }
}
