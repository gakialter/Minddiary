import { describe, expect, it } from 'vitest'
import { calculateTaskFocusMetrics } from '../src/utils/taskFocusMetrics'
import type { StudyTask } from '../src/types'

const makeTask = (overrides: Partial<StudyTask> = {}): StudyTask => ({
  id: 1,
  title: 'Task',
  description: '',
  type: 'custom',
  subject_id: null,
  related_mistake_id: null,
  related_entry_id: null,
  planned_date: '2026-05-31',
  estimate_minutes: 25,
  status: 'todo',
  source: 'manual',
  created_at: '2026-05-31T00:00:00.000Z',
  updated_at: '2026-05-31T00:00:00.000Z',
  ...overrides,
})

describe('calculateTaskFocusMetrics', () => {
  it('treats todo and doing tasks without focus as unclosed', () => {
    const metrics = calculateTaskFocusMetrics([
      makeTask({ id: 1, title: 'Todo without focus', status: 'todo' }),
      makeTask({ id: 2, title: 'Doing without focus', status: 'doing' }),
    ], [])

    expect(metrics.effectiveTaskCount).toBe(2)
    expect(metrics.completedTaskCount).toBe(0)
    expect(metrics.completionRate).toBe(0)
    expect(metrics.openWithoutFocusCount).toBe(2)
    expect(metrics.focusedOpenTaskCount).toBe(0)
    expect(metrics.unclosedTaskTitles).toEqual(['Todo without focus', 'Doing without focus'])
  })

  it('keeps focused todo or doing tasks unclosed until they are done', () => {
    const metrics = calculateTaskFocusMetrics([
      makeTask({ id: 1, title: 'Focused todo', status: 'todo' }),
      makeTask({ id: 2, title: 'Focused doing', status: 'doing' }),
      makeTask({ id: 3, title: 'Done task', status: 'done' }),
    ], [
      { task_id: 1, total_minutes: 10 },
      { task_id: 2, total_minutes: 15 },
      { task_id: 3, total_minutes: 20 },
    ])

    expect(metrics.effectiveTaskCount).toBe(3)
    expect(metrics.completedTaskCount).toBe(1)
    expect(metrics.focusedTaskCount).toBe(3)
    expect(metrics.focusCoverageRate).toBe(100)
    expect(metrics.focusedMinutes).toBe(45)
    expect(metrics.openWithoutFocusCount).toBe(0)
    expect(metrics.focusedOpenTaskCount).toBe(2)
    expect(metrics.unclosedTaskTitles).toEqual(['Focused todo', 'Focused doing'])
  })

  it('excludes skipped tasks from the denominator and only closes when all effective tasks are done', () => {
    const metrics = calculateTaskFocusMetrics([
      makeTask({ id: 1, title: 'Done task', status: 'done' }),
      makeTask({ id: 2, title: 'Skipped task', status: 'skipped' }),
    ], [])

    expect(metrics.effectiveTaskCount).toBe(1)
    expect(metrics.completedTaskCount).toBe(1)
    expect(metrics.completionRate).toBe(100)
    expect(metrics.skippedTaskCount).toBe(1)
    expect(metrics.unclosedTaskTitles).toEqual([])
  })

  it('limits unclosed title details and includes a remaining count label', () => {
    const metrics = calculateTaskFocusMetrics([
      makeTask({ id: 1, title: 'One' }),
      makeTask({ id: 2, title: 'Two' }),
      makeTask({ id: 3, title: 'Three' }),
      makeTask({ id: 4, title: 'Four' }),
    ], [])

    expect(metrics.unclosedTaskTitles).toEqual(['One', 'Two', 'Three', '等 1 项'])
  })
})
