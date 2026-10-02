import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type SessionMetadata = {title?: string; marked?: boolean; project?: string; deleted?: boolean}

type SessionUi = {
  metadata: Record<string, SessionMetadata>
  setMetadata: (id: string, value: Partial<SessionMetadata>) => void
  listOpen: boolean
  rightOpen: boolean
  rightTab: 'files' | 'details' | 'changes' | 'chat'
  drafts: Record<string, string>
  startingIds: string[]
  selectedCwd: string | null
  permissionModes: Record<string, 'ask' | 'read' | 'trust' | 'yolo'>
  defaultPermission: 'ask' | 'yolo'
  thinkingEffort: string
  setListOpen: (open: boolean) => void
  setRightOpen: (open: boolean) => void
  setRightTab: (tab: 'files' | 'details' | 'changes' | 'chat') => void
  setDraft: (key: string, text: string) => void
  addStarting: (id: string) => void
  setSelectedCwd: (cwd: string | null) => void
  setPermissionMode: (key: string, mode: 'ask' | 'read' | 'trust' | 'yolo') => void
  setThinkingEffort: (value: string) => void
}

export const useSessionUi = create<SessionUi>()(persist(set => ({
  metadata: {},
  setMetadata: (id, value) => set(state => ({ metadata: { ...state.metadata, [id]: { ...state.metadata[id], ...value } } })),
  listOpen: true, rightOpen: false, rightTab: 'files', drafts: {}, startingIds: [], selectedCwd: null, permissionModes: {}, defaultPermission: 'ask', thinkingEffort: '',
  setListOpen: listOpen => set({ listOpen }),
  setRightOpen: rightOpen => set({ rightOpen }),
  setRightTab: rightTab => set({ rightTab }),
  setDraft: (key, text) => set(state => ({ drafts: { ...state.drafts, [key]: text } })),
  addStarting: id => set(state => ({ startingIds: [...new Set([...state.startingIds, id])] })),
  setSelectedCwd: selectedCwd => set({ selectedCwd }),
  setPermissionMode: (key, mode) => set(state => ({ permissionModes: { ...state.permissionModes, [key]: mode }, defaultPermission: mode === 'yolo' ? 'yolo' : mode === 'ask' ? 'ask' : state.defaultPermission })),
  setThinkingEffort: thinkingEffort => set({ thinkingEffort }),
}), {
  name: 'ax-crew-session-layout',
  partialize: ({ metadata, listOpen, rightOpen, rightTab, selectedCwd, permissionModes, defaultPermission, thinkingEffort }) => ({ metadata, listOpen, rightOpen, rightTab, selectedCwd, permissionModes, defaultPermission, thinkingEffort }),
}))
