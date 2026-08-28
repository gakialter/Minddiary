import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { IdempotentAIStudyTaskCreateRequest } from '../../src/types/api'
import { buildIdempotentAIStudyTaskRequestDigestInput } from '../../src/utils/agentStudyTaskActions'
import { PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY } from '../../src/utils/pendingStudyTaskOperations'

const projectRoot = path.resolve(__dirname, '..', '..')
const profilePrefix = 'minddiary-idempotent-study-task-e2e-'
const profileRemovalMaxAttempts = 4
const profileRemovalRetryDelayMs = 100
const transientWindowsRemovalErrors = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM'])
const todayContextSummary = [
  { category: 'available_minutes', preparation: 'prepared', disposition: 'included', reasonCode: 'included_required' },
  { category: 'today_tasks', preparation: 'prepared_empty', disposition: 'included_empty', reasonCode: 'no_record' },
  { category: 'due_mistakes', preparation: 'prepared_empty', disposition: 'included_empty', reasonCode: 'no_record' },
  { category: 'subjects', preparation: 'prepared_empty', disposition: 'included_empty', reasonCode: 'no_record' },
  { category: 'today_entry', preparation: 'prepared_empty', disposition: 'included_empty', reasonCode: 'no_record' },
  { category: 'chapters', preparation: 'prepared_empty', disposition: 'included_empty', reasonCode: 'no_record' },
  { category: 'focus_history', preparation: 'not_integrated', disposition: 'excluded', reasonCode: 'not_integrated' },
] as const

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  const { code } = error as { code?: unknown }
  return typeof code === 'string' ? code : undefined
}

async function removeDisposableProfile(profilePath: string): Promise<void> {
  for (let attempt = 1; attempt <= profileRemovalMaxAttempts; attempt += 1) {
    try {
      rmSync(profilePath, { recursive: true, force: true })
      return
    } catch (error) {
      const retryable = process.platform === 'win32'
        && transientWindowsRemovalErrors.has(getErrorCode(error) || '')
        && attempt < profileRemovalMaxAttempts
      if (!retryable) throw error
      await new Promise(resolve => setTimeout(resolve, profileRemovalRetryDelayMs * attempt))
    }
  }
}

async function finishOnboarding(page: Page): Promise<void> {
  await page.waitForLoadState('load')
  const startButton = page.getByRole('button', { name: '开始使用' })
  if (await startButton.isVisible().catch(() => false)) await startButton.click()
  await expect(page.getByTestId('open-ai-today-action-suggestions')).toBeVisible()
}

function makeRequest(
  operationId: string,
  date: string,
  title: string,
  chapterSignature: string,
): IdempotentAIStudyTaskCreateRequest {
  return {
    operationId,
    operationKind: 'today_action',
    actionContractVersion: 'confirmed-study-task-action.v2',
    expectedCurrentDate: date,
    contextProjectionVersion: 'today-action.context-projection.v2',
    originalGenerationContextSignature: 'd'.repeat(64),
    generationChapterSignature: chapterSignature,
    latestReviewedChapterSignature: chapterSignature,
    staleContextOverride: false,
    staleReviewToken: null,
    payload: {
      title,
      description: '真实 preload、IPC 与 SQLite 幂等验证。',
      type: 'focus',
      subject_id: null,
      related_mistake_id: null,
      related_entry_id: null,
      related_chapter_id: null,
      planned_date: date,
      estimate_minutes: 25,
      status: 'todo',
      source: 'ai',
    },
  }
}

