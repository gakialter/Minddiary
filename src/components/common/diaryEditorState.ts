import { Annotation, EditorSelection, EditorState, StateEffect, StateField, Transaction, type TransactionSpec } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { isolateHistory } from '@codemirror/commands'
import { insertNewlineContinueMarkupCommand, markdown } from '@codemirror/lang-markdown'
import { COLOR_WHITELIST, customTextRanges, type DialectRange, type DiaryFormat, type MarkdownColorKey } from '../../utils/markdownDialect'

// Structural commands are scoped separately; unsupported Markdown stays literal.
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

interface DiaryStructure {
  kind: 'heading' | 'list'
  from: number
  bodyFrom: number
  to: number
  level?: number
}

/** Derived parser-backed prefixes only. No block document or normalization. */
function diaryStructures(state: EditorState): DiaryStructure[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state)
  const result: DiaryStructure[] = []
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (/^ATXHeading[1-6]$/.test(node.name)) {
      const line = state.doc.lineAt(node.from)
      const prefix = /^(#{1,6})[ \t]+(?=\S)/.exec(line.text)
      if (node.from === line.from && prefix) result.push({ kind: 'heading', from: line.from,
        bodyFrom: line.from + prefix[0].length, to: line.to, level: prefix[1]!.length })
    } else if (node.name === 'BulletList') {
      for (let item = node.firstChild; item; item = item.nextSibling) {
        const line = state.doc.lineAt(item.from)
        const prefix = /^-(?:[ \t]+|$)/.exec(line.text)
        if (item.name !== 'ListItem' || item.from !== line.from || item.to > line.to || !prefix
          || /^\[[ xX]\](?:\s|$)/.test(line.text.slice(prefix[0].length))) continue
        result.push({ kind: 'list', from: line.from, bodyFrom: line.from + prefix[0].length, to: line.to })
      }
    }
  }
  return result
}

export const structureField = StateField.define<readonly DiaryStructure[]>({
  create: diaryStructures,
  update: (value, tr) => tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? diaryStructures(tr.state) : value,
})

class DiaryBullet extends WidgetType {
  eq() { return true }
  toDOM() {
    const bullet = document.createElement('span')
    bullet.className = 'diary-list-bullet'
    bullet.textContent = '•'
    bullet.setAttribute('aria-hidden', 'true')
    return bullet
  }
  ignoreEvent() { return false }
}

const continueList = insertNewlineContinueMarkupCommand({ nonTightLists: false })
function editStructure(view: EditorView, action: 'enter' | 'backspace') {
  if (view.compositionStarted || view.state.selection.ranges.length !== 1) return false
  const { state } = view
  const caret = state.selection.main
  if (!caret.empty) return false
  const structure = state.field(structureField).find(r => caret.head >= r.from && caret.head <= r.to)
  if (!structure) return false
  const resolver = inlineResolver(state)
  const atStart = resolver.sourceToVisible(caret.head) === resolver.sourceToVisible(structure.bodyFrom)
  const empty = !state.sliceDoc(structure.bodyFrom, structure.to).trim()
  const annotations = [isolateHistory.of('full'), logicalInlineEdit.of(true)]
  if ((action === 'backspace' && atStart && (structure.kind === 'heading' || empty))
    || (action === 'enter' && structure.kind === 'list' && empty)) {
    const to = empty ? structure.to : structure.bodyFrom
    view.dispatch({ changes: { from: structure.from, to },
      selection: { anchor: empty ? structure.from : Math.max(structure.bodyFrom, caret.head) - (to - structure.from) },
      annotations, userEvent: action === 'backspace' ? 'delete.backward' : 'input.structure', scrollIntoView: true })
    return true
  }
  if (action !== 'enter' || caret.head < structure.bodyFrom) return false
  if (structure.kind === 'heading') {
    // Let CM handle splitting within the body. At the end, use a plain newline.
    if (resolver.sourceToVisible(caret.head) !== resolver.sourceToVisible(structure.to)) return false
    view.dispatch({ changes: { from: structure.to, insert: state.lineBreak },
      selection: { anchor: structure.to + 1 }, annotations, userEvent: 'input.structure', scrollIntoView: true })
    return true
  }
  const commandState = resolver.sourceToVisible(caret.head) === resolver.sourceToVisible(structure.to)
    ? state.update({ selection: { anchor: structure.to }, filter: false }).state : state
  return continueList({ state: commandState, dispatch: tr => view.dispatch(state.update({ changes: tr.changes,
    selection: tr.newSelection, annotations, userEvent: 'input.structure', scrollIntoView: true })) })
}

