import { describe, expect, it } from 'vitest'
import type { FocusEnvelope, FocusPeriodResult, ProgressEnvelope } from '../src/types/api'
import { classifyFirstSlice as gate, formatFirstSliceAnswer as format, formatSuppliedFocusAnswer,
  type FocusSlots } from '../src/utils/aiFirstSlice'

const periodA = { startDate: '2026-09-07', endDate: '2026-09-13' }
const periodB = { startDate: '2026-09-14', endDate: '2026-09-20' }
const subject = { by: 'exact_name', name: '数学' } as const
const complete: FocusSlots = { meaning: 'recorded_study_time', subject, periodA, periodB }

describe('I2 pure deterministic interaction', () => {
  const partial: FocusSlots = { meaning: 'recorded_study_time', subject, periodA }
  it.each([
    ['subject', '科目：英语'],
    ['period A', 'A: 2026-09-01 至 2026-09-06'],
    ['multiple confirmed slots', '科目：英语\nA: 2026-09-01 至 2026-09-06'],
  ])('locks %s during partial clarification', (_slot, input) => {
    const before = structuredClone(partial)
    const result = gate(input!, partial)
    expect(result).toEqual({ kind: 'clarify', slots: before, missing: ['periodB'] })
    expect(result).not.toHaveProperty('request')
    expect(partial).toEqual(before)
  })
  it('locks confirmed B while A is missing', () => {
    const slots: FocusSlots = { meaning: 'recorded_study_time', subject, periodB }
    expect(gate('B: 2026-09-21 至 2026-09-27', slots))
      .toEqual({ kind: 'clarify', slots, missing: ['periodA'] })
  })
  it('fills only missing B using the confirmed subject and A', () => {
    expect(gate('B: 2026-09-14 至 2026-09-20', partial)).toEqual({ kind: 'evidence', request: {
      kind: 'focus_comparison', subject, periodA, periodB,
    } })
  })
  it('accepts a complete valid replacement without merging old slots', () => {
    expect(gate('比较英语 2026-09-01 至 2026-09-06\n和 2026-09-14 至 2026-09-20 的记录学习时间', partial))
      .toEqual({ kind: 'evidence', request: { kind: 'focus_comparison', subject: { by: 'exact_name', name: '英语' },
        periodA: { startDate: '2026-09-01', endDate: '2026-09-06' }, periodB } })
  })
  it('does not replace confirmed scope with an invalid complete specification', () => {
    expect(gate('比较英语 2026-09-01 至 2026-09-16 和 2026-09-14 至 2026-09-20 的记录学习时间', partial))
      .toEqual({ kind: 'clarify', slots: partial, missing: ['periodB'] })
  })
  it.each(['查一下我上周的学习时长', '看看我最近学了多久', '统计一下我之前的专注时间', '帮我查最近学习记录'])(
    'blocks unsupported personal-record intent: %s', text => {
      expect(gate(text)).toEqual({ kind: 'unsupported' })
      expect(gate(text)).not.toHaveProperty('request')
    })
  it.each(['讲克拉默法则', '学习时长一般怎么安排？', '番茄钟一次多长合适？'])(
    'preserves ordinary knowledge: %s', text => expect(gate(text)).toEqual({ kind: 'chat' }))
  it('consumes sufficient current self-report while clarification is active', () => {
    const first = gate('最近数学效率下降')
    if (first.kind !== 'clarify') throw new Error('Expected clarification')
    const text = '数学\n2026-09-07..13 = 70 min\n2026-09-14..20 = 140 min\n覆盖未知'
    for (const slots of [first.slots, complete]) {
      const answer = gate(text, slots)
      expect(answer).toEqual({ kind: 'supplied', evidence: { source: 'user_message', subjectDisplayName: '数学',
        periodA: { ...periodA, recordedMinutes: 70 }, periodB: { ...periodB, recordedMinutes: 140 }, coverage: 'unknown' } })
      expect(answer).not.toHaveProperty('request')
    }
  })
  it('consumes a complete explicit S2 answer during partial clarification', () => {
    expect(gate('比较数学 2026-09-07 至 2026-09-13 和 2026-09-14 至 2026-09-20 的记录学习时间', { subject }))
      .toEqual({ kind: 'evidence', request: { kind: 'focus_comparison', subject, periodA, periodB } })
  })
  it.each(['线代现在学到哪里？', '线代的章节进度', '线代学习进度'])('recognizes exact S3: %s', text => {
    expect(gate(text)).toEqual({ kind: 'evidence', request: { kind: 'subject_progress', subject: { by: 'exact_name', name: '线代' } } })
    expect(JSON.stringify(gate(text))).not.toContain('线性代数')
  })
  it('preserves internal whitespace and Unicode in exact subject identity', () => {
    expect(gate(' Ｍath  e\u0301现在学到哪里？')).toMatchObject({ request: { subject: { name: 'Ｍath  e\u0301' } } })
  })
  it('clarifies efficiency without interpreting it as minutes', () => {
    expect(gate('最近数学效率下降。')).toEqual({ kind: 'clarify', slots: { subject }, missing: ['meaning', 'periodA', 'periodB'] })
  })
  it.each([
    [{ meaning: 'recorded_study_time' }, ['subject', 'periodA', 'periodB']],
    [{ subject }, ['meaning', 'periodA', 'periodB']],
    [{ periodA }, ['meaning', 'subject', 'periodB']],
    [{ periodB }, ['meaning', 'subject', 'periodA']],
    [{ meaning: 'recorded_study_time', subject, periodA }, ['periodB']],
  ] as Array<[FocusSlots, string[]]>)('asks only missing slots for %j', (slots, missing) => {
    expect(gate('', slots)).toEqual({ kind: 'clarify', slots, missing })
    expect(gate('', slots)).not.toHaveProperty('request')
  })
  it('continues explicit slot answers without restarting', () => {
    const a = gate('记录投入', { subject, periodA })
    expect(a).toMatchObject({ kind: 'clarify', missing: ['periodB'] })
    if (a.kind !== 'clarify') throw new Error('Expected clarification')
    expect(gate('B: 2026-09-14 至 2026-09-20', a.slots)).toEqual({ kind: 'evidence', request: {
      kind: 'focus_comparison', subject, periodA, periodB,
    } })
    expect(gate('科目：数学', { meaning: 'recorded_study_time', periodA, periodB })).toMatchObject({ kind: 'evidence' })
  })
  it('keeps active clarification ahead of another supported intent or chat', () => {
    expect(gate('线代现在学到哪里？', { periodA })).toMatchObject({ kind: 'clarify', missing: ['meaning', 'subject', 'periodB'] })
    expect(gate('讲克拉默法则', { subject })).toMatchObject({ kind: 'clarify' })
  })
  it.each(['和', '与'])('returns exactly the locked S2 variant (%s)', conjunction => {
    expect(gate(`比较数学 2026-09-07 至 2026-09-13\n${conjunction} 2026-09-14 至 2026-09-20 的记录学习时间`)).toEqual({
      kind: 'evidence', request: { kind: 'focus_comparison', subject, periodA, periodB },
    })
  })
  it.each(['最近', '上次', '前一阵', '这周和之前'])('does not invent absolute dates: %s', word => {
    expect(gate(`比较数学${word}的记录学习时间`)).toMatchObject({ kind: 'clarify' })
    expect(gate(word, { meaning: 'recorded_study_time', subject, periodA })).toMatchObject({ missing: ['periodB'] })
    expect(gate(word, complete)).toMatchObject({ kind: 'evidence', request: { periodA, periodB } })
  })
  it.each([
    { startDate: '2026-02-29', endDate: '2026-03-01' },
    { startDate: '2026-09-13', endDate: '2026-09-07' },
    { startDate: '2026-9-07', endDate: '2026-09-13' },
    { startDate: '0000-01-01', endDate: '0000-01-02' },
  ])('invalid/reversed dates clarify without normalization: %j', invalid => {
    expect(gate('', { ...complete, periodA: invalid })).toMatchObject({ kind: 'clarify', missing: ['periodA'] })
  })
  it('rejects overlapping inclusive periods', () => {
    expect(gate('', { ...complete, periodB: { ...periodB, startDate: periodA.endDate } })).toMatchObject({
      kind: 'clarify', missing: ['periodA', 'periodB'],
    })
  })
  it('preserves confirmed ids, unequal periods, and reverse chronological non-overlapping pairs', () => {
    expect(gate('', { ...complete, subject: { by: 'id', id: 7 }, periodA: periodB,
      periodB: { ...periodA, endDate: periodA.startDate } })).toMatchObject({ kind: 'evidence', request: {
      subject: { by: 'id', id: 7 }, periodA: periodB, periodB: { ...periodA, endDate: periodA.startDate },
    } })
  })
  it('takes supplied evidence without creating a database envelope/request', () => {
    const result = gate('数学\n2026-09-07..13 = 70 min\n2026-09-14..20 = 140 min\n覆盖未知')
    expect(result).toEqual({ kind: 'supplied', evidence: { source: 'user_message', subjectDisplayName: '数学',
      periodA: { ...periodA, recordedMinutes: 70 }, periodB: { ...periodB, recordedMinutes: 140 }, coverage: 'unknown' } })
    expect(result).not.toHaveProperty('request')
    if (result.kind !== 'supplied') throw new Error('Expected supplied evidence')
    expect(formatSuppliedFocusAnswer(result.evidence)).toContain('未经数据库核对')
    expect(formatSuppliedFocusAnswer(result.evidence)).toContain('记录学习时间不等于效率')
  })
  it.each(['为什么我的数学效率下降？', '我最近是不是理解力变差了？', '查任务历史看看我为什么拖延',
    '搜索一下日记找原因', '看看错题记录判断是不是退步'])('does not invent retrieval: %s', text => {
    expect(gate(text)).toEqual({ kind: 'unsupported' })
  })
  it.each([
    ['这次别发日记', 'request', 'diary', 'disclose', 'all'],
    ['这次别发给 AI', 'request', 'all-outbound', 'disclose', 'all'],
    ['接下来这段不要用日记', 'session', 'diary', 'use', 'all'],
    ['以后默认不要把日记发给这个 Provider', 'durable_preference', 'diary', 'disclose', 'current_provider'],
    ['以后在这里一直不要发给 AI', 'durable_preference', 'all-outbound', 'disclose', 'all'],
    ['不看日记但帮我分析', 'request', 'diary', 'use', 'all'],
  ])('handles restriction before active clarification: %s', (text, lifetime, category, operation, destination) => {
    expect(gate(text!, complete)).toMatchObject({ kind: 'restriction', intent: { lifetime, target: { category, operation }, destination } })
  })
  it.each(['不要用那段', '别再这样', '不要用昨天的日记', '线代现在学到哪里？这次别发日记'])('blocks ambiguous/narrower scope: %s', text => {
    expect(gate(text, complete)).toEqual({ kind: 'blocked', reason: 'clarify_restriction' })
  })
  it.each([
    '请分别分析文件文字和图片。', '分别总结这两个附件。', '分别回答每个问题。',
    '区别是什么？', '个别情况需要注意。', '特别关注这个问题。', '识别图片中的文字。',
    '辨别这两种方法。', '鉴别这个物品。', '判别这两个结果。', '差别是什么？',
    '级别是什么？', '类别是什么？', '性别是什么？', '告别过去。',
  ])('allows ordinary words containing 别: %s', text => {
    expect(gate(text)).toEqual({ kind: 'chat' })
  })
  it.each([
    '别分析图片。', '别做这个操作。', '不要读取附件。', '禁止使用图片。', '请勿联网。',
    '不要调用工具。', '请别分析图片。', '这次别分析图片。', '请分别分析文字，但别读取图片。',
    '分别总结这两个附件，禁止联网。',
  ])('keeps explicit restriction instructions ahead of chat and clarification: %s', text => {
    for (const slots of [undefined, complete]) {
      expect(gate(text, slots)).toEqual({ kind: 'blocked', reason: 'clarify_restriction' })
    }
  })
  it('leaves ordinary knowledge chat without evidence', () => {
    expect(gate('讲克拉默法则')).toEqual({ kind: 'chat' })
  })
})

