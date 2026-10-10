import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_SPLIT } from '../lib/workspaceLayout'

export type SessionMetadata = {title?: string; marked?: boolean; project?: string; deleted?: boolean}

type SessionUi = {
  metadata: Record<string, SessionMetadata>
  setMetadata: (id: string, value: Partial<SessionMetadata>) => void
  listOpen: boolean
  rightOpen: boolean
  rightTab: 'files' | 'details' | 'chat'
  layoutReset: number
  chatOpen: boolean
  splitRatio: number
  setChatOpen: (open: boolean) => void
  setSplitRatio: (ratio: number) => void
  resetLayout: () => void
  drafts: Record<string, string>
  draftUpdatedAt: Record<string, number>
  startingIds: string[]
  selectedEnvironment: string | null
  setSelectedEnvironment: (id: string | null) => void
  selectedCwd: string | null
  permissionModes: Record<string, 'ask' | 'read' | 'trust' | 'yolo'>
  defaultPermission: 'ask' | 'yolo'
  thinkingEffort: string
  setListOpen: (open: boolean) => void
  setRightOpen: (open: boolean) => void
  setRightTab: (tab: 'files' | 'details' | 'chat') => void
  setDraft: (key: string, text: string) => void
  addStarting: (id: string) => void
  setSelectedCwd: (cwd: string | null) => void
  setPermissionMode: (key: string, mode: 'ask' | 'read' | 'trust' | 'yolo') => void
  setThinkingEffort: (value: string) => void
}

export const useSessionUi = create<SessionUi>()(persist(set => ({
  metadata: {},
  setMetadata: (id, value) => set(state => ({ metadata: { ...state.metadata, [id]: { ...state.metadata[id], ...value } } })),
  listOpen: true, rightOpen: false, rightTab: 'files', drafts: {}, draftUpdatedAt: {}, startingIds: [], selectedCwd: null, selectedEnvironment: null, permissionModes: {}, defaultPermission: 'ask', thinkingEffort: '',
  layoutReset: 0, chatOpen: true, splitRatio: DEFAULT_SPLIT,
  setChatOpen: chatOpen => set({ chatOpen }),
  setSplitRatio: splitRatio => set({ splitRatio: Number.isFinite(splitRatio) ? Math.max(.1, Math.min(.9, splitRatio)) : DEFAULT_SPLIT }),
  resetLayout: () => set(state => ({ layoutReset: state.layoutReset + 1, listOpen: true, rightOpen: false, rightTab: 'files', chatOpen: true, splitRatio: DEFAULT_SPLIT })),
  setListOpen: listOpen => set({ listOpen }),
  setRightOpen: rightOpen => set({ rightOpen }),
  setRightTab: rightTab => set({ rightTab }),
  setDraft: (key, text) => set(state => ({ drafts: { ...state.drafts, [key]: text }, draftUpdatedAt: { ...state.draftUpdatedAt, [key]: Math.max(Date.now(), (state.draftUpdatedAt[key] ?? 0) + 1) } })),
  addStarting: id => set(state => ({ startingIds: [...new Set([...state.startingIds, id])] })),
  setSelectedCwd: selectedCwd => set({ selectedCwd }),
  setSelectedEnvironment: selectedEnvironment => set({ selectedEnvironment }),
  setPermissionMode: (key, mode) => set(state => ({ permissionModes: { ...state.permissionModes, [key]: mode }, defaultPermission: mode === 'yolo' ? 'yolo' : mode === 'ask' ? 'ask' : state.defaultPermission })),
  setThinkingEffort: thinkingEffort => set({ thinkingEffort }),
}), {
  name: 'ax-crew-session-layout',
  partialize: ({ metadata, listOpen, rightOpen, rightTab, chatOpen, splitRatio, selectedCwd, selectedEnvironment, permissionModes, defaultPermission, thinkingEffort, drafts, draftUpdatedAt }) => ({ metadata, listOpen, rightOpen, rightTab, chatOpen, splitRatio, selectedCwd, selectedEnvironment, permissionModes, defaultPermission, thinkingEffort, drafts, draftUpdatedAt }),
}))
