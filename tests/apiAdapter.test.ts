import { afterEach, describe, expect, it, vi } from 'vitest'

const loadApiAdapter = async () => {
  vi.resetModules()
  return import('../src/utils/apiAdapter')
}

describe('IS_ELECTRON', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('returns true when the user agent includes Electron', async () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Electron/34.5.8 Chrome/132.0.6834.196 Safari/537.36',
    })

    const { IS_ELECTRON } = await loadApiAdapter()

    expect(IS_ELECTRON).toBe(true)
  })

  it('returns false for a regular browser user agent', async () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36',
    })

    const { IS_ELECTRON } = await loadApiAdapter()

    expect(IS_ELECTRON).toBe(false)
  })

  it('returns false when navigator is unavailable', async () => {
    vi.stubGlobal('navigator', undefined)

    const { IS_ELECTRON } = await loadApiAdapter()

    expect(IS_ELECTRON).toBe(false)
  })

  it('returns false when navigator has no userAgent', async () => {
    vi.stubGlobal('navigator', {})

    const { IS_ELECTRON } = await loadApiAdapter()

    expect(IS_ELECTRON).toBe(false)
  })
})
