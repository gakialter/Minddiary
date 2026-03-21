import { describe, it, expect } from 'vitest'
import { sanitizeSettingsForExport, maskApiKey, isSensitiveKey } from '../src/utils/sanitize'

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
    expect(sanitizeSettingsForExport('string')).toEqual({})
    expect(sanitizeSettingsForExport(42)).toEqual({})
  })

  it('preserves all non-sensitive keys', () => {
    const settings = { a: 1, b: 'two', c: true }
    const result = sanitizeSettingsForExport(settings)
    expect(result).toEqual({ a: 1, b: 'two', c: true })
  })
})

describe('maskApiKey', () => {
  it('masks a standard API key showing first 3 and last 4 chars', () => {
    expect(maskApiKey('sk-abcdefghijklmno')).toBe('sk-****lmno')
  })

  it('returns **** for very short keys', () => {
    expect(maskApiKey('short')).toBe('****')
    expect(maskApiKey('12345678')).toBe('****')
  })

  it('returns empty string for null/undefined', () => {
    expect(maskApiKey(null)).toBe('')
    expect(maskApiKey(undefined)).toBe('')
    expect(maskApiKey('')).toBe('')
  })

  it('handles non-string input gracefully', () => {
    expect(maskApiKey(12345)).toBe('')
  })
})

describe('isSensitiveKey', () => {
  it('returns true for aiApiKey', () => {
    expect(isSensitiveKey('aiApiKey')).toBe(true)
  })

  it('returns false for non-sensitive keys', () => {
    expect(isSensitiveKey('examDate')).toBe(false)
    expect(isSensitiveKey('aiEndpoint')).toBe(false)
    expect(isSensitiveKey('autoSave')).toBe(false)
  })
})
