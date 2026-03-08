/**
 * apiAdapter.js — Runtime environment detection.
 *
 * Electron renderer process embeds "Electron" in its user-agent string.
 * The mockApi fallback (installed by mockApi.js in browser mode) does NOT.
 * This is the single detection point used by DiaryContext to decide which
 * backend to use: SQLite via IPC (Electron) or localStorage (browser).
 */

/** true when running inside an Electron renderer window */
export const IS_ELECTRON = typeof navigator !== 'undefined' &&
    /electron/i.test(navigator.userAgent)
