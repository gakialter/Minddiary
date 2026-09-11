import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import { diaryMarkdown, rangeField } from '../src/components/common/diaryEditorState'
import { capturePolishTarget, polishTransaction } from '../src/components/common/diaryPolishTarget'
import { buildPolishMessages, polishActions, validatePolishCandidate, type PolishAction } from '../src/utils/diaryPolish'

function selected(doc: string, text: string) {
  const from = doc.indexOf(text)
  return EditorState.create({ doc, selection: { anchor: from, head: from + text.length }, extensions: [diaryMarkdown, rangeField, history()] })
}
describe('selection polish boundary', () => {
  it.each(Object.keys(polishActions) as PolishAction[])('sends only selected prose with narrow %s instruction', action => {
    const messages = buildPolishMessages('复习有点点困难', action)
    expect(messages).toHaveLength(2)
    expect(messages[1]).toEqual({ role: 'user', content: '复习有点点困难' })
    expect(messages[0]!.content).toContain(polishActions[action].instruction)
    for (const rule of ['只返回', '不解释', '不加引号', '不新增事实', '保留原语言', '保留人称', '语气', '不补充']) expect(messages[0]!.content).toContain(rule)
  })
  it.each(['原文', '**原文**', '++原文++', '==原文==', '{color:red}原文{/color}'])('replaces only content and undoes in one step: %s', doc => {
    let state = selected(doc + '\n\n私密信息', '原文')
    const target = capturePolishTarget(state, 'day')!
    expect(target.source).toBe('原文')
    const tr = state.update(polishTransaction(state, 'day', target, '候选表达')!)
    let changedRanges = 0
    tr.changes.iterChanges(() => changedRanges++)
    expect(changedRanges).toBe(1)
    state = tr.state
    expect(state.doc.toString()).toBe(doc.replace('原文', '候选表达') + '\n\n私密信息')
    expect(undo({ state, dispatch: tr => { state = tr.state } })).toBe(true)
    expect(state.doc.toString()).toBe(doc + '\n\n私密信息')
  })
  it.each([
    ['**原文**', '**原文**'], ['++原文++尾部', '原文++尾部'], ['`原文`', '原文'],
    ['```\n原文\n```', '原文'], ['[原文](url)', '原文'], ['# 原文', '原文'],
    ['- 原文', '原文'], ['原文\n\n尾部', '原文\n\n尾部'], ['++**原文**++', '原文'],
  ])('rejects mixed or structured text: %s', (doc, text) => expect(capturePolishTarget(selected(doc, text), 'day')).toBeNull())
  it.each([undefined, null, {}, '', '  ', '**候选**', '++候选++', '==候选==', '{color:red}候选{/color}', '```候选```', '~~~候选~~~', '---', '- - -', '候选\n第二段', '字'.repeat(121)])('rejects malformed candidate %j', value => {
    expect(() => validatePolishCandidate(value, '原文')).toThrow()
  })
  it('trims transport whitespace and refuses changed identity or document', () => {
    const state = selected('原文 外部', '原文'), target = capturePolishTarget(state, 'day')!
    expect(validatePolishCandidate(' \n候选\n ', '原文')).toBe('候选')
    expect(polishTransaction(state, 'other', target, '候选')).toBeNull()
    const changed = state.update({ changes: { from: 5, insert: '变化' } }).state
    expect(polishTransaction(changed, 'day', target, '候选')).toBeNull()
  })
})
