import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { history, undo, redo } from '@codemirror/commands'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownRenderer from '../src/components/common/MarkdownRenderer'
import { activeFormats, diaryMarkdown, formatTransaction, rangeField, previewField } from '../src/components/common/diaryEditorState'
import type { DiaryFormat, MarkdownColorKey } from '../src/utils/markdownDialect'

const create = (doc: string, anchor = 0, head = anchor) => EditorState.create({ doc,
  selection: { anchor, head }, extensions: [diaryMarkdown, history(), rangeField, previewField] })
const format = (state: EditorState, kind: DiaryFormat, color?: MarkdownColorKey | null) => {
  const tr = formatTransaction(state, kind, color)
  return tr ? state.update(tr).state : state
}

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
  it('hides only inactive markers and never changes the stored string', () => {
    const state = create('开头 **重点** ++再看++')
    let hidden = 0
    state.field(previewField).between(0, state.doc.length, (_from, _to, decoration) => { if (!decoration.spec.class) hidden++ })
    expect(hidden).toBe(4)
    const editing = state.update({ selection: { anchor: 6 } }).state
    hidden = 0
    editing.field(previewField).between(0, editing.doc.length, (_from, _to, decoration) => { if (!decoration.spec.class) hidden++ })
    expect(hidden).toBe(2)
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
