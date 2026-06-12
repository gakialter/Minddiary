import type { AIMessage, DiaryEntry, Mistake, StudyTask, StudyTaskType, Subject } from '../types'
import { sanitizeUserInput } from './promptTemplates'

const TASK_TYPES: StudyTaskType[] = ['review', 'focus', 'diary', 'mistake', 'custom']
const PRIORITIES = ['high', 'medium', 'low'] as const
const ALLOWED_TOP_LEVEL_KEYS = ['suggestions'] as const
const ALLOWED_SUGGESTION_KEYS = [
  'title',
  'type',
  'estimate_minutes',
  'reason',
  'priority',
  'subject_ref',
  'related_mistake_ref',
  'related_entry_ref',
] as const
const ACTIVE_STATUSES = ['todo', 'doing'] as const

export type TodayActionPriority = typeof PRIORITIES[number]
export type TodayActionCreationState = 'draft' | 'creating' | 'created' | 'failed'

export interface TodayActionPlanningContext {
  date: string
  availableMinutes: number
  subjects: Subject[]
  dueMistakes: Mistake[]
  todayTasks: StudyTask[]
  todayEntry: DiaryEntry | null
}

export interface TodayActionSuggestionDraft {
  clientId: string
  title: string
  type: StudyTaskType
  subject_id: number | null
  estimate_minutes: number
  reason: string
  priority: TodayActionPriority
  related_mistake_id: number | null
  related_entry_id: number | null
  selected: boolean
  validationErrors: string[]
  creationState: TodayActionCreationState
  createdTaskId?: number
  creationError?: string
}

export interface TodayActionSuggestionParseResult {
  suggestions: TodayActionSuggestionDraft[]
  errors: string[]
}

interface RawSuggestion {
  title?: unknown
  type?: unknown
  estimate_minutes?: unknown
  reason?: unknown
  priority?: unknown
  subject_ref?: unknown
  related_mistake_ref?: unknown
  related_entry_ref?: unknown
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function makeClientId(index: number): string {
  return `suggestion-${index + 1}`
}

function findJsonObjectRanges(input: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = i
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth < 0) return []
      if (depth === 0 && start >= 0) {
        ranges.push({ start, end: i + 1 })
        start = -1
      }
    }
  }

  return depth === 0 ? ranges : []
}

export function extractSingleJsonObject(rawContent: unknown): { value?: unknown; error?: string } {
  if (typeof rawContent !== 'string') return { error: 'AI response content must be a string' }
  const trimmed = rawContent.trim()
  if (!trimmed) return { error: 'AI response content is empty' }

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidate = fenced ? fenced[1]!.trim() : trimmed

  try {
    return { value: JSON.parse(candidate) }
  } catch {
    const ranges = findJsonObjectRanges(candidate)
    if (ranges.length === 0) return { error: 'AI response did not contain a complete JSON object' }
    if (ranges.length > 1) return { error: 'AI response contained multiple JSON objects' }
    const range = ranges[0]!
    try {
      return { value: JSON.parse(candidate.slice(range.start, range.end)) }
    } catch {
      return { error: 'AI response JSON could not be parsed' }
    }
  }
}

function resolveRefId(ref: unknown, prefix: string): number | null {
  if (typeof ref !== 'string') return null
  const match = ref.match(new RegExp(`^${prefix}:(\\d+)$`))
  if (!match) return null
  const id = Number(match[1])
  return Number.isInteger(id) && id > 0 ? id : null
}

function getSubjectIdFromRef(ref: unknown, context: TodayActionPlanningContext, errors: string[]): number | null {
  if (ref === undefined || ref === null || ref === '') return null
  const id = resolveRefId(ref, 'subject')
  if (!id || !context.subjects.some(subject => subject.id === id)) {
    errors.push('subject_ref is not in the allowlist')
    return null
  }
  return id
}

