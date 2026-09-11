import { EditorState, StateField, Transaction, type TransactionSpec } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { isolateHistory } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { COLOR_WHITELIST, customTextRanges, type DialectRange, type DiaryFormat, type MarkdownColorKey } from '../../utils/markdownDialect'

// Parsing support only. Pasting/Enter keep ordinary text-editing semantics.
export const diaryMarkdown = markdown({ addKeymap: false, completeHTMLTags: false, pasteURLAsLink: false })

/** Only inspect Markdown text gaps. Code, escapes, HTML, URLs and syntax nodes
 * are excluded by the official parser, rather than guessed with a code regex.
 */
export function diaryRanges(state: EditorState): DialectRange[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state)
  const result: DialectRange[] = []
  const textContainers = /^(Paragraph|ATXHeading[1-6]|SetextHeading[12]|StrongEmphasis|Emphasis|Link|Strikethrough)$/
  const visit = (node: typeof tree.topNode) => {
    if (/^(FencedCode|CodeBlock|InlineCode|HTMLBlock|HTMLTag|Autolink|Image)$/.test(node.name)) return
    if (node.name === 'StrongEmphasis') {
      result.push({ from: node.from, to: node.to, contentFrom: node.from + 2,
        contentTo: node.to - 2, format: 'bold' })
    }
    let previous = node.from
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (textContainers.test(node.name) && previous < child.from) {
        result.push(...customTextRanges(state.sliceDoc(previous, child.from), previous))
      }
      visit(child)
      previous = child.to
    }
    if (textContainers.test(node.name) && previous < node.to) {
      result.push(...customTextRanges(state.sliceDoc(previous, node.to), previous))
    }
  }
  visit(tree.topNode)
  return result
}

export const rangeField = StateField.define<readonly DialectRange[]>({
  create: diaryRanges,
  update: (ranges, tr) => tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? diaryRanges(tr.state) : ranges,
})

export function activeFormats(state: EditorState) {
  const { from, to, empty } = state.selection.main
  const ranges = state.field(rangeField)
  const contains = (r: DialectRange) => empty
    ? from >= r.contentFrom && to <= r.contentTo
    : (from >= r.contentFrom && to <= r.contentTo) || (from === r.from && to === r.to)
  const active = (format: DiaryFormat) => ranges.find(r => r.format === format && contains(r))
  return { bold: !!active('bold'), underline: !!active('underline'), highlight: !!active('highlight'),
    color: active('color')?.color }
}

