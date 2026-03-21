import { useEffect } from 'react'

/**
 * useGlobalKeyboard — Register global keyboard shortcuts.
 *
 * @param {Object<string, function>} bindings
 *   Map of lowercase key names to handler functions.
 *   Handlers are only called when Ctrl (or Cmd on Mac) is held.
 *   Example: { 'k': () => openPalette() }
 */
export function useGlobalKeyboard(bindings) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const handler = bindings[e.key.toLowerCase()]
      if (handler) {
        e.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [bindings])
}
