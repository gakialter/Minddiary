import { describe, expect, it, vi } from 'vitest'
import { EditorState, StateEffect, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, undo, redo, undoDepth, redoDepth } from '@codemirror/commands'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownRenderer from '../src/components/common/MarkdownRenderer'
import { activeFormats, clearFormatContinuation, clearFormatTransaction, diaryMarkdown, finishFormattedSelection, formatContinuationField, formatTransaction, inlineEditTransactions, inlineInteraction, inlineResolver, rangeField, previewField, structureInteraction, structureField } from '../src/components/common/diaryEditorState'
import type { DiaryFormat, MarkdownColorKey } from '../src/utils/markdownDialect'

const create = (doc: string, anchor = 0, head = anchor) => EditorState.create({ doc,
  selection: { anchor, head }, extensions: [diaryMarkdown, history(), rangeField, previewField] })
const format = (state: EditorState, kind: DiaryFormat, color?: MarkdownColorKey | null) => {
  const tr = formatTransaction(state, kind, color)
  return tr ? state.update(tr).state : state
}

function productionView(doc: string, anchor = 0, head = anchor) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({ parent, state: EditorState.create({ doc, selection: { anchor, head },
    extensions: [diaryMarkdown, history(), rangeField, structureInteraction, previewField, inlineInteraction] }),
    dispatchTransactions: (transactions, target) => target.update(transactions.flatMap(inlineEditTransactions)),
  })
  return { view, close: () => { view.destroy(); parent.remove() } }
}

describe('production diary structure editing', () => {
  const press = (view: EditorView, key: string) => {
    view.focus()
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }))
  }

  it.each([
    ['## 标题', '标题'], ['# 一级', '一级'], ['###### 六级', '六级'],
    ['- 第一项', '•第一项'], ['-', '•'], ['- ', '•'], ['- \t', '•'],
    ['## **重点**', '重点'], ['- **重点**', '•重点'],
    ['- {color:green}复习{/color}', '•复习'], ['## **=={color:green}重点{/color}==**', '重点'],
    ['- ++下划线++ ==高亮==', '•下划线 高亮'],
  ])('projects recognized prefixes and inline wrappers without rewriting %s', (doc, visible) => {
    const { view, close } = productionView(doc)
    try {
      for (let pos = 0; pos <= doc.length; pos++) {
        view.dispatch({ selection: { anchor: pos } })
        expect(view.contentDOM.textContent).toBe(visible)
        expect(view.state.doc.toString()).toBe(doc)
      }
      expect(undoDepth(view.state)).toBe(0)
    } finally { close() }
  })

  it.each([
    ['## 标题', 5, 'Enter', '## 标题\n', 6],
    ['## 标题', 3, 'Backspace', '标题', 0],
    ['## **重点**', 5, 'Backspace', '**重点**', 2],
    ['## **重点**', 7, 'Enter', '## **重点**\n', 10],
    ['- 第一项', 5, 'Enter', '- 第一项\n- ', 8],
    ['- **重点**', 6, 'Enter', '- **重点**\n- ', 11],
    ['- 第一项\n- ', 8, 'Enter', '- 第一项\n', 6],
    ['- 第一项\n- ', 8, 'Backspace', '- 第一项\n', 6],
    ['-', 1, 'Enter', '', 0], ['-', 1, 'Backspace', '', 0],
    ['- \t', 3, 'Backspace', '', 0],
  ] as const)('one native history event: %s at %i %s', (doc, anchor, key, expected, caret) => {
    const { view, close } = productionView(doc, anchor)
    try {
      press(view, key)
      expect(view.state.doc.toString()).toBe(expected)
      expect(view.state.selection.main.head).toBe(caret)
      expect(undoDepth(view.state)).toBe(1)
      expect(undo(view)).toBe(true)
      expect(view.state.doc.toString()).toBe(doc)
      expect(undoDepth(view.state)).toBe(0)
      expect(redo(view)).toBe(true)
      expect(view.state.doc.toString()).toBe(expected)
      expect(view.state.selection.main.head).toBe(caret)
    } finally { close() }
  })

  it('edits Chinese/English bodies, continues a list and isolates structure from text history', () => {
    const { view, close } = productionView('## 标题\n- 第一项', 5)
    try {
      view.dispatch({ changes: { from: 5, insert: '中文 English' }, selection: { anchor: 15 }, userEvent: 'input.type' })
      expect(view.state.doc.toString()).toBe('## 标题中文 English\n- 第一项')
      view.dispatch({ selection: { anchor: view.state.doc.length } })
      press(view, 'Enter')
      const continued = view.state.doc.toString()
      view.dispatch({ ...view.state.replaceSelection('第二项'), userEvent: 'input.type' })
      expect(view.state.doc.toString()).toBe('## 标题中文 English\n- 第一项\n- 第二项')
      undo(view)
      expect(view.state.doc.toString()).toBe(continued)
      undo(view)
      expect(view.state.doc.toString()).toBe('## 标题中文 English\n- 第一项')
      redo(view); redo(view)
      expect(view.state.doc.toString()).toBe('## 标题中文 English\n- 第一项\n- 第二项')
    } finally { close() }
  })

  it.each(['## 标题', '- 第一项'])('leaves native composition intact and guards structural keys: %s', doc => {
    const { view, close } = productionView(doc, doc.length)
    try {
      const composing = vi.spyOn(view, 'compositionStarted', 'get').mockReturnValue(true)
      press(view, 'Enter'); press(view, 'Backspace')
      expect(view.state.doc.toString()).toBe(doc)
      const tr = view.state.update({ changes: { from: doc.length, insert: '中文' },
        selection: { anchor: doc.length + 2 }, userEvent: 'input.type.compose' })
      expect(inlineEditTransactions(tr)).toEqual([tr])
      view.dispatch(tr)
      expect(view.state.doc.toString()).toBe(doc + '中文')
      composing.mockRestore()
      undo(view); expect(view.state.doc.toString()).toBe(doc)
      redo(view); expect(view.state.doc.toString()).toBe(doc + '中文')
    } finally { close() }
  })

  it.each(['input.type', 'input.type.compose', 'input.type.compose.start'])('adds the bare template separator in one %s transaction', userEvent => {
    const { view, close } = productionView('-', 1)
    try {
      const tr = view.state.update({ changes: { from: 1, insert: '中文' }, selection: { anchor: 3 }, userEvent })
      expect(tr.state.doc.toString()).toBe('- 中文')
      expect(tr.newSelection.main.head).toBe(4)
      expect(inlineEditTransactions(tr)).toEqual([tr])
      view.dispatch(tr)
      expect(view.contentDOM.textContent).toBe('•中文')
      expect(undoDepth(view.state)).toBe(1)
      undo(view); expect(view.state.doc.toString()).toBe('-')
      redo(view); expect(view.state.doc.toString()).toBe('- 中文')
    } finally { close() }
  })

  it.each([
    '## 标题', '标题\n===', '标题\n---', '- 第一项\n- 第二项', '* 第一项', '+ 第一项',
    '1. 第一项', '- [ ] 待办', '- [x] 完成', '- 外层\n  - 内层',
    '```\n## 代码\n- 代码\n```', '    ## 代码\n    - 代码', '\\## 转义\n\\- 转义',
    '##无空格', '####### 太多', '## ', '-无空格', '--', '> ## 引用\n> - 项目',
  ])('retains legacy canonical bytes through navigation and external no-history sync: %s', doc => {
    const { view, close } = productionView(doc)
    try {
      for (let pos = 0; pos <= doc.length; pos++) view.dispatch({ selection: { anchor: pos } })
      expect(view.state.doc.toString()).toBe(doc)
      expect(undoDepth(view.state)).toBe(0)
      view.dispatch({ changes: { from: 0, to: doc.length, insert: doc }, annotations: Transaction.addToHistory.of(false) })
      expect(view.state.doc.toString()).toBe(doc)
      expect(undoDepth(view.state)).toBe(0)
      if (!/^(## 标题|- 第一项)/.test(doc)) expect(view.state.field(structureField)).toHaveLength(0)
    } finally { close() }
  })

  it.each(['* 第一项', '+ 第一项', '1. 第一项', '- [ ] 待办', '- [x] 完成', '##无空格', '## '])('keeps unsupported Enter on ordinary CM text semantics: %s', doc => {
    const { view, close } = productionView(doc, doc.length)
    try {
      view.dispatch({ effects: StateEffect.appendConfig.of(keymap.of(defaultKeymap)) })
      press(view, 'Enter')
      expect(view.state.doc.toString()).toBe(doc + '\n')
    } finally { close() }
  })
})