// The reading pipeline can represent bold → underline OR highlight → color.
// This is an ordering rule for toolbar edits, not a second Markdown parser.
const wrapperOrder: Record<DiaryFormat, number> = { bold: 0, underline: 1, highlight: 1, color: 2 }
const isPlainFragment = (text: string) => !/[\n\r`*_\\[\]<>]|\+\+|==|\{\/?color/.test(text)

export function formatTransaction(state: EditorState, format: DiaryFormat, color?: MarkdownColorKey | null): TransactionSpec | null {
  if (color && !COLOR_WHITELIST.has(color)) return null
  const { from, to, anchor, head, empty } = state.selection.main
  const ranges = state.field(rangeField)
  const contains = (r: DialectRange) => (from >= r.contentFrom && to <= r.contentTo)
    || (!empty && from === r.from && to === r.to)
  const intersects = (r: DialectRange) => empty ? from > r.from && from < r.to : from < r.to && to > r.from
  const containers = ranges.filter(contains).sort((a, b) => a.from - b.from || b.to - a.to)
  const enclosing = [...containers].reverse().find(r => r.format === format)
  const annotations = [Transaction.userEvent.of('input.format'), isolateHistory.of('full')]

  // Unknown/incomplete wrappers around a selection must not be treated as plain
  // text (e.g. ++**text**++ has no recognized underline range in the reader).
  const line = state.doc.lineAt(from)
  for (const match of line.text.matchAll(/\*\*|\+\+|==|\{\/?color(?::[^}\n]*)?\}?/g)) {
    const pos = line.from + match.index
    if (!ranges.some(r => (pos >= r.from && pos + match[0].length <= r.contentFrom)
      || (pos >= r.contentTo && pos + match[0].length <= r.to))) return null
  }

  if (enclosing) {
    const r = enclosing
    const prefix = format === 'color' && color && color !== r.color ? `{color:${color}}` : ''
    const suffix = prefix ? '{/color}' : ''
    const full = empty || (from === r.contentFrom && to === r.contentTo) || (from === r.from && to === r.to)
    if (!full) {
      // Splitting nested/structural content is deliberately unsupported. Never
      // silently widen a non-empty sub-selection to its enclosing wrapper.
      const inner = state.sliceDoc(r.contentFrom, r.contentTo)
      if (!isPlainFragment(inner) || ranges.some(other => other !== r && other.from < r.to && other.to > r.from)) return null
      const oldPrefix = state.sliceDoc(r.from, r.contentFrom)
      const oldSuffix = state.sliceDoc(r.contentTo, r.to)
      const left = state.sliceDoc(r.contentFrom, from)
      const selected = state.sliceDoc(from, to)
      const right = state.sliceDoc(to, r.contentTo)
      // Strong emphasis cannot reliably wrap fragments with edge whitespace.
      if (format === 'bold' && [left, right].some(text => text && text !== text.trim())) return null
      const wrap = (text: string) => text ? oldPrefix + text + oldSuffix : ''
      const before = wrap(left)
      const start = r.from + before.length + prefix.length
      const end = start + selected.length
      return { changes: { from: r.from, to: r.to, insert: before + prefix + selected + suffix + wrap(right) },
        selection: { anchor: anchor <= head ? start : end, head: anchor <= head ? end : start },
        annotations, scrollIntoView: true }
    }
    const changes = state.changes([{ from: r.from, to: r.contentFrom, insert: prefix },
      { from: r.contentTo, to: r.to, insert: suffix }])
    const map = (pos: number) => changes.mapPos(Math.max(r.contentFrom, Math.min(pos, r.contentTo)), pos === r.contentTo ? -1 : 1)
    return { changes, selection: { anchor: map(anchor), head: map(head) }, annotations, scrollIntoView: true }
  }
  if (format === 'color' && !color) return null
  if (ranges.some(r => intersects(r) && (!contains(r) || r.format === format))) return null
  if (containers.some(r => r.format !== format && wrapperOrder[r.format] === wrapperOrder[format])) return null
  let node = syntaxTree(state).resolveInner(from, 1)
  while (node.parent) {
    if (/^(InlineCode|FencedCode|CodeBlock|HTMLBlock)$/.test(node.name)) return null
    node = node.parent
  }

  let start = from, end = to
  for (const r of containers) {
    if (wrapperOrder[r.format] > wrapperOrder[format]) {
      // Promote only a complete selected format. A sub-selection would require
      // nested splitting, so refuse it rather than changing its neighbours.
      if (empty || !((from === r.contentFrom && to === r.contentTo) || (from === r.from && to === r.to))) return null
      start = Math.min(start, r.from)
      end = Math.max(end, r.to)
    } else if (from === r.from && to === r.to) {
      start = r.contentFrom
      end = r.contentTo
    }
  }
  // Strip only recognized, completely included wrappers when checking text.
  let plain = ''
  for (let pos = start; pos < end; pos++) {
    if (!ranges.some(r => r.from >= start && r.to <= end
      && ((pos >= r.from && pos < r.contentFrom) || (pos >= r.contentTo && pos < r.to)))) plain += state.sliceDoc(pos, pos + 1)
  }
  if (!isPlainFragment(plain) || (!empty && !plain.trim())) return null
  const prefix = format === 'bold' ? '**' : format === 'underline' ? '++' : format === 'highlight' ? '==' : `{color:${color}}`
  const suffix = format === 'color' ? '{/color}' : prefix
  if (empty) {
    const text = { bold: '粗体文本', underline: '下划线文本', highlight: '高亮文本', color: '彩色文本' }[format]
    return { changes: { from, insert: prefix + text + suffix }, selection: { anchor: from + prefix.length, head: from + prefix.length + text.length }, annotations, scrollIntoView: true }
  }
  const selected = state.sliceDoc(start, end)
  start += selected.length - selected.trimStart().length
  end -= selected.length - selected.trimEnd().length
  const changes = state.changes([{ from: start, insert: prefix }, { from: end, insert: suffix }])
  const map = (pos: number) => changes.mapPos(Math.max(start, Math.min(pos, end)), pos >= end ? -1 : 1)
  return { changes, selection: { anchor: map(anchor), head: map(head) }, annotations, scrollIntoView: true }
}

function previewDecorations(state: EditorState): DecorationSet {
  const decorations = []
  for (const r of state.field(rangeField)) {
    if (r.contentFrom >= r.contentTo) continue
    decorations.push(Decoration.mark({ class: r.format === 'color' ? `md-color-${r.color}` : `diary-format-${r.format}` }).range(r.contentFrom, r.contentTo))
    const editing = state.selection.ranges.some(s => s.empty
      ? s.from >= r.from && s.to <= r.to
      : s.from < r.to && s.to > r.from)
    if (!editing) {
      decorations.push(Decoration.replace({}).range(r.from, r.contentFrom))
      decorations.push(Decoration.replace({}).range(r.contentTo, r.to))
    }
  }
  return Decoration.set(decorations, true)
}

export const previewField = StateField.define<DecorationSet>({
  create: previewDecorations,
  update: (value, tr) => tr.docChanged || tr.selection || tr.state.field(rangeField) !== tr.startState.field(rangeField) ? previewDecorations(tr.state) : value,
  provide: field => EditorView.decorations.from(field),
})
