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

/** Output preferences do not revoke data access; ambiguous data/action refusals still fail closed. */
export function hasRestrictionInstruction(text: string): boolean {
  const remaining = text.replace(
    /(?:不要|不用|请勿|(?<![分区个特识辨鉴判差级类性告])别)(?:先|再|直接|立即|马上|现在|提前){0,2}(?:给出?|提供|展示|显示|写出?|附上|附带|包含|告诉)?(?:我)?(?:答案|解答|解析|解题步骤|提示|解释|剧透)|(?:不要|不用|别)(?:讲|写|解释|安排)?(?:太难|太简单|太长|太详细|太复杂|太满|过于复杂)/gu,
    '',
  ).replace(/别人/gu, '')
  const negative = /不要|不看|不发|不用|禁止|请勿|撤回|(?<![分区个特识辨鉴判差级类性告])别/u
  if (!negative.test(remaining)) return false

  // Questions about methods, health or writing topics are ordinary conversation.
  // Any data, transmission or ambiguous action object still takes precedence,
  // including another clause mixed into the same message.
  const controlledObject = /日记|私人|隐私|记录|数据|资料|内容|附件|图片|文件|本地|本机|数据库|Provider|AI|联网|工具|授权|发给|发送|发出去|上传|传输|分享|交给|透露|披露|转发|读取|调用|访问|操作|执行|修改|删除|保存|继续|那段|这样|上面|前面|之前|刚才|接下来|(?:用|看|把|将)(?:那|这|它|昨天)|(?:不要|不用|别)(?:再|先)?(?:这个|那个)/iu
  if (controlledObject.test(remaining)) return true
  if (/撤回/u.test(remaining)) {
    // A Git knowledge question does not revoke this conversation's authorization.
    if (!/Git\s*(?:怎么|如何|怎样).*撤回.*\bcommit\b/iu.test(remaining)) return true
    if (negative.test(remaining.replace(/撤回/gu, ''))) return true
    return false
  }
  const knowledgeQuestion = /怎么|如何|怎样|什么.*依据|科学依据|有什么.*原因/u
  const writingTopic = /(?:写|撰写).*(?:议论文|作文|文章|论述)/u
  return !knowledgeQuestion.test(remaining) && !writingTopic.test(remaining)
}

/** Only current direct text and locally confirmed slots. No learning-data dependencies. */
export function classifyFirstSlice(text: string, clarification?: FocusSlots): FirstSliceGateResult {
  const normalized = text.trim().replace(/[，。！？?,!\s]/g, '')
  const intent = restriction(normalized)
  if (intent) return { kind: 'restriction', intent }
  // Data/action refusals block before clarification, retrieval, or ordinary chat.
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
  if (progress && !/制定|安排|规划|设计|建议/.test(progress[1]!)) return { kind: 'evidence', request: { kind: 'subject_progress',
    subject: { by: 'exact_name', name: progress[1]!.trim() } } }

  const completeAnswer = completeFocusAnswer(text)
  if (completeAnswer) return completeAnswer
  const ambiguous = /^最近(.+?)效率下降[。？?]?$/.exec(text.trim())
  if (ambiguous) return finishSlots({ subject: { by: 'exact_name', name: ambiguous[1]!.trim() } })
  if (/记录学习时间|记录投入/.test(normalized)
    && /比较|对比|查询|查一下|统计|^(?:记录学习时间|记录投入)$/.test(normalized)) {
    return finishSlots({ meaning: 'recorded_study_time' })
  }
  // Topic words alone (e.g. a task plan or advice on efficiency) do not request local data.
  const localTopic = /任务|日记|错题|记录|进度|学到哪里|学习时长|学了多久|专注时间/
  const lookup = /查|搜索|检索|统计|读取|查看|看看|根据|结合|分析|总结|回顾|比较|对比/
  const localSource = /本地|本机|数据库|MindDiary|我的|我最近|我之前|我上周|我这周|历史|记录/
  if (localTopic.test(normalized) && lookup.test(normalized)
    && (localSource.test(normalized) || /查|搜索|检索|读取/.test(normalized))) {
    return { kind: 'unsupported' }
  }
  if (/我的|我最近|我之前|我上周|我这周/.test(normalized)
    && /效率.*下降|理解力.*变差|是不是.*退步/.test(normalized)) return { kind: 'unsupported' }
  if (/覆盖未知/.test(normalized)) return { kind: 'unsupported' }
  // Bounded local-record intent: personal/lookup language plus a study-time fact.
  if (/(?:查|看看|统计|我的|我最近|我之前|我上周|我这周|我.*学了多久)/.test(normalized)
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
