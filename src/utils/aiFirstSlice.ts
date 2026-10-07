import type {
  EvidenceEnvelope, EvidenceRequest, FirstSliceRestrictionIntent, FocusPeriodResult, Period, SubjectRef,
} from '../types/api'

export type FocusSlots = {
  meaning?: 'recorded_study_time'
  subject?: SubjectRef
  periodA?: Period
  periodB?: Period
}
export type SuppliedFocusEvidence = {
  source: 'user_message'
  subjectDisplayName: string
  periodA: Period & { recordedMinutes: number }
  periodB: Period & { recordedMinutes: number }
  coverage: 'unknown'
}
export type FirstSliceGateResult =
  | { kind: 'restriction'; intent: FirstSliceRestrictionIntent }
  | { kind: 'blocked'; reason: 'clarify_restriction' }
  | { kind: 'clarify'; slots: FocusSlots; missing: (keyof FocusSlots)[] }
  | { kind: 'evidence'; request: EvidenceRequest }
  | { kind: 'supplied'; evidence: SuppliedFocusEvidence }
  | { kind: 'unsupported' }
  | { kind: 'chat' }

function restriction(text: string): FirstSliceRestrictionIntent | null {
  let lifetime: FirstSliceRestrictionIntent['lifetime'] = 'request'
  let category: 'diary' | 'all-outbound' = 'diary'
  let operation: 'use' | 'disclose' = 'disclose'
  let destination: FirstSliceRestrictionIntent['destination'] = 'all'
  switch (text) {
    case '这次别发日记': case '这次别把日记发出去': break
    case '这次别发给AI': category = 'all-outbound'; break
    case '接下来这段不要用日记': case '接下来别再用日记': lifetime = 'session'; operation = 'use'; break
    case '不看日记但帮我分析': operation = 'use'; break
    case '以后默认不要把日记发给这个Provider': lifetime = 'durable_preference'; destination = 'current_provider'; break
    case '以后在这里一直不要发给AI': lifetime = 'durable_preference'; category = 'all-outbound'; break
    default: return null
  }
  return { lifetime, target: category === 'diary' ? { category, operation } : { category, operation: 'disclose' },
    purpose: lifetime === 'request' ? 'this_question' : lifetime === 'session' ? 'this_conversation' : 'aipanel_default',
    object: 'category', destination }
}

function validPeriod(value: Period | undefined): value is Period {
  if (!value) return false
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '0001-01-01'
    && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
  return validDate(value.startDate) && validDate(value.endDate) && value.startDate <= value.endDate
}

function finishSlots(slots: FocusSlots): FirstSliceGateResult {
  const missing: (keyof FocusSlots)[] = []
  if (slots.meaning !== 'recorded_study_time') missing.push('meaning')
  if (!slots.subject || (slots.subject.by === 'exact_name' ? !slots.subject.name.trim()
    : !Number.isSafeInteger(slots.subject.id) || slots.subject.id <= 0)) missing.push('subject')
  if (!validPeriod(slots.periodA)) missing.push('periodA')
  if (!validPeriod(slots.periodB)) missing.push('periodB')
  if (validPeriod(slots.periodA) && validPeriod(slots.periodB)
    && !(slots.periodA.endDate < slots.periodB.startDate || slots.periodB.endDate < slots.periodA.startDate)) {
    missing.push('periodA', 'periodB')
  }
  if (missing.length) return { kind: 'clarify', slots, missing }
  return { kind: 'evidence', request: { kind: 'focus_comparison', subject: slots.subject!,
    periodA: slots.periodA!, periodB: slots.periodB! } }
}

const periodPattern = '(\\d{4}-\\d{2}-\\d{2})\\s*(?:至|\\.\\.)\\s*(\\d{4}-\\d{2}-\\d{2})'