// Templates store a bare "-". Add its required separator only on first body
// input, within that same native transaction (including IME composition).
const structureInput = EditorState.transactionFilter.of(tr => {
  if (!tr.docChanged || !tr.isUserEvent('input.type') || tr.annotation(Transaction.addToHistory) === false) return tr
  const edits: Array<{ from: number; to: number; text: string }> = []
  tr.changes.iterChanges((from, to, _a, _b, inserted) => edits.push({ from, to, text: inserted.toString() }))
  if (edits.length !== 1) return tr
  const edit = edits[0]!
  if (edit.from !== edit.to || !/^\S/.test(edit.text)) return tr
  const bare = tr.startState.field(structureField).find(r => r.kind === 'list' && r.bodyFrom === r.to
    && r.bodyFrom === edit.from && r.bodyFrom - r.from === 1)
  return bare ? [tr, { changes: { from: edit.from, insert: ' ' }, sequential: true }] : tr
})

export const structureInteraction = [structureField, structureInput, keymap.of([
  { key: 'Enter', run: view => editStructure(view, 'enter') },
  { key: 'Backspace', run: view => editStructure(view, 'backspace') },
])]

/** Coordinates are always canonical source offsets. This projection is derived
 * from positively recognized ranges and is never stored as diary data. */
export interface InlineToken { from: number; to: number }
export function inlineResolver(state: EditorState) {
  const ranges = state.field(rangeField)
  const tokens: InlineToken[] = [...ranges.filter(r => r.contentFrom < r.contentTo).flatMap(r => [
    { from: r.from, to: r.contentFrom }, { from: r.contentTo, to: r.to },
  ]), ...(state.field(structureField, false) ?? []).map(r => ({ from: r.from, to: r.bodyFrom }))]
    .sort((a, b) => a.from - b.from)
  const groups: InlineToken[] = []
  for (const token of tokens) {
    const last = groups[groups.length - 1]
    if (last && token.from <= last.to) last.to = Math.max(last.to, token.to)
    else groups.push({ ...token })
  }
  const sourceToVisible = (pos: number) => {
    let hidden = 0
    for (const token of groups) {
      if (pos <= token.from) break
      hidden += Math.min(pos, token.to) - token.from
    }
    return pos - hidden
  }
  const visibleToSource = (pos: number, affinity: -1 | 1 = 1) => {
    let hidden = 0
    for (const token of groups) {
      const boundary = token.from - hidden
      if (pos < boundary) break
      if (pos === boundary) return affinity < 0 ? token.from : token.to
      hidden += token.to - token.from
    }
    return Math.min(state.doc.length, pos + hidden)
  }
  const endpoint = (pos: number, affinity: -1 | 1 = 1) => {
    const prefix = state.field(structureField, false)?.find(r => pos >= r.from && pos < r.bodyFrom)
    if (prefix) return visibleToSource(sourceToVisible(prefix.bodyFrom), 1)
    const token = groups.find(t => pos > t.from && pos < t.to)
    return token ? affinity < 0 ? token.from : token.to : pos
  }
  return { ranges, tokens, sourceToVisible, visibleToSource, endpoint }
}

// Only balanced local rewrites, FORMAT and scoped structure actions use this checkpoint.
// Native history reads the selection at the START of the selection-only tx.
const logicalInlineEdit = Annotation.define<boolean>()
const selectionFormatted = Annotation.define<boolean>()
export const clearFormatContinuation = StateEffect.define<null>()

