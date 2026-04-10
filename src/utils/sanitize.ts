/**
 * sanitize.ts — Security utilities for handling sensitive data
 *
 * Centralizes logic for stripping API keys and other secrets from
 * exported data, and for masking keys in the UI display.
 */

/** Keys that must never appear in exported backups. */
const SENSITIVE_KEYS: string[] = ['aiApiKey']

/**
 * Remove sensitive keys from a settings object before export.
 */
export function sanitizeSettingsForExport(settings: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!settings || typeof settings !== 'object') return {}
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !SENSITIVE_KEYS.includes(key))
  )
}

/**
 * Mask an API key for safe display in the UI.
 * Shows the first 3 characters and the last 4 characters, with **** in between.
 * Returns a placeholder if the key is too short or missing.
 */
export function maskApiKey(key: string | null | undefined): string {
  if (!key || typeof key !== 'string') return ''
  if (key.length <= 8) return '****'
  return key.slice(0, 3) + '****' + key.slice(-4)
}

/**
 * Check whether a settings key is considered sensitive.
 * Used by import logic to skip overwriting local secrets.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.includes(key)
}
