import { describe, expect, it, vi } from 'vitest'
import {
  createClipboardWriteHandler,
  createMainWindowWebPreferences,
  createNavigationHandler,
  createWindowOpenHandler,
  denyPermissionCheck,
  denyPermissionRequest,
  isTrustedMainWindowIpcSender,
} from '../electron/electronSecurity'

const flushPromiseRejection = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

const createLogger = () => ({
  warn: vi.fn(),
  error: vi.fn(),
})

describe('window-open handler', () => {
  it('always denies child windows and opens a valid HTTP(S) URL externally once', () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const handler = createWindowOpenHandler({ openExternal, logger: createLogger() })

    expect(handler({ url: 'https://example.com/path' })).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledWith('https://example.com/path')
  })

  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///C:/secret.txt', 'local://asset.png']) (
    'denies %s without invoking an external program',
    (url) => {
      const openExternal = vi.fn().mockResolvedValue(undefined)
      const handler = createWindowOpenHandler({ openExternal, logger: createLogger() })

      expect(handler({ url })).toEqual({ action: 'deny' })
      expect(openExternal).not.toHaveBeenCalled()
    },
  )

  it('keeps deny when shell.openExternal rejects and logs no sensitive URL data', async () => {
    const logger = createLogger()
    const openExternal = vi.fn().mockRejectedValue(new Error('test rejection'))
    const handler = createWindowOpenHandler({ openExternal, logger })

    expect(handler({ url: 'https://example.com/private?token=secret#fragment' })).toEqual({ action: 'deny' })
    await flushPromiseRejection()

    const logged = JSON.stringify(logger.error.mock.calls)
    expect(logged).toContain('https://example.com')
    expect(logged).not.toContain('private')
    expect(logged).not.toContain('token')
    expect(logged).not.toContain('secret')
  })

  it('keeps deny when shell.openExternal throws synchronously', async () => {
    const logger = createLogger()
    const openExternal = vi.fn(() => {
      throw new Error('synchronous test failure')
    })
    const handler = createWindowOpenHandler({ openExternal, logger })

    expect(() => handler({ url: 'https://example.com/path' })).not.toThrow()
    await flushPromiseRejection()
    expect(logger.error).toHaveBeenCalledOnce()
  })
})