describe('I2 local evidence-bounded answers', () => {
  const base = { sourceCategory: 'subject_progress', semantics: 'chapter_marks',
    scope: { subject: { id: 1, name: '线代' }, observedAt: '2026-09-21T00:00:00Z' } } as const
  const detail: ProgressEnvelope = { ...base, status: 'ok', coverage: 'detail', value: { completed: 2, total: 3, nextTitle: '第3章' } }
  it('describes marks and the next unmarked item, not real understanding', () => {
    const answer = format(detail)
    expect(answer).toContain('记录里已标完成 2/3')
    expect(answer).toContain('下一项未标完成的是第3章')
    expect(answer).toContain('没有调用 AI Provider')
    expect(answer).not.toMatch(/已经学会|理解了|实际.*完成|原因是/)
  })
  it('handles all marked complete without claiming mastery', () => {
    expect(format({ ...detail, value: { completed: 3, total: 3, nextTitle: null } })).toContain('没有未标完成项')
  })
  it('never uses nextTitle for aggregate-only evidence', () => {
    const answer = format({ ...detail, coverage: 'aggregate_only' })
    expect(answer).toContain('章节明细不足')
    expect(answer).not.toContain('第3章')
  })
  it('empty is not 0/0 completion', () => {
    const answer = format({ ...base, status: 'empty', value: null, coverage: 'no_chapter_records' })
    expect(answer).toContain('没有可用章节记录')
    expect(answer).not.toMatch(/0\/0|没学习|学完/)
  })
  it.each(['failed', 'unavailable'] as const)('preserves progress %s', status => {
    expect(format({ ...base, status, value: null, coverage: 'unknown' })).toContain('未能核对')
  })
  const ok: FocusPeriodResult = { status: 'ok', recordedMinutes: 70, observedDateCount: 2 }
  const empty: FocusPeriodResult = { status: 'empty', recordedMinutes: 0, observedDateCount: 0 }
  const failed: FocusPeriodResult = { status: 'failed', recordedMinutes: null, observedDateCount: null }
  const unavailable: FocusPeriodResult = { status: 'unavailable', recordedMinutes: null, observedDateCount: null }
  it.each([
    [ok, { ...ok, recordedMinutes: 140 }, 'ok'], [empty, empty, 'empty'], [ok, failed, 'partial'],
    [failed, ok, 'partial'], [failed, failed, 'failed'], [unavailable, unavailable, 'unavailable'],
  ] as Array<[FocusPeriodResult, FocusPeriodResult, FocusEnvelope['status']]>)('formats A=%j B=%j (%s)', (a, b, status) => {
    const e: FocusEnvelope = { sourceCategory: 'focus_comparison', semantics: 'recorded_focus_minutes',
      scope: { subject: { id: 1, name: '数学' }, periodA, periodB, observedAt: '2026-09-21T00:00:00Z' },
      status, value: { periodA: a, periodB: b }, coverage: { realStudy: 'unknown', unassigned: 'excluded_not_measured' } }
    const answer = format(e)
    expect(answer).toContain('数学')
    for (const date of [periodA.startDate, periodA.endDate, periodB.startDate, periodB.endDate]) expect(answer).toContain(date)
    for (const p of [a, b]) {
      if (p.status === 'ok' || p.status === 'empty') {
        expect(answer).toContain(`记录 ${p.recordedMinutes} 分钟`)
        expect(answer).toContain(`${p.observedDateCount}/7 天`)
      } else expect(answer).toContain('分钟和有记录日数未知')
    }
    expect(answer).toContain('真实学习覆盖未知')
    expect(answer).toContain('无归属记录已排除且未测量')
    expect(answer).toContain('记录学习时间不等于效率')
    expect(answer).not.toMatch(/效率(?:提高|下降)|理解(?:提高|变差)|原因是|翻倍|差值|日均/)
  })
  it('reports unequal lengths without per-day normalization', () => {
    const answer = format({ sourceCategory: 'focus_comparison', semantics: 'recorded_focus_minutes', status: 'ok',
      scope: { subject: { id: 1, name: '数学' }, periodA, periodB: { ...periodB, endDate: periodB.startDate }, observedAt: '' },
      value: { periodA: ok, periodB: ok }, coverage: { realStudy: 'unknown', unassigned: 'excluded_not_measured' } })
    expect(answer).toContain('（7天）')
    expect(answer).toContain('（1天）')
    expect(answer).toContain('两期长度不同')
    expect(answer).not.toContain('日均')
  })
})