async function createPlanningCandidate(
  page: Page,
  request: IdempotentAIStudyTaskCreateRequest,
  runId: string,
): Promise<number> {
  return page.evaluate(async ({ candidate, id, contextSummary }) => {
    const planningRuns = window.api.planningRuns
    if (!planningRuns) throw new Error('Planning History API is unavailable')
    const candidateTitle = candidate.payload.title
    const candidateType = candidate.payload.type
    if (typeof candidateTitle !== 'string' || candidateType === undefined) {
      throw new Error('Planning candidate payload is incomplete')
    }
    const run = await planningRuns.create({
      id,
      entryPoint: 'today_action',
      planningDate: candidate.expectedCurrentDate,
      targetDate: candidate.payload.planned_date,
      generationResultKind: 'candidate_set',
      contextSummary,
      candidates: [{
        ordinal: 0,
        admissionOrigin: 'provider_validated',
        title: candidateTitle,
        description: candidate.payload.description ?? '',
        type: candidateType,
        estimateMinutes: candidate.payload.estimate_minutes ?? 25,
        priority: 'high',
        subjectId: candidate.payload.subject_id ?? null,
        relatedMistakeId: candidate.payload.related_mistake_id ?? null,
        relatedEntryId: candidate.payload.related_entry_id ?? null,
        userDisposition: 'selected_unconfirmed',
      }],
    })
    const planningCandidateId = run.candidates[0]?.id
    if (!planningCandidateId) throw new Error('Planning candidate was not persisted')
    return planningCandidateId
  }, { candidate: request, id: runId, contextSummary: todayContextSummary })
}

async function invokeCreate(
  page: Page,
  request: IdempotentAIStudyTaskCreateRequest,
  planningCandidateId: number,
) {
  return page.evaluate(({ candidate, candidateId }) => (
    window.api.tasks.createIdempotentAIStudyTaskForCurrentDate({
      planningCandidateId: candidateId,
      request: candidate as never,
    })
  ), { candidate: request, candidateId: planningCandidateId })
}

async function getTasksForDate(page: Page, date: string) {
  return page.evaluate(dateKey => window.api.tasks.getByDate(dateKey), date)
}

async function setMainProcessClock(application: ElectronApplication, isoTimestamp: string): Promise<void> {
  await application.evaluate((_electron, timestamp) => {
    type ClockGlobal = typeof globalThis & { __minddiaryOriginalDate?: DateConstructor }
    const clockGlobal = globalThis as ClockGlobal
    const OriginalDate = clockGlobal.__minddiaryOriginalDate ?? Date
    const fixedTime = new OriginalDate(timestamp).getTime()
    class FixedDate extends OriginalDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(fixedTime)
        } else if (args.length === 1) {
          super(args[0] as string)
        } else {
          super(
            args[0] as number,
            args[1] as number,
            args[2] as number | undefined,
            args[3] as number | undefined,
            args[4] as number | undefined,
            args[5] as number | undefined,
            args[6] as number | undefined,
          )
        }
      }

      static now(): number {
        return fixedTime
      }
    }
    clockGlobal.__minddiaryOriginalDate = OriginalDate
    Object.defineProperty(clockGlobal, 'Date', {
      configurable: true,
      writable: true,
      value: FixedDate,
    })
  }, isoTimestamp)
}

async function restoreMainProcessClock(application: ElectronApplication): Promise<void> {
  await application.evaluate(() => {
    type ClockGlobal = typeof globalThis & { __minddiaryOriginalDate?: DateConstructor }
    const clockGlobal = globalThis as ClockGlobal
    if (!clockGlobal.__minddiaryOriginalDate) return
    Object.defineProperty(clockGlobal, 'Date', {
      configurable: true,
      writable: true,
      value: clockGlobal.__minddiaryOriginalDate,
    })
    delete clockGlobal.__minddiaryOriginalDate
  })
}

