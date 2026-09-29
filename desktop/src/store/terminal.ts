import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TerminalPosition = 'bottom' | 'right'
export type TerminalTab = { id: string; cwd?: string; initialCommand?: string }

type TerminalDockState = {
  open: boolean
  position: TerminalPosition
  height: number
  width: number
  tabs: TerminalTab[]
  activeId: string | null
  setOpen: (open: boolean, cwd?: string) => void
  addTab: (cwd?: string, initialCommand?: string) => void
  closeTab: (id: string) => void
  setActive: (id: string) => void
  setPosition: (position: TerminalPosition) => void
  setHeight: (height: number) => void
  setWidth: (width: number) => void
}

export const useTerminalDock = create<TerminalDockState>()(persist(set => ({
  open: false, position: 'bottom', height: 300, width: 420, tabs: [], activeId: null,
  setOpen: (open, cwd) => set(state => {
    if (!open || state.tabs.length) return { open }
    const tab = { id: crypto.randomUUID(), cwd }
    return { open, tabs: [tab], activeId: tab.id }
  }),
  addTab: (cwd, initialCommand) => set(state => {
    if (state.tabs.length >= 8) return { open: true, activeId: state.tabs.at(-1)?.id ?? null }
    const tab = { id: crypto.randomUUID(), cwd, initialCommand }
    return { open: true, tabs: [...state.tabs, tab], activeId: tab.id }
  }),
  closeTab: id => set(state => {
    const index = state.tabs.findIndex(tab => tab.id === id)
    if (index < 0) return state
    const tabs = state.tabs.filter(tab => tab.id !== id)
    return { tabs, activeId: state.activeId === id ? (tabs[index - 1] ?? tabs[index] ?? null)?.id ?? null : state.activeId, open: tabs.length > 0 && state.open }
  }),
  setActive: activeId => set({ activeId }),
  setPosition: position => set({ position }),
  setHeight: height => set({ height: Math.max(120, Math.round(height)) }),
  setWidth: width => set({ width: Math.max(200, Math.round(width)) }),
}), { name: 'ax-crew-terminal-layout', partialize: ({ position, height, width }) => ({ position, height, width }) }))