// This is a one-input intent, never a second source of formatting truth.
export const formatContinuationField = StateField.define<EditorSelection | null>({
  create: () => null,
  update: (intent, tr) => {
    if (tr.effects.some(effect => effect.is(clearFormatContinuation))) return null
    if (tr.annotation(selectionFormatted) && tr.docChanged && !tr.newSelection.main.empty
      && tr.newSelection.ranges.length === 1) return tr.newSelection
    if (tr.docChanged || tr.isUserEvent('undo') || tr.isUserEvent('redo')
      || !tr.newSelection.eq(tr.startState.selection)) return null
    return intent
  },
})

export function finishFormattedSelection(state: EditorState): TransactionSpec | null {
  const intent = state.field(formatContinuationField, false)
  if (!intent || !intent.eq(state.selection) || state.selection.main.empty) return null
  const resolver = inlineResolver(state)
  // Start at the logical end, then cross closing delimiters only. A neighbouring
  // opening delimiter at the same visual boundary belongs to the next text.
  let end = resolver.visibleToSource(resolver.sourceToVisible(state.selection.main.to), -1)
  for (;;) {
    const closing = resolver.ranges.find(r => r.contentTo === end && r.contentFrom < r.contentTo)
    if (!closing) break
    end = closing.to
  }
  return { changes: { from: end, insert: ' ' }, selection: { anchor: end + 1 },
    userEvent: 'input.selection-continuation', scrollIntoView: true,
    annotations: [logicalInlineEdit.of(true), isolateHistory.of('full')],
    effects: clearFormatContinuation.of(null) }
}

const continuationInput = EditorState.transactionFilter.of(tr => {
  if (!tr.docChanged || tr.annotation(Transaction.userEvent) !== 'input.type'
    || tr.annotation(Transaction.addToHistory) === false || tr.annotation(logicalInlineEdit)) return tr
  const selection = tr.startState.selection.main
  const edits: Array<{ from: number; to: number; text: string }> = []
  tr.changes.iterChanges((from, to, _a, _b, inserted) => edits.push({ from, to, text: inserted.toString() }))
  const edit = edits[0]
  if (edits.length !== 1 || edit?.text !== ' ' || edit.from !== selection.from || edit.to !== selection.to) return tr
  const finish = finishFormattedSelection(tr.startState)
  return finish ? { ...finish, filter: false } : tr
})
export function inlineEditTransactions(tr: Transaction): readonly Transaction[] {
  if (!tr.docChanged || !tr.annotation(logicalInlineEdit)
    || tr.annotation(Transaction.addToHistory) === false || tr.isUserEvent('input.type.compose')
    || tr.isUserEvent('undo') || tr.isUserEvent('redo')) return [tr]
  if (tr.startState.selection.map(tr.changes).eq(tr.newSelection)) return [tr]
  return [tr, tr.state.update({ selection: tr.newSelection, filter: false })]
}

interface LocalText { text: string; caret: number | null }
const joinLocal = (parts: LocalText[]): LocalText => {
  let text = '', caret: number | null = null
  for (const part of parts) {
    if (part.caret !== null) caret = text.length + part.caret
    text += part.text
  }
  return { text, caret }
}

/** Rebuild only intersected recognized wrappers. Native input inside an intact
 * body is left alone; FORMAT guards deliberately do not govern text deletion. */
