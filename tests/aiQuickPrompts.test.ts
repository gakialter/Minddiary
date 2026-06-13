// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  AI_QUICK_PROMPT_TEMPLATES,
  appendQuickPromptDraft,
  mergeContextKinds,
} from '../src/utils/aiQuickPrompts'

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

  it('dedupes context kinds while preserving first-seen order', () => {
    expect(mergeContextKinds(
      ['current-diary', 'mistake-patterns'],
      ['mistake-patterns', 'study-overview', 'current-diary'],
    )).toEqual(['current-diary', 'mistake-patterns', 'study-overview'])
  })
})
