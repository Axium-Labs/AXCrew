import { useEffect, useRef, type RefObject } from 'react'

/** Keep keyboard navigation inside the active drawer and return focus on dismissal. */
export function usePanelDrawer(ref: RefObject<HTMLElement | null>, active: boolean) {
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const pane = ref.current
    if (!active || !pane) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const controls = () => [...pane.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(node => node.getClientRects().length)
    controls()[0]?.focus({ preventScroll: true })
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return
      const items = controls(), first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    pane.addEventListener('keydown', key)
    return () => { pane.removeEventListener('keydown', key); if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }) }
  }, [active, ref])
}
