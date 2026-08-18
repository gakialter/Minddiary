import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { AIMessage } from '../src/types'
import {
  AI_STUDY_TASK_OPERATION_KINDS,
  CONFIRMED_STUDY_TASK_ACTION_CONTRACT_VERSION,
  CONFIRMED_MISTAKE_REVIEW_TASK_ACTION_CONTRACT_VERSION,
  createAIStudyTaskGenerationProvenance,
  getAIStudyTaskOperationContract,
  validateAIStudyTaskGenerationProvenance,
} from '../src/utils/aiOperationContracts'
import {
  buildDailyReviewMessages,
  type DailyReviewSafeContext,
} from '../src/utils/dailyReviewAgent'
import {
  buildTodayActionSuggestionMessages,
  type TodayActionPlanningContext,
} from '../src/utils/todayActionSuggestions'
import {
  buildMistakeReviewPromptMessages,
  type MistakeReviewContextProjection,
} from '../src/utils/mistakeReviewSuggestions'

const TODAY_CONTEXT_FIXTURE: TodayActionPlanningContext = {
  date: '2026-06-12',
  availableMinutes: 90,
  subjects: [{ id: 1, name: '数学', color: '#2563eb' }],
  dueMistakes: [{
    id: 12,
    subject_id: 1,
    question: '函数极限换元时忽略定义域',
    answer: '',
    notes: '',
    mastered: false,
    ease_factor: 2.5,
    review_interval: 1,
    next_review_date: '2026-06-12',
    review_count: 2,
    created_at: '2026-06-01T00:00:00.000Z',
  }],
  dueMistakeTotal: 1,
  todayTasks: [{
    id: 7,
    title: '整理函数笔记',
    description: '',
    type: 'focus',
    subject_id: 1,
    related_mistake_id: null,
    related_entry_id: null,
    related_chapter_id: null,
    planned_date: '2026-06-12',
    estimate_minutes: 20,
    status: 'todo',
    source: 'manual',
    created_at: '2026-06-12T00:00:00.000Z',
    updated_at: '2026-06-12T00:00:00.000Z',
  }],
  todayEntry: {
    id: 5,
    date: '2026-06-12',
    title: '今日复盘',
    content: '不进入 Prompt 的正文',
    mood: 'calm',
    word_count: 18,
    created_at: '2026-06-12T00:00:00.000Z',
    updated_at: '2026-06-12T00:00:00.000Z',
  },
}

const DAILY_CONTEXT_FIXTURE: DailyReviewSafeContext = {
  reviewDate: '2026-06-12',
  candidateDate: '2026-06-13',
  availableMinutes: 90,
  todayTasks: [{
    id: 7,
    title: '整理函数笔记',
    type: 'focus',
    status: 'done',
    estimate_minutes: 20,
    source: 'manual',
    subject_id: 1,
    related_mistake_id: null,
    related_entry_id: null,
    related_chapter_id: null,
    planned_date: '2026-06-12',
  }],
  candidateDateTasks: [],
  subjects: [{
    id: 1,
    name: '数学',
    total_chapters: 8,
    completed_chapters: 3,
  }],
  todayEntry: {
    id: 5,
    date: '2026-06-12',
    title: '今日复盘',
    mood: 'calm',
    word_count: 18,
  },
  pomodoro: {
    available: true,
    total_minutes: 25,
    session_count: 1,
    by_subject: [{ subject_name: '数学', total_minutes: 25, session_count: 1 }],
  },
  dueMistakes: [{
    id: 12,
    subject_id: 1,
    subject_name: '数学',
    next_review_date: '2026-06-13',
    review_count: 2,
    mastered: false,
    question_snippet: '函数极限换元时忽略定义域',
  }],
  dueMistakeTotal: 1,
}

const MISTAKE_REVIEW_CONTEXT_FIXTURE: MistakeReviewContextProjection = {
  current_date: '2026-06-12',
  due_mistakes: [{
    mistake_ref: 'm1',
    subject_name: '数学',
    question_excerpt: '函数极限换元时忽略定义域',
    overdue_days: 2,
    review_count: 1,
  }],
}

