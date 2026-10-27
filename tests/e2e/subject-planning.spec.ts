import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createDisposableElectronProfile, removeDisposableElectronProfile } from './disposableElectronProfile'

const projectRoot = path.resolve(process.env.MINDDIARY_E2E_APP_ROOT || path.resolve(__dirname, '../..'))
const profilePrefix = 'minddiary-subject-planning-e2e-'

test('adds, safely undoes and refreshes chapter plans without moving the workspace', async () => {
  test.setTimeout(360_000)
  for (const { width, height, theme } of [
    { width: 1280, height: 800, theme: 'light' },
    { width: 1280, height: 800, theme: 'dark' },
    { width: 960, height: 720, theme: 'light' },
    { width: 960, height: 720, theme: 'dark' },
  ]) {
    const profile = createDisposableElectronProfile(profilePrefix)
    let app: ElectronApplication | undefined
    try {
      app = await electron.launch({
        args: [projectRoot, `--user-data-dir=${profile}`, '--force-device-scale-factor=1'],
        env: { ...process.env, NODE_ENV: 'production' },
      })
      expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile)
      const page = await app.firstWindow()
      await app.evaluate(({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('Electron main window is missing')
        window.setSize(size.width, size.height)
        window.center()
      }, { width, height })
      await page.waitForLoadState('load')
      await expect(page).toHaveURL(pathToFileURL(path.join(projectRoot, 'dist/index.html')).href)
      const start = page.getByRole('button', { name: '开始使用', exact: true })
      const navigation = page.getByRole('navigation', { name: '主要导航' })
      await expect(start.or(navigation)).toBeVisible()
      if (await start.isVisible()) await start.click()
      await expect(navigation).toBeVisible()
      await navigation.getByRole('button', { name: '设置', exact: true }).click()
      await page.locator('#settings-theme').selectOption(theme)
      if (theme === 'dark') await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      else await expect(page.locator('html')).not.toHaveAttribute('data-theme')

      const seeded = await page.evaluate(async () => {
        const now = new Date()
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        const subjects = []
        for (let index = 0; index < 10; index += 1) {
          const subject = await window.api.subjects.create({ name: `规划回归科目 ${index + 1}`, color: '#0F766E' })
          const chapters = await window.api.subjectChapters.bulkCreate({
            subject_id: subject.id,
            chapters: Array.from({ length: 40 }, (_, chapterIndex) => ({ title: `第 ${chapterIndex + 1} 章`, completed: false })),
          })
          subjects.push({ subject, chapters })
        }
        return { date, subjects }
      })
      await page.reload()
      await navigation.getByRole('button', { name: '科目进度', exact: true }).click()
      const first = seeded.subjects[0]!
      const second = seeded.subjects[1]!
      const subjectPicker = page.getByLabel('切换科目', { exact: true })
      const selectSubject = async (subject: typeof first) => {
        if (width <= 960) await subjectPicker.selectOption(String(subject.subject.id))
        else await page.getByTestId(`subject-select-${subject.subject.id}`).click()
      }
      await selectSubject(first)
      const workspace = page.getByTestId(`subject-card-${first.subject.id}`)
      await expect(workspace).toBeVisible()
      await expect(workspace.getByTestId('chapter-filter-open')).toHaveAttribute('aria-pressed', 'true')
      await expect(workspace.getByTestId('chapter-management-toggle')).toHaveAttribute('aria-expanded', 'false')
      await expect(workspace.getByTestId('chapter-title-input')).toBeHidden()
      await expect(workspace.getByTitle('编辑章节')).toHaveCount(0)
      for (const heading of ['完成', '章节', '今日任务']) {
        await expect(workspace.getByText(heading, { exact: true })).toHaveCount(1)
      }
      await page.screenshot({ path: test.info().outputPath(`chapter-columns-${width}-${theme}.png`) })

      const body = workspace.locator('.chapter-workspace__body')
      const selectedChapters = first.chapters.slice(14, 17)
      await body.evaluate((element, chapterId) => {
        const row = element.querySelector(`[data-testid="chapter-row-${chapterId}"]`)
        if (!row) throw new Error('Seeded chapter row is missing')
        element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientHeight / 3
      }, selectedChapters[0]!.id)
      const initialScroll = await body.evaluate(element => element.scrollTop)
      expect(initialScroll).toBeGreaterThan(0)
      for (const chapter of selectedChapters) {
        const row = workspace.getByTestId(`chapter-row-${chapter.id}`)
        const button = row.getByTestId(`chapter-add-today-${chapter.id}`)
        const rowHandle = await row.elementHandle()
        const buttonHandle = await button.elementHandle()
        if (!rowHandle || !buttonHandle) throw new Error('Planning controls are missing')
        const before = await row.evaluate(element => {
          const body = element.closest('.chapter-workspace__body')!
          const rect = element.getBoundingClientRect()
          const viewport = body.getBoundingClientRect()
          return { y: rect.y, bottom: rect.bottom, top: viewport.top, viewportBottom: viewport.bottom, scroll: body.scrollTop }
        })
        expect(before.y).toBeGreaterThanOrEqual(before.top)
        expect(before.bottom).toBeLessThanOrEqual(before.viewportBottom)
        await expect(row.getByText('完成', { exact: true })).toHaveCount(0)
        await buttonHandle.click()
        const undo = row.getByTestId(`chapter-added-today-${chapter.id}`)
        await expect(undo).toHaveText('撤销')
        await expect(undo).toHaveAccessibleName(`撤销加入今日任务：${chapter.title}`)
        await expect(row.getByText('已加入', { exact: true })).toBeVisible()
        await expect(undo).toBeEnabled()
        await expect(row.getByTestId(`chapter-toggle-${chapter.id}`)).not.toBeChecked()
        expect(await rowHandle.evaluate((element, id) => element === document.querySelector(`[data-testid="chapter-row-${id}"]`), chapter.id)).toBe(true)
        expect(await buttonHandle.evaluate((element, id) => element === document.querySelector(`[data-testid="chapter-added-today-${id}"]`) && document.activeElement === element, chapter.id)).toBe(true)
        expect(await body.evaluate(element => element.scrollTop)).toBe(before.scroll)
        expect(await row.evaluate(element => element.getBoundingClientRect().y)).toBeCloseTo(before.y, 1)
        await buttonHandle.press('Space')
        await expect(row.getByTestId(`chapter-add-today-${chapter.id}`)).toHaveText('加入今日')
        await expect(row.getByText('已加入', { exact: true })).toBeHidden()
        expect(await buttonHandle.evaluate((element, id) => element === document.querySelector(`[data-testid="chapter-add-today-${id}"]`) && document.activeElement === element, chapter.id)).toBe(true)
        expect(await body.evaluate(element => element.scrollTop)).toBe(before.scroll)
        expect(await row.evaluate(element => element.getBoundingClientRect().y)).toBeCloseTo(before.y, 1)
        await buttonHandle.click()
        await expect(undo).toHaveText('撤销')
        expect(await buttonHandle.evaluate((element, id) => element === document.querySelector(`[data-testid="chapter-added-today-${id}"]`) && document.activeElement === element, chapter.id)).toBe(true)
        expect(await body.evaluate(element => element.scrollTop)).toBe(before.scroll)
        expect(await row.evaluate(element => element.getBoundingClientRect().y)).toBeCloseTo(before.y, 1)
        await expect(workspace.getByTestId('chapter-filter-open')).toHaveAttribute('aria-pressed', 'true')
        await buttonHandle.dispose()
        await rowHandle.dispose()
      }
      await page.screenshot({ path: test.info().outputPath(`chapter-plans-${width}-${theme}.png`) })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      expect(await body.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

      const tasks = await page.evaluate(date => window.api.tasks.getByDate(date), seeded.date)
      expect(tasks).toHaveLength(3)
      const chapterIds = selectedChapters.map(chapter => chapter.id)
      const plannedTasks = tasks.filter(task => task.subject_id === first.subject.id)
      expect(plannedTasks).toHaveLength(3)
      expect(plannedTasks.map(task => task.related_chapter_id).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([...chapterIds].sort((a, b) => a - b))
      expect(plannedTasks.every(task => task.planned_date === seeded.date && task.type === 'focus' && task.status === 'todo' && task.source === 'chapter')).toBe(true)
      await selectSubject(second)
      await expect(workspace).toBeHidden()
      await expect(page.getByTestId(`subject-card-${second.subject.id}`)).toBeVisible()
      await selectSubject(first)
      await expect(workspace).toBeVisible()
      expect(await body.evaluate(element => element.scrollTop)).toBe(initialScroll)
      if (width > 960) {
        await page.getByLabel('搜索科目', { exact: true }).fill(second.subject.name)
        await expect(page.getByTestId(`subject-select-${first.subject.id}`)).toHaveCount(0)
        await expect(workspace).toBeVisible()
        expect(await body.evaluate(element => element.scrollTop)).toBe(initialScroll)
        await expect(workspace.getByTestId('chapter-filter-open')).toHaveAttribute('aria-pressed', 'true')
      }
      const expectedTaskIds = plannedTasks.map(task => task.id).sort((a, b) => a - b)
      await page.reload()
      const persistedTasks = await page.evaluate(date => window.api.tasks.getByDate(date), seeded.date)
      expect(persistedTasks).toHaveLength(3)
      expect(persistedTasks.map(task => task.id).sort((a, b) => a - b)).toEqual(expectedTaskIds)
      expect(persistedTasks.map(task => task.related_chapter_id).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([...chapterIds].sort((a, b) => a - b))
      expect(persistedTasks.every(task => task.planned_date === seeded.date && task.type === 'focus' && task.status === 'todo')).toBe(true)
      await navigation.getByRole('button', { name: '科目进度', exact: true }).click()
      await selectSubject(first)
      const persistedWorkspace = page.getByTestId(`subject-card-${first.subject.id}`)
      await expect(persistedWorkspace).toBeVisible()
      for (const chapter of selectedChapters) {
        await expect(persistedWorkspace.getByTestId(`chapter-added-today-${chapter.id}`)).toHaveText('撤销')
        await expect(persistedWorkspace.getByTestId(`chapter-toggle-${chapter.id}`)).not.toBeChecked()
      }

      // Throw once at the actual IPC seam, leaving the renderer and database real.
      await app.evaluate(({ ipcMain }) => {
        const handlers: unknown = Reflect.get(ipcMain, '_invokeHandlers')
        if (!(handlers instanceof Map)) throw new Error('IPC handler registry is unavailable')
        const original: unknown = handlers.get('tasks:removeChapterFromToday')
        if (typeof original !== 'function') throw new Error('Chapter undo handler is unavailable')
        ipcMain.removeHandler('tasks:removeChapterFromToday')
        ipcMain.handle('tasks:removeChapterFromToday', () => {
          ipcMain.removeHandler('tasks:removeChapterFromToday')
          ipcMain.handle('tasks:removeChapterFromToday', (event, payload) => original(event, payload))
          throw new Error('Simulated chapter undo failure')
        })
      })
      const failedChapter = selectedChapters[0]!
      const failedRow = persistedWorkspace.getByTestId(`chapter-row-${failedChapter.id}`)
      await failedRow.getByTestId(`chapter-added-today-${failedChapter.id}`).click()
      await expect(failedRow.getByRole('alert')).toBeVisible()
      await expect(failedRow.getByText('已加入', { exact: true })).toBeVisible()
      await expect(failedRow.getByTestId(`chapter-added-today-${failedChapter.id}`)).toBeEnabled()
      const tasksAfterFailure = await page.evaluate(date => window.api.tasks.getByDate(date), seeded.date)
      expect(tasksAfterFailure.map(task => task.id).sort((a, b) => a - b)).toEqual(expectedTaskIds)
      await failedRow.getByTestId(`chapter-added-today-${failedChapter.id}`).click()
      await expect(failedRow.getByTestId(`chapter-add-today-${failedChapter.id}`)).toBeVisible()
      await expect(failedRow.getByRole('alert')).toHaveCount(0)
      expect(await page.evaluate(date => window.api.tasks.getByDate(date), seeded.date)).toHaveLength(2)
      await failedRow.getByTestId(`chapter-add-today-${failedChapter.id}`).click()
      await expect(failedRow.getByTestId(`chapter-added-today-${failedChapter.id}`)).toHaveText('撤销')

      // Simulate a task being started after the list was read but before undo arrives.
      await app.evaluate(({ ipcMain }) => {
        const handlers: unknown = Reflect.get(ipcMain, '_invokeHandlers')
        if (!(handlers instanceof Map)) throw new Error('IPC handler registry is unavailable')
        const original: unknown = handlers.get('tasks:removeChapterFromToday')
        const update: unknown = handlers.get('tasks:update')
        if (typeof original !== 'function' || typeof update !== 'function') throw new Error('Task handlers are unavailable')
        ipcMain.removeHandler('tasks:removeChapterFromToday')
        ipcMain.handle('tasks:removeChapterFromToday', async (event, payload: unknown) => {
          ipcMain.removeHandler('tasks:removeChapterFromToday')
          ipcMain.handle('tasks:removeChapterFromToday', (nextEvent, nextPayload) => original(nextEvent, nextPayload))
          if (typeof payload !== 'object' || payload === null || !('taskId' in payload)) throw new Error('Missing task identity')
          await update(event, payload.taskId, { status: 'doing' })
          return original(event, payload)
        })
      })
      const protectedChapter = selectedChapters[1]!
      const protectedRow = persistedWorkspace.getByTestId(`chapter-row-${protectedChapter.id}`)
      const protectedTask = plannedTasks.find(task => task.related_chapter_id === protectedChapter.id)!
      await protectedRow.getByTestId(`chapter-added-today-${protectedChapter.id}`).click()
      await expect(protectedRow.getByRole('alert')).toHaveText('任务已开始、修改或包含记录，已保留。请到今日安排中处理。')
      await expect(protectedRow.getByText('已加入', { exact: true })).toBeVisible()
      await expect(protectedRow.getByTestId(`chapter-toggle-${protectedChapter.id}`)).not.toBeChecked()
      const guardedTasks = await page.evaluate(date => window.api.tasks.getByDate(date), seeded.date)
      expect(guardedTasks).toHaveLength(3)
      expect(guardedTasks.find(task => task.id === protectedTask.id)?.status).toBe('doing')
      await page.screenshot({ path: test.info().outputPath(`chapter-undo-protected-${width}-${theme}.png`) })

      // A deletion on Today must be reflected when returning to chapter planning.
      const removedChapter = selectedChapters[2]!
      const removedTask = plannedTasks.find(task => task.related_chapter_id === removedChapter.id)!
      await navigation.getByRole('button', { name: '今日安排', exact: true }).click()
      await page.getByTestId(`task-delete-${removedTask.id}`).click()
      await expect(page.getByTestId(`task-delete-${removedTask.id}`)).toHaveCount(0)
      await navigation.getByRole('button', { name: '科目进度', exact: true }).click()
      await selectSubject(first)
      await expect(page.getByTestId(`chapter-add-today-${removedChapter.id}`)).toBeVisible()
      await expect(page.getByTestId(`chapter-added-today-${protectedChapter.id}`)).toBeVisible()
      await expect(page.getByTestId(`chapter-toggle-${removedChapter.id}`)).not.toBeChecked()
      expect(await page.evaluate(date => window.api.tasks.getByDate(date), seeded.date)).toHaveLength(2)
    } finally {
      if (app) {
        const ownedProcess = app.process()
        if (ownedProcess.exitCode === null && ownedProcess.signalCode === null) await app.close()
        await expect.poll(() => ownedProcess.exitCode !== null || ownedProcess.signalCode !== null, { timeout: 10_000 }).toBe(true)
      }
      await removeDisposableElectronProfile(profile, profilePrefix)
    }
  }
})
