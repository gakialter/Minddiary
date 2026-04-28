/**
 * Minimal logger — strips debug/info/log in production, keeps warn/error.
 *
 * Import `logger` instead of using `console.*` directly in renderer code.
 * `console.error` / `console.warn` remain native for ErrorBoundary and
 * critical diagnostics.
 */

const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV

function noop(..._args: unknown[]): void {}

export const logger = {
  debug: isDev ? console.debug.bind(console) : noop,
  info: isDev ? console.info.bind(console) : noop,
  log: isDev ? console.log.bind(console) : noop,
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
}
