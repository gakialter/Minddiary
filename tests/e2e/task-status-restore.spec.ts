import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ChildProcess } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import type { StudyTask } from '../../src/types'
import { createDisposableElectronProfile, removeDisposableElectronProfile } from './disposableElectronProfile'

const projectRoot = path.resolve(process.env.MINDDIARY_E2E_APP_ROOT || path.resolve(__dirname, '../..'))
const profilePrefix = 'minddiary-task-status-restore-e2e-'

interface OwnedElectron { app: ElectronApplication; process: ChildProcess }

async function launch(profile: string, ownedApps: OwnedElectron[]) {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${profile}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const owned = { app, process: app.process() }
  ownedApps.push(owned)
  const page = await app.firstWindow()
  await page.waitForLoadState('load')
  await expect(page).toHaveURL(pathToFileURL(path.join(projectRoot, 'dist/index.html')).href)
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile)
  const start = page.getByRole('button', { name: '开始使用', exact: true })
  const navigation = page.getByRole('navigation', { name: '主要导航' })
  await expect(start.or(navigation)).toBeVisible()
  if (await start.isVisible()) await start.click()
  await expect(navigation).toBeVisible()
  return { app, page, process: owned.process }
}

async function navigate(page: Page, name: string) {
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name, exact: true }).click()
}

async function readTasks(page: Page, date: string) {
  return page.evaluate(date => window.api.tasks.getByDate(date), date)
}

function preservedFields(task: StudyTask) {
  const { status: _status, updated_at: _updatedAt, ...preserved } = task
  return preserved
}

