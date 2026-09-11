import { test, expect, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'

// Real application in its browser fallback; isolated localStorage, no Electron DB.
// Run after `vite build`. --output can keep screenshots outside the checkout.
let server: ChildProcess | undefined
let baseUrl: string
const sample = '今天复习了 **齿轮传动**，这里 ++需要再看++。\n\n把 ==受力分析== 写清楚，再做 {color:red}重点题{/color}。\n\n明天从一道具体的题开始。'

test.beforeAll(async () => {
  const reservation = createServer()
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const address = reservation.address()
  if (!address || typeof address === 'string') throw new Error('No preview port')
  const port = address.port
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  baseUrl = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
  await expect.poll(async () => {
    try { return (await fetch(baseUrl)).ok } catch { return false }
  }).toBe(true)
})
test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = new Promise<void>(resolve => server!.once('exit', () => resolve()))
    server.kill()
    await stopped
  }
})

async function openEditor(page: Page, theme: 'light' | 'dark', content = sample) {
  await page.addInitScript(({ theme, content }) => {
    const today = new Date()
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    localStorage.setItem('started', 'true')
    localStorage.setItem('mindiary_settings', JSON.stringify({ theme }))
    localStorage.setItem('mindiary_entries', JSON.stringify([{ id: 9001, date, title: '复习与思考', content, tags: [], mood: null, images: [], word_count: content.length, created_at: date, updated_at: date }]))
  }, { theme, content })
  await page.goto(baseUrl)
  const start = page.getByRole('button', { name: '开始使用' })
  if (await start.isVisible()) await start.click()
  await page.getByRole('button', { name: '写日记', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '日记正文' })).toBeVisible()
}

async function selectText(page: Page, text: string) {
  // Use the browser selection itself; never expose a production editor test API.
  await page.getByRole('textbox', { name: '日记正文' }).evaluate((element, text) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf(text) ?? -1
      if (index < 0) continue
      ;(element as HTMLElement).focus()
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + text.length)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      return
    }
    throw new Error(`Text not found: ${text}`)
  }, text)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text)
}