function completeFocusAnswer(text: string): FirstSliceGateResult | null {
  // Deliberately bounded self-report notation. It never becomes a database envelope.
  const supplied = /^([^\r\n]+)\r?\n(\d{4}-\d{2}-\d{2})\.\.(\d{2}|\d{4}-\d{2}-\d{2})\s*=\s*(\d+(?:\.\d+)?)\s*min\r?\n(\d{4}-\d{2}-\d{2})\.\.(\d{2}|\d{4}-\d{2}-\d{2})\s*=\s*(\d+(?:\.\d+)?)\s*min\r?\n覆盖未知$/.exec(text.trim())
  if (supplied) {
    const a = { startDate: supplied[2]!, endDate: supplied[3]!.length === 2 ? supplied[2]!.slice(0, 8) + supplied[3]! : supplied[3]!, recordedMinutes: Number(supplied[4]) }
    const b = { startDate: supplied[5]!, endDate: supplied[6]!.length === 2 ? supplied[5]!.slice(0, 8) + supplied[6]! : supplied[6]!, recordedMinutes: Number(supplied[7]) }
    const result = finishSlots({ meaning: 'recorded_study_time', subject: { by: 'exact_name', name: supplied[1]!.trim() }, periodA: a, periodB: b })
    if (result.kind !== 'evidence') return result
    if (!Number.isFinite(a.recordedMinutes) || !Number.isFinite(b.recordedMinutes)) return { kind: 'unsupported' }
    return { kind: 'supplied', evidence: { source: 'user_message', subjectDisplayName: supplied[1]!.trim(), periodA: a, periodB: b, coverage: 'unknown' } }
  }
  const comparison = new RegExp(`^比较(.+?)\\s+${periodPattern}\\s*(?:和|与)\\s*${periodPattern}\\s*的记录学习时间[。？?]?$`).exec(text.trim())
  if (comparison) return finishSlots({ meaning: 'recorded_study_time', subject: { by: 'exact_name', name: comparison[1]!.trim() },
    periodA: { startDate: comparison[2]!, endDate: comparison[3]! }, periodB: { startDate: comparison[4]!, endDate: comparison[5]! } })
  return null
}

/** Exclude ordinary compounds such as 分别/区别/个别; standalone imperative 别 still blocks. */
export function hasRestrictionInstruction(text: string): boolean {
  return /不要|不看|不发|不用|禁止|请勿|撤回|(?<![分区个特识辨鉴判差级类性告])别/u.test(text)
}

/** Only current direct text and locally confirmed slots. No learning-data dependencies. */
export function classifyFirstSlice(text: string, clarification?: FocusSlots): FirstSliceGateResult {
  const normalized = text.trim().replace(/[，。！？?,!\s]/g, '')
  const intent = restriction(normalized)
  if (intent) return { kind: 'restriction', intent }
  // Unknown negative instructions block before clarification, retrieval, or ordinary chat.
  if (hasRestrictionInstruction(normalized)) return { kind: 'blocked', reason: 'clarify_restriction' }

  if (clarification) {
    const completeAnswer = completeFocusAnswer(text)
    if (completeAnswer?.kind === 'supplied' || completeAnswer?.kind === 'evidence') return completeAnswer
    const current = finishSlots(clarification)
    const missing = current.kind === 'clarify' ? current.missing : []
    const slots = { ...clarification }
    if (missing.includes('meaning') && /^(记录学习时间|记录投入|recorded_study_time)$/.test(normalized)) slots.meaning = 'recorded_study_time'
    const subject = /^科目[:：](.+)$/.exec(text.trim())
    if (subject && missing.includes('subject')) slots.subject = { by: 'exact_name', name: subject[1]!.trim() }
    const dates = new RegExp(`^(?:期间)?([AB])[:：]?\\s*${periodPattern}$`, 'i').exec(text.trim())
    if (dates) {
      const key = dates[1]!.toUpperCase() === 'A' ? 'periodA' : 'periodB'
      if (missing.includes(key)) slots[key] = { startDate: dates[2]!, endDate: dates[3]! }
    }
    return finishSlots(slots)
  }

  const progress = /^(.+?)(?:现在学到哪里|的?章节进度|的?学习进度)[。？?]?$/.exec(text.trim())
  if (progress) return { kind: 'evidence', request: { kind: 'subject_progress',
    subject: { by: 'exact_name', name: progress[1]!.trim() } } }

  const completeAnswer = completeFocusAnswer(text)
  if (completeAnswer) return completeAnswer
  const ambiguous = /^最近(.+?)效率下降[。？?]?$/.exec(text.trim())
  if (ambiguous) return finishSlots({ subject: { by: 'exact_name', name: ambiguous[1]!.trim() } })
  if (/记录学习时间|记录投入/.test(normalized)) return finishSlots({ meaning: 'recorded_study_time' })
  if (/效率|理解力|任务|日记|错题|记录|进度|学到哪里|覆盖未知/.test(normalized)) return { kind: 'unsupported' }
  // Bounded local-record intent: personal/lookup language plus a study-time fact.
  if (/(?:我|查|看看|统计)/.test(normalized)
    && /学习时长|学了多久|专注时间/.test(normalized)) return { kind: 'unsupported' }
  return { kind: 'chat' }
}

