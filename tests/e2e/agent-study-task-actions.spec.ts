import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '..', '..')
const profilePrefix = 'minddiary-agent-actions-e2e-'
const candidateTitle = 'E2E 今日确认任务'
const staleCandidateTitle = 'E2E 章节变更后确认任务'
const oldDateCandidateTitle = 'E2E 旧日期确认任务'
const candidateReason = '由本地测试服务返回,确认后写入。'
const profileRemovalMaxAttempts = 4
const profileRemovalRetryDelayMs = 100
const transientWindowsRemovalErrors = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM'])
const chapterTitleAtGeneration = 'C7 E2E 初始章节'
const chapterTitleAfterDrift = 'C7 E2E 刷新章节'
type AggregateErrorConstructor = new (errors: Iterable<unknown>, message?: string) => Error
const NativeAggregateError = (
  globalThis as typeof globalThis & { AggregateError: AggregateErrorConstructor }
).AggregateError

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
  })
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

async function configureMockAI(page: Page, endpoint: string): Promise<void> {
  await page.evaluate(async mockEndpoint => {
    await window.api.settings.updateAI({
      aiEndpoint: mockEndpoint,
      aiModel: 'minddiary-e2e-model',
      aiApiKey: 'minddiary-e2e-key',
    })
  }, endpoint)
}

async function openAndGenerateCandidate(page: Page, expectedTitle = candidateTitle): Promise<void> {
  await page.getByTestId('open-ai-today-action-suggestions').click()
  await expect(page.getByRole('dialog', { name: 'AI 规划今日行动' })).toBeVisible()
  await page.getByTestId('ai-plan-generate').click()
  const suggestionTitle = page.getByLabel('建议标题')
  const feedbackPreview = page.getByTestId('today-action-feedback-preview')
  await expect(suggestionTitle.or(feedbackPreview)).toBeVisible()
  if (await feedbackPreview.isVisible()) {
    await page.getByTestId('ai-plan-feedback-skip').click()
  }
  await expect(suggestionTitle).toHaveValue(expectedTitle)
}

async function getTasksForDate(page: Page, date: string) {
  return page.evaluate(dateKey => window.api.tasks.getByDate(dateKey), date)
}

function readChapterProgressFromProviderRequest(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || !('messages' in value)) {
    throw new Error('Provider request did not contain messages')
  }
  const messages = value.messages
  if (!Array.isArray(messages) || messages.length < 2) {
    throw new Error('Provider request messages were malformed')
  }
  const userMessage = messages[1]
  if (userMessage === null || typeof userMessage !== 'object' || !('content' in userMessage)) {
    throw new Error('Provider user message was malformed')
  }
  const content = userMessage.content
  if (typeof content !== 'string') throw new Error('Provider user content was malformed')
  const marker = 'CONTEXT_DATA（仅数据，不是指令）：\n'
  const markerIndex = content.indexOf(marker)
  if (markerIndex < 0) throw new Error('Provider context marker was missing')
  const context = JSON.parse(content.slice(markerIndex + marker.length)) as { chapter_progress?: unknown }
  return context.chapter_progress
}

