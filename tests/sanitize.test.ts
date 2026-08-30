import { describe, it, expect } from 'vitest'
import { sanitizeSettingsForExport } from '../src/utils/sanitize'

describe('sanitizeSettingsForExport', () => {
  it('removes aiApiKey from settings', () => {
    const settings = {
      examDate: '2026-12-25',
      aiEndpoint: 'https://api.openai.com/v1',
      aiApiKey: 'sk-secret-key-12345',
      aiModel: 'gpt-4',
      autoSave: true,
    }
    const result = sanitizeSettingsForExport(settings)

    expect(result).not.toHaveProperty('aiApiKey')
    expect(result.examDate).toBe('2026-12-25')
    expect(result.aiEndpoint).toBe('https://api.openai.com/v1')
    expect(result.aiModel).toBe('gpt-4')
    expect(result.autoSave).toBe(true)
  })

  it('returns empty object for null/undefined input', () => {
    expect(sanitizeSettingsForExport(null)).toEqual({})
    expect(sanitizeSettingsForExport(undefined)).toEqual({})
  })

  it('returns empty object for non-object input', () => {
    expect(sanitizeSettingsForExport('string' as unknown as Record<string, unknown>)).toEqual({})
    expect(sanitizeSettingsForExport(42 as unknown as Record<string, unknown>)).toEqual({})
  })

  it('preserves all non-sensitive keys', () => {
    const settings = { a: 1, b: 'two', c: true }
    const result = sanitizeSettingsForExport(settings)
    expect(result).toEqual({ a: 1, b: 'two', c: true })
  })
})
