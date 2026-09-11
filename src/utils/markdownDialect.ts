/** The custom text-node grammar used by both remark and the writing surface.
 * Deliberately single-line and non-empty, matching existing stored diaries.
 */
export const TEXT_FORMAT_SOURCE = '==((?:(?!==).)+)==|\\+\\+((?:(?!\\+\\+).)+)\\+\\+'
export const COLOR_SOURCE = '\\{color:([a-z]+)\\}((?:(?!\\{\\/color\\}).)+)\\{\\/color\\}'

export const COLOR_KEYS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const
export type MarkdownColorKey = typeof COLOR_KEYS[number]
export const COLOR_WHITELIST: ReadonlySet<string> = new Set(COLOR_KEYS)

export type DiaryFormat = 'bold' | 'underline' | 'highlight' | 'color'
export interface DialectRange {
  from: number
  to: number
  contentFrom: number
  contentTo: number
  format: DiaryFormat
  color?: MarkdownColorKey
}

/** Mirrors remarkTextFormatting → remarkColor order, including text-node boundaries.
 * Nested same/custom wrappers which the reading pipeline doesn't expand stay source.
 */
export function customTextRanges(text: string, offset = 0): DialectRange[] {
  const result: DialectRange[] = []
  const colors = (start: number, end: number) => {
    for (const match of text.slice(start, end).matchAll(new RegExp(COLOR_SOURCE, 'g'))) {
      if (!COLOR_WHITELIST.has(match[1]!)) continue
      const from = offset + start + match.index
      // Ambiguous nested colors are editable source, never hidden.
      if (match[2]!.includes('{color:')) continue
      result.push({ from, to: from + match[0].length,
        contentFrom: from + match[1]!.length + 8, contentTo: from + match[0].length - 8,
        format: 'color', color: match[1] as MarkdownColorKey })
    }
  }
  let previous = 0
  for (const match of text.matchAll(new RegExp(TEXT_FORMAT_SOURCE, 'g'))) {
    colors(previous, match.index)
    const from = offset + match.index
    result.push({ from, to: from + match[0].length, contentFrom: from + 2,
      contentTo: from + match[0].length - 2, format: match[1] !== undefined ? 'highlight' : 'underline' })
    colors(match.index + 2, match.index + match[0].length - 2)
    previous = match.index + match[0].length
  }
  colors(previous, text.length)
  return result
}
