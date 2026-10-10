import { createContext, useContext, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useSessionUi } from '../store/sessions'
import { useUi } from '../store/ui'
import { resolveWorkspaceLayout, type WorkspaceLayout } from './workspaceLayout'

export const WorkspaceLayoutContext = createContext<WorkspaceLayout | null>(null)

export function useWorkspaceLayoutManager(ref: RefObject<HTMLDivElement | null>, sessionView: boolean, terminalRight: boolean) {
  const ui = useSessionUi(), navigation = useUi(state => state.sidebar)
  const [size, setSize] = useState({ width: Math.max(0, window.innerWidth - 20), terminal: 0 })
  const previous = useRef<WorkspaceLayout | undefined>(undefined)
  useLayoutEffect(() => {
    const host = ref.current
    if (!host) return
    const terminal = host.querySelector<HTMLElement>('.terminal-dock')
    const measure = () => {
      const padding = getComputedStyle(host)
      const width = host.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight)
      if (!Number.isFinite(width) || width <= 0) return
      const dock = terminalRight ? terminal?.getBoundingClientRect().width ?? 0 : 0
      setSize(old => old.width === width && old.terminal === dock ? old : { width, terminal: dock })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    if (terminal) observer.observe(terminal)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [ref, terminalRight])
  const layout = resolveWorkspaceLayout({
    width: size.width - size.terminal, navigation,
    list: sessionView && ui.listOpen, right: sessionView && ui.rightOpen,
    chat: ui.chatOpen, rightTab: ui.rightTab, ratio: ui.splitRatio,
  }, previous.current)
  useLayoutEffect(() => { previous.current = layout })
  return layout
}

export function useWorkspaceLayout() {
  const layout = useContext(WorkspaceLayoutContext), ui = useSessionUi()
  // Component tests and embedded session views can run without the application shell.
  return layout ?? resolveWorkspaceLayout({ width: window.innerWidth, navigation: false, list: ui.listOpen, right: ui.rightOpen, chat: ui.chatOpen, rightTab: ui.rightTab, ratio: ui.splitRatio })
}
