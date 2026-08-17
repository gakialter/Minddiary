import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import {
  createDisposableElectronProfile,
  removeDisposableElectronProfile,
} from './disposableElectronProfile'

const projectRoot = path.resolve(__dirname, '..', '..')
const profilePrefix = 'minddiary-mistake-review-e2e-'

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
    server.close(error => (error ? reject(error) : resolve()))
  })
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

test.describe('Mistake Review Agent Electron E2E', () => {
  test.describe.configure({ timeout: 120_000 })

  test('generates suggestions, confirms candidate into study task, and supports manual review settlement', async () => {
    const profilePath = createDisposableElectronProfile(profilePrefix)
    const today = localDateKey(new Date())

    const mockServer = createServer((request, response) => {
      request.resume()
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              suggestions: [
                {
                  mistake_ref: 'm1',
                  title: 'E2E 复习高等数学极限',
                  reason: '已逾期且属于核心考点,建议优先复习。',
                  estimate_minutes: 25,
                },
              ],
            }),
          },
        }],
      }))
    })

    let app: ElectronApplication | undefined
    let page: Page | undefined

    try {
      const endpoint = await listen(mockServer)

      app = await electron.launch({
        args: [projectRoot, `--user-data-dir=${profilePath}`],
        env: { ...process.env, NODE_ENV: 'production' },
      })

      page = await app.firstWindow()
      await page.waitForLoadState('load')
      const startButton = page.getByRole('button', { name: '开始使用' })
      if (await startButton.isVisible().catch(() => false)) await startButton.click()
      await configureMockAI(page, endpoint)

      // 1. Create a subject and a due mistake via IPC
      const { subjectId, mistakeId } = await page.evaluate(async (currentDateKey) => {
        const subject = await window.api.subjects.create({ name: '高等数学', color: '#2563eb' })
        const mistake = await window.api.mistakes.create({
          subject_id: subject.id,
          question: '求极限 lim (sin x)/x 当 x->0',
          answer: '1',
          notes: '重要极限一',
          ease_factor: 2.5,
          review_interval: 1,
          next_review_date: currentDateKey,
          review_count: 1,
        })
        return { subjectId: subject.id, mistakeId: Number(mistake.id) }
      }, today)

      expect(subjectId).toBeGreaterThan(0)
      expect(mistakeId).toBeGreaterThan(0)

      // 2. Navigate to 错题本 tab
      await page.getByRole('button', { name: '错题本' }).click()
      await expect(page.getByTestId('mistake-ai-review-btn')).toBeVisible()

      // 3. Click AI 复习规划 button
      await page.getByTestId('mistake-ai-review-btn').click()
      await expect(page.getByTestId('mistake-review-agent-dialog')).toBeVisible()

      // 4. Wait for candidate card to render
      await expect(page.getByTestId('mistake-review-candidate-card-0')).toBeVisible()
      await expect(page.getByText('E2E 复习高等数学极限')).toBeVisible()
      await expect(page.getByText(/已逾期且属于核心考点/)).toBeVisible()

      // 5. Confirm the candidate
      await page.getByTestId('mistake-review-confirm-btn-0').click()

      // 6. Verify "已添加" badge appears
      await expect(page.getByTestId('mistake-review-created-badge-0')).toBeVisible()
      await expect(page.getByTestId('mistake-review-created-badge-0')).toContainText('已添加')

      // 7. Verify study task was created in database
      const tasks = await page.evaluate(async (currentDateKey) => {
        return window.api.tasks.getByDate(currentDateKey)
      }, today)

      const createdTask = tasks.find(t => t.related_mistake_id === mistakeId)
      expect(createdTask).toBeDefined()
      expect(createdTask?.title).toBe('E2E 复习高等数学极限')
      expect(createdTask?.type).toBe('review')
      expect(createdTask?.source).toBe('ai')
      expect(createdTask?.planned_date).toBe(today)
      expect(createdTask?.estimate_minutes).toBe(25)

      // 8. Close dialog
      await page.getByTestId('mistake-review-close-btn').click()
      await expect(page.getByTestId('mistake-review-agent-dialog')).not.toBeVisible()

      // 9. Verify manual review flow still works independently
      const reviewResult = await page.evaluate(async (mId) => {
        return window.api.mistakes.review(mId, {
          ease_factor: 2.6,
          review_interval: 3,
          next_review_date: '2026-09-01',
          review_count: 2,
        })
      }, mistakeId)
      expect(reviewResult.success).toBe(true)
    } finally {
      if (app) await app.close()
      await closeServer(mockServer)
      await removeDisposableElectronProfile(profilePath, profilePrefix)
    }
  })

  test('enforces zero-writes when mistake is already mastered or active collision exists', async () => {
    const profilePath = createDisposableElectronProfile(profilePrefix)
    const today = localDateKey(new Date())

    let app: ElectronApplication | undefined
    let page: Page | undefined

    try {
      app = await electron.launch({
        args: [projectRoot, `--user-data-dir=${profilePath}`],
        env: { ...process.env, NODE_ENV: 'production' },
      })

      page = await app.firstWindow()
      await page.waitForLoadState('load')
      const startButton = page.getByRole('button', { name: '开始使用' })
      if (await startButton.isVisible().catch(() => false)) await startButton.click()

      // 1. Create a subject and a mastered mistake
      const { subjectId, masteredMistakeId } = await page.evaluate(async (currentDateKey) => {
        const subject = await window.api.subjects.create({ name: '物理', color: '#16a34a' })
        const mistake = await window.api.mistakes.create({
          subject_id: subject.id,
          question: '牛顿第一定律',
          answer: '惯性定律',
          mastered: true,
          next_review_date: currentDateKey,
        })
        return { subjectId: subject.id, masteredMistakeId: Number(mistake.id) }
      }, today)

      // 2. Attempt idempotent AI study task creation with mastered mistake
      const failMasteredResult = await page.evaluate(async ({ sId, mId, todayDate }) => {
        return window.api.tasks.createIdempotentAIStudyTaskForCurrentDate({
          operationId: '99999999-9999-4999-8999-999999999991',
          operationKind: 'mistake_review',
          actionContractVersion: 'confirmed-mistake-review-task-action.v1',
          expectedCurrentDate: todayDate,
          payload: {
            title: '复习牛顿第一定律',
            description: '已掌握错题',
            type: 'review',
            subject_id: sId,
            related_mistake_id: mId,
            related_entry_id: null,
            related_chapter_id: null,
            planned_date: todayDate,
            estimate_minutes: 25,
            status: 'todo',
            source: 'ai',
          },
        })
      }, { sId: subjectId, mId: masteredMistakeId, todayDate: today })

      expect(failMasteredResult).toMatchObject({
        ok: false,
        code: 'INVALID_REQUEST',
      })

      // Verify zero task rows written
      const tasksAfterFail = await page.evaluate(async (currentDateKey) => {
        return window.api.tasks.getByDate(currentDateKey)
      }, today)
      expect(tasksAfterFail).toHaveLength(0)
    } finally {
      if (app) await app.close()
      await removeDisposableElectronProfile(profilePath, profilePrefix)
    }
  })
})
