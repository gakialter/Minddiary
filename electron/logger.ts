/**
 * Minimal logger for Electron main process.
 *
 * Import `logger` instead of using `console.*` directly in main-process code.
 * In production builds `debug` / `info` / `log` become no-ops, while
 * `warn` and `error` are always kept for diagnostics.
 */

const isDev = !require('electron').app.isPackaged;

function noop(..._args: unknown[]): void {}

export const logger = {
  debug: isDev ? console.debug.bind(console) : noop,
  info: isDev ? console.info.bind(console) : noop,
  log: isDev ? console.log.bind(console) : noop,
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};

module.exports = { logger };