export function balancedInlineEdit(state: EditorState, from: number, to: number, insert: string): TransactionSpec | null {
  const { ranges, tokens } = inlineResolver(state)
  const affected = ranges.filter(r => from === to
    ? from >= r.contentFrom && from <= r.contentTo
    : from < r.to && to > r.from)
  if (!affected.length) return null
  const damagesToken = tokens.some(t => from < t.to && to > t.from)
  const emptiesBody = !insert && affected.some(r => from <= r.contentFrom && to >= r.contentTo)
  const edgeWhitespace = affected.some(r => r.format === 'bold'
    && ((from <= r.contentFrom && /^\s/.test(insert)) || (to >= r.contentTo && /\s$/.test(insert))))
  if (!damagesToken && !emptiesBody && !edgeWhitespace) return null

  const start = Math.min(from, ...affected.map(r => r.from))
  const end = Math.max(to, ...affected.map(r => r.to))
  const local = ranges.filter(r => r.from >= start && r.to <= end)
  let inserted = false
  const text = (a: number, b: number): LocalText => {
    if (b < from || a > to || (inserted && from === to)) return { text: state.sliceDoc(a, b), caret: null }
    const left = state.sliceDoc(a, Math.max(a, Math.min(b, from)))
    const right = state.sliceDoc(Math.max(a, Math.min(b, to)), b)
    const added = !inserted && from >= a && from <= b ? insert : ''
    const caret = !inserted && from >= a && from <= b ? left.length + added.length : null
    if (caret !== null) inserted = true
    return { text: left + added + right, caret }
  }
  const region = (a: number, b: number, parent?: DialectRange): LocalText => {
    const children = local.filter(r => r !== parent && r.from >= a && r.to <= b
      && !local.some(other => other !== r && other !== parent && other.from >= a && other.to <= b
        && other.from <= r.from && other.to >= r.to))
      .sort((x, y) => x.from - y.from)
    const parts: LocalText[] = []
    let pos = a
    for (const child of children) {
      parts.push(text(pos, child.from), wrap(child))
      pos = child.to
    }
    parts.push(text(pos, b))
    return joinLocal(parts)
  }
  const wrap = (r: DialectRange): LocalText => {
    const body = region(r.contentFrom, r.contentTo, r)
    if (!body.text) return body
    const prefix = state.sliceDoc(r.from, r.contentFrom), suffix = state.sliceDoc(r.contentTo, r.to)
    // Markdown strong delimiters cannot enclose edge whitespace. Move only the
    // newly affected body's whitespace outside, preserving every character.
    const leading = r.format === 'bold' ? body.text.length - body.text.trimStart().length : 0
    const trailing = r.format === 'bold' ? body.text.length - body.text.trimEnd().length : 0
    if (leading + trailing >= body.text.length) return body
    const middle = body.text.slice(leading, body.text.length - trailing)
    const output = body.text.slice(0, leading) + prefix + middle + suffix + (trailing ? body.text.slice(-trailing) : '')
    const caret = body.caret === null ? null : body.caret <= leading ? body.caret
      : body.caret > body.text.length - trailing ? body.caret + prefix.length + suffix.length
      : body.caret + prefix.length
    return { text: output, caret }
  }
  const result = region(start, end)
  // Endpoints in unrecognized/unsupported structure retain native semantics.
  if (!inserted) return null
  const changes = state.changes({ from: start, to: end, insert: result.text })
  const next = state.update({ changes, filter: false }).state
  const resolver = inlineResolver(next)
  const caret = resolver.visibleToSource(resolver.sourceToVisible(start + (result.caret ?? 0)), 1)
  return { changes, selection: { anchor: caret }, scrollIntoView: true,
    annotations: [logicalInlineEdit.of(true), isolateHistory.of('full')] }
}

export const inlineEditing = EditorState.transactionFilter.of(tr => {
  if (tr.annotation(Transaction.addToHistory) === false || tr.isUserEvent('undo') || tr.isUserEvent('redo')
    || tr.isUserEvent('input.type.compose') || tr.annotation(logicalInlineEdit)) return tr
  if (tr.docChanged && (tr.isUserEvent('input.type') || tr.isUserEvent('delete'))) {
    const edits: Array<{ from: number; to: number; insert: string }> = []
    tr.changes.iterChanges((from, to, _a, _b, inserted) => edits.push({ from, to, insert: inserted.toString() }))
    if (edits.length === 1 && tr.startState.selection.ranges.length === 1) {
      const edit = edits[0]!
      const balanced = balancedInlineEdit(tr.startState, edit.from, edit.to, edit.insert)
      if (balanced) return { ...balanced, userEvent: tr.annotation(Transaction.userEvent), filter: false }
    }
  }
  if (!tr.docChanged && tr.selection) {
    const resolver = inlineResolver(tr.state)
    const selection = EditorSelection.create(tr.newSelection.ranges.map(r => {
      const forward = r.anchor <= r.head
      if (!r.empty) return EditorSelection.range(
        resolver.visibleToSource(resolver.sourceToVisible(r.anchor), forward ? 1 : -1),
        resolver.visibleToSource(resolver.sourceToVisible(r.head), forward ? -1 : 1))
      return EditorSelection.cursor(resolver.endpoint(r.head, r.assoc < 0 ? -1 : 1), r.assoc)
    }), tr.newSelection.mainIndex)
    if (!selection.eq(tr.newSelection)) return [tr, { selection, sequential: true }]
  }
  return tr
})

