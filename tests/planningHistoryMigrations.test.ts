// @vitest-environment node

import BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import {
  CURRENT_SCHEMA_VERSION,
  DATABASE_MIGRATIONS,
  runDatabaseMigrations,
} from '../electron/databaseMigrations'

const databases: Database.Database[] = []

function createDatabase(): Database.Database {
  const database = new BetterSqlite3(':memory:')
  databases.push(database)
  database.pragma('foreign_keys = ON')
  return database
}

function getColumns(database: Database.Database, table: string): string[] {
  return (database.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>)
    .map(column => column.name)
}

function tableExists(database: Database.Database, table: string): boolean {
  return !!database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
}

function insertOpenRun(database: Database.Database): void {
  database.prepare(`
    INSERT INTO planning_runs (
      id, contract_version, entry_point, planning_date, target_date,
      generation_result_kind, context_summary_json, created_at, updated_at
    ) VALUES (?, 'planning-history.v1', 'today_action', '2026-08-13', '2026-08-13',
      'candidate_set', '[]', '2026-08-13T12:00:00.000Z', '2026-08-13T12:00:00.000Z')
  `).run('11111111-1111-4111-8111-111111111111')
}

function insertCandidate(database: Database.Database, overrides: Record<string, unknown> = {}): void {
  const candidate = {
    planning_run_id: '11111111-1111-4111-8111-111111111111',
    ordinal: 0,
    admission_origin: 'provider_validated',
    title: '复习函数极限',
    description: '回顾今天到期的错题。',
    type: 'review',
    estimate_minutes: 25,
    priority: 'high',
    subject_id: 1,
    related_mistake_id: 2,
    related_entry_id: null,
    edit_before_json: '{}',
    user_disposition: 'selected_unconfirmed',
    operation_id: null,
    outcome_kind: null,
    outcome_observed_at: null,
    admitted_at: '2026-08-13T12:00:00.000Z',
    updated_at: '2026-08-13T12:00:00.000Z',
    ...overrides,
  }
  database.prepare(`
    INSERT INTO planning_run_candidates (
      planning_run_id, ordinal, admission_origin, title, description, type,
      estimate_minutes, priority, subject_id, related_mistake_id, related_entry_id,
      edit_before_json, user_disposition, operation_id, outcome_kind,
      outcome_observed_at, admitted_at, updated_at
    ) VALUES (
      @planning_run_id, @ordinal, @admission_origin, @title, @description, @type,
      @estimate_minutes, @priority, @subject_id, @related_mistake_id, @related_entry_id,
      @edit_before_json, @user_disposition, @operation_id, @outcome_kind,
      @outcome_observed_at, @admitted_at, @updated_at
    )
  `).run(candidate)
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close()
  }
})

