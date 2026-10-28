import { _electron as electron, expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { createDisposableElectronProfile, removeDisposableElectronProfile } from './disposableElectronProfile'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const projectRoot = path.resolve(__dirname, '../..')
const prefix = 'minddiary-targeted-ux-e2e-'

async function navigate(page: Page, name: string) {
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name, exact: true }).click()
}

test('search opens and saves the exact clicked diary among same-day records', async ({}, testInfo) => {
  const profile = createDisposableElectronProfile(prefix)
  const app = await electron.launch({ args: [projectRoot, `--user-data-dir=${profile}`], env: { ...process.env, NODE_ENV: 'production' } })
  try {
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile)
    const page = await app.firstWindow()
    await page.waitForLoadState('load')
    await page.getByRole('button', { name: '开始使用', exact: true }).click()
    const entries = await page.evaluate(async () => {
      const date = '2026-10-09'
      const reflection = await window.api.entries.create({ date, title: 'UX专注复盘', content: '专注记录原文 A', mood: null })
      const handwritten = await window.api.entries.create({ date, title: 'UX手写日记', content: '手写日记原文 B，完整正文用于验证搜索摘要不会替代正文。'.repeat(12), mood: null })
      return { reflection, handwritten }
    })
    await navigate(page, '搜索日记')
    await page.getByLabel('搜索内容', { exact: true }).fill('UX')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.locator('.workspace-search')).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByRole('button', { name: '打开日记 UX手写日记', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '打开日记 UX手写日记', exact: true }).click()
    const title = page.getByRole('textbox', { name: '日记标题', exact: true })
    const body = page.getByRole('textbox', { name: '日记正文', exact: true })
    await expect(title).toHaveValue('UX手写日记')
    await expect(body).toHaveText(entries.handwritten.content)
    await body.fill('手写日记修改 B2')
    await page.keyboard.press('Control+s')
    await expect.poll(() => page.evaluate(id => window.api.entries.getById(id), entries.handwritten.id)).toMatchObject({ content: '手写日记修改 B2' })
    expect(await page.evaluate(id => window.api.entries.getById(id), entries.reflection.id)).toMatchObject({ content: '专注记录原文 A' })
    await navigate(page, '搜索日记')
    await page.getByRole('button', { name: '打开日记 UX专注复盘', exact: true }).click()
    await expect(title).toHaveValue('UX专注复盘')
    await expect(body).toHaveText('专注记录原文 A')
    await navigate(page, '搜索日记')
    await page.getByRole('button', { name: '打开日记 UX手写日记', exact: true }).click()
    await expect(title).toHaveValue('UX手写日记')
    await expect(body).toHaveText('手写日记修改 B2')
    expect(await page.evaluate(() => window.api.entries.getAll({ includeContent: true }))).toHaveLength(2)
    await page.screenshot({ path: testInfo.outputPath('same-day-exact-diary.png') })
  } finally {
    const child = app.process()
    await app.close()
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true)
    await removeDisposableElectronProfile(profile, prefix)
  }
})

