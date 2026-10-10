import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { spawnSync, type ChildProcess } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DATABASE_BACKUP_TABLES } from '../../electron/databaseBackupData'
import { createDisposableElectronProfile, removeDisposableElectronProfile } from './disposableElectronProfile'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1'
const projectRoot = path.resolve(process.env.MINDDIARY_E2E_APP_ROOT || path.resolve(__dirname, '../..'))
const profilePrefix = 'minddiary-ai-draft-navigation-e2e-'
const reply = 'UX04 local synthetic accepted response'
interface OwnedElectron { app: ElectronApplication; process: ChildProcess }
interface Fixture {
  server: Server
  endpoint: string
  credential: string
  requests: { body: string; authenticated: boolean }[]
  holdNext: boolean
  held: ServerResponse[]
}

function hasExited(child: ChildProcess) { return child.exitCode !== null || child.signalCode !== null }
function respond(response: ServerResponse, content = reply) {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }))
}
async function createFixture(): Promise<Fixture> {
  const fixture: Fixture = {
    server: createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { body += chunk })
      request.on('end', () => {
        const authenticated = request.headers.authorization === `Bearer ${fixture.credential}`
        fixture.requests.push({ body, authenticated })
        if (!authenticated) {
          response.writeHead(401, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: { message: 'Synthetic credential rejected' } }))
        } else if (fixture.holdNext) {
          fixture.holdNext = false
          fixture.held.push(response)
        } else respond(response)
      })
    }),
    endpoint: '', credential: `synthetic-good-${randomUUID()}`, requests: [], holdNext: false, held: [],
  }
  await new Promise<void>((resolve, reject) => {
    fixture.server.once('error', reject)
    fixture.server.listen(0, '127.0.0.1', () => { fixture.server.removeListener('error', reject); resolve() })
  })
  const address = fixture.server.address()
  if (!address || typeof address === 'string') throw new Error('Synthetic fixture did not bind a local port')
  fixture.endpoint = `http://127.0.0.1:${address.port}/v1`
  return fixture
}
async function launch(profile: string, apps: OwnedElectron[]) {
  const app = await electron.launch({ args: [projectRoot, `--user-data-dir=${profile}`], env: { ...process.env, NODE_ENV: 'production' } })
  const owned = { app, process: app.process() }
  apps.push(owned)
  const page = await app.firstWindow()
  await page.waitForLoadState('load')
  await expect(page).toHaveURL(pathToFileURL(path.join(projectRoot, 'dist/index.html')).href)
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile)
  const start = page.getByRole('button', { name: '开始使用', exact: true })
  const navigation = page.getByRole('navigation', { name: '主要导航' })
  await expect(start.or(navigation)).toBeVisible()
  if (await start.isVisible()) await start.click()
  await expect(navigation).toBeVisible()
  return { ...owned, page }
}
async function navigate(page: Page, name: '学习助手' | '设置' | '今日安排') {
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name, exact: true }).click()
  if (name === '学习助手') await expect(page.locator('#ai-composer-input')).toBeVisible()
  if (name === '设置') await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
}
async function configure(page: Page, fixture: Fixture, credential = fixture.credential) {
  await page.evaluate(async config => {
    await window.api.settings.updateAI({ aiEndpoint: config.endpoint, aiModel: 'minddiary-local-e2e-model', aiApiKey: config.credential, aiVisionEnabled: true })
  }, { endpoint: fixture.endpoint, credential })
  // Settings context reloads from the actual preload and SQLite on a fresh renderer.
  await page.reload()
  await navigate(page, '学习助手')
}
async function send(page: Page, fixture: Fixture) {
  const count = fixture.requests.length
  await page.getByRole('button', { name: '发送问题', exact: true }).click()
  await expect.poll(() => fixture.requests.length).toBe(count + 1)
  return count
}
async function expectNoAutomaticSend(page: Page, fixture: Fixture, count: number) {
  await expect(page.getByRole('button', { name: '停止请求', exact: true })).toHaveCount(0)
  // A bounded observation catches navigation-triggered or debounced resend.
  await page.waitForTimeout(800)
  expect(fixture.requests).toHaveLength(count)
}
async function history(page: Page): Promise<{ role: string; content: string }[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('minddiary.ai.chatHistory') || '[]'))
}
async function assertPrivateDraft(page: Page, app: ElectronApplication, markers: string[]) {
  const rendererStorage = await page.evaluate(() => JSON.stringify({ ...localStorage }))
  const runtime = await app.evaluate(({ app }) => ({ executable: process.execPath, profile: app.getPath('userData') }))
  // Electron RUN_AS_NODE shares the app ABI; this never rebuilds or swaps the native addon.
  const inspected = spawnSync(runtime.executable, ['-e', `
    const db = new (require('better-sqlite3'))(process.argv[1], { readonly: true, fileMustExist: true });
    const definitions = JSON.parse(process.argv[2]);
    const backupProjection = {};
    for (const definition of definitions) {
      backupProjection[definition.key] = db.prepare('SELECT ' + definition.columns.join(', ') + ' FROM ' + definition.table).all();
    }
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    const allRows = Object.fromEntries(tables.map(({ name }) => [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all()]));
    console.log(JSON.stringify({ backupProjection, allRows, integrity: db.pragma('integrity_check', { simple: true }) }));
    db.close();
  `, path.join(runtime.profile, 'minddiary.db'), JSON.stringify(DATABASE_BACKUP_TABLES)], {
    cwd: projectRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 15_000,
  })
  if (inspected.status !== 0) throw new Error(`Disposable SQLite inspection failed: ${inspected.stderr}`)
  const database = JSON.parse(inspected.stdout)
  expect(database.integrity).toBe('ok')
  for (const marker of markers) {
    expect(rendererStorage).not.toContain(marker)
    expect(JSON.stringify(database.allRows)).not.toContain(marker)
    expect(JSON.stringify(database.backupProjection)).not.toContain(marker)
  }
  return { localStorageAbsent: true, sqliteRowsAbsent: true, backupProjectionAbsent: true, integrity: database.integrity, checkedMarkerCount: markers.length }
}
async function receipt(testInfo: TestInfo, page: Page, evidence: Record<string, unknown>) {
  const resultPath = testInfo.outputPath('UX04-assertion-receipt.json')
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2))
  await testInfo.attach('UX04-assertion-receipt.json', { path: resultPath, contentType: 'application/json' })
  const screenshot = testInfo.outputPath('UX04-real-electron-composer.png')
  await page.screenshot({ path: screenshot })
  await testInfo.attach('UX04-real-electron-composer.png', { path: screenshot, contentType: 'image/png' })
}
async function cleanup(apps: OwnedElectron[], profile: string, fixture: Fixture, bodyFailed: boolean) {
  const errors: unknown[] = []
  for (const response of fixture.held) respond(response)
  for (const owned of apps) {
    try {
      if (!hasExited(owned.process)) await owned.app.close()
      await expect.poll(() => hasExited(owned.process), { timeout: 10_000 }).toBe(true)
    } catch (error) { errors.push(error) }
  }
  try {
    if (apps.some(owned => !hasExited(owned.process))) throw new Error('Refusing disposable profile removal while owned Electron is running')
    await removeDisposableElectronProfile(profile, profilePrefix)
  } catch (error) { errors.push(error) }
  try {
    fixture.server.closeAllConnections()
    if (fixture.server.listening) await new Promise<void>((resolve, reject) => fixture.server.close(error => error ? reject(error) : resolve()))
  } catch (error) { errors.push(error) }
  if (errors.length) {
    console.error('UX04 disposable runtime cleanup failed', errors)
    if (!bodyFailed) throw errors[0]
  }
}