for (const size of [{ width: 1280, height: 720 }, { width: 960, height: 600 }]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${size.width}x${size.height} ${theme}: decorations, selection controls and viewport`, async ({ page }, testInfo) => {
      await page.setViewportSize(size)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await openEditor(page, theme)
      const body = page.getByRole('textbox', { name: '日记正文' })
      await expect(body.locator('.diary-format-bold')).toHaveText('齿轮传动')
      await expect(body.locator('.diary-format-underline')).toHaveText('需要再看')
      await expect(body.locator('.diary-format-highlight')).toHaveText('受力分析')
      await expect(body.locator('.md-color-red')).toHaveText('重点题')
      await expect(body).not.toContainText('**')
      await expect(body).not.toContainText('{color:red}')
      const geometry = await body.evaluate(element => ({
        viewportWidth: innerWidth, pageWidth: document.documentElement.scrollWidth,
        editorWidth: element.clientWidth, contentWidth: element.scrollWidth,
        bold: getComputedStyle(element.querySelector('.diary-format-bold')!).fontWeight,
        textColor: getComputedStyle(element).color,
        boldColor: getComputedStyle(element.querySelector('.diary-format-bold')!).color,
        redColor: getComputedStyle(element.querySelector('.md-color-red')!).color,
        background: getComputedStyle(element.closest('.editor-writing-canvas')!).backgroundColor,
        colorTokens: ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'].map(key => ({ key, value: getComputedStyle(element).getPropertyValue(`--md-color-${key}`) })),
      }))
      await testInfo.attach('geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' })
      await writeFile(testInfo.outputPath('geometry.json'), JSON.stringify(geometry, null, 2))
      const contrasts = await body.evaluate(element => {
        const context = document.createElement('canvas').getContext('2d')!
        const luminance = (css: string) => {
          context.fillStyle = css
          context.fillRect(0, 0, 1, 1)
          const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
            const channel = value / 255
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
          })
          return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722
        }
        const background = luminance(getComputedStyle(element.closest('.editor-writing-canvas')!).backgroundColor)
        const probe = document.createElement('span')
        // Outside CM's observed content; this only measures existing class styles.
        element.closest('.diary-live-preview')!.append(probe)
        const result = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'].map(key => {
          probe.className = `md-color-${key}`
          const foreground = luminance(getComputedStyle(probe).color)
          return { key, ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) }
        })
        probe.remove()
        return result
      })
      for (const color of contrasts) expect(color.ratio, color.key).toBeGreaterThanOrEqual(4.5)
      await writeFile(testInfo.outputPath('color-contrast.json'), JSON.stringify(contrasts, null, 2))
      expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth)
      expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.editorWidth + 1)
      expect(geometry.bold).toBe('700')
      expect(geometry.boldColor).toBe(geometry.textColor)
      await page.screenshot({ path: testInfo.outputPath('reading.png') })

      await selectText(page, '需要再看')
      const floating = page.locator('.diary-selection-toolbar')
      await expect(floating).toBeVisible()
      await expect(floating.getByRole('button', { name: '下划线', exact: true })).toHaveAttribute('aria-pressed', 'true')
      const box = (await floating.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(size.width)
      const selectionTop = await page.evaluate(() => window.getSelection()!.getRangeAt(0).getBoundingClientRect().top)
      expect(box.y + box.height).toBeLessThanOrEqual(selectionTop)
      await floating.getByRole('button', { name: '文字颜色' }).click()
      const popover = floating.getByRole('group', { name: '选择颜色' })
      await expect(popover).toBeVisible()
      const popup = (await popover.boundingBox())!
      expect(popup.x).toBeGreaterThanOrEqual(0)
      expect(popup.y).toBeGreaterThanOrEqual(0)
      expect(popup.x + popup.width).toBeLessThanOrEqual(size.width)
      await page.screenshot({ path: testInfo.outputPath('selection.png') })
      await popover.getByRole('button', { name: '红色', exact: true }).focus()
      await page.keyboard.press('Escape')
      await expect(popover).toBeHidden()
      await expect(floating.getByRole('button', { name: '文字颜色' })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(floating).toBeHidden()
      await expect(body).toBeFocused()
      expect(await body.evaluate(element => getComputedStyle(element.closest('.cm-editor')!).boxShadow)).not.toBe('none')
      expect(errors).toEqual([])
    })
  }
}

test('native browser typing, fixed/selection toolbar, color toggle, keyboard, undo and autosave', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await openEditor(page, 'light', '今天复习重点。')
  const body = page.getByRole('textbox', { name: '日记正文' })
  const fixed = page.locator('.editor-commandbar__primary')
  await selectText(page, '重点')
  await fixed.getByRole('button', { name: '加粗' }).click()
  await expect(fixed.getByRole('button', { name: '加粗' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('重点')
  await body.press('Control+z')
  await expect(body).toHaveText('今天复习重点。')
  await body.press('Control+b')
  await expect(body).toContainText('**重点**')
  await body.press('ArrowRight')
  await page.keyboard.insertText('内容')
  await expect(body).toContainText('重点内容')
  await body.press('Control+s')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mindiary_entries')!)[0].content)).toBe('今天复习**重点内容**。')
  await selectText(page, '重点内容')
  await body.press('Control+b')
  await fixed.getByRole('button', { name: '文字颜色' }).click()
  await fixed.getByRole('button', { name: '红色', exact: true }).click()
  await expect(body).toContainText('{color:red}重点内容{/color}')
  await fixed.getByRole('button', { name: '文字颜色' }).click()
  await fixed.getByRole('button', { name: '蓝色', exact: true }).click()
  await expect(body).toContainText('{color:blue}重点内容{/color}')
  await expect(body).not.toContainText('{color:red}')
  await fixed.getByRole('button', { name: '文字颜色' }).click()
  await fixed.getByRole('button', { name: '清除颜色' }).click()
  await expect(body).toHaveText('今天复习重点内容。')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mindiary_entries')!)[0].content)).toBe('今天复习重点内容。')
})

test('long diary wraps and scrolls to its last line', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 })
  await openEditor(page, 'dark', `${sample}\n\n${'很长的日记内容'.repeat(500)}\n日记末尾`)
  const body = page.getByRole('textbox', { name: '日记正文' })
  await body.click()
  await body.press('Control+End')
  await expect(body.getByText('日记末尾', { exact: true })).toBeInViewport()
  expect(await body.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