describe('Schema 7 planning history migration', () => {
  it('creates the frozen planning run schema on a fresh database', () => {
    const database = createDatabase()

    expect(runDatabaseMigrations(database)).toBe(7)
    expect(CURRENT_SCHEMA_VERSION).toBe(7)
    expect(DATABASE_MIGRATIONS.map(migration => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(getColumns(database, 'planning_runs')).toEqual([
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
    expect(getColumns(database, 'planning_run_candidates')).toEqual([
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
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_planning_runs_recent'").get())
      .toEqual({ name: 'idx_planning_runs_recent' })
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_planning_run_candidates_operation_id'").get())
      .toEqual({ name: 'idx_planning_run_candidates_operation_id' })
    expect(database.prepare('PRAGMA foreign_key_list(planning_run_candidates)').all()).toEqual([
      expect.objectContaining({
        table: 'planning_runs',
        from: 'planning_run_id',
        to: 'id',
        on_delete: 'CASCADE',
      }),
    ])
    expect(database.prepare('PRAGMA foreign_key_list(planning_runs)').all()).toEqual([])
    expect(database.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('migrates schema 6 to 7 without changing tasks or action receipts and reopens as a no-op', () => {
    const database = createDatabase()
    runDatabaseMigrations(database, { targetVersion: 6 })
    const taskId = Number(database.prepare(`
      INSERT INTO study_tasks (title, planned_date, source)
      VALUES ('保留任务', '2026-08-13', 'ai')
    `).run().lastInsertRowid)
    database.prepare(`
      INSERT INTO study_task_action_receipts (
        operation_id, operation_kind, action_contract_version, request_digest,
        expected_current_date, planned_date, task_id
      ) VALUES (?, 'today_action', 'ai-study-task-action.v1', 'digest', '2026-08-13', '2026-08-13', ?)
    `).run('22222222-2222-4222-8222-222222222222', taskId)

    expect(runDatabaseMigrations(database)).toBe(7)
    expect(runDatabaseMigrations(database)).toBe(7)

    expect(database.prepare('SELECT id, title FROM study_tasks').all()).toEqual([{ id: taskId, title: '保留任务' }])
    expect(database.prepare('SELECT operation_id, task_id FROM study_task_action_receipts').all()).toEqual([{
      operation_id: '22222222-2222-4222-8222-222222222222',
      task_id: taskId,
    }])
    expect(tableExists(database, 'planning_runs')).toBe(true)
    expect(tableExists(database, 'planning_run_candidates')).toBe(true)
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('rejects future schema 8 without mutating it', () => {
    const database = createDatabase()
    database.pragma('user_version = 8')
    database.exec('CREATE TABLE preserved (value TEXT)')
    database.prepare("INSERT INTO preserved (value) VALUES ('kept')").run()

    expect(() => runDatabaseMigrations(database)).toThrow(/schema version 8.*supported version 7/i)

    expect(database.pragma('user_version', { simple: true })).toBe(8)
    expect(database.prepare('SELECT value FROM preserved').get()).toEqual({ value: 'kept' })
    expect(tableExists(database, 'planning_runs')).toBe(false)
  })

  it.each([
    ['planning_runs table', 'CREATE TABLE planning_runs (id TEXT PRIMARY KEY)'],
    ['planning_run_candidates table', 'CREATE TABLE planning_run_candidates (id INTEGER PRIMARY KEY)'],
    ['recent index', 'CREATE TABLE collision_probe (value TEXT); CREATE INDEX idx_planning_runs_recent ON collision_probe(value)'],
    ['operation index', 'CREATE TABLE collision_probe (value TEXT); CREATE INDEX idx_planning_run_candidates_operation_id ON collision_probe(value)'],
  ])('rolls back schema 6 when a malformed same-name %s exists', (_label, collisionSql) => {
    const database = createDatabase()
    runDatabaseMigrations(database, { targetVersion: 6 })
    database.exec(collisionSql)

    expect(() => runDatabaseMigrations(database)).toThrow(/already exists/i)

    expect(database.pragma('user_version', { simple: true })).toBe(6)
    if (!collisionSql.includes('CREATE TABLE planning_runs ')) {
      expect(tableExists(database, 'planning_runs')).toBe(false)
    }
    if (!collisionSql.includes('CREATE TABLE planning_run_candidates ')) {
      expect(tableExists(database, 'planning_run_candidates')).toBe(false)
    }
  })

  it('enforces close pairs, candidate states, enums, ordinal, estimate, and operation uniqueness', () => {
    const database = createDatabase()
    runDatabaseMigrations(database)
    insertOpenRun(database)

    expect(() => database.prepare(`
      UPDATE planning_runs SET close_reason = 'dialog_closed' WHERE id = ?
    `).run('11111111-1111-4111-8111-111111111111')).toThrow(/CHECK constraint failed/i)
    expect(() => database.prepare(`
      UPDATE planning_runs SET closed_at = '2026-08-13T13:00:00.000Z', close_reason = 'unknown' WHERE id = ?
    `).run('11111111-1111-4111-8111-111111111111')).toThrow(/CHECK constraint failed/i)

    expect(() => insertCandidate(database, { ordinal: 6 })).toThrow(/CHECK constraint failed/i)
    expect(() => insertCandidate(database, { ordinal: 0.5 })).toThrow(/CHECK constraint failed/i)
    expect(() => insertCandidate(database, { estimate_minutes: 181 })).toThrow(/CHECK constraint failed/i)
    expect(() => insertCandidate(database, { estimate_minutes: 25.5 })).toThrow(/CHECK constraint failed/i)
    expect(() => insertCandidate(database, { priority: 'urgent' })).toThrow(/CHECK constraint failed/i)
    expect(() => insertCandidate(database, { type: 'chapter' })).toThrow(/CHECK constraint failed/i)
    expect(() => insertCandidate(database, {
      user_disposition: 'confirmed',
      operation_id: null,
    })).toThrow(/CHECK constraint failed/i)
    expect(() => insertCandidate(database, {
      user_disposition: 'unselected',
      operation_id: '22222222-2222-4222-8222-222222222222',
    })).toThrow(/CHECK constraint failed/i)
    expect(() => insertCandidate(database, {
      user_disposition: 'confirmed',
      operation_id: '22222222-2222-4222-8222-222222222222',
      outcome_kind: 'created',
      outcome_observed_at: null,
    })).toThrow(/CHECK constraint failed/i)

    insertCandidate(database, {
      user_disposition: 'confirmed',
      operation_id: '22222222-2222-4222-8222-222222222222',
    })
    expect(() => insertCandidate(database, {
      ordinal: 1,
      user_disposition: 'confirmed',
      operation_id: '22222222-2222-4222-8222-222222222222',
    })).toThrow(/UNIQUE constraint failed/i)
  })

  it('accepts valid integer boundary values for ordinal and estimate_minutes', () => {
    const database = createDatabase()
    runDatabaseMigrations(database)
    insertOpenRun(database)

    insertCandidate(database, { ordinal: 0 })
    insertCandidate(database, { ordinal: 5 })
    insertCandidate(database, { ordinal: 3, estimate_minutes: 5 })
    insertCandidate(database, { ordinal: 4, estimate_minutes: 180 })

    const count = (database.prepare(
      'SELECT COUNT(*) AS count FROM planning_run_candidates',
    ).get() as { count: number }).count
    expect(count).toBe(4)
  })
})
