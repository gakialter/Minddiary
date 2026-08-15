// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { DATABASE_BACKUP_TABLES, normalizeBackupDatabaseData } from '../electron/databaseBackupData'

const TODAY_CONTEXT_JSON = JSON.stringify([
  { category: 'available_minutes', preparation: 'prepared', disposition: 'included', reasonCode: 'included_required' },
  { category: 'today_tasks', preparation: 'prepared', disposition: 'included', reasonCode: 'included_required' },
  { category: 'due_mistakes', preparation: 'prepared', disposition: 'included', reasonCode: 'included_required' },
  { category: 'subjects', preparation: 'prepared', disposition: 'included', reasonCode: 'included_required' },
  { category: 'today_entry', preparation: 'prepared', disposition: 'included', reasonCode: 'included_required' },
  { category: 'chapters', preparation: 'prepared', disposition: 'included', reasonCode: 'included_required' },
  { category: 'focus_history', preparation: 'prepared', disposition: 'included', reasonCode: 'included_required' },
])
const DAILY_CONTEXT_JSON = JSON.stringify([
  { category: 'today_tasks', preparation: 'prepared', disposition: 'included', reasonCode: 'included_required' },
  { category: 'candidate_date_tasks', preparation: 'prepared', disposition: 'included', reasonCode: 'included_required' },
  { category: 'pomodoro', preparation: 'prepared_empty', disposition: 'included_empty', reasonCode: 'included_empty' },
  { category: 'subjects', preparation: 'prepared', disposition: 'included', reasonCode: 'included_available' },
  { category: 'today_entry', preparation: 'prepared_empty', disposition: 'included_empty', reasonCode: 'no_record' },
  { category: 'due_mistakes', preparation: 'source_unavailable', disposition: 'excluded', reasonCode: 'source_unavailable' },
  { category: 'available_minutes', preparation: 'not_integrated', disposition: 'excluded', reasonCode: 'not_integrated' },
])

function makePlanningRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '123e4567-e89b-42d3-a456-426614174000',
    contract_version: 'planning-history.v1',
    entry_point: 'today_action',
    planning_date: '2026-08-13',
    target_date: '2026-08-13',
    generation_result_kind: 'candidate_set',
    context_summary_json: TODAY_CONTEXT_JSON,
    created_at: '2026-08-13T01:02:03.004Z',
    updated_at: '2026-08-13T01:02:03.004Z',
    closed_at: null,
    close_reason: null,
    ...overrides,
  }
}

function makePlanningCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    planning_run_id: '123e4567-e89b-42d3-a456-426614174000',
    ordinal: 0,
    admission_origin: 'provider_validated',
    title: 'Review chapter three',
    description: 'Use the retained summary',
    type: 'focus',
    estimate_minutes: 25,
    priority: 'high',
    subject_id: 900,
    related_mistake_id: null,
    related_entry_id: null,
    edit_before_json: JSON.stringify({ title: 'Review chapter two', subject_id: null }),
    user_disposition: 'selected_unconfirmed',
    operation_id: null,
    outcome_kind: null,
    outcome_observed_at: null,
    admitted_at: '2026-08-13T01:02:03.004Z',
    updated_at: '2026-08-13T01:03:03.004Z',
    ...overrides,
  }
}