describe('production inline projection, balanced edits and native history', () => {
  it('derives nested tokens, body coordinates and inside/outside boundary affinity', () => {
    const state = create('**=={color:green}重点{/color}==**')
    const resolver = inlineResolver(state)
    expect(resolver.tokens).toHaveLength(6)
    const body = state.doc.toString().indexOf('重点')
    expect(resolver.sourceToVisible(body)).toBe(0)
    expect(resolver.sourceToVisible(body + 2)).toBe(2)
    expect(resolver.visibleToSource(0, 1)).toBe(body)
    expect(resolver.visibleToSource(0, -1)).toBe(0)
    expect(resolver.visibleToSource(2, -1)).toBe(body + 2)
    expect(resolver.visibleToSource(2, 1)).toBe(state.doc.length)
    expect(resolver.endpoint(1, 1)).toBe(body)
    expect(resolver.endpoint(body + 1)).toBe(body + 1)
  })

  it.each([
    ['**abcdef**', 4, 6, 'bold', '**ab**cd**ef**'],
    ['++abcdef++', 4, 6, 'underline', '++ab++cd++ef++'],
    ['==abcdef==', 4, 6, 'highlight', '==ab==cd==ef=='],
  ] as const)('fixture A: partial %s toggle keeps selected text and one native undo event', (original, a, h, kind, result) => {
    const { view, close } = productionView(original, a, h)
    try {
      view.dispatch(formatTransaction(view.state, kind)!)
      const selection = view.state.selection
      expect(view.state.doc.toString()).toBe(result)
      expect(view.state.sliceDoc(selection.main.from, selection.main.to)).toBe('cd')
      expect(undoDepth(view.state)).toBe(1)
      expect(undo(view)).toBe(true)
      expect(view.state.doc.toString()).toBe(original)
      expect(redo(view)).toBe(true)
      expect(view.state.doc.toString()).toBe(result)
      expect(view.state.selection.eq(selection)).toBe(true)
    } finally { close() }
  })

  it.each([
    ['mixed B', '**ab** ==cd==', 3, 10, '', '**a**==d==', 7],
    ['cross', '**ab** ==cd==', 3, 10, ' ', '**a** ==d==', 8],
    ['leading', '**ab**', 2, 2, ' ', ' **ab**', 3],
    ['trailing', '**ab**', 4, 4, ' ', '**ab** ', 7],
    ['whole bold C', '**x**', 2, 3, '', '', 0],
    ['whole underline C', '++x++', 2, 3, '', '', 0],
    ['whole highlight C', '==x==', 2, 3, '', '', 0],
    ['whole color C', '{color:green}x{/color}', 13, 14, '', '', 0],
    ['whole nested C', '**=={color:green}重点{/color}==**', 17, 19, '', '', 0],
  ] as const)('%s: locks canonical result and exact post/redo source caret', (_name, original, a, h, insert, result, caret) => {
    const { view, close } = productionView(original, a, h)
    try {
      view.dispatch({ changes: { from: a, to: h, insert }, selection: { anchor: a + insert.length },
        userEvent: insert ? 'input.type' : 'delete.selection' })
      expect(view.state.doc.toString()).toBe(result)
      expect(view.state.selection.main).toMatchObject({ anchor: caret, head: caret })
      const resolver = inlineResolver(view.state)
      expect(resolver.tokens.some(t => caret > t.from && caret < t.to)).toBe(false)
      expect(undoDepth(view.state)).toBe(1)
      expect(undo(view)).toBe(true)
      expect(view.state.doc.toString()).toBe(original)
      expect(undoDepth(view.state)).toBe(0)
      expect(redoDepth(view.state)).toBe(1)
      expect(redo(view)).toBe(true)
      expect(view.state.doc.toString()).toBe(result)
      expect(view.state.selection.main).toMatchObject({ anchor: caret, head: caret })
      expect(undoDepth(view.state)).toBe(1)
    } finally { close() }
  })

  it('adds bold then highlight around color with the existing grammar and visible body selection', () => {
    const original = '{color:green}重点{/color}'
    const { view, close } = productionView(original, 13, 15)
    try {
      view.dispatch(formatTransaction(view.state, 'bold')!)
      view.dispatch(formatTransaction(view.state, 'highlight')!)
      expect(view.state.doc.toString()).toBe('**=={color:green}重点{/color}==**')
      expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('重点')
      expect(view.dom.textContent).toBe('重点')
      view.dispatch({ selection: { anchor: 18 } })
      expect(view.dom.textContent).toBe('重点')
      expect(undoDepth(view.state)).toBe(2)
    } finally { close() }
  })

  it.each([[13, 25], [25, 13], [0, 25]] as const)('resolves a mouse/full visible color selection (%s,%s) before nested FORMAT', (anchor, head) => {
    const { view, close } = productionView('{color:green}重点文字{/color}')
    try {
      view.dispatch({ selection: { anchor, head }, userEvent: 'select.pointer' })
      expect(view.state.selection.main).toMatchObject({ from: 13, to: 17 })
      view.dispatch(formatTransaction(view.state, 'bold')!)
      view.dispatch(formatTransaction(view.state, 'highlight')!)
      expect(view.state.doc.toString()).toBe('**=={color:green}重点文字{/color}==**')
      expect(view.dom.textContent).toBe('重点文字')
    } finally { close() }
  })

  it('extends native keyboard selection across hidden closers/openers without getting stuck on their shared visible boundary', () => {
    const { view, close } = productionView('**ab** ==cd==', 3)
    try {
      view.focus()
      for (const expected of [4, 7, 10]) {
        view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true, bubbles: true }))
        expect(view.state.selection.main.head).toBe(expected)
      }
      view.dispatch({ changes: { from: 3, to: 10, insert: '' }, userEvent: 'delete.selection' })
      expect(view.state.doc.toString()).toBe('**a**==d==')
    } finally { close() }
  })

  it('records checkpoints only for logical rewrites, excluding native compose, sync, history and safe input', () => {
    const state = EditorState.create({ doc: '**ab**', selection: { anchor: 3 },
      extensions: [diaryMarkdown, history(), rangeField, previewField, inlineInteraction] })
    for (const userEvent of ['input.type.compose', 'input.type.compose.start', 'input.type']) {
      const tr = state.update({ changes: { from: 3, insert: '中' }, selection: { anchor: 4 }, userEvent })
      expect(inlineEditTransactions(tr)).toEqual([tr])
      expect(tr.state.doc.toString()).toBe('**a中b**')
    }
    const composeBoundary = state.update({ changes: { from: 2, insert: '中' }, selection: { anchor: 3 }, userEvent: 'input.type.compose' })
    expect(inlineEditTransactions(composeBoundary)).toEqual([composeBoundary])
    const sync = state.update({ changes: { from: 0, to: 6, insert: 'external' }, annotations: Transaction.addToHistory.of(false) })
    expect(inlineEditTransactions(sync)).toEqual([sync])
    expect(undoDepth(sync.state)).toBe(0)
    const navigation = state.update({ selection: { anchor: 4 } })
    expect(inlineEditTransactions(navigation)).toEqual([navigation])
    expect(undoDepth(navigation.state)).toBe(0)
  })

  it('keeps A → format → B as three document actions, with navigation creating no document events', () => {
    const { view, close } = productionView('')
    try {
      view.dispatch({ changes: { from: 0, insert: 'A' }, selection: { anchor: 1 }, userEvent: 'input.type' })
      view.dispatch({ selection: { anchor: 0, head: 1 } })
      view.dispatch(formatTransaction(view.state, 'bold')!)
      view.dispatch({ selection: { anchor: 3 } })
      view.dispatch({ changes: { from: 3, insert: 'B' }, selection: { anchor: 4 }, userEvent: 'input.type' })
      expect(undoDepth(view.state)).toBe(3)
      for (const expected of ['**A**', 'A', '']) { expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(expected) }
      for (const expected of ['A', '**A**', '**AB**']) { expect(redo(view)).toBe(true); expect(view.state.doc.toString()).toBe(expected) }
    } finally { close() }
  })

  it.each([
    '**粗体**', '++下划线++', '==高亮==', '{color:green}颜色{/color}',
    '**=={color:green}重点{/color}==**', '**一** **二**',
    '`**代码** ++code++`', '```\n==code==\n```', '[链接](https://example.com)',
    '<span>++text++</span>', '\\*\\*保留\\*\\*', '{color:unknown}未知{/color}',
    '**未闭合 ++未闭合 ==未闭合 {color:red}未闭合', '**** ++++ ==== {color:red}{/color}',
    '++**反向**++ {color:green}**反向**{/color}',
  ])('preserves no-edit legacy bytes and sustained token projection: %s', original => {
    const { view, close } = productionView(original)
    try {
      for (let pos = 0; pos <= original.length; pos++) {
        view.dispatch({ selection: { anchor: pos } })
        expect(view.state.doc.toString()).toBe(original)
        expect(view.state.selection.main.empty).toBe(true)
        const resolver = inlineResolver(view.state)
        expect(resolver.tokens.some(t => view.state.selection.main.head > t.from && view.state.selection.main.head < t.to)).toBe(false)
        expect(view.dom.textContent).toBe(original.split('').filter((_c, i) => !resolver.tokens.some(t => i >= t.from && i < t.to)).join('').replace(/\n/g, ''))
      }
      expect(undoDepth(view.state)).toBe(0)
    } finally { close() }
  })
})

