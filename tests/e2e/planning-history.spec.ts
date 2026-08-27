import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import type { TodayActionCommittedStatusRequest } from '../../src/types/api'
import { PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY } from '../../src/utils/pendingStudyTaskOperations'
import {
  createDisposableElectronProfile,
  removeDisposableElectronProfile,
} from './disposableElectronProfile'

const projectRoot = path.resolve(__dirname, '..', '..')
const profilePrefix = 'minddiary-planning-history-e2e-'
const actionContractVersion = 'confirmed-study-task-action.v2'

const todayOriginalTitle = 'E2E Generation A 原始任务'
const todayFinalTitle = 'E2E Generation A 编辑后任务'
const todayOriginalReason = '这是 Generation A 的原始说明。'
const todayFinalReason = '这是用户确认前保存的最终说明。'
const todayUnselectedTitle = 'E2E Generation A 未选择任务'
const todayGenerationBTitle = 'E2E Generation B 独立任务'

const dailyConfirmedTitle = 'E2E Daily Review 已确认任务'
const dailyUnselectedTitle = 'E2E Daily Review 未选择任务'

interface MockProvider {
  server: Server
  requestCount: () => number
}

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function nextLocalDateKey(date: Date): string {
  return localDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12))
}

function createMockProvider(contents: readonly string[]): MockProvider {
  let requests = 0
  const server = createServer((request, response) => {
    request.resume()
    const content = contents[requests]
    requests += 1
    if (content === undefined) {
      response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Unexpected E2E Provider request' } }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      choices: [{ message: { content } }],
    }))
  })
  return { server, requestCount: () => requests }
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Mock AI server did not expose a TCP address')
  return `http://127.0.0.1:${address.port}`
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections?.()
  })
}

