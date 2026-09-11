import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { isolateHistory } from '@codemirror/commands'
import { rangeField } from './diaryEditorState'
import { isPolishPlainText, validatePolishCandidate } from '../../utils/diaryPolish'

export interface PolishTarget { identity: string; document: string; from: number; to: number; source: string }
export function capturePolishTarget(state: EditorState, identity: string): PolishTarget | null {
  const { from, to, empty } = state.selection.main
  const source = state.sliceDoc(from, to)
  if (state.selection.ranges.length !== 1 || empty || !source.trim() || source.length > 4000 || !isPolishPlainText(source)) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return null
  // Only paragraphs and recognized strong wrappers; links, code, lists, tables,
  // headings and all other structures fail closed.
  let node = tree.resolveInner(from, 1)
  while (node.parent) {
    if (!/^(Paragraph|StrongEmphasis)$/.test(node.name) || to > node.to) return null
    node = node.parent
  }
  const ranges = state.field(rangeField)
  if (ranges.some(r => from < r.to && to > r.from && !(from >= r.contentFrom && to <= r.contentTo))) return null
  const line = state.doc.lineAt(from)
  for (const match of line.text.matchAll(/\*\*|\+\+|==|\{\/?color(?::[^}\n]*)?\}?/g)) {
    const pos = line.from + match.index
    if (!ranges.some(r => (pos >= r.from && pos + match[0].length <= r.contentFrom)
      || (pos >= r.contentTo && pos + match[0].length <= r.to))) return null
  }
  return { identity, document: state.doc.toString(), from, to, source }
}
export function polishTargetMatches(state: EditorState, identity: string, target: PolishTarget) {
  return identity === target.identity && state.doc.toString() === target.document
    && state.sliceDoc(target.from, target.to) === target.source
}
export function polishTransaction(state: EditorState, identity: string, target: PolishTarget, candidate: unknown): TransactionSpec | null {
  if (!polishTargetMatches(state, identity, target)) return null
  const insert = validatePolishCandidate(candidate, target.source)
  return { changes: { from: target.from, to: target.to, insert }, selection: { anchor: target.from + insert.length },
    annotations: [Transaction.userEvent.of('input.polish'), isolateHistory.of('full')], scrollIntoView: true }
}