const localNotice = '这是本机记录核对，没有调用 AI Provider。'
const focusLimit = '记录学习时间不等于效率；真实学习覆盖未知；无归属记录已排除且未测量。未记录学习、理解与产出、真实原因均未知。未查询任务、日记或错题。'
function dayCount(p: Period): number { return (Date.parse(`${p.endDate}T00:00:00Z`) - Date.parse(`${p.startDate}T00:00:00Z`)) / 86400000 + 1 }
function formatPeriod(label: string, p: Period, value: FocusPeriodResult): string {
  const head = `${label} ${p.startDate} 至 ${p.endDate}（${dayCount(p)}天）`
  return value.status === 'ok' || value.status === 'empty'
    ? `${head}：记录 ${value.recordedMinutes} 分钟，有记录日期 ${value.observedDateCount}/${dayCount(p)} 天${value.status === 'empty' ? '（没有记录不等于没学习）' : ''}。`
    : `${head}：${value.status === 'failed' ? '未能核对' : '记录不可用'}，分钟和有记录日数未知。`
}

export function formatFirstSliceAnswer(envelope: EvidenceEnvelope): string {
  if (envelope.sourceCategory === 'subject_progress') {
    let facts: string
    if (envelope.status === 'empty') facts = '没有可用章节记录。'
    else if (envelope.status !== 'ok') facts = '未能核对章节记录或对象不可用，请在科目页面查看。'
    else {
      facts = `记录里已标完成 ${envelope.value.completed}/${envelope.value.total}；`
      facts += envelope.coverage === 'aggregate_only' ? '章节明细不足，无法确认下一章。'
        : envelope.value.nextTitle === null ? '没有未标完成项。' : `下一项未标完成的是${envelope.value.nextTitle}。`
    }
    return `${envelope.scope.subject.name}：${facts}仅核对章节标记，未查询专注、任务、日记或错题。${localNotice}`
  }
  const { scope, value } = envelope
  const lengths = dayCount(scope.periodA) === dayCount(scope.periodB) ? '' : '两期长度不同，以上为各期记录合计。'
  return `${scope.subject.name}：${formatPeriod('A', scope.periodA, value.periodA)}${formatPeriod('B', scope.periodB, value.periodB)}${lengths}${focusLimit}${localNotice}`
}

export function formatSuppliedFocusAnswer(evidence: SuppliedFocusEvidence): string {
  return `按你本次提供的自述（未经数据库核对）：${evidence.subjectDisplayName}；`
    + `A ${evidence.periodA.startDate} 至 ${evidence.periodA.endDate}：${evidence.periodA.recordedMinutes} 分钟；`
    + `B ${evidence.periodB.startDate} 至 ${evidence.periodB.endDate}：${evidence.periodB.recordedMinutes} 分钟。`
    + '覆盖未知，记录学习时间不等于效率。没有查询本机学习记录，也没有调用 AI Provider。'
}
