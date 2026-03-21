/**
 * sanitize.js — Security utilities for handling sensitive data
 *
 * Centralizes logic for stripping API keys and other secrets from
 * exported data, and for masking keys in the UI display.
 */

/** Keys that must never appear in exported backups. */
const SENSITIVE_KEYS = ['aiApiKey']

/**
 * Remove sensitive keys from a settings object before export.
 *
 * @param {object} settings — raw settings object from the database
 * @returns {object}        — a shallow copy with sensitive keys removed
 */
export function sanitizeSettingsForExport(settings) {
  if (!settings || typeof settings !== 'object') return {}
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !SENSITIVE_KEYS.includes(key))
  )
}

/**
 * Mask an API key for safe display in the UI.
 * Shows the first 3 characters and the last 4 characters, with **** in between.
 * Returns a placeholder if the key is too short or missing.
 *
 * @param {string} key — the raw API key string
 * @returns {string}   — masked representation, e.g. "sk-****abcd"
 */
export function maskApiKey(key) {
  if (!key || typeof key !== 'string') return ''
  if (key.length <= 8) return '****'
  return key.slice(0, 3) + '****' + key.slice(-4)
}

/**
 * Check whether a settings key is considered sensitive.
 * Used by import logic to skip overwriting local secrets.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isSensitiveKey(key) {
  return SENSITIVE_KEYS.includes(key)
}
