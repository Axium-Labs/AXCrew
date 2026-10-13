import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TerminalPosition = 'bottom' | 'right'
export type TerminalContext = { deviceId: string; cwd?: string; name?: string; blocked?: 'loading' | 'select' | 'paired' }
export type TerminalTab = { id: string; cwd?: string; initialCommand?: string; context: TerminalContext }

export function terminalContextKey(context: TerminalContext) {
  let cwd = context.cwd
  if (context.deviceId === 'local' && cwd) {
    cwd = cwd.replaceAll('\\', '/')
    if (cwd.length > 1) cwd = cwd.replace(/\/+$/, '')
    if (/^[a-z]:|^\/\//i.test(cwd)) cwd = cwd.toLowerCase()
  }
  return JSON.stringify([context.deviceId, cwd ?? '', context.blocked ?? ''])
}

function activateContext(state: TerminalDockState, context: TerminalContext) {
  if (context.blocked) return { activeId: null }
  const key = terminalContextKey(context)
  const active = state.tabs.find(tab => tab.id === state.activeId && terminalContextKey(tab.context) === key)
    ?? [...state.tabs].reverse().find(tab => terminalContextKey(tab.context) === key)
  if (active) return { activeId: active.id }
  if (state.tabs.length >= 8) return { activeId: null }
  const tab = { id: crypto.randomUUID(), cwd: context.cwd, context }
  return { tabs: [...state.tabs, tab], activeId: tab.id }
}

type TerminalDockState = {
  open: boolean
  position: TerminalPosition
  height: number
  width: number
  tabs: TerminalTab[]
  activeId: string | null
  sessionContext: TerminalContext | null
  context: TerminalContext | null
  setSessionContext: (context: TerminalContext | null) => void
  setContext: (context: TerminalContext) => void
  setOpen: (open: boolean, cwd?: string, context?: TerminalContext) => void
  addTab: (cwd?: string, initialCommand?: string, context?: TerminalContext) => void
  closeTab: (id: string) => void
  reorderTab: (from: string, to: string) => void
  setActive: (id: string) => void
  setPosition: (position: TerminalPosition) => void
  setHeight: (height: number) => void
  setWidth: (width: number) => void
}

export const useTerminalDock = create<TerminalDockState>()(persist(set => ({
  open: false, position: 'bottom', height: 300, width: 420, tabs: [], activeId: null, sessionContext: null, context: null,
  setSessionContext: sessionContext => set({ sessionContext }),
  setContext: context => set(state => ({ context, ...(state.open && terminalContextKey(context) !== (state.context && terminalContextKey(state.context)) ? activateContext(state, context) : {}) })),
  setOpen: (open, cwd, context) => set(state => {
    if (!open) return { open }
    const target = context ?? { deviceId: 'local', cwd }
    return { open, context: target, ...activateContext(state, target) }
  }),
  addTab: (cwd, initialCommand, context) => set(state => {
    const target = context ?? { deviceId: 'local', cwd }
    if (target.blocked || state.tabs.length >= 8) return { open: true }
    const tab = { id: crypto.randomUUID(), cwd: target.cwd, initialCommand, context: target }
    return { open: true, tabs: [...state.tabs, tab], activeId: tab.id }
  }),
  closeTab: id => set(state => {
    const index = state.tabs.findIndex(tab => tab.id === id)
    if (index < 0) return state
    const tabs = state.tabs.filter(tab => tab.id !== id)
    const next = [...tabs].reverse().find(tab => terminalContextKey(tab.context) === terminalContextKey(state.tabs[index].context))
    return { tabs, activeId: state.activeId === id ? next?.id ?? null : state.activeId, open: tabs.length > 0 && state.open }
  }),
  /**
   * Drag-and-drop only moves the label: sessions are keyed by id, so the running
   * shells keep their pty while the tab strip reorders.
   */
  reorderTab: (from, to) => set(state => {
    const start = state.tabs.findIndex(tab => tab.id === from)
    const end = state.tabs.findIndex(tab => tab.id === to)
    if (start < 0 || end < 0 || start === end) return state
    const tabs = [...state.tabs]
    const [moved] = tabs.splice(start, 1)
    tabs.splice(end, 0, moved)
    return { tabs }
  }),
  setActive: activeId => set({ activeId }),
  setPosition: position => set({ position }),
  setHeight: height => set({ height: Math.max(120, Math.round(height)) }),
  setWidth: width => set({ width: Math.max(200, Math.round(width)) }),
}), { name: 'ax-crew-terminal-layout', partialize: ({ position, height, width }) => ({ position, height, width }) }))