function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSerialize).join(',')}]`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalSerialize(record[key])}`)
      .join(',')}}`
  }
  throw new Error(`Unsupported canonical prompt value: ${typeof value}`)
}

function digestMessages(messages: AIMessage[]): string {
  return createHash('sha256')
    .update(canonicalSerialize(messages), 'utf8')
    .digest('hex')
}

const EXPECTED_PROMPT_DIGESTS: Readonly<Record<string, string>> = Object.freeze({
  'today-action.prompt.v3': '8f73d031b6343d523cbd37c8d6e0b47b3e34ec13108b0a42c033c38842f4f681',
  'daily-review.prompt.v2': '582c458b685032a9aef79b5d6dba8d7dfb660644bf1201aed8f4c2fea206821f',
  'mistake-review.prompt.v1': digestMessages(buildMistakeReviewPromptMessages(MISTAKE_REVIEW_CONTEXT_FIXTURE)),
})

describe('AI study task operation contracts', () => {
  it('contains exactly the three closed operations with their canonical version tuples', () => {
    expect(AI_STUDY_TASK_OPERATION_KINDS).toEqual(['today_action', 'daily_review', 'mistake_review'])
    expect(getAIStudyTaskOperationContract('today_action')).toEqual({
      operationKind: 'today_action',
      promptVersion: 'today-action.prompt.v3',
      responseSchemaVersion: 'today-action.response-schema.v1',
      parserVersion: 'today-action.parser.v1',
      policyVersion: 'today-action.policy.v1',
      contextProjectionVersion: 'today-action.context-projection.v1',
      actionContractVersion: 'confirmed-study-task-action.v1',
    })
    expect(getAIStudyTaskOperationContract('daily_review')).toEqual({
      operationKind: 'daily_review',
      promptVersion: 'daily-review.prompt.v2',
      responseSchemaVersion: 'daily-review.response-schema.v1',
      parserVersion: 'daily-review.parser.v1',
      policyVersion: 'daily-review.policy.v1',
      contextProjectionVersion: 'daily-review.context-projection.v1',
      actionContractVersion: 'confirmed-study-task-action.v1',
    })
    expect(getAIStudyTaskOperationContract('mistake_review')).toEqual({
      operationKind: 'mistake_review',
      promptVersion: 'mistake-review.prompt.v1',
      responseSchemaVersion: 'mistake-review.response-schema.v1',
      parserVersion: 'mistake-review.parser.v1',
      policyVersion: 'mistake-review.policy.v1',
      contextProjectionVersion: 'mistake-review.context-projection.v1',
      actionContractVersion: 'confirmed-mistake-review-task-action.v1',
    })
    expect(getAIStudyTaskOperationContract('today_action').actionContractVersion)
      .toBe(CONFIRMED_STUDY_TASK_ACTION_CONTRACT_VERSION)
    expect(getAIStudyTaskOperationContract('daily_review').actionContractVersion)
      .toBe(CONFIRMED_STUDY_TASK_ACTION_CONTRACT_VERSION)
    expect(getAIStudyTaskOperationContract('mistake_review').actionContractVersion)
      .toBe(CONFIRMED_MISTAKE_REVIEW_TASK_ACTION_CONTRACT_VERSION)
  })

  it('fails closed for an unknown operation kind', () => {
    expect(() => getAIStudyTaskOperationContract('unknown')).toThrow('operation kind is invalid')
    expect(() => getAIStudyTaskOperationContract('TODAY_ACTION')).toThrow('operation kind is invalid')
    expect(() => getAIStudyTaskOperationContract(new String('today_action'))).toThrow('operation kind is invalid')
  })

  it('is deeply immutable and cannot be polluted by callers', () => {
    const contract = getAIStudyTaskOperationContract('today_action')
    const provenance = createAIStudyTaskGenerationProvenance('today_action', 'fixture-signature')

    expect(Object.isFrozen(AI_STUDY_TASK_OPERATION_KINDS)).toBe(true)
    expect(Object.isFrozen(contract)).toBe(true)
    expect(Object.isFrozen(provenance)).toBe(true)
    expect(Object.isFrozen(provenance.versions)).toBe(true)
    expect(Reflect.set(contract, 'promptVersion', 'forged')).toBe(false)
    expect(Reflect.set(provenance.versions, 'parserVersion', 'forged')).toBe(false)
    expect(Reflect.setPrototypeOf(contract, { promptVersion: 'forged' })).toBe(false)
    expect(Reflect.setPrototypeOf(AI_STUDY_TASK_OPERATION_KINDS, [])).toBe(false)
    expect(getAIStudyTaskOperationContract('today_action').promptVersion).toBe('today-action.prompt.v3')
    expect(createAIStudyTaskGenerationProvenance('today_action', 'second-signature').versions.parserVersion)
      .toBe('today-action.parser.v1')
  })

  it('creates and validates provenance only from the canonical registry', () => {
    const provenance = createAIStudyTaskGenerationProvenance('daily_review', 'generation-signature')
    expect(validateAIStudyTaskGenerationProvenance(provenance, 'daily_review')).toEqual(provenance)
    expect(() => createAIStudyTaskGenerationProvenance('daily_review', '  ')).toThrow('non-empty')
    expect(() => validateAIStudyTaskGenerationProvenance(provenance, 'today_action'))
      .toThrow('operation kind does not match action mode')

    const mistakeProvenance = createAIStudyTaskGenerationProvenance('mistake_review', 'mistake-signature')
    expect(validateAIStudyTaskGenerationProvenance(mistakeProvenance, 'mistake_review')).toEqual(mistakeProvenance)
    expect(() => validateAIStudyTaskGenerationProvenance(mistakeProvenance, 'today_action'))
      .toThrow('operation kind does not match action mode')
  })

  it('rejects missing and extra nested provenance fields', () => {
    const provenance = createAIStudyTaskGenerationProvenance('today_action', 'fixture-signature')
    const { parserVersion: _parserVersion, ...missingVersion } = provenance.versions
    void _parserVersion
    expect(() => validateAIStudyTaskGenerationProvenance({
      ...provenance,
      versions: missingVersion,
    }, 'today_action')).toThrow('versions.parserVersion')
    expect(() => validateAIStudyTaskGenerationProvenance({
      ...provenance,
      extra: true,
    }, 'today_action')).toThrow('unsupported fields')
    expect(() => validateAIStudyTaskGenerationProvenance({
      ...provenance,
      versions: { ...provenance.versions, extra: true },
    }, 'today_action')).toThrow('unsupported fields')
  })

  it('does not accept required provenance fields inherited through the prototype chain', () => {
    const provenance = createAIStudyTaskGenerationProvenance('today_action', 'fixture-signature')

    expect(() => validateAIStudyTaskGenerationProvenance(
      Object.create(provenance),
      'today_action',
    )).toThrow('missing required fields')
    expect(() => validateAIStudyTaskGenerationProvenance({
      ...provenance,
      versions: Object.create(provenance.versions),
    }, 'today_action')).toThrow('missing required fields')
  })
})

describe('versioned prompt drift fixtures', () => {
  it.each([
    {
      operationKind: 'today_action' as const,
      messages: buildTodayActionSuggestionMessages(TODAY_CONTEXT_FIXTURE),
    },
    {
      operationKind: 'daily_review' as const,
      messages: buildDailyReviewMessages(DAILY_CONTEXT_FIXTURE),
    },
    {
      operationKind: 'mistake_review' as const,
      messages: buildMistakeReviewPromptMessages(MISTAKE_REVIEW_CONTEXT_FIXTURE),
    },
  ])('binds canonical $operationKind AIMessage bytes to its promptVersion', ({ operationKind, messages }) => {
    const promptVersion = getAIStudyTaskOperationContract(operationKind).promptVersion
    const serialization = canonicalSerialize(messages)

    expect(serialization).not.toContain('\r')
    expect(digestMessages(messages)).toBe(EXPECTED_PROMPT_DIGESTS[promptVersion])
  })
})