const tokenField = StateField.define<DecorationSet>({
  create: state => Decoration.set(inlineResolver(state).tokens.map(t => Decoration.replace({}).range(t.from, t.to)), true),
  update: (value, tr) => tr.state.field(rangeField) === tr.startState.field(rangeField) ? value
    : Decoration.set(inlineResolver(tr.state).tokens.map(t => Decoration.replace({}).range(t.from, t.to)), true),
  provide: field => EditorView.atomicRanges.of(view => view.state.field(field)),
})
function moveInlineCaret(view: EditorView, forward: boolean, extend: boolean) {
  if (view.compositionStarted) return false
  const resolver = inlineResolver(view.state)
  const selection = EditorSelection.create(view.state.selection.ranges.map(range => {
    if (!extend && !range.empty) return EditorSelection.cursor(forward ? range.to : range.from)
    let next = EditorSelection.cursor(range.head)
    const visible = resolver.sourceToVisible(range.head)
    // Native movement can stop on the far side of a replacement without moving
    // visually. Continue across only those derived tokens, using CM's own
    // grapheme/bidi movement rather than assuming one UTF-16 unit per character.
    for (let i = 0; i <= resolver.tokens.length; i++) {
      const moved = view.moveByChar(next, forward)
      if (moved.head === next.head) break
      next = moved
      if (resolver.sourceToVisible(next.head) !== visible) break
    }
    return extend ? EditorSelection.range(range.anchor, next.head) : next
  }), view.state.selection.mainIndex)
  view.dispatch({ selection, userEvent: 'select.keyboard', scrollIntoView: true })
  return true
}

export const inlineInteraction = [formatContinuationField, inlineEditing, continuationInput, tokenField,
  EditorView.domEventObservers({
    compositionstart: (_event, view) => view.dispatch({ effects: clearFormatContinuation.of(null) }),
    mousedown: (_event, view) => view.dispatch({ effects: clearFormatContinuation.of(null) }),
    keydown: (event, view) => {
      if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
        || event.isComposing || view.compositionStarted) {
        if (view.state.field(formatContinuationField)) view.dispatch({ effects: clearFormatContinuation.of(null) })
      }
    },
  }), keymap.of([
  { key: 'Space', run: view => {
    if (view.compositionStarted) return false
    const transaction = finishFormattedSelection(view.state)
    if (!transaction) return false
    view.dispatch(transaction)
    return true
  } },
  { key: 'ArrowLeft', run: view => moveInlineCaret(view, false, false) },
  { key: 'ArrowRight', run: view => moveInlineCaret(view, true, false) },
  { key: 'Shift-ArrowLeft', run: view => moveInlineCaret(view, false, true) },
  { key: 'Shift-ArrowRight', run: view => moveInlineCaret(view, true, true) },
])]

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

function hasUnknownInlineMarkers(state: EditorState, from: number) {
  const line = state.doc.lineAt(from), ranges = state.field(rangeField)
  for (const match of line.text.matchAll(/\*\*|\+\+|==|\{\/?color(?::[^}\n]*)?\}?/g)) {
    const pos = line.from + match.index
    if (!ranges.some(r => (pos >= r.from && pos + match[0].length <= r.contentFrom)
      || (pos >= r.contentTo && pos + match[0].length <= r.to))) return true
  }
  return false
}