describe('database backup data normalization', () => {
  it('requires both planning sections for schema 7 while schema 6 normalizes them to empty history', () => {
    const legacy = normalizeBackupDatabaseData({}, 6)

    expect(legacy.planning_runs).toEqual([])
    expect(legacy.planning_run_candidates).toEqual([])
    expect(() => normalizeBackupDatabaseData({ planning_runs: [] }, 7)).toThrow(/planning_run_candidates/i)
    expect(() => normalizeBackupDatabaseData({ planning_run_candidates: [] }, 7)).toThrow(/planning_runs/i)

    const current = normalizeBackupDatabaseData({
      planning_runs: [],
      planning_run_candidates: [],
    }, 7)
    expect(current.planning_runs).toEqual([])
    expect(current.planning_run_candidates).toEqual([])
  })

  it('exports planning parents before candidates with the frozen schema 7 columns', () => {
    const runsIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'planning_runs')
    const candidatesIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'planning_run_candidates')

    expect(runsIndex).toBeGreaterThanOrEqual(0)
    expect(candidatesIndex).toBe(runsIndex + 1)
    expect(DATABASE_BACKUP_TABLES[runsIndex]?.columns).toEqual([
      'id',
      'contract_version',
      'entry_point',
      'planning_date',
      'target_date',
      'generation_result_kind',
      'context_summary_json',
      'created_at',
      'updated_at',
      'closed_at',
      'close_reason',
    ])
    expect(DATABASE_BACKUP_TABLES[candidatesIndex]?.columns).toEqual([
      'id',
      'planning_run_id',
      'ordinal',
      'admission_origin',
      'title',
      'description',
      'type',
      'estimate_minutes',
      'priority',
      'subject_id',
      'related_mistake_id',
      'related_entry_id',
      'edit_before_json',
      'user_disposition',
      'operation_id',
      'outcome_kind',
      'outcome_observed_at',
      'admitted_at',
      'updated_at',
    ])
  })

  it('strictly validates canonical schema 7 planning run rows before restore', () => {
    const normalized = normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [],
    }, 7)
    expect(normalized.planning_runs).toEqual([makePlanningRun()])

    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun({ id: '123E4567-E89B-42D3-A456-426614174000' })],
      planning_run_candidates: [],
    }, 7)).toThrow(/planning_runs\[0\]\.id/i)
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun({ raw_prompt: 'private' })],
      planning_run_candidates: [],
    }, 7)).toThrow(/supported fields/i)
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun({ created_at: '2026-08-13T01:02:03Z' })],
      planning_run_candidates: [],
    }, 7)).toThrow(/created_at/i)
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun({ context_summary_json: `${TODAY_CONTEXT_JSON} ` })],
      planning_run_candidates: [],
    }, 7)).toThrow(/canonical/i)
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun(), makePlanningRun()],
      planning_run_candidates: [],
    }, 7)).toThrow(/duplicate.*planning run/i)
  })

  it('strictly validates retained candidate ownership, state, edits, and dangling logical references', () => {
    const normalized = normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [makePlanningCandidate()],
    }, 7)
    expect(normalized.planning_run_candidates).toEqual([makePlanningCandidate()])

    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [makePlanningCandidate({ provider_response: 'private' })],
    }, 7)).toThrow(/supported fields/i)
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [makePlanningCandidate({ planning_run_id: '223e4567-e89b-42d3-a456-426614174000' })],
    }, 7)).toThrow(/orphan/i)
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [makePlanningCandidate({
        operation_id: '323e4567-e89b-42d3-a456-426614174000',
      })],
    }, 7)).toThrow(/state|disposition/i)
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [makePlanningCandidate({ edit_before_json: '{"subject_id":null,"title":"Review chapter two"}' })],
    }, 7)).toThrow(/canonical/i)
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun({ generation_result_kind: 'valid_empty' })],
      planning_run_candidates: [makePlanningCandidate()],
    }, 7)).toThrow(/valid_empty/i)
  })

  it('rejects duplicate candidate identities, ordinals, operations, invalid edit fields, and broken state pairs', () => {
    const confirmed = makePlanningCandidate({
      user_disposition: 'confirmed',
      operation_id: '323e4567-e89b-42d3-a456-426614174000',
      outcome_kind: null,
      outcome_observed_at: null,
    })
    expect(normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [confirmed],
    }, 7).planning_run_candidates).toEqual([confirmed])

    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [makePlanningCandidate(), makePlanningCandidate({ id: 2 })],
    }, 7)).toThrow(/duplicate.*ordinal/i)
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [
        confirmed,
        makePlanningCandidate({ ...confirmed, id: 2, ordinal: 1 }),
      ],
    }, 7)).toThrow(/duplicate.*operation/i)
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [makePlanningCandidate({
        edit_before_json: JSON.stringify({ related_chapter_id: 8 }),
      })],
    }, 7)).toThrow(/supported edit fields/i)
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [makePlanningCandidate({
        user_disposition: 'confirmed',
        operation_id: '323e4567-e89b-42d3-a456-426614174000',
        outcome_kind: 'created',
        outcome_observed_at: null,
      })],
    }, 7)).toThrow(/paired/i)
  })

  it('rejects non-canonical context payloads and private planning-history copies', () => {
    const context = JSON.parse(TODAY_CONTEXT_JSON) as Array<Record<string, unknown>>
    context[0] = { ...context[0], preparedCount: 42 }

    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun({ context_summary_json: JSON.stringify(context) })],
      planning_run_candidates: [],
    }, 7)).toThrow(/supported fields/i)
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun({
        context_summary_json: TODAY_CONTEXT_JSON.replace('available_minutes', 'today_tasks'),
      })],
      planning_run_candidates: [],
    }, 7)).toThrow(/canonical order/i)
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [makePlanningCandidate({ raw_validation_message: 'private' })],
    }, 7)).toThrow(/supported fields/i)
  })

  it.each([
    'raw_prompt',
    'raw_provider_request',
    'raw_provider_response',
    'provider_reasoning',
    'generationContextSignature',
    'confirmationContextSignature',
    'receipt_digest',
    'full_diary_body',
    'full_mistake_answer',
    'attachment_path',
    'attachment_content',
    'api_key',
    'authorization_header',
    'raw_error',
    'stack',
    'raw_validation_message',
    'removed_candidate_content',
  ])('rejects private planning candidate field %s', privateField => {
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [makePlanningCandidate({ [privateField]: 'private' })],
    }, 7)).toThrow(/supported fields/i)
  })

  it('validates Daily Review context order and disallows entry relations in final and edit-before state', () => {
    const run = makePlanningRun({
      id: '423e4567-e89b-42d3-a456-426614174000',
      entry_point: 'daily_review',
      target_date: '2026-08-14',
      context_summary_json: DAILY_CONTEXT_JSON,
    })
    const candidate = makePlanningCandidate({
      planning_run_id: run.id,
      edit_before_json: '{}',
    })

    expect(normalizeBackupDatabaseData({
      planning_runs: [run],
      planning_run_candidates: [candidate],
    }, 7).planning_runs).toEqual([run])
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [run],
      planning_run_candidates: [makePlanningCandidate({
        planning_run_id: run.id,
        related_entry_id: 9,
      })],
    }, 7)).toThrow(/Daily Review/i)
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [run],
      planning_run_candidates: [makePlanningCandidate({
        planning_run_id: run.id,
        edit_before_json: JSON.stringify({ related_entry_id: 9 }),
      })],
    }, 7)).toThrow(/supported edit fields/i)
  })

  it('normalizes settings objects, legacy mistakes wrappers, and raw pomodoro session rows', () => {
    const normalized = normalizeBackupDatabaseData({
      settings: {
        theme: 'dark',
        countdownEvents: [{ id: 'exam', title: 'Exam' }],
      },
      mistakes: {
        data: [{ id: 7, question: '2 + 2', answer: '4', image_path: 'mistake_images/q.png' }],
      },
      pomodoro: [{
        id: 6,
        subject_id: 2,
        task_id: 3,
        duration: 25,
        date_key: '2026-05-20',
        started_at: '2026-05-20 01:00:00',
        completed_at: '2026-05-20 01:25:00',
      }],
    })

    expect(normalized.settings).toEqual([
      { key: 'theme', value: 'dark' },
      { key: 'countdownEvents', value: JSON.stringify([{ id: 'exam', title: 'Exam' }]) },
    ])
    expect(normalized.mistakes).toEqual([{ id: 7, question: '2 + 2', answer: '4', image_path: 'mistake_images/q.png' }])
    expect(normalized.pomodoro_sessions).toEqual([{
      id: 6,
      subject_id: 2,
      task_id: 3,
      duration: 25,
      date_key: '2026-05-20',
      started_at: '2026-05-20 01:00:00',
      completed_at: '2026-05-20 01:25:00',
    }])
  })

  it('treats old aggregate pomodoro backup rows as non-restorable sessions', () => {
    const normalized = normalizeBackupDatabaseData({
      pomodoro: [{ date: '2026-05-20', total_minutes: 50, session_count: 2 }],
    })

    expect(normalized.pomodoro_sessions).toEqual([])
  })

  it('keeps study task rows in the normalized backup payload', () => {
    const task = {
      id: 3,
      title: 'Review risk pool',
      description: '',
      type: 'review',
      subject_id: 2,
      related_mistake_id: null,
      related_entry_id: null,
      related_chapter_id: 9,
      planned_date: '2026-05-31',
      estimate_minutes: 25,
      status: 'todo',
      source: 'dashboard',
      created_at: '2026-05-31 08:00:00',
      updated_at: '2026-05-31 08:00:00',
    }

    const normalized = normalizeBackupDatabaseData({
      study_tasks: [task],
    })

    expect(normalized.study_tasks).toEqual([task])
    const taskTable = DATABASE_BACKUP_TABLES.find(item => item.table === 'study_tasks')
    expect(taskTable?.columns).toContain('related_chapter_id')
  })

  it('normalizes action receipts immediately after study tasks for FK-safe restore', () => {
    const receipt = {
      operation_id: '123e4567-e89b-42d3-a456-426614174000',
      operation_kind: 'today_action',
      action_contract_version: 'confirmed-study-task-action.v1',
      request_digest: 'a'.repeat(64),
      expected_current_date: '2026-07-30',
      planned_date: '2026-07-30',
      task_id: 3,
      created_at: '2026-07-30 08:00:00',
    }
    const taskIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'study_tasks')
    const receiptIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'study_task_action_receipts')
    const pomodoroIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'pomodoro_sessions')
    const receiptTable = DATABASE_BACKUP_TABLES[receiptIndex]

    expect(receiptIndex).toBe(taskIndex + 1)
    expect(pomodoroIndex).toBeGreaterThan(receiptIndex)
    expect(receiptTable?.columns).toEqual([
      'operation_id',
      'operation_kind',
      'action_contract_version',
      'request_digest',
      'expected_current_date',
      'planned_date',
      'task_id',
      'created_at',
    ])
    expect(normalizeBackupDatabaseData({
      study_task_action_receipts: [receipt],
    }).study_task_action_receipts).toEqual([receipt])
  })

  it('treats old backups that omit action receipts as an empty receipt set', () => {
    const normalized = normalizeBackupDatabaseData({
      study_tasks: [],
    })

    expect(normalized.study_task_action_receipts).toEqual([])
  })

  it('normalizes subject chapters and restores them immediately after subjects', () => {
    const chapter = {
      id: 2,
      subject_id: 1,
      title: '第一章 函数',
      notes: '重点',
      completed: 1,
      sort_order: 0,
      created_at: '2026-06-13 08:00:00',
      updated_at: '2026-06-13 08:00:00',
    }
    const subjectsIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'subjects')
    const chaptersIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'subject_chapters')
    const taskIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'study_tasks')
    const mistakesIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'mistakes')
    const chaptersTable = DATABASE_BACKUP_TABLES[chaptersIndex]

    expect(subjectsIndex).toBeGreaterThanOrEqual(0)
    expect(chaptersIndex).toBeGreaterThan(subjectsIndex)
    expect(mistakesIndex).toBeGreaterThan(chaptersIndex)
    expect(taskIndex).toBeGreaterThan(chaptersIndex)
    expect(chaptersTable?.columns).toEqual([
      'id',
      'subject_id',
      'title',
      'notes',
      'completed',
      'sort_order',
      'created_at',
      'updated_at',
    ])

    expect(normalizeBackupDatabaseData({ subject_chapters: [chapter] }).subject_chapters).toEqual([chapter])
    expect(normalizeBackupDatabaseData({ subjects: [] }).subject_chapters).toEqual([])
  })

  it('exports pomodoro task attribution after study tasks for dependency-safe restore', () => {
    const taskIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'study_tasks')
    const pomodoroIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'pomodoro_sessions')
    const pomodoroTable = DATABASE_BACKUP_TABLES[pomodoroIndex]

    expect(taskIndex).toBeGreaterThanOrEqual(0)
    expect(pomodoroIndex).toBeGreaterThan(taskIndex)
    expect(pomodoroTable?.columns).toEqual(expect.arrayContaining(['task_id']))

    const normalized = normalizeBackupDatabaseData({
      pomodoro_sessions: [{
        id: 10,
        subject_id: null,
        duration: 30,
        date_key: '2026-06-12',
      }],
    })

    expect(normalized.pomodoro_sessions).toEqual([{
      id: 10,
      subject_id: null,
      duration: 30,
      date_key: '2026-06-12',
    }])
  })

  it('exports answer image paths in the mistake backup column list without requiring old backups to contain them', () => {
    const mistakeTable = DATABASE_BACKUP_TABLES.find(item => item.table === 'mistakes')

    expect(mistakeTable?.columns).toEqual(expect.arrayContaining(['image_path', 'answer_image_path']))
    expect(mistakeTable?.columns.indexOf('answer_image_path')).toBe(
      (mistakeTable?.columns.indexOf('image_path') ?? -2) + 1,
    )

    const normalized = normalizeBackupDatabaseData({
      mistakes: [{ id: 8, question: 'legacy', image_path: 'mistake_images/legacy.png' }],
    })

    expect(normalized.mistakes).toEqual([
      { id: 8, question: 'legacy', image_path: 'mistake_images/legacy.png' },
    ])
  })

  it('filters sensitive settings from object-shaped restore payloads', () => {
    const normalized = normalizeBackupDatabaseData({
      settings: {
        theme: 'dark',
        aiApiKey: 'enc:v1:secret',
      },
    })

    expect(normalized.settings).toEqual([{ key: 'theme', value: 'dark' }])
  })

  it('filters sensitive settings from row-shaped restore payloads', () => {
    const normalized = normalizeBackupDatabaseData({
      settings: [
        { key: 'theme', value: 'dark' },
        { key: 'aiApiKey', value: 'enc:v1:secret' },
      ],
    })

    expect(normalized.settings).toEqual([{ key: 'theme', value: 'dark' }])
  })

  it('rejects invalid table shapes before SQLite restore starts', () => {
    expect(() => normalizeBackupDatabaseData({
      entries: { id: 1 },
    })).toThrow(/entries/i)
  })

  it.each([
    ['parent traversal', '../outside.txt'],
    ['absolute path', '/var/tmp/outside.txt'],
    ['Windows drive path', 'C:\\Users\\x\\outside.txt'],
    ['mixed-separator traversal', 'nested/..\\..\\outside.txt'],
  ])('rejects unsafe restored attachment filepaths: %s', (_label, filepath) => {
    expect(() => normalizeBackupDatabaseData({
      attachments: [{
        id: 1,
        entry_id: 1,
        filename: 'attachment.png',
        filepath,
        mimetype: 'image/png',
      }],
    })).toThrow(/attachment.*filepath/i)
  })

  it.each([
    'abc.png',
    'timestamp-random.png',
    '1_1779000000000.webp',
  ])('keeps valid legacy attachment filepath %s', (filepath) => {
    const normalized = normalizeBackupDatabaseData({
      attachments: [{
        id: 1,
        entry_id: 1,
        filename: 'attachment.png',
        filepath,
        mimetype: 'image/png',
      }],
    })

    expect(normalized.attachments[0]?.filepath).toBe(filepath)
  })

  it('rejects a candidate whose edit_before_json reconstructs a semantically impossible before snapshot', () => {
    expect(() => normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [makePlanningCandidate({
        type: 'focus',
        related_mistake_id: null,
        edit_before_json: JSON.stringify({ related_mistake_id: 12 }),
      })],
    }, 7)).toThrow(/reconstructed.*before.*inconsistent/i)
  })

  it('accepts a candidate whose edit_before_json reconstructs a legal review-to-focus before snapshot', () => {
    const result = normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [makePlanningCandidate({
        type: 'focus',
        related_mistake_id: null,
        edit_before_json: JSON.stringify({ type: 'review', related_mistake_id: 12 }),
      })],
    }, 7)

    expect(result.planning_run_candidates).toHaveLength(1)
  })

  it('accepts a candidate whose edit_before_json reconstructs a legal focus-to-review before snapshot', () => {
    const result = normalizeBackupDatabaseData({
      planning_runs: [makePlanningRun()],
      planning_run_candidates: [makePlanningCandidate({
        type: 'review',
        related_mistake_id: 12,
        edit_before_json: JSON.stringify({ type: 'focus', related_mistake_id: null }),
      })],
    }, 7)

    expect(result.planning_run_candidates).toHaveLength(1)
  })
})