// Assert the actual reading surface, including which characters inherit styles.
// Comparing range counts alone would miss literal markers or widened operations.
function rendered(doc: string) {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(createElement(MarkdownRenderer, { children: doc }))
  host.querySelectorAll('style').forEach(style => style.remove())
  return host.querySelector('.markdown-body')!
}

function select(doc: string, text: string, reverse = false) {
  const from = doc.indexOf(text)
  expect(from).toBeGreaterThanOrEqual(0)
  return create(doc, reverse ? from + text.length : from, reverse ? from : from + text.length)
}

describe('formatted selection continuation and clear formatting', () => {
  it('clears a plain selection as a harmless no-op, while incomplete syntax fails closed', () => {
    const state = create('abc', 0, 3)
    const spec = clearFormatTransaction(state)
    expect(spec).not.toBeNull()
    const next = state.update(spec!).state
    expect(next.doc.toString()).toBe('abc')
    expect(next.selection.eq(state.selection)).toBe(true)
    expect(undoDepth(next)).toBe(0)
    expect(clearFormatTransaction(create('++未闭合', 2, 5))).toBeNull()
  })
  it.each([
    ['bold', '**今天很重要**'], ['underline', '++今天很重要++'],
    ['highlight', '==今天很重要=='], ['color', '{color:blue}今天很重要{/color}'],
  ] as const)('finishes %s at the logical end in either selection direction', (kind, formatted) => {
    for (const reverse of [false, true]) {
      const original = '今天很重要'
      const { view, close } = productionView(original, reverse ? original.length : 0, reverse ? 0 : original.length)
      try {
        const before = view.state.selection
        view.dispatch(formatTransaction(view.state, kind, kind === 'color' ? 'blue' : undefined)!)
        const selected = view.state.selection
        expect(selected.main.anchor > selected.main.head).toBe(reverse)
        view.dispatch({ ...view.state.replaceSelection(' '), userEvent: 'input.type' })
        expect(view.state.doc.toString()).toBe(formatted + ' ')
        expect(view.state.selection.main).toMatchObject({ anchor: formatted.length + 1, head: formatted.length + 1 })
        expect(activeFormats(view.state)).toEqual({ bold: false, underline: false, highlight: false, color: undefined })
        expect(view.state.field(formatContinuationField)).toBeNull()
        expect(undoDepth(view.state)).toBe(2)
        undo(view)
        expect(view.state.doc.toString()).toBe(formatted)
        expect(view.state.selection.eq(selected)).toBe(true)
        // Undo never restores the temporary intent.
        expect(finishFormattedSelection(view.state)).toBeNull()
        undo(view)
        expect(view.state.doc.toString()).toBe(original)
        expect(view.state.selection.eq(before)).toBe(true)
        redo(view); redo(view)
        expect(view.state.selection.main.head).toBe(formatted.length + 1)
        view.dispatch({ ...view.state.replaceSelection('继续写'), userEvent: 'input.type' })
        expect(view.state.doc.toString()).toBe(formatted + ' 继续写')
        expect(view.contentDOM.textContent).toBe(original + ' 继续写')
      } finally { close() }
    }
  })

  it.each([false, true])('stacks bold, underline and color, toggles outer bold, then finishes (reverse=%s)', reverse => {
    const { view, close } = productionView('abc', reverse ? 3 : 0, reverse ? 0 : 3)
    try {
      for (const kind of ['bold', 'underline', 'color'] as const) {
        view.dispatch(formatTransaction(view.state, kind, kind === 'color' ? 'blue' : undefined)!)
        expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('abc')
      }
      expect(view.state.doc.toString()).toBe('**++{color:blue}abc{/color}++**')
      view.dispatch(formatTransaction(view.state, 'bold')!)
      expect(view.state.doc.toString()).toBe('++{color:blue}abc{/color}++')
      view.dispatch(formatTransaction(view.state, 'bold')!)
      view.dispatch(finishFormattedSelection(view.state)!)
      expect(view.state.doc.toString()).toBe('**++{color:blue}abc{/color}++** ')
      expect(view.state.selection.main.head).toBe(view.state.doc.length)
    } finally { close() }
  })

  it('keeps toggling ON then OFF eligible, but leaves an ordinary selection replacement unchanged', () => {
    const { view, close } = productionView('abc', 0, 3)
    try {
      view.dispatch(formatTransaction(view.state, 'bold')!)
      view.dispatch(formatTransaction(view.state, 'bold')!)
      view.dispatch({ ...view.state.replaceSelection(' '), userEvent: 'input.type' })
      expect(view.state.doc.toString()).toBe('abc ')
      view.dispatch({ selection: { anchor: 0, head: 3 } })
      view.dispatch({ ...view.state.replaceSelection(' '), userEvent: 'input.type' })
      expect(view.state.doc.toString()).toBe('  ')
    } finally { close() }
  })

  it('inserts between adjacent wrappers without crossing the next opening token', () => {
    const { view, close } = productionView('abc++def++', 0, 3)
    try {
      view.dispatch(formatTransaction(view.state, 'bold')!)
      view.dispatch(finishFormattedSelection(view.state)!)
      expect(view.state.doc.toString()).toBe('**abc** ++def++')
      expect(view.state.selection.main.head).toBe(8)
      expect(activeFormats(view.state).underline).toBe(false)
    } finally { close() }
  })

  it('preserves surrounding independently existing formatting for a supported inner color selection', () => {
    const { view, close } = productionView('**abcdef**', 4, 6)
    try {
      view.dispatch(formatTransaction(view.state, 'color', 'blue')!)
      view.dispatch(finishFormattedSelection(view.state)!)
      expect(view.state.doc.toString()).toBe('**ab{color:blue}cd{/color} ef**')
      expect(activeFormats(view.state).bold).toBe(true)
      expect(activeFormats(view.state).color).toBeUndefined()
    } finally { close() }
  })

  it.each(['selection', 'sync', 'composition', 'pointer', 'escape', 'clear-effect', 'other-input'])('invalidates temporary intent on %s', action => {
    const { view, close } = productionView('abc', 0, 3)
    try {
      view.dispatch(formatTransaction(view.state, 'underline')!)
      expect(finishFormattedSelection(view.state)).not.toBeNull()
      if (action === 'selection') view.dispatch({ selection: { anchor: 3 } })
      if (action === 'sync') view.dispatch({ changes: { from: 3, insert: 'X' }, annotations: Transaction.addToHistory.of(false) })
      if (action === 'composition') view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      if (action === 'pointer') view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }))
      if (action === 'escape') view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      if (action === 'clear-effect') view.dispatch({ effects: clearFormatContinuation.of(null) })
      if (action === 'other-input') view.dispatch({ ...view.state.replaceSelection('x'), userEvent: 'input.type' })
      expect(finishFormattedSelection(view.state)).toBeNull()
    } finally { close() }
  })

  it('does not intercept composition-space or pasted space and does not restore intent on redo', () => {
    for (const userEvent of ['input.type.compose', 'input.type.compose.start', 'input.paste']) {
      const { view, close } = productionView('abc', 0, 3)
      try {
        view.dispatch(formatTransaction(view.state, 'underline')!)
        view.dispatch({ ...view.state.replaceSelection(' '), userEvent })
        expect(view.state.doc.toString()).not.toBe('++abc++ ')
        expect(finishFormattedSelection(view.state)).toBeNull()
        undo(view); redo(view)
        expect(finishFormattedSelection(view.state)).toBeNull()
      } finally { close() }
    }
  })

  it('keeps collapsed-caret formatting independent, including spaces within intentional underline/color input', () => {
    for (const kind of ['bold', 'underline', 'highlight', 'color'] as const) {
      const { view, close } = productionView('')
      try {
        view.dispatch(formatTransaction(view.state, kind, kind === 'color' ? 'blue' : undefined)!)
        expect(finishFormattedSelection(view.state)).toBeNull()
        view.dispatch({ ...view.state.replaceSelection('two words'), userEvent: 'input.type' })
        const formatted = view.state.doc.toString()
        expect(activeFormats(view.state)[kind]).toBeTruthy()
        expect(formatted).toContain('two words')
        expect(view.contentDOM.textContent).toBe('two words')
      } finally { close() }
    }
  })

  it.each(['underline', 'color'] as const)('keeps individually typed spaces inside intentional caret %s', kind => {
    const { view, close } = productionView('')
    try {
      view.dispatch(formatTransaction(view.state, kind, kind === 'color' ? 'blue' : undefined)!)
      for (const text of ['two', ' ', 'words']) view.dispatch({ ...view.state.replaceSelection(text), userEvent: 'input.type' })
      expect(view.contentDOM.textContent).toBe('two words')
      expect(activeFormats(view.state)[kind]).toBeTruthy()
      expect(finishFormattedSelection(view.state)).toBeNull()
    } finally { close() }
  })

  it.each([
    '**abc**', '++abc++', '==abc==', '{color:blue}abc{/color}',
    '**++{color:blue}abc{/color}++**', '**=={color:green}abc{/color}==**',
  ])('clears supported full %s losslessly in one undo/redo action', original => {
    for (const reverse of [false, true]) {
      const doc = `左 ${original} 右`
      const start = doc.indexOf('abc')
      const { view, close } = productionView(doc, reverse ? start + 3 : start, reverse ? start : start + 3)
      try {
        const before = view.state.selection
        const spec = clearFormatTransaction(view.state)
        expect(spec).not.toBeNull()
        view.dispatch(spec!)
        const selected = view.state.selection
        expect(view.state.doc.toString()).toBe('左 abc 右')
        expect(view.contentDOM.textContent).toBe('左 abc 右')
        expect(selected.main.anchor > selected.main.head).toBe(reverse)
        expect(view.state.sliceDoc(selected.main.from, selected.main.to)).toBe('abc')
        expect(undoDepth(view.state)).toBe(1)
        undo(view)
        expect(view.state.doc.toString()).toBe(doc)
        expect(view.state.selection.eq(before)).toBe(true)
        redo(view)
        expect(view.state.doc.toString()).toBe('左 abc 右')
        expect(view.state.selection.eq(selected)).toBe(true)
      } finally { close() }
    }
  })

  it.each([
    ['**abcdef**', '**ab**cd**ef**'], ['++abcdef++', '++ab++cd++ef++'],
    ['==abcdef==', '==ab==cd==ef=='], ['{color:red}abcdef{/color}', '{color:red}ab{/color}cd{color:red}ef{/color}'],
  ])('clears only the supported partial selection in %s', (doc, expected) => {
    const state = select(doc, 'cd', true)
    const tr = clearFormatTransaction(state)
    expect(tr).not.toBeNull()
    const next = state.update(tr!).state
    expect(next.doc.toString()).toBe(expected)
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe('cd')
    expect(next.selection.main.anchor).toBeGreaterThan(next.selection.main.head)
    expect(rendered(expected).textContent).toBe('abcdef')
  })

  it.each(['**++abcdef++**', '**=={color:blue}abcdef{/color}==**', '++**abcdef**++', '**abcdef** plain'])('fails closed for unsafe/mixed selection in %s', doc => {
    const state = doc.endsWith(' plain') ? create(doc, 3, doc.length) : select(doc, 'cd')
    expect(clearFormatTransaction(state)).toBeNull()
    expect(state.doc.toString()).toBe(doc)
    expect(undoDepth(state)).toBe(0)
  })

  it('rejects a whole outer span containing heterogeneous inner formatting atomically', () => {
    const doc = '**a ++b++ c**'
    const state = create(doc, 2, doc.length - 2)
    expect(clearFormatTransaction(state)).toBeNull()
    expect(state.doc.toString()).toBe(doc)
    expect(undoDepth(state)).toBe(0)
  })

  it.each(['## **abc**', '- **abc**', '**[abc](https://example.com)**', '**`abc`**'])('preserves unrelated structure while clearing a complete supported wrapper in %s', doc => {
    // Select the complete bold wrapper; links/code keep their canonical syntax.
    const from = doc.indexOf('**'), to = doc.lastIndexOf('**') + 2
    const state = create(doc, from, to)
    const spec = clearFormatTransaction(state)
    expect(spec).not.toBeNull()
    expect(state.update(spec!).state.doc.toString()).toBe(doc.split('**').join(''))
  })
})