export function formatTransaction(state: EditorState, format: DiaryFormat, color?: MarkdownColorKey | null): TransactionSpec | null {
  if (color && !COLOR_WHITELIST.has(color)) return null
  if (state.selection.ranges.length !== 1) return null
  const { from, to, anchor, head, empty } = state.selection.main
  const ranges = state.field(rangeField)
  const resolver = inlineResolver(state)
  const selectsBody = (r: DialectRange) => !empty
    && resolver.sourceToVisible(from) === resolver.sourceToVisible(r.contentFrom)
    && resolver.sourceToVisible(to) === resolver.sourceToVisible(r.contentTo)
  const contains = (r: DialectRange) => (from >= r.contentFrom && to <= r.contentTo)
    || (!empty && from === r.from && to === r.to)
  const intersects = (r: DialectRange) => empty ? from > r.from && from < r.to : from < r.to && to > r.from
  const containers = ranges.filter(contains).sort((a, b) => a.from - b.from || b.to - a.to)
  const enclosing = [...containers].reverse().find(r => r.format === format)
  const annotations = [Transaction.userEvent.of('input.format'), isolateHistory.of('full'), logicalInlineEdit.of(true),
    selectionFormatted.of(!empty)]

  // Unknown/incomplete wrappers around a selection must not be treated as plain
  // text (e.g. ++**text**++ has no recognized underline range in the reader).
  if (hasUnknownInlineMarkers(state, from)) return null

  if (enclosing) {
    const r = enclosing
    const prefix = format === 'color' && color && color !== r.color ? `{color:${color}}` : ''
    const suffix = prefix ? '{/color}' : ''
    const full = empty || selectsBody(r)
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
      if (!selectsBody(r)) return null
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

/** Clear a coherent supported selection by composing existing guarded toggles.
 * A failure in any step discards the whole operation, including partial changes.
 */
export function clearFormatTransaction(state: EditorState): TransactionSpec | null {
  if (state.selection.main.empty || state.selection.ranges.length !== 1) return null
  if (hasUnknownInlineMarkers(state, state.selection.main.from)) return null
  const resolver = inlineResolver(state)
  const from = resolver.sourceToVisible(state.selection.main.from)
  const to = resolver.sourceToVisible(state.selection.main.to)
  // Existing toggles can clear uniform containers, not heterogeneous nested
  // fragments. Reject the entire clear rather than leaving a partial result.
  if (resolver.ranges.some(r => {
    const start = resolver.sourceToVisible(r.contentFrom), end = resolver.sourceToVisible(r.contentTo)
    return from < end && to > start && (from < start || to > end)
  })) return null
  let current = state
  let changes = state.changes([])
  for (const kind of ['bold', 'underline', 'highlight', 'color'] as const) {
    if (!activeFormats(current)[kind]) continue
    const spec = formatTransaction(current, kind, kind === 'color' ? null : undefined)
    if (!spec) return null
    const tr = current.update({ ...spec, filter: false })
    changes = changes.compose(tr.changes)
    current = tr.state
  }
  if (changes.empty) return { effects: clearFormatContinuation.of(null) }
  return { changes, selection: current.selection, scrollIntoView: true,
    annotations: [Transaction.userEvent.of('input.format.clear'), isolateHistory.of('full'),
      logicalInlineEdit.of(true), selectionFormatted.of(true)] }
}

function previewDecorations(state: EditorState): DecorationSet {
  const decorations = []
  for (const r of state.field(structureField, false) ?? []) {
    decorations.push(Decoration.line({ class: r.kind === 'heading' ? `diary-heading diary-heading-${r.level}` : 'diary-list-item' }).range(r.from))
    decorations.push(Decoration.replace(r.kind === 'list' ? { widget: new DiaryBullet() } : {}).range(r.from, r.bodyFrom))
  }
  for (const r of state.field(rangeField)) {
    if (r.contentFrom >= r.contentTo) continue
    decorations.push(Decoration.mark({ class: r.format === 'color' ? `md-color-${r.color}` : `diary-format-${r.format}` }).range(r.contentFrom, r.contentTo))
    decorations.push(Decoration.replace({}).range(r.from, r.contentFrom))
    decorations.push(Decoration.replace({}).range(r.contentTo, r.to))
  }
  return Decoration.set(decorations, true)
}

export const previewField = StateField.define<DecorationSet>({
  create: previewDecorations,
  update: (value, tr) => tr.docChanged || tr.selection || tr.state.field(rangeField) !== tr.startState.field(rangeField) ? previewDecorations(tr.state) : value,
  provide: field => EditorView.decorations.from(field),
})