describe('navigation and redirect handler', () => {
  it('allows a trusted app navigation without preventing it', () => {
    const event = { preventDefault: vi.fn() }
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const handler = createNavigationHandler({
      policy: { kind: 'development' },
      openExternal,
      logger: createLogger(),
    })

    handler(event, 'http://localhost:5173/settings#general')

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('blocks an external HTTP(S) navigation and opens it outside Electron', () => {
    const event = { preventDefault: vi.fn() }
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const handler = createNavigationHandler({
      policy: { kind: 'development' },
      openExternal,
      logger: createLogger(),
    })

    handler(event, 'https://example.com/path')

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledOnce()
  })

  it.each([
    'file:///C:/secret.txt',
    'local://asset.png',
    'javascript:alert(1)',
    'data:text/html,test',
    'blob:https://example.com/id',
  ]) (
    'blocks %s without opening an external program',
    (url) => {
      const event = { preventDefault: vi.fn() }
      const openExternal = vi.fn().mockResolvedValue(undefined)
      const handler = createNavigationHandler({
        policy: { kind: 'development' },
        openExternal,
        logger: createLogger(),
      })

      handler(event, url)

      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(openExternal).not.toHaveBeenCalled()
    },
  )

  it('revalidates every redirect target', () => {
    const trustedEvent = { preventDefault: vi.fn() }
    const redirectEvent = { preventDefault: vi.fn() }
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const handler = createNavigationHandler({
      policy: { kind: 'development' },
      openExternal,
      logger: createLogger(),
    })

    handler(trustedEvent, 'http://localhost:5173/redirect')
    handler(redirectEvent, 'local://attachments/image.png')

    expect(trustedEvent.preventDefault).not.toHaveBeenCalled()
    expect(redirectEvent.preventDefault).toHaveBeenCalledOnce()
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('permission default-deny', () => {
  it.each([
    'notifications',
    'media',
    'geolocation',
    'midi',
    'midiSysex',
    'pointerLock',
    'fullscreen',
    'openExternal',
    'clipboard-read',
    'clipboard-sanitized-write',
    'display-capture',
    'idle-detection',
    'serial',
    'usb',
    'hid',
    'bluetooth',
  ]) (
    'denies request permission %s',
    (permission) => {
      const callback = vi.fn()

      denyPermissionRequest(null, permission, callback)

      expect(callback).toHaveBeenCalledWith(false)
    },
  )

  it.each(['clipboard-read', 'clipboard-sanitized-write', 'display-capture', 'idle-detection', 'serial', 'usb', 'hid', 'bluetooth']) (
    'returns false for checked permission %s',
    (permission) => {
      expect(denyPermissionCheck(null, permission)).toBe(false)
    },
  )
})

describe('trusted main-window IPC sender helper', () => {
  const createFixture = () => {
    const mainFrame = { url: 'http://localhost:5173/' }
    const webContents = { mainFrame }
    const mainWindow = { isDestroyed: vi.fn(() => false), webContents }
    const getMainWindow = vi.fn<() => typeof mainWindow | null>(() => mainWindow)
    const options = {
      getMainWindow,
      getNavigationPolicy: () => ({ kind: 'development' as const }),
    }
    return { getMainWindow, mainFrame, mainWindow, options, webContents }
  }

  it('accepts only the live trusted main-window main frame', () => {
    const { mainFrame, options, webContents } = createFixture()

    expect(isTrustedMainWindowIpcSender({
      sender: webContents,
      senderFrame: mainFrame,
    }, options)).toBe(true)
  })

  it('rejects missing or destroyed windows, other webContents, subframes, and untrusted URLs', () => {
    const { getMainWindow, mainFrame, mainWindow, options, webContents } = createFixture()

    expect(isTrustedMainWindowIpcSender({
      sender: { mainFrame },
      senderFrame: mainFrame,
    }, options)).toBe(false)
    expect(isTrustedMainWindowIpcSender({
      sender: webContents,
      senderFrame: { url: mainFrame.url },
    }, options)).toBe(false)

    mainWindow.isDestroyed.mockReturnValueOnce(true)
    expect(isTrustedMainWindowIpcSender({
      sender: webContents,
      senderFrame: mainFrame,
    }, options)).toBe(false)

    getMainWindow.mockReturnValueOnce(null)
    expect(isTrustedMainWindowIpcSender({
      sender: webContents,
      senderFrame: mainFrame,
    }, options)).toBe(false)

    mainFrame.url = 'https://untrusted.example/private'
    expect(isTrustedMainWindowIpcSender({
      sender: webContents,
      senderFrame: mainFrame,
    }, options)).toBe(false)
  })
})

describe('clipboard write handler', () => {
  const createFixture = () => {
    const mainFrame = { url: 'http://localhost:5173/' }
    const webContents = { mainFrame }
    const writeText = vi.fn()
    const mainWindow = { isDestroyed: vi.fn(() => false), webContents }
    const getMainWindow = vi.fn<() => typeof mainWindow | null>(() => mainWindow)
    const handler = createClipboardWriteHandler({
      getMainWindow,
      getNavigationPolicy: () => ({ kind: 'development' }),
      writeText,
    })
    return { getMainWindow, handler, mainFrame, mainWindow, webContents, writeText }
  }

  it('writes text for the live trusted main-window main frame', () => {
    const { handler, mainFrame, webContents, writeText } = createFixture()

    handler({ sender: webContents, senderFrame: mainFrame }, 'copy sentinel')

    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith('copy sentinel')
  })

  it('rejects other webContents and main-window subframes', () => {
    const { handler, mainFrame, webContents, writeText } = createFixture()

    expect(() => handler({ sender: { mainFrame }, senderFrame: mainFrame }, 'blocked')).toThrow(/rejected/)
    expect(() => handler({ sender: webContents, senderFrame: { url: mainFrame.url } }, 'blocked')).toThrow(/rejected/)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('rejects missing, destroyed, and untrusted main windows', () => {
    const { getMainWindow, handler, mainFrame, mainWindow, webContents, writeText } = createFixture()

    getMainWindow.mockReturnValueOnce(null)
    expect(() => handler({ sender: webContents, senderFrame: mainFrame }, 'blocked')).toThrow(/rejected/)
    mainWindow.isDestroyed.mockReturnValueOnce(true)
    expect(() => handler({ sender: webContents, senderFrame: mainFrame }, 'blocked')).toThrow(/rejected/)
    mainFrame.url = 'https://untrusted.example/'
    expect(() => handler({ sender: webContents, senderFrame: mainFrame }, 'blocked')).toThrow(/rejected/)
    expect(writeText).not.toHaveBeenCalled()
  })

  it.each([null, 42, {}, ['text']])('rejects a non-string payload: %j', (payload) => {
    const { handler, mainFrame, webContents, writeText } = createFixture()

    expect(() => handler({ sender: webContents, senderFrame: mainFrame }, payload)).toThrow(/rejected/)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('does not log rejected clipboard content', () => {
    const { handler, mainFrame, webContents } = createFixture()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => handler({ sender: webContents, senderFrame: mainFrame }, { secret: 'private copy text' })).toThrow()

    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})

describe('BrowserWindow security preferences', () => {
  it('keeps all required webPreferences secure', () => {
    expect(createMainWindowWebPreferences('C:\\MindDiary\\preload.js')).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      preload: 'C:\\MindDiary\\preload.js',
    })
  })
})
