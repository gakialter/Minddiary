// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  AI_QUICK_PROMPT_TEMPLATES,
  appendQuickPromptDraft,
  mergeContextKinds,
} from '../src/utils/aiQuickPrompts'
import { classifyFirstSlice } from '../src/utils/aiFirstSlice'

describe('AI quick prompt helpers', () => {
  it('defines the five editable quick prompt templates with controlled context kinds', () => {
    expect(AI_QUICK_PROMPT_TEMPLATES.map(template => template.id)).toEqual([
      'daily-summary',
      'mistake-patterns',
      'quiz-me',
      'mental-massage',
      'sprint-plan',
    ])
    expect(AI_QUICK_PROMPT_TEMPLATES.every(template => template.draft.trim().length > 0)).toBe(true)
  })

  it('fills an empty draft and appends to a non-empty draft without overwriting user text', () => {
    expect(appendQuickPromptDraft('', '  New draft  ')).toBe('New draft')
    expect(appendQuickPromptDraft('User text  \n', 'New draft')).toBe('User text\n\nNew draft')
  })

  it.each(AI_QUICK_PROMPT_TEMPLATES.filter(template => template.id !== 'sprint-plan'))(
    '$label asks for conversation-provided material before analysis, without selecting local data', template => {
      expect(template.contextKinds).toEqual([])
      expect(template.draft).toContain('请先让我在对话中')
      expect(template.draft).toContain('只根据我提供的内容')
      expect(classifyFirstSlice(template.draft)).toEqual({ kind: 'chat' })
      expect(mergeContextKinds([], template.contextKinds)).toEqual([])
      const combined = appendQuickPromptDraft('今天我复习了极限，并且容易算错符号。', template.draft)
      expect(combined).toContain('今天我复习了极限，并且容易算错符号。')
      expect(classifyFirstSlice(combined)).toEqual({ kind: 'chat' })
    },
  )

  it('starts sprint planning from conversational input without selecting local learning data', () => {
    const sprint = AI_QUICK_PROMPT_TEMPLATES.find(template => template.id === 'sprint-plan')!
    expect(sprint.contextKinds).toEqual([])
    for (const detail of ['考试日期', '每天可用时间', '复习科目', '当前复习情况', '对话中提供的信息']) {
      expect(sprint.draft).toContain(detail)
    }
    expect(classifyFirstSlice(sprint.draft)).toEqual({ kind: 'chat' })
    expect(mergeContextKinds([], sprint.contextKinds)).toEqual([])
    expect(appendQuickPromptDraft('我每天有两小时。', sprint.draft)).toBe(`我每天有两小时。\n\n${sprint.draft}`)
  })

  it('dedupes context kinds while preserving first-seen order', () => {
    expect(mergeContextKinds(
      ['current-diary', 'mistake-patterns'],
      ['mistake-patterns', 'study-overview', 'current-diary'],
    )).toEqual(['current-diary', 'mistake-patterns', 'study-overview'])
  })
})
