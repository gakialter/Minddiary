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