function getMistakeIdFromRef(ref: unknown, context: TodayActionPlanningContext, errors: string[]): number | null {
  if (ref === undefined || ref === null || ref === '') return null
  const id = resolveRefId(ref, 'mistake')
  if (!id || !context.dueMistakes.some(mistake => mistake.id === id)) {
    errors.push('related_mistake_ref is not in the due-mistake allowlist')
    return null
  }
  return id
}

function getEntryIdFromRef(ref: unknown, context: TodayActionPlanningContext, errors: string[]): number | null {
  if (ref === undefined || ref === null || ref === '') return null
  const id = resolveRefId(ref, 'entry')
  if (!id || context.todayEntry?.id !== id) {
    errors.push('related_entry_ref is not in the allowlist')
    return null
  }
  return id
}

function buildDraftFromRaw(raw: RawSuggestion, index: number, context: TodayActionPlanningContext): TodayActionSuggestionDraft {
  const errors: string[] = []
  const extraKeys = Object.keys(raw).filter(key => !ALLOWED_SUGGESTION_KEYS.includes(key as typeof ALLOWED_SUGGESTION_KEYS[number]))
  if (extraKeys.length > 0) errors.push(`Unsupported suggestion fields: ${extraKeys.join(', ')}`)

  const title = typeof raw.title === 'string' ? raw.title.trim().replace(/\s+/g, ' ') : ''
  if (!title) errors.push('title is required')
  if (title.length > 80) errors.push('title must be 80 characters or fewer')

  const type = raw.type
  const resolvedType = typeof type === 'string' && TASK_TYPES.includes(type as StudyTaskType)
    ? type as StudyTaskType
    : 'custom'
  if (resolvedType === 'custom' && type !== 'custom') errors.push('type is invalid')

  const estimate = raw.estimate_minutes
  const estimateMinutes = typeof estimate === 'number' && Number.isInteger(estimate) ? estimate : 0
  if (typeof estimate !== 'number' || !Number.isInteger(estimate)) errors.push('estimate_minutes must be an integer number')
  if (estimateMinutes < 5 || estimateMinutes > 180) errors.push('estimate_minutes must be between 5 and 180')

  const reason = typeof raw.reason === 'string' ? raw.reason.trim().replace(/\s+/g, ' ') : ''
  if (!reason) errors.push('reason is required')
  if (reason.length > 240) errors.push('reason must be 240 characters or fewer')

  const priority = typeof raw.priority === 'string' && PRIORITIES.includes(raw.priority as TodayActionPriority)
    ? raw.priority as TodayActionPriority
    : 'medium'
  if (raw.priority !== undefined && priority === 'medium' && raw.priority !== 'medium') errors.push('priority is invalid')

  const subjectId = getSubjectIdFromRef(raw.subject_ref, context, errors)
  const relatedMistakeId = getMistakeIdFromRef(raw.related_mistake_ref, context, errors)
  const relatedEntryId = getEntryIdFromRef(raw.related_entry_ref, context, errors)

  if (resolvedType === 'review' && relatedMistakeId === null) {
    errors.push('review suggestions must reference a due mistake')
  }
  if (resolvedType !== 'review' && relatedMistakeId !== null) {
    errors.push('non-review suggestions cannot reference a mistake')
  }

  return {
    clientId: makeClientId(index),
    title,
    type: resolvedType,
    subject_id: subjectId,
    estimate_minutes: estimateMinutes || 25,
    reason,
    priority,
    related_mistake_id: relatedMistakeId,
    related_entry_id: relatedEntryId,
    selected: errors.length === 0,
    validationErrors: errors,
    creationState: 'draft',
  }
}

