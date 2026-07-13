import { describe, expect, it, vi } from 'vitest'
import {
  createMainWindowWebPreferences,
  createNavigationHandler,
  createWindowOpenHandler,
  denyPermissionCheck,
  denyPermissionRequest,
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

  it.each(['clipboard-read', 'display-capture', 'idle-detection', 'serial', 'usb', 'hid', 'bluetooth']) (
    'returns false for checked permission %s',
    (permission) => {
      expect(denyPermissionCheck(null, permission)).toBe(false)
    },
  )
})

describe('BrowserWindow security preferences', () => {
  it('keeps all required webPreferences secure', () => {
    expect(createMainWindowWebPreferences('C:\\MindDiary\\preload.js')).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      preload: 'C:\\MindDiary\\preload.js',
    })
  })
})