test.describe('idempotent confirmed study task creation through Electron', () => {
  test.describe.configure({ timeout: 120_000 })

  test('enforces one task per operation and requires a click for restart recovery', async () => {
    const profilePath = mkdtempSync(path.join(tmpdir(), profilePrefix))
    const resolvedProfile = realpathSync(profilePath)
    const resolvedTemp = realpathSync(tmpdir())
    if (path.dirname(resolvedProfile) !== resolvedTemp || !path.basename(resolvedProfile).startsWith(profilePrefix)) {
      throw new Error('Refusing to use a non-disposable Electron profile')
    }

    let application: ElectronApplication | undefined
    let mainClockChanged = false
    let primaryFailure: unknown
    const cleanupFailures: unknown[] = []

    try {
      application = await electron.launch({
        args: [projectRoot, `--user-data-dir=${profilePath}`],
        env: { ...process.env, NODE_ENV: 'production' },
      })
      let page = await application.firstWindow()
      await finishOnboarding(page)
      const today = localDateKey(new Date())
      const operationId = 'a1111111-1111-4111-8111-111111111111'
      const chapterSignature = await page.evaluate(async () => (
        await window.api.tasks.getTodayActionAuthoritativeChapterContext()
      ).currentChapterSignature)
      const request = makeRequest(operationId, today, 'E2E 幂等任务', chapterSignature)
      const planningCandidateId = await createPlanningCandidate(
        page,
        request,
        'e1111111-1111-4111-8111-111111111111',
      )

      const first = await invokeCreate(page, request, planningCandidateId)
      expect(first).toMatchObject({ ok: true, operationId, replayed: false })
      if (!first.ok) throw new Error(`First create failed: ${first.code}`)

      const replay = await invokeCreate(page, request, planningCandidateId)
      expect(replay).toMatchObject({
        ok: true,
        operationId,
        replayed: true,
        task: { id: first.task.id },
      })
      expect(await getTasksForDate(page, today)).toHaveLength(1)

      const conflict = await invokeCreate(page, {
        ...request,
        payload: { ...request.payload, description: '同一 ID 的不同规范请求。' },
      }, planningCandidateId)
      expect(conflict).toMatchObject({ ok: false, operationId, code: 'INTEGRITY_ERROR' })
      expect(await getTasksForDate(page, today)).toHaveLength(1)

      const forgedChapterRelationRequest = makeRequest(
        'd4444444-4444-4444-8444-444444444444',
        today,
        'E2E forged chapter relation',
        chapterSignature,
      )
      const forgedCandidateId = await createPlanningCandidate(
        page,
        forgedChapterRelationRequest,
        'e4444444-4444-4444-8444-444444444444',
      )
      await expect(invokeCreate(page, {
          ...forgedChapterRelationRequest,
          payload: {
            ...forgedChapterRelationRequest.payload,
            related_chapter_id: 1,
          },
        }, forgedCandidateId))
        .rejects.toThrow()
      expect(await getTasksForDate(page, today)).toHaveLength(1)

      const staleRequest = makeRequest(
        'b2222222-2222-4222-8222-222222222222',
        today,
        'E2E 旧日期新操作',
        chapterSignature,
      )
      const staleCandidateId = await createPlanningCandidate(
        page,
        staleRequest,
        'e2222222-2222-4222-8222-222222222222',
      )

      const tomorrowAtNoon = new Date()
      tomorrowAtNoon.setDate(tomorrowAtNoon.getDate() + 1)
      tomorrowAtNoon.setHours(12, 0, 0, 0)
      await setMainProcessClock(application, tomorrowAtNoon.toISOString())
      mainClockChanged = true

      const staleNewOperation = await invokeCreate(
        page,
        staleRequest,
        staleCandidateId,
      )
      expect(staleNewOperation).toMatchObject({ ok: false, code: 'DATE_MISMATCH' })
      const crossDateReplay = await invokeCreate(page, request, planningCandidateId)
      expect(crossDateReplay).toMatchObject({
        ok: true,
        replayed: true,
        task: { id: first.task.id },
      })
      expect(await getTasksForDate(page, today)).toHaveLength(1)

      await restoreMainProcessClock(application)
      mainClockChanged = false
      await page.evaluate(taskId => window.api.tasks.delete(taskId), first.task.id)
      const deletedReplay = await invokeCreate(page, request, planningCandidateId)
      expect(deletedReplay).toMatchObject({ ok: false, operationId, code: 'RESULT_DELETED' })
      expect(await getTasksForDate(page, today)).toEqual([])

      const recoveryOperationId = 'c3333333-3333-4333-8333-333333333333'
      const recoveryRequest = makeRequest(recoveryOperationId, today, 'E2E 重启恢复任务', chapterSignature)
      const recoveryCandidateId = await createPlanningCandidate(
        page,
        recoveryRequest,
        'e3333333-3333-4333-8333-333333333333',
      )
      const recoverySeed = await invokeCreate(page, recoveryRequest, recoveryCandidateId)
      expect(recoverySeed).toMatchObject({ ok: true, replayed: false })
      if (!recoverySeed.ok) throw new Error(`Recovery seed failed: ${recoverySeed.code}`)
      const recoveryDigest = createHash('sha256')
        .update(buildIdempotentAIStudyTaskRequestDigestInput(recoveryRequest), 'utf8')
        .digest('hex')
      await page.evaluate(({ key, pendingRequest, planningCandidateId, requestDigest }) => {
        localStorage.setItem(key, JSON.stringify({
          version: 1,
          operations: [{
            operationId: pendingRequest.operationId,
            operationKind: 'today_action',
            actionContractVersion: 'confirmed-study-task-action.v2',
            expectedCurrentDate: pendingRequest.expectedCurrentDate,
            plannedDate: pendingRequest.payload.planned_date,
            planningCandidateId,
            requestDigest,
            createdAt: new Date().toISOString(),
          }],
        }))
      }, {
        key: PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY,
        pendingRequest: recoveryRequest,
        planningCandidateId: recoveryCandidateId,
        requestDigest: recoveryDigest,
      })

      await application.close()
      application = undefined
      application = await electron.launch({
        args: [projectRoot, `--user-data-dir=${profilePath}`],
        env: { ...process.env, NODE_ENV: 'production' },
      })
      page = await application.firstWindow()
      await finishOnboarding(page)
      await page.getByTestId('open-ai-today-action-suggestions').click()
      await expect(page.getByTestId('pending-study-task-recovery-today_action')).toBeVisible()

      const tasksBeforeRecoveryClick = await getTasksForDate(page, today)
      expect(tasksBeforeRecoveryClick).toHaveLength(1)
      expect(tasksBeforeRecoveryClick[0]?.id).toBe(recoverySeed.task.id)
      expect(await page.evaluate(key => localStorage.getItem(key), PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY))
        .not.toBeNull()

      await page.getByTestId(`recover-pending-study-task-${recoveryOperationId}`).click()
      await expect(page.getByTestId('pending-study-task-outcome')).toContainText(
        '原操作此前已完成，本次未重复创建',
      )
      expect(await page.evaluate(key => localStorage.getItem(key), PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY))
        .toBeNull()
      const tasksAfterRecovery = await getTasksForDate(page, today)
      expect(tasksAfterRecovery).toHaveLength(1)
      expect(tasksAfterRecovery[0]?.id).toBe(recoverySeed.task.id)
    } catch (error) {
      primaryFailure = error
    } finally {
      if (application && mainClockChanged) {
        try {
          await restoreMainProcessClock(application)
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
      if (application) {
        try {
          await application.close()
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
      try {
        await removeDisposableProfile(resolvedProfile)
      } catch (error) {
        cleanupFailures.push(error)
      }
    }

    if (primaryFailure || cleanupFailures.length > 0) {
      const failures = [primaryFailure, ...cleanupFailures]
        .filter(error => error !== undefined)
        .map(error => error instanceof Error ? error.stack || error.message : String(error))
      throw new Error(`Idempotent study task E2E failed or cleanup was incomplete:\n${failures.join('\n')}`)
    }
  })
})