test('normal math and sprint requests reach the provider, math renders, and local-data restrictions still block', async ({}, testInfo) => {
  const requests: string[] = []
  const reply = String.raw`行内：\(\frac{1}{2}\)。

\[\lim_{x\to0}\frac{\sin x}{x}=1\]

$$\text{结果}\quad x^2+1$$

\frac{a+b}{c}

普通文字与 **Markdown**。

` + '`' + String.raw`\frac{1}{2}` + '`'
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      requests.push(body)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind')
  const profile = createDisposableElectronProfile(prefix)
  const app = await electron.launch({ args: [projectRoot, `--user-data-dir=${profile}`], env: { ...process.env, NODE_ENV: 'production' } })
  try {
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile)
    const page = await app.firstWindow()
    await page.waitForLoadState('load')
    await page.getByRole('button', { name: '开始使用', exact: true }).click()
    await page.evaluate(async endpoint => {
      await window.api.entries.create({ date: '2026-10-10', title: '私密样本', content: 'LOCAL-DIARY-PRIVATE-UX-CANARY', mood: null })
      await window.api.settings.updateAI({ aiEndpoint: endpoint, aiModel: 'ux-local-model', aiApiKey: 'synthetic-ux-key' })
    }, `http://127.0.0.1:${address.port}/v1`)
    await page.reload()
    await navigate(page, '学习助手')
    const input = page.locator('#ai-composer-input')
    const send = page.getByRole('button', { name: '发送问题', exact: true })
    for (const prompt of ['解释极限和正弦函数的关系。', '再给我一道同类型题，只给题目，先不要给答案。', '请帮我制定考前冲刺计划，安排每日任务，不要安排太满。']) {
      const count = requests.length
      await input.fill(prompt)
      await send.click()
      await expect.poll(() => requests.length).toBe(count + 1)
      await expect(page.getByRole('button', { name: '停止请求', exact: true })).toHaveCount(0)
      await expect(page.locator('.ai-message-content').last().locator('.katex')).toHaveCount(4)
    }
    const output = page.locator('.ai-message-content').last()
    await expect(output.locator('.katex-display')).toHaveCount(3)
    await expect(output.locator('code')).toContainText(String.raw`\frac{1}{2}`)
    await expect(output.locator('strong')).toHaveText('Markdown')
    await page.evaluate(() => document.fonts.ready)
    expect(await output.locator('.katex').first().evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(10)
    await page.screenshot({ path: testInfo.outputPath('ai-math-rendered.png') })
    await page.getByRole('button', { name: '冲刺计划', exact: true }).click()
    expect(await input.inputValue()).toContain('复习计划')
    const quickCount = requests.length
    await send.click()
    await expect.poll(() => requests.length).toBe(quickCount + 1)
    await expect(page.getByRole('button', { name: '停止请求', exact: true })).toHaveCount(0)
    await input.fill('查一下我上周的学习时长')
    await send.click()
    await expect(page.getByText('当前无法按此问题核对本机记录。请明确科目及两段绝对日期，或到对应页面查看。', { exact: true })).toBeVisible()
    await input.fill('再给我一道题，不要给答案，也不要读取日记。')
    await send.click()
    await expect(page.getByText('请说明限制范围；本次没有继续发送。', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '停止请求', exact: true })).toHaveCount(0)
    expect(requests).toHaveLength(4)
    expect(requests.join('\n')).not.toContain('LOCAL-DIARY-PRIVATE-UX-CANARY')
    expect(JSON.parse(requests[1]!).messages.some((message: { content: string }) => message.content === '解释极限和正弦函数的关系。')).toBe(true)
    writeFileSync(testInfo.outputPath('ai-assertions.json'), JSON.stringify({ providerRequests: requests.length, localQueriesBlocked: true, mixedDataRestrictionBlocked: true, diaryCanaryAbsent: true, mathInline: 1, mathDisplay: 3 }, null, 2))
  } finally {
    const child = app.process()
    await app.close()
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true)
    await removeDisposableElectronProfile(profile, prefix)
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('subjects created and renamed through the UI immediately become focus choices', async ({}, testInfo) => {
  const profile = createDisposableElectronProfile(prefix)
  const app = await electron.launch({ args: [projectRoot, `--user-data-dir=${profile}`], env: { ...process.env, NODE_ENV: 'production' } })
  try {
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile)
    const page = await app.firstWindow()
    await page.waitForLoadState('load')
    await page.getByRole('button', { name: '开始使用', exact: true }).click()
    await navigate(page, '专注计时')
    await expect(page.getByTestId('pomodoro-subject-select')).toBeVisible()
    const originalStats = await page.evaluate(() => window.api.pomodoro.getStats('2026-10-10'))
    await navigate(page, '科目进度')
    for (const name of ['数学二', '英语二']) {
      await page.getByRole('button', { name: '添加科目', exact: true }).click()
      await page.getByLabel('科目名', { exact: true }).fill(name)
      await page.getByLabel('章节总数', { exact: true }).fill('10')
      await page.getByRole('button', { name: '创建科目', exact: true }).click()
      await expect(page.getByRole('article', { name, exact: true })).toBeVisible()
    }
    await page.getByRole('navigation', { name: '选择科目', exact: true })
      .getByRole('button', { name: /^数学二\s/ }).click()
    const mathWorkspace = page.getByRole('article', { name: '数学二', exact: true })
    await expect(mathWorkspace).toBeVisible()
    await mathWorkspace.getByText('科目设置', { exact: true }).click()
    await mathWorkspace.getByRole('button', { name: '编辑科目', exact: true }).click()
    await page.getByLabel('科目名', { exact: true }).fill('数学二·改名')
    await page.getByRole('button', { name: '保存更改', exact: true }).click()
    await expect(page.getByRole('article', { name: '数学二·改名', exact: true })).toBeVisible()
    await navigate(page, '专注计时')
    const subjects = page.getByTestId('pomodoro-subject-select')
    await expect(subjects.locator('option', { hasText: '数学二·改名' })).toHaveCount(1)
    await expect(subjects.locator('option', { hasText: '英语二' })).toHaveCount(1)
    await subjects.selectOption({ label: '数学二·改名' })
    const selected = await subjects.inputValue()
    await page.getByTestId('pomodoro-start-btn').click()
    await expect(page.getByTestId('pomodoro-start-btn')).toContainText('暂停')
    await expect(subjects).toHaveValue(selected)
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pomodoro-active-session-v1') || '{}'))).toMatchObject({ selectedSubject: Number(selected), isRunning: true })
    await page.getByTestId('pomodoro-start-btn').click()
    await expect(page.getByTestId('pomodoro-start-btn')).not.toContainText('暂停')
    expect(await page.evaluate(() => window.api.pomodoro.getStats('2026-10-10'))).toEqual(originalStats)
    await page.screenshot({ path: testInfo.outputPath('new-subject-focus.png') })
    writeFileSync(testInfo.outputPath('subject-assertions.json'), JSON.stringify({ immediateCreatedSubjects: ['数学二', '英语二'], renamedSubject: '数学二·改名', focusStartedWithSubjectId: selected, noReload: true, savedStatsUnchanged: true }, null, 2))
  } finally {
    const child = app.process()
    await app.close()
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true)
    await removeDisposableElectronProfile(profile, prefix)
  }
})
