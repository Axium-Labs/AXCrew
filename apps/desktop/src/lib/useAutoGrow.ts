import { useLayoutEffect, type RefObject } from 'react'

/** Resize after draft changes and pane resizing, including wrapped lines. */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string, mountKey?: string) {
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const resize = () => {
      node.style.height = 'auto'
      // CSS owns min/max height, including the viewport-relative cap.
      node.style.height = `${node.scrollHeight}px`
      node.style.overflowY = node.scrollHeight > node.clientHeight ? 'auto' : 'hidden'
    }
    resize()
    let width = node.getBoundingClientRect().width
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width
      if (next !== undefined && next !== width) { width = next; resize() }
    })
    observer.observe(node)
    window.addEventListener('resize', resize)
    return () => { observer.disconnect(); window.removeEventListener('resize', resize) }
  }, [ref, value, mountKey])
}