export function validateTodayActionDrafts(
  drafts: TodayActionSuggestionDraft[],
  context: TodayActionPlanningContext,
): TodayActionSuggestionDraft[] {
  const titleCounts = new Map<string, number>()
  const mistakeCounts = new Map<number, number>()
  const activeTaskTitles = new Set(
    context.todayTasks
      .filter(task => ACTIVE_STATUSES.includes(task.status as typeof ACTIVE_STATUSES[number]))
      .map(task => normalizeTitle(task.title)),
  )
  const activeReviewMistakes = new Set(
    context.todayTasks
      .filter(task => task.type === 'review' && ACTIVE_STATUSES.includes(task.status as typeof ACTIVE_STATUSES[number]))
      .map(task => task.related_mistake_id)
      .filter((id): id is number => typeof id === 'number'),
  )

  drafts.forEach(draft => {
    const titleKey = normalizeTitle(draft.title)
    if (titleKey) titleCounts.set(titleKey, (titleCounts.get(titleKey) || 0) + 1)
    if (draft.related_mistake_id !== null) {
      mistakeCounts.set(draft.related_mistake_id, (mistakeCounts.get(draft.related_mistake_id) || 0) + 1)
    }
  })

  const totalSelectedMinutes = drafts
    .filter(draft => draft.selected && draft.creationState !== 'created')
    .reduce((sum, draft) => sum + draft.estimate_minutes, 0)

  return drafts.map(draft => {
    const errors = draft.validationErrors.filter(error => (
      !error.startsWith('Duplicate') &&
      !error.startsWith('An active') &&
      !error.startsWith('Selected suggestions exceed')
    ))
    if (!draft.title.trim()) errors.push('title is required')
    if (draft.title.trim().length > 80) errors.push('title must be 80 characters or fewer')
    if (!TASK_TYPES.includes(draft.type)) errors.push('type is invalid')
    if (!Number.isInteger(draft.estimate_minutes)) errors.push('estimate_minutes must be an integer number')
    if (draft.estimate_minutes < 5 || draft.estimate_minutes > 180) errors.push('estimate_minutes must be between 5 and 180')
    if (!draft.reason.trim()) errors.push('reason is required')
    if (draft.reason.trim().length > 240) errors.push('reason must be 240 characters or fewer')
    if (!PRIORITIES.includes(draft.priority)) errors.push('priority is invalid')
    if (draft.subject_id !== null && !context.subjects.some(subject => subject.id === draft.subject_id)) {
      errors.push('subject_ref is not in the allowlist')
    }
    if (draft.related_entry_id !== null && context.todayEntry?.id !== draft.related_entry_id) {
      errors.push('related_entry_ref is not in the allowlist')
    }
    if (draft.type === 'review') {
      if (draft.related_mistake_id === null) {
        errors.push('review suggestions must reference a due mistake')
      } else if (!context.dueMistakes.some(mistake => mistake.id === draft.related_mistake_id)) {
        errors.push('related_mistake_ref is not in the due-mistake allowlist')
      }
    } else if (draft.related_mistake_id !== null) {
      errors.push('non-review suggestions cannot reference a mistake')
    }

    const titleKey = normalizeTitle(draft.title)
    if (titleKey && (titleCounts.get(titleKey) || 0) > 1) errors.push('Duplicate title in this suggestion batch')
    if (titleKey && activeTaskTitles.has(titleKey)) errors.push('An active task with this title already exists today')
    if (draft.related_mistake_id !== null && (mistakeCounts.get(draft.related_mistake_id) || 0) > 1) {
      errors.push('Duplicate related mistake in this suggestion batch')
    }
    if (draft.related_mistake_id !== null && activeReviewMistakes.has(draft.related_mistake_id)) {
      errors.push('An active review task for this mistake already exists today')
    }
    if (draft.selected && totalSelectedMinutes > context.availableMinutes) {
      errors.push('Selected suggestions exceed available minutes')
    }
    return { ...draft, validationErrors: [...new Set(errors)] }
  })
}

