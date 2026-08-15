import { describe, expect, it } from 'vitest'
import {
  buildDailyReviewPlanningRunRequest,
  buildTodayActionPlanningRunRequest,
  mapPlanningContextSummary,
} from '../src/utils/planningHistoryClient'

describe('planningHistoryClient', () => {
  it('projects Today Action context into canonical privacy-bounded history order', () => {
    const summary = mapPlanningContextSummary('today_action', [
      {
        category: 'subjects',
        label: '科目',
        preparation: 'prepared',
        disposition: 'partially_included',
        reasonCode: 'limit_applied',
        preparedCount: 12,
        includedCount: 6,
        limit: 6,
      },
      {
        category: 'available_minutes',
        label: '今日可用时间',
        preparation: 'prepared',
        disposition: 'included',
        reasonCode: 'included_required',
        preparedCount: 1,
        includedCount: 1,
      },
      {
        category: 'focus_history',
        label: '专注历史',
        preparation: 'not_integrated',
        disposition: 'excluded',
        reasonCode: 'not_integrated',
        preparedCount: 0,
        includedCount: 0,
      },
    ])

    expect(summary).toEqual([
      {
        category: 'available_minutes',
        preparation: 'prepared',
        disposition: 'included',
        reasonCode: 'included_required',
      },
      {
        category: 'subjects',
        preparation: 'prepared',
        disposition: 'partially_included',
        reasonCode: 'limit_applied',
      },
      {
        category: 'focus_history',
        preparation: 'not_integrated',
        disposition: 'excluded',
        reasonCode: 'not_integrated',
      },
    ])
    expect(JSON.stringify(summary)).not.toContain('preparedCount')
    expect(JSON.stringify(summary)).not.toContain('label')
  })

  it('keeps original Today Action provider ordinals and maps reason to description', () => {
    const request = buildTodayActionPlanningRunRequest({
      id: '123e4567-e89b-42d3-a456-426614174000',
      date: '2026-05-31',
      contextDecisions: [],
      suggestions: [
        {
          clientId: 'suggestion-1',
          title: '',
          reason: 'invalid provider value',
          type: 'focus',
          estimate_minutes: 25,
          priority: 'medium',
          subject_id: null,
          related_mistake_id: null,
          related_entry_id: null,
          selected: false,
          validationErrors: ['Title is required'],
          creationState: 'draft',
        },
        {
          clientId: 'suggestion-2',
          title: '复习函数',
          reason: '今天到期',
          type: 'review',
          estimate_minutes: 25,
          priority: 'high',
          subject_id: 3,
          related_mistake_id: 9,
          related_entry_id: null,
          selected: true,
          validationErrors: [],
          creationState: 'draft',
        },
      ],
    })

    expect(request.generationResultKind).toBe('candidate_set')
    expect(request.candidates).toEqual([
      {
        ordinal: 1,
        admissionOrigin: 'provider_validated',
        userDisposition: 'selected_unconfirmed',
        title: '复习函数',
        description: '今天到期',
        type: 'review',
        estimateMinutes: 25,
        priority: 'high',
        subjectId: 3,
        relatedMistakeId: 9,
        relatedEntryId: null,
      },
    ])
  })

  it('uses the frozen Daily Review dates and preserves a structurally valid empty result', () => {
    const request = buildDailyReviewPlanningRunRequest({
      id: '123e4567-e89b-42d3-a456-426614174000',
      planningDate: '2026-05-31',
      targetDate: '2026-06-01',
      contextDecisions: [],
      candidates: [],
    })

    expect(request).toMatchObject({
      entryPoint: 'daily_review',
      planningDate: '2026-05-31',
      targetDate: '2026-06-01',
      generationResultKind: 'valid_empty',
      candidates: [],
    })
  })

})