describe('formatting correctness: canonical nesting and selection scope', () => {
  it.each([
    ['++重点++', 'bold', undefined, '**++重点++**', 'strong > u'],
    ['{color:red}重点{/color}', 'bold', undefined, '**{color:red}重点{/color}**', 'strong > .md-color-red'],
    ['{color:red}重点{/color}', 'underline', undefined, '++{color:red}重点{/color}++', 'u > .md-color-red'],
    ['{color:red}重点{/color}', 'highlight', undefined, '=={color:red}重点{/color}==', 'mark > .md-color-red'],
    ['**重点**', 'underline', undefined, '**++重点++**', 'strong > u'],
    ['**重点**', 'highlight', undefined, '**==重点==**', 'strong > mark'],
    ['**重点**', 'color', 'red', '**{color:red}重点{/color}**', 'strong > .md-color-red'],
    ['++重点++', 'color', 'red', '++{color:red}重点{/color}++', 'u > .md-color-red'],
    ['==重点==', 'color', 'blue', '=={color:blue}重点{/color}==', 'mark > .md-color-blue'],
    ['**{color:red}重点{/color}**', 'underline', undefined, '**++{color:red}重点{/color}++**', 'strong > u > .md-color-red'],
  ] as const)('preserves render semantics when adding %s / %s', (doc, kind, color, expected, selector) => {
    const next = format(select(doc, '重点'), kind, color)
    expect(next.doc.toString()).toBe(expected)
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe('重点')
    const output = rendered(next.doc.toString())
    expect(output.textContent).toBe('重点')
    expect(output.querySelector(selector)?.textContent).toBe('重点')
    // Reopening canonical storage preserves the same rendered nesting.
    expect(rendered(create(next.doc.toString()).doc.toString()).innerHTML).toBe(output.innerHTML)
  })

  it.each([
    ['++重点++', 'highlight'], ['==重点==', 'underline'],
    ['**++重点++**', 'highlight'], ['**==重点==**', 'underline'],
    ['++**重点**++', 'color'], ['{color:red}**重点**{/color}', 'underline'],
  ] as const)('rejects unsupported or malformed nesting without changing %s', (doc, kind) => {
    const state = select(doc, '重点')
    expect(formatTransaction(state, kind, kind === 'color' ? 'blue' : undefined)).toBeNull()
    expect(format(state, kind, kind === 'color' ? 'blue' : undefined)).toBe(state)
    expect(state.doc.toString()).toBe(doc)
  })

  it.each([
    ['**abcdef**', 'bold', '**ab**cd**ef**', 'strong'],
    ['++abcdef++', 'underline', '++ab++cd++ef++', 'u'],
    ['==abcdef==', 'highlight', '==ab==cd==ef==', 'mark'],
  ] as const)('toggles only the selected characters in %s', (doc, kind, expected, tag) => {
    const next = format(select(doc, 'cd', true), kind)
    expect(next.doc.toString()).toBe(expected)
    expect(next.selection.main.anchor).toBeGreaterThan(next.selection.main.head)
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe('cd')
    const output = rendered(expected)
    expect(output.textContent).toBe('abcdef')
    expect([...output.querySelectorAll(tag)].map(el => el.textContent)).toEqual(['ab', 'ef'])
    expect([...output.querySelector('p')!.childNodes].map(node => [node.nodeName, node.textContent]))
      .toEqual([[tag.toUpperCase(), 'ab'], ['#text', 'cd'], [tag.toUpperCase(), 'ef']])
  })

  it.each(['blue', null, 'red'] as const)('changes only the color of cd: %s', color => {
    const doc = '{color:red}abcdef{/color}'
    const next = format(select(doc, 'cd'), 'color', color)
    const middle = color === 'blue' ? '{color:blue}cd{/color}' : 'cd'
    expect(next.doc.toString()).toBe(`{color:red}ab{/color}${middle}{color:red}ef{/color}`)
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe('cd')
    const output = rendered(next.doc.toString())
    expect(output.textContent).toBe('abcdef')
    expect([...output.querySelectorAll('.md-color-red')].map(el => el.textContent)).toEqual(['ab', 'ef'])
    expect(output.querySelector('.md-color-blue')?.textContent ?? null).toBe(color === 'blue' ? 'cd' : null)
    expect(output.querySelector('span span')).toBeNull()
  })

  it.each([
    ['bold', '**', '**', 'strong'], ['underline', '++', '++', 'u'],
    ['highlight', '==', '==', 'mark'], ['color', '{color:red}', '{/color}', '.md-color-red'],
  ] as const)('handles prefix/suffix/full selection and caret without empty %s wrappers', (kind, prefix, suffix, selector) => {
    const doc = `${prefix}abcdef${suffix}`
    for (const [chosen, expected] of [
      ['ab', `ab${prefix}cdef${suffix}`], ['ef', `${prefix}abcd${suffix}ef`],
      ['abcdef', 'abcdef'], [doc, 'abcdef'],
    ]) {
      const next = format(select(doc, chosen!), kind, kind === 'color' ? null : undefined)
      expect(next.doc.toString()).toBe(expected)
      expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe(chosen === doc ? 'abcdef' : chosen)
      const output = rendered(next.doc.toString())
      expect(output.textContent).toBe('abcdef')
      expect([...output.querySelectorAll(selector)].every(el => !!el.textContent)).toBe(true)
    }
    expect(format(create(doc, prefix.length + 3), kind, kind === 'color' ? null : undefined).doc.toString()).toBe('abcdef')
  })

  it.each(['ab', 'ef', 'abcdef'])('replaces edge color selection %s without empty wrappers', chosen => {
    const doc = '{color:red}abcdef{/color}'
    const next = format(select(doc, chosen), 'color', 'blue')
    const output = rendered(next.doc.toString())
    expect(output.textContent).toBe('abcdef')
    expect(output.querySelector('.md-color-blue')?.textContent).toBe(chosen)
    expect([...output.querySelectorAll('.md-color-red')].map(el => el.textContent).join('')).toBe('abcdef'.replace(chosen, ''))
    expect([...output.querySelectorAll('span')].every(el => !!el.textContent)).toBe(true)
  })

  it.each([
    ['**++abcdef++**', 'bold'], ['**++abcdef++**', 'underline'],
    ['**==abcdef==**', 'highlight'], ['**{color:red}abcdef{/color}**', 'color'],
    ['++abcdef++', 'bold'], ['{color:red}abcdef{/color}', 'underline'],
  ] as const)('rejects nested subrange operations instead of widening %s / %s', (doc, kind) => {
    const state = select(doc, 'cd')
    expect(formatTransaction(state, kind, kind === 'color' ? 'blue' : undefined)).toBeNull()
    if (kind === 'color') expect(formatTransaction(state, kind, null)).toBeNull()
    expect(state.doc.toString()).toBe(doc)
  })

  it('supports whole-wrapper selection for canonical ordering and keeps neighbouring formats', () => {
    const next = format(select('++重点++', '++重点++'), 'bold')
    expect(next.doc.toString()).toBe('**++重点++**')
    expect(rendered(next.doc.toString()).querySelector('strong > u')?.textContent).toBe('重点')
    const inside = format(select('**重点**', '**重点**'), 'color', 'red')
    expect(inside.doc.toString()).toBe('**{color:red}重点{/color}**')
    expect(rendered(inside.doc.toString()).querySelector('strong > .md-color-red')?.textContent).toBe('重点')
  })
})