export function parseTodayActionSuggestions(
  rawContent: unknown,
  context: TodayActionPlanningContext,
): TodayActionSuggestionParseResult {
  const extracted = extractSingleJsonObject(rawContent)
  if (extracted.error) return { suggestions: [], errors: [extracted.error] }
  if (!isRecord(extracted.value)) return { suggestions: [], errors: ['Top-level AI response must be an object'] }

  const topLevelKeys = Object.keys(extracted.value)
  const extraTopLevelKeys = topLevelKeys.filter(key => !ALLOWED_TOP_LEVEL_KEYS.includes(key as typeof ALLOWED_TOP_LEVEL_KEYS[number]))
  const errors: string[] = extraTopLevelKeys.length > 0 ? [`Unsupported top-level fields: ${extraTopLevelKeys.join(', ')}`] : []
  const rawSuggestions = extracted.value.suggestions
  if (!Array.isArray(rawSuggestions)) return { suggestions: [], errors: [...errors, 'suggestions must be an array'] }
  if (rawSuggestions.length > 6) errors.push('suggestions must contain 6 items or fewer')

  const suggestions = rawSuggestions.slice(0, 6).map((raw, index) => (
    isRecord(raw)
      ? buildDraftFromRaw(raw, index, context)
      : {
          clientId: makeClientId(index),
          title: '',
          type: 'custom' as StudyTaskType,
          subject_id: null,
          estimate_minutes: 25,
          reason: '',
          priority: 'medium' as TodayActionPriority,
          related_mistake_id: null,
          related_entry_id: null,
          selected: false,
          validationErrors: ['suggestion must be an object'],
          creationState: 'draft' as TodayActionCreationState,
        }
  ))

  return { suggestions: validateTodayActionDrafts(suggestions, context), errors }
}

export function buildTodayActionSuggestionMessages(context: TodayActionPlanningContext): AIMessage[] {
  const activeTasks = context.todayTasks
    .filter(task => ACTIVE_STATUSES.includes(task.status as typeof ACTIVE_STATUSES[number]))
    .slice(0, 20)
    .map(task => ({
      title: sanitizeUserInput(task.title),
      type: task.type,
      estimate_minutes: task.estimate_minutes,
      related_mistake_ref: task.related_mistake_id ? `mistake:${task.related_mistake_id}` : null,
    }))
  const subjects = context.subjects.map(subject => ({ ref: `subject:${subject.id}`, name: sanitizeUserInput(subject.name) }))
  const dueMistakes = context.dueMistakes.slice(0, 12).map(mistake => ({
    ref: `mistake:${mistake.id}`,
    subject_ref: mistake.subject_id ? `subject:${mistake.subject_id}` : null,
    question: sanitizeUserInput(mistake.question).slice(0, 180),
  }))
  const entries = context.todayEntry ? [{ ref: `entry:${context.todayEntry.id}`, date: context.todayEntry.date }] : []

  return [
    {
      role: 'system',
      content: '你是 MindDiary 的今日行动建议器。只能返回 JSON，不要解释。不要声称已经创建、完成或修改任务。',
    },
    {
      role: 'user',
      content: [
        '请基于受控上下文建议 0-6 个今日学习行动。只输出一个 JSON 对象。',
        'JSON schema: {"suggestions":[{"title":"1-80字","type":"review|focus|diary|mistake|custom","estimate_minutes":5-180整数,"reason":"1-240字","priority":"high|medium|low","subject_ref":"subject:<id> 可选","related_mistake_ref":"mistake:<id> 仅 review 可选且必须来自 allowlist","related_entry_ref":"entry:<id> 可选"}]}',
        `date=${context.date}`,
        `available_minutes=${context.availableMinutes}`,
        `subjects=${JSON.stringify(subjects)}`,
        `due_mistakes=${JSON.stringify(dueMistakes)}`,
        `today_entries=${JSON.stringify(entries)}`,
        `active_today_tasks=${JSON.stringify(activeTasks)}`,
      ].join('\n'),
    },
  ]
}
