// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { buildSafeSettingsPayload } from '../electron/settingsSecurity'

describe('settings security helpers', () => {
  it('does not expose the real API key in settings:getAll payloads', () => {
    const safe = buildSafeSettingsPayload({
      aiApiKey: 'sk-secret-key',
      aiEndpoint: 'https://api.example.com/v1',
      theme: 'dark',
    }, 'sk-secret-key')

    expect(safe).not.toHaveProperty('aiApiKey')
    expect(safe.aiEndpoint).toBe('https://api.example.com/v1')
    expect(safe.aiApiKeyPresent).toBe(true)
    expect(safe.aiApiKeyMasked).toBe('sk-***-key')
    expect(JSON.stringify(safe)).not.toContain('sk-secret-key')
  })
})