// Read the disposable profile through Electron's ABI without switching the active addon.
async function readSqlite(app: ElectronApplication) {
  const runtime = await app.evaluate(({ app }) => ({ executable: process.execPath, profile: app.getPath('userData') }))
  const result = spawnSync(runtime.executable, ['-e', `
    const db = new (require('better-sqlite3'))(process.argv[1], { readonly: true, fileMustExist: true });
    console.log(JSON.stringify({ tasks: db.prepare('SELECT * FROM study_tasks ORDER BY id').all(),
      sessions: db.prepare('SELECT * FROM pomodoro_sessions ORDER BY id').all(),
      integrity: db.pragma('integrity_check', { simple: true }) }));
    db.close();
  `, path.join(runtime.profile, 'minddiary.db')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`Disposable SQLite inspection failed: ${result.stderr}`)
  return JSON.parse(result.stdout)
}

test.describe('UX-03 task status restoration through Electron', () => {
  test.describe.configure({ timeout: 120_000 })

  test('restores completed and skipped original tasks, keeps focus history and active focus, and survives reload and restart', async ({}, testInfo) => {
    const profile = createDisposableElectronProfile(profilePrefix)
    const ownedApps: OwnedElectron[] = []
    let bodyFailed = false
    try {
      let launched = await launch(profile, ownedApps)
      let { app, page } = launched
      const seeded = await page.evaluate(async () => {
        const now = new Date()
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        const subject = await window.api.subjects.create({ name: 'UX03 数学', color: '#2563eb' })
        const chapter = await window.api.subjectChapters.create({ subject_id: subject.id, title: 'UX03 函数', completed: false })
        const skippedChapter = await window.api.subjectChapters.create({ subject_id: subject.id, title: 'UX03 数列', completed: false })
        const chapterTask = await window.api.tasks.create({
          title: 'UX03 已完成章节任务', description: '保留章节、来源和原有专注记录', type: 'focus',
          subject_id: subject.id, related_chapter_id: chapter.id, planned_date: date,
          estimate_minutes: 35, source: 'dashboard',
        })
        const skippedTask = await window.api.tasks.create({
          title: 'UX03 已跳过普通任务', description: '保留普通任务说明', type: 'review',
          planned_date: date, estimate_minutes: 15, source: 'manual',
        })
        const activeTask = await window.api.tasks.create({
          title: 'UX03 正在专注其他任务', type: 'focus', planned_date: date, estimate_minutes: 25, source: 'manual',
        })
        const skippedChapterTask = await window.api.tasks.create({
          title: 'UX03 已跳过章节任务', description: '跳过后恢复仍保留章节来源', type: 'focus',
          subject_id: subject.id, related_chapter_id: skippedChapter.id, planned_date: date,
          estimate_minutes: 20, source: 'dashboard',
        })
        await window.api.pomodoro.addSession({
          task_id: chapterTask.id, subject_id: subject.id, duration: 12, date_key: date,
          started_at: new Date(now.getTime() - 13 * 60_000).toISOString(),
          completed_at: new Date(now.getTime() - 60_000).toISOString(),
        })
        return { date, subject, chapter, skippedChapter, chapterTask, skippedTask, skippedChapterTask, activeTask }
      })
      await page.reload()
      await expect(page.getByTestId(`task-status-${seeded.chapterTask.id}`)).toHaveText('待开始')
      await page.getByTestId(`task-complete-${seeded.chapterTask.id}`).click()
      await expect(page.getByTestId(`task-status-${seeded.chapterTask.id}`)).toHaveText('已完成')
      await page.getByTestId(`task-skip-${seeded.skippedTask.id}`).click()
      await expect(page.getByTestId(`task-status-${seeded.skippedTask.id}`)).toHaveText('已跳过')
      await page.getByTestId(`task-skip-${seeded.skippedChapterTask.id}`).click()
      await expect(page.getByTestId(`task-status-${seeded.skippedChapterTask.id}`)).toHaveText('已跳过')
      await expect(page.getByTestId('overview-tasks')).toContainText('1 / 4')
      const closedTasks = await readTasks(page, seeded.date)
      const before = await readSqlite(app)

      await navigate(page, '专注计时')
      const picker = page.getByTestId('pomodoro-task-select')
      await expect(picker.locator(`option[value="${seeded.chapterTask.id}"]`)).toHaveCount(0)
      await expect(picker.locator(`option[value="${seeded.skippedTask.id}"]`)).toHaveCount(0)
      await expect(picker.locator(`option[value="${seeded.skippedChapterTask.id}"]`)).toHaveCount(0)
      await picker.selectOption(String(seeded.activeTask.id))
      await page.getByTestId('pomodoro-start-btn').click()
      await expect(page.getByTestId('pomodoro-start-btn')).toHaveAccessibleName('暂停')
      await navigate(page, '今日安排')

      for (const task of [seeded.chapterTask, seeded.skippedTask, seeded.skippedChapterTask]) {
        await expect(page.getByTestId(`task-restore-${task.id}`)).toHaveText('恢复待开始')
        await page.getByTestId(`task-restore-${task.id}`).click()
        await expect(page.getByTestId(`task-status-${task.id}`)).toHaveText('待开始')
        await expect(page.getByTestId(`task-restore-${task.id}`)).toHaveCount(0)
      }
      await expect(page.getByTestId('overview-tasks')).toContainText('0 / 4')
      await expect(page.getByTestId(`task-source-${seeded.chapterTask.id}`)).toHaveText('UX03 数学 · UX03 函数')
      await expect(page.getByTestId(`task-source-${seeded.skippedChapterTask.id}`)).toHaveText('UX03 数学 · UX03 数列')
      await expect(page.getByTestId('daily-action-queue')).toContainText('待开始 3 · 进行中 1 · 已完成 0 · 已跳过 0')
      const restored = await readTasks(page, seeded.date)
      expect(restored).toHaveLength(4)
      for (const task of closedTasks.filter(task => task.id !== seeded.activeTask.id)) {
        const result = restored.find(result => result.id === task.id)!
        expect(result.status).toBe('todo')
        expect(preservedFields(result)).toEqual(preservedFields(task))
      }
      await navigate(page, '专注计时')
      await expect(page.getByTestId('pomodoro-task-select')).toHaveValue(String(seeded.activeTask.id))
      await expect(page.getByTestId('pomodoro-selected-task-summary')).toContainText(seeded.activeTask.title)
      await expect(page.getByTestId('pomodoro-start-btn')).toHaveAccessibleName('暂停')
      await page.getByTestId('pomodoro-start-btn').click()
      for (const task of [seeded.chapterTask, seeded.skippedTask, seeded.skippedChapterTask]) {
        await expect(page.getByTestId('pomodoro-task-select').locator(`option[value="${task.id}"]`)).toHaveCount(1)
      }
      const after = await readSqlite(app)
      expect(after.sessions).toEqual(before.sessions)
      expect(after.integrity).toBe('ok')
      expect(after.tasks).toHaveLength(4)

      await navigate(page, '科目进度')
      await page.getByTestId(`manage-chapters-${seeded.subject.id}`).click()
      for (const chapter of [seeded.chapter, seeded.skippedChapter]) {
        await expect(page.getByTestId(`chapter-added-today-${chapter.id}`)).toBeDisabled()
        expect(restored.filter(task => task.related_chapter_id === chapter.id)).toHaveLength(1)
      }
      const chapters = await page.evaluate(id => window.api.subjectChapters.getBySubject(id), seeded.subject.id)
      expect(chapters.map(chapter => chapter.completed)).toEqual([false, false])

      await navigate(page, '今日安排')
      await page.reload()
      await expect(page.getByTestId(`task-status-${seeded.chapterTask.id}`)).toHaveText('待开始')
      await expect(page.getByTestId(`task-status-${seeded.skippedTask.id}`)).toHaveText('待开始')
      await expect(page.getByTestId(`task-status-${seeded.skippedChapterTask.id}`)).toHaveText('待开始')
      await app.close()
      await expect.poll(() => launched.process.exitCode !== null || launched.process.signalCode !== null).toBe(true)
      launched = await launch(profile, ownedApps)
      app = launched.app
      page = launched.page
      await navigate(page, '今日安排')
      await expect(page.getByTestId(`task-status-${seeded.chapterTask.id}`)).toHaveText('待开始')
      await expect(page.getByTestId(`task-status-${seeded.skippedTask.id}`)).toHaveText('待开始')
      await expect(page.getByTestId(`task-status-${seeded.skippedChapterTask.id}`)).toHaveText('待开始')
      expect(await readTasks(page, seeded.date)).toEqual(restored)
      const restarted = await readSqlite(app)
      expect(restarted).toEqual(after)
      const receipt = testInfo.outputPath('UX03-real-sqlite-before-after.json')
      writeFileSync(receipt, JSON.stringify({ before, after, restarted }, null, 2))
      await testInfo.attach('UX03-real-sqlite-before-after', { path: receipt, contentType: 'application/json' })
      const screenshot = testInfo.outputPath('UX03-restored-dashboard.png')
      await page.screenshot({ path: screenshot })
      await testInfo.attach('UX03-restored-dashboard', { path: screenshot, contentType: 'image/png' })
    } catch (error) {
      bodyFailed = true
      throw error
    } finally {
      const cleanupErrors: unknown[] = []
      for (const owned of ownedApps) {
        try {
          if (owned.process.exitCode === null && owned.process.signalCode === null) await owned.app.close()
          await expect.poll(() => owned.process.exitCode !== null || owned.process.signalCode !== null, { timeout: 10_000 }).toBe(true)
        } catch (error) { cleanupErrors.push(error) }
      }
      try {
        if (ownedApps.some(owned => owned.process.exitCode === null && owned.process.signalCode === null)) {
          throw new Error('Refusing profile removal while an owned Electron process is running')
        }
        await removeDisposableElectronProfile(profile, profilePrefix)
      } catch (error) { cleanupErrors.push(error) }
      if (cleanupErrors.length) {
        console.error('UX-03 E2E cleanup failed', cleanupErrors)
        if (!bodyFailed) throw cleanupErrors[0]
      }
    }
  })
})