describe('canonical Markdown writing state (compatibility spike)', () => {
  it.each([['bold', '**重点**'], ['underline', '++重点++'], ['highlight', '==重点==']] as const)('wraps and toggles %s with selection intact', (kind, expected) => {
    const state = format(create('重点', 0, 2), kind)
    expect(state.doc.toString()).toBe(expected)
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe('重点')
    expect(activeFormats(state)[kind]).toBe(true)
    expect(format(state, kind).doc.toString()).toBe('重点')
    expect(format(state.update({ selection: { anchor: 3 } }).state, kind).doc.toString()).toBe('重点')
  })
  it('replaces, toggles and clears a color instead of nesting wrappers', () => {
    const red = format(create('重点', 0, 2), 'color', 'red')
    const blue = format(red, 'color', 'blue')
    expect(blue.doc.toString()).toBe('{color:blue}重点{/color}')
    expect(activeFormats(blue).color).toBe('blue')
    expect(format(blue, 'color', null).doc.toString()).toBe('重点')
    expect(format(red, 'color', 'red').doc.toString()).toBe('重点')
  })
  it('isolates one formatting operation from typing in undo and redo', () => {
    let state = create('重点', 0, 2)
    state = format(state, 'bold')
    state = state.update({ changes: { from: 4, insert: '内容' }, selection: { anchor: 6 }, userEvent: 'input.type' }).state
    const target = { get state() { return state }, dispatch: (tr: ReturnType<EditorState['update']>) => { state = tr.state } }
    expect(undo(target)).toBe(true)
    expect(state.doc.toString()).toBe('**重点**')
    expect(undo(target)).toBe(true)
    expect(state.doc.toString()).toBe('重点')
    expect(redo(target)).toBe(true)
    expect(state.doc.toString()).toBe('**重点**')
  })
  it('recognizes basic nested formatting and excludes code and incomplete syntax', () => {
    const state = create('开头 **++重点++** =={color:red}颜色{/color}==\n`++code++`\n```\n==code==\n```\n++未闭合 == == {color:no}no{/color}')
    expect(state.field(rangeField).map(r => r.format)).toEqual(['bold', 'underline', 'highlight', 'color', 'highlight'])
    expect(create('** ++ == {color:red}').field(rangeField)).toEqual([])
    expect(create('**** ++++ ==== {color:red}{/color}').field(rangeField)).toEqual([])
  })
  it('does not claim active formatting on mixed selection or wrap partial markers', () => {
    const state = create('**重点** 普通', 3, 9)
    expect(activeFormats(state).bold).toBe(false)
    expect(formatTransaction(state, 'bold')).toBeNull()
    expect(formatTransaction(create('++未闭合', 0, 5), 'underline')).toBeNull()
    expect(formatTransaction(create('   ', 0, 3), 'bold')).toBeNull()
    expect(format(create(' a+b=c ', 0, 7), 'bold').doc.toString()).toBe(' **a+b=c** ')
  })
  it('sustains delimiter hiding inside a caret or selection and never changes the stored string', () => {
    const state = create('开头 **重点** ++再看++')
    let hidden = 0
    state.field(previewField).between(0, state.doc.length, (_from, _to, decoration) => { if (!decoration.spec.class) hidden++ })
    expect(hidden).toBe(4)
    const editing = state.update({ selection: { anchor: 6 } }).state
    hidden = 0
    editing.field(previewField).between(0, editing.doc.length, (_from, _to, decoration) => { if (!decoration.spec.class) hidden++ })
    expect(hidden).toBe(4)
    expect(editing.doc.toString()).toBe(state.doc.toString())
  })

  it.each([
    '**粗体** ++下划线++ ==高亮== {color:red}颜色{/color}',
    '**++重点++** =={color:blue}颜色{/color}==',
    '++一++++二++ ==三====四==',
    '`++code++`\n\n```\n==code==\n{color:red}code{/color}\n```',
    '++未闭合 ==未闭合 {color:red}未闭合',
    '**** ++++ ==== {color:red}{/color}',
    '++**保持既有阅读语义**++ {color:red}**粗体**{/color}',
  ])('agrees with the unchanged reading pipeline for %s', doc => {
    const ranges = create(doc).field(rangeField)
    const html = renderToStaticMarkup(createElement(MarkdownRenderer, { children: doc }))
    for (const [format, pattern] of [
      ['bold', /<strong[ >]/g], ['underline', /<u[ >]/g], ['highlight', /<mark[ >]/g], ['color', /class="md-color-/g],
    ] as const) {
      expect(ranges.filter(r => r.format === format).length).toBe((html.match(pattern) || []).length)
    }
  })
})