// A real, one-page extractable PDF built entirely from synthetic text.
function syntheticPdf(marker: string): Buffer {
  const stream = `BT /F1 12 Tf 20 150 Td (${marker}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let content = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(content)); content += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(content)
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach(offset => { content += `${String(offset).padStart(10, '0')} 00000 n \n` })
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(content)
}

test.describe('UX-04 AI text draft navigation through production Electron', () => {
  test.describe.configure({ timeout: 180_000 })

  test('retains an unsent plain-text question across Today navigation without persistence or automatic requests', async ({}, testInfo) => {
    const fixture = await createFixture()
    const profile = createDisposableElectronProfile(profilePrefix)
    const apps: OwnedElectron[] = []
    let bodyFailed = true
    try {
      const { app, page } = await launch(profile, apps)
      await configure(page, fixture)
      const question = `Explain the geometric idea of a derivative. UX04_UNSENT_${randomUUID()}`
      await page.locator('#ai-composer-input').fill(question)
      const privateDraft = await assertPrivateDraft(page, app, [question])
      await navigate(page, '今日安排')
      await navigate(page, '学习助手')
      // Baseline red gate: the original unmounted composer loses this text.
      await expect(page.locator('#ai-composer-input')).toHaveValue(question)
      await expectNoAutomaticSend(page, fixture, 0)
      expect(await history(page)).toEqual([])
      await receipt(testInfo, page, { plainTextRetained: true, navigationRequests: fixture.requests.length, acceptedHistoryCount: 0, privateDraft })
      bodyFailed = false
    } finally { await cleanup(apps, profile, fixture, bodyFailed) }
  })

  test('keeps a failed question while the real Settings UI repairs a synthetic key and sends only on explicit retry', async ({}, testInfo) => {
    const fixture = await createFixture()
    const profile = createDisposableElectronProfile(profilePrefix)
    const apps: OwnedElectron[] = []
    let bodyFailed = true
    try {
      const { app, page } = await launch(profile, apps)
      await configure(page, fixture, `synthetic-wrong-${randomUUID()}`)
      const question = `Explain the geometric idea of an integral. UX04_FAILED_${randomUUID()}`
      await page.locator('#ai-composer-input').fill(question)
      await send(page, fixture)
      await expect(page.getByRole('status').filter({ hasText: '回复未采用' })).toBeVisible()
      expect(fixture.requests[0]!.authenticated).toBe(false)
      expect(await history(page)).toEqual([])
      const privateDraft = await assertPrivateDraft(page, app, [question])
      await navigate(page, '设置')
      const modify = page.getByRole('button', { name: '修改', exact: true })
      if (await modify.isVisible()) await modify.click()
      const key = page.getByLabel('API Key', { exact: true })
      await expect(key).toBeVisible()
      await key.fill(fixture.credential)
      await page.getByRole('button', { name: '保存设置', exact: true }).click()
      await expect(key).toBeHidden()
      await navigate(page, '学习助手')
      await expect(page.locator('#ai-composer-input')).toHaveValue(question)
      await expectNoAutomaticSend(page, fixture, 1)
      const privateAfterNavigation = await assertPrivateDraft(page, app, [question])
      await send(page, fixture)
      await expect(page.getByText(reply, { exact: true }).last()).toBeVisible()
      await expect(page.locator('#ai-composer-input')).toHaveValue('')
      expect(fixture.requests.map(request => request.authenticated)).toEqual([false, true])
      await expect.poll(async () => (await history(page)).map(message => message.role)).toEqual(['user', 'assistant'])
      expect((await history(page))[0]!.content).toBe(question)
      await receipt(testInfo, page, { failedQuestionRetained: true, explicitRetryCleared: true, authenticationCategories: fixture.requests.map(request => request.authenticated), acceptedHistoryCount: 2, privateDraft, privateAfterNavigation })
      bodyFailed = false
    } finally { await cleanup(apps, profile, fixture, bodyFailed) }
  })

  test('protects changed and ABA drafts from late success, cancellation, history clearing, reload and restart', async ({}, testInfo) => {
    const fixture = await createFixture()
    const profile = createDisposableElectronProfile(profilePrefix)
    const apps: OwnedElectron[] = []
    let bodyFailed = true
    try {
      let launched = await launch(profile, apps)
      let { app, page } = launched
      await configure(page, fixture)
      const composer = () => page.locator('#ai-composer-input')
      const initial = `Explain vectors. UX04_SENT_${randomUUID()}`
      const replacement = `Explain matrices. UX04_REPLACEMENT_${randomUUID()}`
      await composer().fill(initial)
      fixture.holdNext = true
      await send(page, fixture)
      await composer().fill(replacement)
      respond(fixture.held.shift()!, 'UX04 changed draft late success')
      await expect(page.getByText('UX04 changed draft late success', { exact: true })).toBeVisible()
      await expect(composer()).toHaveValue(replacement)
      const privateReplacement = await assertPrivateDraft(page, app, [replacement])
      const firstAcceptedHistory = await history(page)
      expect(firstAcceptedHistory.map(message => message.role)).toEqual(['user', 'assistant'])
      await navigate(page, '今日安排')
      await navigate(page, '学习助手')
      await expect(composer()).toHaveValue(replacement)
      expect(await history(page)).toEqual(firstAcceptedHistory)
      await expectNoAutomaticSend(page, fixture, 1)

      const aba = `Explain scalar products. UX04_ABA_${randomUUID()}`
      await composer().fill(aba)
      fixture.holdNext = true
      await send(page, fixture)
      await composer().fill(`${aba} changed`)
      await composer().fill(aba)
      respond(fixture.held.shift()!, 'UX04 ABA late success')
      await expect(page.getByText('UX04 ABA late success', { exact: true })).toBeVisible()
      await expect(composer()).toHaveValue(aba)

      const cancelled = `Explain a basis. UX04_CANCELLED_${randomUUID()}`
      await composer().fill(cancelled)
      fixture.holdNext = true
      await send(page, fixture)
      await page.getByRole('button', { name: '停止请求', exact: true }).click()
      await expect(page.getByRole('button', { name: '发送问题', exact: true })).toBeVisible()
      respond(fixture.held.shift()!, 'UX04 cancelled late response must not be adopted')
      await page.waitForTimeout(800)
      await expect(composer()).toHaveValue(cancelled)
      await expect(page.getByText('UX04 cancelled late response must not be adopted', { exact: true })).toHaveCount(0)
      const privateCancelled = await assertPrivateDraft(page, app, [cancelled])
      const acceptedBeforeClear = await history(page)
      expect(acceptedBeforeClear.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
      expect(acceptedBeforeClear.some(message => message.content === cancelled)).toBe(false)
      await navigate(page, '今日安排')
      await navigate(page, '学习助手')
      await expect(composer()).toHaveValue(cancelled)
      expect(await history(page)).toEqual(acceptedBeforeClear)
      await expectNoAutomaticSend(page, fixture, 3)

      page.once('dialog', dialog => void dialog.accept())
      await page.getByRole('button', { name: '清空历史', exact: true }).click()
      await expect(composer()).toHaveValue('')
      await expect.poll(async () => await history(page)).toEqual([])
      await navigate(page, '今日安排')
      await navigate(page, '学习助手')
      await expect(composer()).toHaveValue('')
      const reloadDraft = `Explain a determinant. UX04_RELOAD_${randomUUID()}`
      await composer().fill(reloadDraft)
      await page.reload()
      await navigate(page, '学习助手')
      await expect(composer()).toHaveValue('')
      const restartDraft = `Explain eigenvalues. UX04_RESTART_${randomUUID()}`
      await composer().fill(restartDraft)
      await app.close()
      await expect.poll(() => hasExited(launched.process)).toBe(true)
      launched = await launch(profile, apps)
      app = launched.app
      page = launched.page
      await navigate(page, '学习助手')
      await expect(composer()).toHaveValue('')
      const privateRestart = await assertPrivateDraft(page, app, [replacement, cancelled, reloadDraft, restartDraft])
      await expectNoAutomaticSend(page, fixture, 3)
      await receipt(testInfo, page, { changedDraftPreserved: true, abaDraftPreserved: true, cancelledLateResponseNotAdopted: true, clearHistoryDiscardsDraft: true, reloadDiscardsDraft: true, fullRestartDiscardsDraft: true, requestCount: fixture.requests.length, privateReplacement, privateCancelled, privateRestart })
      bodyFailed = false
    } finally { await cleanup(apps, profile, fixture, bodyFailed) }
  })

  test('drops image, TXT, PDF and context on navigation and sends the restored text without hidden attachment material', async ({}, testInfo) => {
    const fixture = await createFixture()
    const profile = createDisposableElectronProfile(profilePrefix)
    const apps: OwnedElectron[] = []
    let bodyFailed = true
    try {
      const { app, page } = await launch(profile, apps)
      await configure(page, fixture)
      const id = randomUUID().replace(/-/g, '')
      const textMarker = `UX04_TXT_BYTES_${id}`
      const pdfMarker = `UX04_PDF_TEXT_${id}`
      const imageName = `UX04_IMAGE_${id}.png`
      const textName = `UX04_TEXT_${id}.txt`
      const pdfName = `UX04_PDF_${id}.pdf`
      const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
      const pdf = syntheticPdf(pdfMarker)
      await page.locator('.ai-composer input[type="file"]').setInputFiles([
        { name: imageName, mimeType: 'image/png', buffer: Buffer.from(imageBase64, 'base64') },
        { name: textName, mimeType: 'text/plain', buffer: Buffer.from(textMarker) },
        { name: pdfName, mimeType: 'application/pdf', buffer: pdf },
      ])
      for (const name of [imageName, textName, pdfName]) await expect(page.getByRole('button', { name: `移除附件：${name}`, exact: true })).toBeVisible()
      await expect(page.getByText('已读取可提取文字', { exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('正在读取', { exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: '状态调整', exact: true }).click()
      await expect(page.getByRole('button', { name: '移除资料：近期回顾', exact: true })).toBeVisible()
      const question = `Explain the geometric meaning of a tangent. UX04_ATTACHMENT_DRAFT_${id}`
      await page.locator('#ai-composer-input').fill(question)
      const privateDraft = await assertPrivateDraft(page, app, [question, textMarker, pdfMarker, imageName, textName, pdfName, imageBase64])
      await navigate(page, '今日安排')
      await navigate(page, '学习助手')
      await expect(page.locator('#ai-composer-input')).toHaveValue(question)
      await expect(page.locator('.ai-attachments')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^移除资料：/ })).toHaveCount(0)
      await expectNoAutomaticSend(page, fixture, 0)
      await send(page, fixture)
      await expect(page.getByText(reply, { exact: true }).last()).toBeVisible()
      await expect(page.locator('#ai-composer-input')).toHaveValue('')
      const request = fixture.requests[0]!.body
      expect(request).toContain(question)
      for (const marker of [textMarker, pdfMarker, imageName, textName, pdfName, imageBase64, pdf.toString('base64'), 'data:image/', 'image_url', '<user_attachments>', '<application_context>', '近期复盘', 'textAttachments', 'imageDataUrls']) expect(request).not.toContain(marker)
      const parsed = JSON.parse(request)
      expect(parsed.messages.filter((message: { role: string }) => message.role === 'user')).toEqual([{ role: 'user', content: question }])
      expect(request).not.toMatch(/blob:|file:\/\/|[A-Za-z]:\\\\|\/tmp\//)
      const privateAfterSend = await assertPrivateDraft(page, app, [textMarker, pdfMarker, imageName, textName, pdfName, imageBase64])
      expect((await history(page)).map(message => message.role)).toEqual(['user', 'assistant'])
      await receipt(testInfo, page, { realFileReaders: ['image/png', 'text/plain', 'application/pdf'], extractedPdfReady: true, navigationRestoresTextOnly: true, navigationRequests: 0, explicitTextOnlyRequest: true, requestCount: fixture.requests.length, privateDraft, privateAfterSend })
      bodyFailed = false
    } finally { await cleanup(apps, profile, fixture, bodyFailed) }
  })
})
