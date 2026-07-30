import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '..', '..')
const profilePrefix = 'minddiary-agent-actions-e2e-'
const candidateTitle = 'E2E 今日确认任务'
const candidateReason = '由本地测试服务返回,确认后写入。'

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

async function launch(profilePath: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${profilePath}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('load')
  const startButton = page.getByRole('button', { name: '开始使用' })
  if (await startButton.isVisible().catch(() => false)) await startButton.click()
  await expect(page.getByTestId('open-ai-today-action-suggestions')).toBeVisible()
  return { app, page }
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

async function openAndGenerateCandidate(page: Page): Promise<void> {
  await page.getByTestId('open-ai-today-action-suggestions').click()
  await expect(page.getByRole('dialog', { name: 'AI 规划今日行动' })).toBeVisible()
  await page.getByTestId('ai-plan-generate').click()
  await expect(page.getByLabel('建议标题')).toHaveValue(candidateTitle)
}

async function getTasksForDate(page: Page, date: string) {
  return page.evaluate(dateKey => window.api.tasks.getByDate(dateKey), date)
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

    const mockServer = createServer((request, response) => {
      request.resume()
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              suggestions: [{
                title: candidateTitle,
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
    const endpoint = await listen(mockServer)
    let app: ElectronApplication | undefined

    try {
      const launched = await launch(profilePath)
      app = launched.app
      const page = launched.page
      await configureMockAI(page, endpoint)
      const today = localDateKey(new Date())

      await openAndGenerateCandidate(page)
      expect(await getTasksForDate(page, today)).toEqual([])
      await page.getByLabel('关闭 AI 今日行动建议').click()
      expect(await getTasksForDate(page, today)).toEqual([])

      await openAndGenerateCandidate(page)
      await page.getByTestId('ai-plan-create-selected').click()
      await expect(page.getByTestId('ai-plan-creation-summary')).toContainText('本次已创建 1 项，失败 0 项')

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
      await openAndGenerateCandidate(page)
      await page.getByTestId('ai-plan-create-selected').click()

      await expect(page.getByTestId('ai-plan-creation-summary')).toContainText('本次已创建 0 项，失败 1 项')
      await expect(page.getByText(/current local date changed before task creation/i)).toBeVisible()
      expect(await getTasksForDate(page, yesterday)).toEqual([])
    } finally {
      if (app) await app.close()
      await new Promise<void>((resolve, reject) => {
        mockServer.close(error => error ? reject(error) : resolve())
      })
      rmSync(resolvedProfile, { recursive: true, force: true })
    }
  })
})
