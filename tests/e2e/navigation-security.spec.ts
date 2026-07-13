import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

let app: ElectronApplication
let page: Page
let server: Server
let profilePath: string
let windowCount: number
let pdfNavigationRequests = 0

const projectRoot = path.join(__dirname, '..', '..')
const externalCallKey = '__minddiarySecurityExternalCalls'

const startServer = async (): Promise<void> => {
  server = createServer((request, response) => {
    if (request.url === '/pdf-redirect') {
      pdfNavigationRequests += 1
      response.writeHead(302, { Location: '/pdf-target' })
      response.end()
      return
    }
    if (request.url === '/pdf-target') pdfNavigationRequests += 1
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: 'https://external.test/redirected?token=secret' })
      response.end()
      return
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><html><head><title>MindDiary security E2E</title></head><body>ready</body></html>')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(5173, 'localhost', resolve)
  })
}

const stopServer = async (): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

const getExternalCalls = async (): Promise<readonly string[]> => app.evaluate(() => {
  const value = Reflect.get(process, '__minddiarySecurityExternalCalls')
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
})

const clearExternalCalls = async (): Promise<void> => {
  await app.evaluate(() => {
    Reflect.set(process, '__minddiarySecurityExternalCalls', [])
  })
}

test.describe.serial('Electron navigation security', () => {
  test.beforeAll(async () => {
    profilePath = mkdtempSync(path.join(tmpdir(), 'minddiary-security-e2e-'))
    await startServer()
    app = await electron.launch({
      args: [projectRoot, `--user-data-dir=${profilePath}`],
      env: { ...process.env, NODE_ENV: 'development' },
    })
    await expect.poll(() => app.windows().some(candidate => candidate.url().startsWith('http://localhost:5173'))).toBe(true)
    const appPage = app.windows().find(candidate => candidate.url().startsWith('http://localhost:5173'))
    if (!appPage) throw new Error('MindDiary application window was not created')
    page = appPage
    await page.waitForLoadState('load')
    await expect(page).toHaveURL('http://localhost:5173/')

    const shellWasReplaced = await app.evaluate(({ shell }) => Reflect.set(shell, 'openExternal', async (url: string) => {
      const calls = Reflect.get(process, '__minddiarySecurityExternalCalls')
      if (Array.isArray(calls)) calls.push(url)
    }))
    expect(shellWasReplaced).toBe(true)
    await clearExternalCalls()

    windowCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  })

  test.afterAll(async () => {
    await app.close()
    await stopServer()
    const resolvedProfile = path.resolve(profilePath)
    const resolvedTemp = path.resolve(tmpdir())
    if (!resolvedProfile.startsWith(`${resolvedTemp}${path.sep}minddiary-security-e2e-`)) {
      throw new Error('Refusing to remove unexpected E2E profile path')
    }
    rmSync(resolvedProfile, { recursive: true, force: true })
  })

  test.beforeEach(async () => {
    await clearExternalCalls()
  })

  test('denies target=_blank and opens valid HTTPS in the system-browser seam', async () => {
    await page.evaluate(() => {
      const anchor = document.createElement('a')
      anchor.href = 'https://external.test/blank?token=secret'
      anchor.target = '_blank'
      document.body.append(anchor)
      anchor.click()
    })

    await expect.poll(getExternalCalls).toEqual(['https://external.test/blank?token=secret'])
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(windowCount)
  })

  test('denies window.open child creation and opens valid HTTPS externally', async () => {
    const childWasDenied = await page.evaluate(() => window.open('https://external.test/window-open', '_blank') === null)

    expect(childWasDenied).toBe(true)
    await expect.poll(getExternalCalls).toEqual(['https://external.test/window-open'])
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(windowCount)
  })

  for (const blockedTarget of [
    'javascript:alert(1)',
    'data:text/html,blocked',
    'file:///C:/Windows/System32/calc.exe',
    'local://attachments/security-e2e.png',
  ]) {
    test(`denies window.open for ${blockedTarget.split(':')[0]} without external dispatch`, async () => {
      const childWasDenied = await page.evaluate(target => window.open(target, '_blank') === null, blockedTarget)

      expect(childWasDenied).toBe(true)
      await expect.poll(getExternalCalls).toEqual([])
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(windowCount)
    })
  }

  test('blocks external top-level navigation and dispatches it externally', async () => {
    await page.evaluate(() => {
      const anchor = document.createElement('a')
      anchor.href = 'https://external.test/top-level?token=secret'
      anchor.target = '_self'
      document.body.append(anchor)
      anchor.click()
    })

    await expect.poll(getExternalCalls).toEqual(['https://external.test/top-level?token=secret'])
    await expect.poll(() => page.evaluate(() => window.location.href)).toBe('http://localhost:5173/')
  })

  test('revalidates and blocks an untrusted redirect target', async () => {
    await page.evaluate(() => {
      const anchor = document.createElement('a')
      anchor.href = '/redirect'
      document.body.append(anchor)
      anchor.click()
    })

    await expect.poll(getExternalCalls).toEqual(['https://external.test/redirected?token=secret'])
    await expect.poll(() => page.evaluate(() => window.location.href)).toBe('http://localhost:5173/')
  })

  test('default-denies renderer notification and geolocation permissions', async () => {
    const permissions = await page.evaluate(async () => ({
      notification: await Notification.requestPermission(),
      geolocation: (await navigator.permissions.query({ name: 'geolocation' })).state,
    }))

    expect(permissions).toEqual({ notification: 'denied', geolocation: 'denied' })
  })

  test('writes clipboard through preload IPC while renderer clipboard permission stays denied', async () => {
    const sentinel = 'minddiary-clipboard-e2e-sentinel'
    const originalText = await app.evaluate(({ clipboard }) => clipboard.readText())

    try {
      const permission = await page.evaluate(async text => {
        const descriptor: PermissionDescriptor = { name: 'geolocation' }
        Reflect.set(descriptor, 'name', 'clipboard-write')
        const state = await navigator.permissions.query(descriptor)
        if (!window.api.clipboard) throw new Error('Clipboard preload API is unavailable')
        await window.api.clipboard.writeText(text)
        return state.state
      }, sentinel)

      expect(permission).toBe('denied')
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(sentinel)
    } finally {
      await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), originalText)
    }
  })

  test('keeps a malicious PDF document isolated while producing a paginated Chinese PDF', async () => {
    const savePath = path.join(profilePath, 'print-window-security.pdf')
    const originalDialogKey = '__minddiaryOriginalShowSaveDialog'
    const htmlContent = `<!doctype html><html><head>
      <meta http-equiv="refresh" content="0;url=http://localhost:5173/pdf-redirect">
      <style>.page { page-break-after: always; font-family: sans-serif; }</style>
      <script>window.open('http://localhost:5173/pdf-target'); location.href='http://localhost:5173/pdf-redirect'</script>
      </head><body><section class="page">中文打印安全第一页</section><section>中文打印安全第二页</section></body></html>`
    pdfNavigationRequests = 0
    await clearExternalCalls()
    await app.evaluate(({ dialog }, { key, target }) => {
      Reflect.set(process, key, dialog.showSaveDialog)
      Reflect.set(dialog, 'showSaveDialog', async () => ({ canceled: false, filePath: target }))
    }, { key: originalDialogKey, target: savePath })

    try {
      await page.evaluate(async ({ html, target }) => {
        const selected = await window.api.export.showSaveDialog({ title: 'PDF security E2E' })
        if (selected !== target) throw new Error('Unexpected PDF save path')
        await window.api.export.toPDF(html, target)
      }, { html: htmlContent, target: savePath })

      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const document = await getDocument({ data: new Uint8Array(readFileSync(savePath)) }).promise
      const text = await Promise.all(Array.from({ length: document.numPages }, async (_, index) => {
        const page = await document.getPage(index + 1)
        const content = await page.getTextContent()
        return content.items.map(item => 'str' in item ? item.str : '').join(' ')
      }))

      const normalizedText = text.join(' ').normalize('NFKC').replace(/\s+/g, '')
      expect(document.numPages).toBeGreaterThanOrEqual(2)
      expect(normalizedText).toContain('中文打印安全第一')
      expect(normalizedText).toContain('中文打印安全第二')
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(windowCount)
      expect(await getExternalCalls()).toEqual([])
      expect(pdfNavigationRequests).toBe(0)
      const tempDir = await app.evaluate(({ app: electronApp }) => electronApp.getPath('temp'))
      expect(existsSync(path.join(tempDir, 'minddiary_export_tmp.html'))).toBe(false)
    } finally {
      await app.evaluate(({ dialog }, key) => {
        const original = Reflect.get(process, key)
        if (typeof original === 'function') Reflect.set(dialog, 'showSaveDialog', original)
        Reflect.deleteProperty(process, key)
      }, originalDialogKey)
      rmSync(savePath, { force: true })
    }
  })

  test('continues loading a valid local:// asset from the isolated profile', async () => {
    const userDataPath = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
    const attachmentsPath = path.join(userDataPath, 'attachments')
    mkdirSync(attachmentsPath, { recursive: true })
    writeFileSync(
      path.join(attachmentsPath, 'security-e2e.png'),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zr1sAAAAASUVORK5CYII=', 'base64'),
    )

    const loaded = await page.evaluate(() => new Promise<boolean>(resolve => {
      const image = new Image()
      image.onload = () => resolve(true)
      image.onerror = () => resolve(false)
      image.src = 'local://attachments/security-e2e.png'
    }))

    expect(loaded).toBe(true)
  })
})