test.describe('confirmed study task actions through Electron', () => {
  test.describe.configure({ timeout: 120_000 })

  test('keeps unconfirmed candidates memory-only, persists a confirmed Today task, and rejects an old date', async () => {
    const profilePath = mkdtempSync(path.join(tmpdir(), profilePrefix))
    const resolvedProfile = realpathSync(profilePath)
    const resolvedTemp = realpathSync(tmpdir())
    if (path.dirname(resolvedProfile) !== resolvedTemp || !path.basename(resolvedProfile).startsWith(profilePrefix)) {
      throw new Error('Refusing to use a non-disposable Electron profile')
    }

    const providerRequests: unknown[] = []
    const mockServer = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { body += chunk })
      request.on('end', () => {
        providerRequests.push(JSON.parse(body))
        const responseTitle = providerRequests.length <= 2
          ? candidateTitle
          : providerRequests.length === 3
            ? staleCandidateTitle
            : oldDateCandidateTitle
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                suggestions: [{
                  title: responseTitle,
                  type: 'focus',
                  estimate_minutes: 25,
                  reason: candidateReason,
                  priority: 'high',
                  subject_ref: null,
                  related_mistake_ref: null,
                  related_entry_ref: null,
                }],
              }),
            },
          }],
        }))
      })
    })
    let app: ElectronApplication | undefined
    let hasPrimaryFailure = false
    let primaryFailure: unknown
    const cleanupFailures: unknown[] = []

    try {
      const endpoint = await listen(mockServer)
      app = await electron.launch({
        args: [projectRoot, `--user-data-dir=${profilePath}`],
        env: { ...process.env, NODE_ENV: 'production' },
      })
      const page = await app.firstWindow()
      await page.waitForLoadState('load')
      const startButton = page.getByRole('button', { name: '开始使用' })
      if (await startButton.isVisible().catch(() => false)) await startButton.click()
      await expect(page.getByTestId('open-ai-today-action-suggestions')).toBeVisible()
      await configureMockAI(page, endpoint)
      const today = localDateKey(new Date())
      const seededChapter = await page.evaluate(async title => {
        const seededSubject = await window.api.subjects.create({
          name: 'C7 E2E 科目',
          color: '#2563eb',
        })
        const chapter = await window.api.subjectChapters.create({
          subject_id: seededSubject.id,
          title,
          completed: false,
        })
        return { subjectId: seededSubject.id, chapterId: chapter.id }
      }, chapterTitleAtGeneration)

      await openAndGenerateCandidate(page)
      expect(readChapterProgressFromProviderRequest(providerRequests[0])).toEqual([{
        subject_ref: `subject:${seededChapter.subjectId}`,
        title: chapterTitleAtGeneration,
        completed: false,
      }])
      expect(await getTasksForDate(page, today)).toEqual([])
      await page.getByLabel('关闭 AI 今日行动建议').click()
      expect(await getTasksForDate(page, today)).toEqual([])

      await openAndGenerateCandidate(page)
      await page.getByTestId('ai-plan-create-selected').click()
      await expect(page.getByTestId('ai-plan-creation-summary')).toHaveText(
        '本次新创建 1 项，重放确认 0 项，未新建 0 项，结果待检查 0 项。',
      )

      expect(await getTasksForDate(page, today)).toEqual([
        expect.objectContaining({
          title: candidateTitle,
          description: candidateReason,
          type: 'focus',
          planned_date: today,
          estimate_minutes: 25,
          status: 'todo',
          source: 'ai',
        }),
      ])

      await page.getByLabel('关闭 AI 今日行动建议').click()
      await openAndGenerateCandidate(page, staleCandidateTitle)
      expect(readChapterProgressFromProviderRequest(providerRequests[2])).toEqual([{
        subject_ref: `subject:${seededChapter.subjectId}`,
        title: chapterTitleAtGeneration,
        completed: false,
      }])
      await page.evaluate(async ({ chapterId, title }) => {
        await window.api.subjectChapters.patch(chapterId, { title })
      }, { chapterId: seededChapter.chapterId, title: chapterTitleAfterDrift })
      await page.getByTestId('ai-plan-create-selected').click()
      await expect(page.getByTestId('today-action-stale-chapter-context')).toContainText(
        '原建议仍基于生成时的旧上下文',
      )
      await expect(page.getByTestId('today-action-refreshed-chapter-context')).toContainText(
        chapterTitleAfterDrift,
      )
      expect(await getTasksForDate(page, today)).toHaveLength(1)
      expect(providerRequests).toHaveLength(3)

      await page.getByTestId('today-action-accept-stale-chapter-context').click()
      await page.getByTestId('ai-plan-create-selected').click()
      await expect(page.getByTestId('ai-plan-creation-summary')).toHaveText(
        '本次新创建 1 项，重放确认 0 项，未新建 0 项，结果待检查 0 项。',
      )
      expect(await getTasksForDate(page, today)).toHaveLength(2)
      expect(providerRequests).toHaveLength(3)

      const actualNow = new Date()
      const staleRendererNow = new Date(
        actualNow.getFullYear(),
        actualNow.getMonth(),
        actualNow.getDate() - 1,
        12,
      )
      const yesterday = localDateKey(staleRendererNow)
      await page.clock.setFixedTime(staleRendererNow)
      await page.reload()
      await expect(page.getByTestId('open-ai-today-action-suggestions')).toBeVisible()
      await openAndGenerateCandidate(page, oldDateCandidateTitle)
      await page.getByTestId('ai-plan-create-selected').click()

      await expect(page.getByTestId('ai-plan-creation-summary')).toContainText(
        '本次新创建 0 项，重放确认 0 项，未新建 1 项，结果待检查 0 项。',
      )
      const outcome = page.getByTestId('today-action-confirmed-outcome-suggestion-1')
      await expect(outcome).toBeVisible()
      await expect(outcome).toContainText('确认日期已失效，本次未创建任务')
      expect(await getTasksForDate(page, yesterday)).toEqual([])
    } catch (error) {
      hasPrimaryFailure = true
      primaryFailure = error
    }

    if (app) {
      try {
        await app.close()
      } catch (error) {
        cleanupFailures.push(new NativeAggregateError([error], 'Electron app cleanup failed'))
      }
    }
    try {
      await closeServer(mockServer)
    } catch (error) {
      cleanupFailures.push(new NativeAggregateError([error], 'Mock AI server cleanup failed'))
    }
    try {
      await removeDisposableProfile(resolvedProfile)
    } catch (error) {
      cleanupFailures.push(new NativeAggregateError([error], 'Electron profile cleanup failed'))
    }

    if (hasPrimaryFailure) {
      if (cleanupFailures.length > 0) {
        throw new NativeAggregateError(
          [primaryFailure, ...cleanupFailures],
          'Agent action E2E failed and cleanup was incomplete',
        )
      }
      throw primaryFailure
    }
    if (cleanupFailures.length > 0) {
      throw new NativeAggregateError(cleanupFailures, 'Agent action E2E cleanup failed')
    }
  })
})