async function launchApplication(profilePath: string): Promise<{ application: ElectronApplication; page: Page }> {
  const application = await electron.launch({
    args: [projectRoot, `--user-data-dir=${profilePath}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const page = await application.firstWindow()
  await page.waitForLoadState('load')
  const startButton = page.getByRole('button', { name: '开始使用' })
  if (await startButton.isVisible().catch(() => false)) await startButton.click()
  await expect(page.getByTestId('open-ai-today-action-suggestions')).toBeVisible()
  return { application, page }
}

async function configureMockAI(page: Page, endpoint: string): Promise<void> {
  await page.evaluate(async mockEndpoint => {
    await window.api.settings.updateAI({
      aiEndpoint: mockEndpoint,
      aiModel: 'minddiary-c2-e2e-model',
      aiApiKey: 'minddiary-c2-e2e-fake-key',
    })
  }, endpoint)
}

async function seedManualTask(page: Page, date: string, title: string): Promise<void> {
  await page.evaluate(async ({ plannedDate, taskTitle }) => {
    await window.api.tasks.create({
      title: taskTitle,
      description: 'Phase C2 disposable-profile fake study data.',
      type: 'custom',
      subject_id: null,
      related_mistake_id: null,
      related_entry_id: null,
      related_chapter_id: null,
      planned_date: plannedDate,
      estimate_minutes: 15,
      status: 'todo',
      source: 'manual',
    })
  }, { plannedDate: date, taskTitle: title })
}

async function getTasksForDate(page: Page, date: string) {
  return page.evaluate(dateKey => window.api.tasks.getByDate(dateKey), date)
}

function extractOperationId(text: string): string {
  const match = /操作 ID：([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/.exec(text)
  if (!match) throw new Error(`Confirmed outcome did not expose its operation ID: ${text}`)
  return match[1]!
}

async function assertNoWorkflowResumed(page: Page, expectedProviderRequests: number, provider: MockProvider): Promise<void> {
  await expect(page.getByRole('dialog', { name: 'AI 规划今日行动' })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: '每日复盘' })).toHaveCount(0)
  expect(provider.requestCount()).toBe(expectedProviderRequests)
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error)
}

test.describe('Phase C2 Planning History through Electron', () => {
  test.describe.configure({ timeout: 120_000 })

  test('persists independent Today generations across restart without resuming workflow and keeps tasks/receipts after delete and clear', async () => {
    const profilePath = createDisposableElectronProfile(profilePrefix)
    const generationA = JSON.stringify({
      suggestions: [
        {
          title: todayOriginalTitle,
          type: 'focus',
          estimate_minutes: 25,
          reason: todayOriginalReason,
          priority: 'high',
          subject_ref: null,
          related_mistake_ref: null,
          related_entry_ref: null,
        },
        {
          title: todayUnselectedTitle,
          type: 'diary',
          estimate_minutes: 15,
          reason: '此候选会被保留为未选择。',
          priority: 'medium',
          subject_ref: null,
          related_mistake_ref: null,
          related_entry_ref: null,
        },
      ],
    })
    const generationB = JSON.stringify({
      suggestions: [{
        title: todayGenerationBTitle,
        type: 'custom',
        estimate_minutes: 20,
        reason: '这是独立的 Generation B。',
        priority: 'low',
        subject_ref: null,
        related_mistake_ref: null,
        related_entry_ref: null,
      }],
    })
    const provider = createMockProvider([generationA, generationB])
    let application: ElectronApplication | undefined
    let primaryFailure: unknown
    const cleanupFailures: unknown[] = []

    try {
      const endpoint = await listen(provider.server)
      ;({ application } = await launchApplication(profilePath))
      let page = await application.firstWindow()
      await configureMockAI(page, endpoint)
      const today = localDateKey(new Date())
      await seedManualTask(page, today, 'E2E Today 既有本地任务')

      await page.getByTestId('open-ai-today-action-suggestions').click()
      await expect(page.getByRole('dialog', { name: 'AI 规划今日行动' })).toBeVisible()
      await page.getByTestId('ai-plan-generate').click()
      await expect(page.getByTestId('ai-suggestion-suggestion-1')).toBeVisible()
      await expect(page.getByTestId('ai-suggestion-suggestion-2')).toBeVisible()

      await page.getByLabel('建议标题').nth(0).fill(todayFinalTitle)
      await page.getByLabel('建议理由').nth(0).fill(todayFinalReason)
      await page.getByLabel('建议优先级').nth(0).selectOption('medium')
      await page.getByRole('checkbox', { name: `选择 ${todayUnselectedTitle}` }).uncheck()

      await page.evaluate(storageKey => {
        const originalSetItem = Storage.prototype.setItem
        Storage.prototype.setItem = function capturePendingMarker(key: string, value: string) {
          if (this === localStorage && key === storageKey) {
            Reflect.set(globalThis, '__minddiaryCapturedPendingMarker', value)
          }
          originalSetItem.call(this, key, value)
        }
      }, PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)

      await page.getByTestId('ai-plan-create-selected').click()
      await expect(page.getByTestId('ai-plan-creation-summary')).toHaveText(
        '本次新创建 1 项，重放确认 0 项，未新建 0 项，结果待检查 0 项。',
      )
      const confirmedOutcome = page.getByTestId('today-action-confirmed-outcome-suggestion-1')
      await expect(confirmedOutcome).toContainText('已创建任务')
      const operationId = extractOperationId(await confirmedOutcome.innerText())
      const capturedPendingMarker = await page.evaluate(() => (
        Reflect.get(globalThis, '__minddiaryCapturedPendingMarker') as unknown
      ))
      if (typeof capturedPendingMarker !== 'string') {
        throw new Error('Today Action pending marker was not captured before task creation')
      }
      const pendingEnvelope = JSON.parse(capturedPendingMarker) as {
        operations: Array<{
          operationId: string
          planningCandidateId?: number
          requestDigest?: string
        }>
      }
      const confirmedMarker = pendingEnvelope.operations.find(item => item.operationId === operationId)
      if (
        !confirmedMarker
        || typeof confirmedMarker.planningCandidateId !== 'number'
        || typeof confirmedMarker.requestDigest !== 'string'
      ) {
        throw new Error('Today Action pending marker omitted its audit identities')
      }
      expect(confirmedMarker.planningCandidateId).toBeGreaterThan(0)
      expect(confirmedMarker.requestDigest).toMatch(/^[0-9a-f]{64}$/)

      const tasksAfterConfirmation = await getTasksForDate(page, today)
      const confirmedTask = tasksAfterConfirmation.find(task => task.title === todayFinalTitle)
      expect(confirmedTask).toBeDefined()
      expect(tasksAfterConfirmation).toHaveLength(2)

      await page.getByTestId('ai-plan-generate').click()
      await expect(page.getByLabel('建议标题')).toHaveCount(1)
      await expect(page.getByTestId('ai-suggestion-suggestion-1').getByLabel('建议标题')).toHaveValue(todayGenerationBTitle)
      expect(provider.requestCount()).toBe(2)

      await application.close()
      application = undefined
      ;({ application, page } = await launchApplication(profilePath))
      await assertNoWorkflowResumed(page, 2, provider)

      await page.getByTestId('open-ai-today-action-suggestions').click()
      await expect(page.getByRole('dialog', { name: 'AI 规划今日行动' })).toBeVisible()
      await expect(page.getByLabel('建议标题')).toHaveCount(0)
      await expect(page.getByText('生成后会在这里显示可编辑的候选任务。')).toBeVisible()
      expect(provider.requestCount()).toBe(2)
      await page.getByLabel('关闭 AI 今日行动建议').click()

      await page.getByRole('button', { name: '最近 AI 规划' }).click()
      await expect(page.getByRole('dialog', { name: '最近 AI 规划' })).toBeVisible()
      const rows = page.getByTestId('planning-history-row')
      await expect(rows).toHaveCount(2)

      const generationARow = rows.filter({ hasText: '2 个保留候选' })
      const generationBRow = rows.filter({ hasText: '1 个保留候选' })
      await expect(generationARow).toHaveCount(1)
      await expect(generationBRow).toHaveCount(1)

      await generationARow.getByRole('button').first().click()
      const detail = page.getByTestId('planning-history-detail')
      await expect(detail).toContainText(todayFinalTitle)
      await expect(detail).toContainText(todayUnselectedTitle)
      await expect(detail).toContainText(`标题：${todayOriginalTitle} → ${todayFinalTitle}`)
      await expect(detail).toContainText(`说明：${todayOriginalReason} → ${todayFinalReason}`)
      await expect(detail).toContainText('优先级：高优先级 → 中优先级')
      await expect(detail).toContainText('本次未选择')
      await expect(detail).toContainText('已创建任务')
      await expect(detail).toContainText(`当前任务：${todayFinalTitle}（todo）`)
      await expect(detail).toContainText('已加入本次请求')
      await expect(detail).toContainText('未加入本次请求')
      await expect(detail).toContainText('已观察结束：已开始重新生成')
      await expect(detail).not.toContainText('操作 ID')
      await expect(detail).not.toContainText('planning-history.v1')

      await generationBRow.getByRole('button').first().click()
      await expect(detail).toContainText(todayGenerationBTitle)
      await expect(detail).toContainText('已观察结束：已正常关闭应用')

      await generationBRow.getByRole('button', { name: '删除这次规划' }).click()
      await expect(rows).toHaveCount(1)
      expect(await getTasksForDate(page, today)).toHaveLength(2)

      if (!confirmedTask) throw new Error('Confirmed task was unexpectedly unavailable')
      const statusRequest: TodayActionCommittedStatusRequest = {
        operationId,
        operationKind: 'today_action',
        actionContractVersion,
        expectedCurrentDate: today,
        plannedDate: today,
        planningCandidateId: confirmedMarker.planningCandidateId,
        requestDigest: confirmedMarker.requestDigest,
      }
      const statusAfterDelete = await page.evaluate(request => (
        window.api.tasks.getCommittedAIStudyTaskOperationStatus(request)
      ), statusRequest)
      expect(statusAfterDelete).toMatchObject({
        status: 'RECOVERED_COMMITTED',
        operationId,
        task: { id: confirmedTask.id },
      })

      await page.getByRole('button', { name: '清空全部规划历史' }).click()
      await expect(rows).toHaveCount(0)
      await expect(page.getByText('还没有持久化的 AI 规划记录。')).toBeVisible()

      const statusAfterClear = await page.evaluate(request => (
        window.api.tasks.getCommittedAIStudyTaskOperationStatus(request)
      ), statusRequest)
      expect(statusAfterClear).toMatchObject({
        status: 'RECOVERED_COMMITTED',
        operationId,
        task: { id: confirmedTask.id },
      })
      expect(await getTasksForDate(page, today)).toHaveLength(2)
      expect(provider.requestCount()).toBe(2)
    } catch (error) {
      primaryFailure = error
    } finally {
      if (application) {
        try {
          await application.close()
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
      try {
        await closeServer(provider.server)
      } catch (error) {
        cleanupFailures.push(error)
      }
      try {
        await removeDisposableElectronProfile(profilePath, profilePrefix)
      } catch (error) {
        cleanupFailures.push(error)
      }
    }

    if (primaryFailure || cleanupFailures.length > 0) {
      throw new Error([
        primaryFailure,
        ...cleanupFailures,
      ].filter(error => error !== undefined).map(failureText).join('\n'))
    }
  })

  test('persists confirmed and unselected Daily Review candidates across restart without resuming the Provider', async () => {
    const profilePath = createDisposableElectronProfile(profilePrefix)
    const dailyGeneration = JSON.stringify({
      observations: [{
        summary: 'E2E 本地复盘摘要',
        reason: '仅使用 disposable profile 中的安全摘要。',
        source_refs: ['today_tasks'],
      }],
      candidates: [
        {
          title: dailyConfirmedTitle,
          type: 'focus',
          estimate_minutes: 30,
          reason: '明天先完成这一项。',
          priority: 'high',
          subject_ref: null,
          related_mistake_ref: null,
          related_entry_ref: null,
        },
        {
          title: dailyUnselectedTitle,
          type: 'custom',
          estimate_minutes: 15,
          reason: '此候选保留但不确认。',
          priority: 'low',
          subject_ref: null,
          related_mistake_ref: null,
          related_entry_ref: null,
        },
      ],
    })
    const provider = createMockProvider([dailyGeneration])
    let application: ElectronApplication | undefined
    let primaryFailure: unknown
    const cleanupFailures: unknown[] = []

    try {
      const endpoint = await listen(provider.server)
      ;({ application } = await launchApplication(profilePath))
      let page = await application.firstWindow()
      await configureMockAI(page, endpoint)
      const now = new Date()
      const today = localDateKey(now)
      const tomorrow = nextLocalDateKey(now)
      await seedManualTask(page, today, 'E2E Daily Review 今日假数据')

      await page.getByTestId('open-daily-review-agent').click()
      await expect(page.getByRole('dialog', { name: '每日复盘' })).toBeVisible()
      await page.getByTestId('daily-review-generate').click()
      await expect(page.getByTestId('daily-review-candidate-daily-review-candidate-1')).toBeVisible()
      await expect(page.getByTestId('daily-review-candidate-daily-review-candidate-2')).toBeVisible()
      await page.getByRole('checkbox', { name: `选择候选任务：${dailyUnselectedTitle}` }).uncheck()
      await page.getByTestId('daily-review-create-selected').click()
      await expect(page.getByTestId('daily-review-creation-summary')).toContainText(
        '本次新创建 1 项，重放确认 0 项，未新建 0 项，结果待检查 0 项',
      )
      await expect(page.getByTestId('daily-review-confirmation-outcome-daily-review-candidate-1'))
        .toContainText('已创建任务')
      expect(await getTasksForDate(page, tomorrow)).toHaveLength(1)
      expect(provider.requestCount()).toBe(1)

      await application.close()
      application = undefined
      ;({ application, page } = await launchApplication(profilePath))
      await assertNoWorkflowResumed(page, 1, provider)

      await page.getByTestId('open-daily-review-agent').click()
      await expect(page.getByRole('dialog', { name: '每日复盘' })).toBeVisible()
      await expect(page.getByLabel('候选任务标题')).toHaveCount(0)
      expect(provider.requestCount()).toBe(1)
      await page.getByLabel('关闭每日复盘').click()

      await page.getByRole('button', { name: '最近 AI 规划' }).click()
      const rows = page.getByTestId('planning-history-row')
      await expect(rows).toHaveCount(1)
      await expect(rows).toContainText(`每日复盘 · ${today}`)
      await rows.getByRole('button').first().click()
      const detail = page.getByTestId('planning-history-detail')
      await expect(detail).toContainText(`规划日期：${today}`)
      await expect(detail).toContainText(`目标日期：${tomorrow}`)
      await expect(detail).toContainText(dailyConfirmedTitle)
      await expect(detail).toContainText(dailyUnselectedTitle)
      await expect(detail).toContainText('本次未选择')
      await expect(detail).toContainText('已创建任务')
      await expect(detail).toContainText(`当前任务：${dailyConfirmedTitle}（todo）`)
      await expect(detail).toContainText('本次请求上下文')
      await expect(detail).toContainText('已加入本次请求')
      await expect(detail).toContainText('已观察结束：已正常关闭应用')
      await expect(detail).not.toContainText('操作 ID')
      expect(await getTasksForDate(page, tomorrow)).toHaveLength(1)
      expect(provider.requestCount()).toBe(1)
    } catch (error) {
      primaryFailure = error
    } finally {
      if (application) {
        try {
          await application.close()
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
      try {
        await closeServer(provider.server)
      } catch (error) {
        cleanupFailures.push(error)
      }
      try {
        await removeDisposableElectronProfile(profilePath, profilePrefix)
      } catch (error) {
        cleanupFailures.push(error)
      }
    }

    if (primaryFailure || cleanupFailures.length > 0) {
      throw new Error([
        primaryFailure,
        ...cleanupFailures,
      ].filter(error => error !== undefined).map(failureText).join('\n'))
    }
  })
})
