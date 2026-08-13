import { describe, expect, it } from 'vitest'
import {
  formatCandidateValidationMessage,
  toCandidateValidationReasonCode,
} from '../src/utils/candidateValidationMessages'

describe('candidateValidationMessages', () => {
  it.each([
    [
      'type is invalid',
      'invalid_task_type',
      '这个建议的任务类型无法识别，请调整后再试。',
    ],
    [
      'review candidates must reference a due mistake',
      'review_requires_due_mistake',
      '这个复习建议没有关联到当前可复习的错题，请修改任务类型或重新生成。',
    ],
  ] as const)('maps %s to a stable reason code and Chinese guidance', (internalMessage, code, userMessage) => {
    expect(toCandidateValidationReasonCode(internalMessage)).toBe(code)
    expect(formatCandidateValidationMessage(internalMessage)).toBe(userMessage)
  })

  it('uses a stable Chinese fallback without exposing an unknown internal failure', () => {
    const internalMessage = 'provider parser exploded around secret_field'

    expect(toCandidateValidationReasonCode(internalMessage)).toBe('unknown')
    expect(formatCandidateValidationMessage(internalMessage)).toBe(
      '这个建议暂时无法使用，请修改后重试或重新生成。',
    )
    expect(formatCandidateValidationMessage(internalMessage)).not.toContain(internalMessage)
  })
})
