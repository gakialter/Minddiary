import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button, a[href], input, select, textarea, summary, [tabindex], [contenteditable]:not([contenteditable="false"])'
const activeModals: HTMLElement[] = []

/** UI lifecycle only. Nested image dialogs own Escape; this trap follows their focus. */
export function useModalFocus(onClose: () => void | Promise<void>, active = true, focusSurface = false) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const root = ref.current
    if (!active || !root) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    const isolated: { element: HTMLElement; inert: boolean }[] = []
    // Isolate siblings up to body, including shell chrome when the modal is inline.
    let node: HTMLElement = root
    while (node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && sibling instanceof HTMLElement) {
          isolated.push({ element: sibling, inert: sibling.inert })
          sibling.inert = true
        }
      }
      if (node.parentElement === document.body) break
      node = node.parentElement
    }
    activeModals.push(root)
    document.body.style.overflow = 'hidden'
    const surface = () => root.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]') || root
    const controls = (scope: HTMLElement) => Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[hidden], [inert]')
        && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden')
    const focusFirst = () => (controls(surface())[0] || surface()).focus()
    if (focusSurface) root.focus()
    else focusFirst()
    const onKeyDown = (event: KeyboardEvent) => {
      if (activeModals[activeModals.length - 1] !== root) return
      const scope = surface()
      if (event.key === 'Escape' && scope === root) {
        event.preventDefault()
        event.stopImmediatePropagation()
        void closeRef.current()
      } else if (event.key === 'Tab') {
        const items = controls(scope)
        const first = items[0]
        const last = items[items.length - 1]
        const focused = document.activeElement
        if (!first) { event.preventDefault(); scope.focus() }
        else if (event.shiftKey && (focused === first || !items.includes(focused as HTMLElement))) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && (focused === last || !items.includes(focused as HTMLElement))) {
          event.preventDefault(); first.focus()
        }
      }
    }
    const onFocus = (event: FocusEvent) => {
      if (activeModals[activeModals.length - 1] === root && !surface().contains(event.target as Node)) focusFirst()
    }
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocus)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocus)
      activeModals.splice(activeModals.indexOf(root), 1)
      isolated.forEach(({ element, inert }) => { element.inert = inert })
      document.body.style.overflow = previousOverflow
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus()
    }
  }, [active, focusSurface])
  return ref
}
